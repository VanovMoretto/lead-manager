-- =============================================================================
-- Migração 007: detalhes do lead, anexos de propostas e perfis de usuário
-- - leads.observations: observações da negociação
-- - user_profiles: um perfil por usuário do Supabase Auth (ativo/inativo, ADMIN, avatar).
--   Substitui a tabela app_admins (os ADMINs atuais são copiados)
-- - Usuário desativado deixa de ler e gravar qualquer dado (políticas do banco)
-- - lead_attachments + bucket "lead-attachments": propostas de Locação e de A&B
-- - Bucket "avatars": foto de perfil
-- Segura para rodar com dados existentes e idempotente (pode rodar de novo).
-- =============================================================================
begin;

-- >>> observacoes (início do bloco também usado em schema.sql)

-- Observações da negociação
alter table public.leads add column if not exists observations text;

alter table public.leads drop constraint if exists leads_observations_length;
alter table public.leads add  constraint leads_observations_length
  check (observations is null or length(observations) <= 5000);

comment on column public.leads.observations is 'Observações livres sobre a negociação (painel de detalhes do lead).';
comment on column public.leads.total_value  is 'Receita total da proposta: locação + A&B + hospedagem (gerada).';

-- <<< observacoes (fim do bloco)

-- >>> perfis-usuarios (início do bloco também usado em schema.sql)

-- -----------------------------------------------------------------------------
-- Perfis de usuário
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

-- <<< perfis-usuarios (fim do bloco)


-- -----------------------------------------------------------------------------
-- Acesso aos dados só para usuários ativos
-- -----------------------------------------------------------------------------
drop policy if exists "Autenticados podem ler opções" on public.app_settings_options;
create policy "Autenticados podem ler opções"
  on public.app_settings_options for select
  to authenticated
  using ((select public.is_active_user()));

drop policy if exists "Autenticados podem ler leads"    on public.leads;
drop policy if exists "Autenticados podem criar leads"  on public.leads;
drop policy if exists "Autenticados podem editar leads" on public.leads;

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

drop policy if exists "Autenticados podem ler supressões" on public.marketing_suppressions;
create policy "Autenticados podem ler supressões"
  on public.marketing_suppressions for select
  to authenticated
  using ((select public.is_active_user()));


-- >>> anexos-storage (início do bloco também usado em schema.sql)

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

-- <<< anexos-storage (fim do bloco)

commit;

-- -----------------------------------------------------------------------------
-- Depois de rodar: confira quem é ADMIN. Se ninguém for, promova o primeiro pelo SQL Editor
-- (os demais podem ser gerenciados no Painel Admin → Usuários):
-- -----------------------------------------------------------------------------
-- update public.user_profiles set is_admin = true, is_active = true
-- where email = 'admin@suaempresa.com.br';
