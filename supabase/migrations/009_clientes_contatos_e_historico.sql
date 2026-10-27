-- =============================================================================
-- Migração 009: clientes (empresa ou pessoa física) e pessoas de contato
-- - public.clients: o cliente consolidado, com o histórico de todas as propostas
-- - public.client_contacts: as pessoas que já falaram em nome do cliente
-- - leads.client_id / leads.contact_id: cada proposta aponta para o cliente e o contato
-- - Trigger em leads: proposta nova sem cliente escolhido ganha um cadastro próprio, e o
--   contato é localizado (ou criado) dentro do cliente automaticamente
-- - Os leads que já existem são agrupados: por empresa (sem diferenciar maiúsculas) ou,
--   para pessoa física, pelo mesmo telefone ou e-mail
-- Segura para rodar com dados existentes e idempotente (pode rodar de novo).
-- =============================================================================
begin;

-- Vincular uma proposta a um cliente não conta como alteração do orçamento
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'marketing_opt_out' - 'updated_at' - 'contact_phone_digits' - 'total_value' - 'event_last_date' - 'client_id' - 'contact_id')
       = (to_jsonb(old) - 'marketing_opt_out' - 'updated_at' - 'contact_phone_digits' - 'total_value' - 'event_last_date' - 'client_id' - 'contact_id') then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- >>> clientes-contatos (início do bloco também usado em schema.sql)

-- -----------------------------------------------------------------------------
-- Domínio corporativo do e-mail ("fernanda@cremolatto.com.br" -> "cremolatto.com.br").
-- Provedores públicos (gmail, hotmail, outlook, yahoo...) não identificam empresa: nulo.
-- A mesma lista está em src/lib/clientIdentity.ts.
-- -----------------------------------------------------------------------------
create or replace function public.corporate_email_domain(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when d is null or d !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' then null
           when d ~ '^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|bol|uol|terra|globo|globomail|ig|aol|protonmail|proton|gmx|yandex|zoho)\.[a-z]{2,3}(\.[a-z]{2})?$' then null
           else d
         end
  from (select nullif(lower(trim(split_part(coalesce(value, ''), '@', 2))), '') as d) as parts
$$;

revoke execute on function public.corporate_email_domain(text) from public, anon;
grant execute on function public.corporate_email_domain(text) to authenticated;


-- -----------------------------------------------------------------------------
-- Tabela: clients
-- -----------------------------------------------------------------------------
create table if not exists public.clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null
                constraint clients_name_not_blank check (length(trim(name)) > 0),
  client_type   text not null default 'individual'
                constraint clients_client_type_check check (client_type in ('company', 'individual')),
  email_domain  text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint clients_text_lengths check (
    length(name) <= 150
    and (email_domain is null or length(email_domain) <= 253)
    and (notes is null or length(notes) <= 5000)
  )
);

comment on table  public.clients              is 'Cliente consolidado (empresa ou pessoa física), com o histórico de propostas em leads.client_id.';
comment on column public.clients.client_type  is 'company = Empresa | individual = Pessoa física';
comment on column public.clients.email_domain is 'Domínio de e-mail corporativo da empresa (nulo para provedores públicos).';
comment on column public.clients.notes        is 'Observações gerais sobre o cliente.';

create index if not exists clients_name_lower_idx   on public.clients (lower(name));
create index if not exists clients_email_domain_idx on public.clients (email_domain) where email_domain is not null;

drop trigger if exists clients_set_updated_at on public.clients;
create trigger clients_set_updated_at
  before update on public.clients
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- Tabela: client_contacts
-- -----------------------------------------------------------------------------
create table if not exists public.client_contacts (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  name          text not null
                constraint client_contacts_name_not_blank check (length(trim(name)) > 0),
  role          text,
  phone         text,
  phone_digits  text generated always as (nullif(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), '')) stored,
  email         text,
  is_primary    boolean not null default false,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),

  constraint client_contacts_text_lengths check (
    length(name) <= 150
    and (role is null or length(role) <= 100)
    and (phone is null or length(phone) <= 30)
    and (email is null or length(email) <= 254)
  )
);

comment on table  public.client_contacts            is 'Pessoas de contato de um cliente (em uma empresa, o contato pode mudar com o tempo).';
comment on column public.client_contacts.role       is 'Cargo ou setor, ex.: Marketing, RH, Diretoria.';
comment on column public.client_contacts.is_primary is 'Contato principal do cliente (no máximo um por cliente).';
comment on column public.client_contacts.active     is 'Contato que saiu da empresa fica inativo, mas continua no histórico.';

create index if not exists client_contacts_client_id_idx    on public.client_contacts (client_id);
create index if not exists client_contacts_phone_digits_idx on public.client_contacts (phone_digits);
create index if not exists client_contacts_email_normalized_idx on public.client_contacts (public.normalize_contact_email(email));
create unique index if not exists client_contacts_one_primary_idx on public.client_contacts (client_id) where is_primary;


-- -----------------------------------------------------------------------------
-- Propostas ligadas ao cliente e ao contato
-- -----------------------------------------------------------------------------
alter table public.leads add column if not exists client_id  uuid references public.clients (id) on delete set null;
alter table public.leads add column if not exists contact_id uuid references public.client_contacts (id) on delete set null;

comment on column public.leads.client_id  is 'Cliente (empresa ou pessoa física) dono do histórico desta proposta.';
comment on column public.leads.contact_id is 'Pessoa do cliente que pediu esta proposta.';

create index if not exists leads_client_id_idx  on public.leads (client_id);
create index if not exists leads_contact_id_idx on public.leads (contact_id);


-- -----------------------------------------------------------------------------
-- Localiza a pessoa dentro do cliente ou cadastra uma nova.
-- Mesmo e-mail = mesma pessoa. Telefone sozinho não basta (o fixo da empresa é de todos):
-- precisa do mesmo nome. Só o nome vale quando nenhum outro dado conflita.
-- -----------------------------------------------------------------------------
create or replace function public.find_or_create_client_contact(
  p_client_id uuid,
  p_name      text,
  p_phone     text,
  p_email     text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_name  text := nullif(trim(coalesce(p_name, '')), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_email text := public.normalize_contact_email(p_email);
  v_phone_key text := public.normalize_contact_phone(p_phone);
  v_id uuid;
begin
  if p_client_id is null or v_name is null then
    return null;
  end if;

  if v_email is not null then
    select c.id into v_id
    from public.client_contacts c
    where c.client_id = p_client_id and public.normalize_contact_email(c.email) = v_email
    order by c.active desc, c.created_at
    limit 1;
  end if;

  if v_id is null and v_phone_key is not null then
    select c.id into v_id
    from public.client_contacts c
    where c.client_id = p_client_id
      and public.normalize_contact_phone(c.phone) = v_phone_key
      and lower(trim(c.name)) = lower(v_name)
    order by c.active desc, c.created_at
    limit 1;
  end if;

  if v_id is null then
    select c.id into v_id
    from public.client_contacts c
    where c.client_id = p_client_id
      and lower(trim(c.name)) = lower(v_name)
      and (v_email is null or c.email is null)
      and (v_phone_key is null or c.phone is null or public.normalize_contact_phone(c.phone) = v_phone_key)
    order by c.active desc, c.created_at
    limit 1;
  end if;

  if v_id is not null then
    -- Completa o que faltava no cadastro da pessoa
    update public.client_contacts c
       set phone = coalesce(c.phone, v_phone),
           email = coalesce(c.email, v_email),
           active = true
     where c.id = v_id;
    return v_id;
  end if;

  insert into public.client_contacts (client_id, name, phone, email, is_primary)
  values (
    p_client_id,
    v_name,
    v_phone,
    v_email,
    not exists (select 1 from public.client_contacts c where c.client_id = p_client_id and c.is_primary)
  )
  returning id into v_id;
  return v_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- Agrupamento automático: empresa pelo nome (sem diferenciar maiúsculas);
-- pessoa física pelo mesmo telefone ou e-mail. Cria o cliente quando não encontra.
-- -----------------------------------------------------------------------------
create or replace function public.find_or_create_client(
  p_company text,
  p_name    text,
  p_phone   text,
  p_email   text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_company text := nullif(trim(regexp_replace(coalesce(p_company, ''), '\s+', ' ', 'g')), '');
  v_email   text := public.normalize_contact_email(p_email);
  v_phone   text := public.normalize_contact_phone(p_phone);
  v_id uuid;
begin
  if v_company is not null then
    select c.id into v_id
    from public.clients c
    where c.client_type = 'company' and lower(trim(c.name)) = lower(v_company)
    order by c.created_at
    limit 1;

    if v_id is null then
      insert into public.clients (name, client_type, email_domain)
      values (v_company, 'company', public.corporate_email_domain(v_email))
      returning id into v_id;
    end if;
    return v_id;
  end if;

  if v_email is not null or v_phone is not null then
    select ct.client_id into v_id
    from public.client_contacts ct
    join public.clients c on c.id = ct.client_id
    where c.client_type = 'individual'
      and ((v_email is not null and public.normalize_contact_email(ct.email) = v_email)
        or (v_phone is not null and public.normalize_contact_phone(ct.phone) = v_phone))
    order by c.created_at
    limit 1;
  end if;

  if v_id is null then
    insert into public.clients (name, client_type)
    values (trim(p_name), 'individual')
    returning id into v_id;
  end if;
  return v_id;
end;
$$;


-- -----------------------------------------------------------------------------
-- Trigger em leads: garante o cliente e o contato de cada proposta.
-- Pelo app (usuário logado), proposta sem client_id é um cadastro novo, porque o vendedor
-- já decidiu no formulário entre "adicionar ao histórico" e "cadastro separado".
-- Pelo SQL Editor ou importações (sem usuário logado), agrupa automaticamente.
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
  v_contact_client uuid;
begin
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
       and new.company is not distinct from old.company then
      return new;
    end if;

    if new.client_id = old.client_id then
      -- Cliente que só tem esta proposta acompanha a correção de empresa/nome
      update public.clients c
         set name = coalesce(v_company, trim(new.contact_name)),
             client_type = case when v_company is null then 'individual' else 'company' end,
             email_domain = case when v_company is null then null else coalesce(c.email_domain, v_domain) end
       where c.id = new.client_id
         and not exists (select 1 from public.leads l where l.client_id = new.client_id and l.id <> new.id)
         and (c.name, c.client_type) is distinct from
             (coalesce(v_company, trim(new.contact_name)), case when v_company is null then 'individual' else 'company' end);

      -- Contato que só aparece nesta proposta: corrige o próprio cadastro da pessoa
      if new.contact_id is not null and new.contact_id = old.contact_id
         and not exists (select 1 from public.leads l where l.contact_id = new.contact_id and l.id <> new.id) then
        update public.client_contacts c
           set name = trim(new.contact_name),
               phone = nullif(trim(coalesce(new.contact_phone, '')), ''),
               email = public.normalize_contact_email(new.contact_email)
         where c.id = new.contact_id;
        return new;
      end if;
    end if;

    -- Dados do contato mudaram numa proposta que divide o contato com outras: localiza de novo
    if new.contact_id is not distinct from old.contact_id
       and (new.contact_name, new.contact_phone, new.contact_email)
           is distinct from (old.contact_name, old.contact_phone, old.contact_email) then
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

  return new;
end;
$$;

drop trigger if exists leads_link_client on public.leads;
create trigger leads_link_client
  before insert or update of client_id, contact_id, contact_name, contact_phone, contact_email, company on public.leads
  for each row execute function public.link_lead_client();


-- -----------------------------------------------------------------------------
-- Agrupa as propostas que ainda não têm cliente (usada pela migração e pelo seed)
-- -----------------------------------------------------------------------------
create or replace function public.backfill_lead_clients()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_lead record;
  v_client uuid;
  v_count integer := 0;
begin
  for v_lead in
    select l.id, l.contact_name, l.contact_phone, l.contact_email, l.company
    from public.leads l
    where l.client_id is null
    order by l.created_at, l.id
  loop
    v_client := public.find_or_create_client(v_lead.company, v_lead.contact_name, v_lead.contact_phone, v_lead.contact_email);
    update public.leads l
       set client_id = v_client,
           contact_id = public.find_or_create_client_contact(v_client, v_lead.contact_name, v_lead.contact_phone, v_lead.contact_email)
     where l.id = v_lead.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Funções internas: não ficam disponíveis como RPC para o app
revoke execute on function public.find_or_create_client_contact(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.find_or_create_client(text, text, text, text) from public, anon, authenticated;
revoke execute on function public.link_lead_client() from public, anon, authenticated;
revoke execute on function public.backfill_lead_clients() from public, anon, authenticated;


-- -----------------------------------------------------------------------------
-- Permissões e RLS: mesma regra das propostas (ativos leem, criam e editam; ADMIN exclui)
-- -----------------------------------------------------------------------------
revoke all on public.clients         from anon;
revoke all on public.client_contacts from anon;
grant select, insert, update, delete on public.clients         to authenticated;
grant select, insert, update, delete on public.client_contacts to authenticated;

alter table public.clients         enable row level security;
alter table public.client_contacts enable row level security;

drop policy if exists "Ativos leem clientes"     on public.clients;
drop policy if exists "Ativos criam clientes"    on public.clients;
drop policy if exists "Ativos editam clientes"   on public.clients;
drop policy if exists "Admins excluem clientes"  on public.clients;

create policy "Ativos leem clientes"
  on public.clients for select
  to authenticated
  using ((select public.is_active_user()));

create policy "Ativos criam clientes"
  on public.clients for insert
  to authenticated
  with check ((select public.is_active_user()));

create policy "Ativos editam clientes"
  on public.clients for update
  to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

create policy "Admins excluem clientes"
  on public.clients for delete
  to authenticated
  using ((select public.is_admin()));

drop policy if exists "Ativos leem contatos"     on public.client_contacts;
drop policy if exists "Ativos criam contatos"    on public.client_contacts;
drop policy if exists "Ativos editam contatos"   on public.client_contacts;
drop policy if exists "Admins excluem contatos"  on public.client_contacts;

create policy "Ativos leem contatos"
  on public.client_contacts for select
  to authenticated
  using ((select public.is_active_user()));

create policy "Ativos criam contatos"
  on public.client_contacts for insert
  to authenticated
  with check ((select public.is_active_user()));

create policy "Ativos editam contatos"
  on public.client_contacts for update
  to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

create policy "Admins excluem contatos"
  on public.client_contacts for delete
  to authenticated
  using ((select public.is_admin()));


-- -----------------------------------------------------------------------------
-- Propostas que já existem: agrupa em clientes e contatos
-- -----------------------------------------------------------------------------
select public.backfill_lead_clients();

-- <<< clientes-contatos (fim do bloco)

commit;

-- Conferência: clientes com mais de uma proposta
-- select c.name, c.client_type, count(l.id) as propostas, count(distinct l.contact_id) as contatos
-- from public.clients c join public.leads l on l.client_id = c.id
-- group by c.id order by propostas desc;
