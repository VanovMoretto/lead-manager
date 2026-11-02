-- =============================================================================
-- Migração 016: cerimonialistas e responsável pela proposta
-- - Novo tipo de cliente "Cerimonialista" e o meio de prospecção "Cerimonialista"
-- - leads.ceremonialist_id: quem indicou a proposta; create_ceremonialist cria o cadastro e o contato
-- - client_summaries: a cerimonialista conta também as propostas que indicou
-- - admin_set_lead_owner: só o ADMIN troca o responsável (leads.user_id)
-- - list_user_logins: login de cada usuário para a coluna Responsável
-- Idempotente (pode rodar de novo). Rode depois da 015.
-- =============================================================================
begin;

-- >>> cerimonialistas-e-responsavel (início do bloco também usado em schema.sql)

-- -----------------------------------------------------------------------------
-- Cerimonialistas: um tipo de cliente. Festa social de pessoa física indicada por
-- cerimonialista entra no histórico dela; com empresa, fica na empresa e a indicação
-- aparece no painel da cerimonialista (leads.ceremonialist_id).
-- -----------------------------------------------------------------------------
alter table public.clients drop constraint if exists clients_client_type_check;
alter table public.clients
  add constraint clients_client_type_check check (client_type in ('company', 'individual', 'ceremonialist'));

create unique index if not exists clients_ceremonialist_name_key
  on public.clients (lower(trim(name)))
  where client_type = 'ceremonialist';

alter table public.leads
  add column if not exists ceremonialist_id uuid references public.clients (id) on delete set null;

create index if not exists leads_ceremonialist_id_idx
  on public.leads (ceremonialist_id)
  where ceremonialist_id is not null;

comment on column public.leads.ceremonialist_id is 'Cerimonialista que indicou a proposta (meio de prospecção "Cerimonialista").';

create or replace function public.check_lead_ceremonialist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ceremonialist_id is not null
     and not exists (
       select 1 from public.clients c where c.id = new.ceremonialist_id and c.client_type = 'ceremonialist'
     ) then
    raise exception 'invalid_ceremonialist' using errcode = '23503';
  end if;
  return new;
end;
$$;

revoke execute on function public.check_lead_ceremonialist() from public, anon, authenticated;

drop trigger if exists leads_check_ceremonialist on public.leads;
create trigger leads_check_ceremonialist
  before insert or update of ceremonialist_id on public.leads
  for each row execute function public.check_lead_ceremonialist();

-- Cadastro da cerimonialista com o contato dela, numa operação só
create or replace function public.create_ceremonialist(p_name text, p_phone text default null, p_email text default null)
returns public.clients
language plpgsql
set search_path = ''
as $$
declare
  v_name   text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_client public.clients;
begin
  if not public.is_active_user() then
    raise exception 'inactive_user' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'empty_name' using errcode = '23514';
  end if;

  -- Nome repetido: unique_violation (23505) pelo índice clients_ceremonialist_name_key
  insert into public.clients (name, client_type)
  values (v_name, 'ceremonialist')
  returning * into v_client;

  insert into public.client_contacts (client_id, name, phone, email, is_primary)
  values (
    v_client.id,
    v_name,
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(lower(trim(coalesce(p_email, ''))), ''),
    true
  );

  return v_client;
end;
$$;

revoke execute on function public.create_ceremonialist(text, text, text) from public, anon;
grant execute on function public.create_ceremonialist(text, text, text) to authenticated;

insert into public.app_settings_options (category, label)
values ('origin', 'Cerimonialista')
on conflict (category, label) do nothing;

-- Resumo de clientes: a cerimonialista conta as propostas que indicou
create or replace view public.client_summaries
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
  -- Cerimonialista: conta também as propostas que ela indicou para outros clientes
  where l.client_id = c.id or l.ceremonialist_id = c.id
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

-- -----------------------------------------------------------------------------
-- Responsável pela proposta: quem cadastrou (leads.user_id). Só o ADMIN troca.
-- -----------------------------------------------------------------------------
create or replace function public.keep_lead_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and new.user_id is distinct from old.user_id
     and coalesce(current_setting('app.allow_author_change', true), '') <> 'on' then
    new.user_id := old.user_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.keep_lead_author() from public, anon, authenticated;

create or replace function public.admin_set_lead_owner(p_lead_id uuid, p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.user_profiles p where p.user_id = p_user_id) then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;

  -- Trocar o responsável não conta como alteração do orçamento
  perform set_config('app.allow_author_change', 'on', true);
  perform set_config('app.skip_updated_at', 'on', true);
  update public.leads l set user_id = p_user_id where l.id = p_lead_id;
  if not found then
    raise exception 'lead_not_found' using errcode = 'P0002';
  end if;
  perform set_config('app.allow_author_change', 'off', true);
  perform set_config('app.skip_updated_at', 'off', true);
  return p_user_id;
end;
$$;

revoke execute on function public.admin_set_lead_owner(uuid, uuid) from public, anon;
grant execute on function public.admin_set_lead_owner(uuid, uuid) to authenticated;

-- Login (e-mail sem o domínio) de cada usuário, para a coluna Responsável
create or replace function public.list_user_logins()
returns table (user_id uuid, login text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, split_part(coalesce(p.email, ''), '@', 1) as login, p.is_active
  from public.user_profiles p
  where public.is_active_user()
  order by 2
$$;

revoke execute on function public.list_user_logins() from public, anon;
grant execute on function public.list_user_logins() to authenticated;

comment on column public.leads.user_id is 'Responsável pela proposta: quem cadastrou. Fixo nas edições; só o ADMIN troca (admin_set_lead_owner).';

-- <<< cerimonialistas-e-responsavel (fim do bloco)

commit;
