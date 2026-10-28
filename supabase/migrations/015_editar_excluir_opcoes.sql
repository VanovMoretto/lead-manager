-- =============================================================================
-- Migração 015: editar e excluir opções do Painel Admin (salas, meios de prospecção
-- e motivos de perda)
-- - admin_rename_setting_option: corrige o nome e atualiza as propostas que usam o nome antigo
-- - admin_delete_setting_option: exclui a opção; opcionalmente passa as propostas para outra
--   opção da mesma categoria (para juntar duplicadas). Sem substituta, as propostas guardam
--   o texto antigo no histórico.
-- - Essas atualizações nas propostas não mudam a data de "última atualização"
-- Somente ADMIN. Idempotente (pode rodar de novo).
-- =============================================================================
begin;

-- >>> editar-excluir-opcoes (início do bloco também usado em schema.sql)

-- Correções em massa feitas pelo sistema (app.skip_updated_at = on) não contam como alteração do orçamento
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and current_setting('app.skip_updated_at', true) = 'on' then
    new.updated_at = old.updated_at;
    return new;
  end if;
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - 'marketing_opt_out' - 'updated_at' - 'contact_phone_digits' - 'total_value' - 'net_value' - 'event_last_date' - 'client_id' - 'contact_id' - 'cnpj' - 'cnpj_digits')
       = (to_jsonb(old) - 'marketing_opt_out' - 'updated_at' - 'contact_phone_digits' - 'total_value' - 'net_value' - 'event_last_date' - 'client_id' - 'contact_id' - 'cnpj' - 'cnpj_digits') then
    new.updated_at = old.updated_at;
    return new;
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- Troca o nome de uma opção nas propostas (salas: no array, sem repetir a sala)
create or replace function public.replace_setting_label(p_category text, p_old text, p_new text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  perform set_config('app.skip_updated_at', 'on', true);

  if p_category = 'room' then
    update public.leads l
       set room_interests = array(
             select s.room
             from (
               select case when u.room = p_old then p_new else u.room end as room, min(u.ord) as ord
               from unnest(l.room_interests) with ordinality as u(room, ord)
               group by 1
             ) as s
             order by s.ord
           )
     where l.room_interests @> array[p_old];
  elsif p_category = 'origin' then
    update public.leads l set origin = p_new where l.origin = p_old;
  elsif p_category = 'loss_reason' then
    update public.leads l set loss_reason = p_new where l.loss_reason = p_old;
  end if;
  get diagnostics v_count = row_count;

  perform set_config('app.skip_updated_at', 'off', true);
  return v_count;
end;
$$;

revoke execute on function public.replace_setting_label(text, text, text) from public, anon, authenticated;

-- Corrige o nome de uma opção (e das propostas que usam o nome antigo)
create or replace function public.admin_rename_setting_option(p_option_id uuid, p_label text)
returns public.app_settings_options
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option public.app_settings_options;
  v_label text := trim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g'));
  v_old text;
begin
  if not public.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;
  if v_label = '' then
    raise exception 'empty_label' using errcode = '23514';
  end if;

  select * into v_option from public.app_settings_options o where o.id = p_option_id for update;
  if not found then
    raise exception 'option_not_found' using errcode = 'P0002';
  end if;

  v_old := v_option.label;
  if v_old = v_label then
    return v_option;
  end if;

  -- Nome já usado por outra opção da categoria: unique_violation (23505)
  update public.app_settings_options o set label = v_label where o.id = p_option_id returning * into v_option;
  perform public.replace_setting_label(v_option.category, v_old, v_label);
  return v_option;
end;
$$;

-- Exclui uma opção; com substituta, as propostas passam a usar a outra opção
create or replace function public.admin_delete_setting_option(p_option_id uuid, p_replacement_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option public.app_settings_options;
  v_replacement public.app_settings_options;
  v_moved integer := 0;
begin
  if not public.is_admin() then
    raise exception 'admin_required' using errcode = '42501';
  end if;

  select * into v_option from public.app_settings_options o where o.id = p_option_id for update;
  if not found then
    raise exception 'option_not_found' using errcode = 'P0002';
  end if;

  if p_replacement_id is not null then
    select * into v_replacement from public.app_settings_options o where o.id = p_replacement_id;
    if not found or v_replacement.category <> v_option.category or v_replacement.id = v_option.id then
      raise exception 'invalid_replacement' using errcode = 'P0001';
    end if;
    v_moved := public.replace_setting_label(v_option.category, v_option.label, v_replacement.label);
  end if;

  delete from public.app_settings_options o where o.id = p_option_id;
  return v_moved;
end;
$$;

revoke execute on function public.admin_rename_setting_option(uuid, text) from public, anon;
revoke execute on function public.admin_delete_setting_option(uuid, uuid) from public, anon;
grant execute on function public.admin_rename_setting_option(uuid, text) to authenticated;
grant execute on function public.admin_delete_setting_option(uuid, uuid) to authenticated;

-- <<< editar-excluir-opcoes (fim do bloco)

commit;
