import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useOutletContext } from 'react-router-dom'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  CalendarRange,
  CircleAlert,
  ClipboardCheck,
  Download,
  LoaderCircle,
  Mail,
  MailCheck,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import PageHeader from '../components/PageHeader'
import CampaignFormModal from '../components/CampaignFormModal'
import ExportPreviewModal, { type ExportPreviewData } from '../components/ExportPreviewModal'
import WhatsAppButton from '../components/WhatsAppButton'
import type { LayoutOutletContext } from '../components/Layout'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import { useConfirm } from '../hooks/useConfirm'
import { CHART_THEMES } from '../lib/chartTheme'
import { PERIOD_PRESET_LABELS, formatRangeLabel, getPresetRange, rangeToTimestampBounds, type DateRange, type PeriodPreset } from '../lib/dashboard'
import { formatDateBR } from '../lib/format'
import { formatLeadEventPeriod } from '../lib/leadFields'
import { fetchMarketingSuppressions } from '../lib/leadQuery'
import {
  buildCampaignAudience,
  buildContactBase,
  campaignDate,
  computeBaseHealth,
  computeEmailFunnel,
  computeSurveyStats,
  computeWhatsAppStats,
  formatRate,
  hasValidEmail,
  hasValidWhatsApp,
  previewFromContacts,
  rate,
  surveyEvents,
  timestampInRange,
  type SuppressionRow,
} from '../lib/mailingHub'
import { RateLimitError, guardMutation, isAbortError } from '../lib/rateLimit'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import {
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_SEGMENT_LABELS,
  CAMPAIGN_STATUS_LABELS,
  SURVEY_SCORES,
  SURVEY_STATUSES,
  SURVEY_STATUS_LABELS,
  type CampaignChannel,
  type CampaignSegment,
  type CommunicationLog,
  type Lead,
  type MailingCampaign,
  type OperationalStatus,
  type SurveyStatus,
} from '../types/lead'

// =============================================================================
// Dados
// =============================================================================

type HubData = {
  leads: Lead[]
  campaigns: MailingCampaign[]
  logs: CommunicationLog[]
  suppressions: SuppressionRow[]
  /** A lista de opt-out não carregou: nada de público nem exportação (LGPD). */
  suppressionsFailed: boolean
}

const PAGE = 1000

async function fetchAllLeads(signal: AbortSignal): Promise<Lead[]> {
  const rows: Lead[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)
      .abortSignal(signal)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

async function fetchLogs(range: DateRange, signal: AbortSignal): Promise<CommunicationLog[]> {
  const bounds = rangeToTimestampBounds(range)
  const rows: CommunicationLog[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('communication_logs')
      .select('*')
      .gte('created_at', bounds.gte)
      .lt('created_at', bounds.lt)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE - 1)
      .abortSignal(signal)
    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return rows
}

async function loadHub(range: DateRange, signal: AbortSignal): Promise<HubData> {
  const [leads, campaigns, logs, suppressions] = await Promise.all([
    fetchAllLeads(signal),
    supabase.from('mailing_campaigns').select('*').order('created_at', { ascending: false }).abortSignal(signal),
    fetchLogs(range, signal),
    fetchMarketingSuppressions().then(
      (rows) => ({ rows, failed: false }),
      () => ({ rows: [] as SuppressionRow[], failed: true }),
    ),
  ])
  if (campaigns.error) throw campaigns.error
  return { leads, campaigns: campaigns.data ?? [], logs, suppressions: suppressions.rows, suppressionsFailed: suppressions.failed }
}

function loadErrorMessage(error: unknown): string {
  const code = (error as { code?: string } | null)?.code
  if (code === '42P01' || code === 'PGRST205' || code === '42703') {
    return 'O banco está desatualizado para esta página. Rode a migração 017 no SQL Editor do Supabase.'
  }
  return 'Não foi possível carregar Mailing & Pesquisas. Verifique a conexão e tente novamente.'
}

// =============================================================================
// Componentes de apoio
// =============================================================================

type Option<T extends string> = { value: T; label: string }

function Segmented<T extends string>({ options, value, onChange, ariaLabel }: { options: Option<T>[]; value: T; onChange: (value: T) => void; ariaLabel: string }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex flex-wrap rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900">
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

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-slate-100 dark:bg-slate-800', className)} />
}

/** Barra do funil: a largura é a fração do primeiro estágio. */
function FunnelRow({ label, value, base, color, detail }: { label: string; value: number; base: number; color: string; detail?: string }) {
  const width = base > 0 ? Math.max((value / base) * 100, value > 0 ? 3 : 0) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium text-slate-600 dark:text-slate-300">{label}</span>
        <span className="tabular-nums text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-900 dark:text-white">{value.toLocaleString('pt-BR')}</span>
          {detail && <span className="ml-1">({detail})</span>}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function SuperCard({
  title,
  icon: Icon,
  value,
  caption,
  loading,
  children,
}: {
  title: string
  icon: LucideIcon
  value: string
  caption: string
  loading: boolean
  children?: ReactNode
}) {
  return (
    <section className="relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <span className="absolute inset-x-0 top-0 h-1 bg-brand-600" aria-hidden="true" />
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium text-slate-500 dark:text-slate-400">{title}</h2>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{caption}</p>
          {children && <div className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800">{children}</div>}
        </>
      )}
    </section>
  )
}

function StatPill({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warning' | 'success' }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2',
        tone === 'warning'
          ? 'border-amber-200 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30'
          : tone === 'success'
            ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30'
            : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40',
      )}
    >
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums text-slate-900 dark:text-white">{value}</p>
    </div>
  )
}

function EmptyState({ icon: Icon, title, description }: { icon: LucideIcon; title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 px-6 py-12 text-center dark:border-slate-800">
      <Icon className="h-8 w-8 text-slate-300 dark:text-slate-600" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
      <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>
    </div>
  )
}

const selectClassName =
  'rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white'

const thClassName = 'px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'
const tdClassName = 'px-3 py-2.5 align-middle text-sm text-slate-700 dark:text-slate-200'

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-slate-400">—</span>
  const tone = score >= 9 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : score >= 7 ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
  return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-bold tabular-nums', tone)}>{score}</span>
}

// =============================================================================
// Aba A: campanhas e métricas de e-mail
// =============================================================================

type ChartMode = 'campaign' | 'month'

function CampaignsTab({
  campaigns,
  isDark,
  isAdmin,
  onNew,
  onEdit,
  onDelete,
}: {
  campaigns: MailingCampaign[]
  isDark: boolean
  isAdmin: boolean
  onNew: () => void
  onEdit: (campaign: MailingCampaign) => void
  onDelete: (campaign: MailingCampaign) => void
}) {
  const theme = CHART_THEMES[isDark ? 'dark' : 'light']
  const [mode, setMode] = useState<ChartMode>('campaign')

  const chartData = useMemo(() => {
    const sent = campaigns.filter((campaign) => campaign.sent_count > 0).sort((a, b) => campaignDate(a).localeCompare(campaignDate(b)))
    if (mode === 'campaign') {
      return sent.map((campaign) => ({
        label: campaign.name.length > 22 ? `${campaign.name.slice(0, 21)}…` : campaign.name,
        title: campaign.name,
        sent: campaign.sent_count,
        delivered: campaign.delivered_count,
        opened: campaign.opened_count,
        deliveryRate: rate(campaign.delivered_count, campaign.sent_count),
        openRate: rate(campaign.opened_count, campaign.delivered_count),
      }))
    }
    const months = new Map<string, { sent: number; delivered: number; opened: number }>()
    for (const campaign of sent) {
      const month = campaignDate(campaign).slice(0, 7)
      const entry = months.get(month) ?? { sent: 0, delivered: 0, opened: 0 }
      entry.sent += campaign.sent_count
      entry.delivered += campaign.delivered_count
      entry.opened += campaign.opened_count
      months.set(month, entry)
    }
    return [...months.entries()].map(([month, entry]) => {
      const [year, monthNumber] = month.split('-').map(Number)
      const title = new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      return {
        label: new Date(year, monthNumber - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }),
        title: title.charAt(0).toUpperCase() + title.slice(1),
        ...entry,
        deliveryRate: rate(entry.delivered, entry.sent),
        openRate: rate(entry.opened, entry.delivered),
      }
    })
  }, [campaigns, mode])

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Enviados x Entregues x Abertos</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Linhas: taxa de entrega e taxa de abertura (eixo da direita).</p>
          </div>
          <Segmented<ChartMode>
            ariaLabel="Agrupar o gráfico"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'campaign', label: 'Por campanha' },
              { value: 'month', label: 'Por mês' },
            ]}
          />
        </div>
        {chartData.length === 0 ? (
          <EmptyState icon={MailCheck} title="Nenhuma campanha enviada no período" description="Registre os números de envio de uma campanha para ver o funil aqui." />
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
                <XAxis dataKey="label" tick={{ fill: theme.axis, fontSize: 12 }} tickLine={false} axisLine={{ stroke: theme.grid }} interval={0} />
                <YAxis yAxisId="count" tick={{ fill: theme.axis, fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
                <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={{ fill: theme.axis, fontSize: 12 }} tickLine={false} axisLine={false} unit="%" width={44} />
                <Tooltip
                  cursor={{ fill: theme.cursor }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const point = payload[0].payload as (typeof chartData)[number]
                    return (
                      <div className="min-w-52 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-lg dark:border-slate-700 dark:bg-slate-900">
                        <p className="mb-1.5 font-semibold text-slate-900 dark:text-white">{point.title}</p>
                        <ul className="space-y-1 tabular-nums text-slate-600 dark:text-slate-300">
                          <li className="flex justify-between gap-4"><span>Enviados</span><span className="font-semibold text-slate-900 dark:text-white">{point.sent.toLocaleString('pt-BR')}</span></li>
                          <li className="flex justify-between gap-4"><span>Entregues</span><span className="font-semibold text-slate-900 dark:text-white">{point.delivered.toLocaleString('pt-BR')} ({formatRate(point.delivered, point.sent)})</span></li>
                          <li className="flex justify-between gap-4"><span>Abertos</span><span className="font-semibold text-slate-900 dark:text-white">{point.opened.toLocaleString('pt-BR')} ({formatRate(point.opened, point.delivered)})</span></li>
                        </ul>
                      </div>
                    )
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="count" dataKey="sent" name="Enviados" fill={theme.series[0]} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="count" dataKey="delivered" name="Entregues" fill={theme.series[2]} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="count" dataKey="opened" name="Abertos" fill={theme.series[3]} radius={[4, 4, 0, 0]} />
                <Line yAxisId="rate" type="monotone" dataKey="deliveryRate" name="Taxa de entrega %" stroke={theme.series[6]} strokeWidth={2} dot={{ r: 3 }} />
                <Line yAxisId="rate" type="monotone" dataKey="openRate" name="Taxa de abertura %" stroke={theme.series[1]} strokeWidth={2} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Campanhas</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Taxas: entrega = entregues/enviados · abertura = abertos/entregues · conversão = cliques/abertos.</p>
          </div>
          <button
            type="button"
            onClick={onNew}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nova campanha de mailing
          </button>
        </div>
        {campaigns.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={Mail} title="Nenhuma campanha no período" description="Crie uma campanha para calcular o público elegível, exportar a lista e acompanhar os retornos." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-950/40">
                <tr>
                  <th className={thClassName}>Campanha</th>
                  <th className={thClassName}>Segmento</th>
                  <th className={thClassName}>Situação</th>
                  <th className={cn(thClassName, 'text-right')}>Público</th>
                  <th className={cn(thClassName, 'text-right')}>Enviados</th>
                  <th className={cn(thClassName, 'text-right')}>Entregues</th>
                  <th className={cn(thClassName, 'text-right')}>Abertos</th>
                  <th className={cn(thClassName, 'text-right')}>Cliques</th>
                  <th className={cn(thClassName, 'text-right')}>Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {campaigns.map((campaign) => (
                  <tr key={campaign.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className={tdClassName}>
                      <p className="font-semibold text-slate-900 dark:text-white">{campaign.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {CAMPAIGN_CHANNEL_LABELS[campaign.channel]} · {campaign.sent_at ? `Enviada em ${formatDateBR(campaign.sent_at.slice(0, 10))}` : `Criada em ${formatDateBR(campaign.created_at.slice(0, 10))}`}
                      </p>
                    </td>
                    <td className={tdClassName}>{CAMPAIGN_SEGMENT_LABELS[campaign.segment_filter]}</td>
                    <td className={tdClassName}>
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
                          campaign.status === 'concluida'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                            : campaign.status === 'enviada'
                              ? 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300'
                              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
                        )}
                      >
                        {CAMPAIGN_STATUS_LABELS[campaign.status]}
                      </span>
                    </td>
                    <td className={cn(tdClassName, 'text-right tabular-nums')}>{campaign.audience_count.toLocaleString('pt-BR')}</td>
                    <td className={cn(tdClassName, 'text-right tabular-nums')}>{campaign.sent_count.toLocaleString('pt-BR')}</td>
                    <td className={cn(tdClassName, 'text-right tabular-nums')}>
                      {campaign.delivered_count.toLocaleString('pt-BR')}
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{formatRate(campaign.delivered_count, campaign.sent_count)}</span>
                    </td>
                    <td className={cn(tdClassName, 'text-right tabular-nums')}>
                      {campaign.opened_count.toLocaleString('pt-BR')}
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{formatRate(campaign.opened_count, campaign.delivered_count)}</span>
                    </td>
                    <td className={cn(tdClassName, 'text-right tabular-nums')}>
                      {campaign.clicked_count.toLocaleString('pt-BR')}
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{formatRate(campaign.clicked_count, campaign.opened_count)}</span>
                    </td>
                    <td className={cn(tdClassName, 'text-right')}>
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          onClick={() => onEdit(campaign)}
                          title="Atualizar números"
                          aria-label={`Atualizar números de ${campaign.name}`}
                          className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-brand-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-brand-300"
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => onDelete(campaign)}
                            title="Excluir campanha"
                            aria-label={`Excluir ${campaign.name}`}
                            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// =============================================================================
// Aba B: pesquisas de satisfação pós-evento
// =============================================================================

type SurveyFilter = 'all' | 'pending' | 'waiting' | 'answered'
type SurveyScope = 'realizado' | 'realizado_confirmado'

const SURVEY_FILTERS: Option<SurveyFilter>[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendentes de envio' },
  { value: 'waiting', label: 'Aguardando resposta' },
  { value: 'answered', label: 'Respondidas' },
]

function matchesSurveyFilter(lead: Lead, filter: SurveyFilter): boolean {
  if (filter === 'pending') return lead.survey_status === 'nao_enviada'
  if (filter === 'waiting') return lead.survey_status === 'enviada'
  if (filter === 'answered') return lead.survey_status === 'respondida'
  return true
}

function SurveysTab({
  leads,
  range,
  onUpdate,
  busyId,
}: {
  leads: Lead[]
  range: DateRange
  onUpdate: (lead: Lead, patch: { survey_status?: SurveyStatus; survey_score?: number | null }) => void
  busyId: string | null
}) {
  const [scope, setScope] = useState<SurveyScope>('realizado')
  const [filter, setFilter] = useState<SurveyFilter>('all')
  const events = useMemo(() => {
    const statuses: OperationalStatus[] = scope === 'realizado' ? ['realizado'] : ['realizado', 'confirmado']
    return surveyEvents(leads, range, statuses)
  }, [leads, range, scope])
  const stats = computeSurveyStats(events)
  const rows = events.filter((lead) => matchesSurveyFilter(lead, filter))

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatPill label="Eventos no período" value={stats.events.toLocaleString('pt-BR')} />
        <StatPill label="Pesquisas enviadas" value={`${stats.sent.toLocaleString('pt-BR')} (${formatRate(stats.sent, stats.events)})`} />
        <StatPill label="Respondidas (taxa de resposta)" value={`${stats.answered.toLocaleString('pt-BR')} (${formatRate(stats.answered, stats.sent)})`} tone="success" />
        <StatPill
          label={`Score médio (${stats.scored} nota${stats.scored === 1 ? '' : 's'})`}
          value={stats.averageScore === null ? '—' : stats.averageScore.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
          tone={stats.averageScore !== null && stats.averageScore < 7 ? 'warning' : 'default'}
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <Segmented<SurveyFilter> ariaLabel="Filtrar pesquisas" value={filter} onChange={setFilter} options={SURVEY_FILTERS} />
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            Eventos
            <select value={scope} onChange={(event) => setScope(event.target.value as SurveyScope)} className={selectClassName}>
              <option value="realizado">Realizados</option>
              <option value="realizado_confirmado">Realizados e confirmados</option>
            </select>
          </label>
        </div>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={ClipboardCheck} title="Nenhum evento neste filtro" description="Os eventos realizados no período aparecem aqui para o envio da pesquisa de satisfação." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
              <thead className="bg-slate-50 dark:bg-slate-950/40">
                <tr>
                  <th className={thClassName}>Evento</th>
                  <th className={thClassName}>Data</th>
                  <th className={thClassName}>Pesquisa</th>
                  <th className={thClassName}>Nota</th>
                  <th className={thClassName}>Enviada / respondida</th>
                  <th className={cn(thClassName, 'text-right')}>Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((lead) => {
                  const busy = busyId === lead.id
                  return (
                    <tr key={lead.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className={tdClassName}>
                        <p className="font-semibold text-slate-900 dark:text-white">{lead.event_name || lead.company || lead.contact_name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">{[lead.contact_name, lead.company].filter(Boolean).join(' · ')}</p>
                      </td>
                      <td className={cn(tdClassName, 'whitespace-nowrap')}>{formatLeadEventPeriod(lead) ?? '—'}</td>
                      <td className={tdClassName}>
                        <select
                          aria-label={`Situação da pesquisa de ${lead.contact_name}`}
                          value={lead.survey_status}
                          disabled={busy}
                          onChange={(event) => {
                            const next = event.target.value as SurveyStatus
                            onUpdate(lead, next === 'respondida' ? { survey_status: next } : { survey_status: next, survey_score: null })
                          }}
                          className={selectClassName}
                        >
                          {SURVEY_STATUSES.map((value) => (
                            <option key={value} value={value}>
                              {SURVEY_STATUS_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={tdClassName}>
                        {lead.survey_status === 'respondida' ? (
                          <select
                            aria-label={`Nota de ${lead.contact_name}`}
                            value={lead.survey_score ?? ''}
                            disabled={busy}
                            onChange={(event) => onUpdate(lead, { survey_score: event.target.value ? Number(event.target.value) : null })}
                            className={selectClassName}
                          >
                            <option value="">—</option>
                            {SURVEY_SCORES.map((score) => (
                              <option key={score} value={score}>
                                {score}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <ScoreBadge score={null} />
                        )}
                      </td>
                      <td className={cn(tdClassName, 'whitespace-nowrap text-xs text-slate-500 dark:text-slate-400')}>
                        {lead.survey_sent_at ? formatDateBR(lead.survey_sent_at.slice(0, 10)) : '—'}
                        {lead.survey_responded_at && ` · ${formatDateBR(lead.survey_responded_at.slice(0, 10))}`}
                      </td>
                      <td className={cn(tdClassName, 'text-right')}>
                        <div className="inline-flex items-center gap-2">
                          {busy && <LoaderCircle className="h-4 w-4 animate-spin text-brand-600" aria-hidden="true" />}
                          <WhatsAppButton
                            lead={lead}
                            purpose="survey"
                            label={lead.survey_status === 'nao_enviada' ? 'Enviar pesquisa' : 'Reenviar'}
                            onSent={() => {
                              if (lead.survey_status === 'nao_enviada') onUpdate(lead, { survey_status: 'enviada' })
                            }}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

// =============================================================================
// Aba C: base de contatos e audiência
// =============================================================================

type LgpdFilter = 'all' | 'eligible' | 'opted_out'
type ReachFilter = 'all' | 'email' | 'whatsapp'
const AUDIENCE_PAGE = 50

function AudienceTab({
  leads,
  suppressions,
  suppressionsFailed,
  onExport,
}: {
  leads: Lead[]
  suppressions: SuppressionRow[]
  suppressionsFailed: boolean
  onExport: (preview: ExportPreviewData) => void
}) {
  const [search, setSearch] = useState('')
  const [lgpd, setLgpd] = useState<LgpdFilter>('eligible')
  const [reach, setReach] = useState<ReachFilter>('all')
  const [closed, setClosed] = useState<'all' | 'yes' | 'no'>('all')
  const [page, setPage] = useState(0)

  const base = useMemo(() => buildContactBase(leads, suppressions), [leads, suppressions])
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return base.filter((contact) => {
      if (lgpd === 'eligible' && contact.optedOut) return false
      if (lgpd === 'opted_out' && !contact.optedOut) return false
      if (reach === 'email' && !hasValidEmail(contact)) return false
      if (reach === 'whatsapp' && !hasValidWhatsApp(contact)) return false
      if (closed === 'yes' && !contact.everClosed) return false
      if (closed === 'no' && contact.everClosed) return false
      if (!term) return true
      return [contact.name, contact.company, contact.email, contact.phone, contact.rooms].some((value) => value.toLowerCase().includes(term))
    })
  }, [base, search, lgpd, reach, closed])

  const pageCount = Math.max(1, Math.ceil(filtered.length / AUDIENCE_PAGE))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(currentPage * AUDIENCE_PAGE, (currentPage + 1) * AUDIENCE_PAGE)
  const exportable = filtered.filter((contact) => !contact.optedOut).length

  const resetPage = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value)
    setPage(0)
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="space-y-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Mailing vivo</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Contatos únicos da base inteira (orçamentos do mesmo e-mail ou telefone viram uma linha). Opt-out LGPD nunca é exportado.
            </p>
          </div>
          <button
            type="button"
            disabled={suppressionsFailed || exportable === 0}
            onClick={() =>
              onExport({
                kind: 'csv',
                leads,
                filters: ['Base de contatos (Mailing & Pesquisas)', search.trim() ? `Busca: ${search.trim()}` : ''].filter(Boolean),
                mailing: previewFromContacts(filtered),
              })
            }
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Exportar mailing (.csv)
          </button>
        </div>
        {suppressionsFailed && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            A lista de opt-out (LGPD) não carregou: a exportação fica bloqueada até recarregar a página.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              value={search}
              onChange={(event) => resetPage(setSearch)(event.target.value)}
              placeholder="Buscar por nome, empresa, e-mail, telefone ou sala"
              aria-label="Buscar contatos"
              className="block w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>
          <select aria-label="LGPD" value={lgpd} onChange={(event) => resetPage(setLgpd)(event.target.value as LgpdFilter)} className={selectClassName}>
            <option value="eligible">Elegíveis</option>
            <option value="opted_out">Opt-out LGPD</option>
            <option value="all">Todos</option>
          </select>
          <select aria-label="Canal" value={reach} onChange={(event) => resetPage(setReach)(event.target.value as ReachFilter)} className={selectClassName}>
            <option value="all">Qualquer canal</option>
            <option value="email">Com e-mail válido</option>
            <option value="whatsapp">Com WhatsApp válido</option>
          </select>
          <select aria-label="Já fechou evento" value={closed} onChange={(event) => resetPage(setClosed)(event.target.value as 'all' | 'yes' | 'no')} className={selectClassName}>
            <option value="all">Fechou ou não</option>
            <option value="yes">Já fechou evento</option>
            <option value="no">Nunca fechou</option>
          </select>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {filtered.length.toLocaleString('pt-BR')} contato(s) neste filtro · {exportable.toLocaleString('pt-BR')} exportável(is)
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={Search} title="Nenhum contato encontrado" description="Ajuste a busca ou os filtros." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800">
            <thead className="bg-slate-50 dark:bg-slate-950/40">
              <tr>
                <th className={thClassName}>Nome</th>
                <th className={thClassName}>Empresa</th>
                <th className={thClassName}>E-mail</th>
                <th className={thClassName}>WhatsApp</th>
                <th className={thClassName}>Salas de interesse</th>
                <th className={cn(thClassName, 'text-right')}>Solicitações</th>
                <th className={thClassName}>Já fechou?</th>
                <th className={thClassName}>LGPD</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visible.map((contact) => (
                <tr key={`${contact.name}-${contact.email}-${contact.phone}-${contact.latestAt}`} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className={cn(tdClassName, 'font-semibold text-slate-900 dark:text-white')}>{contact.name}</td>
                  <td className={tdClassName}>{contact.company || <span className="text-slate-400">Pessoa física</span>}</td>
                  <td className={cn(tdClassName, 'max-w-56 truncate')} title={contact.email}>
                    {contact.email || <span className="text-slate-400">—</span>}
                  </td>
                  <td className={cn(tdClassName, 'whitespace-nowrap')}>
                    {contact.phone ? (
                      <span className={hasValidWhatsApp(contact) ? '' : 'text-slate-400'}>{contact.phone}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className={cn(tdClassName, 'max-w-60 truncate')} title={contact.rooms}>
                    {contact.rooms || <span className="text-slate-400">—</span>}
                  </td>
                  <td className={cn(tdClassName, 'text-right tabular-nums')}>{contact.requests}</td>
                  <td className={tdClassName}>{contact.everClosed ? 'Sim' : 'Não'}</td>
                  <td className={tdClassName}>
                    {contact.optedOut ? (
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">Opt-out</span>
                    ) : (
                      <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">Elegível</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 text-sm dark:border-slate-800">
          <span className="text-slate-500 dark:text-slate-400">
            Página {currentPage + 1} de {pageCount}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => setPage(currentPage - 1)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Anterior
            </button>
            <button
              type="button"
              disabled={currentPage >= pageCount - 1}
              onClick={() => setPage(currentPage + 1)}
              className="rounded-lg border border-slate-200 px-3 py-1.5 font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

// =============================================================================
// Página
// =============================================================================

type Tab = 'campaigns' | 'surveys' | 'audience'

const TABS: Array<{ value: Tab; label: string; icon: LucideIcon }> = [
  { value: 'campaigns', label: 'Campanhas & Métricas de E-mail', icon: Mail },
  { value: 'surveys', label: 'Pesquisas de Satisfação', icon: Star },
  { value: 'audience', label: 'Base de Contatos & Audiência', icon: ShieldCheck },
]

const PERIOD_OPTIONS: Option<PeriodPreset>[] = (['this_month', 'last_30_days', 'this_year', 'custom'] as const).map((value) => ({
  value,
  label: PERIOD_PRESET_LABELS[value],
}))

const dateInputClassName =
  'rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white'

type LoadResult = { key: string; data: HubData | null; error: string | null }
type Feedback = { type: 'success' | 'error'; message: string }

export default function MailingHub() {
  const { leadsVersion } = useOutletContext<LayoutOutletContext>()
  const { isAdmin } = useAuth()
  const { isDark } = useTheme()
  const confirm = useConfirm()

  const [preset, setPreset] = useState<PeriodPreset>('this_year')
  const [customRange, setCustomRange] = useState<DateRange>(() => getPresetRange('last_30_days'))
  const customInvalid = preset === 'custom' && (!customRange.from || !customRange.to || customRange.from > customRange.to)
  const range = useMemo(() => (preset === 'custom' ? customRange : getPresetRange(preset)), [preset, customRange])
  const [tab, setTab] = useState<Tab>('campaigns')
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<LoadResult | null>(null)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [campaignModal, setCampaignModal] = useState<{ campaign: MailingCampaign | null } | null>(null)
  const [exportPreview, setExportPreview] = useState<ExportPreviewData | null>(null)
  const [exporting, setExporting] = useState(false)
  const [busySurveyId, setBusySurveyId] = useState<string | null>(null)

  const rangeFrom = range.from
  const rangeTo = range.to
  const key = `${rangeFrom}|${rangeTo}|${leadsVersion}|${retry}`

  useEffect(() => {
    if (customInvalid) return
    let isActive = true
    const controller = new AbortController()
    const requestKey = `${rangeFrom}|${rangeTo}|${leadsVersion}|${retry}`
    loadHub({ from: rangeFrom, to: rangeTo }, controller.signal)
      .then((data) => {
        if (isActive) setResult({ key: requestKey, data, error: null })
      })
      .catch((error: unknown) => {
        if (isActive && !isAbortError(error)) setResult({ key: requestKey, data: null, error: loadErrorMessage(error) })
      })
    return () => {
      isActive = false
      controller.abort()
    }
  }, [rangeFrom, rangeTo, leadsVersion, retry, customInvalid])

  const loading = !customInvalid && result?.key !== key
  const data = result?.key === key ? result.data : result?.data ?? null

  const patchData = useCallback((update: (current: HubData) => HubData) => {
    setResult((current) => (current?.data ? { ...current, data: update(current.data) } : current))
  }, [])

  const periodCampaigns = useMemo(() => (data ? data.campaigns.filter((campaign) => timestampInRange(campaignDate(campaign), range)) : []), [data, range])
  const emailCampaigns = periodCampaigns.filter((campaign) => campaign.channel !== 'whatsapp')
  const funnel = computeEmailFunnel(emailCampaigns)
  const surveyStats = useMemo(() => computeSurveyStats(data ? surveyEvents(data.leads, range, ['realizado']) : []), [data, range])
  const whatsapp = computeWhatsAppStats(data?.logs ?? [])
  const contactBase = useMemo(() => (data ? buildContactBase(data.leads, data.suppressions) : []), [data])
  const health = computeBaseHealth(contactBase, data?.suppressions ?? [])
  const theme = CHART_THEMES[isDark ? 'dark' : 'light']

  const openCampaignExport = (segment: CampaignSegment, channel: CampaignChannel, name: string) => {
    if (!data || data.suppressionsFailed) return
    const mailing = buildCampaignAudience(data.leads, data.suppressions, segment, channel)
    setExportPreview({
      kind: 'csv',
      leads: data.leads,
      filters: [`Campanha: ${name}`, `Segmento: ${CAMPAIGN_SEGMENT_LABELS[segment]}`, `Canal: ${CAMPAIGN_CHANNEL_LABELS[channel]}`],
      mailing,
    })
  }

  const confirmExport = async () => {
    if (!exportPreview || exportPreview.kind !== 'csv') return
    setExporting(true)
    try {
      const exporters = await import('../lib/exporters')
      const summary = exporters.exportMailingToCsv(exportPreview.mailing)
      setFeedback({ type: 'success', message: `Mailing gerado com ${summary.contacts} contato(s) único(s); opt-out LGPD fica de fora.` })
      setExportPreview(null)
    } catch {
      setFeedback({ type: 'error', message: 'Não foi possível gerar o arquivo. Tente novamente.' })
    } finally {
      setExporting(false)
    }
  }

  const handleCampaignSaved = (campaign: MailingCampaign) => {
    patchData((current) => ({
      ...current,
      campaigns: [campaign, ...current.campaigns.filter((item) => item.id !== campaign.id)].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    }))
    setFeedback({ type: 'success', message: `Campanha "${campaign.name}" salva.` })
    setCampaignModal(null)
  }

  const deleteCampaign = async (campaign: MailingCampaign) => {
    const ok = await confirm({
      title: 'Excluir campanha?',
      description: `"${campaign.name}" e os números registrados serão apagados. Essa ação é permanente.`,
      confirmLabel: 'Excluir campanha',
      tone: 'danger',
    })
    if (!ok) return
    const { data: removed, error } = await supabase.from('mailing_campaigns').delete().eq('id', campaign.id).select('id')
    if (error || !removed || removed.length === 0) {
      setFeedback({ type: 'error', message: 'A campanha não foi excluída: ela já não existe ou apenas o ADMIN pode excluir.' })
      return
    }
    patchData((current) => ({ ...current, campaigns: current.campaigns.filter((item) => item.id !== campaign.id) }))
    setFeedback({ type: 'success', message: 'Campanha excluída.' })
  }

  const updateSurvey = async (lead: Lead, patch: { survey_status?: SurveyStatus; survey_score?: number | null }) => {
    setBusySurveyId(lead.id)
    try {
      const { data: updated, error } = await guardMutation(`survey:${lead.id}:${JSON.stringify(patch)}`, async () =>
        supabase.from('leads').update(patch).eq('id', lead.id).select('*').single(),
      )
      if (error || !updated) {
        setFeedback({ type: 'error', message: 'Não foi possível atualizar a pesquisa. Tente novamente.' })
        return
      }
      patchData((current) => ({ ...current, leads: current.leads.map((item) => (item.id === updated.id ? updated : item)) }))
    } catch (caught) {
      if (caught instanceof RateLimitError) setFeedback({ type: 'error', message: caught.message })
      else setFeedback({ type: 'error', message: 'Não foi possível atualizar a pesquisa. Tente novamente.' })
    } finally {
      setBusySurveyId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Mailing & Pesquisas"
        description="Campanhas, pesquisa de satisfação pós-evento, mensagens pelo WhatsApp e a saúde da base de contatos (LGPD)."
        actions={
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} aria-hidden="true" />
            Atualizar
          </button>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Segmented options={PERIOD_OPTIONS} value={preset} onChange={setPreset} ariaLabel="Período" />
        {preset === 'custom' && (
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="h-4 w-4 text-slate-400" aria-hidden="true" />
            <input
              type="date"
              aria-label="Data inicial"
              value={customRange.from}
              onChange={(event) => setCustomRange((current) => ({ ...current, from: event.target.value }))}
              className={dateInputClassName}
            />
            <span className="text-sm text-slate-500 dark:text-slate-400">até</span>
            <input
              type="date"
              aria-label="Data final"
              value={customRange.to}
              onChange={(event) => setCustomRange((current) => ({ ...current, to: event.target.value }))}
              className={dateInputClassName}
            />
          </div>
        )}
        <span className="text-sm text-slate-500 dark:text-slate-400">{customInvalid ? 'Informe as duas datas, a inicial antes da final.' : formatRangeLabel(range)}</span>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={cn(
            'mb-6 flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm',
            feedback.type === 'error'
              ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
              : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300',
          )}
        >
          <span>{feedback.message}</span>
          <button type="button" onClick={() => setFeedback(null)} className="text-xs font-semibold underline-offset-2 hover:underline">
            Fechar
          </button>
        </div>
      )}

      {result?.error && result.key === key ? (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <span className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4" aria-hidden="true" />
            {result.error}
          </span>
          <button type="button" onClick={() => setRetry((value) => value + 1)} className="rounded-lg bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700">
            Tentar de novo
          </button>
        </div>
      ) : (
        <>
          <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SuperCard
              title="Performance de e-mail"
              icon={MailCheck}
              loading={loading || !data}
              value={funnel.sent.toLocaleString('pt-BR')}
              caption={`e-mails enviados em ${funnel.campaigns} campanha(s)`}
            >
              <FunnelRow label="Enviados" value={funnel.sent} base={funnel.sent} color={theme.series[0]} />
              <FunnelRow label="Entregues" value={funnel.delivered} base={funnel.sent} color={theme.series[2]} detail={`entrega ${formatRate(funnel.delivered, funnel.sent)}`} />
              <FunnelRow label="Abertos" value={funnel.opened} base={funnel.sent} color={theme.series[3]} detail={`abertura ${formatRate(funnel.opened, funnel.delivered)}`} />
            </SuperCard>

            <SuperCard
              title="Pesquisas de satisfação"
              icon={Star}
              loading={loading || !data}
              value={surveyStats.averageScore === null ? '—' : surveyStats.averageScore.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
              caption={`score médio (1–10) de ${surveyStats.scored} avaliação(ões)`}
            >
              <FunnelRow label="Enviadas" value={surveyStats.sent} base={surveyStats.events} color={theme.series[0]} detail={`de ${surveyStats.events} evento(s) realizados`} />
              <FunnelRow label="Respondidas" value={surveyStats.answered} base={surveyStats.events} color={theme.series[2]} detail={`resposta ${formatRate(surveyStats.answered, surveyStats.sent)}`} />
              <p className={cn('text-xs font-medium', surveyStats.pending > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400')}>
                {surveyStats.pending > 0 ? `${surveyStats.pending} evento(s) realizado(s) sem pesquisa enviada` : 'Nenhum evento realizado pendente de pesquisa'}
              </p>
            </SuperCard>

            <SuperCard
              title="Engajamento via WhatsApp"
              icon={MessageCircle}
              loading={loading || !data}
              value={whatsapp.total.toLocaleString('pt-BR')}
              caption="mensagens iniciadas pelo app no período"
            >
              <FunnelRow label="Follow-up comercial" value={whatsapp.byPurpose.follow_up} base={whatsapp.total} color={theme.series[0]} />
              <FunnelRow label="Pesquisa pós-evento" value={whatsapp.byPurpose.survey} base={whatsapp.total} color={theme.series[2]} />
              <FunnelRow label="Relacionamento / saudação" value={whatsapp.byPurpose.greeting} base={whatsapp.total} color={theme.series[4]} />
            </SuperCard>

            <SuperCard
              title="Saúde da base & LGPD"
              icon={ShieldCheck}
              loading={loading || !data}
              value={data?.suppressionsFailed ? '—' : health.eligible.toLocaleString('pt-BR')}
              caption={data?.suppressionsFailed ? 'lista de opt-out indisponível' : 'contatos únicos elegíveis'}
            >
              <FunnelRow label="Com e-mail válido" value={health.withEmail} base={health.eligible} color={theme.series[0]} detail={formatRate(health.withEmail, health.eligible)} />
              <FunnelRow label="Com WhatsApp válido" value={health.withWhatsApp} base={health.eligible} color={theme.series[2]} detail={formatRate(health.withWhatsApp, health.eligible)} />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <span className="font-semibold text-slate-900 dark:text-white">{health.optedOut.toLocaleString('pt-BR')}</span> contato(s) bloqueado(s) por opt-out LGPD
                {' · '}
                {health.suppressions.toLocaleString('pt-BR')} registro(s) na lista
              </p>
            </SuperCard>
          </div>

          <div role="tablist" aria-label="Seções de Mailing & Pesquisas" className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 dark:border-slate-800">
            {TABS.map(({ value, label, icon: Icon }) => {
              const selected = tab === value
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setTab(value)}
                  className={cn(
                    '-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors',
                    selected
                      ? 'border-brand-600 text-brand-700 dark:text-brand-300'
                      : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </button>
              )
            })}
          </div>

          {!data ? (
            <Skeleton className="h-96 w-full" />
          ) : tab === 'campaigns' ? (
            <CampaignsTab
              campaigns={periodCampaigns}
              isDark={isDark}
              isAdmin={isAdmin}
              onNew={() => setCampaignModal({ campaign: null })}
              onEdit={(campaign) => setCampaignModal({ campaign })}
              onDelete={(campaign) => void deleteCampaign(campaign)}
            />
          ) : tab === 'surveys' ? (
            <SurveysTab leads={data.leads} range={range} onUpdate={(lead, patch) => void updateSurvey(lead, patch)} busyId={busySurveyId} />
          ) : (
            <AudienceTab leads={data.leads} suppressions={data.suppressions} suppressionsFailed={data.suppressionsFailed} onExport={setExportPreview} />
          )}
        </>
      )}

      {campaignModal && data && (
        <CampaignFormModal
          campaign={campaignModal.campaign}
          leads={data.leads}
          suppressions={data.suppressions}
          suppressionsReady={!data.suppressionsFailed}
          onClose={() => setCampaignModal(null)}
          onSaved={handleCampaignSaved}
          onExport={openCampaignExport}
        />
      )}

      {/* Acima do modal da campanha, de onde a exportação também é aberta */}
      <div className="relative z-[80]">
        <ExportPreviewModal preview={exportPreview} busy={exporting} onCancel={() => setExportPreview(null)} onConfirm={() => void confirmExport()} />
      </div>
    </>
  )
}
