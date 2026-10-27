-- =============================================================================
-- Gestão de Leads e Orçamentos de Eventos (Micro-CRM) — Schema inicial
-- Rodar no SQL Editor do Supabase. O script é idempotente: pode ser executado
-- mais de uma vez sem duplicar tabelas, políticas ou opções padrão.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Função utilitária: mantém a coluna updated_at sempre atualizada.
-- Mudança só no opt-out (propagação por contato), no vínculo com o cliente ou no CNPJ vindo da empresa não conta como atualização do orçamento.
-- -----------------------------------------------------------------------------
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

-- Receita total calculada pelo banco (ordenação e somas consistentes)
alter table public.leads add column if not exists total_value numeric(14, 2)
  generated always as (coalesce(proposed_value, 0) + ab_value + lodging_value) stored;

comment on column public.leads.proposed_value is 'Valor de Locação / Espaço.';
comment on column public.leads.ab_value       is 'Valor de Alimentos & Bebidas (0 quando has_ab = false).';
comment on column public.leads.lodging_value  is 'Valor de Hospedagem (0 quando has_lodging = false).';
comment on column public.leads.total_value    is 'Receita total da proposta: locação + A&B + hospedagem (gerada).';

-- Empresa do cliente e evento com mais de um dia

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

-- Observações da negociação
alter table public.leads add column if not exists observations text;

alter table public.leads drop constraint if exists leads_observations_length;
alter table public.leads add  constraint leads_observations_length
  check (observations is null or length(observations) <= 5000);

comment on column public.leads.observations is 'Observações livres sobre a negociação (painel de detalhes do lead).';


-- Opt-out de comunicações/mailing (LGPD)
alter table public.leads
  add column if not exists marketing_opt_out boolean not null default false;

comment on column public.leads.marketing_opt_out is
  'Cliente pediu para não receber comunicações/mailing (LGPD). Excluído da exportação de mailing.';

-- Opt-out por contato (LGPD): lista de supressão por e-mail/telefone mantida por triggers

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

-- Usuários só leem a lista (política na seção de RLS); a escrita é feita apenas pelos triggers (security definer)
revoke all on public.marketing_suppressions from anon, authenticated;
grant select on public.marketing_suppressions to authenticated;

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

-- Funções de trigger: não ficam disponíveis como RPC para o app
-- As normalizações são executadas pelos índices em cada INSERT com o papel do usuário: precisam de EXECUTE
revoke execute on function public.normalize_contact_email(text) from public, anon;
revoke execute on function public.normalize_contact_phone(text) from public, anon;
grant execute on function public.normalize_contact_email(text) to authenticated;
grant execute on function public.normalize_contact_phone(text) to authenticated;
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
-- Perfis de usuário, papel ADMIN e acesso ativo
-- Os usuários continuam sendo criados no Supabase (Authentication → Users);
-- o perfil nasce sozinho pelo trigger em auth.users.
-- -----------------------------------------------------------------------------
-- Tabela user_profiles de antes desta migração, sem a coluna user_id (estrutura diferente):
-- é preservada como user_profiles_legacy e os ADMINs dela são copiados mais abaixo
do $$
declare
  v_trigger record;
begin
  if to_regclass('public.user_profiles') is not null and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'user_id'
  ) then
    if to_regclass('public.user_profiles_legacy') is not null then
      raise exception 'Já existem public.user_profiles (sem user_id) e public.user_profiles_legacy. Remova ou renomeie uma delas e rode de novo.';
    end if;
    alter table public.user_profiles rename to user_profiles_legacy;

    -- Triggers antigos em auth.users que gravavam na tabela antiga passariam a gravar na nova
    -- (com outras colunas) e travariam a criação de usuários: o trigger desta migração os substitui
    for v_trigger in
      select t.tgname
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      where t.tgrelid = 'auth.users'::regclass
        and not t.tgisinternal
        and t.tgname <> 'on_auth_user_sync_profile'
        and p.prosrc ilike '%user_profiles%'
    loop
      execute format('drop trigger %I on auth.users', v_trigger.tgname);
    end loop;
  end if;
end;
$$;

create table if not exists public.user_profiles (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  email            text,
  is_admin         boolean not null default false,
  is_active        boolean not null default true,
  avatar_path      text,
  last_sign_in_at  timestamptz,
  created_at       timestamptz not null default now(),

  -- A foto fica sempre na pasta do próprio usuário no bucket "avatars"
  constraint user_profiles_avatar_path_own_folder
    check (avatar_path is null or avatar_path like user_id::text || '/%')
);

-- Tabela user_profiles antiga que já usava user_id: completa as colunas que faltarem
alter table public.user_profiles add column if not exists email           text;
alter table public.user_profiles add column if not exists is_admin        boolean not null default false;
alter table public.user_profiles add column if not exists is_active       boolean not null default true;
alter table public.user_profiles add column if not exists avatar_path     text;
alter table public.user_profiles add column if not exists last_sign_in_at timestamptz;
alter table public.user_profiles add column if not exists created_at      timestamptz not null default now();

create unique index if not exists user_profiles_user_id_key on public.user_profiles (user_id);

alter table public.user_profiles drop constraint if exists user_profiles_avatar_path_own_folder;
alter table public.user_profiles add  constraint user_profiles_avatar_path_own_folder
  check (avatar_path is null or avatar_path like user_id::text || '/%');

comment on table  public.user_profiles             is 'Perfil de cada usuário do Supabase Auth: acesso ativo, papel ADMIN e avatar.';
comment on column public.user_profiles.is_admin    is 'ADMIN: Painel Admin, gestão de usuários e exclusões.';
comment on column public.user_profiles.is_active   is 'Usuário desativado não lê nem grava dados no app.';
comment on column public.user_profiles.avatar_path is 'Caminho da foto no bucket "avatars" ({user_id}/arquivo).';

-- Cria/atualiza o perfil quando o usuário é criado, troca de e-mail ou faz login
create or replace function public.sync_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id, email, last_sign_in_at)
  values (new.id, new.email, new.last_sign_in_at)
  on conflict (user_id) do update
    set email = excluded.email,
        last_sign_in_at = excluded.last_sign_in_at;
  return new;
end;
$$;

revoke execute on function public.sync_user_profile() from public, anon, authenticated;

drop trigger if exists on_auth_user_sync_profile on auth.users;
create trigger on_auth_user_sync_profile
  after insert or update of email, last_sign_in_at on auth.users
  for each row execute function public.sync_user_profile();

-- Perfis dos usuários que já existem
insert into public.user_profiles (user_id, email, last_sign_in_at)
select u.id, u.email, u.last_sign_in_at
from auth.users u
on conflict (user_id) do update
  set email = excluded.email,
      last_sign_in_at = excluded.last_sign_in_at;

-- Quem era ADMIN pela tabela antiga continua ADMIN
do $$
begin
  if to_regclass('public.app_admins') is not null then
    execute 'update public.user_profiles p set is_admin = true
             where exists (select 1 from public.app_admins a where a.user_id = p.user_id)';
  end if;
end;
$$;

-- ADMINs marcados na tabela user_profiles antiga (is_admin = true ou papel "admin")
do $$
declare
  v_id_col text;
  v_col record;
begin
  if to_regclass('public.user_profiles_legacy') is null then
    return;
  end if;

  -- Coluna com o id do usuário do Supabase Auth
  select c.column_name into v_id_col
  from information_schema.columns c
  where c.table_schema = 'public' and c.table_name = 'user_profiles_legacy'
    and c.data_type = 'uuid' and c.column_name in ('user_id', 'id', 'auth_id', 'uid', 'profile_id')
  order by array_position(array['user_id', 'id', 'auth_id', 'uid', 'profile_id'], c.column_name::text)
  limit 1;

  if v_id_col is null then
    raise notice 'user_profiles_legacy sem coluna de id do usuário: defina os ADMINs no Painel Admin ou pelo SQL do fim do arquivo.';
    return;
  end if;

  for v_col in
    select c.column_name, c.data_type
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = 'user_profiles_legacy'
      and c.column_name in ('is_admin', 'admin', 'role', 'papel', 'perfil', 'tipo', 'user_role', 'cargo')
  loop
    if v_col.data_type = 'boolean' then
      execute format(
        'update public.user_profiles p set is_admin = true
           from public.user_profiles_legacy l
          where l.%I = p.user_id and l.%I is true',
        v_id_col, v_col.column_name);
    else
      execute format(
        'update public.user_profiles p set is_admin = true
           from public.user_profiles_legacy l
          where l.%I = p.user_id and lower(trim(l.%I::text)) in (''admin'', ''administrador'', ''administrator'')',
        v_id_col, v_col.column_name);
    end if;
  end loop;
end;
$$;

-- O usuário logado é ADMIN (e está ativo)? Usada nas políticas e pelo app (RPC)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_profiles p
    where p.user_id = (select auth.uid())
      and p.is_admin
      and p.is_active
  )
$$;

-- O usuário logado está com o acesso ativo? Sem perfil, conta como inativo
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_active from public.user_profiles p where p.user_id = (select auth.uid())),
    false
  )
$$;

revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_active_user() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;

drop table if exists public.app_admins;

-- Cada usuário lê o próprio perfil (mesmo desativado, para o app avisar); ADMIN lê todos.
-- O usuário só altera a própria foto; papel e acesso mudam apenas pela função abaixo.
alter table public.user_profiles enable row level security;
revoke all on public.user_profiles from anon, authenticated;
grant select on public.user_profiles to authenticated;
grant update (avatar_path) on public.user_profiles to authenticated;

drop policy if exists "Usuário lê o próprio perfil e ADMIN lê todos" on public.user_profiles;
create policy "Usuário lê o próprio perfil e ADMIN lê todos"
  on public.user_profiles for select
  to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Usuário altera a própria foto" on public.user_profiles;
create policy "Usuário altera a própria foto"
  on public.user_profiles for update
  to authenticated
  using (user_id = (select auth.uid()) and (select public.is_active_user()))
  with check (user_id = (select auth.uid()));

-- ADMIN ativa/desativa usuários e muda o papel (nulo = mantém o valor atual)
create or replace function public.admin_set_user_access(
  p_user_id   uuid,
  p_is_admin  boolean default null,
  p_is_active boolean default null
)
returns public.user_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.user_profiles;
begin
  if not public.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  -- Impede que o ADMIN tire o próprio acesso (e o sistema fique sem administrador)
  if p_user_id = (select auth.uid()) then
    raise exception 'self_access_change' using errcode = 'P0001';
  end if;

  update public.user_profiles p
     set is_admin  = coalesce(p_is_admin, p.is_admin),
         is_active = coalesce(p_is_active, p.is_active)
   where p.user_id = p_user_id
  returning * into v_profile;

  if not found then
    raise exception 'user_not_found' using errcode = 'P0002';
  end if;
  return v_profile;
end;
$$;

revoke execute on function public.admin_set_user_access(uuid, boolean, boolean) from public, anon;
grant execute on function public.admin_set_user_access(uuid, boolean, boolean) to authenticated;


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
drop policy if exists "Admins podem criar opções"          on public.app_settings_options;
drop policy if exists "Admins podem editar opções"         on public.app_settings_options;
drop policy if exists "Admins podem excluir opções"        on public.app_settings_options;

-- Só usuários com acesso ativo leem e gravam dados
create policy "Autenticados podem ler opções"
  on public.app_settings_options for select
  to authenticated
  using ((select public.is_active_user()));

-- Somente ADMIN cadastra, edita e exclui opções (Painel Admin)
create policy "Admins podem criar opções"
  on public.app_settings_options for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "Admins podem editar opções"
  on public.app_settings_options for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Admins podem excluir opções"
  on public.app_settings_options for delete
  to authenticated
  using ((select public.is_admin()));

-- leads
drop policy if exists "Autenticados podem ler leads"      on public.leads;
drop policy if exists "Autenticados podem criar leads"    on public.leads;
drop policy if exists "Autenticados podem editar leads"   on public.leads;
drop policy if exists "Autenticados podem excluir leads"  on public.leads;
drop policy if exists "Admins podem excluir leads"        on public.leads;

create policy "Autenticados podem ler leads"
  on public.leads for select
  to authenticated
  using ((select public.is_active_user()));

create policy "Autenticados podem criar leads"
  on public.leads for insert
  to authenticated
  with check ((select public.is_active_user()));

create policy "Autenticados podem editar leads"
  on public.leads for update
  to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

-- Somente ADMIN exclui leads
create policy "Admins podem excluir leads"
  on public.leads for delete
  to authenticated
  using ((select public.is_admin()));

-- marketing_suppressions
drop policy if exists "Autenticados podem ler supressões" on public.marketing_suppressions;
create policy "Autenticados podem ler supressões"
  on public.marketing_suppressions for select
  to authenticated
  using ((select public.is_active_user()));


-- -----------------------------------------------------------------------------
-- Anexos das propostas (arquivos no bucket privado "lead-attachments")
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lead-attachments',
  'lead-attachments',
  false,
  10485760,
  array['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.lead_attachments (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads (id) on delete cascade,
  kind          text not null
                constraint lead_attachments_kind_check
                check (kind in ('rental_proposal', 'ab_proposal')),
  storage_path  text not null
                constraint lead_attachments_storage_path_key unique,
  file_name     text not null
                constraint lead_attachments_file_name_valid
                check (length(trim(file_name)) between 1 and 255),
  mime_type     text not null
                constraint lead_attachments_mime_type_check
                check (mime_type in ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes    bigint not null
                constraint lead_attachments_size_check
                check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),

  -- O arquivo fica na pasta do próprio lead: {lead_id}/...
  constraint lead_attachments_path_in_lead_folder
    check (storage_path like lead_id::text || '/%')
);

comment on table  public.lead_attachments              is 'Arquivos das propostas do lead (PDF ou imagem), guardados no bucket "lead-attachments".';
comment on column public.lead_attachments.kind         is 'rental_proposal = Proposta de Locação | ab_proposal = Proposta de A&B';
comment on column public.lead_attachments.storage_path is 'Caminho do arquivo no bucket ({lead_id}/{tipo}/{arquivo}).';

create index if not exists lead_attachments_lead_id_idx on public.lead_attachments (lead_id, kind, created_at desc);

alter table public.lead_attachments enable row level security;
revoke all on public.lead_attachments from anon, authenticated;
grant select, insert, delete on public.lead_attachments to authenticated;

drop policy if exists "Ativos leem anexos"     on public.lead_attachments;
drop policy if exists "Ativos anexam arquivos" on public.lead_attachments;
drop policy if exists "Admins excluem anexos"  on public.lead_attachments;

create policy "Ativos leem anexos"
  on public.lead_attachments for select
  to authenticated
  using ((select public.is_active_user()));

-- Só registra arquivo que já foi enviado ao bucket, em nome de quem enviou
create policy "Ativos anexam arquivos"
  on public.lead_attachments for insert
  to authenticated
  with check (
    (select public.is_active_user())
    and uploaded_by = (select auth.uid())
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'lead-attachments' and o.name = storage_path
    )
  );

-- Somente ADMIN exclui informações
create policy "Admins excluem anexos"
  on public.lead_attachments for delete
  to authenticated
  using ((select public.is_admin()));

drop policy if exists "Anexos de leads: leitura"  on storage.objects;
drop policy if exists "Anexos de leads: envio"    on storage.objects;
drop policy if exists "Anexos de leads: exclusão" on storage.objects;

create policy "Anexos de leads: leitura"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'lead-attachments' and (select public.is_active_user()));

-- A primeira pasta do caminho precisa ser um lead existente
create policy "Anexos de leads: envio"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'lead-attachments'
    and (select public.is_active_user())
    and exists (
      select 1 from public.leads l
      where l.id::text = (storage.foldername(name))[1]
    )
  );

create policy "Anexos de leads: exclusão"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'lead-attachments' and (select public.is_admin()));


-- -----------------------------------------------------------------------------
-- Fotos de perfil (bucket privado "avatars", uma pasta por usuário)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Avatares: leitura"  on storage.objects;
drop policy if exists "Avatares: envio"    on storage.objects;
drop policy if exists "Avatares: exclusão" on storage.objects;

create policy "Avatares: leitura"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'avatars' and (select public.is_active_user()));

create policy "Avatares: envio"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "Avatares: exclusão"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- -----------------------------------------------------------------------------
-- Segurança: limite de escrita e tamanho dos campos
-- -----------------------------------------------------------------------------
create or replace function public.enforce_lead_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_recent integer;
begin
  -- Scripts do SQL Editor e seeds (sem usuário logado) não entram no limite
  if v_uid is null then
    return new;
  end if;

  -- Responsável é sempre quem está logado
  new.user_id := v_uid;

  -- Serializa as inserções do mesmo usuário para a contagem não ser burlada em paralelo
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select count(*) into v_recent
  from public.leads l
  where l.user_id = v_uid
    and l.created_at > now() - interval '1 minute';

  if v_recent >= 20 then
    raise exception 'Limite de requisições excedido. Aguarde um instante.'
      using errcode = 'P0001', hint = 'lead_rate_limit';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_lead_rate_limit() from public, anon, authenticated;

drop trigger if exists leads_enforce_rate_limit on public.leads;
create trigger leads_enforce_rate_limit
  before insert on public.leads
  for each row execute function public.enforce_lead_rate_limit();

create index if not exists leads_user_id_created_at_idx on public.leads (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Tamanho máximo dos campos de texto
-- -----------------------------------------------------------------------------
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
) not valid;

alter table public.app_settings_options drop constraint if exists app_settings_options_label_length;
alter table public.app_settings_options add  constraint app_settings_options_label_length
  check (length(label) <= 80) not valid;

alter table public.user_profiles drop constraint if exists user_profiles_avatar_path_length;
alter table public.user_profiles add  constraint user_profiles_avatar_path_length
  check (avatar_path is null or length(avatar_path) <= 200) not valid;

-- -----------------------------------------------------------------------------
-- Anexos de proposta: PDF, DOC, DOCX, PNG e JPG (extensão e tipo), até 10 MB
-- -----------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 10485760,
       allowed_mime_types = array[
         'application/pdf',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'image/png',
         'image/jpeg'
       ]
 where id = 'lead-attachments';

alter table public.lead_attachments drop constraint if exists lead_attachments_mime_type_check;
alter table public.lead_attachments add  constraint lead_attachments_mime_type_check check (
  mime_type in (
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg'
  )
) not valid;

alter table public.lead_attachments drop constraint if exists lead_attachments_extension_check;
alter table public.lead_attachments add  constraint lead_attachments_extension_check check (
  lower(file_name) ~ '\.(pdf|doc|docx|png|jpg|jpeg)$'
  and lower(storage_path) ~ '\.(pdf|doc|docx|png|jpg)$'
) not valid;


-- -----------------------------------------------------------------------------
-- Clientes (empresa ou pessoa física) e pessoas de contato
-- -----------------------------------------------------------------------------

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


-- -----------------------------------------------------------------------------
-- CNPJ das empresas e braços (matriz, filiais, franquias)
-- -----------------------------------------------------------------------------
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
