-- =============================================================================
-- Migração 004: opt-out da LGPD por contato
-- - Lista de supressão por e-mail e telefone, que sobrevive à exclusão dos leads
-- - Opt-out em um lead vale para todos os leads do mesmo contato (e-mail ou telefone)
-- - Lead novo de um contato suprimido já nasce com opt-out
-- - Desmarcar o opt-out (novo consentimento) libera o contato inteiro
-- Segura para rodar com dados existentes e idempotente (pode rodar de novo).
-- =============================================================================
begin;

-- >>> contato-opt-out (início do bloco também usado em schema.sql)

-- Atualização só do opt-out (propagação por contato) não conta como atualização do orçamento,
-- para não distorcer o indicador "sem atualização" do follow-up.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'marketing_opt_out' - 'updated_at' - 'contact_phone_digits' - 'total_value')
       = (to_jsonb(old) - 'marketing_opt_out' - 'updated_at' - 'contact_phone_digits' - 'total_value') then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- Normalização do contato (mesma regra do app: e-mail minúsculo; telefone com DDD, sem o 55)
create or replace function public.normalize_contact_email(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(trim(coalesce(value, ''))), '')
$$;

create or replace function public.normalize_contact_phone(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when length(d) in (10, 11) then d
           when length(d) in (12, 13) and left(d, 2) = '55' then substr(d, 3)
           else null
         end
  from (select regexp_replace(coalesce(value, ''), '\D', '', 'g') as d) as digits
$$;

-- Lista de supressão: um registro por e-mail ou telefone que pediu opt-out.
-- Não tem chave estrangeira para leads de propósito: continua valendo depois da exclusão.
create table if not exists public.marketing_suppressions (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null
                  constraint marketing_suppressions_kind_check check (kind in ('email', 'phone')),
  value           text not null
                  constraint marketing_suppressions_value_not_blank check (length(value) > 0),
  source_lead_id  uuid,
  created_at      timestamptz not null default now(),
  constraint marketing_suppressions_kind_value_key unique (kind, value)
);

comment on table  public.marketing_suppressions                is 'Contatos (e-mail ou telefone normalizado) que pediram opt-out de comunicações (LGPD). Mantida por triggers em leads.';
comment on column public.marketing_suppressions.source_lead_id is 'Lead em que o opt-out foi registrado (sem FK: o registro sobrevive à exclusão do lead).';

alter table public.marketing_suppressions enable row level security;

-- Usuários só leem a lista; a escrita é feita apenas pelos triggers (security definer)
revoke all on public.marketing_suppressions from anon, authenticated;
grant select on public.marketing_suppressions to authenticated;

drop policy if exists "Autenticados podem ler supressões" on public.marketing_suppressions;
create policy "Autenticados podem ler supressões"
  on public.marketing_suppressions for select
  to authenticated
  using (true);

-- Antes de gravar: lead de um contato suprimido nasce/fica com opt-out
create or replace function public.apply_marketing_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.normalize_contact_email(new.contact_email);
  v_phone text := public.normalize_contact_phone(new.contact_phone);
begin
  -- Desmarcar o opt-out é um novo consentimento explícito: não reimpor
  if tg_op = 'UPDATE' and old.marketing_opt_out and not new.marketing_opt_out then
    return new;
  end if;

  if not new.marketing_opt_out and exists (
    select 1
    from public.marketing_suppressions s
    where (s.kind = 'email' and s.value = v_email)
       or (s.kind = 'phone' and s.value = v_phone)
  ) then
    new.marketing_opt_out := true;
  end if;

  return new;
end;
$$;

-- Depois de gravar: registra/remove a supressão e propaga para os demais leads do contato
create or replace function public.sync_marketing_suppression()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.normalize_contact_email(new.contact_email);
  v_phone text := public.normalize_contact_phone(new.contact_phone);
begin
  if new.marketing_opt_out then
    if v_email is not null then
      insert into public.marketing_suppressions (kind, value, source_lead_id)
      values ('email', v_email, new.id)
      on conflict (kind, value) do nothing;
    end if;
    if v_phone is not null then
      insert into public.marketing_suppressions (kind, value, source_lead_id)
      values ('phone', v_phone, new.id)
      on conflict (kind, value) do nothing;
    end if;

    update public.leads l
       set marketing_opt_out = true
     where l.id <> new.id
       and not l.marketing_opt_out
       and ((v_email is not null and public.normalize_contact_email(l.contact_email) = v_email)
         or (v_phone is not null and public.normalize_contact_phone(l.contact_phone) = v_phone));

  elsif tg_op = 'UPDATE' and old.marketing_opt_out then
    -- Revogação: remove as supressões do contato e libera os demais leads dele
    delete from public.marketing_suppressions s
     where (s.kind = 'email' and s.value = v_email)
        or (s.kind = 'phone' and s.value = v_phone);

    update public.leads l
       set marketing_opt_out = false
     where l.id <> new.id
       and l.marketing_opt_out
       and ((v_email is not null and public.normalize_contact_email(l.contact_email) = v_email)
         or (v_phone is not null and public.normalize_contact_phone(l.contact_phone) = v_phone));
  end if;

  return null;
end;
$$;

-- Funções internas: não ficam disponíveis como RPC para o app
revoke execute on function public.normalize_contact_email(text) from public, anon, authenticated;
revoke execute on function public.normalize_contact_phone(text) from public, anon, authenticated;
revoke execute on function public.apply_marketing_suppression() from public, anon, authenticated;
revoke execute on function public.sync_marketing_suppression() from public, anon, authenticated;

drop trigger if exists leads_marketing_opt_out_apply on public.leads;
create trigger leads_marketing_opt_out_apply
  before insert or update of marketing_opt_out, contact_email, contact_phone on public.leads
  for each row execute function public.apply_marketing_suppression();

drop trigger if exists leads_marketing_opt_out_sync on public.leads;
create trigger leads_marketing_opt_out_sync
  after insert or update of marketing_opt_out, contact_email, contact_phone on public.leads
  for each row execute function public.sync_marketing_suppression();

create index if not exists leads_contact_email_normalized_idx on public.leads (public.normalize_contact_email(contact_email));
create index if not exists leads_contact_phone_normalized_idx on public.leads (public.normalize_contact_phone(contact_phone));

-- <<< contato-opt-out (fim do bloco)

-- Dados existentes: registra os opt-outs atuais e aplica a todos os leads do mesmo contato
insert into public.marketing_suppressions (kind, value, source_lead_id)
select 'email', public.normalize_contact_email(contact_email), id
from public.leads
where marketing_opt_out and public.normalize_contact_email(contact_email) is not null
on conflict (kind, value) do nothing;

insert into public.marketing_suppressions (kind, value, source_lead_id)
select 'phone', public.normalize_contact_phone(contact_phone), id
from public.leads
where marketing_opt_out and public.normalize_contact_phone(contact_phone) is not null
on conflict (kind, value) do nothing;

update public.leads l
   set marketing_opt_out = true
 where not l.marketing_opt_out
   and exists (
     select 1 from public.marketing_suppressions s
     where (s.kind = 'email' and s.value = public.normalize_contact_email(l.contact_email))
        or (s.kind = 'phone' and s.value = public.normalize_contact_phone(l.contact_phone))
   );

commit;
