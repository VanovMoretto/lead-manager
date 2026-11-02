import { supabase } from './supabase'
import { emptyValueBreakdown, getLeadValues, NET_RATES, type LeadValueBreakdown } from './leadFields'
import type { Lead, OperationalStatus } from '../types/lead'

// =============================================================================
// Faturamento & Eventos: planilha mensal pelos eventos (data de realização)
// =============================================================================

export const REVENUE_COLUMNS = [
  'id',
  'client_id',
  'contact_name',
  'company',
  'event_name',
  'event_date',
  'event_end_date',
  'origin',
  'room_interests',
  'room_interest',
  'pax',
  'status',
  'operational_status',
  'proposed_value',
  'ab_value',
  'lodging_value',
  'equipment_value',
  'parking_value',
  'total_value',
  'net_value',
  'nf_rental',
  'nf_ab',
  'nf_parking',
  'payment_status',
  'survey_status',
  'proposal_number',
  'user_id',
].join(', ')

export type RevenueLead = Pick<
  Lead,
  | 'id'
  | 'client_id'
  | 'contact_name'
  | 'company'
  | 'event_name'
  | 'event_date'
  | 'event_end_date'
  | 'origin'
  | 'room_interests'
  | 'room_interest'
  | 'pax'
  | 'status'
  | 'operational_status'
  | 'proposed_value'
  | 'ab_value'
  | 'lodging_value'
  | 'equipment_value'
  | 'parking_value'
  | 'total_value'
  | 'net_value'
  | 'nf_rental'
  | 'nf_ab'
  | 'nf_parking'
  | 'payment_status'
  | 'survey_status'
  | 'proposal_number'
  | 'user_id'
>

export type RevenueMetric = 'rental' | 'net' | 'gross' | 'compare'

export const REVENUE_METRIC_LABELS: Record<RevenueMetric, string> = {
  rental: 'Locação de salas',
  net: 'Receita líquida total',
  gross: 'Receita bruta total',
  compare: 'Comparar as 3 Receitas',
}

export const MONTH_SHORT_LABELS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'] as const
export const MONTH_LONG_LABELS = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
] as const

const PAGE_SIZE = 1000

/** Período personalizado da planilha: datas "YYYY-MM-DD" do evento, inclusive. */
export type RevenueRange = { from: string; to: string }

/**
 * Propostas fechadas ou em negociação com evento no ano (e em dezembro do ano anterior,
 * para comparar janeiro com o mês anterior). Perdidas não entram na planilha.
 * Com período personalizado, a busca se estende para cobrir também esse período.
 */
export async function fetchRevenueLeads(year: number, signal?: AbortSignal, range?: RevenueRange | null): Promise<RevenueLead[]> {
  const yearFrom = `${year - 1}-12-01`
  const yearTo = `${year}-12-31`
  const from = range && range.from < yearFrom ? range.from : yearFrom
  const to = range && range.to > yearTo ? range.to : yearTo
  const rows: RevenueLead[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase
      .from('leads')
      .select(REVENUE_COLUMNS)
      .gte('event_date', from)
      .lte('event_date', to)
      .in('status', ['fechado', 'em_aberto'])
      .order('event_date', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (signal) query = query.abortSignal(signal)
    const { data, error } = await query
    if (error) throw error
    rows.push(...((data ?? []) as unknown as RevenueLead[]))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

/** Situação na planilha: proposta em aberto é "À confirmar"; fechada é confirmado ou realizado. */
export function revenueSituation(lead: Pick<Lead, 'status' | 'operational_status'>): OperationalStatus {
  if (lead.status !== 'fechado') return 'a_confirmar'
  return lead.operational_status === 'a_confirmar' ? 'confirmado' : lead.operational_status
}

export const isConfirmed = (lead: Pick<Lead, 'status'>) => lead.status === 'fechado'

/** Ano e mês (1–12) do evento, pelo texto "YYYY-MM-DD" (sem conversão de fuso). */
export function eventYearMonth(lead: Pick<Lead, 'event_date'>): { year: number; month: number } | null {
  if (!lead.event_date) return null
  return { year: Number(lead.event_date.slice(0, 4)), month: Number(lead.event_date.slice(5, 7)) }
}

const DAY_MS = 86_400_000
const toDayNumber = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / DAY_MS
const fromDayNumber = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10)

/** Soma meses a uma data "YYYY-MM-DD"; dia que não existe no mês vira o último dia (31/10 + 1 mês = 30/11). */
function addMonths(iso: string, months: number): string {
  const total = Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7)) - 1 + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const day = Math.min(Number(iso.slice(8, 10)), lastDay)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Distância de `from` até `to` (from <= to) em meses de calendário e dias. */
function calendarDistance(from: string, to: string): { months: number; days: number } {
  let months = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7))
  if (addMonths(from, months) > to) months -= 1
  return { months, days: toDayNumber(to) - toDayNumber(addMonths(from, months)) }
}

/**
 * Muda uma ponta do período personalizado. Se ela passar da outra, a outra anda junto,
 * pelo mesmo tanto de meses e dias (18/09 a 17/10 com De em 18/10 vira 18/10 a 17/11).
 */
export function moveRangeEdge(range: RevenueRange, edge: keyof RevenueRange, value: string): RevenueRange {
  const next = { ...range, [edge]: value }
  if (!value || !range.from || !range.to || next.from <= next.to) return next
  if (edge === 'from') {
    const { months, days } = calendarDistance(range.from, value)
    const to = fromDayNumber(toDayNumber(addMonths(range.to, months)) + days)
    return { from: value, to: to >= value ? to : value }
  }
  const { months, days } = calendarDistance(value, range.to)
  const from = fromDayNumber(toDayNumber(addMonths(range.from, -months)) - days)
  return { from: from <= value ? from : value, to: value }
}

/** Evento (pela data de início) dentro do período personalizado. */
export function inRange(lead: Pick<Lead, 'event_date'>, range: RevenueRange): boolean {
  return Boolean(lead.event_date && lead.event_date >= range.from && lead.event_date <= range.to)
}

export function inPeriod(lead: Pick<Lead, 'event_date'>, year: number, month: number | null): boolean {
  const ym = eventYearMonth(lead)
  return Boolean(ym && ym.year === year && (month === null || ym.month === month))
}

/** "13/01" · "13 e 14/01" · "13 a 15/01" · "30/01 a 02/02" */
export function formatEventDays(lead: Pick<Lead, 'event_date' | 'event_end_date'>): string {
  if (!lead.event_date) return '—'
  const [, m1, d1] = lead.event_date.split('-')
  if (!lead.event_end_date || lead.event_end_date === lead.event_date) return `${d1}/${m1}`
  const [, m2, d2] = lead.event_end_date.split('-')
  if (m1 !== m2) return `${d1}/${m1} a ${d2}/${m2}`
  return Number(d2) - Number(d1) === 1 ? `${d1} e ${d2}/${m1}` : `${d1} a ${d2}/${m1}`
}

export type RevenueSummary = {
  confirmed: LeadValueBreakdown
  pending: LeadValueBreakdown
  realizedCount: number
  confirmedCount: number
  pendingCount: number
  /** PAX dos eventos confirmados e realizados. */
  paxConfirmed: number
  paxPending: number
}

export function summarizeRevenue(leads: RevenueLead[]): RevenueSummary {
  const summary: RevenueSummary = {
    confirmed: emptyValueBreakdown(),
    pending: emptyValueBreakdown(),
    realizedCount: 0,
    confirmedCount: 0,
    pendingCount: 0,
    paxConfirmed: 0,
    paxPending: 0,
  }
  for (const lead of leads) {
    const values = getLeadValues(lead)
    const target = isConfirmed(lead) ? summary.confirmed : summary.pending
    for (const key of Object.keys(target) as Array<keyof LeadValueBreakdown>) target[key] += values[key]
    const situation = revenueSituation(lead)
    if (situation === 'realizado') summary.realizedCount += 1
    else if (situation === 'confirmado') summary.confirmedCount += 1
    else summary.pendingCount += 1
    if (isConfirmed(lead)) summary.paxConfirmed += lead.pax ?? 0
    else summary.paxPending += lead.pax ?? 0
  }
  return summary
}

/** Quanto de cada serviço fica no hotel (para as linhas "líquido" da planilha). */
export function netShare(value: number, rate: number): number {
  return Math.round(value * rate * 100) / 100
}

export { NET_RATES }
