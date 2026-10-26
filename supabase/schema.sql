-- =============================================================================
-- Gestão de Leads e Orçamentos de Eventos (Micro-CRM) — Schema inicial
-- Rodar no SQL Editor do Supabase. O script é idempotente: pode ser executado
-- mais de uma vez sem duplicar tabelas, políticas ou opções padrão.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Função utilitária: mantém a coluna updated_at sempre atualizada
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- Tabela: app_settings_options
-- Opções dinâmicas do Painel Admin (salas, meios de prospecção, motivos de perda)
-- -----------------------------------------------------------------------------
create table if not exists public.app_settings_options (
  id          uuid primary key default gen_random_uuid(),
  category    text not null
              constraint app_settings_options_category_check
              check (category in ('room', 'origin', 'loss_reason')),
  label       text not null
              constraint app_settings_options_label_not_blank
              check (length(trim(label)) > 0),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),

  -- Impede opções duplicadas dentro da mesma categoria
  constraint app_settings_options_category_label_key unique (category, label)
);

comment on table  public.app_settings_options          is 'Opções configuráveis pelo Painel Admin.';
comment on column public.app_settings_options.category is 'room = Sala/Salão | origin = Meio de prospecção | loss_reason = Motivo de perda';
comment on column public.app_settings_options.active   is 'Opções inativas deixam de aparecer nos formulários, mas o histórico dos leads é mantido.';

create index if not exists app_settings_options_category_active_idx
  on public.app_settings_options (category, active);


-- -----------------------------------------------------------------------------
-- Tabela: leads
-- -----------------------------------------------------------------------------
create table if not exists public.leads (
  id                   uuid primary key default gen_random_uuid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Contato
  contact_name         text not null
                       constraint leads_contact_name_not_blank
                       check (length(trim(contact_name)) > 0),
  contact_phone        text,
  contact_email        text,

  -- Origem e interesse (labels vindos de app_settings_options)
  origin               text,
  room_interest        text,

  -- Data do evento
  event_date           date,
  is_date_flexible     boolean not null default false,
  date_notes           text,

  -- Proposta
  proposed_value       numeric(12, 2)
                       constraint leads_proposed_value_non_negative
                       check (proposed_value is null or proposed_value >= 0),
  has_ab               boolean not null default false,
  has_lodging          boolean not null default false,
  proposal_sent        boolean not null default false,
  proposal_number      text,

  -- Funil
  status               text not null default 'em_aberto'
                       constraint leads_status_check
                       check (status in ('em_aberto', 'fechado', 'perdido')),
  loss_reason          text,
  loss_reason_details  text,

  -- Responsável (preenchido automaticamente com o usuário logado)
  user_id              uuid default auth.uid()
                       references auth.users (id) on delete set null,

  -- Um lead perdido precisa ter o motivo informado
  constraint leads_loss_reason_required
    check (status <> 'perdido' or loss_reason is not null)
);

comment on table  public.leads                     is 'Leads e orçamentos de eventos.';
comment on column public.leads.origin              is 'Meio de prospecção (app_settings_options.category = origin).';
comment on column public.leads.event_date          is 'Nulo quando o cliente ainda não definiu a data.';
comment on column public.leads.date_notes          is 'Observações sobre a data, ex.: "Previsão para Novembro".';
comment on column public.leads.has_ab              is 'A proposta inclui Alimentos & Bebidas?';
comment on column public.leads.has_lodging         is 'A proposta inclui Hospedagem?';
comment on column public.leads.proposal_sent       is 'A proposta formal foi gerada/enviada?';
comment on column public.leads.loss_reason         is 'Motivo de perda (app_settings_options.category = loss_reason).';
comment on column public.leads.loss_reason_details is 'Detalhes livres, usado principalmente quando o motivo é "Outros".';

-- Telefone só com dígitos, gerado automaticamente: permite buscar "11987654321"
-- mesmo com o telefone salvo com máscara "(11) 98765-4321"
alter table public.leads
  add column if not exists contact_phone_digits text
  generated always as (nullif(regexp_replace(coalesce(contact_phone, ''), '\D', '', 'g'), '')) stored;

comment on column public.leads.contact_phone_digits is 'Gerada a partir de contact_phone (somente dígitos), usada na busca.';

-- Salas de interesse múltiplas. room_interest (texto) passa a ser um espelho
-- legível ("Salão A | Salão B"), mantido pelo trigger abaixo.
alter table public.leads add column if not exists room_interests text[] not null default '{}';

comment on column public.leads.room_interests is 'Salas/Salões de interesse (app_settings_options.category = room). Um lead pode citar várias.';
comment on column public.leads.room_interest  is 'Espelho legível de room_interests ("Salão A | Salão B"), mantido por trigger. Não gravar direto.';

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
  new.room_interest := nullif(array_to_string(new.room_interests, ' | '), '');
  return new;
end;
$$;

drop trigger if exists leads_sync_rooms on public.leads;
create trigger leads_sync_rooms
  before insert or update on public.leads
  for each row execute function public.sync_lead_rooms();

create index if not exists leads_room_interests_idx on public.leads using gin (room_interests);

-- Valores separados da proposta: Locação/Espaço (proposed_value), A&B e Hospedagem
alter table public.leads add column if not exists ab_value      numeric(12, 2) not null default 0;
alter table public.leads add column if not exists lodging_value numeric(12, 2) not null default 0;

alter table public.leads drop constraint if exists leads_ab_value_non_negative;
alter table public.leads add  constraint leads_ab_value_non_negative check (ab_value >= 0);
alter table public.leads drop constraint if exists leads_lodging_value_non_negative;
alter table public.leads add  constraint leads_lodging_value_non_negative check (lodging_value >= 0);

-- Valor global calculado pelo banco (ordenação e somas consistentes)
alter table public.leads add column if not exists total_value numeric(14, 2)
  generated always as (coalesce(proposed_value, 0) + ab_value + lodging_value) stored;

comment on column public.leads.proposed_value is 'Valor de Locação / Espaço.';
comment on column public.leads.ab_value       is 'Valor de Alimentos & Bebidas (0 quando has_ab = false).';
comment on column public.leads.lodging_value  is 'Valor de Hospedagem (0 quando has_lodging = false).';
comment on column public.leads.total_value    is 'Valor global da proposta: locação + A&B + hospedagem (gerada).';

-- Número de proposta não pode se repetir (quando informado)
create unique index if not exists leads_proposal_number_key
  on public.leads (proposal_number)
  where proposal_number is not null;

-- Índices para filtros e dashboards
create index if not exists leads_status_idx      on public.leads (status);
create index if not exists leads_event_date_idx  on public.leads (event_date);
create index if not exists leads_created_at_idx  on public.leads (created_at desc);
create index if not exists leads_user_id_idx     on public.leads (user_id);

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Permissões: apenas usuários autenticados acessam as tabelas
-- -----------------------------------------------------------------------------
revoke all on public.app_settings_options from anon;
revoke all on public.leads                from anon;

grant select, insert, update, delete on public.app_settings_options to authenticated;
grant select, insert, update, delete on public.leads                to authenticated;


-- -----------------------------------------------------------------------------
-- Row Level Security
-- "to authenticated" restringe a política ao papel autenticado, o mesmo que
-- auth.role() = 'authenticated', na forma recomendada pelo Supabase.
-- -----------------------------------------------------------------------------
alter table public.app_settings_options enable row level security;
alter table public.leads                enable row level security;

-- app_settings_options
drop policy if exists "Autenticados podem ler opções"      on public.app_settings_options;
drop policy if exists "Autenticados podem criar opções"    on public.app_settings_options;
drop policy if exists "Autenticados podem editar opções"   on public.app_settings_options;
drop policy if exists "Autenticados podem excluir opções"  on public.app_settings_options;

create policy "Autenticados podem ler opções"
  on public.app_settings_options for select
  to authenticated
  using (true);

create policy "Autenticados podem criar opções"
  on public.app_settings_options for insert
  to authenticated
  with check (true);

create policy "Autenticados podem editar opções"
  on public.app_settings_options for update
  to authenticated
  using (true)
  with check (true);

create policy "Autenticados podem excluir opções"
  on public.app_settings_options for delete
  to authenticated
  using (true);

-- leads
drop policy if exists "Autenticados podem ler leads"      on public.leads;
drop policy if exists "Autenticados podem criar leads"    on public.leads;
drop policy if exists "Autenticados podem editar leads"   on public.leads;
drop policy if exists "Autenticados podem excluir leads"  on public.leads;

create policy "Autenticados podem ler leads"
  on public.leads for select
  to authenticated
  using (true);

create policy "Autenticados podem criar leads"
  on public.leads for insert
  to authenticated
  with check (true);

create policy "Autenticados podem editar leads"
  on public.leads for update
  to authenticated
  using (true)
  with check (true);

create policy "Autenticados podem excluir leads"
  on public.leads for delete
  to authenticated
  using (true);


-- -----------------------------------------------------------------------------
-- Dados iniciais: motivos de perda padrão
-- -----------------------------------------------------------------------------
insert into public.app_settings_options (category, label)
values
  ('loss_reason', 'Cliente não retornou contato'),
  ('loss_reason', 'Achou alto o valor de gastronomia (A&B)'),
  ('loss_reason', 'Data não disponível'),
  ('loss_reason', 'Achou alto o valor de locação'),
  ('loss_reason', 'Problema de infraestrutura'),
  ('loss_reason', 'Motivo não informado'),
  ('loss_reason', 'Outros')
on conflict (category, label) do nothing;
