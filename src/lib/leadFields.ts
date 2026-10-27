import { formatDateBR } from './format'
import type { Lead } from '../types/lead'

/** Separador usado no texto legado `room_interest` ("Salão A | Salão B"). */
export const ROOM_SEPARATOR = ' | '

/** "Salão A | Salão B" -> ["Salão A", "Salão B"] (aceita também "Salão A|Salão B"). */
export function splitRooms(text: string | null | undefined): string[] {
  if (!text) return []
  return text
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Salas de interesse do lead. Usa o array `room_interests`; se vier vazio
 * (registro antigo ainda não migrado), cai no texto legado `room_interest`.
 */
export function getLeadRooms(lead: Pick<Lead, 'room_interests' | 'room_interest'>): string[] {
  if (Array.isArray(lead.room_interests) && lead.room_interests.length > 0) return lead.room_interests
  return splitRooms(lead.room_interest)
}

/** Texto curto das salas para tabelas e exportações. */
export function formatLeadRooms(lead: Pick<Lead, 'room_interests' | 'room_interest'>, separator = ', '): string {
  return getLeadRooms(lead).join(separator)
}

/**
 * Quanto de cada serviço fica no caixa do hotel (Receita Líquida).
 * Mesma regra da coluna gerada `net_value` (migração 012).
 */
export const NET_RATES = { rental: 1, lodging: 1, parking: 0.5, equipment: 0.15, ab: 0.06 } as const

export const NET_RATES_LABEL = '100% Loc./Hosp. · 50% Estac. · 15% Equip. · 6% A&B'

export type LeadValueBreakdown = {
  /** Locação / Espaço (`proposed_value`): conta para a meta pessoal. */
  rental: number
  ab: number
  lodging: number
  equipment: number
  parking: number
  /** Receita Bruta (100% de todos os serviços). */
  total: number
  /** Receita Líquida do Hotel. */
  net: number
}

type ValueSource = Pick<Lead, 'proposed_value' | 'ab_value' | 'lodging_value' | 'total_value'> &
  Partial<Pick<Lead, 'equipment_value' | 'parking_value' | 'net_value'>>

const round2 = (value: number) => Math.round(value * 100) / 100

/** Receita Líquida do Hotel a partir dos valores de cada serviço. */
export function computeNetValue(values: Pick<LeadValueBreakdown, 'rental' | 'ab' | 'lodging' | 'equipment' | 'parking'>): number {
  return round2(
    values.rental * NET_RATES.rental +
      values.lodging * NET_RATES.lodging +
      values.parking * NET_RATES.parking +
      values.equipment * NET_RATES.equipment +
      values.ab * NET_RATES.ab,
  )
}

/** Valores do orçamento separados e somados (os totais do banco são usados quando disponíveis). */
export function getLeadValues(lead: ValueSource): LeadValueBreakdown {
  const rental = Number(lead.proposed_value ?? 0)
  const ab = Number(lead.ab_value ?? 0)
  const lodging = Number(lead.lodging_value ?? 0)
  const equipment = Number(lead.equipment_value ?? 0)
  const parking = Number(lead.parking_value ?? 0)
  const total =
    lead.total_value === null || lead.total_value === undefined
      ? round2(rental + ab + lodging + equipment + parking)
      : Number(lead.total_value)
  const net =
    lead.net_value === null || lead.net_value === undefined
      ? computeNetValue({ rental, ab, lodging, equipment, parking })
      : Number(lead.net_value)
  return { rental, ab, lodging, equipment, parking, total, net }
}

export const emptyValueBreakdown = (): LeadValueBreakdown => ({
  rental: 0,
  ab: 0,
  lodging: 0,
  equipment: 0,
  parking: 0,
  total: 0,
  net: 0,
})

/** Soma os valores de vários orçamentos. */
export function sumLeadValues(leads: ValueSource[]): LeadValueBreakdown {
  return leads.reduce((sum, lead) => {
    const values = getLeadValues(lead)
    return {
      rental: sum.rental + values.rental,
      ab: sum.ab + values.ab,
      lodging: sum.lodging + values.lodging,
      equipment: sum.equipment + values.equipment,
      parking: sum.parking + values.parking,
      total: sum.total + values.total,
      net: sum.net + values.net,
    }
  }, emptyValueBreakdown())
}

/** O lead tem algum valor informado (em qualquer componente)? */
export function hasAnyValue(
  lead: Pick<Lead, 'proposed_value' | 'ab_value' | 'lodging_value'> & Partial<Pick<Lead, 'equipment_value' | 'parking_value'>>,
): boolean {
  return (
    lead.proposed_value !== null ||
    Number(lead.ab_value ?? 0) > 0 ||
    Number(lead.lodging_value ?? 0) > 0 ||
    Number(lead.equipment_value ?? 0) > 0 ||
    Number(lead.parking_value ?? 0) > 0
  )
}

/** Quantidade de dias do evento (1 para evento de um dia, null sem data). */
export function countEventDays(lead: Pick<Lead, 'event_date' | 'event_end_date'>): number | null {
  if (!lead.event_date) return null
  if (!lead.event_end_date) return 1
  const [y1, m1, d1] = lead.event_date.slice(0, 10).split('-').map(Number)
  const [y2, m2, d2] = lead.event_end_date.slice(0, 10).split('-').map(Number)
  // Datas sem fuso: Date.UTC evita erro de horário de verão
  const diff = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
  return diff >= 0 ? diff + 1 : 1
}

/** "20/11/2026" ou "20/11/2026 a 22/11/2026 (3 dias)"; null quando não há data. */
export function formatLeadEventPeriod(lead: Pick<Lead, 'event_date' | 'event_end_date'>): string | null {
  if (!lead.event_date) return null
  const days = countEventDays(lead) ?? 1
  if (days <= 1) return formatDateBR(lead.event_date)
  return `${formatDateBR(lead.event_date)} a ${formatDateBR(lead.event_end_date)} (${days} dias)`
}
