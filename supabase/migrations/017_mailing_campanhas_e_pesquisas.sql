-- =============================================================================
-- Migração 017: correções de segurança, mailing, campanhas, WhatsApp e pesquisas
-- Correções de segurança:
-- - Usuário desativado ou sem perfil é recusado antes dos triggers das propostas
-- - Data de criação da proposta definida pelo banco (limite de envios não é burlado)
-- - Valores 'NaN' e CNPJ gigante recusados
-- - Novo consentimento (opt-out LGPD) não apaga mais o opt-out de outras pessoas
-- - Anexos de proposta excluída deixam de ser lidos por usuários comuns
-- - Caminhos de foto e anexo no formato gerado pelo app (sem "../")
-- - create_ceremonialist valida tamanhos; list_user_logins não repete logins
-- - Tabela antiga user_profiles_legacy (se existir) fechada para a API
-- Mailing e pesquisas:
-- - mailing_campaigns: campanhas de e-mail/WhatsApp e seus contadores
-- - communication_logs: registro de cada mensagem iniciada pelo app
-- - leads.survey_sent_at, survey_responded_at e survey_score (nota de 1 a 10)
-- Idempotente (pode rodar de novo). Rode depois da 016.
-- =============================================================================
begin;

-- >>> correcoes-de-seguranca (início do bloco também usado em schema.sql)

-- -----------------------------------------------------------------------------
-- Propostas: usuário sem acesso ativo é recusado antes dos demais triggers, que
-- consultam clientes e contatos com privilégio do dono (o nome faz este rodar primeiro)
-- -----------------------------------------------------------------------------
create or replace function public.require_active_lead_writer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not (select public.is_active_user()) then
    raise exception 'inactive_user' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.require_active_lead_writer() from public, anon, authenticated;

drop trigger if exists leads_a_require_active_user on public.leads;
create trigger leads_a_require_active_user
  before insert or update on public.leads
  for each row execute function public.require_active_lead_writer();

-- Data de criação definida pelo banco: não vem do app nem da API.
-- O limite de propostas por minuto conta por created_at, então ele não pode ser enviado.
create or replace function public.keep_lead_created_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if tg_op = 'INSERT' then
      new.created_at := now();
      new.updated_at := now();
    elsif new.created_at is distinct from old.created_at then
      new.created_at := old.created_at;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.keep_lead_created_at() from public, anon, authenticated;

drop trigger if exists leads_a_keep_created_at on public.leads;
create trigger leads_a_keep_created_at
  before insert or update of created_at on public.leads
  for each row execute function public.keep_lead_created_at();

-- 'NaN' passa no ">= 0" do numeric e transforma os totais em NaN
alter table public.leads drop constraint if exists leads_values_not_nan;
alter table public.leads add  constraint leads_values_not_nan check (
  (proposed_value is null or proposed_value <> 'NaN'::numeric)
  and ab_value <> 'NaN'::numeric
  and lodging_value <> 'NaN'::numeric
  and equipment_value <> 'NaN'::numeric
  and parking_value <> 'NaN'::numeric
) not valid;

-- CNPJ formatado tem 18 caracteres
alter table public.leads drop constraint if exists leads_cnpj_length;
alter table public.leads add  constraint leads_cnpj_length check (cnpj is null or length(cnpj) <= 18) not valid;
alter table public.clients drop constraint if exists clients_cnpj_length;
alter table public.clients add  constraint clients_cnpj_length check (cnpj is null or length(cnpj) <= 18) not valid;

-- -----------------------------------------------------------------------------
-- Opt-out LGPD: o novo consentimento libera só o contato da proposta editada.
-- Antes, a liberação em cadeia (pelo telefone fixo da empresa, por exemplo)
-- apagava o opt-out de outras pessoas.
-- -----------------------------------------------------------------------------
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
    -- Proposta liberada pela propagação não revoga os próprios e-mails e telefones
    if pg_trigger_depth() > 1 then
      return null;
    end if;

    delete from public.marketing_suppressions s
     where (s.kind = 'email' and s.value = v_email)
        or (s.kind = 'phone' and s.value = v_phone);

    -- Só libera quem não tem outro e-mail ou telefone ainda na lista de opt-out
    update public.leads l
       set marketing_opt_out = false
     where l.id <> new.id
       and l.marketing_opt_out
       and ((v_email is not null and public.normalize_contact_email(l.contact_email) = v_email)
         or (v_phone is not null and public.normalize_contact_phone(l.contact_phone) = v_phone))
       and not exists (
         select 1
         from public.marketing_suppressions s
         where (s.kind = 'email' and s.value = public.normalize_contact_email(l.contact_email))
            or (s.kind = 'phone' and s.value = public.normalize_contact_phone(l.contact_phone))
       );
  end if;

  return null;
end;
$$;

revoke execute on function public.sync_marketing_suppression() from public, anon, authenticated;

-- Responsável: a troca só vale vinda do ADMIN (admin_set_lead_owner)
create or replace function public.keep_lead_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and new.user_id is distinct from old.user_id
     and (coalesce(current_setting('app.allow_author_change', true), '') <> 'on' or not public.is_admin()) then
    new.user_id := old.user_id;
  end if;
  return new;
end;
$$;

revoke execute on function public.keep_lead_author() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Cerimonialista: roda com o papel de quem chama (RLS de clientes e contatos vale)
-- e confere os tamanhos antes de gravar
-- -----------------------------------------------------------------------------
create or replace function public.create_ceremonialist(p_name text, p_phone text default null, p_email text default null)
returns public.clients
language plpgsql
set search_path = ''
as $$
declare
  v_name   text := trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_phone  text := nullif(trim(coalesce(p_phone, '')), '');
  v_email  text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_client public.clients;
begin
  if not public.is_active_user() then
    raise exception 'inactive_user' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'empty_name' using errcode = '23514';
  end if;
  if length(v_name) > 150 then
    raise exception 'name_too_long' using errcode = '23514';
  end if;
  if v_phone is not null and length(v_phone) > 30 then
    raise exception 'phone_too_long' using errcode = '23514';
  end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^@\s?&#%,;]+@[^@\s?&#%,;]+\.[^@\s?&#%,;]+$') then
    raise exception 'invalid_email' using errcode = '23514';
  end if;

  -- Nome repetido: unique_violation (23505) pelo índice clients_ceremonialist_name_key
  insert into public.clients (name, client_type)
  values (v_name, 'ceremonialist')
  returning * into v_client;

  insert into public.client_contacts (client_id, name, phone, email, is_primary)
  values (v_client.id, v_name, v_phone, v_email, true);

  return v_client;
end;
$$;

revoke execute on function public.create_ceremonialist(text, text, text) from public, anon;
grant execute on function public.create_ceremonialist(text, text, text) to authenticated;

-- Logins da coluna Responsável: só para usuários ativos; login repetido aparece com o
-- e-mail inteiro (ninguém assume o nome de um colega trocando o próprio e-mail); a
-- situação de acesso de cada usuário só vai para o ADMIN
create or replace function public.list_user_logins()
returns table (user_id uuid, login text, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.user_id,
    case
      when count(*) over (partition by lower(split_part(coalesce(p.email, ''), '@', 1))) > 1 then coalesce(p.email, '')
      else split_part(coalesce(p.email, ''), '@', 1)
    end as login,
    case when public.is_admin() then p.is_active end as is_active
  from public.user_profiles p
  where public.is_active_user()
  order by 2
$$;

revoke execute on function public.list_user_logins() from public, anon;
grant execute on function public.list_user_logins() to authenticated;

-- -----------------------------------------------------------------------------
-- Anexos: arquivo de proposta excluída só o ADMIN lê (para limpar a pasta);
-- só registra arquivo enviado pelo próprio usuário
-- -----------------------------------------------------------------------------
drop policy if exists "Anexos de leads: leitura" on storage.objects;
create policy "Anexos de leads: leitura"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lead-attachments'
    and (
      (select public.is_admin())
      or (
        (select public.is_active_user())
        and exists (select 1 from public.leads l where l.id::text = (storage.foldername(name))[1])
      )
    )
  );

drop policy if exists "Ativos anexam arquivos" on public.lead_attachments;
create policy "Ativos anexam arquivos"
  on public.lead_attachments for insert
  to authenticated
  with check (
    (select public.is_active_user())
    and uploaded_by = (select auth.uid())
    and exists (
      select 1 from storage.objects o
      where o.bucket_id = 'lead-attachments'
        and o.name = storage_path
        and (o.owner is null or o.owner = (select auth.uid()))
    )
  );

drop policy if exists "Avatares: exclusão" on storage.objects;
create policy "Avatares: exclusão"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (select public.is_active_user())
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Caminhos no formato que o app gera: {usuário}/{uuid}.ext e {proposta}/{tipo}/{uuid}.ext
alter table public.user_profiles drop constraint if exists user_profiles_avatar_path_format;
alter table public.user_profiles add  constraint user_profiles_avatar_path_format check (
  avatar_path is null or avatar_path ~ ('^' || user_id::text || '/[0-9a-f-]{36}\.[a-z0-9]{2,5}$')
) not valid;

alter table public.lead_attachments drop constraint if exists lead_attachments_storage_path_format;
alter table public.lead_attachments add  constraint lead_attachments_storage_path_format check (
  storage_path ~ '^[0-9a-f-]{36}/(rental_proposal|ab_proposal)/[0-9a-f-]{36}\.[a-z0-9]{2,5}$'
) not valid;

-- -----------------------------------------------------------------------------
-- Permissões que sobraram do padrão do Supabase
-- -----------------------------------------------------------------------------
revoke truncate, references, trigger on public.leads, public.clients, public.client_contacts, public.app_settings_options from authenticated;
revoke insert, update, delete, truncate, references, trigger on public.client_summaries from authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.sync_lead_rooms() from public, anon, authenticated;

-- Tabela de perfis antiga (renomeada pela migração 007), se existir: fora da API
do $$
begin
  if to_regclass('public.user_profiles_legacy') is not null then
    execute 'revoke all on public.user_profiles_legacy from anon, authenticated';
    execute 'alter table public.user_profiles_legacy enable row level security';
  end if;
end;
$$;

-- <<< correcoes-de-seguranca (fim do bloco)

-- >>> mailing-e-pesquisas (início do bloco também usado em schema.sql)

-- -----------------------------------------------------------------------------
-- Pesquisa de satisfação pós-evento: datas de envio e resposta e a nota (1 a 10)
-- -----------------------------------------------------------------------------
alter table public.leads add column if not exists survey_sent_at      timestamptz;
alter table public.leads add column if not exists survey_responded_at timestamptz;
alter table public.leads add column if not exists survey_score        integer;

alter table public.leads drop constraint if exists leads_survey_score_range;
alter table public.leads add  constraint leads_survey_score_range
  check (survey_score is null or survey_score between 1 and 10);

comment on column public.leads.survey_sent_at      is 'Quando a pesquisa de satisfação foi enviada (preenchido ao marcar "enviada").';
comment on column public.leads.survey_responded_at is 'Quando o cliente respondeu a pesquisa (preenchido ao marcar "respondida").';
comment on column public.leads.survey_score        is 'Nota de satisfação do cliente, de 1 a 10.';

create or replace function public.sync_survey_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.survey_status in ('enviada', 'respondida') and new.survey_sent_at is null then
    new.survey_sent_at := now();
  end if;
  if new.survey_status = 'respondida' and new.survey_responded_at is null then
    new.survey_responded_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_survey_dates() from public, anon, authenticated;

drop trigger if exists leads_sync_survey_dates on public.leads;
create trigger leads_sync_survey_dates
  before insert or update of survey_status on public.leads
  for each row execute function public.sync_survey_dates();

create index if not exists leads_survey_idx on public.leads (operational_status, survey_status);

-- -----------------------------------------------------------------------------
-- Autor dos registros de comunicação: sempre quem está logado, fixo nas edições
-- -----------------------------------------------------------------------------
create or replace function public.keep_row_author()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke execute on function public.keep_row_author() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Campanhas de mailing (e-mail e/ou WhatsApp) e seus contadores de retorno
-- -----------------------------------------------------------------------------
create table if not exists public.mailing_campaigns (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  channel         text not null default 'email'
                  constraint mailing_campaigns_channel_check check (channel in ('email', 'whatsapp', 'ambos')),
  segment_filter  text not null default 'all'
                  constraint mailing_campaigns_segment_check
                  check (segment_filter in ('all', 'closed_clients', 'open_proposals', 'lost_recover', 'companies_only')),
  status          text not null default 'rascunho'
                  constraint mailing_campaigns_status_check check (status in ('rascunho', 'enviada', 'concluida')),
  audience_count  integer not null default 0 constraint mailing_campaigns_audience_check check (audience_count >= 0),
  sent_count      integer not null default 0 constraint mailing_campaigns_sent_check check (sent_count >= 0),
  delivered_count integer not null default 0,
  opened_count    integer not null default 0,
  clicked_count   integer not null default 0,
  sent_at         timestamptz,
  notes           text,
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint mailing_campaigns_delivered_check check (delivered_count >= 0 and delivered_count <= sent_count),
  constraint mailing_campaigns_opened_check    check (opened_count >= 0 and opened_count <= delivered_count),
  constraint mailing_campaigns_clicked_check   check (clicked_count >= 0 and clicked_count <= opened_count),
  constraint mailing_campaigns_text_lengths    check (
    length(trim(name)) between 1 and 150
    and (notes is null or length(notes) <= 2000)
  )
);

comment on table public.mailing_campaigns is 'Campanhas de comunicação em massa (e-mail/WhatsApp) e seus contadores: enviados, entregues, abertos e cliques/respostas.';
comment on column public.mailing_campaigns.audience_count is 'Contatos únicos elegíveis (sem opt-out LGPD) no segmento quando a campanha foi montada.';

create index if not exists mailing_campaigns_created_at_idx on public.mailing_campaigns (created_at desc);

-- Campanha marcada como enviada ganha a data de envio
create or replace function public.mailing_campaign_defaults()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('enviada', 'concluida') and new.sent_at is null then
    new.sent_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.mailing_campaign_defaults() from public, anon, authenticated;

drop trigger if exists mailing_campaigns_keep_author on public.mailing_campaigns;
create trigger mailing_campaigns_keep_author
  before insert or update on public.mailing_campaigns
  for each row execute function public.keep_row_author();

drop trigger if exists mailing_campaigns_defaults on public.mailing_campaigns;
create trigger mailing_campaigns_defaults
  before insert or update on public.mailing_campaigns
  for each row execute function public.mailing_campaign_defaults();

drop trigger if exists mailing_campaigns_set_updated_at on public.mailing_campaigns;
create trigger mailing_campaigns_set_updated_at
  before update on public.mailing_campaigns
  for each row execute function public.set_updated_at();

alter table public.mailing_campaigns enable row level security;
revoke all on public.mailing_campaigns from anon, authenticated;
grant select, insert, update, delete on public.mailing_campaigns to authenticated;

drop policy if exists "Ativos leem campanhas"   on public.mailing_campaigns;
drop policy if exists "Ativos criam campanhas"  on public.mailing_campaigns;
drop policy if exists "Ativos editam campanhas" on public.mailing_campaigns;
drop policy if exists "Admins excluem campanhas" on public.mailing_campaigns;

create policy "Ativos leem campanhas"
  on public.mailing_campaigns for select
  to authenticated
  using ((select public.is_active_user()));

create policy "Ativos criam campanhas"
  on public.mailing_campaigns for insert
  to authenticated
  with check ((select public.is_active_user()));

create policy "Ativos editam campanhas"
  on public.mailing_campaigns for update
  to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

create policy "Admins excluem campanhas"
  on public.mailing_campaigns for delete
  to authenticated
  using ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- Registro de cada mensagem iniciada pelo app (WhatsApp, e-mail, pesquisa)
-- -----------------------------------------------------------------------------
create table if not exists public.communication_logs (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references public.leads (id) on delete cascade,
  client_id   uuid references public.clients (id) on delete set null,
  channel     text not null constraint communication_logs_channel_check check (channel in ('whatsapp', 'email')),
  purpose     text not null
              constraint communication_logs_purpose_check
              check (purpose in ('follow_up', 'greeting', 'survey', 'campaign', 'proposal')),
  recipient   text constraint communication_logs_recipient_length check (recipient is null or length(recipient) <= 254),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.communication_logs is 'Mensagens iniciadas pelo app (WhatsApp, e-mail, pesquisa), para as métricas de Mailing & Pesquisas.';

create index if not exists communication_logs_created_at_idx on public.communication_logs (created_at desc);
create index if not exists communication_logs_lead_id_idx on public.communication_logs (lead_id) where lead_id is not null;

-- Limite de registros por usuário: o botão é clicado por pessoas, não por scripts
create or replace function public.enforce_communication_log_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_recent integer;
begin
  if v_uid is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('communication_logs:' || v_uid::text, 0));

  select count(*) into v_recent
  from public.communication_logs c
  where c.created_by = v_uid
    and c.created_at > now() - interval '1 minute';

  if v_recent >= 60 then
    raise exception 'Limite de requisições excedido. Aguarde um instante.'
      using errcode = 'P0001', hint = 'communication_log_rate_limit';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_communication_log_rate_limit() from public, anon, authenticated;

drop trigger if exists communication_logs_keep_author on public.communication_logs;
create trigger communication_logs_keep_author
  before insert or update on public.communication_logs
  for each row execute function public.keep_row_author();

drop trigger if exists communication_logs_rate_limit on public.communication_logs;
create trigger communication_logs_rate_limit
  before insert on public.communication_logs
  for each row execute function public.enforce_communication_log_rate_limit();

alter table public.communication_logs enable row level security;
revoke all on public.communication_logs from anon, authenticated;
grant select, insert, update, delete on public.communication_logs to authenticated;

drop policy if exists "Ativos leem envios"    on public.communication_logs;
drop policy if exists "Ativos registram envios" on public.communication_logs;
drop policy if exists "Ativos editam envios"  on public.communication_logs;
drop policy if exists "Admins excluem envios" on public.communication_logs;

create policy "Ativos leem envios"
  on public.communication_logs for select
  to authenticated
  using ((select public.is_active_user()));

create policy "Ativos registram envios"
  on public.communication_logs for insert
  to authenticated
  with check ((select public.is_active_user()));

create policy "Ativos editam envios"
  on public.communication_logs for update
  to authenticated
  using ((select public.is_active_user()))
  with check ((select public.is_active_user()));

create policy "Admins excluem envios"
  on public.communication_logs for delete
  to authenticated
  using ((select public.is_admin()));

-- <<< mailing-e-pesquisas (fim do bloco)

commit;
