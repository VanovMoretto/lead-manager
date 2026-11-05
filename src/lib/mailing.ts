/**
 * Motor do mailing: agrupa as propostas por contato (mesmo e-mail ou telefone) e aplica o
 * opt-out LGPD. Fica fora de exporters.ts para as telas usarem sem baixar xlsx e jsPDF.
 */
import { formatPhoneBR } from './format'
import { formatLeadRooms } from './leadFields'
import { normalizeEmail, normalizePhoneDigits } from './contactIdentity'
import { LEAD_STATUS_LABELS, type Lead, type MarketingSuppression } from '../types/lead'

/** Um contato único do mailing (vários orçamentos do mesmo cliente viram uma linha). */
export type MailingContact = {
  name: string
  /** Empresa mais recente informada para o contato (vazio = pessoa física). */
  company: string
  email: string
  phone: string
  rooms: string
  /** Situação do orçamento mais recente. */
  status: string
  /** Quantos orçamentos esse contato fez no período filtrado. */
  requests: number
  /** Pelo menos um orçamento fechado. */
  everClosed: boolean
  /** Data do orçamento mais recente (para ordenar). */
  latestAt: string
  /** Algum orçamento desse contato pediu opt-out de comunicações (LGPD). */
  optedOut: boolean
}

export type MailingSummary = {
  /** Contatos únicos exportados. */
  contacts: number
  /** Leads com e-mail ou telefone (antes de agrupar). */
  leadsWithContact: number
  /** Leads sem e-mail nem telefone (ficaram de fora). */
  skipped: number
  /** Contatos únicos ignorados por opt-out LGPD. */
  optedOut: number
  /** Orçamentos repetidos agrupados entre os contatos exportados. */
  mergedDuplicates: number
}

/**
 * Agrupa leads do mesmo cliente: mesmo e-mail (sem diferenciar maiúsculas) OU mesmo telefone (dígitos).
 * Os vínculos são transitivos: se o lead A tem o e-mail do B e o B tem o telefone do C, os três são o mesmo contato.
 * Cada grupo vira uma linha com os dados do orçamento mais recente.
 */
/** Chaves da lista de supressão (LGPD) já normalizadas, para consulta rápida. */
export type SuppressionKeys = { emails: Set<string>; phones: Set<string> }

export function toSuppressionKeys(rows: Array<Pick<MarketingSuppression, 'kind' | 'value'>>): SuppressionKeys {
  return {
    emails: new Set(rows.filter((row) => row.kind === 'email').map((row) => row.value)),
    phones: new Set(rows.filter((row) => row.kind === 'phone').map((row) => row.value)),
  }
}

export function groupMailingContacts(leads: Lead[], suppression?: SuppressionKeys): MailingContact[] {
  const contactable = leads.filter((lead) => normalizeEmail(lead.contact_email) || normalizePhoneDigits(lead))

  // Union-find: cada lead começa no próprio grupo; leads que dividem e-mail/telefone são unidos
  const parent = contactable.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]]
      index = parent[index]
    }
    return index
  }
  const firstLeadByKey = new Map<string, number>()
  contactable.forEach((lead, index) => {
    const keys = [normalizeEmail(lead.contact_email), normalizePhoneDigits(lead)]
      .map((value, position) => (value ? `${position === 0 ? 'email' : 'phone'}:${value}` : null))
      .filter((key): key is string => key !== null)
    for (const key of keys) {
      const other = firstLeadByKey.get(key)
      if (other === undefined) firstLeadByKey.set(key, index)
      else parent[find(index)] = find(other)
    }
  })

  const groups = new Map<number, Lead[]>()
  contactable.forEach((lead, index) => {
    const root = find(index)
    const group = groups.get(root)
    if (group) group.push(lead)
    else groups.set(root, [lead])
  })

  return [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort((a, b) => b.created_at.localeCompare(a.created_at))
      const latest = sorted[0]
      // Dados do mais recente; se ele não tiver e-mail/telefone/sala, usa o mais recente que tiver
      const email = sorted.find((lead) => lead.contact_email)?.contact_email ?? ''
      const phoneDigits = sorted.map((lead) => normalizePhoneDigits(lead)).find(Boolean) ?? ''
      const phone = phoneDigits ? formatPhoneBR(phoneDigits) : ''
      const withRooms = sorted.find((lead) => formatLeadRooms(lead))
      return {
        name: latest.contact_name,
        company: sorted.find((lead) => lead.company)?.company ?? '',
        email,
        phone,
        rooms: withRooms ? formatLeadRooms(withRooms, ', ') : '',
        status: LEAD_STATUS_LABELS[latest.status],
        requests: group.length,
        everClosed: group.some((lead) => lead.status === 'fechado'),
        latestAt: latest.created_at,
        // Basta um orçamento com opt-out para o contato inteiro sair do mailing
        optedOut: group.some(
          (lead) =>
            lead.marketing_opt_out ||
            // Opt-out por contato: vale mesmo para leads fora do filtro ou já excluídos
            Boolean(suppression?.emails.has(normalizeEmail(lead.contact_email) ?? '')) ||
            Boolean(suppression?.phones.has(normalizePhoneDigits(lead) ?? '')),
        ),
      }
    })
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt))
}

export type MailingPreview = {
  /** Contatos que vão para o arquivo (já sem os de opt-out). */
  contacts: MailingContact[]
  summary: MailingSummary
}

/**
 * Agrupa e filtra os contatos do mailing sem gerar o arquivo (usado na pré-visualização).
 * `suppressions` é a lista de opt-out por contato (LGPD) inteira, não só a do filtro:
 * um contato que pediu opt-out em qualquer lead, atual ou excluído, nunca sai no mailing.
 */
export function buildMailing(leads: Lead[], suppressions: Array<Pick<MarketingSuppression, 'kind' | 'value'>>): MailingPreview {
  const grouped = groupMailingContacts(leads, toSuppressionKeys(suppressions))
  const contacts = grouped.filter((contact) => !contact.optedOut)
  const leadsWithContact = leads.filter((lead) => normalizeEmail(lead.contact_email) || normalizePhoneDigits(lead)).length

  return {
    contacts,
    summary: {
      contacts: contacts.length,
      leadsWithContact,
      skipped: leads.length - leadsWithContact,
      optedOut: grouped.length - contacts.length,
      mergedDuplicates: contacts.reduce((sum, contact) => sum + contact.requests - 1, 0),
    },
  }
}
