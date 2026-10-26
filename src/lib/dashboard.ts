import type { ISODate, Lead } from '../types/lead'
import { getLeadRooms, getLeadValues, type LeadValueBreakdown } from './leadFields'

// =============================================================================
// Período
// =============================================================================

export type PeriodPreset = 'this_month' | 'last_30_days' | 'this_year' | 'custom'

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: 'Este mês',
  last_30_days: 'Últimos 30 dias',
  this_year: 'Este ano',
  custom: 'Personalizado',
}

/** Intervalo inclusivo de datas locais ("YYYY-MM-DD"). */
export type DateRange = { from: ISODate; to: ISODate }

export type Granularity = 'day' | 'month'

/** Date -> "YYYY-MM-DD" no fuso local (sem o deslocamento do toISOString). */
export function toLocalISODate(date: Date): ISODate {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** "YYYY-MM-DD" -> Date à meia-noite local. */
export function parseLocalISODate(value: ISODate): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function getPresetRange(preset: Exclude<PeriodPreset, 'custom'>, today = new Date()): DateRange {
  const to = toLocalISODate(today)
  switch (preset) {
    case 'this_month':
      return { from: toLocalISODate(new Date(today.getFullYear(), today.getMonth(), 1)), to }
    case 'last_30_days':
      return { from: toLocalISODate(addDays(today, -29)), to }
    case 'this_year':
      return { from: toLocalISODate(new Date(today.getFullYear(), 0, 1)), to }
  }
}

/** Limites em UTC para consultar `created_at` (timestamptz): [início do dia `from`, início do dia seguinte a `to`). */
export function rangeToTimestampBounds(range: DateRange): { gte: string; lt: string } {
  return {
    gte: parseLocalISODate(range.from).toISOString(),
    lt: addDays(parseLocalISODate(range.to), 1).toISOString(),
  }
}

/** Quantidade de dias do intervalo, contando só até hoje (para a média diária não ser diluída por dias futuros). */
export function countElapsedDays(range: DateRange, today = new Date()): number {
  const start = parseLocalISODate(range.from)
  const end = parseLocalISODate(range.to)
  const todayStart = parseLocalISODate(toLocalISODate(today))
  const effectiveEnd = end > todayStart ? todayStart : end
  const diff = Math.round((effectiveEnd.getTime() - start.getTime()) / 86_400_000) + 1
  return Math.max(diff, 1)
}

/** Até 45 dias mostra por dia; acima disso, agrupa por mês. */
export function getGranularity(range: DateRange): Granularity {
  const days =
    Math.round((parseLocalISODate(range.to).getTime() - parseLocalISODate(range.from).getTime()) / 86_400_000) + 1
  return days <= 45 ? 'day' : 'month'
}

export function formatRangeLabel(range: DateRange): string {
  const format = (value: ISODate) => parseLocalISODate(value).toLocaleDateString('pt-BR')
  return `${format(range.from)} a ${format(range.to)}`
}

// =============================================================================
// Agregações
// =============================================================================

/** Colunas usadas pelos indicadores (evita trazer o lead inteiro). */
export type DashboardLead = Pick<
  Lead,
  | 'id'
  | 'created_at'
  | 'status'
  | 'proposal_sent'
  | 'proposed_value'
  | 'ab_value'
  | 'lodging_value'
  | 'total_value'
  | 'loss_reason'
  | 'origin'
  | 'room_interest'
  | 'room_interests'
>

export const DASHBOARD_LEAD_COLUMNS =
  'id, created_at, status, proposal_sent, proposed_value, ab_value, lodging_value, total_value, loss_reason, origin, room_interest, room_interests'

/** Lead fechado conta como proposta enviada, mesmo que o toggle não tenha sido marcado. */
export function isProposalSent(lead: Pick<Lead, 'proposal_sent' | 'status'>): boolean {
  return lead.proposal_sent || lead.status === 'fechado'
}

export type DashboardKpis = {
  total: number
  dailyAverage: number
  proposalsSent: number
  inquiriesOnly: number
  closed: number
  lost: number
  open: number
  /** Fechados / total (0–1). */
  conversionRate: number
  /** Fechados / propostas enviadas (0–1). */
  proposalConversionRate: number
  /** Perdidos / total (0–1). */
  lossRate: number
  /** Receita total fechada (locação + A&B + hospedagem). */
  closedValue: number
  /** Composição do que foi fechado. */
  closedBreakdown: LeadValueBreakdown
  /** Composição do que ainda está em aberto (pipeline). */
  openBreakdown: LeadValueBreakdown
}

const emptyBreakdown = (): LeadValueBreakdown => ({ rental: 0, ab: 0, lodging: 0, total: 0 })

function addBreakdown(target: LeadValueBreakdown, values: LeadValueBreakdown) {
  target.rental += values.rental
  target.ab += values.ab
  target.lodging += values.lodging
  target.total += values.total
}

const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 0)

export function computeKpis(leads: DashboardLead[], range: DateRange): DashboardKpis {
  let proposalsSent = 0
  let closed = 0
  let lost = 0
  const closedBreakdown = emptyBreakdown()
  const openBreakdown = emptyBreakdown()

  for (const lead of leads) {
    if (isProposalSent(lead)) proposalsSent += 1
    if (lead.status === 'fechado') {
      closed += 1
      addBreakdown(closedBreakdown, getLeadValues(lead))
    } else if (lead.status === 'perdido') {
      lost += 1
    } else {
      addBreakdown(openBreakdown, getLeadValues(lead))
    }
  }

  const total = leads.length

  return {
    total,
    dailyAverage: total / countElapsedDays(range),
    proposalsSent,
    inquiriesOnly: total - proposalsSent,
    closed,
    lost,
    open: total - closed - lost,
    conversionRate: ratio(closed, total),
    proposalConversionRate: ratio(closed, proposalsSent),
    lossRate: ratio(lost, total),
    closedValue: closedBreakdown.total,
    closedBreakdown,
    openBreakdown,
  }
}

export type TrendPoint = {
  /** Chave do balde: "YYYY-MM-DD" (dia) ou "YYYY-MM" (mês). */
  key: string
  /** Rótulo curto do eixo X. */
  label: string
  /** Rótulo completo para o tooltip. */
  fullLabel: string
  received: number
  proposals: number
  closed: number
}

const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MONTHS_LONG = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
]

/**
 * Série temporal por data de entrada do lead: quantos chegaram em cada dia/mês,
 * quantos desses viraram proposta e quantos fecharam. Baldes vazios aparecem com zero.
 */
export function computeTrend(leads: DashboardLead[], range: DateRange, granularity: Granularity): TrendPoint[] {
  const buckets = new Map<string, TrendPoint>()
  const start = parseLocalISODate(range.from)
  const end = parseLocalISODate(range.to)

  if (granularity === 'day') {
    for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
      const key = toLocalISODate(cursor)
      buckets.set(key, {
        key,
        label: `${String(cursor.getDate()).padStart(2, '0')}/${String(cursor.getMonth() + 1).padStart(2, '0')}`,
        fullLabel: cursor.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'long' }),
        received: 0,
        proposals: 0,
        closed: 0,
      })
    }
  } else {
    for (
      let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      cursor <= end;
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    ) {
      const key = toLocalISODate(cursor).slice(0, 7)
      buckets.set(key, {
        key,
        label: `${MONTHS_SHORT[cursor.getMonth()]}/${String(cursor.getFullYear()).slice(2)}`,
        fullLabel: `${MONTHS_LONG[cursor.getMonth()]} de ${cursor.getFullYear()}`,
        received: 0,
        proposals: 0,
        closed: 0,
      })
    }
  }

  for (const lead of leads) {
    const localDay = toLocalISODate(new Date(lead.created_at))
    const key = granularity === 'day' ? localDay : localDay.slice(0, 7)
    const bucket = buckets.get(key)
    if (!bucket) continue
    bucket.received += 1
    if (isProposalSent(lead)) bucket.proposals += 1
    if (lead.status === 'fechado') bucket.closed += 1
  }

  return [...buckets.values()]
}

export type RankItem = { label: string; count: number; share: number }

export const NOT_INFORMED_LABEL = 'Não informado'
export const OTHERS_LABEL = 'Outros'

/** Conta ocorrências de um campo de texto, do maior para o menor. */
export function countBy(values: Array<string | null | undefined>): RankItem[] {
  const counts = new Map<string, number>()
  for (const raw of values) {
    const label = raw?.trim() || NOT_INFORMED_LABEL
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const total = values.length
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, share: ratio(count, total) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
}

/**
 * Demanda por sala: cada sala marcada num lead conta uma vez (um lead pode pedir várias).
 * `share` é a fatia das solicitações que incluíram aquela sala, então a soma pode passar de 100%.
 * Leads sem sala entram como "Não informado".
 */
export function countRooms(leads: Array<Pick<Lead, 'room_interests' | 'room_interest'>>): RankItem[] {
  const counts = new Map<string, number>()
  for (const lead of leads) {
    const rooms = getLeadRooms(lead)
    const unique = rooms.length > 0 ? [...new Set(rooms)] : [NOT_INFORMED_LABEL]
    for (const room of unique) counts.set(room, (counts.get(room) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count, share: ratio(count, leads.length) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'))
}

/**
 * Mantém as N maiores fatias e junta o restante em "Outros"
 * (a paleta categórica tem um número fixo de cores; nunca geramos cores novas).
 */
export function foldIntoOthers(items: RankItem[], maxSlices: number): RankItem[] {
  if (items.length <= maxSlices) return items
  const kept = items.slice(0, maxSlices - 1)
  const rest = items.slice(maxSlices - 1)
  const count = rest.reduce((sum, item) => sum + item.count, 0)
  const share = rest.reduce((sum, item) => sum + item.share, 0)
  return [...kept, { label: OTHERS_LABEL, count, share }]
}
