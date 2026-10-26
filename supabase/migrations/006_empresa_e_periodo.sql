-- =============================================================================
-- Migração 006: empresa do cliente e evento com mais de um dia
-- - company: empresa do contato (vazio = pessoa física)
-- - event_end_date: último dia do evento quando ele dura mais de um dia
-- - event_last_date: coluna calculada (último dia efetivo), usada no filtro por período
-- Segura para rodar com dados existentes e idempotente (pode rodar de novo).
-- =============================================================================
begin;

-- Mudança só no opt-out continua sem contar como atualização (inclui a nova coluna calculada)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'marketing_opt_out' - 'updated_at' - 'contact_phone_digits' - 'total_value' - 'event_last_date')
       = (to_jsonb(old) - 'marketing_opt_out' - 'updated_at' - 'contact_phone_digits' - 'total_value' - 'event_last_date') then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- >>> empresa-periodo (início do bloco também usado em schema.sql)

-- Empresa do contato (nulo = pessoa física)
alter table public.leads add column if not exists company text;

alter table public.leads drop constraint if exists leads_company_not_blank;
alter table public.leads add  constraint leads_company_not_blank
  check (company is null or length(trim(company)) > 0);

comment on column public.leads.company is 'Empresa do contato; nulo quando é pessoa física.';

create index if not exists leads_company_idx on public.leads (company);

-- Evento com mais de um dia: event_date é o primeiro dia e event_end_date o último
alter table public.leads add column if not exists event_end_date date;

alter table public.leads drop constraint if exists leads_event_period_valid;
alter table public.leads add  constraint leads_event_period_valid
  check (event_end_date is null or (event_date is not null and event_end_date >= event_date));

comment on column public.leads.event_date     is 'Primeiro (ou único) dia do evento. Nulo quando o cliente ainda não definiu a data.';
comment on column public.leads.event_end_date is 'Último dia quando o evento dura mais de um dia; nulo para evento de um dia.';

-- Último dia efetivo do evento (calculado), para filtrar eventos que caem dentro de um período
alter table public.leads add column if not exists event_last_date date
  generated always as (coalesce(event_end_date, event_date)) stored;

comment on column public.leads.event_last_date is 'Último dia efetivo do evento: event_end_date ou event_date (gerada).';

create index if not exists leads_event_last_date_idx on public.leads (event_last_date);

-- <<< empresa-periodo (fim do bloco)

commit;
