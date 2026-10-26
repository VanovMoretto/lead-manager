/** Remove tudo que não for dígito. */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}

/**
 * Máscara de telefone BR, celular/WhatsApp ou fixo:
 * (11) 98765-4321 | (11) 3456-7890
 */
export function formatPhoneBR(value: string): string {
  const digits = onlyDigits(value).slice(0, 11)

  if (digits.length === 0) return ''
  if (digits.length <= 2) return `(${digits}`
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

/** Telefone completo: DDD + 8 dígitos (fixo) ou DDD + 9 dígitos (celular). */
export function isValidPhoneBR(value: string): boolean {
  const length = onlyDigits(value).length
  return length === 10 || length === 11
}

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 1234.5 -> "R$ 1.234,50" */
export function formatBRL(value: number): string {
  return brlFormatter.format(value)
}

/** 123450 (centavos) -> "R$ 1.234,50" */
export function formatCentsBRL(cents: number): string {
  return brlFormatter.format(cents / 100)
}

/** Máximo aceito por numeric(12,2): 9.999.999.999,99 */
const MAX_CURRENCY_DIGITS = 12

/**
 * Converte o texto digitado num campo de moeda em centavos.
 * Os dígitos entram da direita para a esquerda: "1", "12", "123" -> R$ 0,01 / 0,12 / 1,23.
 * Retorna null quando o campo fica vazio.
 */
export function parseCurrencyInputToCents(value: string): number | null {
  const digits = onlyDigits(value).replace(/^0+/, '').slice(0, MAX_CURRENCY_DIGITS)
  if (digits.length === 0) return null
  return Number.parseInt(digits, 10)
}

/** Converte um valor em reais (ex.: 1234.5) para centavos inteiros, sem erro de ponto flutuante. */
export function toCents(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  return Math.round(value * 100)
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim())
}

/** "2026-11-20" -> "20/11/2026" (sem passar por Date, evitando erro de fuso). */
export function formatDateBR(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const [year, month, day] = isoDate.slice(0, 10).split('-')
  if (!year || !month || !day) return ''
  return `${day}/${month}/${year}`
}
