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
import { useTheme } from '../contexts/ThemeContext'
import { supabase } from '../lib/supabase'
import { cn, isRowClick } from '../lib/utils'
import { formatBRL, formatDateBR } from '../lib/format'
import { countEventDays, getLeadRooms, getLeadValues, hasAnyValue, type LeadValueBreakdown } from '../lib/leadFields'
import {
  DASHBOARD_LEAD_COLUMNS,
  NOT_INFORMED_LABEL,
  OTHERS_LABEL,
  PERIOD_PRESET_LABELS,
  computeKpis,
  computeTrend,
  countBy,
  countRooms,
  foldIntoOthers,
  formatRangeLabel,
  getGranularity,
  getPresetRange,
  isProposalSent,
  rangeToTimestampBounds,
  toLocalISODate,
  type DashboardLead,
  type DateRange,
  type Granularity,
  type PeriodPreset,
  type RankItem,
  type TrendPoint,
} from '../lib/dashboard'
import { LEAD_STATUS_LABELS, type Lead, type LeadStatus } from '../types/lead'

// =============================================================================
// Cores dos gráficos
// Paleta categórica validada (contraste, daltonismo e separação entre cores
// vizinhas) para o fundo branco e para o fundo escuro. A ordem é fixa: a cor
// segue a categoria, nunca a posição no ranking.
// =============================================================================

type ChartTheme = {
  series: string[]
  /** Cor única do ranking de perdas (slot 8, não usado pelos outros gráficos). */
  loss: string
  /** Fatias "Outros" e "Não informado": neutras, sem competir com as categorias. */
  neutral: string
  grid: string
  axis: string
  surface: string
  cursor: string
}

const CHART_THEMES: Record<'light' | 'dark', ChartTheme> = {
  light: {
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'],
    loss: '#e34948',
    neutral: '#94a3b8',
    grid: '#e2e8f0',
    axis: '#64748b',
    surface: '#ffffff',
    cursor: 'rgba(148, 163, 184, 0.15)',
  },
  dark: {
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'],
    loss: '#e66767',
    neutral: '#64748b',
    grid: '#1e293b',
    axis: '#94a3b8',
    surface: '#0f172a',
    cursor: 'rgba(148, 163, 184, 0.10)',
  },
}

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
async function fetchLeadsInRange(range: DateRange): Promise<DashboardLead[]> {
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

    if (error) throw error
    rows.push(...((data ?? []) as DashboardLead[]))
    if (!data || data.length < PAGE_SIZE) break
  }

  return rows
}

const FOLLOW_UP_LIMIT = 8

async function fetchOpenLeads(): Promise<Lead[]> {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .eq('status', 'em_aberto')
    .order('created_at', { ascending: false })
    .limit(FOLLOW_UP_LIMIT)

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
        'relative flex flex-col overflow-hidden rounded-xl p-5 shadow-sm',
        highlight
          ? 'bg-gradient-to-br from-brand-900 to-brand-600 text-white'
          : 'border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
      )}
    >
      {!highlight && <span className="absolute inset-x-0 top-0 h-1 bg-brand-600" aria-hidden="true" />}
      <div className="flex items-start justify-between gap-3">
        <p className={cn('text-sm font-medium', highlight ? 'text-brand-100' : 'text-slate-500 dark:text-slate-400')}>
          {title}
        </p>
        <span
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            highlight ? 'bg-white/15 text-white' : 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
          )}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>

      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className={cn('h-9 w-24', highlight && 'bg-white/20 dark:bg-white/20')} />
          <Skeleton className={cn('h-4 w-40', highlight && 'bg-white/20 dark:bg-white/20')} />
        </div>
      ) : (
        <>
          <p
            className={cn('mt-2 text-3xl font-bold tabular-nums', highlight ? 'text-white' : 'text-slate-900 dark:text-white')}
            title={valueTitle}
          >
            {value}
          </p>
          <div className={cn('mt-1 text-sm', highlight ? 'text-brand-100' : 'text-slate-500 dark:text-slate-400')}>{detail}</div>
          {footer && (
            <div
              className={cn(
                'mt-4 border-t pt-3 text-sm',
                highlight ? 'border-white/20 text-white' : 'border-slate-100 text-slate-600 dark:border-slate-800 dark:text-slate-300',
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
  const title = getTitle?.(payload[0])

  return (
    <div className="min-w-44 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
      {title && <p className="mb-1.5 font-semibold capitalize text-slate-900 dark:text-white">{title}</p>}
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

/** 6 categorias com cor própria + "Outros". */
const MAX_DONUT_SLICES = 7

function sliceColor(item: RankItem, index: number, theme: ChartTheme) {
  if (item.label === OTHERS_LABEL || item.label === NOT_INFORMED_LABEL) return theme.neutral
  return theme.series[index % theme.series.length]
}

function DistributionDonut({ data, theme, requests }: { data: RankItem[]; theme: ChartTheme; requests: number }) {
  const total = requests

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row xl:flex-col 2xl:flex-row">
      <div className="relative h-52 w-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={data.length > 1 ? 1 : 0}
              stroke={theme.surface}
              strokeWidth={2}
              startAngle={90}
              endAngle={-270}
            >
              {data.map((item, index) => (
                <Cell key={item.label} fill={sliceColor(item, index, theme)} />
              ))}
            </Pie>
            <Tooltip
              content={
                <ChartTooltip
                  formatValue={(entry) => {
                    const item = entry.payload as RankItem
                    return `${formatInteger(item.count)} (${formatPercent(item.share)})`
                  }}
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">{formatInteger(total)}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">solicitações</span>
        </div>
      </div>

      {/* Legenda com valores: rótulos visíveis para todas as fatias */}
      <ul className="w-full min-w-0 space-y-2">
        {data.map((item, index) => (
          <li key={item.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: sliceColor(item, index, theme) }}
                aria-hidden="true"
              />
              <span className="truncate text-slate-600 dark:text-slate-300" title={item.label}>
                {item.label}
              </span>
            </span>
            <span className="shrink-0 tabular-nums">
              <span className="font-semibold text-slate-900 dark:text-white">{formatInteger(item.count)}</span>
              <span className="ml-1.5 text-slate-500 dark:text-slate-400">{formatPercent(item.share)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// -----------------------------------------------------------------------------
// Tabela de follow-up
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// Composição dos valores (Locação, A&B, Hospedagem)
// -----------------------------------------------------------------------------

/** Texto de tooltip com a composição do valor. */
function valueBreakdownTitle(values: LeadValueBreakdown): string {
  return `Locação ${formatBRL(values.rental)} · A&B ${formatBRL(values.ab)} · Hospedagem ${formatBRL(values.lodging)}`
}

/**
 * Componentes do orçamento. Não são categorias com identidade própria nos gráficos,
 * então usam tons da cor da marca + rótulo escrito (a cor nunca fala sozinha).
 */
const VALUE_COMPONENTS: Array<{ key: keyof Omit<LeadValueBreakdown, 'total'>; label: string; className: string }> = [
  { key: 'rental', label: 'Locação / Espaço', className: 'bg-brand-900 dark:bg-brand-400' },
  { key: 'ab', label: 'A&B', className: 'bg-brand-600 dark:bg-brand-600' },
  { key: 'lodging', label: 'Hospedagem', className: 'bg-brand-300 dark:bg-brand-800' },
]

function ValueRow({ title, subtitle, values }: { title: string; subtitle: string; values: LeadValueBreakdown }) {
  const total = values.total
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        </div>
        <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white" title={formatBRL(total)}>
          {compactCurrencyFormatter.format(total)}
        </p>
      </div>

      <div className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
        {total > 0 &&
          VALUE_COMPONENTS.map((component) =>
            values[component.key] > 0 ? (
              <span
                key={component.key}
                className={cn('h-full first:rounded-l-full last:rounded-r-full', component.className)}
                style={{ width: `${(values[component.key] / total) * 100}%` }}
              />
            ) : null,
          )}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3">
        {VALUE_COMPONENTS.map((component) => (
          <div key={component.key} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <span className={cn('h-2 w-2 shrink-0 rounded-sm', component.className)} aria-hidden="true" />
              <span className="truncate">{component.label}</span>
            </dt>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900 dark:text-white" title={formatBRL(values[component.key])}>
              {compactCurrencyFormatter.format(values[component.key])}
              <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
                {total > 0 ? formatPercent(values[component.key] / total) : '0%'}
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function ValueCompositionCard({
  loading,
  closed,
  open,
  closedCount,
  openCount,
}: {
  loading: boolean
  closed: LeadValueBreakdown
  open: LeadValueBreakdown
  closedCount: number
  openCount: number
}) {
  return (
    <section className={cn(cardClassName, 'mt-6 p-5')}>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Composição dos orçamentos</h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Receita Total = Locação / Espaço + A&amp;B + Hospedagem
        </p>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:divide-x xl:divide-slate-100 dark:xl:divide-slate-800">
          <ValueRow
            title="Fechado (receita fechada)"
            subtitle={`${formatInteger(closedCount)} lead(s) fechado(s) no período`}
            values={closed}
          />
          <div className="border-t border-slate-100 pt-6 xl:border-t-0 xl:pl-6 xl:pt-0 dark:border-slate-800">
            <ValueRow
              title="Em aberto (pipeline)"
              subtitle={`${formatInteger(openCount)} lead(s) em negociação`}
              values={open}
            />
          </div>
        </div>
      )}
    </section>
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
          <tr className="border-y border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
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
                  if (isRowClick(event.target)) navigate(`/leads/${lead.id}`)
                }}
                className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40"
              >
                <td className="px-5 py-3">
                  <Link
                    to={`/leads/${lead.id}`}
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
                      title="Editar lead"
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
  const { openNewLead, openEditLead, leadsVersion } = useOutletContext<LayoutOutletContext>()
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
    fetchLeadsInRange(range)
      .then((data) => {
        if (isActive) setPeriodResult({ key: periodKey, data, error: null })
      })
      .catch(() => {
        if (isActive) setPeriodResult({ key: periodKey, data: null, error: LOAD_ERROR_MESSAGE })
      })
    return () => {
      isActive = false
    }
  }, [periodKey, range, customRangeError])

  // ---- Leads em aberto (independe do período: follow-up é sempre agora) ----
  const followUpKey = `${leadsVersion}|${retryCount}`
  const [followUpResult, setFollowUpResult] = useState<AsyncResult<Lead[]> | null>(null)

  useEffect(() => {
    let isActive = true
    fetchOpenLeads()
      .then((data) => {
        if (isActive) setFollowUpResult({ key: followUpKey, data, error: null })
      })
      .catch(() => {
        if (isActive) setFollowUpResult({ key: followUpKey, data: null, error: LOAD_ERROR_MESSAGE })
      })
    return () => {
      isActive = false
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
    return [...foldIntoOthers(informed, MAX_DONUT_SLICES - notInformed.length), ...notInformed]
  }, [leads, distribution])

  const handleQuickEdit = (lead: Lead, status?: LeadStatus) => {
    openEditLead(status ? { ...lead, status, proposal_sent: status === 'fechado' ? true : lead.proposal_sent } : lead)
  }

  const hasLeads = (leads?.length ?? 0) > 0
  const [today] = useState(() => toLocalISODate(new Date()))

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Visão geral do funil de leads · ${formatRangeLabel(range)}`}
        actions={
          <button
            type="button"
            onClick={openNewLead}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Novo Lead
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

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          highlight
          loading={showPeriodSkeleton}
          value={formatPercent(kpis.conversionRate)}
          detail={`${formatPercent(kpis.proposalConversionRate)} sobre propostas enviadas (${formatInteger(kpis.closed)}/${formatInteger(kpis.proposalsSent)})`}
          footer={
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-brand-100">Receita total fechada</span>
              <span className="text-lg font-bold tabular-nums" title={formatBRL(kpis.closedValue)}>
                {formatCurrencyCompact(kpis.closedValue)}
              </span>
            </div>
          }
        />
        <KpiCard
          title="Taxa de perda / recusa"
          icon={TrendingDown}
          loading={showPeriodSkeleton}
          value={formatPercent(kpis.lossRate)}
          detail={`${formatInteger(kpis.lost)} perdidos · ${formatInteger(kpis.open)} ainda em aberto`}
        />
      </div>

      {/* Composição dos valores: fechado x em aberto */}
      <ValueCompositionCard
        loading={showPeriodSkeleton}
        closed={kpis.closedBreakdown}
        open={kpis.openBreakdown}
        closedCount={kpis.closed}
        openCount={kpis.open}
      />

      {/* Gráficos */}
      <div className="mt-6 space-y-6">
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

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ChartCard
            title="Origem das solicitações"
            description={
            distribution === 'room'
              ? 'Demanda por sala: cada sala marcada conta (um lead pode pedir várias), % sobre as solicitações'
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
              <Skeleton className="h-52 w-full" />
            ) : hasLeads ? (
              <DistributionDonut data={distributionData} theme={chartTheme} requests={leads?.length ?? 0} />
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
      </div>

      {!hasLeads && !showPeriodSkeleton && !periodError && !customRangeError && (
        <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Dica: use o botão <strong className="font-semibold">+ Novo Lead</strong> para cadastrar a primeira solicitação.
        </p>
      )}
    </>
  )
}
