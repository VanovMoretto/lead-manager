import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  BedDouble,
  Building2,
  Car,
  CalendarDays,
  Check,
  CircleAlert,
  CircleCheck,
  CircleX,
  Download,
  ExternalLink,
  FileText,
  History,
  ImageIcon,
  LoaderCircle,
  Mail,
  MapPin,
  MonitorSpeaker,
  NotebookPen,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Receipt,
  RefreshCw,
  Save,
  ShieldOff,
  Trash2,
  Upload,
  UtensilsCrossed,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import CeremonialistFormModal from '../components/CeremonialistFormModal'
import CompanyAutocomplete from '../components/CompanyAutocomplete'
import type { LayoutOutletContext } from '../components/Layout'
import { Field, MoneyInput, YesNoToggle } from '../components/LeadFormFields'
import StatusBadge from '../components/StatusBadge'
import WhatsAppButton from '../components/WhatsAppButton'
import { useAuth } from '../contexts/AuthContext'
import { useCeremonialists } from '../hooks/useCeremonialists'
import { useCompanyOptions } from '../hooks/useCompanies'
import { useConfirm } from '../hooks/useConfirm'
import { useLeadSectionDraft, withStatus, type LeadSectionDraft } from '../hooks/useLeadSectionDraft'
import { useSettingsOptions } from '../hooks/useSettingsOptions'
import { lookupCnpj } from '../lib/cnpj'
import { formatCNPJ, formatCentsBRL, formatPhoneBR, isValidCNPJ, isValidEmail, onlyDigits } from '../lib/format'
import { NET_RATES, NET_RATES_LABEL, countEventDays, formatLeadEventPeriod, getLeadRooms, isCeremonialistOrigin } from '../lib/leadFields'
import {
  NEW_CEREMONIALIST,
  STATUS_OPTIONS,
  computeNetCents,
  computeTotalCents,
  inputClassName,
  needsLossDetails,
  needsProposalNumber,
  withCurrentValue,
  type ProposalPageState,
} from '../lib/leadForm'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_FORMATS_LABEL,
  MAX_ATTACHMENT_BYTES,
  deleteLeadAttachment,
  downloadLeadAttachment,
  fetchLeadAttachments,
  openLeadAttachment,
  removeLeadFolders,
  uploadLeadAttachment,
} from '../lib/leadAttachments'
import { formatFileSize } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { RateLimitError, guardMutation, isAbortError } from '../lib/rateLimit'
import { cn } from '../lib/utils'
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_LABELS,
  DEFAULT_LOSS_REASONS,
  LOSS_REASON_OTHER,
  type AttachmentKind,
  type Client,
  type Lead,
  type LeadAttachment,
  OPERATIONAL_STATUSES,
  OPERATIONAL_STATUS_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  SURVEY_STATUSES,
  SURVEY_STATUS_LABELS,
  type OperationalStatus,
  type PaymentStatus,
  type SurveyStatus,
} from '../types/lead'

const MAX_OBSERVATIONS_LENGTH = 5000

const cardClassName = 'rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900'

type AsyncResult<T> = { key: string; data: T | null; error: string | null }

function formatDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

// =============================================================================
// Componentes de apoio
// =============================================================================

function Card({ icon: Icon, title, actions, children, className }: { icon: LucideIcon; title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn(cardClassName, className)}>
      <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-white">
          <Icon className="h-4 w-4 text-brand-600 dark:text-brand-400" aria-hidden="true" />
          {title}
        </h2>
        {actions}
      </header>
      <div className="p-5">{children}</div>
    </section>
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900 dark:text-slate-100">{children}</dd>
    </div>
  )
}

const empty = <span className="text-slate-400 dark:text-slate-500">—</span>

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
    >
      <span className="flex items-center gap-2">
        <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
        {message}
      </span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 font-semibold hover:underline">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Tentar de novo
        </button>
      )}
    </div>
  )
}

// =============================================================================
// Observações (salvamento rápido)
// =============================================================================

function ObservationsCard({ lead, onSaved }: { lead: Lead; onSaved: (lead: Lead) => void }) {
  const external = lead.observations ?? ''
  const [draft, setDraft] = useState(external)
  const [syncedValue, setSyncedValue] = useState(external)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Lead atualizado por fora (ex.: edição no formulário): acompanha se não houver rascunho pendente
  if (external !== syncedValue) {
    setSyncedValue(external)
    if (draft === syncedValue) setDraft(external)
  }

  const dirty = draft !== external

  const save = async () => {
    if (saving || !dirty) return
    setSaving(true)
    setFeedback(null)
    const value = draft.trim() ? draft : null
    let response
    try {
      response = await guardMutation(`lead:observations:${lead.id}:${value ?? ''}`, async () =>
        supabase.from('leads').update({ observations: value }).eq('id', lead.id).select().single(),
      )
    } catch (guardError) {
      setSaving(false)
      if (guardError instanceof RateLimitError) setFeedback({ type: 'error', message: guardError.message })
      return
    }
    const { data, error } = response
    setSaving(false)
    if (error) {
      setFeedback({
        type: 'error',
        message:
          error.code === 'PGRST204' || error.code === '42703'
            ? 'O banco de dados está desatualizado. Rode a migração 007 no SQL Editor do Supabase.'
            : error.message.toLowerCase().includes('failed to fetch')
              ? 'Sem conexão com o servidor. As observações não foram salvas.'
              : 'Não foi possível salvar as observações. Tente novamente.',
      })
      return
    }
    onSaved(data)
    setFeedback({ type: 'success', message: 'Observações salvas.' })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void save()
    }
  }

  return (
    <Card icon={NotebookPen} title="Observações da negociação">
      <label htmlFor="lead-observations" className="sr-only">
        Observações da negociação
      </label>
      <textarea
        id="lead-observations"
        rows={7}
        maxLength={MAX_OBSERVATIONS_LENGTH}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setFeedback(null)
        }}
        onKeyDown={handleKeyDown}
        placeholder="Ex.: Pontos combinados, pedidos do cliente e próximos passos"
        className={cn(
          'block w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors',
          'placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20',
          'dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500',
        )}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {draft.length.toLocaleString('pt-BR')}/{MAX_OBSERVATIONS_LENGTH.toLocaleString('pt-BR')} · Ctrl+Enter salva
        </p>
        <div className="flex items-center gap-3">
          {feedback && (
            <span
              role={feedback.type === 'error' ? 'alert' : 'status'}
              className={cn(
                'flex items-center gap-1 text-xs font-medium',
                feedback.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400',
              )}
            >
              {feedback.type === 'error' ? <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              {feedback.message}
            </span>
          )}
          {dirty && !feedback && <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Alterações não salvas</span>}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            Salvar
          </button>
        </div>
      </div>
    </Card>
  )
}

// =============================================================================
// Anexos das propostas
// =============================================================================

const KIND_ICONS: Record<AttachmentKind, LucideIcon> = {
  rental_proposal: MapPin,
  ab_proposal: UtensilsCrossed,
}

function AttachmentItem({
  attachment,
  canDelete,
  onDeleted,
  onError,
}: {
  attachment: LeadAttachment
  canDelete: boolean
  onDeleted: (attachment: LeadAttachment) => void
  onError: (message: string) => void
}) {
  const [busy, setBusy] = useState<'open' | 'download' | 'delete' | null>(null)
  const confirm = useConfirm()
  const isImage = attachment.mime_type.startsWith('image/')
  const FileIcon = isImage ? ImageIcon : FileText

  const run = async (action: 'open' | 'download' | 'delete') => {
    if (
      action === 'delete' &&
      !(await confirm({
        title: `Excluir o anexo "${attachment.file_name}"?`,
        description: 'O arquivo é apagado do armazenamento. Essa ação é permanente.',
        confirmLabel: 'Excluir anexo',
        tone: 'danger',
      }))
    ) {
      return
    }
    setBusy(action)
    try {
      if (action === 'open') await openLeadAttachment(attachment)
      if (action === 'download') await downloadLeadAttachment(attachment)
      if (action === 'delete') {
        await deleteLeadAttachment(attachment)
        onDeleted(attachment)
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Não foi possível concluir a ação.')
    } finally {
      setBusy(null)
    }
  }

  const iconButton =
    'rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:cursor-wait disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'

  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        <FileIcon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900 dark:text-white" title={attachment.file_name}>
          {attachment.file_name}
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {formatFileSize(attachment.size_bytes)} · {formatDateTime(attachment.created_at)}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        <button type="button" onClick={() => void run('open')} disabled={busy !== null} title="Abrir" aria-label={`Abrir ${attachment.file_name}`} className={iconButton}>
          {busy === 'open' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ExternalLink className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button type="button" onClick={() => void run('download')} disabled={busy !== null} title="Baixar" aria-label={`Baixar ${attachment.file_name}`} className={iconButton}>
          {busy === 'download' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={() => void run('delete')}
            disabled={busy !== null}
            title="Excluir"
            aria-label={`Excluir ${attachment.file_name}`}
            className={cn(iconButton, 'hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40 dark:hover:text-red-300')}
          >
            {busy === 'delete' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
      </div>
    </li>
  )
}

function AttachmentGroup({
  leadId,
  kind,
  attachments,
  canDelete,
  onUploaded,
  onDeleted,
}: {
  leadId: string
  kind: AttachmentKind
  attachments: LeadAttachment[]
  canDelete: boolean
  onUploaded: (attachment: LeadAttachment) => void
  onDeleted: (attachment: LeadAttachment) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const Icon = KIND_ICONS[kind]
  const inputId = `attachment-${kind}`

  const handleFiles = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    setUploading(true)
    setError(null)
    const failures: string[] = []
    for (const file of files) {
      try {
        onUploaded(
          await guardMutation(`attachment:${leadId}:${kind}:${file.name}:${file.size}:${file.lastModified}`, () =>
            uploadLeadAttachment(leadId, kind, file),
          ),
        )
      } catch (uploadError) {
        failures.push(`${file.name}: ${uploadError instanceof Error ? uploadError.message : 'falha no envio.'}`)
      }
    }
    setUploading(false)
    if (failures.length > 0) setError(failures.join(' '))
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
          {ATTACHMENT_KIND_LABELS[kind]}
          <span className="rounded-full bg-slate-100 px-1.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{attachments.length}</span>
        </h3>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ATTACHMENT_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => void handleFiles(event)}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 disabled:cursor-wait disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:border-brand-800 dark:hover:bg-brand-900/30 dark:hover:text-white"
        >
          {uploading ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
          {uploading ? 'Enviando...' : 'Anexar'}
        </button>
      </div>

      {attachments.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          Nenhum arquivo anexado.
        </p>
      ) : (
        <ul className="mt-1 divide-y divide-slate-100 dark:divide-slate-800">
          {attachments.map((attachment) => (
            <AttachmentItem
              key={attachment.id}
              attachment={attachment}
              canDelete={canDelete}
              onDeleted={onDeleted}
              onError={setError}
            />
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

function AttachmentsCard({ leadId }: { leadId: string }) {
  const { isAdmin } = useAuth()
  const [reloadCount, setReloadCount] = useState(0)
  const key = `${leadId}|${reloadCount}`
  const [result, setResult] = useState<AsyncResult<LeadAttachment[]> | null>(null)

  useEffect(() => {
    let isActive = true
    fetchLeadAttachments(leadId)
      .then((data) => {
        if (isActive) setResult({ key, data, error: null })
      })
      .catch((error: { code?: string }) => {
        if (!isActive) return
        const outdated = error?.code === '42P01' || error?.code === 'PGRST205'
        setResult({
          key,
          data: null,
          error: outdated
            ? 'Os anexos ficam disponíveis depois que a migração 007 for aplicada no Supabase.'
            : 'Não foi possível carregar os anexos.',
        })
      })
    return () => {
      isActive = false
    }
  }, [key, leadId])

  const loading = result?.key !== key
  const attachments = result?.data ?? []

  const addAttachment = (attachment: LeadAttachment) =>
    setResult((current) => (current ? { ...current, data: [attachment, ...(current.data ?? [])] } : current))
  const removeAttachment = (attachment: LeadAttachment) =>
    setResult((current) => (current ? { ...current, data: (current.data ?? []).filter((item) => item.id !== attachment.id) } : current))

  return (
    <Card icon={Paperclip} title="Anexos das propostas">
      {loading ? (
        <div className="space-y-3">
          <div className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          <div className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        </div>
      ) : result?.error ? (
        <ErrorBanner message={result.error} onRetry={() => setReloadCount((current) => current + 1)} />
      ) : (
        <div className="space-y-6">
          {ATTACHMENT_KINDS.map((kind) => (
            <AttachmentGroup
              key={kind}
              leadId={leadId}
              kind={kind}
              attachments={attachments.filter((attachment) => attachment.kind === kind)}
              canDelete={isAdmin}
              onUploaded={addAttachment}
              onDeleted={removeAttachment}
            />
          ))}
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {ATTACHMENT_FORMATS_LABEL} de até {formatFileSize(MAX_ATTACHMENT_BYTES)} por arquivo.
            {!isAdmin && ' Somente o ADMIN exclui anexos.'}
          </p>
        </div>
      )}
    </Card>
  )
}

// =============================================================================
// Pós-evento e cliente
// =============================================================================

type PostEventDraft = {
  operational_status: OperationalStatus
  nf_rental: string
  nf_ab: string
  nf_parking: string
  payment_status: PaymentStatus
  survey_status: SurveyStatus
}

function toPostEventDraft(lead: Lead): PostEventDraft {
  return {
    operational_status: lead.operational_status,
    nf_rental: lead.nf_rental ?? '',
    nf_ab: lead.nf_ab ?? '',
    nf_parking: lead.nf_parking ?? '',
    payment_status: lead.payment_status,
    survey_status: lead.survey_status,
  }
}

const selectClassName =
  'block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-white'

/** Situação do evento, notas fiscais, pagamento e pesquisa de satisfação. */
function PostEventCard({ lead, onSaved }: { lead: Lead; onSaved: (lead: Lead) => void }) {
  const external = toPostEventDraft(lead)
  const externalKey = JSON.stringify(external)
  const [draft, setDraft] = useState(external)
  const [syncedKey, setSyncedKey] = useState(externalKey)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Proposta atualizada por fora (ex.: na planilha ou no formulário): acompanha se não houver alteração pendente
  if (externalKey !== syncedKey) {
    setSyncedKey(externalKey)
    if (JSON.stringify(draft) === syncedKey) setDraft(external)
  }

  const dirty = JSON.stringify(draft) !== externalKey
  const isLost = lead.status === 'perdido'
  const update = <K extends keyof PostEventDraft>(field: K, value: PostEventDraft[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
    setFeedback(null)
  }

  const save = async () => {
    if (saving || !dirty) return
    setSaving(true)
    setFeedback(null)
    const payload = {
      ...(isLost ? {} : { operational_status: draft.operational_status }),
      nf_rental: draft.nf_rental.trim() || null,
      nf_ab: draft.nf_ab.trim() || null,
      nf_parking: draft.nf_parking.trim() || null,
      payment_status: draft.payment_status,
      survey_status: draft.survey_status,
    }
    try {
      const { data, error } = await guardMutation(`lead:post-event:${lead.id}:${JSON.stringify(payload)}`, async () =>
        supabase.from('leads').update(payload).eq('id', lead.id).select().single(),
      )
      if (error || !data) {
        setFeedback({
          type: 'error',
          message:
            error?.code === 'PGRST204' || error?.code === '42703'
              ? 'O banco de dados está desatualizado. Rode a migração 012 no SQL Editor do Supabase.'
              : 'Não foi possível salvar. Verifique sua conexão e tente novamente.',
        })
        return
      }
      onSaved(data)
      setFeedback({ type: 'success', message: 'Faturamento salvo.' })
    } catch (guardError) {
      setFeedback({ type: 'error', message: guardError instanceof RateLimitError ? guardError.message : 'Não foi possível salvar.' })
    } finally {
      setSaving(false)
    }
  }

  const label = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'
  const input =
    'block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white'

  return (
    <Card icon={Receipt} title="Faturamento, NFs e Pós-Evento">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="post-operational" className={label}>
            Situação do evento
          </label>
          <select
            id="post-operational"
            value={draft.operational_status}
            disabled={isLost}
            onChange={(event) => update('operational_status', event.target.value as OperationalStatus)}
            className={selectClassName}
          >
            {OPERATIONAL_STATUSES.map((value) => (
              <option key={value} value={value}>
                {OPERATIONAL_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="post-payment" className={label}>
            Pagamento
          </label>
          <select
            id="post-payment"
            value={draft.payment_status}
            onChange={(event) => update('payment_status', event.target.value as PaymentStatus)}
            className={selectClassName}
          >
            {PAYMENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {PAYMENT_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="post-survey" className={label}>
            Pesquisa de satisfação
          </label>
          <select
            id="post-survey"
            value={draft.survey_status}
            onChange={(event) => update('survey_status', event.target.value as SurveyStatus)}
            className={selectClassName}
          >
            {SURVEY_STATUSES.map((value) => (
              <option key={value} value={value}>
                {SURVEY_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        {(
          [
            ['nf_rental', 'NF Locação'],
            ['nf_ab', 'NF A&B'],
            ['nf_parking', 'NF Estacionamento'],
          ] as const
        ).map(([field, text]) => (
          <div key={field}>
            <label htmlFor={`post-${field}`} className={label}>
              {text}
            </label>
            <input
              id={`post-${field}`}
              type="text"
              maxLength={50}
              autoComplete="off"
              placeholder="Nº da nota"
              value={draft[field]}
              onChange={(event) => update(field, event.target.value)}
              className={input}
            />
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {isLost
            ? 'Proposta perdida: não entra na planilha de faturamento.'
            : 'Confirmado ou Realizado fecha a proposta; À confirmar volta para Em aberto.'}
        </p>
        <div className="flex items-center gap-3">
          {feedback && (
            <span
              role={feedback.type === 'error' ? 'alert' : 'status'}
              className={cn(
                'flex items-center gap-1 text-xs font-medium',
                feedback.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400',
              )}
            >
              {feedback.type === 'error' ? <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" /> : <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />}
              {feedback.message}
            </span>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
            Salvar
          </button>
        </div>
      </div>
    </Card>
  )
}

/** Link para a página consolidada do cliente (empresa ou pessoa física) dono desta proposta. */
function ClientLink({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<Pick<Client, 'id' | 'name' | 'client_type'> | null>(null)

  useEffect(() => {
    let isActive = true
    supabase
      .from('clients')
      .select('id, name, client_type')
      .eq('id', clientId)
      .maybeSingle()
      .then(({ data, error }) => {
        // Informativo: sem o cliente (ou sem a migração 009), o link simplesmente não aparece
        if (isActive && !error) setClient(data)
      })
    return () => {
      isActive = false
    }
  }, [clientId])

  if (!client || client.id !== clientId) return null
  const Icon = client.client_type === 'company' ? Building2 : UserRound

  return (
    <Link
      to={`/leads/${client.id}`}
      className="mt-2 inline-flex max-w-full items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-800 transition-colors hover:bg-brand-100 dark:border-brand-900/60 dark:bg-brand-900/20 dark:text-brand-200 dark:hover:bg-brand-900/40"
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">
        Ver histórico{' '}
        {client.client_type === 'company' ? 'da empresa' : client.client_type === 'ceremonialist' ? 'do cerimonialista' : 'do cliente'}{' '}
        <strong className="font-semibold">{client.name}</strong>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
    </Link>
  )
}

// =============================================================================
// Edição direta na página (Proposta, Contato e Evento)
// =============================================================================

const EXTRA_SERVICES = [
  { kind: 'ab', label: 'A&B', chip: 'A&B', icon: UtensilsCrossed, rate: NET_RATES.ab },
  { kind: 'lodging', label: 'Hospedagem', chip: 'Hospedagem', icon: BedDouble, rate: NET_RATES.lodging },
  { kind: 'equipment', label: 'Equipamentos / Extras', chip: 'Equipamentos', icon: MonitorSpeaker, rate: NET_RATES.equipment },
  { kind: 'parking', label: 'Estacionamento', chip: 'Estacionamento', icon: Car, rate: NET_RATES.parking },
] as const

type ExtraKind = (typeof EXTRA_SERVICES)[number]['kind']

const hasKey = (kind: ExtraKind) => `has_${kind}` as const
const centsKey = (kind: ExtraKind) => `${kind}_cents` as const

/** Salvar/Descartar de um card: aparece quando há alteração (ou um erro para mostrar). */
function SaveBar({
  editor,
  onSave,
  onDiscard,
  alwaysVisible = false,
}: {
  editor: LeadSectionDraft
  onSave: () => void
  onDiscard: () => void
  alwaysVisible?: boolean
}) {
  if (!editor.dirty && !editor.saveError && !alwaysVisible) return null
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
      {editor.saveError && (
        <span role="alert" className="mr-auto flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {editor.saveError}
        </span>
      )}
      <button
        type="button"
        onClick={onDiscard}
        disabled={editor.saving}
        className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        {editor.dirty ? 'Descartar' : 'Cancelar'}
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={editor.saving || !editor.dirty}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {editor.saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
        Salvar
      </button>
    </div>
  )
}

function EditButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30"
    >
      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
      Editar
    </button>
  )
}

function ProposalCard({ editor, lossReasonLabels }: { editor: LeadSectionDraft; lossReasonLabels: string[] }) {
  const { draft, update, change, errors } = editor
  const isLost = draft.status === 'perdido'
  const isClosed = draft.status === 'fechado'

  // Foca o valor do serviço recém-adicionado (depois que o campo aparece)
  const pendingFocusRef = useRef<string | null>(null)
  useEffect(() => {
    if (!pendingFocusRef.current) return
    document.getElementById(pendingFocusRef.current)?.focus()
    pendingFocusRef.current = null
  }, [draft.has_ab, draft.has_lodging, draft.has_equipment, draft.has_parking])

  const setExtra = (kind: ExtraKind, enabled: boolean) => {
    change((current) => ({ ...current, [hasKey(kind)]: enabled, [centsKey(kind)]: enabled ? current[centsKey(kind)] : null }))
    if (enabled) pendingFocusRef.current = `lead-${centsKey(kind)}`
  }

  const active = EXTRA_SERVICES.filter(({ kind }) => draft[hasKey(kind)])
  const inactive = EXTRA_SERVICES.filter(({ kind }) => !draft[hasKey(kind)])
  const totalCents = computeTotalCents(draft)
  const netCents = computeNetCents(draft)
  const parts = [
    { label: 'Locação de sala', icon: MapPin, cents: draft.value_cents ?? 0, rate: NET_RATES.rental, show: draft.value_cents !== null },
    ...EXTRA_SERVICES.map(({ kind, label, icon, rate }) => ({ label, icon, cents: draft[centsKey(kind)] ?? 0, rate, show: draft[hasKey(kind)] })),
  ].filter((part) => part.show)

  return (
    <Card icon={FileText} title="Proposta" actions={editor.dirty ? <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Alterações não salvas</span> : undefined}>
      <div id="proposal-card" className="space-y-5">
        <div className="space-y-5">
          <div>
            <p id="lead-status-label" className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Situação
            </p>
            <div role="radiogroup" aria-labelledby="lead-status-label" className="grid grid-cols-3 gap-2">
              {STATUS_OPTIONS.map(({ value, title, icon: Icon, selectedClassName, iconClassName }) => {
                const selected = draft.status === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => change((current) => withStatus(current, value), ['proposal_number', 'loss_reason', 'loss_reason_details'])}
                    className={cn(
                      'flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm font-semibold transition-colors',
                      selected
                        ? cn(selectedClassName, 'text-slate-900 dark:text-white')
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
                    )}
                  >
                    <Icon className={cn('h-4 w-4', selected ? iconClassName : 'text-slate-400')} aria-hidden="true" />
                    {title}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <YesNoToggle
              id="lead-proposal_sent"
              label="Proposta formal enviada?"
              stacked
              value={draft.proposal_sent || isClosed}
              disabled={isClosed}
              onChange={(value) => update('proposal_sent', value)}
            />
            {needsProposalNumber(draft) && (
              <Field label="Nº da proposta" htmlFor="lead-proposal_number" required={isClosed} error={errors.proposal_number}>
                <input
                  id="lead-proposal_number"
                  type="text"
                  maxLength={50}
                  autoComplete="off"
                  placeholder="Ex.: 2026-0042"
                  value={draft.proposal_number}
                  onChange={(event) => update('proposal_number', event.target.value)}
                  aria-invalid={Boolean(errors.proposal_number)}
                  aria-describedby={errors.proposal_number ? 'lead-proposal_number-error' : undefined}
                  className={inputClassName(Boolean(errors.proposal_number))}
                />
              </Field>
            )}
          </div>

          {isLost && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Motivo da perda" htmlFor="lead-loss_reason" required error={errors.loss_reason}>
                <select
                  id="lead-loss_reason"
                  value={draft.loss_reason}
                  onChange={(event) => update('loss_reason', event.target.value)}
                  aria-invalid={Boolean(errors.loss_reason)}
                  className={inputClassName(Boolean(errors.loss_reason))}
                >
                  <option value="">Selecione</option>
                  {lossReasonLabels.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              {needsLossDetails(draft) ? (
                <Field
                  label="Detalhes"
                  htmlFor="lead-loss_reason_details"
                  required={draft.loss_reason === LOSS_REASON_OTHER}
                  error={errors.loss_reason_details}
                >
                  <input
                    id="lead-loss_reason_details"
                    type="text"
                    maxLength={2000}
                    autoComplete="off"
                    placeholder="O que o cliente disse?"
                    value={draft.loss_reason_details}
                    onChange={(event) => update('loss_reason_details', event.target.value)}
                    aria-invalid={Boolean(errors.loss_reason_details)}
                    className={inputClassName(Boolean(errors.loss_reason_details))}
                  />
                </Field>
              ) : (
                <button
                  type="button"
                  onClick={() => update('show_loss_details', true)}
                  className="self-end justify-self-start rounded-lg px-2 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30"
                >
                  + Adicionar detalhes
                </button>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-start">
          <div className="min-w-0 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Valores</p>
            <Field label="Locação de sala (R$)" htmlFor="lead-value_cents" error={errors.value_cents}>
              <MoneyInput id="lead-value_cents" cents={draft.value_cents} invalid={Boolean(errors.value_cents)} onChange={(cents) => update('value_cents', cents)} />
            </Field>
            {active.map(({ kind, label, icon: Icon }) => (
              <div key={kind}>
                <label htmlFor={`lead-${centsKey(kind)}`} className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                  <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  {label} (R$)
                </label>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <MoneyInput id={`lead-${centsKey(kind)}`} cents={draft[centsKey(kind)]} onChange={(cents) => update(centsKey(kind), cents)} />
                  </div>
                  <button
                    type="button"
                    onClick={() => setExtra(kind, false)}
                    title={`Remover ${label}`}
                    aria-label={`Remover ${label}`}
                    className="rounded-lg p-2.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
            {inactive.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {inactive.map(({ kind, chip }) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setExtra(kind, true)}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-600 dark:text-slate-300 dark:hover:border-brand-600 dark:hover:bg-brand-900/30 dark:hover:text-brand-200"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {chip}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-brand-100 dark:border-brand-900/60" aria-live="polite">
            <div className="bg-gradient-to-br from-brand-900 to-brand-600 p-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-100">Locação de sala</p>
              <p className="mt-1 text-2xl font-bold tabular-nums">{draft.value_cents !== null ? formatCentsBRL(draft.value_cents) : '—'}</p>
            </div>
            <dl className="divide-y divide-slate-100 bg-brand-50/40 px-4 text-sm dark:divide-slate-800 dark:bg-brand-950/20">
              <div className="flex items-baseline justify-between gap-3 py-2">
                <dt>
                  <span className="font-medium text-slate-800 dark:text-slate-100">Receita líquida total</span>
                  <span className="block text-[11px] text-slate-500 dark:text-slate-400">{NET_RATES_LABEL}</span>
                </dt>
                <dd className="font-semibold tabular-nums text-slate-900 dark:text-white">{totalCents > 0 ? formatCentsBRL(netCents) : '—'}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-3 py-2">
                <dt className="font-medium text-slate-800 dark:text-slate-100">Receita bruta total</dt>
                <dd className="font-semibold tabular-nums text-slate-900 dark:text-white">{totalCents > 0 ? formatCentsBRL(totalCents) : '—'}</dd>
              </div>
            </dl>
            {parts.length > 0 && (
              <ul className="space-y-1.5 border-t border-slate-100 px-4 py-3 text-sm dark:border-slate-800">
                {parts.map(({ label, icon: Icon, cents, rate }) => (
                  <li key={label} className="flex items-start justify-between gap-4 text-slate-600 dark:text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                      {label}
                    </span>
                    <span className="text-right tabular-nums">
                      {formatCentsBRL(cents)}
                      {rate < 1 && (
                        <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                          {Math.round(rate * 100)}%: {formatCentsBRL(Math.round(cents * rate))}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <SaveBar editor={editor} onSave={() => void editor.save()} onDiscard={editor.discard} />
    </Card>
  )
}

type CnpjFill = { digits: string; name: string; city: string | null; source: 'cadastro' | 'receita' }

function ContactCard({
  lead,
  editing,
  onEditingChange,
  originLabels,
  originsLoading,
  onSaved,
}: {
  lead: Lead
  editing: boolean
  onEditingChange: (editing: boolean) => void
  originLabels: string[]
  originsLoading: boolean
  onSaved: (lead: Lead) => void
}) {
  const editor = useLeadSectionDraft(lead, 'contact', { hasRooms: false, onSaved })
  const { draft, update, change, errors } = editor
  const { options: companyOptions } = useCompanyOptions()
  const showCeremonialist = isCeremonialistOrigin(draft.origin)
  const ceremonialists = useCeremonialists(editing && showCeremonialist)
  const [ceremonialistModal, setCeremonialistModal] = useState(false)
  const origins = withCurrentValue(originLabels, draft.origin)

  // CNPJ válido com a Empresa vazia: preenche pelo cadastro ou pela Receita Federal (BrasilAPI)
  const cnpjDigits = onlyDigits(draft.cnpj)
  const cnpjValid = cnpjDigits.length === 14 && isValidCNPJ(cnpjDigits)
  const knownCompany = cnpjValid ? companyOptions.find((option) => onlyDigits(option.cnpj ?? '') === cnpjDigits) : undefined
  const [lookup, setLookup] = useState<{ digits: string; name: string; city: string | null } | null>(null)
  const needsLookup = editing && cnpjValid && !knownCompany && !draft.company.trim() && cnpjDigits !== onlyDigits(lead.cnpj ?? '')
  useEffect(() => {
    if (!needsLookup) return
    const controller = new AbortController()
    lookupCnpj(cnpjDigits, controller.signal).then((result) => {
      if (result) setLookup({ digits: cnpjDigits, name: result.name, city: result.city })
    })
    return () => controller.abort()
  }, [needsLookup, cnpjDigits])
  const fill: CnpjFill | null = knownCompany
    ? { digits: cnpjDigits, name: knownCompany.name, city: null, source: 'cadastro' }
    : lookup && lookup.digits === cnpjDigits
      ? { ...lookup, source: 'receita' }
      : null
  const [appliedFill, setAppliedFill] = useState('')
  const [filled, setFilled] = useState<CnpjFill | null>(null)
  const fillKey = fill ? `${fill.digits}|${fill.source}|${fill.name}` : ''
  if (editing && fillKey && fillKey !== appliedFill) {
    setAppliedFill(fillKey)
    if (fill && !draft.company.trim()) {
      update('company', fill.name)
      setFilled(fill)
    }
  }

  const optOutRevoking = lead.marketing_opt_out && !draft.marketing_opt_out
  const close = () => {
    editor.discard()
    onEditingChange(false)
  }
  const save = async () => {
    if (await editor.save()) onEditingChange(false)
  }

  if (!editing) {
    return (
      <Card icon={Phone} title="Contato" actions={<EditButton onClick={() => onEditingChange(true)} label="Editar contato" />}>
        <dl className="space-y-3">
          <InfoRow label="Telefone / WhatsApp">{lead.contact_phone || empty}</InfoRow>
          <InfoRow label="E-mail">
            {lead.contact_email && isValidEmail(lead.contact_email) ? (
              <a href={`mailto:${lead.contact_email.trim()}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-300">
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                {lead.contact_email}
              </a>
            ) : (
              lead.contact_email || empty
            )}
          </InfoRow>
          <InfoRow label="Empresa">{lead.company ? `${lead.company}${lead.cnpj ? ` · CNPJ ${lead.cnpj}` : ''}` : 'Pessoa física'}</InfoRow>
          <InfoRow label="Meio de prospecção">{lead.origin || empty}</InfoRow>
          {lead.marketing_opt_out && (
            <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <ShieldOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Opt-out LGPD: não enviar comunicações de marketing.
            </p>
          )}
        </dl>
      </Card>
    )
  }

  return (
    <Card icon={Phone} title="Contato" actions={<span className="text-xs font-semibold text-brand-700 dark:text-brand-300">Editando</span>}>
      <div className="space-y-4">
        <Field label="Nome do contato" htmlFor="lead-contact_name" required error={errors.contact_name}>
          <input
            id="lead-contact_name"
            type="text"
            maxLength={150}
            autoComplete="off"
            value={draft.contact_name}
            onChange={(event) => update('contact_name', event.target.value)}
            aria-invalid={Boolean(errors.contact_name)}
            className={inputClassName(Boolean(errors.contact_name))}
          />
        </Field>
        <Field label="Telefone / WhatsApp" htmlFor="lead-contact_phone" error={errors.contact_phone}>
          <input
            id="lead-contact_phone"
            type="tel"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Ex.: (51) 99999-8888"
            value={draft.contact_phone}
            onChange={(event) => update('contact_phone', formatPhoneBR(event.target.value))}
            aria-invalid={Boolean(errors.contact_phone)}
            className={inputClassName(Boolean(errors.contact_phone))}
          />
        </Field>
        <Field label="E-mail" htmlFor="lead-contact_email" error={errors.contact_email}>
          <input
            id="lead-contact_email"
            type="email"
            maxLength={254}
            autoComplete="off"
            value={draft.contact_email}
            onChange={(event) => update('contact_email', event.target.value)}
            aria-invalid={Boolean(errors.contact_email)}
            className={inputClassName(Boolean(errors.contact_email))}
          />
        </Field>
        <Field
          label="CNPJ"
          htmlFor="lead-cnpj"
          error={errors.cnpj ?? (cnpjDigits.length === 14 && !cnpjValid ? 'CNPJ inválido. Confira os dígitos.' : undefined)}
        >
          <input
            id="lead-cnpj"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="00.000.000/0000-00"
            value={draft.cnpj}
            onChange={(event) => update('cnpj', formatCNPJ(event.target.value))}
            aria-invalid={Boolean(errors.cnpj)}
            className={inputClassName(Boolean(errors.cnpj) || (cnpjDigits.length === 14 && !cnpjValid))}
          />
        </Field>
        <Field label="Empresa" htmlFor="lead-company" hint={filled && draft.company === filled.name ? undefined : 'Em branco: pessoa física.'}>
          <CompanyAutocomplete
            id="lead-company"
            maxLength={120}
            placeholder="Ex.: Empresa / Organização"
            value={draft.company}
            options={companyOptions}
            onChange={(value) => update('company', value)}
            onSelect={(option) =>
              change(
                (current) => ({
                  ...current,
                  company: option.name,
                  cnpj: option.cnpj ? formatCNPJ(option.cnpj) : onlyDigits(current.cnpj) ? current.cnpj : '',
                }),
                ['cnpj'],
              )
            }
            className={inputClassName(false)}
          />
          {filled && draft.company === filled.name && (
            <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
              <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {filled.source === 'receita'
                ? `Preenchido via CNPJ (Receita Federal)${filled.city ? ` · ${filled.city}` : ''}`
                : 'Preenchido pelo cadastro deste CNPJ'}
            </p>
          )}
        </Field>
        <Field label="Meio de prospecção" htmlFor="lead-origin">
          <select
            id="lead-origin"
            value={draft.origin}
            disabled={originsLoading}
            onChange={(event) => update('origin', event.target.value)}
            className={inputClassName(false)}
          >
            <option value="">{originsLoading ? 'Carregando...' : 'Selecione'}</option>
            {origins.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {showCeremonialist && (
          <Field
            label="Cerimonialista"
            htmlFor="lead-ceremonialist_id"
            hint={ceremonialists.error ? 'Não foi possível carregar as cerimonialistas (rode a migração 016).' : 'Quem indicou esta proposta.'}
          >
            <select
              id="lead-ceremonialist_id"
              value={draft.ceremonialist_id}
              onChange={(event) => {
                if (event.target.value === NEW_CEREMONIALIST) setCeremonialistModal(true)
                else update('ceremonialist_id', event.target.value)
              }}
              disabled={ceremonialists.loading && ceremonialists.items.length === 0}
              className={inputClassName(false)}
            >
              <option value="">{ceremonialists.loading && ceremonialists.items.length === 0 ? 'Carregando...' : 'Selecione a cerimonialista'}</option>
              {ceremonialists.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              {draft.ceremonialist_id && !ceremonialists.items.some((item) => item.id === draft.ceremonialist_id) && (
                <option value={draft.ceremonialist_id}>Cerimonialista cadastrada</option>
              )}
              <option value={NEW_CEREMONIALIST}>+ Nova cerimonialista</option>
            </select>
          </Field>
        )}
        <div>
          <label className="flex w-fit cursor-pointer items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={draft.marketing_opt_out}
              onChange={(event) => update('marketing_opt_out', event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600 dark:border-slate-600 dark:bg-slate-900"
            />
            <span>
              Cliente solicitou não receber comunicações/mailing{' '}
              <span className="text-xs font-medium text-slate-400 dark:text-slate-500">(Opt-out LGPD)</span>
            </span>
          </label>
          {draft.marketing_opt_out && !lead.marketing_opt_out && (
            <p className="mt-1 pl-[1.625rem] text-xs text-slate-500 dark:text-slate-400">
              Vale para todas as propostas com o mesmo e-mail ou telefone, inclusive as futuras.
            </p>
          )}
          {optOutRevoking && (
            <p role="alert" className="mt-1.5 pl-[1.625rem] text-xs font-medium text-amber-700 dark:text-amber-400">
              Ao salvar, o opt-out deixa de valer para as propostas com o mesmo e-mail ou telefone desta. Faça isso apenas se o
              cliente deu novo consentimento.
            </p>
          )}
        </div>
      </div>
      {ceremonialistModal &&
        createPortal(
          <CeremonialistFormModal
            onClose={() => setCeremonialistModal(false)}
            onCreated={(created) => {
              ceremonialists.add(created)
              ceremonialists.reload()
              update('ceremonialist_id', created.id)
              setCeremonialistModal(false)
            }}
          />,
          document.body,
        )}
      <SaveBar editor={editor} onSave={() => void save()} onDiscard={close} alwaysVisible />
    </Card>
  )
}

type DateMode = 'single' | 'multi' | 'none'

function EventCard({
  lead,
  editing,
  onEditingChange,
  roomLabels,
  roomsLoading,
  onSaved,
}: {
  lead: Lead
  editing: boolean
  onEditingChange: (editing: boolean) => void
  roomLabels: string[]
  roomsLoading: boolean
  onSaved: (lead: Lead) => void
}) {
  const editor = useLeadSectionDraft(lead, 'event', { hasRooms: roomLabels.length > 0, onSaved })
  const { draft, update, change, errors } = editor
  const rooms = getLeadRooms(lead)
  const period = formatLeadEventPeriod(lead)
  const dateMode: DateMode = draft.no_date ? 'none' : draft.multi_day ? 'multi' : 'single'
  const eventDays = draft.multi_day && !draft.no_date ? countEventDays({ event_date: draft.event_date || null, event_end_date: draft.event_end_date || null }) : null
  // Salas ativas + salas já marcadas que tenham sido desativadas depois
  const roomOptions = [...draft.room_interests.filter((room) => !roomLabels.includes(room)), ...roomLabels]

  const setDateMode = (mode: DateMode) =>
    change(
      (current) => ({
        ...current,
        no_date: mode === 'none',
        multi_day: mode === 'multi',
        event_end_date: mode === 'multi' ? current.event_end_date : '',
      }),
      ['event_date', 'event_end_date'],
    )
  const toggleRoom = (room: string) =>
    change(
      (current) => ({
        ...current,
        room_interests: current.room_interests.includes(room)
          ? current.room_interests.filter((item) => item !== room)
          : [...current.room_interests, room],
      }),
      ['room_interests'],
    )
  const close = () => {
    editor.discard()
    onEditingChange(false)
  }
  const save = async () => {
    if (await editor.save()) onEditingChange(false)
  }

  if (!editing) {
    return (
      <Card icon={CalendarDays} title="Evento" actions={<EditButton onClick={() => onEditingChange(true)} label="Editar evento" />}>
        <dl className="space-y-3">
          {lead.event_name && <InfoRow label="Nome do evento">{lead.event_name}</InfoRow>}
          <InfoRow label="Data">{period ?? (lead.date_notes ? `Sem data definida (${lead.date_notes})` : 'Sem data definida')}</InfoRow>
          <InfoRow label="PAX">{lead.pax !== null ? `${lead.pax.toLocaleString('pt-BR')} pessoas` : empty}</InfoRow>
          <InfoRow label="Salas/Salões de interesse">
            {rooms.length > 0 ? (
              <span className="mt-1 flex flex-wrap gap-1">
                {rooms.map((room) => (
                  <span key={room} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                    {room}
                  </span>
                ))}
              </span>
            ) : (
              empty
            )}
          </InfoRow>
        </dl>
      </Card>
    )
  }

  return (
    <Card icon={CalendarDays} title="Evento" actions={<span className="text-xs font-semibold text-brand-700 dark:text-brand-300">Editando</span>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_7rem]">
          <Field label="Nome do evento" htmlFor="lead-event_name">
            <input
              id="lead-event_name"
              type="text"
              maxLength={200}
              autoComplete="off"
              value={draft.event_name}
              onChange={(event) => update('event_name', event.target.value)}
              className={inputClassName(false)}
            />
          </Field>
          <Field label="PAX" htmlFor="lead-pax">
            <input
              id="lead-pax"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              value={draft.pax}
              onChange={(event) => update('pax', onlyDigits(event.target.value).slice(0, 6))}
              className={cn(inputClassName(false), 'tabular-nums')}
            />
          </Field>
        </div>

        <div>
          <p id="lead-date-mode-label" className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            Data
          </p>
          <div role="radiogroup" aria-labelledby="lead-date-mode-label" className="grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800">
            {(
              [
                ['single', 'Um dia'],
                ['multi', 'Mais de um dia'],
                ['none', 'Sem data'],
              ] as const
            ).map(([mode, text]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={dateMode === mode}
                onClick={() => setDateMode(mode)}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-semibold transition-colors',
                  dateMode === mode
                    ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                {text}
              </button>
            ))}
          </div>
        </div>

        {dateMode === 'none' ? (
          <Field label="Previsão / mês de interesse" htmlFor="lead-date_notes">
            <input
              id="lead-date_notes"
              type="text"
              maxLength={80}
              placeholder="Ex.: Mês/Ano previsto"
              value={draft.date_notes}
              onChange={(event) => update('date_notes', event.target.value)}
              className={inputClassName(false)}
            />
          </Field>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={dateMode === 'multi' ? 'Data inicial' : 'Data do evento'} htmlFor="lead-event_date" error={errors.event_date}>
              <input
                id="lead-event_date"
                type="date"
                value={draft.event_date}
                onChange={(event) => update('event_date', event.target.value)}
                aria-invalid={Boolean(errors.event_date)}
                className={inputClassName(Boolean(errors.event_date))}
              />
            </Field>
            {dateMode === 'multi' && (
              <Field
                label="Data final"
                htmlFor="lead-event_end_date"
                error={errors.event_end_date}
                hint={eventDays && eventDays > 1 ? `${eventDays} dias de evento` : undefined}
              >
                <input
                  id="lead-event_end_date"
                  type="date"
                  value={draft.event_end_date}
                  min={draft.event_date || undefined}
                  onChange={(event) => update('event_end_date', event.target.value)}
                  aria-invalid={Boolean(errors.event_end_date)}
                  className={inputClassName(Boolean(errors.event_end_date))}
                />
              </Field>
            )}
          </div>
        )}

        <div id="lead-room_interests" tabIndex={-1} role="group" aria-labelledby="lead-rooms-label" className="rounded-lg focus:outline-none">
          <p id="lead-rooms-label" className="mb-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            Salas/Salões de interesse
          </p>
          {roomsLoading ? (
            <div className="h-9 w-48 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
          ) : roomOptions.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Nenhuma sala cadastrada. Configure no Painel Admin.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {roomOptions.map((room) => {
                const checked = draft.room_interests.includes(room)
                return (
                  <button
                    key={room}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    onClick={() => toggleRoom(room)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                      checked
                        ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:bg-brand-900/30',
                    )}
                  >
                    {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
                    {room}
                  </button>
                )
              })}
            </div>
          )}
          {errors.room_interests && <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">{errors.room_interests}</p>}
        </div>
      </div>
      <SaveBar editor={editor} onSave={() => void save()} onDiscard={close} alwaysVisible />
    </Card>
  )
}

// =============================================================================
// Página
// =============================================================================

const QUICK_ACTIONS: Array<{ status: 'fechado' | 'perdido'; label: string; icon: LucideIcon; className: string }> = [
  {
    status: 'fechado',
    label: 'Fechou',
    icon: CircleCheck,
    className: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-900/60 dark:text-emerald-400 dark:hover:bg-emerald-950/40',
  },
  {
    status: 'perdido',
    label: 'Perdeu',
    icon: CircleX,
    className: 'border-red-200 text-red-700 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40',
  },
]

/** Leva até o campo que confirma o Fechou (nº da proposta) ou o Perdeu (motivo). */
function focusStatusField(status: 'fechado' | 'perdido') {
  // Espera o campo aparecer no card
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => {
      const element = document.getElementById(status === 'fechado' ? 'lead-proposal_number' : 'lead-loss_reason')
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      element?.focus({ preventScroll: true })
    }),
  )
}

function LeadDetailsContent({ lead, loading, onLeadChange }: { lead: Lead; loading: boolean; onLeadChange: (lead: Lead) => void }) {
  const { showToast } = useOutletContext<LayoutOutletContext>()
  const { isAdmin } = useAuth()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const location = useLocation()
  // Vindo das listas: "Editar" abre os cards em edição; Fechou/Perdeu chegam marcados no card Proposta
  const [intent] = useState(() => (location.state ?? null) as ProposalPageState | null)
  const { options, loading: optionsLoading } = useSettingsOptions()

  const handleSaved = (updated: Lead) => {
    onLeadChange(updated)
    showToast(`Proposta de "${updated.contact_name}" atualizada.`)
  }

  const roomLabels = useMemo(() => options.room.map((option) => option.label), [options.room])
  const proposal = useLeadSectionDraft(lead, 'proposal', { hasRooms: roomLabels.length > 0, initialStatus: intent?.status, onSaved: handleSaved })
  const [editContact, setEditContact] = useState(Boolean(intent?.edit))
  const [editEvent, setEditEvent] = useState(Boolean(intent?.edit))
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // O pedido da lista vale uma vez: recarregar a página não repete
  useEffect(() => {
    if (location.state) navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [location.state, location.pathname, location.search, navigate])
  useEffect(() => {
    if (intent?.status) focusStatusField(intent.status)
  }, [intent])

  const lossReasonLabels = useMemo(() => {
    // Motivos do Painel Admin; sem nenhum, os padrão. "Outros" sempre por último
    const fromDb = options.loss_reason.map((option) => option.label)
    const base = fromDb.length > 0 ? fromDb : [...DEFAULT_LOSS_REASONS]
    const sorted = [...base.filter((label) => label !== LOSS_REASON_OTHER), ...base.filter((label) => label === LOSS_REASON_OTHER)]
    return withCurrentValue(sorted, proposal.draft.loss_reason)
  }, [options.loss_reason, proposal.draft.loss_reason])

  const quickStatus = (status: 'fechado' | 'perdido') => {
    proposal.change((current) => withStatus(current, status), ['proposal_number', 'loss_reason', 'loss_reason_details'])
    focusStatusField(status)
  }

  const startEditing = () => {
    setEditContact(true)
    setEditEvent(true)
    window.requestAnimationFrame(() => document.getElementById('lead-contact_name')?.focus())
  }

  const handleDelete = async () => {
    if (deleting) return
    const confirmed = await confirm({
      title: `Excluir a proposta de "${lead.contact_name}"?`,
      description: 'Essa ação é permanente e remove todos os dados deste orçamento, inclusive os anexos.',
      confirmLabel: 'Excluir proposta',
      tone: 'danger',
    })
    if (!confirmed) return
    setDeleting(true)
    setDeleteError(null)
    // .select() devolve as linhas apagadas: lista vazia = nada foi excluído (sem permissão ou já excluída)
    const { data, error } = await supabase.from('leads').delete().eq('id', lead.id).select('id')
    if (error || !data || data.length === 0) {
      setDeleting(false)
      setDeleteError(
        error?.message.toLowerCase().includes('failed to fetch')
          ? 'Sem conexão com o servidor. A proposta não foi excluída.'
          : 'Esta proposta não foi excluída: ela já não existe ou apenas o ADMIN pode excluir propostas.',
      )
      return
    }
    // Os arquivos anexados saem do bucket junto com a proposta
    await removeLeadFolders([lead.id])
    showToast(`Proposta de "${lead.contact_name}" excluída.`)
    navigate(lead.client_id ? `/leads/${lead.client_id}` : '/propostas', { replace: true })
  }

  return (
    <div className="space-y-6">
      <BackLink />

      {/* Cabeçalho */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{lead.contact_name}</h1>
            <StatusBadge status={lead.status} />
            {loading && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" aria-label="Atualizando" />}
          </div>
          {lead.company && (
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-300">
              <Building2 className="h-4 w-4 text-slate-400" aria-hidden="true" />
              {lead.company}
              {lead.cnpj && <span className="font-normal tabular-nums text-slate-500 dark:text-slate-400">· CNPJ {lead.cnpj}</span>}
            </p>
          )}
          {lead.client_id && <ClientLink clientId={lead.client_id} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WhatsAppButton lead={lead} />
          {lead.status === 'em_aberto' &&
            QUICK_ACTIONS.map(({ status, label, icon: Icon, className }) => (
              <button
                key={status}
                type="button"
                onClick={() => quickStatus(status)}
                title={`${label}: marcar como ${status === 'fechado' ? 'Fechado' : 'Perdido'} no card Proposta`}
                className={cn('inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors', className)}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          {!(editContact && editEvent) && (
            <button
              type="button"
              onClick={startEditing}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Editar dados
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/40 dark:hover:text-red-300"
            >
              {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              {deleting ? 'Excluindo...' : 'Excluir proposta'}
            </button>
          )}
        </div>
      </div>
      {deleteError && <ErrorBanner message={deleteError} />}

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
            <ContactCard
              lead={lead}
              editing={editContact}
              onEditingChange={setEditContact}
              originLabels={options.origin.map((option) => option.label)}
              originsLoading={optionsLoading}
              onSaved={handleSaved}
            />
            <EventCard
              lead={lead}
              editing={editEvent}
              onEditingChange={setEditEvent}
              roomLabels={roomLabels}
              roomsLoading={optionsLoading}
              onSaved={handleSaved}
            />
          </div>

          <ProposalCard editor={proposal} lossReasonLabels={lossReasonLabels} />

          <PostEventCard key={`post-${lead.id}`} lead={lead} onSaved={onLeadChange} />

          <ObservationsCard key={lead.id} lead={lead} onSaved={onLeadChange} />
        </div>

        <div className="space-y-6">
          <AttachmentsCard leadId={lead.id} />

          <Card icon={History} title="Histórico">
            <dl className="space-y-3">
              <InfoRow label="Cadastrado em">{formatDateTime(lead.created_at)}</InfoRow>
              <InfoRow label="Última atualização">{formatDateTime(lead.updated_at)}</InfoRow>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}

function BackLink() {
  return (
    <Link
      to="/propostas"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Consultar Propostas
    </Link>
  )
}

export default function LeadDetails() {
  const { proposalId: leadId = '' } = useParams()
  const { leadsVersion } = useOutletContext<LayoutOutletContext>()
  const [retryCount, setRetryCount] = useState(0)

  const key = `${leadId}|${leadsVersion}|${retryCount}`
  const [result, setResult] = useState<AsyncResult<Lead> | null>(null)

  useEffect(() => {
    let isActive = true
    const controller = new AbortController()
    supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .abortSignal(controller.signal)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isActive || isAbortError(error)) return
        if (error) {
          // id fora do formato uuid cai aqui como "não encontrado"
          const notFound = error.code === '22P02'
          setResult({ key, data: null, error: notFound ? null : 'Não foi possível carregar a proposta. Verifique sua conexão.' })
          return
        }
        setResult({ key, data, error: null })
      })
    return () => {
      isActive = false
      controller.abort()
    }
  }, [key, leadId])

  const loading = result?.key !== key
  // Durante o recarregamento mantém o lead anterior na tela (só se for o mesmo lead)
  const lead = result?.data && result.data.id === leadId ? result.data : null
  const error = !loading ? result?.error ?? null : null

  const handleLeadChange = useCallback((updated: Lead) => setResult((current) => (current ? { ...current, data: updated } : current)), [])

  if (!lead) {
    return (
      <div className="space-y-6">
        <BackLink />
        {loading ? (
          <div className="space-y-4">
            <div className="h-10 w-72 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
            <div className="h-64 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
          </div>
        ) : error ? (
          <ErrorBanner message={error} onRetry={() => setRetryCount((current) => current + 1)} />
        ) : (
          <div className={cn(cardClassName, 'p-10 text-center')}>
            <p className="text-base font-semibold text-slate-900 dark:text-white">Proposta não encontrada</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ela pode ter sido excluída ou o link está incorreto.</p>
          </div>
        )}
      </div>
    )
  }

  return <LeadDetailsContent key={lead.id} lead={lead} loading={loading} onLeadChange={handleLeadChange} />
}
