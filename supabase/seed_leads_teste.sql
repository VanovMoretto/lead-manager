-- =============================================================================
-- 11 leads fictícios para teste
-- Rodar no SQL Editor do Supabase.
--
-- São identificados pelo domínio @teste.exemplo.com (ou, no lead sem e-mail, pelo
-- telefone fictício (11) 96543-2109), o que permite apagá-los depois sem afetar
-- dados reais (veja o comando no final do arquivo).
-- Rodar de novo substitui os leads de teste anteriores.
--
-- As salas, meios de prospecção e motivos de perda são escolhidos entre as
-- opções ativas do Painel Admin; se uma categoria estiver vazia, usa nomes padrão.
-- =============================================================================
begin;

create temporary table seed_test_clients on commit drop as
  select distinct client_id from public.leads
  where (contact_email like '%@teste.exemplo.com' or contact_phone = '(11) 96543-2109') and client_id is not null;
delete from public.leads where (contact_email like '%@teste.exemplo.com' or contact_phone = '(11) 96543-2109');
delete from public.clients c
 where c.id in (select client_id from seed_test_clients)
   and not exists (select 1 from public.leads l where l.client_id = c.id);

with
rooms as (
  select coalesce(
    (select array_agg(label order by label) from public.app_settings_options where category = 'room' and active),
    array['Salão Principal', 'Sala de Reuniões', 'Área Externa', 'Salão Nobre']
  ) as list
),
origins as (
  select coalesce(
    (select array_agg(label order by label) from public.app_settings_options where category = 'origin' and active),
    array['Instagram', 'Indicação', 'Google', 'Site']
  ) as list
),
seed (
  n, dias_atras, nome, telefone, email, origem_idx, salas_idx,
  data_evento, sem_data, previsao,
  locacao, tem_ab, valor_ab, tem_hosp, valor_hosp,
  proposta_enviada, num_proposta, situacao, motivo, detalhe_motivo
) as (
  values
    -- Cliente recorrente: mesmo telefone/e-mail em dois orçamentos (testa o aviso e o mailing)
    (1,  58, 'Mariana Souza',      '(11) 98765-4321', 'mariana.souza@teste.exemplo.com', 1, '{1}'::int[],
         (current_date + 40), false, null::text,
         18000.00, true, 9500.00, false, 0.00,
         true, 'TESTE-2026-001', 'fechado', null::text, null::text),
    (2,  6,  'Mariana Souza',      '(11) 98765-4321', 'mariana.souza@teste.exemplo.com', 1, '{2,3}'::int[],
         null, true, 'Previsão para março',
         22000.00, true, 12000.00, true, 4800.00,
         true, 'TESTE-2026-002', 'em_aberto', null, null),

    (3,  45, 'Carlos Henrique Lima', '(21) 99876-1234', 'carlos.lima@teste.exemplo.com', 2, '{1,2}'::int[],
         (current_date + 75), false, null,
         35000.00, true, 21000.00, true, 6200.00,
         true, 'TESTE-2026-003', 'fechado', null, null),
    (4,  40, 'Fernanda Alves',     '(31) 3456-7890',  'fernanda.alves@teste.exemplo.com', 3, '{3}'::int[],
         (current_date + 20), false, null,
         12000.00, false, 0.00, false, 0.00,
         true, 'TESTE-2026-004', 'perdido', 'Achou alto o valor de locação', null),
    (5,  33, 'Rafael Costa',       '(11) 97654-3210', 'rafael.costa@teste.exemplo.com', 1, '{4}'::int[],
         null, true, 'Segundo semestre',
         8500.00, true, 5200.00, false, 0.00,
         false, null, 'perdido', 'Cliente não retornou contato', null),
    (6,  27, 'Juliana Rocha',      null,              'juliana.rocha@teste.exemplo.com', 2, '{2}'::int[],
         (current_date + 110), false, null,
         27000.00, true, 18500.00, true, 9900.00,
         true, 'TESTE-2026-006', 'perdido', 'Outros', 'Fechou com outro local mais próximo do centro'),
    (7,  21, 'Bruno Martins',      '(41) 99123-4567', 'bruno.martins@teste.exemplo.com', 4, '{1,3}'::int[],
         (current_date + 55), false, null,
         15000.00, false, 0.00, false, 0.00,
         false, null, 'em_aberto', null, null),
    (8,  14, 'Patrícia Gomes',     '(11) 96543-2109', null,                              3, '{}'::int[],
         null, true, 'Previsão para dezembro',
         null, false, 0.00, false, 0.00,
         false, null, 'em_aberto', null, null),
    (9,  9,  'Lucas Pereira',      '(51) 98888-7777', 'lucas.pereira@teste.exemplo.com', 1, '{4}'::int[],
         (current_date + 30), false, null,
         19500.00, true, 7800.00, false, 0.00,
         true, 'TESTE-2026-009', 'fechado', null, null),
    (10, 4,  'Aline Ribeiro',      '(11) 95432-1098', 'aline.ribeiro@teste.exemplo.com', 2, '{1}'::int[],
         (current_date + 90), false, null,
         42000.00, true, 26000.00, true, 15400.00,
         true, 'TESTE-2026-010', 'em_aberto', null, null),
    (11, 1,  'Diego Santos',       '(85) 99777-6666', 'diego.santos@teste.exemplo.com', 3, '{2}'::int[],
         null, true, 'Ainda sem data',
         9800.00, false, 0.00, false, 0.00,
         false, null, 'em_aberto', null, null)
)
insert into public.leads (
  created_at, updated_at,
  contact_name, contact_phone, contact_email,
  origin, room_interests,
  event_date, is_date_flexible, date_notes,
  proposed_value, has_ab, ab_value, has_lodging, lodging_value,
  proposal_sent, proposal_number, status, loss_reason, loss_reason_details
)
select
  now() - make_interval(days => s.dias_atras),
  now() - make_interval(days => greatest(s.dias_atras - 2, 0)),
  s.nome, s.telefone, s.email,
  o.list[((s.origem_idx - 1) % cardinality(o.list)) + 1],
  array(
    select distinct r.list[((i - 1) % cardinality(r.list)) + 1]
    from unnest(s.salas_idx) as i
  ),
  s.data_evento, s.sem_data, s.previsao,
  s.locacao, s.tem_ab, s.valor_ab, s.tem_hosp, s.valor_hosp,
  s.proposta_enviada, s.num_proposta, s.situacao, s.motivo, s.detalhe_motivo
from seed s
cross join rooms r
cross join origins o
order by s.n;

-- Empresa e evento de vários dias (migração 006): alguns leads de empresas, o resto pessoa física
update public.leads set company = 'Construtora Alfa', event_end_date = event_date + 2
 where contact_email = 'carlos.lima@teste.exemplo.com';
update public.leads set company = 'Construtora Alfa'
 where contact_email = 'lucas.pereira@teste.exemplo.com';
update public.leads set company = 'Banco Horizonte', event_end_date = event_date + 1
 where contact_email = 'aline.ribeiro@teste.exemplo.com';
update public.leads set company = 'Instituto Vida'
 where contact_email = 'fernanda.alves@teste.exemplo.com';

-- Observações da negociação (migração 007)
update public.leads set observations = 'Pediu duas opções de cardápio. Retornar até sexta com a proposta revisada.'
 where contact_email = 'carlos.lima@teste.exemplo.com';
update public.leads set observations = 'Decisão depende da aprovação da diretoria na próxima reunião.'
 where contact_email = 'aline.ribeiro@teste.exemplo.com';

-- Clientes e contatos (migração 009): agrupa de novo agora que as empresas foram definidas
update public.leads set client_id = null, contact_id = null
 where (contact_email like '%@teste.exemplo.com' or contact_phone = '(11) 96543-2109');
delete from public.clients c
 where not exists (select 1 from public.leads l where l.client_id = c.id)
   and exists (
     select 1 from public.client_contacts ct
     where ct.client_id = c.id and (ct.email like '%@teste.exemplo.com' or ct.phone = '(11) 96543-2109')
   );
select public.backfill_lead_clients();

commit;

-- Conferência
select contact_name, company, status, room_interest, event_date, event_end_date, total_value, created_at::date
from public.leads
where (contact_email like '%@teste.exemplo.com' or contact_phone = '(11) 96543-2109')
order by created_at;

-- Para apagar os leads de teste depois (e os clientes que ficaram sem proposta):
-- delete from public.leads where (contact_email like '%@teste.exemplo.com' or contact_phone = '(11) 96543-2109');
-- delete from public.clients c where not exists (select 1 from public.leads l where l.client_id = c.id)
--   and exists (select 1 from public.client_contacts ct where ct.client_id = c.id
--               and (ct.email like '%@teste.exemplo.com' or ct.phone = '(11) 96543-2109'));
