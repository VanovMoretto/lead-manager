/**
 * Estado, validação e payload do formulário de proposta. Usado pelo cadastro (modal de
 * Nova Proposta) e pela edição direta na página da proposta.
 */
import type { PostgrestError } from '@supabase/supabase-js'
import { CircleCheck, CircleX, Clock, type LucideIcon } from 'lucide-react'
import { cn } from './utils'
import { formatCNPJ, formatPhoneBR, isValidCNPJ, isValidEmail, isValidPhoneBR, onlyDigits, toCents } from './format'
import { computeNetValue, getLeadRooms, isCeremonialistOrigin } from './leadFields'
import type { RecurringClientMatch } from '../hooks/useRecurringClient'
import { CEREMONIALIST_ORIGIN, LOSS_REASON_OTHER, type Lead, type LeadInsert, type LeadStatus } from '../types/lead'

// =============================================================================
// Estado do formulário
// =============================================================================

export type FormState = {
  contact_name: string
  contact_phone: string
  contact_email: string
  /** Empresa do contato (vazio = pessoa física). */
  company: string
  cnpj: string
  /** Cliente pediu para não receber comunicações/mailing (LGPD). */
  marketing_opt_out: boolean
  origin: string
  /** Cerimonialista que indicou (só vale com o meio de prospecção "Cerimonialista"). */
  ceremonialist_id: string
  /** Salas marcadas (seleção múltipla). */
  room_interests: string[]
  /** Checkbox "Cliente ainda sem data definida" (coluna is_date_flexible). */
  no_date: boolean
  event_date: string
  /** Evento de mais de um dia: mostra a data final. */
  multi_day: boolean
  event_end_date: string
  date_notes: string
  /** Valores em centavos, para formatar a moeda sem erro de ponto flutuante. */
  /** Locação / Espaço (coluna proposed_value). */
  value_cents: number | null
  has_ab: boolean
  ab_cents: number | null
  has_lodging: boolean
  lodging_cents: number | null
  has_equipment: boolean
  equipment_cents: number | null
  has_parking: boolean
  parking_cents: number | null
  event_name: string
  /** Só dígitos (o campo aceita apenas números). */
  pax: string
  proposal_sent: boolean
  proposal_number: string
  status: LeadStatus
  loss_reason: string
  loss_reason_details: string
  /** Mostra o campo de detalhes mesmo quando o motivo não é "Outros". */
  show_loss_details: boolean
}

export type FieldName = keyof FormState
export type FormErrors = Partial<Record<FieldName, string>>

export function buildInitialState(lead?: Lead | null, presetClient?: RecurringClientMatch | null): FormState {
  // Proposta aberta pelo painel da cerimonialista: indicação dela, para um cliente novo
  const presetCeremonialist = !lead && presetClient?.client.client_type === 'ceremonialist' ? presetClient.client : null
  // Proposta para um cliente já cadastrado: começa com a empresa e o contato principal
  const presetContact = !lead && !presetCeremonialist ? presetClient?.contacts.find((contact) => contact.active) : undefined
  const presetCompany = !lead && presetClient?.client.client_type === 'company' ? presetClient.client.name : ''
  return {
    contact_name: lead?.contact_name ?? presetContact?.name ?? '',
    contact_phone: lead?.contact_phone ? formatPhoneBR(lead.contact_phone) : presetContact?.phone ? formatPhoneBR(presetContact.phone) : '',
    contact_email: lead?.contact_email ?? presetContact?.email ?? '',
    company: lead?.company ?? presetCompany,
    cnpj: lead?.cnpj ? formatCNPJ(lead.cnpj) : !lead && presetClient?.client.cnpj ? formatCNPJ(presetClient.client.cnpj) : '',
    marketing_opt_out: lead?.marketing_opt_out ?? false,
    origin: lead?.origin ?? (presetCeremonialist ? CEREMONIALIST_ORIGIN : ''),
    ceremonialist_id: lead?.ceremonialist_id ?? presetCeremonialist?.id ?? '',
    room_interests: lead ? [...getLeadRooms(lead)] : [],
    no_date: lead?.is_date_flexible ?? false,
    event_date: lead?.event_date ?? '',
    multi_day: Boolean(lead?.event_end_date),
    event_end_date: lead?.event_end_date ?? '',
    date_notes: lead?.date_notes ?? '',
    value_cents: toCents(lead?.proposed_value),
    has_ab: lead?.has_ab ?? false,
    ab_cents: lead?.has_ab ? toCents(lead.ab_value) ?? null : null,
    has_lodging: lead?.has_lodging ?? false,
    lodging_cents: lead?.has_lodging ? toCents(lead.lodging_value) ?? null : null,
    has_equipment: lead?.has_equipment ?? false,
    equipment_cents: lead?.has_equipment ? toCents(lead.equipment_value) ?? null : null,
    has_parking: lead?.has_parking ?? false,
    parking_cents: lead?.has_parking ? toCents(lead.parking_value) ?? null : null,
    event_name: lead?.event_name ?? '',
    pax: lead?.pax !== null && lead?.pax !== undefined ? String(lead.pax) : '',
    proposal_sent: lead?.proposal_sent ?? false,
    proposal_number: lead?.proposal_number ?? '',
    status: lead?.status ?? 'em_aberto',
    loss_reason: lead?.loss_reason ?? '',
    loss_reason_details: lead?.loss_reason_details ?? '',
    show_loss_details: Boolean(lead?.loss_reason_details),
  }
}

/** O número da proposta aparece quando a proposta foi enviada ou o lead fechou. */
export function needsProposalNumber(state: FormState): boolean {
  return state.proposal_sent || state.status === 'fechado'
}

export function needsLossDetails(state: FormState): boolean {
  return state.loss_reason === LOSS_REASON_OTHER || state.show_loss_details
}

export type ValidateOptions = {
  /** Proposta nova: locação, salas e data (quando há data) são obrigatórias. */
  requireCore: boolean
  /** Há salas cadastradas no Painel Admin para escolher. */
  hasRooms: boolean
}

export function validate(state: FormState, { requireCore, hasRooms }: ValidateOptions): FormErrors {
  const errors: FormErrors = {}

  if (!state.contact_name.trim()) {
    errors.contact_name = 'Informe o nome do contato.'
  }
  if (onlyDigits(state.contact_phone).length > 0 && !isValidPhoneBR(state.contact_phone)) {
    errors.contact_phone = 'Telefone incompleto. Use DDD + número.'
  }
  if (onlyDigits(state.cnpj).length > 0 && !isValidCNPJ(state.cnpj)) {
    errors.cnpj = 'CNPJ inválido. Confira os 14 dígitos.'
  }
  if (state.contact_email.trim() && !isValidEmail(state.contact_email)) {
    errors.contact_email = 'E-mail inválido.'
  }
  // Na ordem do formulário: o primeiro erro recebe o foco
  if (requireCore && hasRooms && state.room_interests.length === 0) {
    errors.room_interests = 'Selecione ao menos uma sala/salão.'
  }
  if (requireCore && !state.no_date && !state.event_date) {
    errors.event_date = state.multi_day ? 'Informe a data inicial.' : 'Informe a data de interesse ou marque "Cliente ainda sem data definida".'
  }
  if (!state.no_date && state.multi_day) {
    if (state.event_end_date && !state.event_date) {
      errors.event_date = 'Informe a data inicial.'
    } else if (state.event_date && !state.event_end_date) {
      errors.event_end_date = 'Informe a data final.'
    } else if (state.event_date && state.event_end_date && state.event_end_date < state.event_date) {
      errors.event_end_date = 'A data final precisa ser igual ou posterior à inicial.'
    }
  }
  if (requireCore && state.value_cents === null) {
    errors.value_cents = 'Informe o valor de locação / espaço.'
  }
  if (state.status === 'fechado' && !state.proposal_number.trim()) {
    errors.proposal_number = 'Informe o número da proposta para registrar o fechamento.'
  }
  if (state.status === 'perdido' && !state.loss_reason) {
    errors.loss_reason = 'Selecione o motivo da perda.'
  }
  if (state.status === 'perdido' && state.loss_reason === LOSS_REASON_OTHER && !state.loss_reason_details.trim()) {
    errors.loss_reason_details = 'Descreva o motivo.'
  }

  return errors
}

/** Monta o payload do banco, limpando campos que não se aplicam à situação escolhida. */
export function buildPayload(state: FormState, forceOptOut = false): LeadInsert {
  const isLost = state.status === 'perdido'
  const isClosed = state.status === 'fechado'
  const phoneDigits = onlyDigits(state.contact_phone)

  return {
    contact_name: state.contact_name.trim(),
    contact_phone: phoneDigits.length > 0 ? formatPhoneBR(phoneDigits) : null,
    contact_email: state.contact_email.trim() ? state.contact_email.trim().toLowerCase() : null,
    company: state.company.trim().replace(/\s+/g, ' ') || null,
    cnpj: isValidCNPJ(state.cnpj) ? formatCNPJ(state.cnpj) : null,
    marketing_opt_out: state.marketing_opt_out || forceOptOut,
    origin: state.origin || null,
    ceremonialist_id: isCeremonialistOrigin(state.origin) && state.ceremonialist_id ? state.ceremonialist_id : null,
    room_interests: state.room_interests,
    is_date_flexible: state.no_date,
    event_date: state.no_date ? null : state.event_date || null,
    // Mais de um dia só quando a data final é posterior à inicial; igual à inicial é evento de um dia
    event_end_date:
      !state.no_date && state.multi_day && state.event_date && state.event_end_date > state.event_date
        ? state.event_end_date
        : null,
    date_notes: state.no_date ? state.date_notes.trim() || null : null,
    proposed_value: state.value_cents === null ? null : state.value_cents / 100,
    has_ab: state.has_ab,
    // Desmarcou A&B/Hospedagem: o valor correspondente vai zerado
    ab_value: state.has_ab ? (state.ab_cents ?? 0) / 100 : 0,
    has_lodging: state.has_lodging,
    lodging_value: state.has_lodging ? (state.lodging_cents ?? 0) / 100 : 0,
    has_equipment: state.has_equipment,
    equipment_value: state.has_equipment ? (state.equipment_cents ?? 0) / 100 : 0,
    has_parking: state.has_parking,
    parking_value: state.has_parking ? (state.parking_cents ?? 0) / 100 : 0,
    event_name: state.event_name.trim().replace(/\s+/g, ' ') || null,
    pax: state.pax ? Number.parseInt(state.pax, 10) : null,
    // Lead fechado implica proposta enviada
    proposal_sent: state.proposal_sent || isClosed,
    proposal_number: needsProposalNumber(state) ? state.proposal_number.trim() || null : null,
    status: state.status,
    loss_reason: isLost ? state.loss_reason || null : null,
    loss_reason_details: isLost && needsLossDetails(state) ? state.loss_reason_details.trim() || null : null,
  }
}

/** Traduz erros do Postgres/PostgREST para mensagens úteis. */
export function translateDbError(error: PostgrestError): { message: string; field?: FieldName } {
  if (error.code === '23505' && error.message.includes('proposal_number')) {
    return { message: 'Já existe uma proposta com este número.', field: 'proposal_number' }
  }
  if (error.code === '23514') {
    if (error.message.includes('leads_loss_reason_required')) {
      return { message: 'Selecione o motivo da perda.', field: 'loss_reason' }
    }
    if (error.message.includes('leads_contact_name_not_blank')) {
      return { message: 'Informe o nome do contato.', field: 'contact_name' }
    }
    if (error.message.includes('leads_cnpj_digits_length')) {
      return { message: 'CNPJ inválido. Confira os 14 dígitos.', field: 'cnpj' }
    }
    if (error.message.includes('leads_text_lengths')) {
      return { message: 'Algum campo passou do tamanho máximo permitido. Encurte o texto e tente de novo.' }
    }
    if (error.message.includes('leads_event_period_valid')) {
      return { message: 'A data final precisa ser igual ou posterior à inicial.', field: 'event_end_date' }
    }
    if (error.message.includes('_value_non_negative')) {
      return { message: 'Os valores da proposta não podem ser negativos.' }
    }
    return { message: 'Algum campo tem um valor que o banco não aceitou. Revise o formulário.' }
  }
  if (error.code === 'P0001' && error.message.includes('Limite de requisições')) {
    return { message: 'Limite de requisições excedido. Aguarde um instante e tente de novo.' }
  }
  if (error.code === '42501') {
    return { message: 'Você não tem permissão para salvar este lead. Faça login novamente.' }
  }
  if (error.code === 'PGRST204' || error.code === '42703') {
    return { message: 'O banco de dados está desatualizado. Rode a migração 002 no SQL Editor do Supabase.' }
  }
  if (error.code === 'PGRST116') {
    return { message: 'Esta proposta não foi encontrada. Ela pode ter sido excluída por outra pessoa.' }
  }
  if (error.message.toLowerCase().includes('failed to fetch')) {
    return { message: 'Sem conexão com o servidor. Verifique sua internet e tente novamente.' }
  }
  return { message: 'Não foi possível salvar a proposta. Tente novamente.' }
}

/** Receita total da proposta em centavos: locação + A&B + hospedagem (só o que estiver marcado). */
export function computeTotalCents(state: FormState): number {
  return (
    (state.value_cents ?? 0) +
    (state.has_ab ? state.ab_cents ?? 0 : 0) +
    (state.has_lodging ? state.lodging_cents ?? 0 : 0) +
    (state.has_equipment ? state.equipment_cents ?? 0 : 0) +
    (state.has_parking ? state.parking_cents ?? 0 : 0)
  )
}

/** Receita Líquida do Hotel em centavos (mesma regra da coluna net_value do banco). */
export function computeNetCents(state: FormState): number {
  const reais = (cents: number | null, enabled = true) => (enabled ? (cents ?? 0) / 100 : 0)
  return Math.round(
    computeNetValue({
      rental: reais(state.value_cents),
      ab: reais(state.ab_cents, state.has_ab),
      lodging: reais(state.lodging_cents, state.has_lodging),
      equipment: reais(state.equipment_cents, state.has_equipment),
      parking: reais(state.parking_cents, state.has_parking),
    }) * 100,
  )
}

/** Garante que o valor atual apareça no select, mesmo que a opção tenha sido desativada. */
export function withCurrentValue(labels: string[], current: string): string[] {
  if (current && !labels.includes(current)) {
    return [current, ...labels]
  }
  return labels
}

export const inputBaseClassName = cn(
  'block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors',
  'placeholder:text-slate-400 focus:outline-none focus:ring-2',
  'dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500',
  'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:disabled:bg-slate-900 dark:disabled:text-slate-400',
  'disabled:cursor-not-allowed disabled:opacity-60',
)

export function inputClassName(hasError: boolean) {
  return cn(
    inputBaseClassName,
    hasError
      ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20 dark:border-red-700'
      : 'border-slate-200 focus:border-brand-600 focus:ring-brand-600/20 dark:border-slate-700',
  )
}


export type StatusOption = {
  value: LeadStatus
  title: string
  subtitle: string
  icon: LucideIcon
  selectedClassName: string
  iconClassName: string
}

export const STATUS_OPTIONS: StatusOption[] = [
  {
    value: 'em_aberto',
    title: 'Em Aberto',
    subtitle: 'Negociação',
    icon: Clock,
    selectedClassName: 'border-amber-400 bg-amber-50 ring-2 ring-amber-400/30 dark:border-amber-500 dark:bg-amber-950/30',
    iconClassName: 'text-amber-600 dark:text-amber-400',
  },
  {
    value: 'fechado',
    title: 'Fechou',
    subtitle: 'Fechado',
    icon: CircleCheck,
    selectedClassName: 'border-emerald-500 bg-emerald-50 ring-2 ring-emerald-500/30 dark:border-emerald-500 dark:bg-emerald-950/30',
    iconClassName: 'text-emerald-600 dark:text-emerald-400',
  },
  {
    value: 'perdido',
    title: 'Não Fechou',
    subtitle: 'Perdido',
    icon: CircleX,
    selectedClassName: 'border-red-400 bg-red-50 ring-2 ring-red-400/30 dark:border-red-500 dark:bg-red-950/30',
    iconClassName: 'text-red-600 dark:text-red-400',
  },
]

export const NEW_CEREMONIALIST = '__nova__'

/** Estado da navegação para a página da proposta: abre a edição ou já marca Fechou/Perdeu. */
export type ProposalPageState = { edit?: boolean; status?: Extract<LeadStatus, 'fechado' | 'perdido'> }
