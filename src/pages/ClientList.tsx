import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  FilterX,
  LayoutDashboard,
  LoaderCircle,
  RefreshCw,
  Search,
  SearchX,
} from 'lucide-react'
import ClientTypeBadge from '../components/ClientTypeBadge'
import PageHeader from '../components/PageHeader'
import WhatsAppButton from '../components/WhatsAppButton'
import type { LayoutOutletContext } from '../components/Layout'
import { cn, isRowClick } from '../lib/utils'
import { describeBranch } from '../lib/clientIdentity'
import { formatBRL, formatDateBR } from '../lib/format'
import { toLocalISODate } from '../lib/dashboard'
import {
  CLIENT_HISTORY_LABELS,
  CLIENT_SORT_LABELS,
  DEFAULT_CLIENT_SORT,
  EMPTY_CLIENT_FILTERS,
  countActiveClientFilters,
  defaultDirection,
  fetchClientPage,
  type ClientHistoryFilter,
  type ClientPage,
  type ClientSearchFilters,
  type ClientSort,
  type ClientSortField,
} from '../lib/clientQuery'
import type { ClientSummary, ClientType } from '../types/lead'

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const
const SEARCH_DEBOUNCE_MS = 350

const TYPE_OPTIONS: Array<{ value: ClientType | 'all'; label: string }> = [
  { value: 'all', label: 'Todos' },
  { value: 'company', label: 'Empresas' },
  { value: 'individual', label: 'Pessoa Física' },
]

const controlClassName = cn(
  'block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors',
  'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20',
  'dark:border-slate-700 dark:bg-slate-950 dark:text-white',
)

type AsyncResult<T> = { key: string; data: T | null; error: string | null }

function FilterField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </label>
      {children}
    </div>
  )
}

type SortableHeaderProps = {
  field: ClientSortField
  label: string
  sort: ClientSort
  onSort: (field: ClientSortField) => void
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

function ContactCell({ client }: { client: ClientSummary }) {
  if (!client.primary_contact_name) return <span className="text-slate-400 dark:text-slate-500">Sem contato</span>
  const others = client.contacts_count - 1
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-slate-800 dark:text-slate-100">{client.primary_contact_name}</span>
        {others > 0 && (
          <span
            title={`${client.contacts_count} pessoas de contato cadastradas`}
            className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            +{others} {others === 1 ? 'contato' : 'contatos'}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <span className="truncate">{[client.primary_contact_phone, client.primary_contact_email].filter(Boolean).join(' · ') || 'Sem telefone ou e-mail'}</span>
        <WhatsAppButton
          greeting
          lead={{
            contact_name: client.primary_contact_name,
            contact_phone: client.primary_contact_phone,
            room_interests: [],
            room_interest: null,
            marketing_opt_out: client.primary_contact_opt_out,
          }}
        />
      </div>
    </div>
  )
}

export default function ClientList() {
  const { leadsVersion } = useOutletContext<LayoutOutletContext>()
  const navigate = useNavigate()

  const [filters, setFilters] = useState<ClientSearchFilters>(EMPTY_CLIENT_FILTERS)
  const [searchInput, setSearchInput] = useState('')
  const [sort, setSort] = useState<ClientSort>(DEFAULT_CLIENT_SORT)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0])
  const [retryCount, setRetryCount] = useState(0)

  // ---- Busca com atraso (não consulta a cada tecla) ----
  useEffect(() => {
    if (searchInput === filters.search) return
    const timeout = window.setTimeout(() => {
      setFilters((current) => ({ ...current, search: searchInput }))
      setPage(0)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [searchInput, filters.search])

  const queryKey = JSON.stringify({ filters, sort, page, pageSize, leadsVersion, retryCount })
  const [result, setResult] = useState<AsyncResult<ClientPage> | null>(null)

  useEffect(() => {
    let isActive = true
    const controller = new AbortController()
    fetchClientPage(filters, sort, page, pageSize, controller.signal)
      .then((data) => {
        if (isActive) setResult({ key: queryKey, data, error: null })
      })
      .catch(() => {
        if (isActive) {
          setResult({
            key: queryKey,
            data: null,
            error: 'Não foi possível carregar os leads. Verifique sua conexão e se as migrações 009 e 010 foram aplicadas no Supabase.',
          })
        }
      })
    return () => {
      isActive = false
      controller.abort()
    }
  }, [queryKey, filters, sort, page, pageSize])

  const loading = result?.key !== queryKey
  const rows = result?.data?.rows ?? []
  const total = result?.data?.total ?? 0
  const error = result?.key === queryKey ? result.error : null
  const firstLoad = result === null
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const activeFilterCount = countActiveClientFilters(filters)
  const rangeStart = total === 0 ? 0 : page * pageSize + 1
  const rangeEnd = Math.min(total, (page + 1) * pageSize)

  const updateFilter = <K extends keyof ClientSearchFilters>(key: K, value: ClientSearchFilters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }))
    setPage(0)
  }

  const clearFilters = () => {
    setFilters(EMPTY_CLIENT_FILTERS)
    setSearchInput('')
    setPage(0)
  }

  const handleSort = (field: ClientSortField) => {
    setSort((current) =>
      current.field === field ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { field, direction: defaultDirection(field) },
    )
    setPage(0)
  }

  return (
    <>
      <PageHeader
        title="Consultar Leads"
        description="Uma linha por cliente (empresa ou pessoa física), com todo o histórico de propostas e a receita que já gerou."
      />

      {/* ---------------- Filtros ---------------- */}
      <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <label htmlFor="client-search" className="sr-only">
            Buscar por empresa, CNPJ, pessoa de contato, telefone ou e-mail
          </label>
          <input
            id="client-search"
            type="search"
            placeholder="Buscar por empresa, CNPJ, pessoa de contato, telefone ou e-mail..."
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            className={cn(controlClassName, 'py-2.5 pl-10')}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FilterField label="Tipo" htmlFor="client-type">
            <select
              id="client-type"
              value={filters.type}
              onChange={(event) => updateFilter('type', event.target.value as ClientType | 'all')}
              className={controlClassName}
            >
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Histórico" htmlFor="client-history">
            <select
              id="client-history"
              value={filters.history}
              onChange={(event) => updateFilter('history', event.target.value as ClientHistoryFilter)}
              className={controlClassName}
            >
              {(Object.keys(CLIENT_HISTORY_LABELS) as ClientHistoryFilter[]).map((value) => (
                <option key={value} value={value}>
                  {CLIENT_HISTORY_LABELS[value]}
                </option>
              ))}
            </select>
          </FilterField>
          <FilterField label="Ordenar por" htmlFor="client-sort">
            <select
              id="client-sort"
              value={sort.field}
              onChange={(event) => {
                const field = event.target.value as ClientSortField
                setSort({ field, direction: defaultDirection(field) })
                setPage(0)
              }}
              className={controlClassName}
            >
              {(Object.keys(CLIENT_SORT_LABELS) as ClientSortField[]).map((field) => (
                <option key={field} value={field}>
                  {CLIENT_SORT_LABELS[field]}
                </option>
              ))}
            </select>
          </FilterField>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
          <p className="text-sm text-slate-600 dark:text-slate-300" aria-live="polite">
            {firstLoad && loading ? (
              'Carregando...'
            ) : (
              <>
                <strong className="font-semibold text-slate-900 dark:text-white">{total.toLocaleString('pt-BR')}</strong>{' '}
                {total === 1 ? 'lead encontrado' : 'leads encontrados'}
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
            <p className="max-w-md text-sm text-slate-600 dark:text-slate-300">{error}</p>
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
                  ? 'Nenhum lead encontrado com esses filtros.'
                  : 'Nenhum lead cadastrado ainda. Eles aparecem aqui a partir da primeira proposta.'}
            </p>
            {page > 0 ? (
              <button type="button" onClick={() => setPage(0)} className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Ir para a primeira página
              </button>
            ) : (
              activeFilterCount > 0 && (
                <button type="button" onClick={clearFilters} className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
                  Limpar filtros
                </button>
              )
            )}
          </div>
        ) : (
          <div className={cn('overflow-x-auto transition-opacity', loading && 'opacity-60')}>
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="whitespace-nowrap border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50">
                <tr>
                  <SortableHeader field="name" label="Lead (Empresa / Cliente)" sort={sort} onSort={handleSort} className="pl-5" />
                  <th scope="col" className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Pessoas de contato
                  </th>
                  <SortableHeader field="proposals_count" label="Propostas" sort={sort} onSort={handleSort} />
                  <SortableHeader field="closed_revenue" label="Receita gerada" sort={sort} onSort={handleSort} align="right" />
                  <SortableHeader field="last_proposal_at" label="Último contato" sort={sort} onSort={handleSort} />
                  <th scope="col" className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Ações
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((client) => (
                  <tr
                    key={client.id}
                    onClick={(event) => {
                      if (isRowClick(event.target)) navigate(`/leads/${client.id}`)
                    }}
                    className="cursor-pointer align-top transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
                  >
                    <td className="py-3 pl-5 pr-3">
                      <Link
                        to={`/leads/${client.id}`}
                        className="font-semibold text-slate-900 hover:text-brand-700 hover:underline dark:text-white dark:hover:text-brand-300"
                      >
                        {client.name}
                      </Link>
                      {describeBranch(client) && (
                        <p className="mt-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">{describeBranch(client)}</p>
                      )}
                      <div className="mt-1">
                        <ClientTypeBadge type={client.client_type} />
                      </div>
                    </td>
                    <td className="max-w-[20rem] px-3 py-3">
                      <ContactCell client={client} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-700 dark:text-slate-200">
                      <p className="font-medium">
                        {client.proposals_count} {client.proposals_count === 1 ? 'proposta' : 'propostas'}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {client.closed_count} {client.closed_count === 1 ? 'fechada' : 'fechadas'}
                        {client.open_count > 0 && ` · ${client.open_count} em aberto`}
                      </p>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                      <p className={cn('font-semibold', Number(client.closed_revenue) > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-500')}>
                        {formatBRL(Number(client.closed_revenue))}
                      </p>
                      {Number(client.open_revenue) > 0 && (
                        <p className="text-xs text-slate-500 dark:text-slate-400">{formatBRL(Number(client.open_revenue))} em aberto</p>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300">
                      {client.last_proposal_at ? formatDateBR(toLocalISODate(new Date(client.last_proposal_at))) : '—'}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Link
                        to={`/leads/${client.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800 dark:border-slate-700 dark:text-slate-200 dark:hover:border-brand-800 dark:hover:bg-brand-900/30 dark:hover:text-white"
                      >
                        <LayoutDashboard className="h-3.5 w-3.5" aria-hidden="true" />
                        Abrir
                      </Link>
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
              <label htmlFor="client-page-size">Por página</label>
              <select
                id="client-page-size"
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
    </>
  )
}
