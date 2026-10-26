-- =============================================================================
-- Migração 003: opt-out de comunicações/mailing (LGPD)
-- Segura para rodar com dados existentes e idempotente (pode rodar de novo).
-- =============================================================================
alter table public.leads
  add column if not exists marketing_opt_out boolean not null default false;

comment on column public.leads.marketing_opt_out is
  'Cliente pediu para não receber comunicações/mailing (LGPD). Excluído da exportação de mailing.';
