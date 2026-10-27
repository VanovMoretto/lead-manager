-- =============================================================================
-- Migração 014: autoria fixa das propostas
-- Quem cadastrou a proposta (leads.user_id) não muda numa edição feita pelo app ou pela
-- API: o trigger devolve o valor antigo. Pelo SQL Editor (sem usuário logado) continua
-- sendo possível corrigir a autoria. Idempotente (pode rodar de novo).
-- =============================================================================
begin;

-- >>> autoria-fixa (início do bloco também usado em schema.sql)

create or replace function public.keep_lead_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and new.user_id is distinct from old.user_id then
    new.user_id := old.user_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.keep_lead_author() from public, anon, authenticated;

-- O nome faz o trigger rodar antes de leads_set_updated_at (ordem alfabética):
-- a tentativa de trocar a autoria não conta como alteração do orçamento
drop trigger if exists leads_enforce_author on public.leads;
create trigger leads_enforce_author
  before update of user_id on public.leads
  for each row execute function public.keep_lead_author();

comment on column public.leads.user_id is 'Usuário que cadastrou a proposta. Definido no cadastro e fixo nas edições (só o SQL Editor altera).';

-- <<< autoria-fixa (fim do bloco)

commit;
