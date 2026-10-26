-- =============================================================================
-- Migração 002: múltiplas salas de interesse + valores de A&B e Hospedagem
-- Segura para rodar com dados existentes e idempotente (pode rodar de novo).
-- =============================================================================
begin;

-- 1) Salas múltiplas: novo array, preenchido a partir do texto antigo ------------
alter table public.leads add column if not exists room_interests text[] not null default '{}';

create or replace function public.sync_lead_rooms()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Compatibilidade: quem ainda gravar só o texto room_interest alimenta o array
  if coalesce(cardinality(new.room_interests), 0) = 0
     and nullif(trim(coalesce(new.room_interest, '')), '') is not null
     and (tg_op = 'INSERT' or new.room_interest is distinct from old.room_interest) then
    new.room_interests := array(
      select trim(part) from unnest(string_to_array(new.room_interest, '|')) as part where trim(part) <> ''
    );
  end if;
  new.room_interests := coalesce(new.room_interests, '{}');
  -- room_interest vira um espelho legível: "Salão A | Salão B"
  new.room_interest := nullif(array_to_string(new.room_interests, ' | '), '');
  return new;
end;
$$;

drop trigger if exists leads_sync_rooms on public.leads;
create trigger leads_sync_rooms
  before insert or update on public.leads
  for each row execute function public.sync_lead_rooms();

-- Converte os registros antigos sem mexer na data de atualização (follow-up)
alter table public.leads disable trigger leads_set_updated_at;
update public.leads
   set room_interests = array(
         select trim(part) from unnest(string_to_array(room_interest, '|')) as part where trim(part) <> ''
       )
 where cardinality(room_interests) = 0
   and nullif(trim(coalesce(room_interest, '')), '') is not null;
alter table public.leads enable trigger leads_set_updated_at;

create index if not exists leads_room_interests_idx on public.leads using gin (room_interests);

-- 2) Valores separados + total calculado pelo banco -----------------------------
alter table public.leads add column if not exists ab_value      numeric(12, 2) not null default 0;
alter table public.leads add column if not exists lodging_value numeric(12, 2) not null default 0;

alter table public.leads drop constraint if exists leads_ab_value_non_negative;
alter table public.leads add  constraint leads_ab_value_non_negative check (ab_value >= 0);
alter table public.leads drop constraint if exists leads_lodging_value_non_negative;
alter table public.leads add  constraint leads_lodging_value_non_negative check (lodging_value >= 0);

alter table public.leads add column if not exists total_value numeric(14, 2)
  generated always as (coalesce(proposed_value, 0) + ab_value + lodging_value) stored;

commit;
