-- =============================================================================
-- Migração 011: CNPJ das empresas e braços (matriz, filiais, franquias)
-- - clients.cnpj / leads.cnpj (com máscara) e cnpj_digits (gerada, só dígitos)
-- - Cada CNPJ é um cadastro único em clients (vários clientes podem ficar sem CNPJ)
-- - clients.branch_label: identifica o braço ("Matriz", "Filial Novo Hamburgo")
-- - O trigger das propostas usa o CNPJ: CNPJ já cadastrado leva a proposta para aquele braço;
--   CNPJ novo numa empresa que já tem outro CNPJ cria um braço novo com o mesmo nome
-- - CNPJ informado na empresa passa para as propostas dela que estavam sem CNPJ
-- - View client_summaries passa a trazer o CNPJ e a buscar por ele
-- Requer as migrações 009 e 010. Idempotente (pode rodar de novo).
-- =============================================================================
begin;

-- CNPJ preenchido depois (vindo da empresa) não conta como alteração do orçamento
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'marketing_opt_out' - 'updated_at' - 'contact_phone_digits' - 'total_value' - 'event_last_date' - 'client_id' - 'contact_id' - 'cnpj' - 'cnpj_digits')
       = (to_jsonb(old) - 'marketing_opt_out' - 'updated_at' - 'contact_phone_digits' - 'total_value' - 'event_last_date' - 'client_id' - 'contact_id' - 'cnpj' - 'cnpj_digits') then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- >>> cnpj-bracos (início do bloco também usado em schema.sql)

-- -----------------------------------------------------------------------------
-- CNPJ: só os 14 dígitos (nulo quando incompleto) e a máscara 00.000.000/0000-00
-- -----------------------------------------------------------------------------
create or replace function public.normalize_cnpj(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when length(d) = 14 then d else null end
  from (select regexp_replace(coalesce(value, ''), '\D', '', 'g') as d) as digits
$$;

create or replace function public.format_cnpj(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when d is null then null
           else substr(d, 1, 2) || '.' || substr(d, 3, 3) || '.' || substr(d, 6, 3) || '/' || substr(d, 9, 4) || '-' || substr(d, 13, 2)
         end
  from (select public.normalize_cnpj(value) as d) as digits
$$;

revoke execute on function public.normalize_cnpj(text) from public, anon;
revoke execute on function public.format_cnpj(text) from public, anon;
grant execute on function public.normalize_cnpj(text) to authenticated;
grant execute on function public.format_cnpj(text) to authenticated;


-- -----------------------------------------------------------------------------
-- Colunas
-- -----------------------------------------------------------------------------
alter table public.clients add column if not exists cnpj text;
alter table public.clients add column if not exists cnpj_digits text
  generated always as (nullif(regexp_replace(coalesce(cnpj, ''), '\D', '', 'g'), '')) stored;
alter table public.clients add column if not exists branch_label text;

alter table public.clients drop constraint if exists clients_cnpj_digits_length;
alter table public.clients add  constraint clients_cnpj_digits_length
  check (cnpj_digits is null or length(cnpj_digits) = 14);
alter table public.clients drop constraint if exists clients_branch_label_length;
alter table public.clients add  constraint clients_branch_label_length
  check (branch_label is null or length(branch_label) <= 80);

create unique index if not exists clients_cnpj_digits_key on public.clients (cnpj_digits) where cnpj_digits is not null;

comment on column public.clients.cnpj         is 'CNPJ do braço da empresa (00.000.000/0000-00). Cada CNPJ é um cadastro único.';
comment on column public.clients.cnpj_digits  is 'Gerada a partir de cnpj (somente dígitos), usada na busca.';
comment on column public.clients.branch_label is 'Identifica o braço quando a marca tem mais de um CNPJ, ex.: Matriz, Filial Novo Hamburgo.';

alter table public.leads add column if not exists cnpj text;
alter table public.leads add column if not exists cnpj_digits text
  generated always as (nullif(regexp_replace(coalesce(cnpj, ''), '\D', '', 'g'), '')) stored;

alter table public.leads drop constraint if exists leads_cnpj_digits_length;
alter table public.leads add  constraint leads_cnpj_digits_length
  check (cnpj_digits is null or length(cnpj_digits) = 14);

create index if not exists leads_cnpj_digits_idx on public.leads (cnpj_digits) where cnpj_digits is not null;

comment on column public.leads.cnpj        is 'CNPJ da empresa nesta proposta (pode faltar em sondagens).';
comment on column public.leads.cnpj_digits is 'Gerada a partir de cnpj (somente dígitos), usada na busca.';


-- -----------------------------------------------------------------------------
-- Trigger das propostas, agora com CNPJ (substitui a versão da migração 009)
-- -----------------------------------------------------------------------------
create or replace function public.link_lead_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company text := nullif(trim(regexp_replace(coalesce(new.company, ''), '\s+', ' ', 'g')), '');
  v_domain  text := public.corporate_email_domain(new.contact_email);
  v_cnpj    text := public.normalize_cnpj(new.cnpj);
  v_owner   uuid;
  v_client_cnpj text;
  v_learned boolean := false;
  v_contact_client uuid;
begin
  -- CNPJ identifica o braço da empresa
  if v_cnpj is not null
     and (tg_op = 'INSERT' or new.cnpj is distinct from old.cnpj or new.client_id is distinct from old.client_id) then
    select c.id into v_owner from public.clients c where c.cnpj_digits = v_cnpj;

    if v_owner is not null then
      new.client_id := v_owner;
    elsif new.client_id is not null then
      select c.cnpj_digits into v_client_cnpj from public.clients c where c.id = new.client_id;
      if v_client_cnpj is null then
        -- Cliente ainda sem CNPJ: passa a ter este
        update public.clients c
           set cnpj = public.format_cnpj(v_cnpj), client_type = 'company'
         where c.id = new.client_id;
        v_learned := true;
      else
        -- Outro CNPJ da mesma marca: braço novo, com o mesmo nome
        insert into public.clients (name, client_type, email_domain, cnpj)
        select c.name, 'company', c.email_domain, public.format_cnpj(v_cnpj)
        from public.clients c
        where c.id = new.client_id
        returning id into new.client_id;
      end if;
    elsif (select auth.uid()) is null then
      -- SQL Editor/importação: adota a empresa de mesmo nome que ainda não tem CNPJ
      select c.id into new.client_id
      from public.clients c
      where c.client_type = 'company'
        and c.cnpj_digits is null
        and lower(trim(c.name)) = lower(coalesce(v_company, trim(new.contact_name)))
      order by c.created_at
      limit 1;

      if new.client_id is not null then
        update public.clients c set cnpj = public.format_cnpj(v_cnpj) where c.id = new.client_id;
        v_learned := true;
      else
        insert into public.clients (name, client_type, email_domain, cnpj)
        values (coalesce(v_company, trim(new.contact_name)), 'company', v_domain, public.format_cnpj(v_cnpj))
        returning id into new.client_id;
      end if;
    else
      insert into public.clients (name, client_type, email_domain, cnpj)
      values (coalesce(v_company, trim(new.contact_name)), 'company', v_domain, public.format_cnpj(v_cnpj))
      returning id into new.client_id;
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.client_id is null then
      if (select auth.uid()) is null then
        new.client_id := public.find_or_create_client(new.company, new.contact_name, new.contact_phone, new.contact_email);
      else
        insert into public.clients (name, client_type, email_domain)
        values (
          coalesce(v_company, trim(new.contact_name)),
          case when v_company is null then 'individual' else 'company' end,
          case when v_company is null then null else v_domain end
        )
        returning id into new.client_id;
      end if;
      new.contact_id := null;
    end if;
  else
    -- Proposta sem cliente (ex.: o cliente foi excluído) continua sem cliente
    if new.client_id is null then
      return new;
    end if;

    if new.client_id is not distinct from old.client_id
       and new.contact_id is not distinct from old.contact_id
       and new.contact_name is not distinct from old.contact_name
       and new.contact_phone is not distinct from old.contact_phone
       and new.contact_email is not distinct from old.contact_email
       and new.company is not distinct from old.company
       and new.cnpj is not distinct from old.cnpj then
      return new;
    end if;

    if new.client_id = old.client_id then
      -- Cliente que só tem esta proposta acompanha a correção de empresa/nome
      if new.company is distinct from old.company or new.contact_name is distinct from old.contact_name then
        update public.clients c
           set name = coalesce(v_company, trim(new.contact_name)),
               client_type = case when v_company is null and c.cnpj_digits is null then 'individual' else 'company' end,
               email_domain = case when v_company is null then null else coalesce(c.email_domain, v_domain) end
         where c.id = new.client_id
           and not exists (select 1 from public.leads l where l.client_id = new.client_id and l.id <> new.id)
           and c.name is distinct from coalesce(v_company, trim(new.contact_name));
      end if;

      -- Contato que só aparece nesta proposta: corrige o próprio cadastro da pessoa
      if new.contact_id is not null and new.contact_id = old.contact_id
         and (new.contact_name, new.contact_phone, new.contact_email)
             is distinct from (old.contact_name, old.contact_phone, old.contact_email)
         and not exists (select 1 from public.leads l where l.contact_id = new.contact_id and l.id <> new.id) then
        update public.client_contacts c
           set name = trim(new.contact_name),
               phone = nullif(trim(coalesce(new.contact_phone, '')), ''),
               email = public.normalize_contact_email(new.contact_email)
         where c.id = new.contact_id;
      end if;
    end if;

    -- Dados do contato mudaram numa proposta que divide o contato com outras: localiza de novo
    if new.contact_id is not distinct from old.contact_id
       and (new.contact_name, new.contact_phone, new.contact_email)
           is distinct from (old.contact_name, old.contact_phone, old.contact_email)
       and exists (select 1 from public.leads l where l.contact_id = new.contact_id and l.id <> new.id) then
      new.contact_id := null;
    end if;
  end if;

  -- O contato escolhido precisa ser do mesmo cliente
  if new.contact_id is not null then
    select c.client_id into v_contact_client from public.client_contacts c where c.id = new.contact_id;
    if v_contact_client is distinct from new.client_id then
      new.contact_id := null;
    end if;
  end if;

  if new.contact_id is not null then
    update public.client_contacts c
       set phone = coalesce(c.phone, nullif(trim(coalesce(new.contact_phone, '')), '')),
           email = coalesce(c.email, public.normalize_contact_email(new.contact_email)),
           active = true
     where c.id = new.contact_id;
  else
    new.contact_id := public.find_or_create_client_contact(new.client_id, new.contact_name, new.contact_phone, new.contact_email);
  end if;

  -- Empresa sem domínio registrado aprende o domínio corporativo do contato
  if v_domain is not null then
    update public.clients c
       set email_domain = v_domain
     where c.id = new.client_id and c.client_type = 'company' and c.email_domain is null;
  end if;

  -- Proposta sem CNPJ usa o CNPJ do cliente; CNPJ incompleto fica como está e a constraint recusa
  if nullif(trim(coalesce(new.cnpj, '')), '') is null then
    select c.cnpj into new.cnpj from public.clients c where c.id = new.client_id;
  elsif v_cnpj is not null then
    new.cnpj := public.format_cnpj(v_cnpj);
  end if;

  -- Cliente acabou de ganhar CNPJ: as outras propostas dele que estavam sem CNPJ recebem também
  if v_learned then
    update public.leads l
       set cnpj = new.cnpj
     where l.client_id = new.client_id and l.id <> new.id and l.cnpj is null;
  end if;

  return new;
end;
$$;

revoke execute on function public.link_lead_client() from public, anon, authenticated;

drop trigger if exists leads_link_client on public.leads;
create trigger leads_link_client
  before insert or update of client_id, contact_id, contact_name, contact_phone, contact_email, company, cnpj on public.leads
  for each row execute function public.link_lead_client();


-- -----------------------------------------------------------------------------
-- CNPJ informado (ou corrigido) na página da empresa vale para as propostas dela
-- -----------------------------------------------------------------------------
create or replace function public.sync_client_cnpj()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Mudança feita pelo próprio trigger das propostas já cuida das propostas
  if pg_trigger_depth() > 1 or new.cnpj_digits is not distinct from old.cnpj_digits then
    return null;
  end if;

  update public.leads l
     set cnpj = new.cnpj
   where l.client_id = new.id
     and (l.cnpj_digits is null or l.cnpj_digits is not distinct from old.cnpj_digits);
  return null;
end;
$$;

revoke execute on function public.sync_client_cnpj() from public, anon, authenticated;

drop trigger if exists clients_sync_cnpj on public.clients;
create trigger clients_sync_cnpj
  after update of cnpj on public.clients
  for each row execute function public.sync_client_cnpj();


-- -----------------------------------------------------------------------------
-- Resumo de clientes com CNPJ e braço (recriada: a lista de colunas mudou)
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

-- <<< cnpj-bracos (fim do bloco)

commit;
