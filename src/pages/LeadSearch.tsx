import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import {
  Building2,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  FileSpreadsheet,
  FileText,
  FilterX,
  LoaderCircle,
  Mail,
  Pencil,
  RefreshCw,
  Search,
  SearchX,
  X,
} from 'lucide-react'
import PageHeader from '../components/PageHeader'
import ExportPreviewModal, { type ExportKind, type ExportPreviewData } from '../components/ExportPreviewModal'
import StatusBadge from '../components/StatusBadge'
import WhatsAppButton from '../components/WhatsAppButton'
import type { LayoutOutletContext } from '../components/Layout'
import { useSettingsOptions } from '../hooks/useSettingsOptions'
import { cn, isRowClick } from '../lib/utils'
import { formatBRL, formatDateBR } from '../lib/format'
import { countEventDays, getLeadRooms, getLeadValues, hasAnyValue } from '../lib/leadFields'
import { useCompanies } from '../hooks/useCompanies'
import { toLocalISODate } from '../lib/dashboard'
import {
  COMPANY_FILTER_WITH,
  COMPANY_FILTER_WITHOUT,
  DATE_FIELD_LABELS,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  countActiveFilters,
  describeFilters,
  fetchAllFilteredLeads,
  fetchMarketingSuppressions,
  fetchLeadPage,
  type DateField,
  type LeadPage,
  type LeadSearchFilters,
  type LeadSort,
  type SortField,
  type YesNoFilter,
} from '../lib/leadQuery'
import { DEFAULT_LOSS_REASONS, type Lead, type LeadStatus } from '../types/lead'

// =============================================================================
// Constantes visuais
// =============================================================================

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const
const SEARCH_DEBOUNCE_MS = 350

const STATUS_FILTER_OPTIONS: Array<{ value: LeadStatus | 'all'; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'em_aberto', label: 'Em Aberto' },
  { value: 'fechado', label: 'Fechou' },
  { value: 'perdido', label: 'Não Fechou' },
]

const YES_NO_OPTIONS: Array<{ value: YesNoFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'yes', label: 'Sim' },
  { value: 'no', label: 'Não' },
]

const controlClassName = cn(
  'block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors',
  'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20',
  'dark:border-slate-700 dark:bg-slate-950 dark:text-white',
)

type AsyncResult<T> = { key: string; data: T | null; error: string | null }

// =============================================================================
// Componentes de apoio
// =============================================================================

function FilterField({ label, htmlFor, children, className }: { label: string; htmlFor: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </label>
      {children}
    </div>
  )
}

/** Salas do lead como etiquetas; a sala filtrada aparece destacada. */
function RoomTags({ rooms, highlight }: { rooms: string[]; highlight?: string }) {
  if (rooms.length === 0) return <p className="text-slate-400 dark:text-slate-500">—</p>
  return (
    <div className="flex max-w-[16rem] flex-wrap gap-1">
      {rooms.map((room) => (
        <span
          key={room}
          className={cn(
            'rounded-md px-1.5 py-0.5 text-xs font-medium',
            room === highlight
              ? 'bg-brand-600 text-white'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
          )}
        >
          {room}
        </span>
      ))}
    </div>
  )
}

/** Receita total em destaque e a composição (locação, A&B, hospedagem) logo abaixo. */
function ValueCell({ lead }: { lead: Lead }) {
  if (!hasAnyValue(lead)) return <span className="text-slate-400 dark:text-slate-500">—</span>
  const values = getLeadValues(lead)
  const parts = [
    { label: 'Locação', value: values.rental, show: lead.proposed_value !== null },
    { label: 'A&B', value: values.ab, show: lead.has_ab || values.ab > 0 },
    { label: 'Hosp.', value: values.lodging, show: lead.has_lodging || values.lodging > 0 },
  ].filter((part) => part.show)

  return (
    <div>
      <p className="font-semibold text-slate-900 dark:text-white">{formatBRL(values.total)}</p>
      {parts.length > 1 && (
        <div className="mt-0.5 space-y-px text-xs text-slate-500 dark:text-slate-400">
          {parts.map((part) => (
            <p key={part.label}>
              {part.label} {formatBRL(part.value)}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

type SortableHeaderProps = {
  field: SortField
  label: string
  sort: LeadSort
  onSort: (field: SortField) => void
  align?: 'left' | 'right'
  className?: string
}

function SortableHeader({ field, label, sort, onSort, align = 'left', className }: SortableHeaderProps) {
  const active = sort.field === field
  const Icon = !active ? ArrowUpDown : sort.direction === 'asc' ? ArrowUp : ArrowDown
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn('px-3 py-3', align === 'right' && 'text-right', className)}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors',
          active ? 'text-brand-700 dark:text-brand-300' : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {label}
        <Icon className={cn('h-3.5 w-3.5', !active && 'opacity-50')} aria-hidden="true" />
      </button>
    </th>
  )
}

type ExportButtonProps = {
  kind: ExportKind
  label: string
  icon: typeof FileText
  busy: ExportKind | null
  disabled: boolean
  onClick: (kind: ExportKind) => void
}

function ExportButton({ kind, label, icon: Icon, busy, disabled, onClick }: ExportButtonProps) {
  const isBusy = busy === kind
  return (
    <button
      type="button"
      onClick={() => onClick(kind)}
      disabled={disabled || busy !== null}
      className={cn(
        'inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors',
        'hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800',
        'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-brand-800 dark:hover:bg-brand-900/30 dark:hover:text-white',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      {isBusy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
      {isBusy ? 'Gerando...' : label}
    </button>
  )
}

// =============================================================================
// Página
// =============================================================================

export default function LeadSearch() {
  const { openEditLead, leadsVersion } = useOutletContext<LayoutOutletContext>()
  const navigate = useNavigate()
  const { options } = useSettingsOptions({ includeInactive: true })
  // Empresas já cadastradas (recarrega quando um lead é salvo)
  const { companies } = useCompanies(leadsVersion)

  const [filters, setFilters] = useState<LeadSearchFilters>(EMPTY_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const [sort, setSort] = useState<LeadSort>(DEFAULT_SORT)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0])
  const [retryCount, setRetryCount] = useState(0)

  const [exporting, setExporting] = useState<ExportKind | null>(null)
  const [preview, setPreview] = useState<ExportPreviewData | null>(null)
  const [generating, setGenerating] = useState(false)
  const [exportFeedback, setExportFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // ---- Busca com atraso (não consulta a cada tecla) ----
  useEffect(() => {
    if (searchInput === filters.search) return
    const timeout = window.setTimeout(() => {
      setFilters((current) => ({ ...current, search: searchInput }))
      setPage(0)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [searchInput, filters.search])

  // ---- Esconde o aviso da exportação depois de alguns segundos ----
  useEffect(() => {
    if (!exportFeedback) return
    const timeout = window.setTimeout(() => setExportFeedback(null), 5000)
    return () => window.clearTimeout(timeout)
  }, [exportFeedback])

  const dateRangeInvalid = Boolean(filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo)

  // ---- Consulta paginada (carregamento derivado da chave da consulta) ----
  const queryKey = JSON.stringify({ filters, sort, page, pageSize, leadsVersion, retryCount })
  const [result, setResult] = useState<AsyncResult<LeadPage> | null>(null)

  useEffect(() => {
    if (dateRangeInvalid) return
    let isActive = true
    const controller = new AbortController()
    fetchLeadPage(filters, sort, page, pageSize, controller.signal)
      .then((data) => {
        if (isActive) setResult({ key: queryKey, data, error: null })
      })
      .catch(() => {
        if (isActive) {
          setResult({ key: queryKey, data: null, error: 'Não foi possível carregar as propostas. Verifique sua conexão e tente novamente.' })
        }
      })
    return () => {
      isActive = false
      controller.abort()
    }
  }, [queryKey, dateRangeInvalid, filters, sort, page, pageSize])

  const loading = !dateRangeInvalid && result?.key !== queryKey
  const rows = result?.data?.rows ?? []
  const total = result?.data?.total ?? 0
  const error = result?.key === queryKey ? result.error : null
  const firstLoad = result === null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const activeFilterCount = countActiveFilters(filters)

  // ---- Opções dos selects (inclui opções inativas, para achar leads antigos) ----
  const roomOptions = useMemo(() => options.room.map((option) => ({ label: option.label, active: option.active })), [options.room])
  const originOptions = useMemo(
    () => options.origin.map((option) => ({ label: option.label, active: option.active })),
    [options.origin],
  )
  const lossReasonOptions = useMemo(() => {
    const fromDb = options.loss_reason.map((option) => ({ label: option.label, active: option.active }))
    return fromDb.length > 0 ? fromDb : DEFAULT_LOSS_REASONS.map((label) => ({ label, active: true }))
  }, [options.loss_reason])

  // ---- Ações ----
  const updateFilter = <K extends keyof LeadSearchFilters>(key: K, value: LeadSearchFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(0)
  }

  const clearFilters = () => {
    setFilters(EMPTY_FILTERS)
    setSearchInput('')
    setPage(0)
  }

  const handleSort = (field: SortField) => {
    setSort((current) =>
      current.field === field
        ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { field, direction: field === 'contact_name' || field === 'status' ? 'asc' : 'desc' },
    )
    setPage(0)
  }

  // Carrega os dados e abre a pré-visualização; o arquivo só é gerado na confirmação
  const handleExport = async (kind: ExportKind) => {
    setExporting(kind)
    setExportFeedback(null)
    try {
      const [allLeads, exporters] = await Promise.all([fetchAllFilteredLeads(filters, sort), import('../lib/exporters')])

      if (allLeads.length === 0) {
        setExportFeedback({ type: 'error', message: 'Nenhuma proposta para exportar com os filtros atuais.' })
        return
      }

      const filterLabels = describeFilters(filters)
      if (kind === 'csv') {
        // O mailing só sai com a lista de opt-out por contato carregada (LGPD); sem ela, não exporta
        let suppressions: Awaited<ReturnType<typeof fetchMarketingSuppressions>>
        try {
          suppressions = await fetchMarketingSuppressions()
        } catch {
          setExportFeedback({
            type: 'error',
            message:
              'Não foi possível carregar a lista de opt-out (LGPD), então o mailing não foi gerado. Verifique se a migração 004 foi aplicada no Supabase.',
          })
          return
        }
        setPreview({ kind, leads: allLeads, filters: filterLabels, mailing: exporters.buildMailing(allLeads, suppressions) })
      } else {
        setPreview({ kind, leads: allLeads, filters: filterLabels })
      }
    } catch {
      setExportFeedback({ type: 'error', message: 'Não foi possível preparar a exportação. Tente novamente.' })
    } finally {
      setExporting(null)
    }
  }

  const cancelExport = useCallback(() => setPreview(null), [])

  const confirmExport = async () => {
    if (!preview) return
    setGenerating(true)
    try {
      const exporters = await import('../lib/exporters')
      if (preview.kind === 'xlsx') {
        exporters.exportLeadsToXlsx(preview.leads)
        setExportFeedback({ type: 'success', message: `Planilha gerada com ${preview.leads.length} proposta(s).` })
      } else if (preview.kind === 'csv') {
        const summary = exporters.exportMailingToCsv(preview.mailing)
        const merged = summary.mergedDuplicates
        const parts = [
          `Mailing gerado com ${summary.contacts} contato(s) único(s).`,
          merged > 0 ? `${merged} orçamento(s) repetido(s) do mesmo cliente foram agrupados.` : null,
          summary.optedOut > 0 ? `${summary.optedOut} contato(s) com opt-out LGPD foram ignorados.` : null,
          summary.skipped > 0 ? `${summary.skipped} proposta(s) sem e-mail nem telefone ficaram de fora.` : null,
        ]
        setExportFeedback({ type: 'success', message: parts.filter(Boolean).join(' ') })
      } else {
        exporters.exportLeadsToPdf(preview.leads, preview.filters)
        setExportFeedback({ type: 'success', message: `Relatório PDF gerado com ${preview.leads.length} proposta(s).` })
      }
      setPreview(null)
    } catch {
      setExportFeedback({ type: 'error', message: 'Não foi possível gerar a exportação. Tente novamente.' })
    } finally {
      setGenerating(false)
    }
  }

  const rangeStart = total === 0 ? 0 : page * pageSize + 1
  const rangeEnd = Math.min(total, (page + 1) * pageSize)

  return (
    <>
      <PageHeader
        title="Consultar Propostas"
        description="Cada solicitação de orçamento, sondagem ou proposta enviada. Pesquise, filtre e exporte."
        actions={
          <>
            <ExportButton kind="xlsx" label="Exportar Excel (.xlsx)" icon={FileSpreadsheet} busy={exporting} disabled={total === 0 || dateRangeInvalid} onClick={handleExport} />
            <ExportButton kind="csv" label="Exportar Mailing (.csv)" icon={Mail} busy={exporting} disabled={total === 0 || dateRangeInvalid} onClick={handleExport} />
            <ExportButton kind="pdf" label="Exportar Relatório (.pdf)" icon={FileText} busy={exporting} disabled={total === 0 || dateRangeInvalid} onClick={handleExport} />
          </>
        }
      />

      {exportFeedback && (
        <div
          role="status"
          className={cn(
            'mb-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm',
            exportFeedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300',
          )}
        >
          <span className="flex items-center gap-2">
            {exportFeedback.type === 'success' ? (
              <CircleCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            {exportFeedback.message}
          </span>
          <button type="button" onClick={() => setExportFeedback(null)} aria-label="Fechar aviso" className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ---------------- Filtros ---------------- */}
      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <label htmlFor="search-text" className="sr-only">
            Buscar por nome, empresa, CNPJ, e-mail, telefone ou nº da proposta
          </label>
          <input
            id="search-text"
            type="search"
            placeholder="Buscar por nome, empresa, CNPJ, e-mail, telefone ou nº da proposta..."
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            className={cn(controlClassName, 'py-2.5 pl-10')}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5">
          <FilterField label="Filtrar datas por" htmlFor="filter-date-field">
            <select
              id="filter-date-field"
              value={filters.dateField}
              onChange={(event) => updateFilter('dateField', event.target.value as DateField)}
              className={controlClassName}
            >
              {(Object.keys(DATE_FIELD_LABELS) as DateField[]).map((field) => (
                <option key={field} value={field}>
                  {DATE_FIELD_LABELS[field]}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="De / Até" htmlFor="filter-date-from" className="sm:col-span-2">
            <div className="flex items-center gap-2">
              <input
                id="filter-date-from"
                type="date"
                value={filters.dateFrom}
                max={filters.dateTo || undefined}
                onChange={(event) => updateFilter('dateFrom', event.target.value)}
                aria-label="Data inicial"
                className={cn(controlClassName, 'min-w-0 px-2')}
              />
              <input
                id="filter-date-to"
                type="date"
                value={filters.dateTo}
                min={filters.dateFrom || undefined}
                onChange={(event) => updateFilter('dateTo', event.target.value)}
                aria-label="Data final"
                className={cn(controlClassName, 'min-w-0 px-2')}
              />
            </div>
          </FilterField>

          <FilterField label="Situação" htmlFor="filter-status">
            <select
              id="filter-status"
              value={filters.status}
              onChange={(event) => updateFilter('status', event.target.value as LeadStatus | 'all')}
              className={controlClassName}
            >
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Proposta enviada?" htmlFor="filter-proposal">
            <select
              id="filter-proposal"
              value={filters.proposalSent}
              onChange={(event) => updateFilter('proposalSent', event.target.value as YesNoFilter)}
              className={controlClassName}
            >
              {YES_NO_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Sala/Salão" htmlFor="filter-room">
            <select
              id="filter-room"
              value={filters.room}
              onChange={(event) => updateFilter('room', event.target.value)}
              className={controlClassName}
            >
              <option value="">Todas</option>
              {roomOptions.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label}
                  {option.active ? '' : ' (inativa)'}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Meio de prospecção" htmlFor="filter-origin">
            <select
              id="filter-origin"
              value={filters.origin}
              onChange={(event) => updateFilter('origin', event.target.value)}
              className={controlClassName}
            >
              <option value="">Todos</option>
              {originOptions.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label}
                  {option.active ? '' : ' (inativo)'}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label="Empresa" htmlFor="filter-company">
            <select
              id="filter-company"
              value={filters.company}
              onChange={(event) => updateFilter('company', event.target.value)}
              className={controlClassName}
            >
              <option value="">Todas</option>
              <option value={COMPANY_FILTER_WITH}>Somente empresas</option>
              <option value={COMPANY_FILTER_WITHOUT}>Pessoa física (sem empresa)</option>
              {companies.length > 0 && (
                <optgroup label="Empresas">
                  {companies.map((company) => (
                    <option key={company} value={company}>
                      {company}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </FilterField>

          <FilterField label="Motivo de recusa" htmlFor="filter-loss-reason">
            <select
              id="filter-loss-reason"
              value={filters.lossReason}
              onChange={(event) => updateFilter('lossReason', event.target.value)}
              className={controlClassName}
            >
              <option value="">Todos</option>
              {lossReasonOptions.map((option) => (
                <option key={option.label} value={option.label}>
                  {option.label}
                  {option.active ? '' : ' (inativo)'}
                </option>
              ))}
            </select>
          </FilterField>
        </div>

        {dateRangeInvalid && (
          <p className="mt-3 text-sm font-medium text-red-600 dark:text-red-400">A data inicial precisa ser anterior ou igual à final.</p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="text-sm text-slate-600 dark:text-slate-300" aria-live="polite">
            {firstLoad && loading ? (
              'Carregando...'
            ) : (
              <>
                <strong className="font-semibold text-slate-900 dark:text-white">{total.toLocaleString('pt-BR')}</strong>{' '}
                {total === 1 ? 'proposta encontrada' : 'propostas encontradas'}
                {loading && <LoaderCircle className="ml-2 inline h-4 w-4 animate-spin text-slate-400" aria-label="Atualizando" />}
              </>
            )}
          </p>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <FilterX className="h-4 w-4" aria-hidden="true" />
              Limpar filtros ({activeFilterCount})
            </button>
          )}
        </div>
      </section>

      {/* ---------------- Resultados ---------------- */}
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <CircleAlert className="h-8 w-8 text-red-500" aria-hidden="true" />
            <p className="text-sm text-slate-600 dark:text-slate-300">{error}</p>
            <button
              type="button"
              onClick={() => setRetryCount((current) => current + 1)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Tentar de novo
            </button>
          </div>
        ) : firstLoad ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 6 }, (_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <SearchX className="h-8 w-8 text-slate-400" aria-hidden="true" />
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {page > 0
                ? 'Esta página ficou vazia (os resultados mudaram).'
                : activeFilterCount > 0
                  ? 'Nenhuma proposta encontrada com esses filtros.'
                  : 'Nenhuma proposta cadastrada ainda.'}
            </p>
            {page > 0 ? (
              <button type="button" onClick={() => setPage(0)} className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Ir para a primeira página
              </button>
            ) : activeFilterCount > 0 && (
              <button type="button" onClick={clearFilters} className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Limpar filtros
              </button>
            )}
          </div>
        ) : (
          <div className={cn('overflow-x-auto transition-opacity', loading && 'opacity-60')}>
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="whitespace-nowrap border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50">
                <tr>
                  <SortableHeader field="created_at" label="Criado em" sort={sort} onSort={handleSort} className="pl-5" />
                  <SortableHeader field="contact_name" label="Contato" sort={sort} onSort={handleSort} />
                  <th scope="col" className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Salas / Origem
                  </th>
                  <SortableHeader field="event_date" label="Evento" sort={sort} onSort={handleSort} />
                  <SortableHeader field="total_value" label="Receita total" sort={sort} onSort={handleSort} align="right" />
                  <th scope="col" className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Proposta
                  </th>
                  <SortableHeader field="status" label="Situação" sort={sort} onSort={handleSort} />
                  <th scope="col" className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((lead: Lead) => (
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
                    <td className="px-3 py-3">
<Link
                        to={`/propostas/${lead.id}`}
                        className="font-medium text-slate-900 hover:text-brand-700 hover:underline dark:text-white dark:hover:text-brand-300"
                      >
                        {lead.contact_name}
                      </Link>
                      {lead.company && (
                        <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                          <span className={cn('truncate', lead.company === filters.company && 'text-brand-700 dark:text-brand-300')}>
                            {lead.company}
                          </span>
                        </p>
                      )}
                      {lead.cnpj && <p className="mt-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">CNPJ {lead.cnpj}</p>}
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <span>{[lead.contact_phone, lead.contact_email].filter(Boolean).join(' · ') || 'Sem contato'}</span>
                        <WhatsAppButton lead={lead} />
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <RoomTags rooms={getLeadRooms(lead)} highlight={filters.room} />
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{lead.origin || '—'}</p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-700 dark:text-slate-200">
                      {lead.event_date ? (
                        <>
                          {formatDateBR(lead.event_date)}
                          {lead.event_end_date && (
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              até {formatDateBR(lead.event_end_date)} · {countEventDays(lead)} dias
                            </p>
                          )}
                        </>
                      ) : (
                        <span className="block max-w-[11rem] truncate text-slate-500 dark:text-slate-400" title={lead.date_notes ?? undefined}>
                          {lead.date_notes || 'Sem data'}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      <ValueCell lead={lead} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3">
                      {lead.proposal_sent || lead.status === 'fechado' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
                          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                          {lead.proposal_number ? `Nº ${lead.proposal_number}` : 'Enviada'}
                        </span>
                      ) : (
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                          Sondagem
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <StatusBadge status={lead.status} />
                      {lead.status === 'perdido' && lead.loss_reason && (
                        <p className="mt-1 max-w-[14rem] text-xs text-slate-500 dark:text-slate-400" title={lead.loss_reason_details ?? undefined}>
                          {lead.loss_reason}
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => openEditLead(lead)}
                        aria-label={`Editar ${lead.contact_name}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 dark:border-slate-700 dark:text-slate-200 dark:hover:border-brand-800 dark:hover:bg-brand-900/30 dark:hover:text-white"
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Editar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ---------------- Paginação ---------------- */}
        {!error && !firstLoad && rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm dark:border-slate-800">
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <label htmlFor="page-size">Por página</label>
              <select
                id="page-size"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(Number(event.target.value))
                  setPage(0)
                }}
                className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <span className="ml-2 tabular-nums">
                {rangeStart}–{rangeEnd} de {total.toLocaleString('pt-BR')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                disabled={page === 0 || loading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Anterior
              </button>
              <span className="px-3 tabular-nums text-slate-600 dark:text-slate-300">
                {page + 1} / {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))}
                disabled={page >= totalPages - 1 || loading}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Próxima
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </section>

      <ExportPreviewModal preview={preview} busy={generating} onCancel={cancelExport} onConfirm={() => void confirmExport()} />
    </>
  )
}
