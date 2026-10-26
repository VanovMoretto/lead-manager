-- =============================================================================
-- Gestão de Leads e Orçamentos de Eventos (Micro-CRM) — Schema inicial
-- Rodar no SQL Editor do Supabase. O script é idempotente: pode ser executado
-- mais de uma vez sem duplicar tabelas, políticas ou opções padrão.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Função utilitária: mantém a coluna updated_at sempre atualizada.
-- Mudança só no opt-out (propagação por contato) não conta como atualização do orçamento.
-- -----------------------------------------------------------------------------
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
