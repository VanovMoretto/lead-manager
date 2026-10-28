import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarClock, Target, TrendingUp, Wallet, X, type LucideIcon } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import ValueDetails from './ValueDetails'
import { CHART_THEMES, type ChartTheme } from '../lib/chartTheme'
import { toLocalISODate } from '../lib/dashboard'
import { formatBRL, formatDateBR } from '../lib/format'
import { getLeadValues, sumLeadValues } from '../lib/leadFields'
import { MONTH_LONG_LABELS, MONTH_SHORT_LABELS } from '../lib/revenue'
import { cn } from '../lib/utils'
import { grossDetailRows, netDetailRows } from '../lib/valueDetails'
import type { Lead } from '../types/lead'

export type ClientMetricsView = 'revenue' | 'pipeline' | 'conversion'

const VIEWS: Array<{ value: ClientMetricsView; label: string; icon: LucideIcon }> = [
  { value: 'revenue', label: 'Receita', icon: Wallet },
  { value: 'pipeline', label: 'Em negociação', icon: TrendingUp },
  { value: 'conversion', label: 'Conversão', icon: Target },
]

const CURRENT_YEAR = new Date().getFullYear()

const compactCurrency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })
const percent = (value: number) => `${(value * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

/** Mês de referência da receita: o mês do evento (sem evento, o mês da proposta). */
function revenueMonthKey(lead: Pick<Lead, 'event_date' | 'created_at'>): string {
  return lead.event_date ? lead.event_date.slice(0, 7) : toLocalISODate(new Date(lead.created_at)).slice(0, 7)
}

function proposalMonthKey(lead: Pick<Lead, 'created_at'>): string {
  return toLocalISODate(new Date(lead.created_at)).slice(0, 7)
}

// =============================================================================
// Peças visuais
// =============================================================================

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="h-full min-w-0 rounded-lg border border-slate-200 px-3 py-2.5 dark:border-slate-800">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-lg font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
      {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  )
}

function Block({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
          {description && <p className="text-xs text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function Segmented<T extends string | number>({ options, value, onChange, label }: { options: Array<{ value: T; label: string }>; value: T; onChange: (value: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
            option.value === value
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

type TooltipRow = { label: string; value: string; color?: string }

function ChartTooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="min-w-44 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
      <p className="mb-1.5 font-semibold text-slate-900 dark:text-white">{title}</p>
      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              {row.color && <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: row.color }} aria-hidden="true" />}
              {row.label}
            </span>
            <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function axisProps(theme: ChartTheme) {
  return { tick: { fill: theme.axis, fontSize: 12 }, tickLine: false, axisLine: false } as const
}

function Empty({ message }: { message: string }) {
  return (
    <p className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
      {message}
    </p>
  )
}

// =============================================================================
// Receita
// =============================================================================

type RevenuePoint = { key: string; label: string; title: string; net: number; rental: number; total: number; events: number }

function RevenueView({ leads, theme }: { leads: Lead[]; theme: ChartTheme }) {
  const closed = useMemo(() => leads.filter((lead) => lead.status === 'fechado'), [leads])
  const years = useMemo(() => {
    const set = new Set(closed.map((lead) => Number(revenueMonthKey(lead).slice(0, 4))))
    if (set.size === 0) set.add(CURRENT_YEAR)
    return [...set].sort((a, b) => b - a)
  }, [closed])
  const [mode, setMode] = useState<'monthly' | 'yearly'>('monthly')
  const [year, setYear] = useState(() => years[0])

  const data = useMemo<RevenuePoint[]>(() => {
    const keys =
      mode === 'monthly'
        ? MONTH_SHORT_LABELS.map((_, index) => `${year}-${String(index + 1).padStart(2, '0')}`)
        : [...years].sort((a, b) => a - b).map(String)
    return keys.map((key) => {
      const group = closed.filter((lead) => (mode === 'monthly' ? revenueMonthKey(lead) === key : revenueMonthKey(lead).startsWith(key)))
      const values = sumLeadValues(group)
      const monthIndex = Number(key.slice(5, 7)) - 1
      return {
        key,
        label: mode === 'monthly' ? MONTH_SHORT_LABELS[monthIndex] : key,
        title: mode === 'monthly' ? `${MONTH_LONG_LABELS[monthIndex]} de ${year}` : key,
        net: values.net,
        rental: values.rental,
        total: values.total,
        events: group.length,
      }
    })
  }, [closed, mode, year, years])

  const period = sumLeadValues(closed.filter((lead) => (mode === 'monthly' ? revenueMonthKey(lead).startsWith(String(year)) : true)))
  const periodEvents = closed.filter((lead) => (mode === 'monthly' ? revenueMonthKey(lead).startsWith(String(year)) : true)).length
  const peak = data.reduce<RevenuePoint | null>((best, point) => (point.net > (best?.net ?? 0) ? point : best), null)

  // Sazonalidade: em que meses do ano este cliente costuma pedir propostas (todos os anos somados)
  const seasonality = useMemo(
    () =>
      MONTH_SHORT_LABELS.map((label, index) => ({
        key: String(index + 1),
        label,
        title: MONTH_LONG_LABELS[index],
        count: leads.filter((lead) => Number(proposalMonthKey(lead).slice(5, 7)) === index + 1).length,
      })),
    [leads],
  )
  const maxCount = Math.max(...seasonality.map((item) => item.count))
  const peakMonths = maxCount > 0 ? seasonality.filter((item) => item.count === maxCount).map((item) => item.title.toLowerCase()) : []

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ValueDetails title="Composição da receita líquida" rows={netDetailRows(period)} total={{ label: 'Receita líquida', value: period.net }} className="rounded-lg">
          <Stat label="Receita líquida" value={formatBRL(period.net)} hint={mode === 'monthly' ? String(year) : 'Todos os anos'} />
        </ValueDetails>
        <Stat label="Locação de sala" value={formatBRL(period.rental)} />
        <ValueDetails title="Composição da receita bruta" rows={grossDetailRows(period)} total={{ label: 'Receita bruta', value: period.total }} className="rounded-lg">
          <Stat label="Receita bruta" value={formatBRL(period.total)} />
        </ValueDetails>
        <Stat label="Eventos fechados" value={String(periodEvents)} />
      </div>

      <Block
        title="Receita líquida fechada"
        description="Pelo mês do evento (sem data do evento, conta o mês da proposta)."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              label="Agrupar por"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'monthly', label: 'Mensal' },
                { value: 'yearly', label: 'Anual' },
              ]}
            />
            {mode === 'monthly' && (
              <select
                aria-label="Ano"
                value={year}
                onChange={(event) => setYear(Number(event.target.value))}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                {years.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            )}
          </div>
        }
      >
        {closed.length === 0 ? (
          <Empty message="Este cliente ainda não tem eventos fechados." />
        ) : (
          <>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke={theme.grid} />
                  <XAxis dataKey="label" {...axisProps(theme)} interval="preserveStartEnd" minTickGap={4} />
                  <YAxis {...axisProps(theme)} width={72} tickFormatter={(value: number) => compactCurrency.format(value)} />
                  <Tooltip
                    cursor={{ fill: theme.cursor }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const point = payload[0].payload as RevenuePoint
                      return (
                        <ChartTooltipBox
                          title={point.title}
                          rows={[
                            { label: 'Receita líquida', value: formatBRL(point.net), color: theme.series[0] },
                            { label: 'Locação de sala', value: formatBRL(point.rental) },
                            { label: 'Receita bruta', value: formatBRL(point.total) },
                            { label: 'Eventos', value: String(point.events) },
                          ]}
                        />
                      )
                    }}
                  />
                  <Bar dataKey="net" name="Receita líquida" fill={theme.series[0]} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {peak && peak.net > 0 && (
              <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                Maior receita: <strong className="font-semibold">{peak.title}</strong> ({formatBRL(peak.net)})
              </p>
            )}
          </>
        )}
      </Block>

      <Block title="Quando este cliente nos procura" description="Propostas pedidas em cada mês do ano, somando todos os anos.">
        {leads.length === 0 ? (
          <Empty message="Nenhuma proposta ainda." />
        ) : (
          <>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={seasonality} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke={theme.grid} />
                  <XAxis dataKey="label" {...axisProps(theme)} interval="preserveStartEnd" minTickGap={4} />
                  <YAxis {...axisProps(theme)} allowDecimals={false} width={48} />
                  <Tooltip
                    cursor={{ fill: theme.cursor }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const point = payload[0].payload as (typeof seasonality)[number]
                      return <ChartTooltipBox title={point.title} rows={[{ label: 'Propostas', value: String(point.count), color: theme.series[1] }]} />
                    }}
                  />
                  <Bar dataKey="count" name="Propostas" fill={theme.series[1]} radius={[4, 4, 0, 0]} maxBarSize={28}>
                    {seasonality.map((point) => (
                      <Cell key={point.key} fillOpacity={point.count === maxCount ? 1 : 0.55} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {peakMonths.length > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                Pico de procura: <strong className="font-semibold">{peakMonths.join(', ')}</strong>
              </p>
            )}
          </>
        )}
      </Block>
    </div>
  )
}

// =============================================================================
// Em negociação
// =============================================================================

function PipelineView({ leads, theme }: { leads: Lead[]; theme: ChartTheme }) {
  const open = useMemo(
    () =>
      leads
        .filter((lead) => lead.status === 'em_aberto')
        .sort((a, b) => (a.event_date ?? '9999').localeCompare(b.event_date ?? '9999')),
    [leads],
  )
  const values = sumLeadValues(open)
  const withoutDate = open.filter((lead) => !lead.event_date)

  const monthKeys = [...new Set(open.flatMap((lead) => (lead.event_date ? [lead.event_date.slice(0, 7)] : [])))].sort()
  const data = monthKeys.map((key) => {
    const group = open.filter((lead) => lead.event_date?.startsWith(key))
    const monthIndex = Number(key.slice(5, 7)) - 1
    return {
      key,
      label: `${MONTH_SHORT_LABELS[monthIndex]}/${key.slice(2, 4)}`,
      title: `${MONTH_LONG_LABELS[monthIndex]} de ${key.slice(0, 4)}`,
      total: sumLeadValues(group).total,
      count: group.length,
    }
  })

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ValueDetails title="Composição do valor em negociação" rows={grossDetailRows(values)} total={{ label: 'Receita bruta', value: values.total }} className="rounded-lg">
          <Stat label="Em negociação (bruta)" value={formatBRL(values.total)} />
        </ValueDetails>
        <ValueDetails title="Composição da receita líquida possível" rows={netDetailRows(values)} total={{ label: 'Receita líquida', value: values.net }} className="rounded-lg">
          <Stat label="Receita líquida possível" value={formatBRL(values.net)} />
        </ValueDetails>
        <Stat label="Locação de sala" value={formatBRL(values.rental)} />
        <Stat label="Propostas em aberto" value={String(open.length)} hint={withoutDate.length > 0 ? `${withoutDate.length} sem data` : undefined} />
      </div>

      <Block title="Valor em negociação por mês do evento" description="Quando os eventos em aberto aconteceriam.">
        {data.length === 0 ? (
          <Empty message={open.length === 0 ? 'Nenhuma proposta em aberto.' : 'As propostas em aberto ainda não têm data de evento.'} />
        ) : (
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke={theme.grid} />
                <XAxis dataKey="label" {...axisProps(theme)} interval="preserveStartEnd" minTickGap={4} />
                <YAxis {...axisProps(theme)} width={72} tickFormatter={(value: number) => compactCurrency.format(value)} />
                <Tooltip
                  cursor={{ fill: theme.cursor }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const point = payload[0].payload as (typeof data)[number]
                    return (
                      <ChartTooltipBox
                        title={point.title}
                        rows={[
                          { label: 'Em negociação', value: formatBRL(point.total), color: theme.series[3] },
                          { label: 'Propostas', value: String(point.count) },
                        ]}
                      />
                    )
                  }}
                />
                <Bar dataKey="total" name="Em negociação" fill={theme.series[3]} radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Block>

      {open.length > 0 && (
        <Block title="Propostas em aberto">
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {open.map((lead) => (
              <li key={lead.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <Link to={`/propostas/${lead.id}`} className="truncate font-medium text-slate-900 hover:text-brand-700 hover:underline dark:text-white dark:hover:text-brand-300">
                    {lead.event_name || lead.contact_name}
                  </Link>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {lead.event_date ? formatDateBR(lead.event_date) : lead.date_notes || 'Sem data'}
                    {lead.proposal_number ? ` · Nº ${lead.proposal_number}` : ''}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-slate-900 dark:text-white">{formatBRL(getLeadValues(lead).total)}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </div>
  )
}

// =============================================================================
// Conversão
// =============================================================================

type YearPoint = { key: string; label: string; fechado: number; em_aberto: number; perdido: number; total: number }

function ConversionView({ leads, theme }: { leads: Lead[]; theme: ChartTheme }) {
  const closed = leads.filter((lead) => lead.status === 'fechado').length
  const lost = leads.filter((lead) => lead.status === 'perdido').length
  const sent = leads.filter((lead) => lead.proposal_sent || lead.status === 'fechado').length
  const decided = closed + lost

  const data = useMemo<YearPoint[]>(() => {
    const years = [...new Set(leads.map((lead) => proposalMonthKey(lead).slice(0, 4)))].sort()
    return years.map((year) => {
      const group = leads.filter((lead) => proposalMonthKey(lead).startsWith(year))
      return {
        key: year,
        label: year,
        fechado: group.filter((lead) => lead.status === 'fechado').length,
        em_aberto: group.filter((lead) => lead.status === 'em_aberto').length,
        perdido: group.filter((lead) => lead.status === 'perdido').length,
        total: group.length,
      }
    })
  }, [leads])

  const reasons = useMemo(() => {
    const counts = new Map<string, number>()
    for (const lead of leads) {
      if (lead.status !== 'perdido') continue
      const reason = lead.loss_reason || 'Não informado'
      counts.set(reason, (counts.get(reason) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [leads])

  const series = [
    { key: 'fechado' as const, label: 'Fechadas', color: theme.series[2] },
    { key: 'em_aberto' as const, label: 'Em aberto', color: theme.series[3] },
    { key: 'perdido' as const, label: 'Perdidas', color: theme.loss },
  ]

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Conversão geral" value={leads.length > 0 ? percent(closed / leads.length) : '0%'} hint={`${closed} de ${leads.length} propostas`} />
        <Stat label="Sobre as enviadas" value={sent > 0 ? percent(closed / sent) : '0%'} hint={`${sent} enviadas`} />
        <Stat label="Sobre as decididas" value={decided > 0 ? percent(closed / decided) : '0%'} hint="Fechadas ÷ (fechadas + perdidas)" />
        <Stat label="Perdidas" value={String(lost)} />
      </div>

      <Block title="Propostas por ano" description="Pela data em que a proposta foi pedida, com a situação atual.">
        {data.length === 0 ? (
          <Empty message="Nenhuma proposta ainda." />
        ) : (
          <>
            <ul className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
              {series.map((item) => (
                <li key={item.key} className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} aria-hidden="true" />
                  {item.label}
                </li>
              ))}
            </ul>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barCategoryGap="30%">
                  <CartesianGrid vertical={false} stroke={theme.grid} />
                  <XAxis dataKey="label" {...axisProps(theme)} />
                  <YAxis {...axisProps(theme)} allowDecimals={false} width={48} />
                  <Tooltip
                    cursor={{ fill: theme.cursor }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const point = payload[0].payload as YearPoint
                      return (
                        <ChartTooltipBox
                          title={point.label}
                          rows={[
                            ...series.map((item) => ({ label: item.label, value: String(point[item.key]), color: item.color })),
                            { label: 'Conversão', value: point.total > 0 ? percent(point.fechado / point.total) : '0%' },
                          ]}
                        />
                      )
                    }}
                  />
                  {series.map((item, index) => (
                    <Bar
                      key={item.key}
                      dataKey={item.key}
                      name={item.label}
                      stackId="ano"
                      fill={item.color}
                      stroke={theme.surface}
                      strokeWidth={2}
                      radius={index === series.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                      maxBarSize={48}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <table className="mt-3 w-full text-left text-xs">
              <thead className="text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-1 font-semibold">Ano</th>
                  <th className="py-1 text-right font-semibold">Propostas</th>
                  <th className="py-1 text-right font-semibold">Fechadas</th>
                  <th className="py-1 text-right font-semibold">Conversão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 tabular-nums text-slate-700 dark:divide-slate-800 dark:text-slate-200">
                {data.map((point) => (
                  <tr key={point.key}>
                    <td className="py-1">{point.label}</td>
                    <td className="py-1 text-right">{point.total}</td>
                    <td className="py-1 text-right">{point.fechado}</td>
                    <td className="py-1 text-right font-semibold">{point.total > 0 ? percent(point.fechado / point.total) : '0%'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Block>

      <Block title="Motivos de perda deste cliente">
        {reasons.length === 0 ? (
          <Empty message="Nenhuma proposta perdida." />
        ) : (
          <ul className="space-y-2">
            {reasons.map(([reason, count]) => (
              <li key={reason}>
                <div className="flex justify-between gap-3 text-sm">
                  <span className="text-slate-700 dark:text-slate-200">{reason}</span>
                  <span className="font-semibold tabular-nums text-slate-900 dark:text-white">{count}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
                  <div className="h-full rounded-full" style={{ width: `${(count / reasons[0][1]) * 100}%`, backgroundColor: theme.loss }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  )
}

// =============================================================================
// Painel lateral
// =============================================================================

type ClientMetricsPanelProps = {
  clientName: string
  leads: Lead[]
  open: boolean
  view: ClientMetricsView
  onChangeView: (view: ClientMetricsView) => void
  onClose: () => void
}

/** Métricas do cliente em gráficos: receita, negociação e conversão. */
export default function ClientMetricsPanel({ clientName, leads, open, view, onChangeView, onClose }: ClientMetricsPanelProps) {
  const { isDark } = useTheme()
  const theme = CHART_THEMES[isDark ? 'dark' : 'light']

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  return createPortal(
    <div className={cn('fixed inset-0 z-50', open ? 'pointer-events-auto' : 'pointer-events-none')} aria-hidden={!open} inert={!open}>
      <div
        onClick={onClose}
        className={cn('absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300', open ? 'opacity-100' : 'opacity-0')}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="client-metrics-title"
        className={cn(
          'absolute inset-y-0 right-0 flex w-full max-w-3xl flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform duration-300 ease-out dark:border-slate-800 dark:bg-slate-900',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="space-y-3 border-b border-slate-200 px-5 py-4 sm:px-6 dark:border-slate-800">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="client-metrics-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                Métricas do cliente
              </h2>
              <p className="truncate text-sm text-slate-500 dark:text-slate-400">{clientName}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div role="tablist" aria-label="Métrica" className="inline-flex flex-wrap gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-800">
            {VIEWS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                onClick={() => onChangeView(value)}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  view === value
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {open && view === 'revenue' && <RevenueView leads={leads} theme={theme} />}
          {open && view === 'pipeline' && <PipelineView leads={leads} theme={theme} />}
          {open && view === 'conversion' && <ConversionView leads={leads} theme={theme} />}
        </div>
      </aside>
    </div>,
    document.body,
  )
}
