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

export type LeadValueBreakdown = {
  /** Locação / Espaço (`proposed_value`). */
  rental: number
  ab: number
  lodging: number
  total: number
}

/** Valores do orçamento separados e somados (o total do banco é usado quando disponível). */
export function getLeadValues(
  lead: Pick<Lead, 'proposed_value' | 'ab_value' | 'lodging_value' | 'total_value'>,
): LeadValueBreakdown {
  const rental = Number(lead.proposed_value ?? 0)
  const ab = Number(lead.ab_value ?? 0)
  const lodging = Number(lead.lodging_value ?? 0)
  const computed = Math.round((rental + ab + lodging) * 100) / 100
  const total = lead.total_value === null || lead.total_value === undefined ? computed : Number(lead.total_value)
  return { rental, ab, lodging, total }
}

/** O lead tem algum valor informado (em qualquer componente)? */
export function hasAnyValue(lead: Pick<Lead, 'proposed_value' | 'ab_value' | 'lodging_value'>): boolean {
  return lead.proposed_value !== null || Number(lead.ab_value ?? 0) > 0 || Number(lead.lodging_value ?? 0) > 0
}
