-- =============================================================================
-- Migração 005: papel ADMIN e correção de permissão no cadastro de leads
-- - Corrige o erro "permission denied for function normalize_contact_email" (42501)
--   ao criar leads, introduzido pela migração 004
-- - Todos os usuários: ver, criar e editar leads; ler as opções dos formulários
-- - Somente ADMIN: excluir leads e cadastrar/editar/excluir salas, meios de prospecção
--   e motivos de perda (Painel Admin)
-- Segura para rodar com dados existentes e idempotente (pode rodar de novo).
-- =============================================================================
begin;

-- 1) Correção: os índices de normalização (migração 004) executam estas funções em cada
--    INSERT com o papel do usuário. São funções puras de texto, sem acesso a dados.
grant execute on function public.normalize_contact_email(text) to authenticated;
grant execute on function public.normalize_contact_phone(text) to authenticated;

-- >>> papel-admin (início do bloco também usado em schema.sql)

-- 2) Administradores: um registro por usuário do Supabase Auth
create table if not exists public.app_admins (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);

comment on table public.app_admins is 'Usuários com papel ADMIN (Painel Admin e exclusões). Gerenciada pelo SQL Editor.';

-- Ninguém lê ou altera a tabela pela API; a verificação é feita por public.is_admin()
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

-- O usuário logado é ADMIN? Usada nas políticas e pelo app (RPC)
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins a where a.user_id = (select auth.uid())
  )
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- <<< papel-admin (fim do bloco)

-- 3) Políticas: exclusão de leads e escrita nas opções só para ADMIN
drop policy if exists "Autenticados podem excluir leads" on public.leads;
drop policy if exists "Admins podem excluir leads"       on public.leads;
create policy "Admins podem excluir leads"
  on public.leads for delete
  to authenticated
  using ((select public.is_admin()));

drop policy if exists "Autenticados podem criar opções"   on public.app_settings_options;
drop policy if exists "Autenticados podem editar opções"  on public.app_settings_options;
drop policy if exists "Autenticados podem excluir opções" on public.app_settings_options;
drop policy if exists "Admins podem criar opções"         on public.app_settings_options;
drop policy if exists "Admins podem editar opções"        on public.app_settings_options;
drop policy if exists "Admins podem excluir opções"       on public.app_settings_options;

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

commit;

-- -----------------------------------------------------------------------------
-- Depois de rodar: defina quem é ADMIN (troque pelo e-mail do administrador)
-- -----------------------------------------------------------------------------
-- insert into public.app_admins (user_id)
-- select id from auth.users where email = 'admin@suaempresa.com.br'
-- on conflict (user_id) do nothing;
--
-- Para remover um ADMIN:
-- delete from public.app_admins
-- where user_id = (select id from auth.users where email = 'admin@suaempresa.com.br');
