import { onlyDigits } from './format'
import { getLeadRooms } from './leadFields'
import type { Lead } from '../types/lead'

/** Número no formato do wa.me (55 + DDD + número), ou null se o telefone não estiver completo. */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  const digits = onlyDigits(phone ?? '')
  if (digits.length === 10 || digits.length === 11) return `55${digits}`
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits
  return null
}

/** "NOME sobrenome" -> "Nome" */
function firstName(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0] ?? ''
  return first ? first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1).toLocaleLowerCase('pt-BR') : ''
}

/** ["A"] -> "A" | ["A", "B"] -> "A e B" | ["A", "B", "C"] -> "A, B e C" */
function joinNatural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`
}

/** Mensagem educada de follow-up, com o primeiro nome e as salas de interesse. */
export function buildFollowUpMessage(lead: Pick<Lead, 'contact_name' | 'room_interests' | 'room_interest'>): string {
  const name = firstName(lead.contact_name)
  const rooms = getLeadRooms(lead)
  const greeting = name ? `Olá ${name}, tudo bem?` : 'Olá, tudo bem?'
  const event = rooms.length > 0 ? `para o seu evento (${joinNatural(rooms)})` : 'para o seu evento'
  return `${greeting} Passando para saber se conseguiu avaliar as informações e valores que conversamos ${event}. Ficou alguma dúvida em que eu possa ajudar?`
}

/** Link do WhatsApp com a mensagem de follow-up pronta, ou null sem telefone válido. */
export function buildFollowUpWhatsAppUrl(
  lead: Pick<Lead, 'contact_name' | 'contact_phone' | 'room_interests' | 'room_interest'>,
): string | null {
  const number = toWhatsAppNumber(lead.contact_phone)
  if (!number) return null
  return `https://wa.me/${number}?text=${encodeURIComponent(buildFollowUpMessage(lead))}`
}
