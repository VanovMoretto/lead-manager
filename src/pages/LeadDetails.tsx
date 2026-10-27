import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BedDouble,
  Building2,
  CalendarDays,
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
  NotebookPen,
  Paperclip,
  Pencil,
  Phone,
  RefreshCw,
  Save,
  ShieldOff,
  Trash2,
  Upload,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react'
import type { LayoutOutletContext } from '../components/Layout'
import StatusBadge from '../components/StatusBadge'
import WhatsAppButton from '../components/WhatsAppButton'
import { useAuth } from '../contexts/AuthContext'
import { formatBRL } from '../lib/format'
import { formatLeadEventPeriod, getLeadRooms, getLeadValues, hasAnyValue } from '../lib/leadFields'
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_FORMATS_LABEL,
  MAX_ATTACHMENT_BYTES,
  deleteLeadAttachment,
  downloadLeadAttachment,
  fetchLeadAttachments,
  openLeadAttachment,
  uploadLeadAttachment,
} from '../lib/leadAttachments'
import { formatFileSize } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { RateLimitError, guardMutation, isAbortError } from '../lib/rateLimit'
import { cn } from '../lib/utils'
import {
  ATTACHMENT_KINDS,
  ATTACHMENT_KIND_LABELS,
  type AttachmentKind,
  type Lead,
  type LeadAttachment,
  type LeadStatus,
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
  const isImage = attachment.mime_type.startsWith('image/')
  const FileIcon = isImage ? ImageIcon : FileText

  const run = async (action: 'open' | 'download' | 'delete') => {
    if (action === 'delete' && !window.confirm(`Excluir o anexo "${attachment.file_name}"? Essa ação é permanente.`)) return
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
// Página
// =============================================================================

const QUICK_ACTIONS: Array<{ status: LeadStatus; label: string; icon: LucideIcon; className: string }> = [
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

export default function LeadDetails() {
  const { leadId = '' } = useParams()
  const { openEditLead, leadsVersion } = useOutletContext<LayoutOutletContext>()
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
          setResult({ key, data: null, error: notFound ? null : 'Não foi possível carregar o lead. Verifique sua conexão.' })
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

  const handleObservationsSaved = (updated: Lead) => setResult((current) => (current ? { ...current, data: updated } : current))

  const backLink = (
    <Link
      to="/leads"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Consultar Leads
    </Link>
  )

  if (!lead) {
    return (
      <div className="space-y-6">
        {backLink}
        {loading ? (
          <div className="space-y-4">
            <div className="h-10 w-72 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
            <div className="h-64 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
          </div>
        ) : error ? (
          <ErrorBanner message={error} onRetry={() => setRetryCount((current) => current + 1)} />
        ) : (
          <div className={cn(cardClassName, 'p-10 text-center')}>
            <p className="text-base font-semibold text-slate-900 dark:text-white">Lead não encontrado</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ele pode ter sido excluído ou o link está incorreto.</p>
          </div>
        )}
      </div>
    )
  }

  const values = getLeadValues(lead)
  const rooms = getLeadRooms(lead)
  const period = formatLeadEventPeriod(lead)
  const proposalSent = lead.proposal_sent || lead.status === 'fechado'
  const valueParts = [
    { label: 'Locação / Espaço', icon: MapPin, value: values.rental, show: lead.proposed_value !== null },
    { label: 'A&B', icon: UtensilsCrossed, value: values.ab, show: lead.has_ab || values.ab > 0 },
    { label: 'Hospedagem', icon: BedDouble, value: values.lodging, show: lead.has_lodging || values.lodging > 0 },
  ].filter((part) => part.show)

  return (
    <div className="space-y-6">
      {backLink}

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
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WhatsAppButton lead={lead} />
          {lead.status === 'em_aberto' &&
            QUICK_ACTIONS.map(({ status, label, icon: Icon, className }) => (
              <button
                key={status}
                type="button"
                onClick={() => openEditLead({ ...lead, status, proposal_sent: status === 'fechado' ? true : lead.proposal_sent })}
                title={`${label}: marcar como ${status === 'fechado' ? 'Fechado' : 'Perdido'}`}
                className={cn('inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors', className)}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          <button
            type="button"
            onClick={() => openEditLead(lead)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Editar dados
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card icon={Phone} title="Contato">
              <dl className="space-y-3">
                <InfoRow label="Telefone / WhatsApp">{lead.contact_phone || empty}</InfoRow>
                <InfoRow label="E-mail">
                  {lead.contact_email ? (
                    <a href={`mailto:${lead.contact_email}`} className="inline-flex items-center gap-1 text-brand-700 hover:underline dark:text-brand-300">
                      <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                      {lead.contact_email}
                    </a>
                  ) : (
                    empty
                  )}
                </InfoRow>
                <InfoRow label="Empresa">{lead.company || 'Pessoa física'}</InfoRow>
                <InfoRow label="Meio de prospecção">{lead.origin || empty}</InfoRow>
                {lead.marketing_opt_out && (
                  <p className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                    <ShieldOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Opt-out LGPD: não enviar comunicações de marketing.
                  </p>
                )}
              </dl>
            </Card>

            <Card icon={CalendarDays} title="Evento">
              <dl className="space-y-3">
                <InfoRow label="Data">{period ?? (lead.date_notes ? `Sem data definida (${lead.date_notes})` : 'Sem data definida')}</InfoRow>
                {lead.is_date_flexible && <InfoRow label="Flexibilidade">Data flexível</InfoRow>}
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
          </div>

          <Card icon={FileText} title="Proposta">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_auto] md:items-start">
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoRow label="Situação da proposta">{proposalSent ? 'Enviada' : 'Sondagem (orçamento verbal)'}</InfoRow>
                <InfoRow label="Nº da proposta">{lead.proposal_number || empty}</InfoRow>
                {lead.status === 'perdido' && (
                  <div className="sm:col-span-2">
                    <InfoRow label="Motivo da perda">
                      {[lead.loss_reason, lead.loss_reason_details].filter(Boolean).join(': ') || empty}
                    </InfoRow>
                  </div>
                )}
              </dl>
              <div className="rounded-lg border border-brand-100 bg-brand-50/60 p-4 md:min-w-[16rem] dark:border-brand-900/60 dark:bg-brand-950/30">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-800 dark:text-brand-200">Receita Total</p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {hasAnyValue(lead) ? formatBRL(values.total) : '—'}
                </p>
                {valueParts.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {valueParts.map(({ label, icon: Icon, value }) => (
                      <li key={label} className="flex items-center justify-between gap-4 text-slate-600 dark:text-slate-300">
                        <span className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                          {label}
                        </span>
                        <span className="tabular-nums">{formatBRL(value)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>

          <ObservationsCard key={lead.id} lead={lead} onSaved={handleObservationsSaved} />
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
