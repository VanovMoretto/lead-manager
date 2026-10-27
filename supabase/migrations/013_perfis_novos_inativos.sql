-- =============================================================================
-- Migração 013: usuários novos nascem sem acesso
-- O perfil criado pelo trigger em auth.users passa a vir com is_active = false: a pessoa
-- só lê e grava dados depois que um ADMIN ativa o acesso no Painel Admin → Usuários.
-- Protege o sistema mesmo que o cadastro público do Supabase Auth fique ligado.
-- Quem já tem perfil continua como está. Idempotente (pode rodar de novo).
-- =============================================================================
begin;

-- >>> perfis-novos-inativos (início do bloco também usado em schema.sql)

alter table public.user_profiles alter column is_active set default false;

comment on column public.user_profiles.is_active is 'Usuário desativado não lê nem grava dados no app. Perfis novos nascem inativos até um ADMIN ativar.';

-- Cria/atualiza o perfil quando o usuário é criado, troca de e-mail ou faz login.
-- Perfil novo entra sem acesso; o login nunca mexe no acesso de quem já existe.
create or replace function public.sync_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_profiles (user_id, email, last_sign_in_at, is_active)
  values (new.id, new.email, new.last_sign_in_at, false)
  on conflict (user_id) do update
    set email = excluded.email,
        last_sign_in_at = excluded.last_sign_in_at;
  return new;
end;
$$;

revoke execute on function public.sync_user_profile() from public, anon, authenticated;

-- <<< perfis-novos-inativos (fim do bloco)

commit;

-- Primeiro acesso em um projeto sem nenhum ADMIN ativo (troque pelo e-mail do administrador):
-- update public.user_profiles set is_active = true, is_admin = true where email = 'admin@exemplo.com.br';
