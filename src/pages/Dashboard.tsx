import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Building2,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleX,
  Clock,
  FileText,
  Inbox,
  Pencil,
  Plus,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import PageHeader from '../components/PageHeader'
import WhatsAppButton from '../components/WhatsAppButton'
import type { LayoutOutletContext } from '../components/Layout'
import type { ProposalPageState } from '../lib/leadForm'
import { useTheme } from '../contexts/ThemeContext'
import { CHART_THEMES, type ChartTheme } from '../lib/chartTheme'
import { supabase } from '../lib/supabase'
import { cn, isRowClick } from '../lib/utils'
import { formatBRL, formatDateBR } from '../lib/format'
import {
  NET_RATES,
  NET_RATES_LABEL,
  countEventDays,
  getLeadRooms,
  getLeadValues,
  hasAnyValue,
  type LeadValueBreakdown,
} from '../lib/leadFields'
import {
  DASHBOARD_LEAD_COLUMNS,
  MONTHLY_LEAD_COLUMNS,
  NOT_INFORMED_LABEL,
  OTHERS_LABEL,
  PERIOD_PRESET_LABELS,
  addMonths,
  computeKpis,
  currentMonth,
  eventMonth,
  formatMonthLong,
  groupValueByMonth,
  monthWindow,
  monthsToRange,
  proposalMonth,
  relativeChange,
  computeTrend,
  countBy,
  countRooms,
  foldIntoOthers,
  formatRangeLabel,
  getGranularity,
  getPresetRange,
  getPreviousRange,
  isProposalSent,
  rangeToTimestampBounds,
  toLocalISODate,
  type DashboardKpis,
  type DashboardLead,
  type DateRange,
  type Granularity,
  type ISOMonth,
  type MonthlyLead,
  type MonthlyStatusPoint,
  type PeriodPreset,
  type RankItem,
  type TrendPoint,
} from '../lib/dashboard'
import { LEAD_STATUS_LABELS, type Lead, type LeadStatus } from '../types/lead'

// =============================================================================
// Séries dos gráficos (cores em src/lib/chartTheme.ts)
// =============================================================================

type TrendSeriesKey = 'received' | 'proposals' | 'closed'

const TREND_SERIES: Array<{ key: TrendSeriesKey; label: string; slot: number }> = [
  { key: 'received', label: 'Recebidas', slot: 0 },
  { key: 'proposals', label: 'Propostas enviadas', slot: 1 },
  { key: 'closed', label: 'Fechadas', slot: 2 },
]

// =============================================================================
// Formatação
// =============================================================================

const percentFormatter = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 })
const decimalFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 })
const integerFormatter = new Intl.NumberFormat('pt-BR')
const compactCurrencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
})

const formatPercent = (value: number) => percentFormatter.format(value)
const formatInteger = (value: number) => integerFormatter.format(value)

/** Valores grandes ficam compactos no card ("R$ 1,2 mi"); o valor exato vai no title. */
function formatCurrencyCompact(value: number): string {
  return Math.abs(value) >= 100_000 ? compactCurrencyFormatter.format(value) : formatBRL(value)
}

function daysSince(timestamp: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 86_400_000))
}

// =============================================================================
// Busca de dados
// =============================================================================

const PAGE_SIZE = 1000

/** Busca todos os leads do período, paginando (o Supabase devolve no máximo 1000 linhas por vez). */
async function fetchLeadsInRange(range: DateRange, signal: AbortSignal): Promise<DashboardLead[]> {
  const { gte, lt } = rangeToTimestampBounds(range)
  const rows: DashboardLead[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('leads')
      .select(DASHBOARD_LEAD_COLUMNS)
      .gte('created_at', gte)
      .lt('created_at', lt)
      .order('created_at', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
      .abortSignal(signal)

    if (error) throw error
    rows.push(...((data ?? []) as DashboardLead[]))
    if (!data || data.length < PAGE_SIZE) break
  }

  return rows
}

type MonthlyKind = 'event' | 'proposal'

/** Propostas com evento nos meses do gráfico (event) ou feitas nesses meses (proposal). */
async function fetchMonthlyLeads(kind: MonthlyKind, months: ISOMonth[], signal: AbortSignal): Promise<MonthlyLead[]> {
  const range = monthsToRange(months)
  const { gte, lt } = rangeToTimestampBounds(range)
  const rows: MonthlyLead[] = []

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const base = supabase.from('leads').select(MONTHLY_LEAD_COLUMNS)
    const filtered =
      kind === 'event'
        ? base.gte('event_date', range.from).lte('event_date', range.to)
        : base.gte('created_at', gte).lt('created_at', lt)
    const { data, error } = await filtered
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
      .abortSignal(signal)

    if (error) throw error
    rows.push(...((data ?? []) as MonthlyLead[]))
    if (!data || data.length < PAGE_SIZE) break
  }

  return rows
}

const FOLLOW_UP_LIMIT = 8

async function fetchOpenLeads(signal: AbortSignal): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'em_aberto')
    .order('created_at', { ascending: false })
    .limit(FOLLOW_UP_LIMIT)
    .abortSignal(signal)

  if (error) throw error
  return data ?? []
}

type AsyncResult<T> = { key: string; data: T | null; error: string | null }

const LOAD_ERROR_MESSAGE = 'Não foi possível carregar os dados. Verifique sua conexão e tente novamente.'

// =============================================================================
// Componentes de apoio
// =============================================================================

const cardClassName = 'rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900'

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-100 dark:bg-slate-800', className)} />
}

type ChartCardProps = {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
  children: ReactNode
}

function ChartCard({ title, description, actions, className, children }: ChartCardProps) {
  return (
    <section className={cn(cardClassName, 'flex flex-col p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="flex-1">{children}</div>
    </section>
  )
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full min-h-48 items-center justify-center rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
      {message}
    </div>
  )
}

type SegmentedOption<T extends string> = { value: T; label: string }

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900"
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
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

// -----------------------------------------------------------------------------
// KPIs
// -----------------------------------------------------------------------------

type KpiCardProps = {
  title: string
  icon: LucideIcon
  value: string
  valueTitle?: string
  detail: ReactNode
  footer?: ReactNode
  highlight?: boolean
  loading: boolean
}

function KpiCard({ title, icon: Icon, value, valueTitle, detail, footer, highlight = false, loading }: KpiCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border p-5 shadow-sm',
        highlight
          ? 'border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/60'
          : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
      )}
    >
      <p
        className={cn(
          'flex items-center gap-2 text-sm font-medium',
          highlight ? 'text-brand-900 dark:text-brand-100' : 'text-slate-600 dark:text-slate-400',
        )}
      >
        <Icon
          className={cn('h-4 w-4 shrink-0', highlight ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400 dark:text-slate-500')}
          aria-hidden="true"
        />
        {title}
      </p>

      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-40" />
        </div>
      ) : (
        <>
          <p
            className={cn(
              'mt-2 text-[1.75rem] font-semibold leading-tight tracking-[-0.01em] tabular-nums',
              highlight ? 'text-brand-900 dark:text-white' : 'text-slate-900 dark:text-white',
            )}
            title={valueTitle}
          >
            {value}
          </p>
          <div className={cn('mt-1 text-sm', highlight ? 'text-brand-800 dark:text-brand-200' : 'text-slate-500 dark:text-slate-400')}>
            {detail}
          </div>
          {footer && (
            <div
              className={cn(
                'mt-4 border-t pt-3 text-sm',
                highlight
                  ? 'border-brand-200 text-brand-900 dark:border-brand-800 dark:text-brand-100'
                  : 'border-slate-100 text-slate-600 dark:border-slate-800 dark:text-slate-300',
              )}
            >
              {footer}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Barra de proporção "propostas x sondagem", com os números escritos ao lado (a cor nunca fala sozinha). */
function SplitBar({ sent, inquiries }: { sent: number; inquiries: number }) {
  const total = sent + inquiries
  const sentShare = total > 0 ? sent / total : 0
  return (
    <div>
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
        {total === 0 ? (
          <span className="h-full w-full rounded-full bg-slate-100 dark:bg-slate-800" />
        ) : (
          <>
            {sent > 0 && <span className="h-full rounded-full bg-brand-600" style={{ width: `${sentShare * 100}%` }} />}
            {inquiries > 0 && <span className="h-full flex-1 rounded-full bg-slate-200 dark:bg-slate-700" />}
          </>
        )}
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand-600" aria-hidden="true" />
          Proposta {formatPercent(sentShare)}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-slate-300 dark:bg-slate-600" aria-hidden="true" />
          Sondagem {formatPercent(total > 0 ? 1 - sentShare : 0)}
        </span>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Topo: resultado do período
// -----------------------------------------------------------------------------

/** Variação contra o período anterior, em texto (a cor reforça, nunca fala sozinha). */
function Delta({ current, previous, label, loading }: { current: number; previous: number | null; label: string; loading: boolean }) {
  if (loading || previous === null) return <span className="text-xs text-slate-400 dark:text-slate-500">Comparando com {label}...</span>
  const change = relativeChange(current, previous)
  if (change === null) {
    return <span className="text-xs text-slate-500 dark:text-slate-400">Sem base em {label} para comparar</span>
  }
  const up = change >= 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
      <Icon className={cn('h-3.5 w-3.5', up ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')} aria-hidden="true" />
      <strong className={cn('font-semibold', up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400')}>
        {up ? '+' : ''}
        {decimalFormatter.format(change * 100)}%
      </strong>
      vs. {label}
    </span>
  )
}

function SummaryStat({ label, value, title, children }: { label: string; value: string; title?: string; children?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-white" title={title}>
        {value}
      </dd>
      {children && <dd className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{children}</dd>}
    </div>
  )
}

function FunnelStep({
  label,
  value,
  base,
  detail,
  tone,
}: {
  label: string
  value: number
  base: number
  detail?: string
  tone: 'brand' | 'closed'
}) {
  const width = base > 0 ? Math.max((value / base) * 100, value > 0 ? 2 : 0) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-slate-700 dark:text-slate-200">{label}</span>
        <span className="tabular-nums">
          <strong className="font-semibold text-slate-900 dark:text-white">{formatInteger(value)}</strong>
          {detail && <span className="ml-1.5 text-xs text-slate-500 dark:text-slate-400">{detail}</span>}
        </span>
      </div>
      <div className="mt-1.5 h-2.5 rounded-sm bg-slate-100 dark:bg-slate-800" aria-hidden="true">
        <div
          className={cn('h-full rounded-sm', tone === 'closed' ? 'bg-emerald-600 dark:bg-emerald-500' : 'bg-brand-600 dark:bg-brand-500')}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

function PeriodSummary({
  kpis,
  previous,
  previousLabel,
  loading,
  previousLoading,
}: {
  kpis: DashboardKpis
  previous: DashboardKpis | null
  previousLabel: string
  loading: boolean
  previousLoading: boolean
}) {
  return (
    <section
      className={cn(cardClassName, 'grid grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]')}
      aria-label="Resultado do período"
    >
      <div className="p-6">
        <h2 className="text-sm font-medium text-slate-600 dark:text-slate-300">Locação de sala fechada</h2>
        {loading ? (
          <div className="mt-2 space-y-2">
            <Skeleton className="h-11 w-56" />
            <Skeleton className="h-4 w-40" />
          </div>
        ) : (
          <>
            <p
              className="mt-1 text-[2.75rem] font-semibold leading-tight tracking-[-0.02em] tabular-nums text-brand-900 dark:text-white"
              title={formatBRL(kpis.closedBreakdown.rental)}
            >
              {formatBRL(kpis.closedBreakdown.rental)}
            </p>
            <Delta
              current={kpis.closedBreakdown.rental}
              previous={previous ? previous.closedBreakdown.rental : null}
              label={previousLabel}
              loading={previousLoading}
            />
          </>
        )}

        <dl className="mt-6 grid grid-cols-1 gap-5 border-t border-slate-100 pt-5 sm:grid-cols-3 dark:border-slate-800">
          {loading ? (
            Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)
          ) : (
            <>
              <SummaryStat
                label="Receita líquida fechada"
                value={formatCurrencyCompact(kpis.closedBreakdown.net)}
                title={formatBRL(kpis.closedBreakdown.net)}
              >
                {NET_RATES_LABEL}
              </SummaryStat>
              <SummaryStat label="Receita bruta fechada" value={formatCurrencyCompact(kpis.closedValue)} title={formatBRL(kpis.closedValue)}>
                Todos os serviços
              </SummaryStat>
              <SummaryStat
                label="Em negociação"
                value={formatCurrencyCompact(kpis.openBreakdown.rental)}
                title={formatBRL(kpis.openBreakdown.rental)}
              >
                Locação de {formatInteger(kpis.open)} {kpis.open === 1 ? 'proposta' : 'propostas'} · bruta{' '}
                {formatCurrencyCompact(kpis.openBreakdown.total)}
              </SummaryStat>
            </>
          )}
        </dl>
      </div>

      <div className="border-t border-slate-200 bg-slate-50/70 p-6 lg:border-l lg:border-t-0 dark:border-slate-800 dark:bg-slate-950/30">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium text-slate-600 dark:text-slate-300">Funil do período</h2>
          {!loading && (
            <span className="text-sm text-slate-500 dark:text-slate-400">
              Conversão <strong className="font-semibold text-slate-900 dark:text-white">{formatPercent(kpis.conversionRate)}</strong>
            </span>
          )}
        </div>
        {loading ? (
          <div className="mt-4 space-y-4">
            {Array.from({ length: 3 }, (_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <FunnelStep label="Solicitações recebidas" value={kpis.total} base={kpis.total} tone="brand" />
            <FunnelStep
              label="Propostas enviadas"
              value={kpis.proposalsSent}
              base={kpis.total}
              detail={formatPercent(kpis.total > 0 ? kpis.proposalsSent / kpis.total : 0)}
              tone="brand"
            />
            <FunnelStep
              label="Fechadas"
              value={kpis.closed}
              base={kpis.total}
              detail={`${formatPercent(kpis.proposalConversionRate)} das enviadas`}
              tone="closed"
            />
            <p className="border-t border-slate-200 pt-3 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <strong className="font-semibold text-slate-900 dark:text-white">{formatInteger(kpis.open)}</strong> em aberto ·{' '}
              <strong className="font-semibold text-slate-900 dark:text-white">{formatInteger(kpis.lost)}</strong> perdidas
            </p>
          </div>
        )}
      </div>
    </section>
  )
}

// -----------------------------------------------------------------------------
// Tooltip compartilhado dos gráficos
// -----------------------------------------------------------------------------

type TooltipEntry = {
  name?: string | number
  value?: number | string | Array<number | string>
  color?: string
  payload?: unknown
}

type ChartTooltipProps = {
  active?: boolean
  payload?: ReadonlyArray<TooltipEntry>
  /** Título do tooltip a partir do ponto de dados. */
  getTitle?: (entry: TooltipEntry) => string
  /** Texto do valor a partir do ponto de dados. */
  formatValue?: (entry: TooltipEntry) => string
}

function ChartTooltip({ active, payload, getTitle, formatValue }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const rawTitle = getTitle?.(payload[0])
  // Só a primeira letra: "Outubro de 2026" (capitalize do CSS deixaria "Outubro De 2026")
  const title = rawTitle ? rawTitle.charAt(0).toLocaleUpperCase('pt-BR') + rawTitle.slice(1) : rawTitle

  return (
    <div className="min-w-44 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
      {title && <p className="mb-1.5 font-semibold text-slate-900 dark:text-white">{title}</p>}
      <ul className="space-y-1">
        {payload.map((entry, index) => (
          <li key={`${entry.name}-${index}`} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: entry.color }} aria-hidden="true" />
              {entry.name}
            </span>
            <span className="font-semibold tabular-nums text-slate-900 dark:text-white">
              {formatValue ? formatValue(entry) : String(entry.value ?? '')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Receita mês a mês: pelo mês do evento e pelo mês da proposta
// -----------------------------------------------------------------------------

type MonthlySeries = { key: 'fechado' | 'em_aberto' | 'perdido'; label: string }

function monthlyColor(key: MonthlySeries['key'], theme: ChartTheme): string {
  return key === 'fechado' ? theme.series[2] : key === 'em_aberto' ? theme.series[3] : theme.loss
}

function MonthlyRevenueChart({
  data,
  series,
  reference,
  onSelectMonth,
  theme,
}: {
  data: MonthlyStatusPoint[]
  series: MonthlySeries[]
  reference: ISOMonth
  onSelectMonth: (month: ISOMonth) => void
  theme: ChartTheme
}) {
  const point = data.find((item) => item.month === reference)
  const axisProps = { tick: { fill: theme.axis, fontSize: 12 }, tickLine: false, axisLine: false } as const

  return (
    <div>
      {/* Legenda com os valores do mês de referência (identifica as séries sem depender só da cor) */}
      <ul className="mb-4 flex flex-wrap gap-x-5 gap-y-2">
        {series.map((item) => (
          <li key={item.key} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: monthlyColor(item.key, theme) }} aria-hidden="true" />
            <span className="text-slate-600 dark:text-slate-300">{item.label}</span>
            <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{formatBRL(point?.[item.key] ?? 0)}</span>
          </li>
        ))}
      </ul>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={6} />
            <YAxis {...axisProps} width={76} tickFormatter={(value: number) => compactCurrencyFormatter.format(value)} />
            <Tooltip
              cursor={{ fill: theme.cursor }}
              content={
                <ChartTooltip
                  getTitle={(entry) => (entry.payload as MonthlyStatusPoint).fullLabel}
                  formatValue={(entry) => formatBRL(Number(entry.value ?? 0))}
                />
              }
            />
            {series.map((item, index) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.label}
                stackId="mes"
                fill={monthlyColor(item.key, theme)}
                // 2px da cor do fundo separam os segmentos empilhados
                stroke={theme.surface}
                strokeWidth={2}
                radius={index === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                maxBarSize={36}
                cursor="pointer"
                onClick={(entry) => onSelectMonth((entry as unknown as MonthlyStatusPoint).month)}
              >
                {data.map((entry) => (
                  <Cell key={entry.month} fillOpacity={entry.month === reference ? 1 : 0.45} />
                ))}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

const EVENT_MONTH_SERIES: MonthlySeries[] = [
  { key: 'fechado', label: 'Realizada (fechados)' },
  { key: 'em_aberto', label: 'Em negociação' },
]

const PROPOSAL_MONTH_SERIES: MonthlySeries[] = [
  { key: 'fechado', label: 'Fecharam' },
  { key: 'em_aberto', label: 'Em aberto (sondagem)' },
  { key: 'perdido', label: 'Perdidas' },
]

const MONTHLY_BLOCKS: Record<MonthlyKind, { title: string; series: MonthlySeries[]; getMonth: (lead: MonthlyLead) => ISOMonth | null }> = {
  event: { title: 'Pelo mês do evento', series: EVENT_MONTH_SERIES, getMonth: eventMonth },
  proposal: { title: 'Pelo mês da proposta', series: PROPOSAL_MONTH_SERIES, getMonth: proposalMonth },
}

/** Um gráfico mês a mês com o próprio mês de referência e a própria busca. */
function MonthlyRevenueBlock({ kind, reloadKey, theme }: { kind: MonthlyKind; reloadKey: string; theme: ChartTheme }) {
  const block = MONTHLY_BLOCKS[kind]
  const [reference, setReference] = useState<ISOMonth>(() => currentMonth())
  const [retryCount, setRetryCount] = useState(0)
  const months = useMemo(() => monthWindow(reference), [reference])

  // A chave identifica a consulta atual; o carregamento é derivado dela, sem setState síncrono em effect
  const key = `${kind}|${reference}|${reloadKey}|${retryCount}`
  const [result, setResult] = useState<AsyncResult<MonthlyLead[]> | null>(null)

  useEffect(() => {
    let isActive = true
    const controller = new AbortController()
    fetchMonthlyLeads(kind, months, controller.signal)
      .then((data) => {
        if (isActive) setResult({ key, data, error: null })
      })
      .catch(() => {
        if (isActive) setResult({ key, data: null, error: LOAD_ERROR_MESSAGE })
      })
    return () => {
      isActive = false
      controller.abort()
    }
  }, [key, kind, months])

  const loading = result?.key !== key
  const leads = result?.data ?? null
  const error = result?.key === key ? result.error : null
  const data = useMemo(() => groupValueByMonth(leads ?? [], months, block.getMonth), [leads, months, block])
  const point = data.find((item) => item.month === reference)
  const monthName = formatMonthLong(reference)
  const inputId = `monthly-${kind}`

  const navButton =
    'rounded-lg border border-slate-200 p-1.5 text-slate-600 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'

  return (
    <div className="min-w-0 rounded-lg border border-slate-100 p-4 dark:border-slate-800">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{block.title}</h3>
        <div className="flex items-center gap-1.5">
          {loading && leads !== null && <RefreshCw className="mr-1 h-4 w-4 animate-spin text-slate-400" aria-label="Atualizando" />}
          <button type="button" onClick={() => setReference(addMonths(reference, -1))} aria-label="Mês anterior" className={navButton}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <label htmlFor={inputId} className="sr-only">
            {kind === 'event' ? 'Mês do evento' : 'Mês da proposta'}
          </label>
          <input
            id={inputId}
            type="month"
            value={reference}
            onChange={(event) => event.target.value && setReference(event.target.value)}
            className={cn(dateInputClassName, 'py-1.5')}
          />
          <button type="button" onClick={() => setReference(addMonths(reference, 1))} aria-label="Próximo mês" className={navButton}>
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
        {kind === 'event' ? (
          <>Eventos que acontecem em {monthName}: receita realizada (fechados) e o que ainda está em negociação.</>
        ) : (
          <>
            Propostas feitas em {monthName}:{' '}
            <strong className="font-semibold text-slate-700 dark:text-slate-200">{formatBRL(point?.total ?? 0)}</strong> no total,
            pela situação atual de cada uma.
          </>
        )}
      </p>

      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <span className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            {error}
          </span>
          <button
            type="button"
            onClick={() => setRetryCount((current) => current + 1)}
            className="inline-flex items-center gap-1 font-semibold hover:underline"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Tentar de novo
          </button>
        </div>
      ) : leads === null ? (
        <Skeleton className="h-72 w-full" />
      ) : data.every((item) => block.series.every((series) => item[series.key] === 0)) ? (
        <EmptyChart message={kind === 'event' ? 'Nenhum evento com valor nestes meses.' : 'Nenhuma proposta com valor nestes meses.'} />
      ) : (
        <MonthlyRevenueChart data={data} series={block.series} reference={reference} onSelectMonth={setReference} theme={theme} />
      )}
    </div>
  )
}

function MonthlyRevenueSection({ reloadKey, theme }: { reloadKey: string; theme: ChartTheme }) {
  return (
    <section className={cn(cardClassName, 'mt-6 p-5')}>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Receita mês a mês</h2>
        <p className="mt-0.5 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
          Cada gráfico tem o seu mês e não depende do período escolhido acima. Clique numa barra para ver aquele mês.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <MonthlyRevenueBlock kind="event" reloadKey={reloadKey} theme={theme} />
        <MonthlyRevenueBlock kind="proposal" reloadKey={reloadKey} theme={theme} />
      </div>
    </section>
  )
}

// -----------------------------------------------------------------------------
// Gráfico 1: evolução
// -----------------------------------------------------------------------------

function TrendChart({ data, granularity, theme }: { data: TrendPoint[]; granularity: Granularity; theme: ChartTheme }) {
  const totals = useMemo(
    () =>
      data.reduce(
        (sum, point) => ({
          received: sum.received + point.received,
          proposals: sum.proposals + point.proposals,
          closed: sum.closed + point.closed,
        }),
        { received: 0, proposals: 0, closed: 0 },
      ),
    [data],
  )

  const axisProps = {
    tick: { fill: theme.axis, fontSize: 12 },
    tickLine: false,
    axisLine: false,
  } as const

  const tooltip = (
    <Tooltip
      cursor={{ fill: theme.cursor }}
      content={
        <ChartTooltip
          getTitle={(entry) => (entry.payload as TrendPoint).fullLabel}
          formatValue={(entry) => formatInteger(Number(entry.value ?? 0))}
        />
      }
    />
  )

  return (
    <div>
      {/* Legenda com totais (identifica as séries sem depender só da cor) */}
      <ul className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
        {TREND_SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: theme.series[series.slot] }} aria-hidden="true" />
            <span className="text-slate-600 dark:text-slate-300">{series.label}</span>
            <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{formatInteger(totals[series.key])}</span>
          </li>
        ))}
      </ul>

      {/* Barras agrupadas: leem bem contagens pequenas e dias zerados (linhas suavizadas criariam "picos" falsos) */}
      <div className="h-80">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
            barGap={2}
            barCategoryGap={granularity === 'day' ? '18%' : '24%'}
          >
            <CartesianGrid vertical={false} stroke={theme.grid} />
            <XAxis dataKey="label" {...axisProps} minTickGap={granularity === 'day' ? 16 : 4} />
            <YAxis {...axisProps} allowDecimals={false} width={48} />
            {tooltip}
            {TREND_SERIES.map((series) => (
              <Bar
                key={series.key}
                dataKey={series.key}
                name={series.label}
                fill={theme.series[series.slot]}
                radius={[4, 4, 0, 0]}
                maxBarSize={granularity === 'day' ? 14 : 32}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Gráfico 2: motivos de perda
// -----------------------------------------------------------------------------

/** Altura de cada linha do ranking: rótulo em cima, barra embaixo. */
const LOSS_ROW_HEIGHT = 46
const LOSS_BAR_SIZE = 12

type BarLabelProps = {
  x?: number | string
  y?: number | string
  width?: number | string
  value?: number | string | boolean | null
}

/** Nome do motivo escrito acima da barra, na largura toda (sem eixo apertado à esquerda). */
function ReasonLabel({ x = 0, y = 0, value, fill }: BarLabelProps & { fill: string }) {
  return (
    <text x={Number(x)} y={Number(y) - 7} fill={fill} fontSize={13}>
      {String(value ?? '')}
    </text>
  )
}

function LossReasonsChart({ data, theme }: { data: RankItem[]; theme: ChartTheme }) {
  const height = data.length * LOSS_ROW_HEIGHT + 8
  const labelColor = theme.axis

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 72, left: 0, bottom: 0 }}
          barCategoryGap={0}
          barSize={LOSS_BAR_SIZE}
        >
          <XAxis type="number" hide allowDecimals={false} domain={[0, 'dataMax']} />
          <YAxis type="category" dataKey="label" hide />
          <Tooltip
            cursor={{ fill: theme.cursor }}
            content={
              <ChartTooltip
                getTitle={(entry) => (entry.payload as RankItem).label}
                formatValue={(entry) => {
                  const item = entry.payload as RankItem
                  return `${formatInteger(item.count)} (${formatPercent(item.share)})`
                }}
              />
            }
          />
          <Bar
            dataKey="count"
            name="Leads perdidos"
            fill={theme.loss}
            radius={[0, 4, 4, 0]}
            background={{ fill: theme.cursor, radius: 4 }}
            minPointSize={4}
          >
            <LabelList dataKey="label" content={<ReasonLabel fill={labelColor} />} />
            <LabelList
              dataKey="count"
              position="right"
              offset={10}
              fill={labelColor}
              fontSize={12}
              fontWeight={600}
              formatter={(value) => formatInteger(Number(value ?? 0))}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Gráfico 3: distribuição por sala / meio de prospecção
// -----------------------------------------------------------------------------

type DistributionDimension = 'room' | 'origin'

const DISTRIBUTION_OPTIONS: SegmentedOption<DistributionDimension>[] = [
  { value: 'room', label: 'Sala/Salão' },
  { value: 'origin', label: 'Prospecção' },
]

/** 6 categorias + "Outros". */
const MAX_DISTRIBUTION_ROWS = 7

type PieSlice = { label: string; value: number; fill: string; hint?: string }

/** Gráfico de rosca com a legenda ao lado: cada fatia com o valor e a participação escritos. */
function PieWithLegend({
  slices,
  formatValue,
  ariaLabel,
  theme,
}: {
  slices: PieSlice[]
  formatValue: (value: number) => string
  ariaLabel: string
  theme: ChartTheme
}) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const visible = slices.filter((slice) => slice.value > 0)

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="h-44 w-44 shrink-0" role="img" aria-label={ariaLabel}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={visible}
              dataKey="value"
              nameKey="label"
              innerRadius="64%"
              outerRadius="100%"
              paddingAngle={visible.length > 1 ? 1.5 : 0}
              stroke={theme.surface}
              strokeWidth={2}
              startAngle={90}
              endAngle={-270}
              isAnimationActive={false}
            />
            <Tooltip
              content={
                <ChartTooltip
                  formatValue={(entry) => {
                    const value = Number(entry.value ?? 0)
                    return `${formatValue(value)} (${formatPercent(total > 0 ? value / total : 0)})`
                  }}
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="w-full min-w-0 space-y-2">
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-start justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-start gap-2">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: slice.fill }} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-slate-700 dark:text-slate-200" title={slice.label}>
                  {slice.label}
                </span>
                {slice.hint && <span className="block text-xs text-slate-500 dark:text-slate-400">{slice.hint}</span>}
              </span>
            </span>
            <span className="shrink-0 text-right tabular-nums">
              <span className="font-semibold text-slate-900 dark:text-white" title={formatValue(slice.value)}>
                {formatValue(slice.value)}
              </span>
              <span className="ml-1.5 text-slate-500 dark:text-slate-400">
                {formatPercent(total > 0 ? slice.value / total : 0)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function DistributionPie({ data, theme }: { data: RankItem[]; theme: ChartTheme }) {
  const slices = data.map((item, index) => ({
    label: item.label,
    value: item.count,
    fill:
      item.label === OTHERS_LABEL || item.label === NOT_INFORMED_LABEL
        ? theme.neutral
        : theme.series[index % theme.series.length],
  }))
  return <PieWithLegend slices={slices} formatValue={formatInteger} ariaLabel="Distribuição das solicitações" theme={theme} />
}

// -----------------------------------------------------------------------------
// Tabela de follow-up
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Composição dos valores (Locação, A&B, Hospedagem)
// -----------------------------------------------------------------------------

/** Texto de tooltip com a composição do valor. */
function valueBreakdownTitle(values: LeadValueBreakdown): string {
  return [
    `Locação ${formatBRL(values.rental)}`,
    `A&B ${formatBRL(values.ab)}`,
    `Hospedagem ${formatBRL(values.lodging)}`,
    `Equipamentos ${formatBRL(values.equipment)}`,
    `Estacionamento ${formatBRL(values.parking)}`,
    `Líquida total ${formatBRL(values.net)}`,
  ].join(' · ')
}

/**
 * Receitas além da locação. Não são categorias com identidade própria nos gráficos,
 * então usam tons da cor da marca + rótulo escrito (a cor nunca fala sozinha).
 */
const COMPOSITION_PARTS: Array<{ key: 'rental' | 'ab' | 'lodging' | 'equipment' | 'parking'; label: string; rate: number }> = [
  { key: 'rental', label: 'Locação de sala', rate: NET_RATES.rental },
  { key: 'ab', label: 'A&B', rate: NET_RATES.ab },
  { key: 'lodging', label: 'Hospedagem', rate: NET_RATES.lodging },
  { key: 'equipment', label: 'Equipamentos', rate: NET_RATES.equipment },
  { key: 'parking', label: 'Estacionamento', rate: NET_RATES.parking },
]

function CompositionPie({
  title,
  subtitle,
  values,
  theme,
}: {
  title: string
  subtitle: string
  values: LeadValueBreakdown
  theme: ChartTheme
}) {
  const slices = COMPOSITION_PARTS.map((part, index) => ({
    label: part.label,
    value: values[part.key],
    fill: theme.composition[index],
    hint: part.rate < 1 ? `${Math.round(part.rate * 100)}% entra na líquida` : undefined,
  }))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <dl className="flex gap-5 text-right">
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Bruta</dt>
            <dd className="text-base font-semibold tabular-nums text-slate-900 dark:text-white" title={formatBRL(values.total)}>
              {formatCurrencyCompact(values.total)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Líquida do hotel</dt>
            <dd className="text-base font-semibold tabular-nums text-slate-900 dark:text-white" title={formatBRL(values.net)}>
              {formatCurrencyCompact(values.net)}
            </dd>
          </div>
        </dl>
      </div>
      {values.total > 0 ? (
        <PieWithLegend slices={slices} formatValue={formatCurrencyCompact} ariaLabel={`Composição: ${title}`} theme={theme} />
      ) : (
        <EmptyChart message="Sem valores no período." />
      )}
    </div>
  )
}

function ValueCompositionCard({
  loading,
  closed,
  open,
  closedCount,
  openCount,
  theme,
}: {
  loading: boolean
  closed: LeadValueBreakdown
  open: LeadValueBreakdown
  closedCount: number
  openCount: number
  theme: ChartTheme
}) {
  return (
    <ChartCard
      title="Composição dos orçamentos"
      description="Quanto cada serviço representa na receita bruta: o que fechou e o que ainda está em negociação"
    >
      {loading ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:divide-x xl:divide-slate-100 dark:xl:divide-slate-800">
          <CompositionPie
            title="Fechado"
            subtitle={`${formatInteger(closedCount)} ${closedCount === 1 ? 'proposta fechada' : 'propostas fechadas'} no período`}
            values={closed}
            theme={theme}
          />
          <div className="border-t border-slate-100 pt-6 xl:border-t-0 xl:pl-6 xl:pt-0 dark:border-slate-800">
            <CompositionPie
              title="Em negociação"
              subtitle={`${formatInteger(openCount)} ${openCount === 1 ? 'proposta em aberto' : 'propostas em aberto'}`}
              values={open}
              theme={theme}
            />
          </div>
        </div>
      )}
    </ChartCard>
  )
}

function StaleBadge({ days }: { days: number }) {
  if (days >= 14) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
        <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
        {days} dias
      </span>
    )
  }
  if (days >= 7) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" />
        {days} dias
      </span>
    )
  }
  return (
    <span className="text-xs text-slate-500 dark:text-slate-400">{days === 0 ? 'Hoje' : days === 1 ? '1 dia' : `${days} dias`}</span>
  )
}

type QuickAction = { status: LeadStatus; label: string; icon: LucideIcon; className: string }

const QUICK_ACTIONS: QuickAction[] = [
  {
    status: 'fechado',
    label: 'Fechou',
    icon: CircleCheck,
    className: 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40',
  },
  {
    status: 'perdido',
    label: 'Perdeu',
    icon: CircleX,
    className: 'text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40',
  },
]

function FollowUpTable({
  leads,
  onEdit,
}: {
  leads: Lead[]
  /** Abre o formulário; com `status`, já vem com a situação selecionada. */
  onEdit: (lead: Lead, status?: LeadStatus) => void
}) {
  const navigate = useNavigate()

  if (leads.length === 0) {
    return <EmptyChart message="Nenhum lead em aberto. Tudo em dia!" />
  }

  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[900px] whitespace-nowrap text-left text-sm">
        <thead>
          <tr className="border-y border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
            <th className="px-5 py-2.5">Contato</th>
            <th className="px-3 py-2.5">Salas / Origem</th>
            <th className="px-3 py-2.5">Data do evento</th>
            <th className="px-3 py-2.5 text-right">Receita total</th>
            <th className="px-3 py-2.5">Proposta</th>
            <th className="px-3 py-2.5">Sem atualização</th>
            <th className="px-5 py-2.5 text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {leads.map((lead) => {
            return (
              <tr
                key={lead.id}
                onClick={(event) => {
                  if (isRowClick(event.target)) navigate(`/propostas/${lead.id}`)
                }}
                className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <td className="px-5 py-3">
                  <Link
                    to={`/propostas/${lead.id}`}
                    className="font-medium text-slate-900 hover:text-brand-700 hover:underline dark:text-white dark:hover:text-brand-300"
                  >
                    {lead.contact_name}
                  </Link>
                  {lead.company && (
                    <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                      <span className="max-w-[14rem] truncate">{lead.company}</span>
                    </p>
                  )}
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span>{lead.contact_phone || lead.contact_email || 'Sem contato'}</span>
                    <WhatsAppButton lead={lead} />
                  </div>
                </td>
                <td className="px-3 py-3">
                  <p className="max-w-[14rem] truncate text-slate-700 dark:text-slate-200" title={getLeadRooms(lead).join(', ')}>
                    {getLeadRooms(lead).join(', ') || '—'}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{lead.origin || '—'}</p>
                </td>
                <td className="px-3 py-3 text-slate-700 dark:text-slate-200">
                  {lead.event_date ? (
                    <>
                      {formatDateBR(lead.event_date)}
                      {lead.event_end_date && (
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          até {formatDateBR(lead.event_end_date)} · {countEventDays(lead)} dias
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="block max-w-[10rem] truncate text-slate-500 dark:text-slate-400" title={lead.date_notes ?? undefined}>
                      {lead.date_notes || 'Sem data'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                  {hasAnyValue(lead) ? (
                    <span title={valueBreakdownTitle(getLeadValues(lead))}>{formatBRL(getLeadValues(lead).total)}</span>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-3">
                  {isProposalSent(lead) ? (
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
                  <StaleBadge days={daysSince(lead.updated_at)} />
                </td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-1">
                    {QUICK_ACTIONS.map(({ status, label, icon: Icon, className }) => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => onEdit(lead, status)}
                        title={`${label}: marcar como ${LEAD_STATUS_LABELS[status]}`}
                        aria-label={`${label}: marcar ${lead.contact_name} como ${LEAD_STATUS_LABELS[status].toLowerCase()}`}
                        className={cn('inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors', className)}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        <span className="hidden 2xl:inline">{label}</span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => onEdit(lead)}
                      title="Editar proposta"
                      aria-label={`Editar ${lead.contact_name}`}
                      className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                    >
                      <Pencil className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// =============================================================================
// Página
// =============================================================================

const PERIOD_OPTIONS: SegmentedOption<PeriodPreset>[] = (
  ['this_month', 'last_30_days', 'this_year', 'custom'] as const
).map((value) => ({ value, label: PERIOD_PRESET_LABELS[value] }))

const dateInputClassName =
  'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white'

export default function Dashboard() {
  const { openNewLead, leadsVersion } = useOutletContext<LayoutOutletContext>()
  const navigate = useNavigate()
  const { isDark } = useTheme()
  const chartTheme = CHART_THEMES[isDark ? 'dark' : 'light']

  // ---- Filtro de período ----
  const [preset, setPreset] = useState<PeriodPreset>('this_month')
  const [customRange, setCustomRange] = useState<DateRange>(() => getPresetRange('last_30_days'))
  const [distribution, setDistribution] = useState<DistributionDimension>('room')
  const [retryCount, setRetryCount] = useState(0)

  const customRangeError =
    preset === 'custom' && (!customRange.from || !customRange.to || customRange.from > customRange.to)
      ? 'A data inicial precisa ser anterior ou igual à final.'
      : null

  const range = useMemo<DateRange>(
    () => (preset === 'custom' ? customRange : getPresetRange(preset)),
    [preset, customRange],
  )
  const granularity = getGranularity(range)

  // ---- Dados do período ----
  // A chave identifica a consulta atual; o carregamento é derivado dela, sem setState síncrono em effect.
  const periodKey = `${range.from}|${range.to}|${leadsVersion}|${retryCount}`
  const [periodResult, setPeriodResult] = useState<AsyncResult<DashboardLead[]> | null>(null)

  useEffect(() => {
    if (customRangeError) return
    let isActive = true
    const controller = new AbortController()
    fetchLeadsInRange(range, controller.signal)
      .then((data) => {
        if (isActive) setPeriodResult({ key: periodKey, data, error: null })
      })
      .catch(() => {
        if (isActive) setPeriodResult({ key: periodKey, data: null, error: LOAD_ERROR_MESSAGE })
      })
    return () => {
      isActive = false
      controller.abort()
    }
  }, [periodKey, range, customRangeError])

  // ---- Período anterior (comparação do topo) ----
  const previousPeriod = useMemo(() => getPreviousRange(range), [range])
  const previousKey = `${previousPeriod.range.from}|${previousPeriod.range.to}|${leadsVersion}|${retryCount}`
  const [previousResult, setPreviousResult] = useState<AsyncResult<DashboardLead[]> | null>(null)

  useEffect(() => {
    if (customRangeError) return
    let isActive = true
    const controller = new AbortController()
    fetchLeadsInRange(previousPeriod.range, controller.signal)
      .then((data) => {
        if (isActive) setPreviousResult({ key: previousKey, data, error: null })
      })
      .catch(() => {
        // Só informativo: sem a comparação, o topo mostra os números do período normalmente
        if (isActive) setPreviousResult({ key: previousKey, data: null, error: LOAD_ERROR_MESSAGE })
      })
    return () => {
      isActive = false
      controller.abort()
    }
  }, [previousKey, previousPeriod, customRangeError])

  // ---- Leads em aberto (independe do período: follow-up é sempre agora) ----
  const followUpKey = `${leadsVersion}|${retryCount}`
  const [followUpResult, setFollowUpResult] = useState<AsyncResult<Lead[]> | null>(null)

  useEffect(() => {
    let isActive = true
    const controller = new AbortController()
    fetchOpenLeads(controller.signal)
      .then((data) => {
        if (isActive) setFollowUpResult({ key: followUpKey, data, error: null })
      })
      .catch(() => {
        if (isActive) setFollowUpResult({ key: followUpKey, data: null, error: LOAD_ERROR_MESSAGE })
      })
    return () => {
      isActive = false
      controller.abort()
    }
  }, [followUpKey])

  const periodLoading = !customRangeError && periodResult?.key !== periodKey
  // Enquanto recarrega, mantém os números anteriores na tela (sem "piscar")
  const leads = periodResult?.data ?? null
  const periodError = periodResult?.key === periodKey ? periodResult.error : null
  const showPeriodSkeleton = periodLoading && leads === null

  const followUpLoading = followUpResult?.key !== followUpKey
  const openLeads = followUpResult?.data ?? null
  const followUpError = followUpResult?.key === followUpKey ? followUpResult.error : null

  // ---- Agregações ----
  const kpis = useMemo(() => computeKpis(leads ?? [], range), [leads, range])
  const previousLoading = previousResult?.key !== previousKey
  const previousLeads = previousResult?.key === previousKey ? previousResult.data : null
  const previousKpis = useMemo(
    () => (previousLeads ? computeKpis(previousLeads, previousPeriod.range) : null),
    [previousLeads, previousPeriod],
  )
  const trend = useMemo(() => computeTrend(leads ?? [], range, granularity), [leads, range, granularity])
  const lossReasons = useMemo(
    () => countBy((leads ?? []).filter((lead) => lead.status === 'perdido').map((lead) => lead.loss_reason)),
    [leads],
  )
  const distributionData = useMemo(() => {
    const ranked =
      distribution === 'room'
        ? countRooms(leads ?? [])
        : countBy((leads ?? []).map((lead) => lead.origin))
    // "Não informado" fica fora do ranking colorido e vai para o fim, junto com "Outros"
    const informed = ranked.filter((item) => item.label !== NOT_INFORMED_LABEL)
    const notInformed = ranked.filter((item) => item.label === NOT_INFORMED_LABEL)
    return [...foldIntoOthers(informed, MAX_DISTRIBUTION_ROWS - notInformed.length), ...notInformed]
  }, [leads, distribution])

  // A edição fica na página da proposta; Fechou/Perdeu já chegam marcados no card Proposta
  const handleQuickEdit = (lead: Lead, status?: LeadStatus) => {
    const state: ProposalPageState = status === 'fechado' || status === 'perdido' ? { status } : { edit: true }
    navigate(`/propostas/${lead.id}`, { state })
  }

  const hasLeads = (leads?.length ?? 0) > 0
  const [today] = useState(() => toLocalISODate(new Date()))

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Resultado comercial · ${formatRangeLabel(range)}`}
        actions={
          <button
            type="button"
            onClick={openNewLead}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nova Proposta
          </button>
        }
      />

      {/* Filtro de período */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SegmentedControl options={PERIOD_OPTIONS} value={preset} onChange={setPreset} ariaLabel="Período" />

        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <label className="sr-only" htmlFor="dashboard-from">
              Data inicial
            </label>
            <input
              id="dashboard-from"
              type="date"
              value={customRange.from}
              max={customRange.to || today}
              onChange={(event) => setCustomRange((current) => ({ ...current, from: event.target.value }))}
              className={dateInputClassName}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">até</span>
            <label className="sr-only" htmlFor="dashboard-to">
              Data final
            </label>
            <input
              id="dashboard-to"
              type="date"
              value={customRange.to}
              min={customRange.from}
              onChange={(event) => setCustomRange((current) => ({ ...current, to: event.target.value }))}
              className={dateInputClassName}
            />
          </div>
        )}

        {periodLoading && !showPeriodSkeleton && (
          <span className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400">
            <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
            Atualizando...
          </span>
        )}
      </div>

      {customRangeError && (
        <p className="-mt-3 mb-6 text-sm font-medium text-red-600 dark:text-red-400">{customRangeError}</p>
      )}

      {periodError && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <span className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            {periodError}
          </span>
          <button
            type="button"
            onClick={() => setRetryCount((current) => current + 1)}
            className="inline-flex items-center gap-1 font-semibold hover:underline"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Tentar de novo
          </button>
        </div>
      )}

      {/* 1. Resultado do período: dinheiro e funil */}
      <PeriodSummary
        kpis={kpis}
        previous={previousKpis}
        previousLabel={previousPeriod.label}
        loading={showPeriodSkeleton}
        previousLoading={previousLoading}
      />

      {/* 2. Indicadores de volume e taxas */}
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          title="Solicitações recebidas"
          icon={Inbox}
          loading={showPeriodSkeleton}
          value={formatInteger(kpis.total)}
          detail={
            <>
              Média de <strong className="font-semibold text-slate-700 dark:text-slate-200">{decimalFormatter.format(kpis.dailyAverage)}</strong> por dia
            </>
          }
          footer={
            <Delta
              current={kpis.total}
              previous={previousKpis ? previousKpis.total : null}
              label={previousPeriod.label}
              loading={previousLoading}
            />
          }
        />
        <KpiCard
          title="Propostas formais enviadas"
          icon={FileText}
          loading={showPeriodSkeleton}
          value={formatInteger(kpis.proposalsSent)}
          detail={`vs. ${formatInteger(kpis.inquiriesOnly)} apenas sondagem (orçamento verbal)`}
          footer={<SplitBar sent={kpis.proposalsSent} inquiries={kpis.inquiriesOnly} />}
        />
        <KpiCard
          title="Taxa de conversão geral"
          icon={TrendingUp}
          loading={showPeriodSkeleton}
          value={formatPercent(kpis.conversionRate)}
          detail={`${formatPercent(kpis.proposalConversionRate)} sobre propostas enviadas (${formatInteger(kpis.closed)}/${formatInteger(kpis.proposalsSent)})`}
        />
        <KpiCard
          title="Taxa de perda / recusa"
          icon={TrendingDown}
          loading={showPeriodSkeleton}
          value={formatPercent(kpis.lossRate)}
          detail={`${formatInteger(kpis.lost)} perdidos · ${formatInteger(kpis.open)} ainda em aberto`}
        />
      </div>

      <div className="mt-6 space-y-6">
        {/* 3. Composição: de onde vem a receita */}
        <ValueCompositionCard
          loading={showPeriodSkeleton}
          closed={kpis.closedBreakdown}
          open={kpis.openBreakdown}
          closedCount={kpis.closed}
          openCount={kpis.open}
          theme={chartTheme}
        />

        {/* 4. O que fazer agora */}
        <ChartCard
          title="Últimos leads em aberto"
          description="Precisam de follow-up · atualize a situação sem sair da Dashboard"
          actions={
            followUpLoading && openLeads !== null ? (
              <RefreshCw className="h-4 w-4 animate-spin text-slate-400" aria-label="Atualizando" />
            ) : undefined
          }
        >
          {followUpError ? (
            <EmptyChart message={followUpError} />
          ) : openLeads === null ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : (
            <FollowUpTable leads={openLeads} onEdit={handleQuickEdit} />
          )}
        </ChartCard>

        {/* 5. Origem e perdas */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ChartCard
            title="Origem das solicitações"
            description={
              distribution === 'room'
                ? 'Demanda por sala: cada sala marcada conta (um lead pode pedir várias)'
                : 'Por meio de prospecção'
            }
            actions={
              <SegmentedControl
                options={DISTRIBUTION_OPTIONS}
                value={distribution}
                onChange={setDistribution}
                ariaLabel="Agrupar por"
              />
            }
          >
            {showPeriodSkeleton ? (
              <Skeleton className="h-44 w-full" />
            ) : hasLeads ? (
              <DistributionPie data={distributionData} theme={chartTheme} />
            ) : (
              <EmptyChart message="Sem dados no período." />
            )}
          </ChartCard>

          <ChartCard title="Motivos de perda" description="Ranking dos gargalos no período">
            {showPeriodSkeleton ? (
              <Skeleton className="h-52 w-full" />
            ) : lossReasons.length > 0 ? (
              <LossReasonsChart data={lossReasons} theme={chartTheme} />
            ) : (
              <EmptyChart message="Nenhum lead perdido neste período." />
            )}
          </ChartCard>
        </div>
      </div>

      {/* 6. Histórico */}
      <MonthlyRevenueSection reloadKey={`${leadsVersion}|${retryCount}`} theme={chartTheme} />

      <div className="mt-6">
        <ChartCard
          title="Evolução das solicitações"
          description={`${granularity === 'day' ? 'Por dia' : 'Por mês'}, pela data de entrada do lead`}
        >
          {showPeriodSkeleton ? (
            <Skeleton className="h-80 w-full" />
          ) : hasLeads ? (
            <TrendChart data={trend} granularity={granularity} theme={chartTheme} />
          ) : (
            <EmptyChart message="Nenhuma solicitação recebida neste período." />
          )}
        </ChartCard>
      </div>

      {!hasLeads && !showPeriodSkeleton && !periodError && !customRangeError && (
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Dica: use o botão <strong className="font-semibold">+ Nova Proposta</strong> para cadastrar a primeira solicitação.
        </p>
      )}
    </>
  )
}
