/**
 * Modo Demonstração: um "Supabase" local que roda inteiro no navegador.
 *
 * Responde às mesmas chamadas que o app faz (auth, consultas PostgREST, RPCs e Storage),
 * reproduzindo as regras do banco que a interface depende: colunas geradas, cliente e contato
 * de cada proposta, lista de supressão (LGPD), situação operacional, unicidades e a view
 * `client_summaries`. Os dados ficam no `sessionStorage` da aba (somem ao fechá-la).
 *
 * Só é usado quando `VITE_DEMO_MODE=true`; fora disso, nada deste arquivo entra no build.
 */
import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import { formatCNPJ, onlyDigits } from './format'
import { getCorporateEmailDomain } from './clientIdentity'
import { DEMO_PASSWORD, DEMO_USER_IDS, demoLeads, demoOptions, demoUsers, type DemoLeadSeed } from './demoSeed'
import type {
  AppSettingOption,
  Client,
  ClientContact,
  ClientSummary,
  Database,
  Lead,
  LeadAttachment,
  MarketingSuppression,
  UserProfile,
} from '../types/lead'

export { isDemoMode } from './demoMode'
export { DEMO_ACCOUNTS, DEMO_PASSWORD } from './demoSeed'

const DB_STORAGE_KEY = 'gestao-leads-demo-db-v1'
const FILES_STORAGE_KEY = 'gestao-leads-demo-files-v1'
const SESSION_STORAGE_KEY = 'gestao-leads-demo-session-v1'
/** Arquivos maiores que isto ficam só na memória (o sessionStorage tem poucos MB). */
const MAX_PERSISTED_FILE_BYTES = 1024 * 1024
/** Pequena espera para a interface mostrar os estados de carregamento como num servidor real. */
const LATENCY_MS = 120

// =============================================================================
// Estado
// =============================================================================

type Row = Record<string, unknown>

type DemoUser = { id: string; email: string; password: string; created_at: string }

type DemoDb = {
  leads: Lead[]
  clients: Client[]
  client_contacts: ClientContact[]
  app_settings_options: AppSettingOption[]
  marketing_suppressions: MarketingSuppression[]
  lead_attachments: LeadAttachment[]
  user_profiles: UserProfile[]
  users: DemoUser[]
}

type DemoError = { message: string; code: string; details: string | null; hint: string | null }

class DemoDbError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function toPostgrestError(error: unknown): DemoError {
  if (error instanceof DemoDbError) return { message: error.message, code: error.code, details: null, hint: null }
  return { message: error instanceof Error ? error.message : String(error), code: 'XX000', details: null, hint: null }
}

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, value)
  } catch {
    // Sem sessionStorage (ou cheio): os dados continuam valendo até recarregar a página
  }
}

let db: DemoDb | null = null

function getDb(): DemoDb {
  if (db) return db
  const saved = readStorage(DB_STORAGE_KEY)
  if (saved) {
    try {
      db = JSON.parse(saved) as DemoDb
      return db
    } catch {
      // Base salva corrompida: recomeça da original
    }
  }
  db = buildSeedDb()
  persist()
  return db
}

function persist(): void {
  if (db) writeStorage(DB_STORAGE_KEY, JSON.stringify(db))
}

/** Volta para a base fictícia original (o login atual continua valendo). */
export function resetDemoData(): void {
  writeStorage(DB_STORAGE_KEY, null)
  writeStorage(FILES_STORAGE_KEY, null)
  for (const file of memoryFiles.values()) URL.revokeObjectURL(file.url)
  memoryFiles.clear()
  db = null
}

// =============================================================================
// Utilitários
// =============================================================================

const nowIso = () => new Date().toISOString()

/** Gerador de ids; na base inicial é sequencial, para os links continuarem valendo depois de "Restaurar dados". */
let newId = (): string => crypto.randomUUID()
const clone = <T,>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T))

function normalizeEmail(value: string | null | undefined): string | null {
  const email = (value ?? '').trim().toLowerCase()
  return email || null
}

function normalizePhone(value: string | null | undefined): string | null {
  const digits = onlyDigits(value ?? '')
  if (digits.length === 10 || digits.length === 11) return digits
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) return digits.slice(2)
  return null
}

const digitsOrNull = (value: string | null | undefined) => onlyDigits(value ?? '') || null
const trimOrNull = (value: string | null | undefined) => (value ?? '').trim() || null
const collapseSpaces = (value: string | null | undefined) => trimOrNull((value ?? '').replace(/\s+/g, ' '))
const corporateDomain = (email: string | null | undefined) => getCorporateEmailDomain(email ?? '') || null
const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

function cnpjKey(value: string | null | undefined): string | null {
  const digits = onlyDigits(value ?? '')
  return digits.length === 14 ? digits : null
}

const round2 = (value: number) => Math.round(value * 100) / 100
const num = (value: unknown) => (value === null || value === undefined || value === '' ? 0 : Number(value))

// =============================================================================
// Regras de `leads` (espelham os triggers do banco)
// =============================================================================

const LEAD_DEFAULTS: Omit<Lead, 'id' | 'created_at' | 'updated_at' | 'contact_name'> = {
  contact_phone: null,
  contact_email: null,
  company: null,
  marketing_opt_out: false,
  origin: null,
  room_interests: [],
  room_interest: null,
  event_date: null,
  event_end_date: null,
  event_last_date: null,
  is_date_flexible: false,
  date_notes: null,
  proposed_value: null,
  has_ab: false,
  ab_value: 0,
  has_lodging: false,
  lodging_value: 0,
  has_equipment: false,
  equipment_value: 0,
  has_parking: false,
  parking_value: 0,
  total_value: 0,
  net_value: 0,
  proposal_sent: false,
  proposal_number: null,
  status: 'em_aberto',
  loss_reason: null,
  loss_reason_details: null,
  observations: null,
  event_name: null,
  pax: null,
  operational_status: 'a_confirmar',
  nf_rental: null,
  nf_ab: null,
  nf_parking: null,
  payment_status: 'pendente',
  survey_status: 'nao_enviada',
  user_id: null,
  contact_phone_digits: null,
  cnpj: null,
  cnpj_digits: null,
  client_id: null,
  contact_id: null,
}

const LEAD_GENERATED = ['contact_phone_digits', 'total_value', 'net_value', 'event_last_date', 'cnpj_digits'] as const
const leadColumns = () => new Set<string>(['id', 'created_at', 'updated_at', 'contact_name', ...Object.keys(LEAD_DEFAULTS)])
/** Colunas que não contam como alteração da proposta (mesma lista do trigger `set_updated_at`). */
const LEAD_UPDATED_AT_IGNORED = new Set([
  'marketing_opt_out',
  'updated_at',
  'contact_phone_digits',
  'total_value',
  'net_value',
  'event_last_date',
  'client_id',
  'contact_id',
  'cnpj',
  'cnpj_digits',
])

function todayLocalIso(): string {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

/** Colunas geradas e espelho das salas. */
function computeLeadColumns(lead: Lead): void {
  lead.room_interests = Array.isArray(lead.room_interests) ? lead.room_interests : []
  lead.room_interest = lead.room_interests.join(' | ') || null
  for (const key of ['ab_value', 'lodging_value', 'equipment_value', 'parking_value'] as const) lead[key] = num(lead[key])
  lead.proposed_value = lead.proposed_value === null || lead.proposed_value === undefined ? null : Number(lead.proposed_value)
  lead.pax = lead.pax === null || lead.pax === undefined ? null : Number(lead.pax)
  lead.contact_phone_digits = digitsOrNull(lead.contact_phone)
  lead.cnpj_digits = digitsOrNull(lead.cnpj)
  lead.event_last_date = lead.event_end_date ?? lead.event_date ?? null
  const rental = num(lead.proposed_value)
  lead.total_value = round2(rental + lead.ab_value + lead.lodging_value + lead.equipment_value + lead.parking_value)
  lead.net_value = round2(rental + lead.lodging_value + lead.parking_value * 0.5 + lead.equipment_value * 0.15 + lead.ab_value * 0.06)
}

function validateLead(lead: Lead, current: DemoDb): void {
  if (!lead.contact_name || !lead.contact_name.trim()) {
    throw new DemoDbError('23514', 'new row for relation "leads" violates check constraint "leads_contact_name_not_blank"')
  }
  if (lead.status === 'perdido' && !trimOrNull(lead.loss_reason)) {
    throw new DemoDbError('23514', 'new row for relation "leads" violates check constraint "leads_loss_reason_required"')
  }
  if (lead.event_end_date && (!lead.event_date || lead.event_end_date < lead.event_date)) {
    throw new DemoDbError('23514', 'new row for relation "leads" violates check constraint "leads_event_period_valid"')
  }
  if (lead.cnpj && onlyDigits(lead.cnpj).length !== 14) {
    throw new DemoDbError('23514', 'new row for relation "leads" violates check constraint "leads_cnpj_valid"')
  }
  if (lead.proposal_number && current.leads.some((other) => other.id !== lead.id && other.proposal_number === lead.proposal_number)) {
    throw new DemoDbError('23505', 'duplicate key value violates unique constraint "leads_proposal_number_key"')
  }
}

/** `sync_operational_status`: fechar/reabrir no funil acompanha a situação do evento, e vice-versa. */
function syncOperationalStatus(lead: Lead, old: Lead | null): void {
  const statusChanged = !old || lead.status !== old.status
  const operationalChanged = !!old && lead.operational_status !== old.operational_status
  if (operationalChanged && !statusChanged) {
    if ((lead.operational_status === 'confirmado' || lead.operational_status === 'realizado') && lead.status === 'em_aberto') {
      lead.status = 'fechado'
      lead.proposal_sent = true
    } else if (lead.operational_status === 'a_confirmar' && lead.status === 'fechado') {
      lead.status = 'em_aberto'
    }
  } else if (statusChanged && old && lead.status === 'em_aberto' && old.status === 'fechado') {
    lead.operational_status = 'a_confirmar'
  }
  if (lead.status === 'fechado' && lead.operational_status === 'a_confirmar') {
    const lastDay = lead.event_end_date ?? lead.event_date
    lead.operational_status = lastDay && lastDay < todayLocalIso() ? 'realizado' : 'confirmado'
  }
}

function isSuppressed(current: DemoDb, email: string | null, phone: string | null): boolean {
  return current.marketing_suppressions.some(
    (item) => (item.kind === 'email' && email && item.value === email) || (item.kind === 'phone' && phone && item.value === phone),
  )
}

/** `apply_marketing_suppression`: contato que pediu opt-out continua com opt-out nas propostas novas. */
function applySuppression(current: DemoDb, lead: Lead, old: Lead | null): void {
  if (old && old.marketing_opt_out && !lead.marketing_opt_out) return
  if (!lead.marketing_opt_out && isSuppressed(current, normalizeEmail(lead.contact_email), normalizePhone(lead.contact_phone))) {
    lead.marketing_opt_out = true
  }
}

/** `sync_marketing_suppression`: registra/remove a supressão e propaga para os outros leads do contato. */
function syncSuppression(current: DemoDb, lead: Lead, old: Lead | null): void {
  const email = normalizeEmail(lead.contact_email)
  const phone = normalizePhone(lead.contact_phone)
  const sameContact = (other: Lead) =>
    other.id !== lead.id &&
    ((email !== null && normalizeEmail(other.contact_email) === email) || (phone !== null && normalizePhone(other.contact_phone) === phone))

  if (lead.marketing_opt_out) {
    for (const [kind, value] of [
      ['email', email],
      ['phone', phone],
    ] as const) {
      if (value && !current.marketing_suppressions.some((item) => item.kind === kind && item.value === value)) {
        current.marketing_suppressions.push({ id: newId(), kind, value, source_lead_id: lead.id, created_at: nowIso() })
      }
    }
    for (const other of current.leads) if (sameContact(other)) other.marketing_opt_out = true
  } else if (old?.marketing_opt_out) {
    current.marketing_suppressions = current.marketing_suppressions.filter(
      (item) => !((item.kind === 'email' && item.value === email) || (item.kind === 'phone' && item.value === phone)),
    )
    for (const other of current.leads) if (sameContact(other)) other.marketing_opt_out = false
  }
}

function insertClient(current: DemoDb, values: Partial<Client> & { name: string }): Client {
  const client: Client = {
    id: newId(),
    name: values.name,
    client_type: values.client_type ?? 'individual',
    email_domain: values.email_domain ?? null,
    notes: values.notes ?? null,
    cnpj: values.cnpj ?? null,
    cnpj_digits: digitsOrNull(values.cnpj),
    branch_label: values.branch_label ?? null,
    created_at: values.created_at ?? nowIso(),
    updated_at: values.updated_at ?? nowIso(),
  }
  current.clients.push(client)
  return client
}

/** `find_or_create_client_contact`: mesmo e-mail = mesma pessoa; telefone só vale com o mesmo nome. */
function findOrCreateContact(current: DemoDb, clientId: string | null, name: string, phone: string | null, email: string | null): string | null {
  const contactName = trimOrNull(name)
  if (!clientId || !contactName) return null
  const normalizedEmail = normalizeEmail(email)
  const phoneKey = normalizePhone(phone)
  const candidates = current.client_contacts
    .filter((contact) => contact.client_id === clientId)
    .sort((a, b) => Number(b.active) - Number(a.active) || a.created_at.localeCompare(b.created_at))

  const found =
    (normalizedEmail && candidates.find((contact) => normalizeEmail(contact.email) === normalizedEmail)) ||
    (phoneKey && candidates.find((contact) => normalizePhone(contact.phone) === phoneKey && sameText(contact.name, contactName))) ||
    candidates.find(
      (contact) =>
        sameText(contact.name, contactName) &&
        (!normalizedEmail || !contact.email) &&
        (!phoneKey || !contact.phone || normalizePhone(contact.phone) === phoneKey),
    )

  if (found) {
    found.phone = found.phone ?? trimOrNull(phone)
    found.phone_digits = digitsOrNull(found.phone)
    found.email = found.email ?? normalizedEmail
    found.active = true
    return found.id
  }

  const contact: ClientContact = {
    id: newId(),
    client_id: clientId,
    name: contactName,
    role: null,
    phone: trimOrNull(phone),
    phone_digits: digitsOrNull(phone),
    email: normalizedEmail,
    is_primary: !candidates.some((item) => item.is_primary),
    active: true,
    created_at: nowIso(),
  }
  current.client_contacts.push(contact)
  return contact.id
}

/** `find_or_create_client` (importação): empresa pelo nome; pessoa física pelo telefone ou e-mail. */
function findOrCreateClient(current: DemoDb, lead: Lead): string {
  const company = collapseSpaces(lead.company)
  if (company) {
    const existing = current.clients
      .filter((client) => client.client_type === 'company' && sameText(client.name, company))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0]
    return (existing ?? insertClient(current, { name: company, client_type: 'company', email_domain: corporateDomain(lead.contact_email) })).id
  }
  const email = normalizeEmail(lead.contact_email)
  const phone = normalizePhone(lead.contact_phone)
  if (email || phone) {
    const contact = current.client_contacts.find((item) => {
      const owner = current.clients.find((client) => client.id === item.client_id)
      return (
        owner?.client_type === 'individual' &&
        ((email && normalizeEmail(item.email) === email) || (phone && normalizePhone(item.phone) === phone))
      )
    })
    if (contact) return contact.client_id
  }
  return insertClient(current, { name: lead.contact_name.trim(), client_type: 'individual' }).id
}

/** `link_lead_client`: garante o cliente e o contato de cada proposta. */
function linkLeadClient(current: DemoDb, lead: Lead, old: Lead | null, importing: boolean): void {
  const company = collapseSpaces(lead.company)
  const domain = corporateDomain(lead.contact_email)
  const cnpj = cnpjKey(lead.cnpj)
  let learnedCnpj = false

  if (cnpj && (!old || lead.cnpj !== old.cnpj || lead.client_id !== old.client_id)) {
    const owner = current.clients.find((client) => client.cnpj_digits === cnpj)
    const chosen = lead.client_id ? current.clients.find((client) => client.id === lead.client_id) : undefined
    if (owner) {
      lead.client_id = owner.id
    } else if (chosen && !chosen.cnpj_digits) {
      chosen.cnpj = formatCNPJ(cnpj)
      chosen.cnpj_digits = cnpj
      chosen.client_type = 'company'
      learnedCnpj = true
    } else if (chosen) {
      // Outro CNPJ da mesma marca: braço novo, com o mesmo nome
      lead.client_id = insertClient(current, {
        name: chosen.name,
        client_type: 'company',
        email_domain: chosen.email_domain,
        cnpj: formatCNPJ(cnpj),
      }).id
    } else {
      const adopted = importing
        ? current.clients.find(
            (client) => client.client_type === 'company' && !client.cnpj_digits && sameText(client.name, company ?? lead.contact_name),
          )
        : undefined
      if (adopted) {
        adopted.cnpj = formatCNPJ(cnpj)
        adopted.cnpj_digits = cnpj
        lead.client_id = adopted.id
        learnedCnpj = true
      } else {
        lead.client_id = insertClient(current, {
          name: company ?? lead.contact_name.trim(),
          client_type: 'company',
          email_domain: domain,
          cnpj: formatCNPJ(cnpj),
        }).id
      }
    }
  }

  if (!old) {
    if (!lead.client_id) {
      lead.client_id = importing
        ? findOrCreateClient(current, lead)
        : insertClient(current, {
            name: company ?? lead.contact_name.trim(),
            client_type: company ? 'company' : 'individual',
            email_domain: company ? domain : null,
          }).id
      lead.contact_id = null
    }
  } else {
    if (!lead.client_id) return
    const contactFieldsChanged =
      lead.contact_name !== old.contact_name || lead.contact_phone !== old.contact_phone || lead.contact_email !== old.contact_email
    const nothingChanged =
      lead.client_id === old.client_id &&
      lead.contact_id === old.contact_id &&
      !contactFieldsChanged &&
      lead.company === old.company &&
      lead.cnpj === old.cnpj
    if (nothingChanged) return

    const othersOfClient = current.leads.some((other) => other.client_id === lead.client_id && other.id !== lead.id)
    if (lead.client_id === old.client_id && (lead.company !== old.company || lead.contact_name !== old.contact_name) && !othersOfClient) {
      const client = current.clients.find((item) => item.id === lead.client_id)
      if (client) {
        client.name = company ?? lead.contact_name.trim()
        client.client_type = !company && !client.cnpj_digits ? 'individual' : 'company'
        client.email_domain = company ? (client.email_domain ?? domain) : null
      }
    }

    const sharedContact = current.leads.some((other) => other.contact_id === lead.contact_id && other.id !== lead.id)
    if (lead.client_id === old.client_id && lead.contact_id && lead.contact_id === old.contact_id && contactFieldsChanged && !sharedContact) {
      const contact = current.client_contacts.find((item) => item.id === lead.contact_id)
      if (contact) {
        contact.name = lead.contact_name.trim()
        contact.phone = trimOrNull(lead.contact_phone)
        contact.phone_digits = digitsOrNull(contact.phone)
        contact.email = normalizeEmail(lead.contact_email)
      }
    }
    if (lead.contact_id === old.contact_id && contactFieldsChanged && sharedContact) lead.contact_id = null
  }

  if (lead.contact_id) {
    const contact = current.client_contacts.find((item) => item.id === lead.contact_id)
    if (!contact || contact.client_id !== lead.client_id) lead.contact_id = null
  }
  if (lead.contact_id) {
    const contact = current.client_contacts.find((item) => item.id === lead.contact_id)!
    contact.phone = contact.phone ?? trimOrNull(lead.contact_phone)
    contact.phone_digits = digitsOrNull(contact.phone)
    contact.email = contact.email ?? normalizeEmail(lead.contact_email)
    contact.active = true
  } else {
    lead.contact_id = findOrCreateContact(current, lead.client_id, lead.contact_name, lead.contact_phone, lead.contact_email)
  }

  const client = current.clients.find((item) => item.id === lead.client_id)
  if (client && domain && client.client_type === 'company' && !client.email_domain) client.email_domain = domain

  if (!trimOrNull(lead.cnpj)) lead.cnpj = client?.cnpj ?? null
  else if (cnpj) lead.cnpj = formatCNPJ(cnpj)

  if (learnedCnpj) {
    for (const other of current.leads) {
      if (other.client_id === lead.client_id && other.id !== lead.id && !other.cnpj) {
        other.cnpj = lead.cnpj
        other.cnpj_digits = digitsOrNull(lead.cnpj)
      }
    }
  }
}

function pickLeadColumns(values: Row): Partial<Lead> {
  const columns = leadColumns()
  const picked: Row = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || (LEAD_GENERATED as readonly string[]).includes(key) || key === 'room_interest') continue
    if (!columns.has(key)) throw new DemoDbError('PGRST204', `Could not find the '${key}' column of 'leads' in the schema cache`)
    picked[key] = value
  }
  return picked as Partial<Lead>
}

function insertLead(current: DemoDb, values: Row, userId: string | null, importing = false): Lead {
  const timestamp = nowIso()
  const lead = {
    ...clone(LEAD_DEFAULTS),
    id: newId(),
    created_at: timestamp,
    updated_at: timestamp,
    contact_name: '',
    ...pickLeadColumns(values),
    user_id: userId,
  } as Lead
  computeLeadColumns(lead)
  syncOperationalStatus(lead, null)
  applySuppression(current, lead, null)
  validateLead(lead, current)
  linkLeadClient(current, lead, null, importing)
  computeLeadColumns(lead)
  current.leads.push(lead)
  syncSuppression(current, lead, null)
  return lead
}

function updateLead(current: DemoDb, old: Lead, patch: Row): Lead {
  const changes = pickLeadColumns(patch)
  delete changes.id
  delete changes.created_at
  // `keep_lead_author`: o autor da proposta não muda
  delete changes.user_id
  const lead = { ...clone(old), ...changes } as Lead
  computeLeadColumns(lead)
  syncOperationalStatus(lead, old)
  applySuppression(current, lead, old)
  validateLead(lead, current)
  linkLeadClient(current, lead, old, false)
  computeLeadColumns(lead)
  const changed = Object.keys(lead).some(
    (key) => !LEAD_UPDATED_AT_IGNORED.has(key) && JSON.stringify(lead[key as keyof Lead]) !== JSON.stringify(old[key as keyof Lead]),
  )
  lead.updated_at = changed ? nowIso() : old.updated_at
  const index = current.leads.findIndex((item) => item.id === old.id)
  current.leads[index] = lead
  syncSuppression(current, lead, old)
  return lead
}

/** Troca o nome de uma opção nas propostas (salas: no array, sem repetir). */
function replaceSettingLabel(current: DemoDb, category: string, oldLabel: string, newLabel: string): number {
  let count = 0
  for (const lead of current.leads) {
    if (category === 'room' && lead.room_interests.includes(oldLabel)) {
      lead.room_interests = [...new Set(lead.room_interests.map((room) => (room === oldLabel ? newLabel : room)))]
      lead.room_interest = lead.room_interests.join(' | ') || null
      count += 1
    } else if (category === 'origin' && lead.origin === oldLabel) {
      lead.origin = newLabel
      count += 1
    } else if (category === 'loss_reason' && lead.loss_reason === oldLabel) {
      lead.loss_reason = newLabel
      count += 1
    }
  }
  return count
}

// =============================================================================
// Base inicial
// =============================================================================

function seedCreatedAt(created: DemoLeadSeed['created'], now: Date): Date {
  if ('daysAgo' in created) {
    const date = new Date(now)
    date.setDate(date.getDate() - created.daysAgo)
    return date
  }
  const day = Math.min(now.getDate(), Math.max(1, Math.round(now.getDate() * created.thisMonth)))
  return new Date(now.getFullYear(), now.getMonth(), day, now.getHours(), now.getMinutes())
}

function localIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function buildSeedDb(): DemoDb {
  const randomId = newId
  let sequence = 0
  newId = () => `00000000-0000-4000-8000-${(sequence += 1).toString(16).padStart(12, '0')}`
  try {
    return buildSeedRows()
  } finally {
    newId = randomId
  }
}

function buildSeedRows(): DemoDb {
  const now = new Date()
  const daysAgo = (days: number, hour = 10) => {
    const date = new Date(now)
    date.setDate(date.getDate() - days)
    date.setHours(hour, (days * 17) % 60, 0, 0)
    return date
  }
  const current: DemoDb = {
    leads: [],
    clients: [],
    client_contacts: [],
    app_settings_options: demoOptions().map((option, index) => ({
      id: newId(),
      category: option.category,
      label: option.label,
      active: option.active ?? true,
      created_at: daysAgo(260 - index).toISOString(),
    })),
    marketing_suppressions: [],
    lead_attachments: [],
    user_profiles: demoUsers().map((user) => ({
      user_id: user.id,
      email: user.email,
      is_admin: user.is_admin,
      is_active: user.is_active,
      avatar_path: null,
      last_sign_in_at: user.lastSignInDaysAgo === null ? null : daysAgo(user.lastSignInDaysAgo, 9).toISOString(),
      created_at: daysAgo(user.createdDaysAgo).toISOString(),
    })),
    users: demoUsers().map((user) => ({
      id: user.id,
      email: user.email,
      password: DEMO_PASSWORD,
      created_at: daysAgo(user.createdDaysAgo).toISOString(),
    })),
  }

  // Ordem cronológica: os clientes e contatos nascem na primeira proposta, como no banco real
  const seeds = demoLeads().map((seed) => ({ seed, createdAt: seedCreatedAt(seed.created, now) })).sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )

  let proposalSequence = 40
  seeds.forEach(({ seed, createdAt }, index) => {
    createdAt.setHours(9 + (index % 8), (index * 13) % 60, 0, 0)
    if (createdAt > now) createdAt.setTime(now.getTime() - (seeds.length - index) * 60_000)
    const createdIso = createdAt.toISOString()

    let eventDate: string | null = null
    let eventEndDate: string | null = null
    if (seed.event) {
      const start = new Date(now)
      start.setDate(start.getDate() + seed.event.inDays)
      eventDate = localIsoDate(start)
      if ((seed.event.days ?? 1) > 1) {
        start.setDate(start.getDate() + (seed.event.days ?? 1) - 1)
        eventEndDate = localIsoDate(start)
      }
    }

    const proposalNumber = seed.lead.proposal_sent ? `${createdAt.getFullYear()}-${String((proposalSequence += 1)).padStart(4, '0')}` : null
    const lead = insertLead(
      current,
      { ...seed.lead, event_date: eventDate, event_end_date: eventEndDate, proposal_number: proposalNumber },
      DEMO_USER_IDS[seed.user],
      true,
    )

    const updatedDaysAgo = seed.updatedDaysAgo ?? 0
    const updatedAt = new Date(Math.max(createdAt.getTime(), Math.min(now.getTime(), daysAgo(updatedDaysAgo, 15).getTime())))
    lead.created_at = createdIso
    lead.updated_at = updatedAt.toISOString()

    // Cliente e contato com a data da primeira proposta
    const client = current.clients.find((item) => item.id === lead.client_id)
    if (client && client.created_at > createdIso) client.created_at = client.updated_at = createdIso
    const contact = current.client_contacts.find((item) => item.id === lead.contact_id)
    if (contact && contact.created_at > createdIso) contact.created_at = createdIso

    if (seed.attachment) {
      const label = seed.attachment === 'rental_proposal' ? 'Locação' : 'A&B'
      const safeName = (lead.company ?? lead.contact_name).replace(/[^\p{L}\p{N} ]/gu, '').trim()
      current.lead_attachments.push({
        id: newId(),
        lead_id: lead.id,
        kind: seed.attachment,
        storage_path: `${lead.id}/${seed.attachment}/demo-${index}.pdf`,
        file_name: `Proposta ${label} - ${safeName}.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 48_000 + index * 731,
        uploaded_by: DEMO_USER_IDS[seed.user],
        created_at: createdIso,
      })
    }
  })

  for (const suppression of current.marketing_suppressions) {
    const source = current.leads.find((lead) => lead.id === suppression.source_lead_id)
    if (source) suppression.created_at = source.updated_at
  }
  // Contatos com cargo, para a página do cliente ficar completa
  const roles: Record<string, string> = {
    'Patrícia Nogueira': 'Eventos Corporativos',
    'Ricardo Almeida': 'RH',
    'Marcelo Tavares': 'Diretoria Comercial',
    'Luana Prado': 'Marketing',
    'Camila Duarte': 'Marketing',
    'Gustavo Lins': 'Comunidade Dev',
    'Juliana Freitas': 'Relações com Investidores',
  }
  for (const contact of current.client_contacts) contact.role = roles[contact.name] ?? contact.role

  return current
}

// =============================================================================
// Filtros e consultas (subconjunto do PostgREST usado pelo app)
// =============================================================================

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' || typeof b === 'number') return Number(a) - Number(b)
  if (typeof a === 'boolean' || typeof b === 'boolean') return Number(a === true || a === 'true') - Number(b === true || b === 'true')
  const left = String(a)
  const right = String(b)
  if (ISO_TIMESTAMP.test(left) || ISO_TIMESTAMP.test(right)) {
    const diff = Date.parse(left) - Date.parse(right)
    if (!Number.isNaN(diff)) return diff
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(left) && /^\d{4}-\d{2}-\d{2}/.test(right)) return left < right ? -1 : left > right ? 1 : 0
  return left.localeCompare(right, 'pt-BR')
}

/** Igualdade do filtro `eq`: texto é comparado exatamente; datas, números e booleanos pelo valor. */
function equals(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string' && !ISO_TIMESTAMP.test(a)) return a === b
  return compareValues(a, b) === 0
}

function likeToRegExp(pattern: string, caseInsensitive: boolean): RegExp {
  let source = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '\\' && index + 1 < pattern.length) {
      index += 1
      source += pattern[index].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    } else if (char === '%' || char === '*') source += '.*'
    else if (char === '_') source += '.'
    else source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`, caseInsensitive ? 'is' : 's')
}

/** "{a,"b c"}" -> ['a', 'b c'] */
function parsePgArray(value: string): string[] {
  const inner = value.trim().replace(/^\{/, '').replace(/\}$/, '')
  const items: string[] = []
  let currentItem = ''
  let quoted = false
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]
    if (char === '\\' && quoted) {
      currentItem += inner[(index += 1)] ?? ''
    } else if (char === '"') quoted = !quoted
    else if (char === ',' && !quoted) {
      items.push(currentItem)
      currentItem = ''
    } else currentItem += char
  }
  if (inner.length > 0) items.push(currentItem)
  return items.map((item) => item.trim())
}

function parseScalar(value: string): unknown {
  if (value === 'null') return null
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

type Predicate = (row: Row) => boolean

function buildPredicate(column: string, operator: string, value: unknown): Predicate {
  return (row) => {
    const cell = row[column]
    switch (operator) {
      case 'eq':
        return cell !== null && cell !== undefined && equals(cell, value)
      case 'neq':
        return cell !== null && cell !== undefined && !equals(cell, value)
      case 'gt':
        return cell !== null && cell !== undefined && compareValues(cell, value) > 0
      case 'gte':
        return cell !== null && cell !== undefined && compareValues(cell, value) >= 0
      case 'lt':
        return cell !== null && cell !== undefined && compareValues(cell, value) < 0
      case 'lte':
        return cell !== null && cell !== undefined && compareValues(cell, value) <= 0
      case 'like':
      case 'ilike':
        return typeof cell === 'string' && likeToRegExp(String(value), operator === 'ilike').test(cell)
      case 'is':
        return value === null || value === 'null' ? cell === null || cell === undefined : cell === parseScalar(String(value))
      case 'in': {
        const list = Array.isArray(value) ? value : parsePgArray(String(value).replace(/^\(/, '{').replace(/\)$/, '}'))
        return cell !== null && cell !== undefined && list.some((item) => equals(cell, item))
      }
      case 'cs': {
        const list = Array.isArray(value) ? value : parsePgArray(String(value))
        return Array.isArray(cell) && list.every((item) => cell.includes(item))
      }
      case 'ov': {
        const list = Array.isArray(value) ? value : parsePgArray(String(value))
        return Array.isArray(cell) && list.some((item) => cell.includes(item))
      }
      default:
        throw new DemoDbError('PGRST100', `Operador não suportado no modo demo: ${operator}`)
    }
  }
}

/** Separa por vírgulas que não estão dentro de parênteses ou aspas. */
function splitTopLevel(value: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let currentPart = ''
  for (const char of value) {
    if (char === '"') quoted = !quoted
    if (!quoted && char === '(') depth += 1
    if (!quoted && char === ')') depth -= 1
    if (char === ',' && depth === 0 && !quoted) {
      parts.push(currentPart)
      currentPart = ''
    } else currentPart += char
  }
  if (currentPart) parts.push(currentPart)
  return parts.map((part) => part.trim()).filter(Boolean)
}

/** "coluna.operador.valor" ou "coluna.not.operador.valor" (sintaxe do `or()`). */
function parseCondition(condition: string): Predicate {
  const groupMatch = /^(and|or)\((.*)\)$/s.exec(condition)
  if (groupMatch) {
    const predicates = splitTopLevel(groupMatch[2]).map(parseCondition)
    return groupMatch[1] === 'and' ? (row) => predicates.every((p) => p(row)) : (row) => predicates.some((p) => p(row))
  }
  const [column, ...rest] = condition.split('.')
  let negate = false
  if (rest[0] === 'not') {
    negate = true
    rest.shift()
  }
  const [operator, ...valueParts] = rest
  const predicate = buildPredicate(column, operator, parseScalar(valueParts.join('.')))
  return negate ? (row) => !predicate(row) : predicate
}

type TableName = keyof DemoDb | 'client_summaries'

type Operation =
  | { kind: 'select' }
  | { kind: 'insert'; values: Row[] }
  | { kind: 'update'; values: Row }
  | { kind: 'upsert'; values: Row[] }
  | { kind: 'delete' }

type Order = { column: string; ascending: boolean; nullsFirst: boolean }

type DemoResponse = { data: unknown; error: DemoError | null; count: number | null; status: number; statusText: string }

function response(data: unknown, error: DemoError | null = null, count: number | null = null): DemoResponse {
  return { data, error, count, status: error ? 400 : 200, statusText: error ? 'Bad Request' : 'OK' }
}

const delay = () => new Promise((resolve) => window.setTimeout(resolve, LATENCY_MS))

/** Construtor de consultas encadeável e "thenable", como o do `@supabase/postgrest-js`. */
class DemoQueryBuilder implements PromiseLike<DemoResponse> {
  private table: TableName
  private operation: Operation = { kind: 'select' }
  private columns = '*'
  private returning = false
  private countMode: string | null = null
  private head = false
  private predicates: Predicate[] = []
  private orders: Order[] = []
  private rangeFrom: number | null = null
  private rangeTo: number | null = null
  private limitCount: number | null = null
  private singleMode: 'single' | 'maybeSingle' | null = null

  constructor(table: TableName) {
    this.table = table
  }

  select(columns = '*', options?: { count?: string; head?: boolean }) {
    this.columns = columns
    if (this.operation.kind === 'select') {
      this.countMode = options?.count ?? null
      this.head = options?.head ?? false
    } else {
      this.returning = true
    }
    return this
  }

  insert(values: Row | Row[]) {
    this.operation = { kind: 'insert', values: Array.isArray(values) ? values : [values] }
    return this
  }

  upsert(values: Row | Row[]) {
    this.operation = { kind: 'upsert', values: Array.isArray(values) ? values : [values] }
    return this
  }

  update(values: Row) {
    this.operation = { kind: 'update', values }
    return this
  }

  delete() {
    this.operation = { kind: 'delete' }
    return this
  }

  private where(predicate: Predicate) {
    this.predicates.push(predicate)
    return this
  }

  eq(column: string, value: unknown) {
    return this.where(buildPredicate(column, 'eq', value))
  }
  neq(column: string, value: unknown) {
    return this.where(buildPredicate(column, 'neq', value))
  }
  gt(column: string, value: unknown) {
    return this.where(buildPredicate(column, 'gt', value))
  }
  gte(column: string, value: unknown) {
    return this.where(buildPredicate(column, 'gte', value))
  }
  lt(column: string, value: unknown) {
    return this.where(buildPredicate(column, 'lt', value))
  }
  lte(column: string, value: unknown) {
    return this.where(buildPredicate(column, 'lte', value))
  }
  like(column: string, pattern: string) {
    return this.where(buildPredicate(column, 'like', pattern))
  }
  ilike(column: string, pattern: string) {
    return this.where(buildPredicate(column, 'ilike', pattern))
  }
  is(column: string, value: unknown) {
    return this.where(buildPredicate(column, 'is', value))
  }
  in(column: string, values: unknown[]) {
    return this.where(buildPredicate(column, 'in', values))
  }
  contains(column: string, value: unknown) {
    return this.where(buildPredicate(column, 'cs', value))
  }
  overlaps(column: string, value: unknown) {
    return this.where(buildPredicate(column, 'ov', value))
  }
  match(query: Row) {
    for (const [column, value] of Object.entries(query)) this.eq(column, value)
    return this
  }
  not(column: string, operator: string, value: unknown) {
    const predicate = buildPredicate(column, operator, value)
    return this.where((row) => !predicate(row))
  }
  filter(column: string, operator: string, value: unknown) {
    if (operator.startsWith('not.')) return this.not(column, operator.slice(4), value)
    return this.where(buildPredicate(column, operator, typeof value === 'string' ? parseScalar(value) : value))
  }
  or(conditions: string) {
    const predicates = splitTopLevel(conditions).map(parseCondition)
    return this.where((row) => predicates.some((predicate) => predicate(row)))
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    const ascending = options?.ascending ?? true
    this.orders.push({ column, ascending, nullsFirst: options?.nullsFirst ?? !ascending })
    return this
  }
  range(from: number, to: number) {
    this.rangeFrom = from
    this.rangeTo = to
    return this
  }
  limit(count: number) {
    this.limitCount = count
    return this
  }
  single() {
    this.singleMode = 'single'
    return this
  }
  maybeSingle() {
    this.singleMode = 'maybeSingle'
    return this
  }
  abortSignal(signal: AbortSignal) {
    void signal
    return this
  }
  returns() {
    return this
  }
  throwOnError() {
    return this
  }

  then<TResult1 = DemoResponse, TResult2 = never>(
    onfulfilled?: ((value: DemoResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return delay()
      .then(() => this.execute())
      .then(onfulfilled, onrejected)
  }

  private matches(row: Row): boolean {
    return this.predicates.every((predicate) => predicate(row))
  }

  private project(rows: Row[]): Row[] {
    const columns = this.columns
      .split(',')
      .map((column) => column.trim())
      .filter(Boolean)
    if (columns.length === 0 || columns.includes('*')) return rows.map((row) => clone(row))
    return rows.map((row) => Object.fromEntries(columns.map((column) => [column, clone(row[column] ?? null)])))
  }

  private sortRows(rows: Row[]): Row[] {
    if (this.orders.length === 0) return rows
    return [...rows].sort((a, b) => {
      for (const { column, ascending, nullsFirst } of this.orders) {
        const left = a[column]
        const right = b[column]
        const leftNull = left === null || left === undefined
        const rightNull = right === null || right === undefined
        if (leftNull && rightNull) continue
        if (leftNull) return nullsFirst ? -1 : 1
        if (rightNull) return nullsFirst ? 1 : -1
        const diff = compareValues(left, right)
        if (diff !== 0) return ascending ? diff : -diff
      }
      return 0
    })
  }

  private finish(rows: Row[], count: number | null): DemoResponse {
    if (this.singleMode) {
      if (rows.length === 1) return response(rows[0], null, count)
      if (rows.length === 0 && this.singleMode === 'maybeSingle') return response(null, null, count)
      return response(
        null,
        { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null },
        count,
      )
    }
    return response(rows, null, count)
  }

  private execute(): DemoResponse {
    try {
      const current = getDb()
      const session = getStoredSession()
      const userId = session?.user.id ?? null
      const profile = current.user_profiles.find((item) => item.user_id === userId)
      const isActive = !!profile?.is_active
      const isAdmin = isActive && !!profile?.is_admin

      if (this.operation.kind === 'select') {
        // RLS: sem login ou com acesso desativado, só o próprio perfil é visível
        let source: Row[]
        if (!isActive) source = this.table === 'user_profiles' && profile ? [profile] : []
        else source = this.table === 'client_summaries' ? buildClientSummaries(current) : (current[this.table] as Row[])
        const filtered = source.filter((row) => this.matches(row))
        const count = this.countMode ? filtered.length : null
        if (this.head) return response(null, null, count)
        let rows = this.sortRows(filtered)
        if (this.rangeFrom !== null && this.rangeTo !== null) rows = rows.slice(this.rangeFrom, this.rangeTo + 1)
        if (this.limitCount !== null) rows = rows.slice(0, this.limitCount)
        return this.finish(this.project(rows), count)
      }

      if (!isActive) throw new DemoDbError('42501', 'new row violates row-level security policy')
      const affected = mutate(current, this.table, this.operation, (row) => this.matches(row), userId!, isAdmin)
      persist()
      if (!this.returning) return response(null)
      return this.finish(this.project(affected), null)
    } catch (error) {
      return response(null, toPostgrestError(error))
    }
  }
}

function buildClientSummaries(current: DemoDb): ClientSummary[] {
  return current.clients.map((client) => {
    const leads = current.leads.filter((lead) => lead.client_id === client.id)
    const contacts = current.client_contacts.filter((contact) => contact.client_id === client.id)
    const primary = [...contacts].sort(
      (a, b) => Number(b.is_primary) - Number(a.is_primary) || Number(b.active) - Number(a.active) || a.created_at.localeCompare(b.created_at),
    )[0]
    const sum = (status: Lead['status']) =>
      round2(leads.filter((lead) => lead.status === status).reduce((total, lead) => total + lead.total_value, 0))
    const lastProposal = leads.reduce<string | null>((latest, lead) => (!latest || lead.created_at > latest ? lead.created_at : latest), null)
    const contactsText = contacts.map((contact) => [contact.name, contact.email, contact.phone, contact.phone_digits].filter(Boolean).join(' ')).join(' ')
    return {
      ...client,
      proposals_count: leads.length,
      closed_count: leads.filter((lead) => lead.status === 'fechado').length,
      open_count: leads.filter((lead) => lead.status === 'em_aberto').length,
      lost_count: leads.filter((lead) => lead.status === 'perdido').length,
      closed_revenue: sum('fechado'),
      open_revenue: sum('em_aberto'),
      last_proposal_at: lastProposal,
      contacts_count: contacts.length,
      primary_contact_id: primary?.id ?? null,
      primary_contact_name: primary?.name ?? null,
      primary_contact_phone: primary?.phone ?? null,
      primary_contact_email: primary?.email ?? null,
      primary_contact_opt_out: primary ? isSuppressed(current, normalizeEmail(primary.email), normalizePhone(primary.phone)) : false,
      search_text: [client.name, client.branch_label, client.cnpj, client.cnpj_digits, client.email_domain, contactsText]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    }
  })
}

function requireAdmin(isAdmin: boolean): void {
  if (!isAdmin) throw new DemoDbError('42501', 'new row violates row-level security policy (admin_required)')
}

function mutate(
  current: DemoDb,
  table: TableName,
  operation: Exclude<Operation, { kind: 'select' }>,
  matches: (row: Row) => boolean,
  userId: string,
  isAdmin: boolean,
): Row[] {
  if (table === 'client_summaries' || table === 'users' || table === 'marketing_suppressions') {
    throw new DemoDbError('42501', `permission denied for ${table}`)
  }
  const kind = operation.kind === 'upsert' ? 'insert' : operation.kind

  switch (table) {
    case 'leads': {
      if (kind === 'insert') return (operation as { values: Row[] }).values.map((values) => insertLead(current, values, userId))
      const targets = current.leads.filter((lead) => matches(lead as unknown as Row))
      if (kind === 'update') return targets.map((lead) => updateLead(current, lead, (operation as { values: Row }).values))
      // Exclusão de propostas: somente ADMIN (como nas políticas do banco)
      if (!isAdmin) return []
      const ids = new Set(targets.map((lead) => lead.id))
      current.leads = current.leads.filter((lead) => !ids.has(lead.id))
      current.lead_attachments = current.lead_attachments.filter((item) => !ids.has(item.lead_id))
      return targets
    }

    case 'clients': {
      if (kind === 'insert') {
        return (operation as { values: Row[] }).values.map((values) => {
          const name = collapseSpaces(values.name as string)
          if (!name) throw new DemoDbError('23514', 'new row for relation "clients" violates check constraint "clients_name_not_blank"')
          const cnpj = cnpjKey(values.cnpj as string)
          if (cnpj && current.clients.some((client) => client.cnpj_digits === cnpj)) {
            throw new DemoDbError('23505', 'duplicate key value violates unique constraint "clients_cnpj_digits_key"')
          }
          return insertClient(current, { ...(values as Partial<Client>), name, cnpj: cnpj ? formatCNPJ(cnpj) : null }) as unknown as Row
        })
      }
      const targets = current.clients.filter((client) => matches(client as unknown as Row))
      if (kind === 'update') {
        const patch = { ...(operation as { values: Row }).values } as Partial<Client>
        return targets.map((client) => {
          const oldCnpj = client.cnpj_digits
          if (patch.name !== undefined && !collapseSpaces(patch.name)) {
            throw new DemoDbError('23514', 'new row for relation "clients" violates check constraint "clients_name_not_blank"')
          }
          const nextCnpj = patch.cnpj !== undefined ? cnpjKey(patch.cnpj) : oldCnpj
          if (nextCnpj && current.clients.some((other) => other.id !== client.id && other.cnpj_digits === nextCnpj)) {
            throw new DemoDbError('23505', 'duplicate key value violates unique constraint "clients_cnpj_digits_key"')
          }
          Object.assign(client, patch, { id: client.id, created_at: client.created_at, updated_at: nowIso() })
          client.cnpj = nextCnpj ? formatCNPJ(nextCnpj) : null
          client.cnpj_digits = nextCnpj
          // `sync_client_cnpj`: o CNPJ da empresa vale para as propostas dela
          if (nextCnpj !== oldCnpj) {
            for (const lead of current.leads) {
              if (lead.client_id === client.id && (!lead.cnpj_digits || lead.cnpj_digits === oldCnpj)) {
                lead.cnpj = client.cnpj
                lead.cnpj_digits = nextCnpj
              }
            }
          }
          return client as unknown as Row
        })
      }
      if (!isAdmin) return []
      const ids = new Set(targets.map((client) => client.id))
      const contactIds = new Set(current.client_contacts.filter((contact) => ids.has(contact.client_id)).map((contact) => contact.id))
      current.clients = current.clients.filter((client) => !ids.has(client.id))
      current.client_contacts = current.client_contacts.filter((contact) => !ids.has(contact.client_id))
      for (const lead of current.leads) {
        if (lead.client_id && ids.has(lead.client_id)) lead.client_id = null
        if (lead.contact_id && contactIds.has(lead.contact_id)) lead.contact_id = null
      }
      return targets as unknown as Row[]
    }

    case 'client_contacts': {
      const ensureOnePrimary = (contact: ClientContact) => {
        if (contact.is_primary && current.client_contacts.some((other) => other.id !== contact.id && other.client_id === contact.client_id && other.is_primary)) {
          throw new DemoDbError('23505', 'duplicate key value violates unique constraint "client_contacts_one_primary_idx"')
        }
        if (!contact.name?.trim()) throw new DemoDbError('23514', 'new row for relation "client_contacts" violates check constraint "client_contacts_name_not_blank"')
      }
      if (kind === 'insert') {
        return (operation as { values: Row[] }).values.map((values) => {
          if (!current.clients.some((client) => client.id === values.client_id)) {
            throw new DemoDbError('23503', 'insert or update on table "client_contacts" violates foreign key constraint')
          }
          const contact: ClientContact = {
            id: newId(),
            client_id: values.client_id as string,
            name: String(values.name ?? '').trim(),
            role: (values.role as string | null) ?? null,
            phone: (values.phone as string | null) ?? null,
            phone_digits: digitsOrNull(values.phone as string | null),
            email: (values.email as string | null) ?? null,
            is_primary: (values.is_primary as boolean) ?? false,
            active: (values.active as boolean) ?? true,
            created_at: nowIso(),
          }
          ensureOnePrimary(contact)
          current.client_contacts.push(contact)
          return contact as unknown as Row
        })
      }
      const targets = current.client_contacts.filter((contact) => matches(contact as unknown as Row))
      if (kind === 'update') {
        const patch = (operation as { values: Row }).values
        return targets.map((contact) => {
          const next = { ...contact, ...patch, id: contact.id, client_id: contact.client_id } as ClientContact
          next.phone_digits = digitsOrNull(next.phone)
          ensureOnePrimary(next)
          Object.assign(contact, next)
          return contact as unknown as Row
        })
      }
      const ids = new Set(targets.map((contact) => contact.id))
      current.client_contacts = current.client_contacts.filter((contact) => !ids.has(contact.id))
      for (const lead of current.leads) if (lead.contact_id && ids.has(lead.contact_id)) lead.contact_id = null
      return targets as unknown as Row[]
    }

    case 'app_settings_options': {
      requireAdmin(isAdmin)
      const ensureUnique = (option: AppSettingOption) => {
        if (!option.label?.trim()) throw new DemoDbError('23514', 'new row for relation "app_settings_options" violates check constraint')
        if (current.app_settings_options.some((other) => other.id !== option.id && other.category === option.category && other.label === option.label)) {
          throw new DemoDbError('23505', 'duplicate key value violates unique constraint "app_settings_options_category_label_key"')
        }
      }
      if (kind === 'insert') {
        return (operation as { values: Row[] }).values.map((values) => {
          const option: AppSettingOption = {
            id: newId(),
            category: values.category as AppSettingOption['category'],
            label: String(values.label ?? '').trim(),
            active: (values.active as boolean) ?? true,
            created_at: nowIso(),
          }
          ensureUnique(option)
          current.app_settings_options.push(option)
          return option as unknown as Row
        })
      }
      const targets = current.app_settings_options.filter((option) => matches(option as unknown as Row))
      if (kind === 'update') {
        return targets.map((option) => {
          const next = { ...option, ...(operation as { values: Row }).values, id: option.id } as AppSettingOption
          ensureUnique(next)
          Object.assign(option, next)
          return option as unknown as Row
        })
      }
      const ids = new Set(targets.map((option) => option.id))
      current.app_settings_options = current.app_settings_options.filter((option) => !ids.has(option.id))
      return targets as unknown as Row[]
    }

    case 'lead_attachments': {
      if (kind === 'insert') {
        return (operation as { values: Row[] }).values.map((values) => {
          if (!current.leads.some((lead) => lead.id === values.lead_id)) {
            throw new DemoDbError('23503', 'insert or update on table "lead_attachments" violates foreign key constraint')
          }
          const attachment = {
            ...(values as unknown as LeadAttachment),
            id: newId(),
            uploaded_by: userId,
            created_at: nowIso(),
          }
          current.lead_attachments.push(attachment)
          return attachment as unknown as Row
        })
      }
      if (kind === 'update') throw new DemoDbError('42501', 'permission denied for lead_attachments')
      if (!isAdmin) return []
      const targets = current.lead_attachments.filter((item) => matches(item as unknown as Row))
      const ids = new Set(targets.map((item) => item.id))
      current.lead_attachments = current.lead_attachments.filter((item) => !ids.has(item.id))
      return targets as unknown as Row[]
    }

    case 'user_profiles': {
      if (kind !== 'update') throw new DemoDbError('42501', 'permission denied for user_profiles')
      // O próprio usuário só altera a foto
      const patch = (operation as { values: Row }).values
      const targets = current.user_profiles.filter((profile) => profile.user_id === userId && matches(profile as unknown as Row))
      for (const profile of targets) if ('avatar_path' in patch) profile.avatar_path = (patch.avatar_path as string | null) ?? null
      return targets as unknown as Row[]
    }

    default:
      throw new DemoDbError('42P01', `relation "${table}" does not exist`)
  }
}

// =============================================================================
// RPCs
// =============================================================================

class DemoRpcBuilder implements PromiseLike<DemoResponse> {
  private name: string
  private args: Row
  private singleMode = false

  constructor(name: string, args: Row) {
    this.name = name
    this.args = args
  }

  single() {
    this.singleMode = true
    return this
  }
  maybeSingle() {
    this.singleMode = true
    return this
  }
  abortSignal(signal: AbortSignal) {
    void signal
    return this
  }

  then<TResult1 = DemoResponse, TResult2 = never>(
    onfulfilled?: ((value: DemoResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return delay()
      .then(() => this.execute())
      .then(onfulfilled, onrejected)
  }

  private execute(): DemoResponse {
    try {
      const current = getDb()
      const userId = getStoredSession()?.user.id ?? null
      const me = current.user_profiles.find((profile) => profile.user_id === userId)
      const isAdmin = !!me?.is_active && !!me.is_admin
      const data = this.run(current, userId, isAdmin)
      persist()
      return response(this.singleMode && Array.isArray(data) ? (data[0] ?? null) : clone(data))
    } catch (error) {
      return response(null, toPostgrestError(error))
    }
  }

  private run(current: DemoDb, userId: string | null, isAdmin: boolean): unknown {
    const args = this.args
    switch (this.name) {
      case 'is_admin':
        return isAdmin

      case 'admin_set_user_access': {
        requireAdmin(isAdmin)
        if (args.p_user_id === userId) throw new DemoDbError('P0001', 'self_access_change')
        const profile = current.user_profiles.find((item) => item.user_id === args.p_user_id)
        if (!profile) throw new DemoDbError('P0002', 'user_not_found')
        if (typeof args.p_is_admin === 'boolean') profile.is_admin = args.p_is_admin
        if (typeof args.p_is_active === 'boolean') profile.is_active = args.p_is_active
        return profile
      }

      case 'admin_rename_setting_option': {
        requireAdmin(isAdmin)
        const label = String(args.p_label ?? '').trim().replace(/\s+/g, ' ')
        if (!label) throw new DemoDbError('23514', 'empty_label')
        const option = current.app_settings_options.find((item) => item.id === args.p_option_id)
        if (!option) throw new DemoDbError('P0002', 'option_not_found')
        if (option.label === label) return option
        if (current.app_settings_options.some((item) => item.id !== option.id && item.category === option.category && item.label === label)) {
          throw new DemoDbError('23505', 'duplicate key value violates unique constraint "app_settings_options_category_label_key"')
        }
        const oldLabel = option.label
        option.label = label
        replaceSettingLabel(current, option.category, oldLabel, label)
        return option
      }

      case 'admin_delete_setting_option': {
        requireAdmin(isAdmin)
        const option = current.app_settings_options.find((item) => item.id === args.p_option_id)
        if (!option) throw new DemoDbError('P0002', 'option_not_found')
        let moved = 0
        if (args.p_replacement_id) {
          const replacement = current.app_settings_options.find((item) => item.id === args.p_replacement_id)
          if (!replacement || replacement.category !== option.category || replacement.id === option.id) {
            throw new DemoDbError('P0001', 'invalid_replacement')
          }
          moved = replaceSettingLabel(current, option.category, option.label, replacement.label)
        }
        current.app_settings_options = current.app_settings_options.filter((item) => item.id !== option.id)
        return moved
      }

      default:
        throw new DemoDbError('PGRST202', `Could not find the function public.${this.name} in the schema cache`)
    }
  }
}

// =============================================================================
// Storage (arquivos em memória + sessionStorage para os pequenos)
// =============================================================================

const BUCKETS = new Set(['lead-attachments', 'avatars'])
const memoryFiles = new Map<string, { blob: Blob; url: string }>()

function readPersistedFiles(): Record<string, string> {
  try {
    return JSON.parse(readStorage(FILES_STORAGE_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(header)?.[1] ?? 'application/octet-stream'
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  return new Blob([bytes], { type: mime })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** PDF de uma página, gerado na hora para os anexos da base fictícia. */
function buildDemoPdf(title: string): Blob {
  const ascii = (value: string) =>
    value
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/[\\()]/g, '\\$&')
  const lines = [
    ['F2', 20, title],
    ['F1', 12, 'Documento ficticio gerado pelo Modo Demonstracao (portfolio).'],
    ['F1', 12, 'Nenhum dado deste arquivo pertence a clientes reais.'],
    ['F1', 12, `Gerado em ${new Date().toLocaleDateString('pt-BR')}.`],
  ] as const
  const content = lines
    .map(([font, size, text], index) => `BT /${font} ${size} Tf 56 ${760 - index * 32} Td (${ascii(text)}) Tj ET`)
    .join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ]
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Blob([pdf], { type: 'application/pdf' })
}

function findFile(bucket: string, path: string): { blob: Blob; url: string } | null {
  const key = `${bucket}/${path}`
  const cached = memoryFiles.get(key)
  if (cached) return cached
  const persisted = readPersistedFiles()[key]
  let blob: Blob | null = persisted ? dataUrlToBlob(persisted) : null
  if (!blob && bucket === 'lead-attachments') {
    const attachment = getDb().lead_attachments.find((item) => item.storage_path === path)
    if (attachment) blob = buildDemoPdf(attachment.file_name.replace(/\.[^.]+$/, ''))
  }
  if (!blob) return null
  const file = { blob, url: URL.createObjectURL(blob) }
  memoryFiles.set(key, file)
  return file
}

type StorageError = { message: string; name: string; statusCode: string }
const storageError = (message: string, statusCode = '400'): StorageError => ({ message, name: 'StorageApiError', statusCode })

function storageBucket(bucket: string) {
  const check = () => {
    if (!BUCKETS.has(bucket)) return storageError('Bucket not found', '404')
    if (!getStoredSession()) return storageError('new row violates row-level security policy (unauthorized)', '403')
    return null
  }
  return {
    async upload(path: string, file: Blob, options?: { contentType?: string; upsert?: boolean }) {
      await delay()
      const error = check()
      if (error) return { data: null, error }
      const key = `${bucket}/${path}`
      if (!options?.upsert && (memoryFiles.has(key) || key in readPersistedFiles())) {
        return { data: null, error: storageError('The resource already exists', '409') }
      }
      const blob = options?.contentType && file.type !== options.contentType ? new Blob([file], { type: options.contentType }) : file
      memoryFiles.set(key, { blob, url: URL.createObjectURL(blob) })
      if (blob.size <= MAX_PERSISTED_FILE_BYTES) {
        try {
          const persisted = readPersistedFiles()
          persisted[key] = await blobToDataUrl(blob)
          writeStorage(FILES_STORAGE_KEY, JSON.stringify(persisted))
        } catch {
          // Sem espaço no sessionStorage: o arquivo vale até recarregar a página
        }
      }
      return { data: { id: key, path, fullPath: key }, error: null }
    },

    async createSignedUrl(path: string, expiresIn: number, options?: { download?: string | boolean }) {
      void expiresIn
      void options
      await delay()
      const error = check()
      if (error) return { data: null, error }
      const file = findFile(bucket, path)
      if (!file) return { data: null, error: storageError('Object not found', '404') }
      return { data: { signedUrl: file.url }, error: null }
    },

    async remove(paths: string[]) {
      await delay()
      const error = check()
      if (error) return { data: null, error }
      const persisted = readPersistedFiles()
      for (const path of paths) {
        const key = `${bucket}/${path}`
        const file = memoryFiles.get(key)
        if (file) URL.revokeObjectURL(file.url)
        memoryFiles.delete(key)
        delete persisted[key]
      }
      writeStorage(FILES_STORAGE_KEY, JSON.stringify(persisted))
      return { data: paths.map((path) => ({ name: path })), error: null }
    },
  }
}

// =============================================================================
// Auth
// =============================================================================

type AuthEvent = 'INITIAL_SESSION' | 'SIGNED_IN' | 'SIGNED_OUT' | 'USER_UPDATED' | 'PASSWORD_RECOVERY' | 'TOKEN_REFRESHED'
type AuthListener = (event: AuthEvent, session: Session | null) => void

const authListeners = new Set<AuthListener>()

function getStoredSession(): Session | null {
  const saved = readStorage(SESSION_STORAGE_KEY)
  if (!saved) return null
  try {
    return JSON.parse(saved) as Session
  } catch {
    return null
  }
}

/** Avisa os ouvintes antes de a chamada terminar, como o supabase-js (a tela já encontra a sessão nova). */
function emitAuth(event: AuthEvent, session: Session | null): void {
  for (const listener of [...authListeners]) listener(event, session)
}

const base64Url = (value: string) => btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function buildSession(user: DemoUser, lastSignInAt: string): Session {
  const expiresAt = Math.floor(Date.now() / 1000) + 60 * 60 * 24
  const claims = {
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    aud: 'authenticated',
    exp: expiresAt,
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
  }
  const authUser: User = {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: user.created_at,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: user.created_at,
    last_sign_in_at: lastSignInAt,
  }
  return {
    access_token: `${base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${base64Url(JSON.stringify(claims))}.demo`,
    refresh_token: 'demo-refresh-token',
    token_type: 'bearer',
    expires_in: 60 * 60 * 24,
    expires_at: expiresAt,
    user: authUser,
  }
}

type DemoAuthError = { message: string; code: string; status: number; name: string }
const authError = (code: string, message: string, status = 400): DemoAuthError => ({ code, message, status, name: 'AuthApiError' })

const demoAuth = {
  async getSession() {
    return { data: { session: getStoredSession() }, error: null }
  },

  async getUser() {
    const session = getStoredSession()
    return session
      ? { data: { user: session.user }, error: null }
      : { data: { user: null }, error: authError('session_not_found', 'Auth session missing!', 401) }
  },

  onAuthStateChange(callback: AuthListener) {
    authListeners.add(callback)
    window.setTimeout(() => callback('INITIAL_SESSION', getStoredSession()), 0)
    return {
      data: {
        subscription: {
          id: 'demo-subscription',
          callback,
          unsubscribe: () => authListeners.delete(callback),
        },
      },
    }
  },

  async signInWithPassword(credentials: { email: string; password: string }) {
    await delay()
    const current = getDb()
    const email = credentials.email.trim().toLowerCase()
    const user = current.users.find((item) => item.email === email)
    if (!user || user.password !== credentials.password) {
      return { data: { user: null, session: null }, error: authError('invalid_credentials', 'Invalid login credentials') }
    }
    const signedInAt = nowIso()
    const profile = current.user_profiles.find((item) => item.user_id === user.id)
    if (profile) profile.last_sign_in_at = signedInAt
    persist()
    const session = buildSession(user, signedInAt)
    writeStorage(SESSION_STORAGE_KEY, JSON.stringify(session))
    emitAuth('SIGNED_IN', session)
    return { data: { user: session.user, session }, error: null }
  },

  async signOut() {
    writeStorage(SESSION_STORAGE_KEY, null)
    emitAuth('SIGNED_OUT', null)
    return { error: null }
  },

  async updateUser(attributes: { password?: string }) {
    await delay()
    const session = getStoredSession()
    if (!session) return { data: { user: null }, error: authError('session_not_found', 'Auth session missing!', 401) }
    const current = getDb()
    const user = current.users.find((item) => item.id === session.user.id)
    if (!user) return { data: { user: null }, error: authError('user_not_found', 'User not found', 404) }
    if (attributes.password !== undefined) {
      if (attributes.password === user.password) {
        return { data: { user: null }, error: authError('same_password', 'New password should be different from the old password.', 422) }
      }
      if (attributes.password.length < 6) {
        return { data: { user: null }, error: authError('weak_password', 'Password should be at least 6 characters.', 422) }
      }
      user.password = attributes.password
      persist()
    }
    emitAuth('USER_UPDATED', session)
    return { data: { user: session.user }, error: null }
  },

  async resetPasswordForEmail(email: string, options?: unknown) {
    void email
    void options
    await delay()
    // Na demonstração nenhum e-mail é enviado; a resposta é a mesma do Supabase (neutra)
    return { data: {}, error: null }
  },
}

// =============================================================================
// Cliente
// =============================================================================

/** Cliente com a mesma interface usada pelo app, respondido localmente. */
export function createDemoClient(): SupabaseClient<Database> {
  const client = {
    auth: demoAuth,
    from: (table: string) => new DemoQueryBuilder(table as TableName),
    rpc: (name: string, args: Row = {}) => new DemoRpcBuilder(name, args),
    storage: { from: (bucket: string) => storageBucket(bucket) },
  }
  return client as unknown as SupabaseClient<Database>
}
