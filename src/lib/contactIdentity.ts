import { onlyDigits } from './format'
import type { Lead } from '../types/lead'

/**
 * Telefone normalizado para comparar clientes: só dígitos, sem o "55" do país.
 * Retorna null quando não há um telefone completo (DDD + número).
 */
export function normalizePhoneDigits(lead: Pick<Lead, 'contact_phone' | 'contact_phone_digits'>): string | null {
  let digits = lead.contact_phone_digits ?? onlyDigits(lead.contact_phone ?? '')
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2)
  return digits.length === 10 || digits.length === 11 ? digits : null
}

/** E-mail normalizado para comparar clientes (minúsculo, sem espaços). */
export function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase()
  return normalized ? normalized : null
}

/** Escapa curingas do LIKE/ILIKE ("_" e "%"), para buscar o texto exato. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}
