import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import {
  BarChart3,
  CircleAlert,
  FileSpreadsheet,
  FileText,
  Hotel,
  Layers,
  LoaderCircle,
  Receipt,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import HorizontalScrollArea from '../components/HorizontalScrollArea'
import PageHeader from '../components/PageHeader'
import ValueDetails from '../components/ValueDetails'
import type { LayoutOutletContext } from '../components/Layout'
import { useTheme } from '../contexts/ThemeContext'
import { CHART_THEMES, type ChartTheme } from '../lib/chartTheme'
import { formatBRL } from '../lib/format'
import { formatLeadRooms, getLeadValues, NET_RATES, sumLeadValues } from '../lib/leadFields'
import { RateLimitError, guardMutation } from '../lib/rateLimit'
import {
  MONTH_LONG_LABELS,
  MONTH_SHORT_LABELS,
  REVENUE_COLUMNS,
  REVENUE_METRIC_LABELS,
  eventYearMonth,
  fetchRevenueLeads,
  formatEventDays,
  inPeriod,
  isConfirmed,
  netShare,
  revenueSituation,
  summarizeRevenue,
  type RevenueLead,
  type RevenueMetric,
} from '../lib/revenue'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import { grossDetailRows, netDetailRows } from '../lib/valueDetails'
import {
  OPERATIONAL_STATUSES,
  OPERATIONAL_STATUS_LABELS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS_LABELS,
  SURVEY_STATUSES,
  SURVEY_STATUS_LABELS,
  type Lead,
  type LeadUpdate,
  type OperationalStatus,
  type PaymentStatus,
  type SurveyStatus,
} from '../types/lead'

const cardClassName = 'rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900'
const compactCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })
const integer = new Intl.NumberFormat('pt-BR')

type AsyncResult<T> = { key: string; data: T | null; error: string | null }
type SituationFilter = 'all' | OperationalStatus
type MetricKey = 'rental' | 'net' | 'total'

const METRIC_OPTIONS: Array<{ value: RevenueMetric; icon: LucideIcon }> = [
  { value: 'rental', icon: Target },
  { value: 'net', icon: Hotel },
  { value: 'gross', icon: BarChart3 },
  { value: 'compare', icon: Layers },
]

const METRIC_FIELD: Record<Exclude<RevenueMetric, 'compare'>, MetricKey> = { rental: 'rental', net: 'net', gross: 'total' }

const COMPARE_SERIES: Array<{ key: MetricKey; label: string; slot: number }> = [
  { key: 'rental', label: 'Locação de salas', slot: 0 },
  { key: 'net', label: 'Receita líquida', slot: 2 },
  { key: 'total', label: 'Receita bruta', slot: 1 },
]

const SITUATION_STYLES: Record<OperationalStatus, string> = {
  a_confirmar: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  confirmado: 'border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200',
  realizado: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200',
}

const PAYMENT_STYLES: Record<PaymentStatus, string> = {
  pendente: 'text-amber-700 dark:text-amber-300',
  parcial: 'text-sky-700 dark:text-sky-300',
  pago: 'text-emerald-700 dark:text-emerald-300',
}

const inlineSelect =
  'w-full min-w-[7.5rem] rounded-md border px-2 py-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-brand-600/30 disabled:opacity-60'

// =============================================================================
// Componentes de apoio
// =============================================================================

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: Array<{ value: T; label: ReactNode }>
  value: T
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
              selected
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

function Kpi({
  icon: Icon,
  title,
  value,
  children,
  highlight = false,
}: {
  icon: LucideIcon
  title: string
  value: string
  children?: ReactNode
  highlight?: boolean
}) {
  return (
    <div
      className={cn(
        'h-full rounded-xl p-5 shadow-sm',
        highlight
          ? 'bg-gradient-to-br from-brand-900 to-brand-600 text-white'
          : 'border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
      )}
    >
      <p className={cn('flex items-center gap-2 text-sm font-medium', highlight ? 'text-brand-100' : 'text-slate-500 dark:text-slate-400')}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        {title}
      </p>
      <p className={cn('mt-2 text-2xl font-bold tabular-nums', highlight ? 'text-white' : 'text-slate-900 dark:text-white')}>{value}</p>
      {children && <div className={cn('mt-2 space-y-0.5 text-xs', highlight ? 'text-brand-100' : 'text-slate-500 dark:text-slate-400')}>{children}</div>}
    </div>
  )
}

type MonthPoint = {
  month: number
  label: string
  rental: number
  net: number
  total: number
  pendingRental: number
  pendingNet: number
  pendingTotal: number
}

function RevenueChart({
  data,
  metric,
  selectedMonth,
  onSelectMonth,
  theme,
}: {
  data: MonthPoint[]
  metric: RevenueMetric
  selectedMonth: number | null
  onSelectMonth: (month: number) => void
  theme: ChartTheme
}) {
  const axis = { tick: { fill: theme.axis, fontSize: 12 }, tickLine: false, axisLine: false } as const
  const pendingKey = metric === 'rental' ? 'pendingRental' : metric === 'net' ? 'pendingNet' : 'pendingTotal'
  const series =
    metric === 'compare'
      ? COMPARE_SERIES.map((item) => ({ key: item.key as keyof MonthPoint, label: item.label, color: theme.series[item.slot], stack: undefined }))
      : [
          { key: METRIC_FIELD[metric] as keyof MonthPoint, label: 'Confirmado / Realizado', color: theme.series[0], stack: 'mes' },
          { key: pendingKey as keyof MonthPoint, label: 'À confirmar', color: theme.series[3], stack: 'mes' },
        ]

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
        {series.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} aria-hidden="true" />
            {item.label}
          </li>
        ))}
      </ul>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="label" {...axis} />
            <YAxis {...axis} width={76} tickFormatter={(value: number) => compactCurrency.format(value)} />
            <Tooltip
              cursor={{ fill: theme.cursor }}
              content={({ active, payload }) =>
                active && payload && payload.length > 0 ? (
                  <div className="min-w-48 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
                    <p className="mb-1.5 font-semibold text-slate-900 dark:text-white">{MONTH_LONG_LABELS[(payload[0].payload as MonthPoint).month - 1]}</p>
                    <ul className="space-y-1">
                      {payload.map((entry) => (
                        <li key={String(entry.dataKey)} className="flex items-center justify-between gap-4">
                          <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: entry.color }} aria-hidden="true" />
                            {entry.name}
                          </span>
                          <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{formatBRL(Number(entry.value ?? 0))}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null
              }
            />
            {series.map((item, index) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.label}
                stackId={item.stack}
                fill={item.color}
                stroke={item.stack ? theme.surface : undefined}
                strokeWidth={item.stack ? 2 : 0}
                radius={!item.stack || index === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                maxBarSize={metric === 'compare' ? 18 : 40}
                cursor="pointer"
                onClick={(entry) => onSelectMonth((entry as unknown as MonthPoint).month)}
              >
                {data.map((point) => (
                  <Cell key={point.month} fillOpacity={selectedMonth === null || point.month === selectedMonth ? 1 : 0.4} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/** Valor 100% com a parte que fica no hotel logo abaixo. */
function MoneyCell({ value, rate }: { value: number; rate?: number }) {
  if (value === 0) return <span className="text-slate-300 dark:text-slate-600">—</span>
  return (
    <span className="block text-right tabular-nums">
      {formatBRL(value)}
      {rate !== undefined && rate < 1 && (
        <span className="block text-[11px] text-slate-400 dark:text-slate-500">
          {Math.round(rate * 100)}%: {formatBRL(netShare(value, rate))}
        </span>
      )}
    </span>
  )
}

/** Popover rápido com as 3 notas fiscais. */
function NfEditor({
  lead,
  disabled,
  onSave,
}: {
  lead: RevenueLead
  disabled: boolean
  onSave: (patch: Pick<Lead, 'nf_rental' | 'nf_ab' | 'nf_parking'>) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState({ nf_rental: '', nf_ab: '', nf_parking: '' })
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const filled = [lead.nf_rental, lead.nf_ab, lead.nf_parking].filter(Boolean).length
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setDraft({ nf_rental: lead.nf_rental ?? '', nf_ab: lead.nf_ab ?? '', nf_parking: lead.nf_parking ?? '' })
          setOpen((current) => !current)
        }}
        title={[`Loc: ${lead.nf_rental ?? '—'}`, `A&B: ${lead.nf_ab ?? '—'}`, `Estac: ${lead.nf_parking ?? '—'}`].join(' · ')}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold',
          filled === 3
            ? 'border-emerald-300 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300'
            : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800',
        )}
      >
        <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
        {filled}/3
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {(
            [
              ['nf_rental', 'NF Locação'],
              ['nf_ab', 'NF A&B'],
              ['nf_parking', 'NF Estacionamento'],
            ] as const
          ).map(([field, label]) => (
            <label key={field} className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
              {label}
              <input
                type="text"
                maxLength={50}
                value={draft[field]}
                onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
                className="mt-1 block w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </label>
          ))}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                onSave({
                  nf_rental: draft.nf_rental.trim() || null,
                  nf_ab: draft.nf_ab.trim() || null,
                  nf_parking: draft.nf_parking.trim() || null,
                })
                setOpen(false)
              }}
              className="rounded-md bg-brand-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
            >
              Salvar NFs
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** PAX editável na linha: salva ao sair do campo ou com Enter. */
function PaxInput({ value, disabled, onSave }: { value: number | null; disabled: boolean; onSave: (pax: number | null) => void }) {
  const external = value === null ? '' : String(value)
  const [draft, setDraft] = useState(external)
  const [synced, setSynced] = useState(external)
  if (external !== synced) {
    setSynced(external)
    setDraft(external)
  }
  const commit = () => {
    if (draft === external) return
    onSave(draft ? Number.parseInt(draft, 10) : null)
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label="PAX"
      disabled={disabled}
      value={draft}
      placeholder="—"
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 6))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setDraft(external)
      }}
      className="w-16 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right text-sm tabular-nums hover:border-slate-200 focus:border-brand-600 focus:bg-white focus:outline-none dark:hover:border-slate-700 dark:focus:bg-slate-950"
    />
  )
}

// =============================================================================
// Página
// =============================================================================

export default function RevenueMap() {
  const { leadsVersion } = useOutletContext<LayoutOutletContext>()
  const { isDark } = useTheme()
  const theme = CHART_THEMES[isDark ? 'dark' : 'light']
  const [currentYear] = useState(() => new Date().getFullYear())

  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState<number | null>(() => new Date().getMonth() + 1)
  const [metric, setMetric] = useState<RevenueMetric>('rental')
  const [situation, setSituation] = useState<SituationFilter>('all')
  const [retryCount, setRetryCount] = useState(0)
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null)

  const key = `${year}|${leadsVersion}|${retryCount}`
  const [result, setResult] = useState<AsyncResult<RevenueLead[]> | null>(null)

  useEffect(() => {
    let isActive = true
    const controller = new AbortController()
    fetchRevenueLeads(year, controller.signal)
      .then((data) => {
        if (isActive) setResult({ key, data, error: null })
      })
      .catch(() => {
        if (isActive) {
          setResult({ key, data: null, error: 'Não foi possível carregar os eventos. Verifique a conexão e se a migração 012 foi aplicada no Supabase.' })
        }
      })
    return () => {
      isActive = false
      controller.abort()
    }
  }, [key, year])

  const loading = result?.key !== key
  const leads = useMemo(() => (result?.data ?? []).filter((lead) => eventYearMonth(lead)), [result])
  const error = result?.key === key ? result.error : null
  const firstLoad = result === null

  const yearLeads = useMemo(() => leads.filter((lead) => inPeriod(lead, year, null)), [leads, year])
  const periodLeads = useMemo(() => leads.filter((lead) => inPeriod(lead, year, month)), [leads, year, month])
  const summary = useMemo(() => summarizeRevenue(periodLeads), [periodLeads])
  const rentalBySituation = useMemo(() => {
    const totals: Record<OperationalStatus, number> = { realizado: 0, confirmado: 0, a_confirmar: 0 }
    for (const lead of periodLeads) totals[revenueSituation(lead)] += getLeadValues(lead).rental
    return totals
  }, [periodLeads])

  // Mês anterior (janeiro compara com dezembro do ano anterior)
  const previousRental = useMemo(() => {
    if (month === null) return null
    const prevYear = month === 1 ? year - 1 : year
    const prevMonth = month === 1 ? 12 : month - 1
    return summarizeRevenue(leads.filter((lead) => inPeriod(lead, prevYear, prevMonth))).confirmed.rental
  }, [leads, year, month])
  const variation =
    previousRental === null || previousRental === 0 ? null : (summary.confirmed.rental - previousRental) / previousRental

  const chartData = useMemo<MonthPoint[]>(
    () =>
      MONTH_SHORT_LABELS.map((label, index) => {
        const monthSummary = summarizeRevenue(yearLeads.filter((lead) => eventYearMonth(lead)?.month === index + 1))
        return {
          month: index + 1,
          label,
          rental: monthSummary.confirmed.rental,
          net: monthSummary.confirmed.net,
          total: monthSummary.confirmed.total,
          pendingRental: monthSummary.pending.rental,
          pendingNet: monthSummary.pending.net,
          pendingTotal: monthSummary.pending.total,
        }
      }),
    [yearLeads],
  )

  const tableRows = useMemo(
    () => periodLeads.filter((lead) => situation === 'all' || revenueSituation(lead) === situation),
    [periodLeads, situation],
  )
  const gross = useMemo(() => sumLeadValues(tableRows), [tableRows])
  const metaConfirmed = tableRows.filter(isConfirmed).reduce((sum, lead) => sum + Number(lead.proposed_value ?? 0), 0)
  const metaPending = gross.rental - metaConfirmed

  const periodLabel = month === null ? `Ano de ${year}` : `${MONTH_LONG_LABELS[month - 1]} de ${year}`
  const years = useMemo(() => Array.from({ length: 6 }, (_, index) => currentYear + 1 - index), [currentYear])

  // ---- Edição rápida na linha ----
  const patchLead = async (lead: RevenueLead, patch: LeadUpdate) => {
    setActionError(null)
    setSavingIds((current) => new Set(current).add(lead.id))
    const applyRow = (row: RevenueLead) =>
      setResult((current) =>
        current?.data ? { ...current, data: current.data.map((item) => (item.id === row.id ? row : item)) } : current,
      )
    applyRow({ ...lead, ...patch })
    try {
      const { data, error: dbError } = await guardMutation(`revenue:${lead.id}:${JSON.stringify(patch)}`, async () =>
        supabase.from('leads').update(patch).eq('id', lead.id).select(REVENUE_COLUMNS).single(),
      )
      if (dbError || !data) throw dbError ?? new Error('sem retorno')
      // O banco pode ter mudado a situação do funil junto (trigger)
      applyRow(data as unknown as RevenueLead)
    } catch (patchError) {
      applyRow(lead)
      setActionError(
        patchError instanceof RateLimitError
          ? patchError.message
          : `Não foi possível salvar a alteração de "${lead.event_name || lead.contact_name}". Tente novamente.`,
      )
    } finally {
      setSavingIds((current) => {
        const next = new Set(current)
        next.delete(lead.id)
        return next
      })
    }
  }

  const handleExport = async (kind: 'xlsx' | 'pdf') => {
    setExporting(kind)
    try {
      const exporters = await import('../lib/exporters')
      if (kind === 'xlsx') exporters.exportRevenueToXlsx(tableRows, periodLabel)
      else exporters.exportRevenueToPdf(tableRows, periodLabel)
    } catch {
      setActionError('Não foi possível gerar a exportação. Tente novamente.')
    } finally {
      setExporting(null)
    }
  }

  const headCell = 'px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'
  const footLabel = 'py-2.5 pl-5 pr-3 text-xs font-bold uppercase tracking-wide'

  return (
    <>
      <PageHeader
        title="Faturamento & Eventos"
        description="Planilha mensal dos eventos pela data de realização, com a locação de salas, a receita líquida total e a receita bruta total."
        actions={
          <>
            <label htmlFor="revenue-year" className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Ano
            </label>
            <select
              id="revenue-year"
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              {years.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </>
        }
      />

      {error && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <span className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button type="button" onClick={() => setRetryCount((current) => current + 1)} className="inline-flex items-center gap-1 font-semibold hover:underline">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Tentar de novo
          </button>
        </div>
      )}

      {/* ---------------- Bloco 1: comparativo mês a mês ---------------- */}
      <section className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented
            label="Métrica do gráfico"
            value={metric}
            onChange={setMetric}
            options={METRIC_OPTIONS.map(({ value, icon: Icon }) => ({
              value,
              label: (
                <>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {REVENUE_METRIC_LABELS[value]}
                </>
              ),
            }))}
          />
          <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            {loading && !firstLoad && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" aria-label="Atualizando" />}
            Indicadores de <strong className="font-semibold text-slate-900 dark:text-white">{periodLabel}</strong>
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ValueDetails
            title="Locação de salas por situação"
            rows={[
              { label: 'Eventos realizados', value: rentalBySituation.realizado },
              { label: 'Eventos confirmados', value: rentalBySituation.confirmado },
            ]}
            total={{ label: 'Confirmado + Realizado', value: summary.confirmed.rental }}
            extraRows={[{ label: 'Eventos à confirmar', value: rentalBySituation.a_confirmar }]}
            footnote="À confirmar não entra no total."
            dark
            className="rounded-xl"
          >
            <Kpi icon={Target} title="Locação de salas" value={formatBRL(summary.confirmed.rental)} highlight>
              <p>Confirmado + Realizado</p>
              <p>
                À confirmar: <strong className="font-semibold text-white">{formatBRL(summary.pending.rental)}</strong>
              </p>
              {month !== null && (
                <p className="flex items-center gap-1">
                  {variation === null ? (
                    'Sem base no mês anterior'
                  ) : (
                    <>
                      {variation >= 0 ? <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden="true" />}
                      <strong className="font-semibold text-white">
                        {variation >= 0 ? '+' : ''}
                        {(variation * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                      </strong>{' '}
                      vs. {MONTH_LONG_LABELS[(month + 10) % 12].toLowerCase()}
                    </>
                  )}
                </p>
              )}
            </Kpi>
          </ValueDetails>
          <ValueDetails
            title="Composição da receita líquida"
            rows={netDetailRows(summary.confirmed)}
            total={{ label: 'Receita líquida total', value: summary.confirmed.net }}
            footnote="Eventos confirmados e realizados."
            className="rounded-xl"
          >
            <Kpi icon={Hotel} title="Receita líquida total" value={formatBRL(summary.confirmed.net)}>
              <p>
                <strong className="font-semibold text-slate-700 dark:text-slate-200">{formatBRL(summary.confirmed.net - summary.confirmed.rental)}</strong> além da locação
              </p>
              <p>100% Loc./Hosp. · 50% Estac. · 15% Equip. · 6% A&amp;B</p>
            </Kpi>
          </ValueDetails>
          <ValueDetails
            title="Composição da receita bruta"
            rows={grossDetailRows(summary.confirmed)}
            total={{ label: 'Receita bruta total', value: summary.confirmed.total }}
            extraRows={[{ label: 'À confirmar', value: summary.pending.total }]}
            footnote="Eventos confirmados e realizados."
            className="rounded-xl"
          >
            <Kpi icon={BarChart3} title="Receita bruta total" value={formatBRL(summary.confirmed.total)}>
              <p>Soma integral de todos os serviços</p>
              <p>À confirmar: {formatBRL(summary.pending.total)}</p>
            </Kpi>
          </ValueDetails>
          <Kpi icon={Users} title="Eventos & Público (PAX)" value={`${integer.format(summary.realizedCount + summary.confirmedCount)} eventos`}>
            <p>
              {integer.format(summary.realizedCount)} realizados · {integer.format(summary.confirmedCount)} confirmados ·{' '}
              {integer.format(summary.pendingCount)} à confirmar
            </p>
            <p>
              <strong className="font-semibold text-slate-700 dark:text-slate-200">{integer.format(summary.paxConfirmed)} PAX</strong> confirmados
              {summary.paxPending > 0 && ` · ${integer.format(summary.paxPending)} à confirmar`}
            </p>
          </Kpi>
        </div>

        <div className={cn(cardClassName, 'p-5')}>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {REVENUE_METRIC_LABELS[metric]} · {year}
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Pela data de realização do evento. Clique num mês para filtrar a planilha.</p>
            </div>
            {month !== null && (
              <button
                type="button"
                onClick={() => setMonth(null)}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-900/30"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
                Ver ano todo
              </button>
            )}
          </div>
          {firstLoad ? (
            <div className="h-72 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ) : (
            <RevenueChart data={chartData} metric={metric} selectedMonth={month} onSelectMonth={setMonth} theme={theme} />
          )}
        </div>
      </section>

      {/* ---------------- Bloco 2: planilha mensal ---------------- */}
      <section className={cardClassName}>
        <div className="space-y-3 border-b border-slate-200 p-5 dark:border-slate-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Planilha de eventos · {periodLabel}</h2>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['xlsx', 'Exportar Excel', FileSpreadsheet],
                  ['pdf', 'Exportar PDF', FileText],
                ] as const
              ).map(([kind, label, Icon]) => (
                <button
                  key={kind}
                  type="button"
                  disabled={tableRows.length === 0 || exporting !== null}
                  onClick={() => void handleExport(kind)}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-brand-200 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-brand-900/30"
                >
                  {exporting === kind ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="Mês"
              value={month ?? 0}
              onChange={(value) => setMonth(value === 0 ? null : value)}
              options={[{ value: 0, label: 'Ano todo' }, ...MONTH_SHORT_LABELS.map((label, index) => ({ value: index + 1, label }))]}
            />
            <Segmented
              label="Situação"
              value={situation}
              onChange={setSituation}
              options={[
                { value: 'all' as SituationFilter, label: 'Todos' },
                { value: 'realizado' as SituationFilter, label: 'Realizado' },
                { value: 'confirmado' as SituationFilter, label: 'Confirmado' },
                { value: 'a_confirmar' as SituationFilter, label: 'À confirmar' },
              ]}
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Propostas perdidas não entram. Mudar a situação para Confirmado ou Realizado fecha a proposta; À confirmar volta para Em aberto.
          </p>
          {actionError && (
            <p role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              {actionError}
            </p>
          )}
        </div>

        {firstLoad ? (
          <div className="space-y-3 p-5">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="h-12 animate-pulse rounded-md bg-slate-100 dark:bg-slate-800" />
            ))}
          </div>
        ) : tableRows.length === 0 ? (
          <p className="px-5 py-14 text-center text-sm text-slate-500 dark:text-slate-400">Nenhum evento em {periodLabel.toLowerCase()} com esse filtro.</p>
        ) : (
          <HorizontalScrollArea label="Planilha de eventos">
            <table className="w-full min-w-[1700px] text-left text-sm">
              <thead className="sticky top-0 z-10 whitespace-nowrap bg-slate-50 shadow-[inset_0_-1px_0_theme(colors.slate.200)] dark:bg-slate-950 dark:shadow-[inset_0_-1px_0_theme(colors.slate.800)]">
                <tr>
                  <th scope="col" className={cn(headCell, 'pl-5')}>Data</th>
                  <th scope="col" className={headCell}>Evento</th>
                  <th scope="col" className={headCell}>Origem</th>
                  <th scope="col" className={headCell}>Local</th>
                  <th scope="col" className={cn(headCell, 'text-right')}>PAX</th>
                  <th scope="col" className={headCell}>Situação</th>
                  <th scope="col" className={cn(headCell, 'bg-brand-50 text-right text-brand-800 dark:bg-brand-900/30 dark:text-brand-200')}>Locação de sala</th>
                  <th scope="col" className={cn(headCell, 'text-right')}>Extras / Equip.</th>
                  <th scope="col" className={cn(headCell, 'text-right')}>A&amp;B</th>
                  <th scope="col" className={cn(headCell, 'text-right')}>Hosp. (100%)</th>
                  <th scope="col" className={cn(headCell, 'text-right')}>Estacionamento</th>
                  <th scope="col" className={headCell}>NFs</th>
                  <th scope="col" className={headCell}>Pagto</th>
                  <th scope="col" className={cn(headCell, 'text-right')}>Total bruto / líquido</th>
                  <th scope="col" className={headCell}>Nº proposta</th>
                  <th scope="col" className={cn(headCell, 'pr-5')}>Pesquisa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {tableRows.map((lead) => {
                  const values = getLeadValues(lead)
                  const rowSituation = revenueSituation(lead)
                  const saving = savingIds.has(lead.id)
                  return (
                    <tr key={lead.id} className={cn('align-top transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40', saving && 'opacity-70')}>
                      <td className="whitespace-nowrap py-3 pl-5 pr-3 font-medium tabular-nums text-slate-700 dark:text-slate-200">{formatEventDays(lead)}</td>
                      <td className="max-w-[16rem] px-3 py-3">
                        <Link to={`/propostas/${lead.id}`} className="font-semibold text-slate-900 hover:text-brand-700 hover:underline dark:text-white dark:hover:text-brand-300">
                          {lead.event_name || 'Evento sem nome'}
                        </Link>
                        <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                          {lead.client_id && lead.company ? (
                            <Link to={`/leads/${lead.client_id}`} className="hover:underline">
                              {lead.company}
                            </Link>
                          ) : (
                            lead.company
                          )}
                          {lead.company ? ' · ' : ''}
                          {lead.contact_name}
                        </p>
                      </td>
                      <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{lead.origin || '—'}</td>
                      <td className="max-w-[10rem] px-3 py-3 text-slate-600 dark:text-slate-300">{formatLeadRooms(lead) || '—'}</td>
                      <td className="px-3 py-2 text-right">
                        <PaxInput value={lead.pax} disabled={saving} onSave={(pax) => void patchLead(lead, { pax })} />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          aria-label="Situação do evento"
                          value={rowSituation}
                          disabled={saving}
                          onChange={(event) => void patchLead(lead, { operational_status: event.target.value as OperationalStatus })}
                          className={cn(inlineSelect, SITUATION_STYLES[rowSituation])}
                        >
                          {OPERATIONAL_STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {OPERATIONAL_STATUS_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="bg-brand-50/60 px-3 py-3 font-semibold text-brand-900 dark:bg-brand-900/20 dark:text-white">
                        <MoneyCell value={values.rental} />
                      </td>
                      <td className="px-3 py-3"><MoneyCell value={values.equipment} rate={NET_RATES.equipment} /></td>
                      <td className="px-3 py-3"><MoneyCell value={values.ab} rate={NET_RATES.ab} /></td>
                      <td className="px-3 py-3"><MoneyCell value={values.lodging} /></td>
                      <td className="px-3 py-3"><MoneyCell value={values.parking} rate={NET_RATES.parking} /></td>
                      <td className="px-3 py-2">
                        <NfEditor lead={lead} disabled={saving} onSave={(patch) => void patchLead(lead, patch)} />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          aria-label="Pagamento"
                          value={lead.payment_status}
                          disabled={saving}
                          onChange={(event) => void patchLead(lead, { payment_status: event.target.value as PaymentStatus })}
                          className={cn(inlineSelect, 'min-w-[6.5rem] border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-950', PAYMENT_STYLES[lead.payment_status])}
                        >
                          {PAYMENT_STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {PAYMENT_STATUS_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums">
                        <p className="font-semibold text-slate-900 dark:text-white">{formatBRL(values.total)}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Líq. {formatBRL(values.net)}</p>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300">{lead.proposal_number || '—'}</td>
                      <td className="py-2 pl-3 pr-5">
                        <select
                          aria-label="Pesquisa de satisfação"
                          value={lead.survey_status}
                          disabled={saving}
                          onChange={(event) => void patchLead(lead, { survey_status: event.target.value as SurveyStatus })}
                          className={cn(inlineSelect, 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200')}
                        >
                          {SURVEY_STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {SURVEY_STATUS_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 text-sm dark:border-slate-700">
                <tr className="bg-slate-50 dark:bg-slate-950/50">
                  <td colSpan={6} className={cn(footLabel, 'text-slate-700 dark:text-slate-200')}>
                    Faturamento bruto · {tableRows.length} {tableRows.length === 1 ? 'evento' : 'eventos'}
                  </td>
                  <td className="bg-brand-50 dark:bg-brand-900/30" />
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatBRL(gross.equipment)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatBRL(gross.ab)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatBRL(gross.lodging)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatBRL(gross.parking)}</td>
                  <td colSpan={2} />
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums">{formatBRL(gross.total)}</td>
                  <td colSpan={2} />
                </tr>
                <tr className="bg-white dark:bg-slate-900">
                  <td colSpan={6} className={cn(footLabel, 'text-slate-700 dark:text-slate-200')}>
                    Faturamento líquido
                  </td>
                  <td className="bg-brand-50 px-3 py-2.5 text-right font-bold tabular-nums text-brand-900 dark:bg-brand-900/30 dark:text-white">{formatBRL(gross.rental)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatBRL(netShare(gross.equipment, NET_RATES.equipment))}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatBRL(netShare(gross.ab, NET_RATES.ab))}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatBRL(gross.lodging)}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{formatBRL(netShare(gross.parking, NET_RATES.parking))}</td>
                  <td colSpan={2} />
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums">{formatBRL(gross.net)}</td>
                  <td colSpan={2} />
                </tr>
                <tr className="bg-gradient-to-r from-brand-900 to-brand-600 text-white">
                  <td colSpan={6} className={footLabel}>
                    Total locação de salas
                  </td>
                  <td className="px-3 py-3 text-right text-base font-bold tabular-nums">{formatBRL(metaConfirmed)}</td>
                  <td colSpan={9} className="px-3 py-3 text-sm text-brand-100">
                    Confirmado / Realizado · <span className="font-semibold text-white">À confirmar: {formatBRL(metaPending)}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </HorizontalScrollArea>
        )}
      </section>
    </>
  )
}
