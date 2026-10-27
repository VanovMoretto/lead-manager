import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  BedDouble,
  Check,
  Calculator,
  CalendarDays,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  LoaderCircle,
  MapPin,
  Pencil,
  RefreshCw,
  User,
  UserPlus,
  Trash2,
  UtensilsCrossed,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import {
  formatCentsBRL,
  formatPhoneBR,
  isValidEmail,
  isValidPhoneBR,
  onlyDigits,
  parseCurrencyInputToCents,
  toCents,
} from '../lib/format'
import { useSettingsOptions } from '../hooks/useSettingsOptions'
import { countEventDays, getLeadRooms } from '../lib/leadFields'
import RecurringClientNotice from './RecurringClientNotice'
import { useAuth } from '../contexts/AuthContext'
import { useRecurringClient } from '../hooks/useRecurringClient'
import { useCompanies } from '../hooks/useCompanies'
import { fetchLeadAttachmentPaths, removeAttachmentFiles } from '../lib/leadAttachments'
import { RateLimitError, guardMutation } from '../lib/rateLimit'
import {
  DEFAULT_LOSS_REASONS,
  LOSS_REASON_OTHER,
  type Lead,
  type LeadInsert,
  type LeadStatus,
} from '../types/lead'

// =============================================================================
// Tipos públicos
// =============================================================================

export type LeadFormMode = 'create' | 'edit'

type LeadFormModalProps = {
  open: boolean
  onClose: () => void
  /** Lead a editar. Sem ele, o modal cadastra um lead novo. */
  lead?: Lead | null
  /** Chamado após salvar com sucesso, com a linha retornada pelo banco. */
  onSaved?: (lead: Lead, mode: LeadFormMode) => void
  /** Chamado após excluir o lead (só no modo edição). */
  onDeleted?: (lead: Lead) => void
}

// =============================================================================
// Estado do formulário
// =============================================================================

type FormState = {
  contact_name: string
  contact_phone: string
  contact_email: string
  /** Empresa do contato (vazio = pessoa física). */
  company: string
  /** Cliente pediu para não receber comunicações/mailing (LGPD). */
  marketing_opt_out: boolean
  origin: string
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
  proposal_sent: boolean
  proposal_number: string
  status: LeadStatus
  loss_reason: string
  loss_reason_details: string
  /** Mostra o campo de detalhes mesmo quando o motivo não é "Outros". */
  show_loss_details: boolean
}

type FieldName = keyof FormState
type FormErrors = Partial<Record<FieldName, string>>

function buildInitialState(lead?: Lead | null): FormState {
  return {
    contact_name: lead?.contact_name ?? '',
    contact_phone: lead?.contact_phone ? formatPhoneBR(lead.contact_phone) : '',
    contact_email: lead?.contact_email ?? '',
    company: lead?.company ?? '',
    marketing_opt_out: lead?.marketing_opt_out ?? false,
    origin: lead?.origin ?? '',
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
    proposal_sent: lead?.proposal_sent ?? false,
    proposal_number: lead?.proposal_number ?? '',
    status: lead?.status ?? 'em_aberto',
    loss_reason: lead?.loss_reason ?? '',
    loss_reason_details: lead?.loss_reason_details ?? '',
    show_loss_details: Boolean(lead?.loss_reason_details),
  }
}

/** O número da proposta aparece quando a proposta foi enviada ou o lead fechou. */
function needsProposalNumber(state: FormState): boolean {
  return state.proposal_sent || state.status === 'fechado'
}

function needsLossDetails(state: FormState): boolean {
  return state.loss_reason === LOSS_REASON_OTHER || state.show_loss_details
}

function validate(state: FormState): FormErrors {
  const errors: FormErrors = {}

  if (!state.contact_name.trim()) {
    errors.contact_name = 'Informe o nome do contato.'
  }
  if (onlyDigits(state.contact_phone).length > 0 && !isValidPhoneBR(state.contact_phone)) {
    errors.contact_phone = 'Telefone incompleto. Use DDD + número.'
  }
  if (state.contact_email.trim() && !isValidEmail(state.contact_email)) {
    errors.contact_email = 'E-mail inválido.'
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
function buildPayload(state: FormState, forceOptOut = false): LeadInsert {
  const isLost = state.status === 'perdido'
  const isClosed = state.status === 'fechado'
  const phoneDigits = onlyDigits(state.contact_phone)

  return {
    contact_name: state.contact_name.trim(),
    contact_phone: phoneDigits.length > 0 ? formatPhoneBR(phoneDigits) : null,
    contact_email: state.contact_email.trim() ? state.contact_email.trim().toLowerCase() : null,
    company: state.company.trim().replace(/\s+/g, ' ') || null,
    marketing_opt_out: state.marketing_opt_out || forceOptOut,
    origin: state.origin || null,
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
    // Lead fechado implica proposta enviada
    proposal_sent: state.proposal_sent || isClosed,
    proposal_number: needsProposalNumber(state) ? state.proposal_number.trim() || null : null,
    status: state.status,
    loss_reason: isLost ? state.loss_reason || null : null,
    loss_reason_details: isLost && needsLossDetails(state) ? state.loss_reason_details.trim() || null : null,
  }
}

/** Traduz erros do Postgres/PostgREST para mensagens úteis. */
function translateDbError(error: PostgrestError): { message: string; field?: FieldName } {
  if (error.code === '23505' && error.message.includes('proposal_number')) {
    return { message: 'Já existe um lead com este número de proposta.', field: 'proposal_number' }
  }
  if (error.code === '23514') {
    if (error.message.includes('leads_loss_reason_required')) {
      return { message: 'Selecione o motivo da perda.', field: 'loss_reason' }
    }
    if (error.message.includes('leads_contact_name_not_blank')) {
      return { message: 'Informe o nome do contato.', field: 'contact_name' }
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
    return { message: 'Este lead não foi encontrado. Ele pode ter sido excluído por outra pessoa.' }
  }
  if (error.message.toLowerCase().includes('failed to fetch')) {
    return { message: 'Sem conexão com o servidor. Verifique sua internet e tente novamente.' }
  }
  return { message: 'Não foi possível salvar o lead. Tente novamente.' }
}

/** Receita total da proposta em centavos: locação + A&B + hospedagem (só o que estiver marcado). */
function computeTotalCents(state: FormState): number {
  return (state.value_cents ?? 0) + (state.has_ab ? state.ab_cents ?? 0 : 0) + (state.has_lodging ? state.lodging_cents ?? 0 : 0)
}

/** Garante que o valor atual apareça no select, mesmo que a opção tenha sido desativada. */
function withCurrentValue(labels: string[], current: string): string[] {
  if (current && !labels.includes(current)) {
    return [current, ...labels]
  }
  return labels
}

// =============================================================================
// Componentes visuais internos
// =============================================================================

const inputBaseClassName = cn(
  'block w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors',
  'placeholder:text-slate-400 focus:outline-none focus:ring-2',
  'dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500',
  'disabled:cursor-not-allowed disabled:opacity-60',
)

function inputClassName(hasError: boolean) {
  return cn(
    inputBaseClassName,
    hasError
      ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20 dark:border-red-700'
      : 'border-slate-200 focus:border-brand-600 focus:ring-brand-600/20 dark:border-slate-700',
  )
}

type FieldProps = {
  label: string
  htmlFor: string
  required?: boolean
  error?: string
  hint?: string
  className?: string
  children: ReactNode
}

function Field({ label, htmlFor, required, error, hint, className, children }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      )}
    </div>
  )
}

type SectionProps = {
  icon: LucideIcon
  title: string
  children: ReactNode
}

function Section({ icon: Icon, title, children }: SectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">{title}</h3>
      </div>
      {children}
    </section>
  )
}

type MoneyInputProps = {
  id: string
  cents: number | null
  onChange: (cents: number | null) => void
}

/** Campo de moeda em R$: os dígitos entram da direita (centavos primeiro). */
function MoneyInput({ id, cents, onChange }: MoneyInputProps) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="R$ 0,00"
      value={cents === null ? '' : formatCentsBRL(cents)}
      onChange={(event) => onChange(parseCurrencyInputToCents(event.target.value))}
      className={cn(inputClassName(false), 'tabular-nums')}
    />
  )
}

type YesNoToggleProps = {
  id: string
  label: string
  icon?: LucideIcon
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
}

/** Botões Sim/Não lado a lado: um clique e pronto. */
function YesNoToggle({ id, label, icon: Icon, value, onChange, disabled }: YesNoToggleProps) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
      <span id={`${id}-label`} className="flex min-w-0 items-center gap-2 text-sm font-medium leading-tight text-slate-700 dark:text-slate-200">
        {Icon && <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />}
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
      >
        {[
          { optionValue: true, text: 'Sim' },
          { optionValue: false, text: 'Não' },
        ].map(({ optionValue, text }) => {
          const selected = value === optionValue
          return (
            <button
              key={text}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(optionValue)}
              className={cn(
                'min-w-[2.75rem] rounded-md px-2.5 py-1 text-sm font-semibold transition-colors disabled:cursor-not-allowed',
                selected
                  ? optionValue
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              {text}
            </button>
          )
        })}
      </div>
    </div>
  )
}

type StatusOption = {
  value: LeadStatus
  title: string
  subtitle: string
  icon: LucideIcon
  selectedClassName: string
  iconClassName: string
}

const STATUS_OPTIONS: StatusOption[] = [
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

// =============================================================================
// Formulário (remontado a cada abertura, para sempre começar limpo)
// =============================================================================

type LeadFormProps = {
  lead: Lead | null
  onCancel: () => void
  onSaved?: (lead: Lead, mode: LeadFormMode) => void
  onDeleted?: (lead: Lead) => void
  /** Pede um formulário novo e vazio (usado em "Salvar e cadastrar outro"). */
  onRequestReset: () => void
  /** Informa ao modal se há alterações não salvas e se está salvando. */
  onStateChange: (state: { dirty: boolean; submitting: boolean }) => void
}

function LeadForm({ lead, onCancel, onSaved, onDeleted, onRequestReset, onStateChange }: LeadFormProps) {
  const mode: LeadFormMode = lead ? 'edit' : 'create'
  // Excluir lead é exclusivo do ADMIN (o banco também recusa a exclusão de quem não é)
  const { isAdmin } = useAuth()
  const initialState = useMemo(() => buildInitialState(lead), [lead])

  const [form, setForm] = useState<FormState>(initialState)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  /** Salvando ou excluindo: trava os botões e o fechamento do modal. */
  const busy = submitting || deleting
  const submitIntentRef = useRef<'close' | 'new'>('close')

  const { options, loading: optionsLoading, error: optionsError, reload: reloadOptions } = useSettingsOptions()

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialState), [form, initialState])

  useEffect(() => {
    onStateChange({ dirty, submitting: busy })
  }, [dirty, busy, onStateChange])

  const originLabels = useMemo(
    () => withCurrentValue(options.origin.map((option) => option.label), form.origin),
    [options.origin, form.origin],
  )
  // Salas ativas + salas já marcadas no lead que tenham sido desativadas depois
  const roomLabels = useMemo(() => {
    const active = options.room.map((option) => option.label)
    const missing = form.room_interests.filter((room) => !active.includes(room))
    return [...missing, ...active]
  }, [options.room, form.room_interests])

  const toggleRoom = (room: string) => {
    setForm((current) => ({
      ...current,
      room_interests: current.room_interests.includes(room)
        ? current.room_interests.filter((item) => item !== room)
        : [...current.room_interests, room],
    }))
    if (submitError) setSubmitError(null)
  }

  /** Liga/desliga A&B ou Hospedagem; ao desligar, zera o valor; ao ligar, foca o campo de valor. */
  const toggleExtra = (kind: 'ab' | 'lodging', enabled: boolean) => {
    setForm((current) =>
      kind === 'ab'
        ? { ...current, has_ab: enabled, ab_cents: enabled ? current.ab_cents : null }
        : { ...current, has_lodging: enabled, lodging_cents: enabled ? current.lodging_cents : null },
    )
    if (enabled) pendingFocusRef.current = `lead-${kind}_cents`
  }

  // Foca o campo de valor recém-exibido (depois que o React o desenhou)
  const pendingFocusRef = useRef<string | null>(null)
  useEffect(() => {
    if (!pendingFocusRef.current) return
    document.getElementById(pendingFocusRef.current)?.focus()
    pendingFocusRef.current = null
  }, [form.has_ab, form.has_lodging])

  const totalCents = computeTotalCents(form)
  const eventDays = form.multi_day
    ? countEventDays({ event_date: form.event_date || null, event_end_date: form.event_end_date || null })
    : null
  // Empresas já cadastradas, sugeridas no campo Empresa
  const { companies } = useCompanies()

  // Opt-out por contato (LGPD): no cadastro, consulta leads anteriores e a lista de supressão
  const recurring = useRecurringClient({
    phone: form.contact_phone,
    email: form.contact_email,
    enabled: mode === 'create',
  })
  /** Contato já suprimido: o lead novo nasce com opt-out (o banco também garante isso). */
  const optOutForced = mode === 'create' && recurring.suppressed
  const optOutRevoking = mode === 'edit' && initialState.marketing_opt_out && !form.marketing_opt_out
  const optOutHint = optOutForced
    ? 'Marcado automaticamente: o contato está na lista de opt-out.'
    : form.marketing_opt_out && !initialState.marketing_opt_out
      ? 'Vale para todos os leads com o mesmo e-mail ou telefone, inclusive os futuros, e continua valendo se este lead for excluído.'
      : null
  const lossReasonLabels = useMemo(() => {
    // Usa os motivos do Painel Admin; se não houver nenhum, cai nos motivos padrão
    const fromDb = options.loss_reason.map((option) => option.label)
    const base = fromDb.length > 0 ? fromDb : [...DEFAULT_LOSS_REASONS]
    // "Outros" sempre por último
    const sorted = [...base.filter((label) => label !== LOSS_REASON_OTHER), ...base.filter((label) => label === LOSS_REASON_OTHER)]
    return withCurrentValue(sorted, form.loss_reason)
  }, [options.loss_reason, form.loss_reason])

  const update = <K extends FieldName>(field: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }))
    }
    if (submitError) setSubmitError(null)
  }

  const handleStatusChange = (status: LeadStatus) => {
    setForm((current) => ({
      ...current,
      status,
      // Fechou: a proposta com certeza foi enviada
      proposal_sent: status === 'fechado' ? true : current.proposal_sent,
    }))
    setErrors((current) => ({
      ...current,
      proposal_number: undefined,
      loss_reason: undefined,
      loss_reason_details: undefined,
    }))
    setSubmitError(null)
  }

  const focusField = (field: FieldName) => {
    const element = document.getElementById(`lead-${field}`)
    if (element) {
      element.focus()
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    const validationErrors = validate(form)
    const firstError = Object.keys(validationErrors)[0] as FieldName | undefined
    if (firstError) {
      setErrors(validationErrors)
      setSubmitError('Revise os campos destacados.')
      focusField(firstError)
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    const payload = buildPayload(form, optOutForced)
    let response
    try {
      // Mesmo envio repetido em menos de 1,5 s (duplo clique, Enter segurado) é recusado
      response = await guardMutation(`lead:save:${lead?.id ?? 'novo'}:${JSON.stringify(payload)}`, async () =>
        lead
          ? await supabase.from('leads').update(payload).eq('id', lead.id).select().single()
          : await supabase.from('leads').insert(payload).select().single(),
      )
    } catch (guardError) {
      setSubmitting(false)
      if (guardError instanceof RateLimitError) setSubmitError(guardError.message)
      return
    }

    setSubmitting(false)

    if (response.error) {
      const translated = translateDbError(response.error)
      setSubmitError(translated.message)
      if (translated.field) {
        setErrors((current) => ({ ...current, [translated.field as FieldName]: translated.message }))
        focusField(translated.field)
      }
      return
    }

    onSaved?.(response.data, mode)

    if (submitIntentRef.current === 'new' && mode === 'create') {
      onRequestReset()
    } else {
      onCancel()
    }
  }

  const handleDelete = async () => {
    if (!lead || busy) return
    const confirmed = window.confirm(
      `Excluir o lead "${lead.contact_name}"?\n\nEssa ação é permanente e remove todos os dados deste orçamento, inclusive os anexos.`,
    )
    if (!confirmed) return

    setDeleting(true)
    setSubmitError(null)
    // Os arquivos anexados saem do bucket junto com o lead
    const attachmentPaths = await fetchLeadAttachmentPaths(lead.id)
    // .select() devolve as linhas apagadas: lista vazia = nada foi excluído (lead inexistente ou sem permissão)
    const { data, error } = await supabase.from('leads').delete().eq('id', lead.id).select('id')
    setDeleting(false)

    if (error) {
      setSubmitError(
        error.message.toLowerCase().includes('failed to fetch')
          ? 'Sem conexão com o servidor. O lead não foi excluído.'
          : 'Não foi possível excluir o lead. Tente novamente.',
      )
      return
    }
    if (!data || data.length === 0) {
      setSubmitError('Este lead não foi excluído: ele já não existe ou apenas o ADMIN pode excluir leads.')
      return
    }

    await removeAttachmentFiles(attachmentPaths)
    onDeleted?.(lead)
    onCancel()
  }

  const showProposalNumber = needsProposalNumber(form)
  const isLost = form.status === 'perdido'
  const isOtherReason = form.loss_reason === LOSS_REASON_OTHER

  return (
    <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-8 overflow-y-auto px-5 py-6 sm:px-6">
        {optionsError && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            <span className="flex items-center gap-2">
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              {optionsError}
            </span>
            <button
              type="button"
              onClick={() => void reloadOptions()}
              className="inline-flex shrink-0 items-center gap-1 font-semibold hover:underline"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Tentar de novo
            </button>
          </div>
        )}

        {/* 1. Dados do contato */}
        <Section icon={User} title="Contato">
          <Field label="Nome do contato" htmlFor="lead-contact_name" required error={errors.contact_name}>
            <input
              id="lead-contact_name"
              type="text"
              maxLength={150}
              autoFocus
              autoComplete="off"
              placeholder="Ex.: Nome do contato"
              value={form.contact_name}
              onChange={(event) => update('contact_name', event.target.value)}
              aria-invalid={Boolean(errors.contact_name)}
              aria-describedby={errors.contact_name ? 'lead-contact_name-error' : undefined}
              className={inputClassName(Boolean(errors.contact_name))}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Telefone / WhatsApp" htmlFor="lead-contact_phone" error={errors.contact_phone}>
              <input
                id="lead-contact_phone"
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Ex.: (51) 99999-8888"
                value={form.contact_phone}
                onChange={(event) => update('contact_phone', formatPhoneBR(event.target.value))}
                aria-invalid={Boolean(errors.contact_phone)}
                aria-describedby={errors.contact_phone ? 'lead-contact_phone-error' : undefined}
                className={inputClassName(Boolean(errors.contact_phone))}
              />
            </Field>
            <Field label="E-mail" htmlFor="lead-contact_email" error={errors.contact_email}>
              <input
                id="lead-contact_email"
                type="email"
                maxLength={254}
                autoComplete="off"
                placeholder="Ex.: email@dominio.com.br"
                value={form.contact_email}
                onChange={(event) => update('contact_email', event.target.value)}
                aria-invalid={Boolean(errors.contact_email)}
                aria-describedby={errors.contact_email ? 'lead-contact_email-error' : undefined}
                className={inputClassName(Boolean(errors.contact_email))}
              />
            </Field>
          </div>

          <Field label="Empresa" htmlFor="lead-company" hint="Deixe em branco se o cliente for pessoa física.">
            <input
              id="lead-company"
              type="text"
              autoComplete="off"
              maxLength={120}
              list="lead-company-options"
              placeholder="Ex.: Empresa / Organização"
              value={form.company}
              onChange={(event) => update('company', event.target.value)}
              className={inputClassName(false)}
            />
            <datalist id="lead-company-options">
              {companies.map((company) => (
                <option key={company} value={company} />
              ))}
            </datalist>
          </Field>

          {/* Só no cadastro: avisa cliente recorrente e opt-out da LGPD do contato (não bloqueia) */}
          {mode === 'create' && (
            <RecurringClientNotice checking={recurring.checking} match={recurring.match} suppressed={recurring.suppressed} />
          )}

          <div>
            <label
              className={cn(
                'flex w-fit items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300',
                optOutForced ? 'cursor-not-allowed' : 'cursor-pointer',
              )}
            >
              <input
                type="checkbox"
                checked={form.marketing_opt_out || optOutForced}
                disabled={optOutForced}
                onChange={(event) => update('marketing_opt_out', event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
              />
              <span>
                Cliente solicitou não receber comunicações/mailing{' '}
                <span className="text-xs font-medium text-slate-400 dark:text-slate-500">(Opt-out LGPD)</span>
              </span>
            </label>
            {optOutHint && <p className="mt-1 pl-[1.625rem] text-xs text-slate-500 dark:text-slate-400">{optOutHint}</p>}
            {optOutRevoking && (
              <p role="alert" className="mt-1.5 pl-[1.625rem] text-xs font-medium text-amber-700 dark:text-amber-400">
                Ao salvar, o opt-out deixa de valer para todos os leads com o mesmo e-mail ou telefone deste lead. Faça isso
                apenas se o cliente deu novo consentimento.
              </p>
            )}
          </div>
        </Section>

        {/* 2. Origem e espaço */}
        <Section icon={MapPin} title="Origem e Espaço">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Meio de prospecção"
              htmlFor="lead-origin"
              hint={!optionsLoading && originLabels.length === 0 ? 'Nenhuma opção cadastrada. Configure no Painel Admin.' : undefined}
            >
              <select
                id="lead-origin"
                value={form.origin}
                onChange={(event) => update('origin', event.target.value)}
                disabled={optionsLoading}
                className={inputClassName(false)}
              >
                <option value="">{optionsLoading ? 'Carregando...' : 'Selecione'}</option>
                {originLabels.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {/* Salas: seleção múltipla com chips clicáveis */}
          <div role="group" aria-labelledby="lead-rooms-label">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <p id="lead-rooms-label" className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Salas/Salões de interesse
              </p>
              {form.room_interests.length > 0 && (
                <span className="text-xs font-medium text-brand-700 dark:text-brand-300">
                  {form.room_interests.length} selecionada{form.room_interests.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {optionsLoading ? (
              <div className="flex flex-wrap gap-2" aria-hidden="true">
                {Array.from({ length: 3 }, (_, index) => (
                  <span key={index} className="h-9 w-32 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
                ))}
              </div>
            ) : roomLabels.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">Nenhuma sala cadastrada. Configure no Painel Admin.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {roomLabels.map((room) => {
                  const checked = form.room_interests.includes(room)
                  return (
                    <button
                      key={room}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => toggleRoom(room)}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900',
                        checked
                          ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:bg-brand-900/30',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded border',
                          checked ? 'border-white bg-white text-brand-600' : 'border-slate-300 dark:border-slate-600',
                        )}
                        aria-hidden="true"
                      >
                        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      {room}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </Section>

        {/* 3. Data e escopo */}
        <Section icon={CalendarDays} title="Data e Escopo">
          <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={form.no_date}
              onChange={(event) => update('no_date', event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600 dark:border-slate-600 dark:bg-slate-900"
            />
            Cliente ainda sem data definida
          </label>

          {form.no_date ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Previsão / Mês de interesse" htmlFor="lead-date_notes">
                <input
                  id="lead-date_notes"
                  type="text"
                  maxLength={80}
                  placeholder="Ex.: Mês/Ano previsto"
                  value={form.date_notes}
                  onChange={(event) => update('date_notes', event.target.value)}
                  className={inputClassName(false)}
                />
              </Field>
            </div>
          ) : (
            <div className="space-y-3">
              <div role="radiogroup" aria-label="Duração do evento" className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                {[
                  { value: false, label: 'Um dia' },
                  { value: true, label: 'Mais de um dia' },
                ].map((option) => {
                  const selected = form.multi_day === option.value
                  return (
                    <button
                      key={option.label}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => update('multi_day', option.value)}
                      className={cn(
                        'rounded-md px-3 py-1 text-sm font-semibold transition-colors',
                        selected
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white'
                          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label={form.multi_day ? 'Data inicial' : 'Data de interesse'}
                  htmlFor="lead-event_date"
                  error={errors.event_date}
                >
                  <input
                    id="lead-event_date"
                    type="date"
                    value={form.event_date}
                    max={form.multi_day && form.event_end_date ? form.event_end_date : undefined}
                    onChange={(event) => update('event_date', event.target.value)}
                    aria-invalid={Boolean(errors.event_date)}
                    className={inputClassName(Boolean(errors.event_date))}
                  />
                </Field>
                {form.multi_day && (
                  <Field
                    label="Data final"
                    htmlFor="lead-event_end_date"
                    error={errors.event_end_date}
                    hint={eventDays && eventDays > 1 ? `${eventDays} dias de evento` : undefined}
                  >
                    <input
                      id="lead-event_end_date"
                      type="date"
                      value={form.event_end_date}
                      min={form.event_date || undefined}
                      onChange={(event) => update('event_end_date', event.target.value)}
                      aria-invalid={Boolean(errors.event_end_date)}
                      className={inputClassName(Boolean(errors.event_end_date))}
                    />
                  </Field>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Valor de Locação / Espaço (R$)" htmlFor="lead-value_cents">
              <MoneyInput id="lead-value_cents" cents={form.value_cents} onChange={(cents) => update('value_cents', cents)} />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-start">
            <div className="space-y-2">
              <YesNoToggle
                id="lead-has_ab"
                label="Inclui A&B?"
                icon={UtensilsCrossed}
                value={form.has_ab}
                onChange={(value) => toggleExtra('ab', value)}
              />
              {form.has_ab && (
                <Field label="Valor de A&B (R$)" htmlFor="lead-ab_cents">
                  <MoneyInput id="lead-ab_cents" cents={form.ab_cents} onChange={(cents) => update('ab_cents', cents)} />
                </Field>
              )}
            </div>
            <div className="space-y-2">
              <YesNoToggle
                id="lead-has_lodging"
                label="Inclui Hospedagem?"
                icon={BedDouble}
                value={form.has_lodging}
                onChange={(value) => toggleExtra('lodging', value)}
              />
              {form.has_lodging && (
                <Field label="Valor de Hospedagem (R$)" htmlFor="lead-lodging_cents">
                  <MoneyInput
                    id="lead-lodging_cents"
                    cents={form.lodging_cents}
                    onChange={(cents) => update('lodging_cents', cents)}
                  />
                </Field>
              )}
            </div>
          </div>

          {/* Resumo calculado em tempo real */}
          <div
            className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-brand-900/60 dark:bg-brand-900/20"
            aria-live="polite"
          >
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
                <Calculator className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="leading-tight">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-200">Receita Total da Proposta</p>
                <p className="text-xs text-brand-700/80 dark:text-brand-300/80">
                  Locação {formatCentsBRL(form.value_cents ?? 0)}
                  {form.has_ab && ` + A&B ${formatCentsBRL(form.ab_cents ?? 0)}`}
                  {form.has_lodging && ` + Hospedagem ${formatCentsBRL(form.lodging_cents ?? 0)}`}
                </p>
              </div>
            </div>
            <p className="text-2xl font-bold tabular-nums text-brand-900 dark:text-white">{formatCentsBRL(totalCents)}</p>
          </div>
        </Section>

        {/* 4. Proposta e fechamento */}
        <Section icon={FileText} title="Proposta e Situação">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
            <YesNoToggle
              id="lead-proposal_sent"
              label="Proposta formal enviada?"
              icon={FileText}
              value={form.proposal_sent}
              onChange={(value) => update('proposal_sent', value)}
            />
            {showProposalNumber && (
              <Field
                label="Número da proposta"
                htmlFor="lead-proposal_number"
                required={form.status === 'fechado'}
                error={errors.proposal_number}
              >
                <input
                  id="lead-proposal_number"
                  type="text"
                  maxLength={50}
                  autoComplete="off"
                  placeholder="Ex.: Número da proposta"
                  value={form.proposal_number}
                  onChange={(event) => update('proposal_number', event.target.value)}
                  aria-invalid={Boolean(errors.proposal_number)}
                  aria-describedby={errors.proposal_number ? 'lead-proposal_number-error' : undefined}
                  className={inputClassName(Boolean(errors.proposal_number))}
                />
              </Field>
            )}
          </div>

          <div>
            <p id="lead-status-label" className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              Situação atual
            </p>
            <div role="radiogroup" aria-labelledby="lead-status-label" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {STATUS_OPTIONS.map(({ value, title, subtitle, icon: Icon, selectedClassName, iconClassName }) => {
                const selected = form.status === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleStatusChange(value)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-all',
                      selected
                        ? selectedClassName
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-slate-600 dark:hover:bg-slate-900',
                    )}
                  >
                    <Icon className={cn('h-5 w-5 shrink-0', selected ? iconClassName : 'text-slate-400')} aria-hidden="true" />
                    <span className="leading-tight">
                      <span className="block text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{subtitle}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {isLost && (
            <div className="space-y-4 rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-900/50 dark:bg-red-950/20">
              <Field label="Por qual motivo?" htmlFor="lead-loss_reason" required error={errors.loss_reason}>
                <select
                  id="lead-loss_reason"
                  value={form.loss_reason}
                  onChange={(event) => update('loss_reason', event.target.value)}
                  disabled={optionsLoading}
                  aria-invalid={Boolean(errors.loss_reason)}
                  aria-describedby={errors.loss_reason ? 'lead-loss_reason-error' : undefined}
                  className={inputClassName(Boolean(errors.loss_reason))}
                >
                  <option value="">{optionsLoading ? 'Carregando...' : 'Selecione o motivo'}</option>
                  {lossReasonLabels.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>

              {isOtherReason || form.show_loss_details ? (
                <Field
                  label={isOtherReason ? 'Descreva o motivo' : 'Detalhes (opcional)'}
                  htmlFor="lead-loss_reason_details"
                  required={isOtherReason}
                  error={errors.loss_reason_details}
                >
                  <textarea
                    id="lead-loss_reason_details"
                    rows={3}
                    maxLength={2000}
                    placeholder="Descreva o motivo da perda"
                    value={form.loss_reason_details}
                    onChange={(event) => update('loss_reason_details', event.target.value)}
                    aria-invalid={Boolean(errors.loss_reason_details)}
                    aria-describedby={errors.loss_reason_details ? 'lead-loss_reason_details-error' : undefined}
                    className={cn(inputClassName(Boolean(errors.loss_reason_details)), 'resize-y')}
                  />
                </Field>
              ) : (
                <button
                  type="button"
                  onClick={() => update('show_loss_details', true)}
                  className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  + Adicionar detalhes
                </button>
              )}
            </div>
          )}
        </Section>
      </div>

      {/* Rodapé fixo com ações */}
      <footer className="border-t border-slate-200 bg-white px-5 py-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
        {submitError && (
          <div
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{submitError}</span>
          </div>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          {mode === 'edit' && isAdmin ? (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={busy}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
            >
              {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              {deleting ? 'Excluindo...' : 'Excluir lead'}
            </button>
          ) : (
            <span className="hidden sm:block" aria-hidden="true" />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          {mode === 'create' && (
            <button
              type="submit"
              disabled={busy}
              onClick={() => {
                submitIntentRef.current = 'new'
              }}
              className="rounded-lg border border-brand-200 px-4 py-2.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:opacity-60 dark:border-brand-800 dark:text-brand-300 dark:hover:bg-brand-900/30"
            >
              Salvar e cadastrar outro
            </button>
          )}
          <button
            type="submit"
            disabled={busy}
            onClick={() => {
              submitIntentRef.current = 'close'
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? 'Salvando...' : mode === 'create' ? 'Cadastrar lead' : 'Salvar alterações'}
          </button>
          </div>
        </div>
      </footer>
    </form>
  )
}

// =============================================================================
// Modal (painel lateral)
// =============================================================================

export default function LeadFormModal({ open, onClose, lead = null, onSaved, onDeleted }: LeadFormModalProps) {
  // A cada abertura, gera uma nova chave para remontar o formulário limpo
  const [sessionKey, setSessionKey] = useState(open ? 1 : 0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSessionKey((current) => current + 1)
  }

  const formStateRef = useRef({ dirty: false, submitting: false })
  const handleFormStateChange = useCallback((state: { dirty: boolean; submitting: boolean }) => {
    formStateRef.current = state
  }, [])

  const requestClose = useCallback(() => {
    if (formStateRef.current.submitting) return
    if (formStateRef.current.dirty && !window.confirm('Descartar as informações preenchidas?')) return
    onClose()
  }, [onClose])

  // ESC fecha e a página de fundo não rola enquanto o modal está aberto
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, requestClose])

  const isEdit = Boolean(lead)
  const HeaderIcon = isEdit ? Pencil : UserPlus

  return (
    <div
      className={cn('fixed inset-0 z-50', open ? 'pointer-events-auto' : 'pointer-events-none')}
      aria-hidden={!open}
      inert={!open}
    >
      <div
        onClick={requestClose}
        className={cn(
          'absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-form-title"
        className={cn(
          'absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out',
          'border-l border-slate-200 dark:border-slate-800 dark:bg-slate-900',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
              <HeaderIcon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="lead-form-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                {isEdit ? 'Editar Lead' : 'Novo Lead'}
              </h2>
              <p className="truncate text-sm text-slate-500 dark:text-slate-400">
                {isEdit ? lead?.contact_name : 'Só o nome é obrigatório. O resto pode ser completado depois.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Fechar"
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        {sessionKey > 0 && (
          <LeadForm
            key={`${sessionKey}-${lead?.id ?? 'new'}`}
            lead={lead}
            onCancel={onClose}
            onSaved={onSaved}
            onDeleted={onDeleted}
            onRequestReset={() => setSessionKey((current) => current + 1)}
            onStateChange={handleFormStateChange}
          />
        )}
      </aside>
    </div>
  )
}
