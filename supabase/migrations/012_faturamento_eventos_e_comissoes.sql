-- =============================================================================
-- Migração 012: faturamento dos eventos e as 3 camadas de receita
-- - Dados do evento: nome, PAX e situação operacional (à confirmar, confirmado, realizado)
-- - Novas receitas: equipamentos/extras e estacionamento
-- - total_value passa a ser a Receita Bruta (100% dos 5 serviços)
-- - net_value (gerada): Receita Líquida do Hotel
--   100% locação + 100% hospedagem + 50% estacionamento + 15% equipamentos + 6% A&B
-- - Pós-evento: NFs de locação, A&B e estacionamento, pagamento e pesquisa de satisfação
-- - Situação operacional e situação do funil andam juntas (trigger)
-- Requer as migrações 009 a 011. Segura com dados existentes e idempotente.
-- =============================================================================
begin;

-- Colunas calculadas pelo banco chegam vazias no trigger: não contam como alteração do orçamento
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'marketing_opt_out' - 'updated_at' - 'contact_phone_digits' - 'total_value' - 'net_value' - 'event_last_date' - 'client_id' - 'contact_id' - 'cnpj' - 'cnpj_digits')
       = (to_jsonb(old) - 'marketing_opt_out' - 'updated_at' - 'contact_phone_digits' - 'total_value' - 'net_value' - 'event_last_date' - 'client_id' - 'contact_id' - 'cnpj' - 'cnpj_digits') then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- >>> faturamento-eventos (início do bloco também usado em schema.sql)

-- -----------------------------------------------------------------------------
-- Dados operacionais do evento
-- -----------------------------------------------------------------------------
alter table public.leads add column if not exists event_name text;
alter table public.leads add column if not exists pax integer;
alter table public.leads add column if not exists operational_status text not null default 'a_confirmar';

alter table public.leads drop constraint if exists leads_pax_non_negative;
alter table public.leads add  constraint leads_pax_non_negative check (pax is null or pax >= 0);
alter table public.leads drop constraint if exists leads_operational_status_check;
alter table public.leads add  constraint leads_operational_status_check
  check (operational_status in ('a_confirmar', 'confirmado', 'realizado'));

comment on column public.leads.event_name         is 'Nome do evento (ex.: "Reunião Virtueyes"), usado na planilha de faturamento.';
comment on column public.leads.pax                is 'Número de pessoas no evento.';
comment on column public.leads.operational_status is 'a_confirmar = negociação | confirmado = fechado, ainda vai acontecer | realizado = já aconteceu.';


-- -----------------------------------------------------------------------------
-- Novas receitas: equipamentos/extras e estacionamento
-- -----------------------------------------------------------------------------
alter table public.leads add column if not exists has_equipment   boolean not null default false;
alter table public.leads add column if not exists equipment_value numeric(12, 2) not null default 0;
alter table public.leads add column if not exists has_parking     boolean not null default false;
alter table public.leads add column if not exists parking_value   numeric(12, 2) not null default 0;

alter table public.leads drop constraint if exists leads_equipment_value_non_negative;
alter table public.leads add  constraint leads_equipment_value_non_negative check (equipment_value >= 0);
alter table public.leads drop constraint if exists leads_parking_value_non_negative;
alter table public.leads add  constraint leads_parking_value_non_negative check (parking_value >= 0);

comment on column public.leads.equipment_value is 'Valor de Equipamentos / Extras (0 quando has_equipment = false).';
comment on column public.leads.parking_value   is 'Valor de Estacionamento (0 quando has_parking = false).';


-- -----------------------------------------------------------------------------
-- Receita Bruta (total_value) e Receita Líquida do Hotel (net_value)
-- Colunas geradas não aceitam mudar a fórmula: são recriadas (os valores vêm das colunas de origem).
-- A view de resumo de clientes usa total_value e é recriada logo abaixo.
-- -----------------------------------------------------------------------------
drop view if exists public.client_summaries;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'leads' and column_name = 'total_value'
      and generation_expression ilike '%parking_value%'
  ) then
    alter table public.leads drop column if exists total_value;
    alter table public.leads add column total_value numeric(14, 2)
      generated always as (coalesce(proposed_value, 0) + ab_value + lodging_value + equipment_value + parking_value) stored;
  end if;
end;
$$;

alter table public.leads add column if not exists net_value numeric(14, 2)
  generated always as (
    round(
      coalesce(proposed_value, 0) * 1.00
      + lodging_value * 1.00
      + parking_value * 0.50
      + equipment_value * 0.15
      + ab_value * 0.06,
      2
    )
  ) stored;

comment on column public.leads.total_value is 'Receita Bruta (100%): locação + A&B + hospedagem + equipamentos + estacionamento (gerada).';
comment on column public.leads.net_value   is 'Receita Líquida do Hotel: 100% locação e hospedagem, 50% estacionamento, 15% equipamentos, 6% A&B (gerada).';


-- -----------------------------------------------------------------------------
-- Controle financeiro e pós-evento
-- -----------------------------------------------------------------------------
alter table public.leads add column if not exists nf_rental      text;
alter table public.leads add column if not exists nf_ab          text;
alter table public.leads add column if not exists nf_parking     text;
alter table public.leads add column if not exists payment_status text not null default 'pendente';
alter table public.leads add column if not exists survey_status  text not null default 'nao_enviada';

alter table public.leads drop constraint if exists leads_payment_status_check;
alter table public.leads add  constraint leads_payment_status_check check (payment_status in ('pendente', 'pago', 'parcial'));
alter table public.leads drop constraint if exists leads_survey_status_check;
alter table public.leads add  constraint leads_survey_status_check check (survey_status in ('nao_enviada', 'enviada', 'respondida'));

comment on column public.leads.nf_rental  is 'Nº da nota fiscal de locação.';
comment on column public.leads.nf_ab      is 'Nº da nota fiscal de A&B.';
comment on column public.leads.nf_parking is 'Nº da nota fiscal de estacionamento.';

-- Tamanho máximo dos textos, agora com os campos novos
alter table public.leads drop constraint if exists leads_text_lengths;
alter table public.leads add  constraint leads_text_lengths check (
  length(contact_name) <= 150
  and (contact_phone is null or length(contact_phone) <= 30)
  and (contact_email is null or length(contact_email) <= 254)
  and (company is null or length(company) <= 150)
  and (origin is null or length(origin) <= 100)
  and (room_interest is null or length(room_interest) <= 2000)
  and cardinality(room_interests) <= 30
  and (date_notes is null or length(date_notes) <= 200)
  and (proposal_number is null or length(proposal_number) <= 50)
  and (loss_reason is null or length(loss_reason) <= 200)
  and (loss_reason_details is null or length(loss_reason_details) <= 2000)
  and (event_name is null or length(event_name) <= 200)
  and (nf_rental is null or length(nf_rental) <= 50)
  and (nf_ab is null or length(nf_ab) <= 50)
  and (nf_parking is null or length(nf_parking) <= 50)
) not valid;

create index if not exists leads_event_date_status_idx on public.leads (event_date, status);


-- -----------------------------------------------------------------------------
-- Situação operacional x funil
-- - Fechou e estava "à confirmar": confirmado (evento futuro) ou realizado (já passou)
-- - Marcou confirmado/realizado numa proposta em aberto: a proposta fecha
-- - Voltou para "à confirmar" uma proposta fechada (ou reabriu no funil): volta para em aberto
-- -----------------------------------------------------------------------------
create or replace function public.sync_operational_status()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_last_day date := coalesce(new.event_end_date, new.event_date);
  v_status_changed boolean := tg_op = 'INSERT' or new.status is distinct from old.status;
  v_operational_changed boolean := tg_op = 'UPDATE' and new.operational_status is distinct from old.operational_status;
begin
  if v_operational_changed and not v_status_changed then
    if new.operational_status in ('confirmado', 'realizado') and new.status = 'em_aberto' then
      new.status := 'fechado';
      new.proposal_sent := true;
    elsif new.operational_status = 'a_confirmar' and new.status = 'fechado' then
      new.status := 'em_aberto';
    end if;
  elsif v_status_changed and new.status = 'em_aberto' and tg_op = 'UPDATE' and old.status = 'fechado' then
    new.operational_status := 'a_confirmar';
  end if;

  if new.status = 'fechado' and new.operational_status = 'a_confirmar' then
    new.operational_status := case when v_last_day is not null and v_last_day < current_date then 'realizado' else 'confirmado' end;
  end if;

  return new;
end;
$$;

revoke execute on function public.sync_operational_status() from public, anon, authenticated;

drop trigger if exists leads_sync_operational_status on public.leads;
create trigger leads_sync_operational_status
  before insert or update of status, operational_status, event_date, event_end_date on public.leads
  for each row execute function public.sync_operational_status();

-- Propostas fechadas que já existem ganham a situação operacional (sem mexer na data de atualização)
alter table public.leads disable trigger leads_set_updated_at;
update public.leads
   set operational_status = case
         when coalesce(event_end_date, event_date) is not null and coalesce(event_end_date, event_date) < current_date then 'realizado'
         else 'confirmado'
       end
 where status = 'fechado' and operational_status = 'a_confirmar';
alter table public.leads enable trigger leads_set_updated_at;


-- -----------------------------------------------------------------------------
-- Resumo de clientes (recriado: depende de total_value)
-- -----------------------------------------------------------------------------
drop view if exists public.client_summaries;

create view public.client_summaries
with (security_invoker = true)
as
select
  c.id,
  c.name,
  c.client_type,
  c.email_domain,
  c.notes,
  c.created_at,
  c.updated_at,
  c.cnpj,
  c.cnpj_digits,
  c.branch_label,
  coalesce(s.proposals_count, 0)  as proposals_count,
  coalesce(s.closed_count, 0)     as closed_count,
  coalesce(s.open_count, 0)       as open_count,
  coalesce(s.lost_count, 0)       as lost_count,
  coalesce(s.closed_revenue, 0)   as closed_revenue,
  coalesce(s.open_revenue, 0)     as open_revenue,
  s.last_proposal_at,
  coalesce(k.contacts_count, 0)   as contacts_count,
  pc.id                           as primary_contact_id,
  pc.name                         as primary_contact_name,
  pc.phone                        as primary_contact_phone,
  pc.email                        as primary_contact_email,
  exists (
    select 1
    from public.marketing_suppressions ms
    where (ms.kind = 'email' and ms.value = public.normalize_contact_email(pc.email))
       or (ms.kind = 'phone' and ms.value = public.normalize_contact_phone(pc.phone))
  )                               as primary_contact_opt_out,
  lower(concat_ws(' ', c.name, c.branch_label, c.cnpj, c.cnpj_digits, c.email_domain, k.search_text)) as search_text
from public.clients c
left join lateral (
  select
    count(*)::integer                                            as proposals_count,
    (count(*) filter (where l.status = 'fechado'))::integer     as closed_count,
    (count(*) filter (where l.status = 'em_aberto'))::integer   as open_count,
    (count(*) filter (where l.status = 'perdido'))::integer     as lost_count,
    sum(l.total_value) filter (where l.status = 'fechado')      as closed_revenue,
    sum(l.total_value) filter (where l.status = 'em_aberto')    as open_revenue,
    max(l.created_at)                                            as last_proposal_at
  from public.leads l
  where l.client_id = c.id
) s on true
left join lateral (
  select
    count(*)::integer as contacts_count,
    string_agg(concat_ws(' ', ct.name, ct.email, ct.phone, ct.phone_digits), ' ') as search_text
  from public.client_contacts ct
  where ct.client_id = c.id
) k on true
left join lateral (
  -- Contato principal; sem principal marcado, o contato ativo mais antigo
  select ct.id, ct.name, ct.phone, ct.email
  from public.client_contacts ct
  where ct.client_id = c.id
  order by ct.is_primary desc, ct.active desc, ct.created_at
  limit 1
) pc on true;

comment on view public.client_summaries is 'Uma linha por cliente com o resumo do histórico de propostas (tela Consultar Leads).';

revoke all on public.client_summaries from anon;
grant select on public.client_summaries to authenticated;

-- <<< faturamento-eventos (fim do bloco)

commit;
