/**
 * Cálculos da página Mailing & Pesquisas: segmentos de campanha, público elegível,
 * taxas do funil de e-mail, pesquisas pós-evento e engajamento pelo WhatsApp.
 */
import { isValidEmail } from './format'
import { toLocalISODate, type DateRange } from './dashboard'
import { buildMailing, groupMailingContacts, toSuppressionKeys, type MailingContact, type MailingPreview } from './mailing'
import { toWhatsAppNumber } from './whatsapp'
import type {
  CampaignChannel,
  CampaignSegment,
  CommunicationLog,
  CommunicationPurpose,
  Lead,
  MailingCampaign,
  MarketingSuppression,
  OperationalStatus,
} from '../types/lead'

export type SuppressionRow = Pick<MarketingSuppression, 'kind' | 'value'>

/** Percentual com uma casa ("94,1%") ou "—" sem base. */
export function formatRate(part: number, total: number): string {
  if (total <= 0) return '—'
  return `${((part / total) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

export function rate(part: number, total: number): number | null {
  return total > 0 ? (part / total) * 100 : null
}

/** Timestamp do banco dentro do período (pela data local). */
export function timestampInRange(value: string | null | undefined, range: DateRange): boolean {
  if (!value) return false
  const day = toLocalISODate(new Date(value))
  return day >= range.from && day <= range.to
}

/** Data "YYYY-MM-DD" dentro do período (sem converter fuso). */
export function dateInRange(value: string | null | undefined, range: DateRange): boolean {
  return Boolean(value && value >= range.from && value <= range.to)
}

// -----------------------------------------------------------------------------
// Segmentos e público das campanhas
// -----------------------------------------------------------------------------

export function segmentLeads(leads: Lead[], segment: CampaignSegment): Lead[] {
  switch (segment) {
    case 'closed_clients':
      return leads.filter((lead) => lead.status === 'fechado')
    case 'open_proposals':
      return leads.filter((lead) => lead.status === 'em_aberto')
    case 'lost_recover':
      return leads.filter((lead) => lead.status === 'perdido')
    case 'companies_only':
      return leads.filter((lead) => Boolean(lead.company?.trim() || lead.cnpj))
    default:
      return leads
  }
}

export function hasValidEmail(contact: Pick<MailingContact, 'email'>): boolean {
  return Boolean(contact.email) && isValidEmail(contact.email)
}

export function hasValidWhatsApp(contact: Pick<MailingContact, 'phone'>): boolean {
  return toWhatsAppNumber(contact.phone) !== null
}

function reachable(contact: MailingContact, channel: CampaignChannel): boolean {
  if (channel === 'email') return hasValidEmail(contact)
  if (channel === 'whatsapp') return hasValidWhatsApp(contact)
  return hasValidEmail(contact) || hasValidWhatsApp(contact)
}

/** Contatos únicos do segmento, sem opt-out LGPD e com o canal da campanha. */
export function buildCampaignAudience(
  leads: Lead[],
  suppressions: SuppressionRow[],
  segment: CampaignSegment,
  channel: CampaignChannel,
): MailingPreview {
  const mailing = buildMailing(segmentLeads(leads, segment), suppressions)
  const contacts = mailing.contacts.filter((contact) => reachable(contact, channel))
  return {
    contacts,
    summary: {
      ...mailing.summary,
      contacts: contacts.length,
      mergedDuplicates: contacts.reduce((sum, contact) => sum + contact.requests - 1, 0),
    },
  }
}

/** Base inteira agrupada por contato, inclusive quem pediu opt-out (para conferência). */
export function buildContactBase(leads: Lead[], suppressions: SuppressionRow[]): MailingContact[] {
  return groupMailingContacts(leads, toSuppressionKeys(suppressions))
}

/** Pré-visualização do mailing a partir de uma lista já filtrada (opt-out sempre fica de fora). */
export function previewFromContacts(contacts: MailingContact[]): MailingPreview {
  const eligible = contacts.filter((contact) => !contact.optedOut)
  return {
    contacts: eligible,
    summary: {
      contacts: eligible.length,
      leadsWithContact: contacts.reduce((sum, contact) => sum + contact.requests, 0),
      skipped: 0,
      optedOut: contacts.length - eligible.length,
      mergedDuplicates: eligible.reduce((sum, contact) => sum + contact.requests - 1, 0),
    },
  }
}

// -----------------------------------------------------------------------------
// Indicadores do topo
// -----------------------------------------------------------------------------

/** Data que coloca a campanha no período: envio, ou criação enquanto rascunho. */
export function campaignDate(campaign: Pick<MailingCampaign, 'sent_at' | 'created_at'>): string {
  return campaign.sent_at ?? campaign.created_at
}

export type EmailFunnel = { campaigns: number; sent: number; delivered: number; opened: number; clicked: number }

export function computeEmailFunnel(campaigns: MailingCampaign[]): EmailFunnel {
  return campaigns.reduce<EmailFunnel>(
    (total, campaign) => ({
      campaigns: total.campaigns + 1,
      sent: total.sent + campaign.sent_count,
      delivered: total.delivered + campaign.delivered_count,
      opened: total.opened + campaign.opened_count,
      clicked: total.clicked + campaign.clicked_count,
    }),
    { campaigns: 0, sent: 0, delivered: 0, opened: 0, clicked: 0 },
  )
}

/** Último dia do evento ("YYYY-MM-DD"), para saber se ele já aconteceu no período. */
export function eventDay(lead: Pick<Lead, 'event_last_date' | 'event_date'>): string | null {
  return lead.event_last_date ?? lead.event_date
}

export type SurveyStats = {
  events: number
  sent: number
  answered: number
  pending: number
  /** Média das notas (1 a 10) das pesquisas respondidas, ou null sem notas. */
  averageScore: number | null
  scored: number
}

export function computeSurveyStats(events: Lead[]): SurveyStats {
  const scores = events.filter((lead) => lead.survey_status === 'respondida' && lead.survey_score !== null)
  return {
    events: events.length,
    sent: events.filter((lead) => lead.survey_status !== 'nao_enviada').length,
    answered: events.filter((lead) => lead.survey_status === 'respondida').length,
    pending: events.filter((lead) => lead.survey_status === 'nao_enviada').length,
    averageScore: scores.length ? scores.reduce((sum, lead) => sum + (lead.survey_score ?? 0), 0) / scores.length : null,
    scored: scores.length,
  }
}

/** Eventos da pesquisa: realizados (e, se pedido, confirmados) com data no período. */
export function surveyEvents(leads: Lead[], range: DateRange, statuses: OperationalStatus[]): Lead[] {
  return leads
    .filter((lead) => statuses.includes(lead.operational_status) && dateInRange(eventDay(lead), range))
    .sort((a, b) => (eventDay(b) ?? '').localeCompare(eventDay(a) ?? ''))
}

export type WhatsAppStats = { total: number; byPurpose: Record<CommunicationPurpose, number>; emails: number }

export function computeWhatsAppStats(logs: CommunicationLog[]): WhatsAppStats {
  const byPurpose: Record<CommunicationPurpose, number> = { follow_up: 0, greeting: 0, survey: 0, campaign: 0, proposal: 0 }
  let total = 0
  let emails = 0
  for (const log of logs) {
    if (log.channel === 'email') {
      emails += 1
      continue
    }
    total += 1
    byPurpose[log.purpose] += 1
  }
  return { total, byPurpose, emails }
}

export type BaseHealth = { eligible: number; withEmail: number; withWhatsApp: number; optedOut: number; suppressions: number }

export function computeBaseHealth(contacts: MailingContact[], suppressions: SuppressionRow[]): BaseHealth {
  const eligible = contacts.filter((contact) => !contact.optedOut)
  return {
    eligible: eligible.length,
    withEmail: eligible.filter(hasValidEmail).length,
    withWhatsApp: eligible.filter(hasValidWhatsApp).length,
    optedOut: contacts.length - eligible.length,
    suppressions: suppressions.length,
  }
}
