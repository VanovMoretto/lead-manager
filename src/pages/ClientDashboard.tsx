import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  BadgeCheck,
  BedDouble,
  ChartColumn,
  CircleAlert,
  Crown,
  ExternalLink,
  FileText,
  GitBranchPlus,
  Handshake,
  LoaderCircle,
  Mail,
  MapPin,
  NotebookPen,
  Pencil,
  Trash2,
  Plus,
  RefreshCw,
  Save,
  Target,
  TrendingUp,
  UserPlus,
  Users,
  UtensilsCrossed,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { LayoutOutletContext } from '../components/Layout'
import ClientMetricsPanel, { type ClientMetricsView } from '../components/ClientMetricsPanel'
import ClientTypeBadge from '../components/ClientTypeBadge'
import ContactFormModal from '../components/ContactFormModal'
import StatusBadge from '../components/StatusBadge'
import WhatsAppButton from '../components/WhatsAppButton'
import { useAuth } from '../contexts/AuthContext'
import { useConfirm } from '../hooks/useConfirm'
import type { RecurringClientMatch } from '../hooks/useRecurringClient'
import { normalizeEmail, normalizePhoneDigits } from '../lib/contactIdentity'
import { isProposalSent, toLocalISODate } from '../lib/dashboard'
import { formatBRL, formatCNPJ, formatDateBR, isValidCNPJ, onlyDigits } from '../lib/format'
import { formatLeadEventPeriod, getLeadRooms, getLeadValues, hasAnyValue } from '../lib/leadFields'
import { removeAttachmentFiles } from '../lib/leadAttachments'
import { RateLimitError, guardMutation } from '../lib/rateLimit'
import { supabase } from '../lib/supabase'
import { cn, isRowClick } from '../lib/utils'
import { CLIENT_TYPE_LABELS, type Client, type ClientContact, type ClientType, type Lead } from '../types/lead'

const CONTACT_COLUMNS = 'id, client_id, name, role, phone, phone_digits, email, is_primary, active, created_at'
const MAX_NOTES_LENGTH = 5000
const cardClassName = 'rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900'

type ClientData = {
  client: Client
  contacts: ClientContact[]
  leads: Lead[]
  /** Contatos com opt-out (LGPD), pelo e-mail ou telefone. */
  optedOut: Set<string>
}

type LoadResult = { key: string; data: ClientData | null; error: string | null; leadRedirect?: string }

async function loadClient(clientId: string): Promise<Omit<LoadResult, 'key'>> {
  const [clientResponse, contactsResponse, leadsResponse] = await Promise.all([
    supabase.from('clients').select('*').eq('id', clientId).maybeSingle(),
    supabase
      .from('client_contacts')
      .select(CONTACT_COLUMNS)
      .eq('client_id', clientId)
      .order('is_primary', { ascending: false })
      .order('active', { ascending: false })
      .order('created_at', { ascending: true }),
    supabase.from('leads').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
  ])

  // Id fora do formato uuid: trata como "não encontrado"
  if (clientResponse.error?.code === '22P02') return { data: null, error: null }
  if (clientResponse.error || contactsResponse.error || leadsResponse.error) {
    return { data: null, error: 'Não foi possível carregar o lead. Verifique sua conexão e se a migração 009 foi aplicada.' }
  }

  if (!clientResponse.data) {
    // Links antigos /leads/:id apontavam para a proposta: redireciona
    const { data: lead } = await supabase.from('leads').select('id').eq('id', clientId).maybeSingle()
    return lead ? { data: null, error: null, leadRedirect: lead.id } : { data: null, error: null }
  }

  const contacts = contactsResponse.data ?? []
  const keys = contacts.flatMap((contact) => {
    const phone = normalizePhoneDigits({ contact_phone: contact.phone, contact_phone_digits: contact.phone_digits })
    const email = normalizeEmail(contact.email)
    return [...(phone ? [phone] : []), ...(email ? [email] : [])]
  })
  const optedOut = new Set<string>()
  if (keys.length > 0) {
    // Informativo: sem a lista, o botão de WhatsApp aparece normalmente
    const { data } = await supabase.from('marketing_suppressions').select('value').in('value', keys)
    data?.forEach((row) => optedOut.add(row.value))
  }

  return { data: { client: clientResponse.data, contacts, leads: leadsResponse.data ?? [], optedOut }, error: null }
}

function isContactOptedOut(contact: ClientContact, optedOut: Set<string>): boolean {
  const phone = normalizePhoneDigits({ contact_phone: contact.phone, contact_phone_digits: contact.phone_digits })
  const email = normalizeEmail(contact.email)
  return Boolean((phone && optedOut.has(phone)) || (email && optedOut.has(email)))
}

function formatPercent(value: number): string {
  return `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function yearOf(iso: string): number {
  return new Date(iso).getFullYear()
}

// =============================================================================
// Componentes de apoio
// =============================================================================

function KpiCard({
  icon: Icon,
  label,
  value,
  accent,
  onClick,
  children,
}: {
  icon: LucideIcon
  label: string
  value: string
  accent: string
  onClick?: () => void
  children?: ReactNode
}) {
  const content = (
    <>
      <div className="flex items-center gap-2">
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg', accent)}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        {onClick && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-brand-700 opacity-70 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 dark:text-brand-300">
            <ChartColumn className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Ver gráficos</span>
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl font-bold tracking-tight text-slate-900 tabular-nums dark:text-white">{value}</p>
      {children && <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">{children}</div>}
    </>
  )
  if (!onClick) return <div className={cn(cardClassName, 'p-5')}>{content}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className={cn(
        cardClassName,
        'group p-5 text-left transition-all hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 dark:hover:border-brand-700',
      )}
    >
      {content}
    </button>
  )
}

function SectionCard({ icon: Icon, title, action, children }: { icon: LucideIcon; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={cardClassName}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
          <Icon className="h-5 w-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  )
}

/** Nome, tipo e observações gerais do cliente, editáveis. */
function ClientHeaderEditor({ client, onSaved }: { client: Client; onSaved: (client: Client) => void }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(client.name)
  const [type, setType] = useState<ClientType>(client.client_type)
  const [cnpj, setCnpj] = useState(client.cnpj ? formatCNPJ(client.cnpj) : '')
  const [branchLabel, setBranchLabel] = useState(client.branch_label ?? '')
  const [notes, setNotes] = useState(client.notes ?? '')
  const [saving, setSaving] = useState<'header' | 'notes' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const notesDirty = notes.trim() !== (client.notes ?? '').trim()

  const save = async (kind: 'header' | 'notes') => {
    const payload =
      kind === 'header'
        ? {
            name: name.trim().replace(/\s+/g, ' '),
            client_type: type,
            cnpj: isValidCNPJ(cnpj) ? formatCNPJ(cnpj) : null,
            branch_label: branchLabel.trim() || null,
          }
        : { notes: notes.trim() || null }
    if (kind === 'header' && !payload.name) {
      setError('Informe o nome do cliente.')
      return
    }
    if (kind === 'header' && onlyDigits(cnpj).length > 0 && !isValidCNPJ(cnpj)) {
      setError('CNPJ inválido. Confira os 14 dígitos.')
      return
    }
    setSaving(kind)
    setError(null)
    try {
      const { data, error: dbError } = await guardMutation(`client:${client.id}:${kind}:${JSON.stringify(payload)}`, async () =>
        supabase.from('clients').update(payload).eq('id', client.id).select('*').single(),
      )
      if (dbError || !data) {
        setError(
          dbError?.code === '23505'
            ? await describeCnpjOwner(cnpj)
            : dbError?.message.includes('clients_text_lengths') || dbError?.message.includes('clients_branch_label_length')
              ? 'O texto passou do tamanho máximo permitido.'
              : 'Não foi possível salvar. Verifique sua conexão e tente novamente.',
        )
        return
      }
      onSaved(data)
      if (kind === 'header') setEditing(false)
    } catch (guardError) {
      setError(guardError instanceof RateLimitError ? guardError.message : 'Não foi possível salvar. Tente novamente.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="min-w-0 flex-1">
      {editing ? (
        <div className="space-y-2">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="client-name" className="sr-only">
            Nome do cliente
          </label>
          <input
            id="client-name"
            type="text"
            autoFocus
            maxLength={150}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save('header')
              if (event.key === 'Escape') setEditing(false)
            }}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-lg font-semibold text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          <label htmlFor="client-type-edit" className="sr-only">
            Tipo de cliente
          </label>
          <select
            id="client-type-edit"
            value={type}
            onChange={(event) => setType(event.target.value as ClientType)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          >
            {(Object.keys(CLIENT_TYPE_LABELS) as ClientType[]).map((value) => (
              <option key={value} value={value}>
                {CLIENT_TYPE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label htmlFor="client-cnpj" className="sr-only">
            CNPJ
          </label>
          <input
            id="client-cnpj"
            type="text"
            inputMode="numeric"
            placeholder="CNPJ 00.000.000/0000-00"
            value={cnpj}
            onChange={(event) => setCnpj(formatCNPJ(event.target.value))}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 sm:w-56 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          <label htmlFor="client-branch" className="sr-only">
            Identificação do braço
          </label>
          <input
            id="client-branch"
            type="text"
            maxLength={80}
            placeholder="Braço (ex.: Matriz, Filial Centro)"
            value={branchLabel}
            onChange={(event) => setBranchLabel(event.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save('header')}
              disabled={saving !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving === 'header' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Salvar
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setName(client.name)
                setType(client.client_type)
                setCnpj(client.cnpj ? formatCNPJ(client.cnpj) : '')
                setBranchLabel(client.branch_label ?? '')
                setError(null)
              }}
              aria-label="Cancelar edição"
              className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{client.name}</h1>
          <ClientTypeBadge type={client.client_type} />
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Editar nome, tipo e CNPJ"
            aria-label="Editar nome, tipo e CNPJ do cliente"
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {!editing && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600 dark:text-slate-300">
          {client.branch_label && (
            <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {client.branch_label}
            </span>
          )}
          {client.cnpj ? (
            <span className="font-medium tabular-nums">CNPJ {client.cnpj}</span>
          ) : (
            client.client_type === 'company' && (
              <button
                type="button"
                onClick={() => {
                  setEditing(true)
                  window.setTimeout(() => document.getElementById('client-cnpj')?.focus(), 0)
                }}
                className="font-medium text-brand-700 hover:underline dark:text-brand-300"
              >
                + Adicionar CNPJ
              </button>
            )
          )}
          {client.email_domain && <span className="text-slate-500 dark:text-slate-400">Domínio corporativo: @{client.email_domain}</span>}
        </div>
      )}

      <div className="mt-4 max-w-3xl">
        <label htmlFor="client-notes" className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <NotebookPen className="h-3.5 w-3.5" aria-hidden="true" />
          Observações gerais do cliente
        </label>
        <textarea
          id="client-notes"
          rows={2}
          maxLength={MAX_NOTES_LENGTH}
          placeholder="Ex.: prefere contato por e-mail, faz evento de fim de ano todo dezembro..."
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="block w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
        />
        {notesDirty && (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void save('notes')}
              disabled={saving !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving === 'notes' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
              Salvar observações
            </button>
            <button
              type="button"
              onClick={() => setNotes(client.notes ?? '')}
              className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Descartar
            </button>
          </div>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 flex items-center gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
          <CircleAlert className="h-4 w-4" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

/** CNPJ já usado em outro cadastro: diz em qual, para o vendedor abrir o certo. */
async function describeCnpjOwner(cnpj: string): Promise<string> {
  const { data } = await supabase
    .from('clients')
    .select('name, branch_label')
    .eq('cnpj_digits', onlyDigits(cnpj))
    .maybeSingle()
  return data
    ? `Este CNPJ já pertence ao cadastro "${data.name}${data.branch_label ? ` (${data.branch_label})` : ''}". Use Consultar Leads para abri-lo.`
    : 'Este CNPJ já está cadastrado em outro braço.'
}

/** Cadastra outro braço (filial, franquia) da mesma marca, com CNPJ próprio. */
function NewBranchModal({ client, onClose, onCreated }: { client: Client; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState(client.name)
  const [branchLabel, setBranchLabel] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return
    if (!name.trim()) return setError('Informe o nome da empresa.')
    if (onlyDigits(cnpj).length > 0 && !isValidCNPJ(cnpj)) return setError('CNPJ inválido. Confira os 14 dígitos.')
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: name.trim().replace(/\s+/g, ' '),
        client_type: 'company' as const,
        email_domain: client.email_domain,
        cnpj: isValidCNPJ(cnpj) ? formatCNPJ(cnpj) : null,
        branch_label: branchLabel.trim() || null,
      }
      const { data, error: dbError } = await guardMutation(`branch:${client.id}:${JSON.stringify(payload)}`, async () =>
        supabase.from('clients').insert(payload).select('id').single(),
      )
      if (dbError || !data) {
        setError(dbError?.code === '23505' ? await describeCnpjOwner(cnpj) : 'Não foi possível criar o braço. Tente novamente.')
        return
      }
      onCreated(data.id)
    } catch (guardError) {
      setError(guardError instanceof RateLimitError ? guardError.message : 'Não foi possível criar o braço. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  const inputClass =
    'block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="branch-form-title"
        onSubmit={submit}
        noValidate
        className="relative w-full max-w-lg rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h2 id="branch-form-title" className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
            <GitBranchPlus className="h-5 w-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
            Criar outro braço / CNPJ
          </h2>
          <button type="button" onClick={onClose} aria-label="Fechar" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>
        <div className="space-y-4 px-5 py-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Para uma filial ou franquia da mesma marca com CNPJ próprio. O braço novo tem histórico, contatos e receita separados.
          </p>
          <div>
            <label htmlFor="branch-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Nome da empresa
            </label>
            <input id="branch-name" type="text" maxLength={150} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="branch-cnpj" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                CNPJ
              </label>
              <input
                id="branch-cnpj"
                type="text"
                inputMode="numeric"
                autoFocus
                placeholder="00.000.000/0000-00"
                value={cnpj}
                onChange={(event) => setCnpj(formatCNPJ(event.target.value))}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="branch-label" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Identificação do braço
              </label>
              <input
                id="branch-label"
                type="text"
                maxLength={80}
                placeholder="Ex.: Filial Novo Hamburgo"
                value={branchLabel}
                onChange={(event) => setBranchLabel(event.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Criar braço
          </button>
        </footer>
      </form>
    </div>
  )
}

/**
 * Exclui o cliente (somente ADMIN). Os contatos saem junto; as propostas ficam sem vínculo,
 * a não ser que o ADMIN marque para excluí-las também (com os anexos).
 */
function DeleteClientModal({
  client,
  leadIds,
  onClose,
  onDeleted,
}: {
  client: Client
  leadIds: string[]
  onClose: () => void
  onDeleted: () => void
}) {
  const [withProposals, setWithProposals] = useState(false)
  const [confirmation, setConfirmation] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = client.client_type === 'company' ? 'empresa' : 'cliente'
  const canDelete = confirmation.trim().toLocaleLowerCase('pt-BR') === client.name.trim().toLocaleLowerCase('pt-BR')

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, deleting])

  const remove = async () => {
    if (!canDelete || deleting) return
    setDeleting(true)
    setError(null)
    try {
      if (withProposals && leadIds.length > 0) {
        const { data: files } = await supabase.from('lead_attachments').select('storage_path').in('lead_id', leadIds)
        const { data: removed, error: leadsError } = await supabase.from('leads').delete().in('id', leadIds).select('id')
        if (leadsError || (removed?.length ?? 0) === 0) {
          setError('Não foi possível excluir as propostas deste cliente. Apenas o ADMIN pode excluir.')
          return
        }
        await removeAttachmentFiles((files ?? []).map((file) => file.storage_path))
      }
      // .select() confirma a exclusão: a política do banco pode recusar em silêncio
      const { data, error: dbError } = await supabase.from('clients').delete().eq('id', client.id).select('id')
      if (dbError || !data || data.length === 0) {
        setError(`Não foi possível excluir esta ${label}. Apenas o ADMIN pode excluir.`)
        return
      }
      onDeleted()
    } catch {
      setError('Sem conexão com o servidor. Nada foi excluído.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => !deleting && onClose()} />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-client-title"
        className="relative w-full max-w-lg rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400">
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <h2 id="delete-client-title" className="text-base font-semibold text-slate-900 dark:text-white">
            Excluir {label} "{client.name}"
          </h2>
        </header>
        <div className="space-y-4 px-5 py-5 text-sm text-slate-600 dark:text-slate-300">
          <p>
            A exclusão é permanente. As pessoas de contato saem junto.{' '}
            {leadIds.length > 0
              ? `As ${leadIds.length} proposta(s) continuam em Consultar Propostas, sem vínculo com um cliente.`
              : 'Não há propostas vinculadas.'}
          </p>
          {leadIds.length > 0 && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-red-200 bg-red-50/60 px-3 py-2.5 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">
              <input
                type="checkbox"
                checked={withProposals}
                onChange={(event) => setWithProposals(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-red-300 text-red-600 focus:ring-red-600"
              />
              <span>
                Excluir também as {leadIds.length} proposta(s) deste cliente, com os anexos
              </span>
            </label>
          )}
          <div>
            <label htmlFor="delete-client-confirm" className="mb-1.5 block font-medium text-slate-700 dark:text-slate-200">
              Para confirmar, digite o nome: <strong className="font-semibold">{client.name}</strong>
            </label>
            <input
              id="delete-client-confirm"
              type="text"
              autoFocus
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void remove()}
            disabled={!canDelete || deleting}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {deleting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
            Excluir {label}
          </button>
        </footer>
      </div>
    </div>
  )
}

type ContactStats = { count: number; firstYear: number | null; lastYear: number | null }

function ContactCard({
  contact,
  stats,
  optedOut,
  onEdit,
  onDelete,
}: {
  contact: ClientContact
  stats: ContactStats
  optedOut: boolean
  onEdit: () => void
  /** Só para ADMIN. */
  onDelete?: () => void
}) {
  const years =
    stats.firstYear === null ? null : stats.firstYear === stats.lastYear ? String(stats.firstYear) : `${stats.firstYear}–${stats.lastYear}`
  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-xl border p-4',
        contact.active ? 'border-slate-200 dark:border-slate-800' : 'border-dashed border-slate-300 bg-slate-50/60 dark:border-slate-700 dark:bg-slate-950/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('flex flex-wrap items-center gap-1.5 font-semibold', contact.active ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400')}>
            <span className="truncate">{contact.name}</span>
            {years && <span className="text-xs font-medium text-slate-400">[{years}]</span>}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{contact.role || 'Cargo não informado'}</p>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <button
            type="button"
            onClick={onEdit}
            title="Editar contato"
            aria-label={`Editar ${contact.name}`}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
          {onDelete && (
            <button
              type="button"
              onClick={onDelete}
              title="Excluir contato"
              aria-label={`Excluir ${contact.name}`}
              className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {contact.is_primary && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300">
            <Crown className="h-3 w-3" aria-hidden="true" />
            Principal
          </span>
        )}
        {!contact.active && (
          <span className="inline-flex rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            Inativo / saiu da empresa
          </span>
        )}
        <span className="inline-flex rounded-full bg-brand-50 px-2 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          {stats.count} {stats.count === 1 ? 'proposta' : 'propostas'}
        </span>
      </div>
      <div className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
        <div className="flex flex-wrap items-center gap-2">
          <span>{contact.phone || 'Sem telefone'}</span>
          <WhatsAppButton
            greeting
            lead={{ contact_name: contact.name, contact_phone: contact.phone, room_interests: [], room_interest: null, marketing_opt_out: optedOut }}
          />
        </div>
        {contact.email ? (
          <a href={`mailto:${contact.email}`} className="inline-flex max-w-full items-center gap-1 text-brand-700 hover:underline dark:text-brand-300">
            <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{contact.email}</span>
          </a>
        ) : (
          <p className="text-slate-400 dark:text-slate-500">Sem e-mail</p>
        )}
      </div>
    </li>
  )
}

// =============================================================================
// Página
// =============================================================================

export default function ClientDashboard() {
  const { clientId = '' } = useParams()
  const { openEditLead, openNewLeadForClient, leadsVersion } = useOutletContext<LayoutOutletContext>()
  const { isAdmin } = useAuth()
  const confirm = useConfirm()
  const [deleteModal, setDeleteModal] = useState(false)
  const [contactError, setContactError] = useState<string | null>(null)
  const navigate = useNavigate()
  const [retryCount, setRetryCount] = useState(0)
  const [contactModal, setContactModal] = useState<{ contact: ClientContact | null } | null>(null)
  const [branchModal, setBranchModal] = useState(false)
  const [metricsOpen, setMetricsOpen] = useState(false)
  const [metricsView, setMetricsView] = useState<ClientMetricsView>('revenue')
  const closeMetrics = useCallback(() => setMetricsOpen(false), [])
  const openMetrics = (view: ClientMetricsView) => {
    setMetricsView(view)
    setMetricsOpen(true)
  }

  const key = `${clientId}|${leadsVersion}|${retryCount}`
  const [result, setResult] = useState<LoadResult | null>(null)

  useEffect(() => {
    let isActive = true
    loadClient(clientId)
      .then((loaded) => {
        if (isActive) setResult({ key, ...loaded })
      })
      .catch(() => {
        if (isActive) setResult({ key, data: null, error: 'Não foi possível carregar o lead. Verifique sua conexão.' })
      })
    return () => {
      isActive = false
    }
  }, [key, clientId])

  const loading = result?.key !== key
  // Durante o recarregamento mantém o cliente na tela (só se for o mesmo)
  const data = result?.data && result.data.client.id === clientId ? result.data : null
  const error = !loading ? (result?.error ?? null) : null

  const summary = useMemo(() => {
    const leads = data?.leads ?? []
    const closed = leads.filter((lead) => lead.status === 'fechado')
    const open = leads.filter((lead) => lead.status === 'em_aberto')
    const closedValues = closed.map(getLeadValues)
    const ltv = closedValues.reduce((sum, values) => sum + values.total, 0)
    return {
      total: leads.length,
      sent: leads.filter(isProposalSent).length,
      closedCount: closed.length,
      openCount: open.length,
      ltv,
      rental: closedValues.reduce((sum, values) => sum + values.rental, 0),
      ab: closedValues.reduce((sum, values) => sum + values.ab, 0),
      lodging: closedValues.reduce((sum, values) => sum + values.lodging, 0),
      pipeline: open.reduce((sum, lead) => sum + getLeadValues(lead).total, 0),
      conversion: leads.length > 0 ? closed.length / leads.length : 0,
      ticket: closed.length > 0 ? ltv / closed.length : 0,
    }
  }, [data])

  const contactStats = useMemo(() => {
    const stats = new Map<string, ContactStats>()
    for (const lead of data?.leads ?? []) {
      if (!lead.contact_id) continue
      const current = stats.get(lead.contact_id) ?? { count: 0, firstYear: null, lastYear: null }
      const year = yearOf(lead.created_at)
      stats.set(lead.contact_id, {
        count: current.count + 1,
        firstYear: current.firstYear === null ? year : Math.min(current.firstYear, year),
        lastYear: current.lastYear === null ? year : Math.max(current.lastYear, year),
      })
    }
    return stats
  }, [data])

  const backLink = (
    <Link
      to="/leads"
      className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Consultar Leads
    </Link>
  )

  if (!loading && result?.leadRedirect) return <Navigate to={`/propostas/${result.leadRedirect}`} replace />

  if (!data) {
    return (
      <div className="space-y-6">
        {backLink}
        {loading ? (
          <div className="space-y-4">
            <div className="h-10 w-72 animate-pulse rounded-lg bg-slate-200 dark:bg-slate-800" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="h-32 animate-pulse rounded-xl bg-slate-200 dark:bg-slate-800" />
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center dark:border-red-900/60 dark:bg-red-950/30">
            <CircleAlert className="h-8 w-8 text-red-500" aria-hidden="true" />
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => setRetryCount((current) => current + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Tentar de novo
            </button>
          </div>
        ) : (
          <div className={cn(cardClassName, 'p-10 text-center')}>
            <p className="text-base font-semibold text-slate-900 dark:text-white">Lead não encontrado</p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Ele pode ter sido excluído ou o link está incorreto.</p>
          </div>
        )}
      </div>
    )
  }

  const { client, contacts, leads, optedOut } = data
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]))
  const target = client.client_type === 'company' ? 'na empresa' : 'do cliente'

  const handleNewProposal = () => {
    const match: RecurringClientMatch = {
      client: {
        id: client.id,
        name: client.name,
        client_type: client.client_type,
        email_domain: client.email_domain,
        cnpj: client.cnpj,
        branch_label: client.branch_label,
      },
      reasons: [],
      branches: [],
      contacts: contacts.filter((contact) => contact.active),
      matchedContactId: null,
      count: summary.total,
      closedCount: summary.closedCount,
      closedRevenue: summary.ltv,
      last: leads[0] ?? null,
    }
    openNewLeadForClient(match)
  }

  const updateData = (patch: Partial<ClientData>) =>
    setResult((current) => (current?.data ? { ...current, data: { ...current.data, ...patch } } : current))

  const handleContactSaved = (saved: ClientContact) => {
    const others = contacts
      .filter((contact) => contact.id !== saved.id)
      .map((contact) => (saved.is_primary ? { ...contact, is_primary: false } : contact))
    const next = [...others, saved].sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary) || Number(b.active) - Number(a.active) || a.created_at.localeCompare(b.created_at),
    )
    updateData({ contacts: next })
    setContactModal(null)
  }

  /** Exclui a pessoa de contato (somente ADMIN); as propostas dela continuam, sem o contato. */
  const handleDeleteContact = async (contact: ClientContact) => {
    const count = contactStats.get(contact.id)?.count ?? 0
    const confirmed = await confirm({
      title: `Excluir o contato "${contact.name}"?`,
      description:
        count > 0
          ? `Essa ação é permanente. As ${count} proposta(s) tratadas com essa pessoa continuam no histórico, sem o vínculo com o contato.`
          : 'Essa ação é permanente.',
      confirmLabel: 'Excluir contato',
      tone: 'danger',
    })
    if (!confirmed) return
    setContactError(null)
    const { data: removed, error: dbError } = await supabase.from('client_contacts').delete().eq('id', contact.id).select('id')
    if (dbError || !removed || removed.length === 0) {
      setContactError('Não foi possível excluir o contato. Apenas o ADMIN pode excluir.')
      return
    }
    updateData({ contacts: contacts.filter((item) => item.id !== contact.id) })
  }

  return (
    <div className="space-y-6">
      {backLink}
      <ClientMetricsPanel clientName={client.name} leads={leads} open={metricsOpen} view={metricsView} onChangeView={setMetricsView} onClose={closeMetrics} />

      {/* Cabeçalho */}
      <div className={cn(cardClassName, 'flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between')}>
        <ClientHeaderEditor key={client.updated_at} client={client} onSaved={(updated) => updateData({ client: updated })} />
        <div className="flex shrink-0 flex-wrap items-center gap-2 lg:flex-col lg:items-end">
          {loading && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" aria-label="Atualizando" />}
          <button
            type="button"
            onClick={handleNewProposal}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nova Proposta para este Cliente
          </button>
          {client.client_type === 'company' && (
            <button
              type="button"
              onClick={() => setBranchModal(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 dark:border-slate-700 dark:text-slate-200 dark:hover:border-brand-800 dark:hover:bg-brand-900/30"
            >
              <GitBranchPlus className="h-4 w-4" aria-hidden="true" />
              Criar outro braço / CNPJ desta empresa
            </button>
          )}
          {isAdmin && (
            <button
              type="button"
              onClick={() => setDeleteModal(true)}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Excluir {client.client_type === 'company' ? 'empresa' : 'cliente'}
            </button>
          )}
        </div>
      </div>

      {/* KPIs do cliente */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={Wallet} label="Receita total gerada (LTV)" value={formatBRL(summary.ltv)} accent="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" onClick={() => openMetrics('revenue')}>
          <div className="space-y-0.5">
            <p className="flex items-center gap-1.5">
              <MapPin className="h-3 w-3" aria-hidden="true" /> Locação {formatBRL(summary.rental)}
            </p>
            <p className="flex items-center gap-1.5">
              <UtensilsCrossed className="h-3 w-3" aria-hidden="true" /> A&amp;B {formatBRL(summary.ab)}
            </p>
            <p className="flex items-center gap-1.5">
              <BedDouble className="h-3 w-3" aria-hidden="true" /> Hospedagem {formatBRL(summary.lodging)}
            </p>
          </div>
        </KpiCard>
        <KpiCard icon={TrendingUp} label="Em negociação (pipeline)" value={formatBRL(summary.pipeline)} accent="bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" onClick={() => openMetrics('pipeline')}>
          {summary.openCount} {summary.openCount === 1 ? 'proposta em aberto' : 'propostas em aberto'}
        </KpiCard>
        <KpiCard icon={Target} label="Conversão do cliente" value={formatPercent(summary.conversion)} accent="bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300" onClick={() => openMetrics('conversion')}>
          {summary.total} {summary.total === 1 ? 'solicitação' : 'solicitações'} · {summary.sent} {summary.sent === 1 ? 'enviada' : 'enviadas'} ·{' '}
          {summary.closedCount} {summary.closedCount === 1 ? 'fechada' : 'fechadas'}
        </KpiCard>
        <KpiCard icon={Handshake} label="Ticket médio fechado" value={formatBRL(summary.ticket)} accent="bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
          {summary.closedCount > 0 ? `Média de ${summary.closedCount} ${summary.closedCount === 1 ? 'evento fechado' : 'eventos fechados'}` : 'Nenhum evento fechado ainda'}
        </KpiCard>
      </div>

      {/* Pessoas de contato */}
      <SectionCard
        icon={Users}
        title={`Pessoas de contato ${target}`}
        action={
          <button
            type="button"
            onClick={() => setContactModal({ contact: null })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 dark:border-slate-700 dark:text-slate-200 dark:hover:border-brand-800 dark:hover:bg-brand-900/30"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Adicionar pessoa de contato
          </button>
        }
      >
        {contactError && (
          <p role="alert" className="mx-5 mt-4 flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            {contactError}
          </p>
        )}
        {contacts.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">Nenhuma pessoa de contato cadastrada.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2 2xl:grid-cols-3">
            {contacts.map((contact) => (
              <ContactCard
                key={contact.id}
                contact={contact}
                stats={contactStats.get(contact.id) ?? { count: 0, firstYear: null, lastYear: null }}
                optedOut={isContactOptedOut(contact, optedOut)}
                onEdit={() => setContactModal({ contact })}
                onDelete={isAdmin ? () => void handleDeleteContact(contact) : undefined}
              />
            ))}
          </ul>
        )}
      </SectionCard>

      {/* Histórico de propostas */}
      <SectionCard icon={FileText} title={`Histórico de propostas (${leads.length})`}>
        {leads.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-5 py-10 text-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">Nenhuma proposta para este cliente ainda.</p>
            <button
              type="button"
              onClick={handleNewProposal}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Cadastrar a primeira proposta
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="whitespace-nowrap border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
                <tr>
                  <th scope="col" className="py-3 pl-5 pr-3">Solicitação</th>
                  <th scope="col" className="px-3 py-3">Nº proposta</th>
                  <th scope="col" className="px-3 py-3">Solicitado por</th>
                  <th scope="col" className="px-3 py-3">Salas</th>
                  <th scope="col" className="px-3 py-3">Evento</th>
                  <th scope="col" className="px-3 py-3 text-right">Receita total</th>
                  <th scope="col" className="px-3 py-3">Situação</th>
                  <th scope="col" className="px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {leads.map((lead) => {
                  const contact = lead.contact_id ? contactById.get(lead.contact_id) : undefined
                  const rooms = getLeadRooms(lead)
                  const values = getLeadValues(lead)
                  const period = formatLeadEventPeriod(lead)
                  return (
                    <tr
                      key={lead.id}
                      onClick={(event) => {
                        if (isRowClick(event.target)) navigate(`/propostas/${lead.id}`)
                      }}
                      className="cursor-pointer align-top transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <td className="whitespace-nowrap py-3 pl-5 pr-3 text-slate-600 dark:text-slate-300">
                        {formatDateBR(toLocalISODate(new Date(lead.created_at)))}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        {lead.proposal_number ? (
                          <span className="font-medium text-slate-800 dark:text-slate-100">Nº {lead.proposal_number}</span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">{lead.proposal_sent ? 'Enviada' : 'Sondagem'}</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-slate-800 dark:text-slate-100">{contact?.name ?? lead.contact_name}</p>
                        {contact?.role && <p className="text-xs text-slate-500 dark:text-slate-400">{contact.role}</p>}
                      </td>
                      <td className="px-3 py-3">
                        {rooms.length > 0 ? (
                          <div className="flex max-w-[14rem] flex-wrap gap-1">
                            {rooms.map((room) => (
                              <span key={room} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                {room}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-700 dark:text-slate-200">
                        {period ?? <span className="text-slate-500 dark:text-slate-400">{lead.date_notes || 'Sem data'}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                        {hasAnyValue(lead) ? (
                          <>
                            <p className="font-semibold text-slate-900 dark:text-white">{formatBRL(values.total)}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              Loc. {formatBRL(values.rental)} · A&amp;B {formatBRL(values.ab)} · Hosp. {formatBRL(values.lodging)}
                            </p>
                          </>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={lead.status} />
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        <div className="inline-flex gap-1.5">
                          <Link
                            to={`/propostas/${lead.id}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 dark:border-slate-700 dark:text-slate-200 dark:hover:border-brand-800 dark:hover:bg-brand-900/30"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            Detalhes
                          </Link>
                          <button
                            type="button"
                            onClick={() => openEditLead(lead)}
                            aria-label={`Editar proposta de ${lead.contact_name}`}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 dark:border-slate-700 dark:text-slate-200 dark:hover:border-brand-800 dark:hover:bg-brand-900/30"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {summary.closedCount > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <BadgeCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
          Receita, conversão e ticket médio consideram todas as propostas deste cliente, de todos os anos.
        </p>
      )}

      {branchModal && (
        <NewBranchModal
          client={client}
          onClose={() => setBranchModal(false)}
          onCreated={(id) => {
            setBranchModal(false)
            navigate(`/leads/${id}`)
          }}
        />
      )}

      {deleteModal && (
        <DeleteClientModal
          client={client}
          leadIds={leads.map((lead) => lead.id)}
          onClose={() => setDeleteModal(false)}
          onDeleted={() => navigate('/leads', { replace: true })}
        />
      )}

      {contactModal && (
        <ContactFormModal
          clientId={client.id}
          contact={contactModal.contact}
          isFirstContact={contacts.length === 0}
          onClose={() => setContactModal(null)}
          onSaved={handleContactSaved}
        />
      )}
    </div>
  )
}
