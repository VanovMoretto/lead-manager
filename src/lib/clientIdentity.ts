import { isValidEmail } from './format'

/**
 * Provedores de e-mail gratuitos não identificam empresa. Mesma lista da função
 * `public.corporate_email_domain` do banco (migração 009).
 */
const PUBLIC_EMAIL_DOMAIN =
  /^(gmail|googlemail|hotmail|outlook|live|msn|yahoo|ymail|icloud|me|mac|bol|uol|terra|globo|globomail|ig|aol|protonmail|proton|gmx|yandex|zoho)\.[a-z]{2,3}(\.[a-z]{2})?$/

/** Domínio corporativo do e-mail ("fernanda@cremolatto.com.br" -> "cremolatto.com.br"); vazio para gmail, hotmail etc. */
export function getCorporateEmailDomain(email: string): string {
  if (!isValidEmail(email)) return ''
  const domain = email.trim().toLowerCase().split('@')[1] ?? ''
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || PUBLIC_EMAIL_DOMAIN.test(domain)) return ''
  return domain
}

/** Nome de empresa comparável: espaços repetidos removidos (a comparação no banco ignora maiúsculas). */
export function normalizeCompanyName(company: string): string {
  return company.trim().replace(/\s+/g, ' ')
}

/** Mesmo nome de pessoa, sem diferenciar maiúsculas e espaços extras. */
export function isSameContactName(a: string, b: string): boolean {
  return normalizeCompanyName(a).toLocaleLowerCase('pt-BR') === normalizeCompanyName(b).toLocaleLowerCase('pt-BR')
}

/** "Matriz · 12.345.678/0001-95": identifica o braço da empresa (vazio sem CNPJ nem rótulo). */
export function describeBranch(client: { branch_label: string | null; cnpj: string | null }): string {
  return [client.branch_label, client.cnpj ? `CNPJ ${client.cnpj}` : null].filter(Boolean).join(' · ')
}
