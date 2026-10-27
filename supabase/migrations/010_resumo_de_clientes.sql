-- =============================================================================
-- Migração 010: resumo de clientes para a tela "Consultar Leads"
-- - View public.client_summaries: uma linha por cliente (empresa ou pessoa física) com
--   quantidade de propostas, fechadas, em aberto, receita fechada e em aberto, último
--   contato, contato principal e um texto de busca (nome, contatos, e-mails e telefones)
-- - security_invoker: a view respeita as políticas de RLS de quem consulta
-- Requer a migração 009. Idempotente (pode rodar de novo).
-- =============================================================================
begin;

-- >>> resumo-clientes (início do bloco também usado em schema.sql)

-- Recriada do zero: create or replace não aceita mudar a lista de colunas
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
  lower(concat_ws(' ', c.name, c.email_domain, k.search_text)) as search_text
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

-- <<< resumo-clientes (fim do bloco)

commit;
