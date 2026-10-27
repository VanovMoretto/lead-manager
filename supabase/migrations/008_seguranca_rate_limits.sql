-- =============================================================================
-- Migração 008: proteção contra flood de escrita e payloads gigantes
-- - Limite de 20 leads por minuto por usuário (trigger), mesmo chamando a API REST direto
-- - O responsável pelo lead é sempre o usuário logado (não dá para gravar em nome de outro)
-- - Tamanho máximo dos campos de texto (leads, opções do Painel Admin e anexos)
-- - Anexos de proposta: somente PDF, DOC, DOCX, PNG e JPG, até 10 MB
-- As restrições de tamanho são criadas como NOT VALID: valem para tudo que for gravado
-- daqui em diante sem bloquear a migração por causa de algum registro antigo.
-- Segura para rodar com dados existentes e idempotente (pode rodar de novo).
-- =============================================================================
begin;

-- >>> seguranca-rate-limits (início do bloco também usado em schema.sql)

-- -----------------------------------------------------------------------------
-- Limite de criação de leads por usuário
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

-- <<< seguranca-rate-limits (fim do bloco)

commit;
