import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isValidCNPJ, isValidEmail, isValidPhoneBR, onlyDigits } from '../lib/format'
import { lookupCnpj, type CnpjLookupResult } from '../lib/cnpj'
import { escapeLikePattern } from '../lib/contactIdentity'
import { getCorporateEmailDomain, normalizeCompanyName } from '../lib/clientIdentity'
import type { Client, ClientContact, Lead } from '../types/lead'

const DEBOUNCE_MS = 600
const MAX_ROWS_PER_QUERY = 100
const MAX_HISTORY_ROWS = 500
const MIN_COMPANY_LENGTH = 2

const CONTACT_COLUMNS = 'id, client_id, name, role, phone, phone_digits, email, is_primary, active, created_at'
const HISTORY_COLUMNS = 'id, created_at, status, total_value, room_interests, room_interest, contact_id'

/** Por qual dado o cliente foi reconhecido. */
export type ClientMatchReason = 'cnpj' | 'email' | 'phone' | 'company' | 'domain'

/** Peso de cada sinal: o CNPJ identifica o braço da empresa; e-mail, a pessoa; domínio só aponta a empresa. */
const REASON_WEIGHT: Record<ClientMatchReason, number> = { cnpj: 20, email: 8, phone: 4, company: 3, domain: 2 }
/** Braço escolhido pelo vendedor no cartão vence os outros sinais. */
const PREFERRED_BONUS = 100

const CLIENT_COLUMNS = 'id, name, client_type, email_domain, cnpj, branch_label'

/** Um cadastro (braço) da empresa: matriz, filial ou franquia com CNPJ próprio. */
export type ClientBranch = Pick<Client, 'id' | 'name' | 'cnpj' | 'branch_label'>

export type ClientHistoryLead = Pick<
  Lead,
  'id' | 'created_at' | 'status' | 'total_value' | 'room_interests' | 'room_interest' | 'contact_id'
>

export type RecurringClientMatch = {
  client: Pick<Client, 'id' | 'name' | 'client_type' | 'email_domain' | 'cnpj' | 'branch_label'>
  reasons: ClientMatchReason[]
  /** Cadastros com o mesmo nome de empresa (braços); com mais de um, o vendedor escolhe. */
  branches: ClientBranch[]
  /** Pessoas de contato ativas, a principal primeiro. */
  contacts: ClientContact[]
  /** Contato reconhecido pelo e-mail ou telefone digitado. */
  matchedContactId: string | null
  /** Propostas anteriores do cliente. */
  count: number
  closedCount: number
  /** Receita das propostas fechadas. */
  closedRevenue: number
  /** Proposta mais recente. */
  last: ClientHistoryLead | null
}

export type RecurringClientResult = {
  match: RecurringClientMatch | null
  /**
   * O contato pediu opt-out de comunicações (LGPD): está na lista de supressão
   * (vale mesmo que os leads antigos tenham sido excluídos) ou algum lead anterior tem opt-out.
   */
  suppressed: boolean
  /** CNPJ válido que ainda não está no banco, encontrado na Receita Federal (BrasilAPI). */
  cnpjLookup: CnpjLookupResult | null
}

type Signals = {
  cnpjDigits: string
  preferredClientId?: string
  phoneDigits: string
  email: string
  domain: string
  company: string
  excludeId?: string
}

/** Opt-out pelo mesmo telefone (dígitos) ou e-mail: lista de supressão e leads anteriores. */
async function findSuppression({ phoneDigits, email, excludeId }: Signals): Promise<boolean> {
  if (!phoneDigits && !email) return false

  const leadRequests = [
    ...(phoneDigits
      ? [supabase.from('leads').select('id, marketing_opt_out').eq('contact_phone_digits', phoneDigits).limit(MAX_ROWS_PER_QUERY)]
      : []),
    ...(email
      ? [supabase.from('leads').select('id, marketing_opt_out').ilike('contact_email', escapeLikePattern(email)).limit(MAX_ROWS_PER_QUERY)]
      : []),
  ]
  const suppressionKeys = [
    ...(email ? [{ kind: 'email' as const, value: email }] : []),
    ...(phoneDigits ? [{ kind: 'phone' as const, value: phoneDigits }] : []),
  ]
  const suppressionRequest = Promise.all(
    suppressionKeys.map((key) =>
      supabase.from('marketing_suppressions').select('id').eq('kind', key.kind).eq('value', key.value).limit(1),
    ),
  )

  const [responses, suppressionResponses] = await Promise.all([Promise.all(leadRequests), suppressionRequest])

  // A lista de supressão é a fonte principal; se ela não estiver disponível, os leads anteriores ainda avisam
  const suppressedByList = suppressionResponses.some((response) => !response.error && (response.data?.length ?? 0) > 0)
  const suppressedByLeads = responses.some(
    (response) => !response.error && (response.data ?? []).some((row) => row.id !== excludeId && row.marketing_opt_out),
  )
  return suppressedByList || suppressedByLeads
}

type Candidate = { score: number; reasons: Set<ClientMatchReason>; contactId: string | null; contactScore: number }

/** Cruza telefone, e-mail, domínio corporativo e nome da empresa com os clientes já cadastrados. */
async function findClientMatch({
  cnpjDigits,
  preferredClientId,
  phoneDigits,
  email,
  domain,
  company,
  excludeId,
}: Signals): Promise<RecurringClientMatch | null> {
  const candidates = new Map<string, Candidate>()
  const add = (clientId: string, reason: ClientMatchReason, contactId: string | null = null) => {
    const candidate = candidates.get(clientId) ?? { score: 0, reasons: new Set(), contactId: null, contactScore: 0 }
    if (!candidate.reasons.has(reason)) {
      candidate.reasons.add(reason)
      candidate.score += REASON_WEIGHT[reason]
    }
    if (contactId && REASON_WEIGHT[reason] > candidate.contactScore) {
      candidate.contactId = contactId
      candidate.contactScore = REASON_WEIGHT[reason]
    }
    candidates.set(clientId, candidate)
  }

  const [byCnpj, byLeadCnpj, byPhone, byEmail, byDomain, byCompany] = await Promise.all([
    cnpjDigits ? supabase.from('clients').select('id').eq('cnpj_digits', cnpjDigits).limit(1) : null,
    cnpjDigits
      ? supabase.from('leads').select('client_id').eq('cnpj_digits', cnpjDigits).not('client_id', 'is', null).limit(MAX_ROWS_PER_QUERY)
      : null,
    phoneDigits
      ? supabase.from('client_contacts').select('id, client_id').eq('phone_digits', phoneDigits).limit(MAX_ROWS_PER_QUERY)
      : null,
    email
      ? supabase.from('client_contacts').select('id, client_id').ilike('email', escapeLikePattern(email)).limit(MAX_ROWS_PER_QUERY)
      : null,
    domain
      ? supabase.from('clients').select('id').eq('client_type', 'company').eq('email_domain', domain).limit(MAX_ROWS_PER_QUERY)
      : null,
    company
      ? supabase
          .from('clients')
          .select('id, name, cnpj, branch_label')
          .eq('client_type', 'company')
          .ilike('name', escapeLikePattern(company))
          .order('created_at', { ascending: true })
          .limit(MAX_ROWS_PER_QUERY)
      : null,
  ])

  for (const response of [byCnpj, byLeadCnpj, byPhone, byEmail, byDomain, byCompany]) {
    if (response?.error) throw response.error
  }
  byCnpj?.data?.forEach((row) => add(row.id, 'cnpj'))
  byLeadCnpj?.data?.forEach((row) => row.client_id && add(row.client_id, 'cnpj'))
  byPhone?.data?.forEach((row) => add(row.client_id, 'phone', row.id))
  byEmail?.data?.forEach((row) => add(row.client_id, 'email', row.id))
  byDomain?.data?.forEach((row) => add(row.id, 'domain'))
  byCompany?.data?.forEach((row) => add(row.id, 'company'))

  if (preferredClientId) {
    const preferred = candidates.get(preferredClientId)
    if (preferred) preferred.score += PREFERRED_BONUS
  }
  const best = [...candidates.entries()].sort((a, b) => b[1].score - a[1].score)[0]
  if (!best) return null
  const [clientId, candidate] = best

  const [clientResponse, contactsResponse, historyResponse] = await Promise.all([
    supabase.from('clients').select(CLIENT_COLUMNS).eq('id', clientId).maybeSingle(),
    supabase
      .from('client_contacts')
      .select(CONTACT_COLUMNS)
      .eq('client_id', clientId)
      .order('is_primary', { ascending: false })
      .order('created_at', { ascending: true }),
    supabase
      .from('leads')
      .select(HISTORY_COLUMNS)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_ROWS),
  ])
  if (clientResponse.error) throw clientResponse.error
  if (contactsResponse.error) throw contactsResponse.error
  if (historyResponse.error) throw historyResponse.error
  if (!clientResponse.data) return null

  const history = (historyResponse.data ?? []).filter((row) => row.id !== excludeId)
  const closed = history.filter((row) => row.status === 'fechado')
  const contacts = (contactsResponse.data ?? []).filter((contact) => contact.active || contact.id === candidate.contactId)

  // Braços da mesma marca: os cadastros com o nome digitado, ou com o nome do cliente encontrado
  let branches: ClientBranch[] = byCompany?.data ?? []
  if (!branches.some((branch) => branch.id === clientId) && clientResponse.data.client_type === 'company') {
    const { data } = await supabase
      .from('clients')
      .select('id, name, cnpj, branch_label')
      .eq('client_type', 'company')
      .ilike('name', escapeLikePattern(clientResponse.data.name))
      .order('created_at', { ascending: true })
      .limit(MAX_ROWS_PER_QUERY)
    branches = data ?? []
  }

  return {
    client: clientResponse.data,
    reasons: (['cnpj', 'email', 'phone', 'company', 'domain'] as const).filter((reason) => candidate.reasons.has(reason)),
    branches,
    contacts,
    matchedContactId: candidate.contactId,
    count: history.length,
    closedCount: closed.length,
    closedRevenue: closed.reduce((sum, row) => sum + Number(row.total_value ?? 0), 0),
    last: history[0] ?? null,
  }
}

type UseRecurringClientParams = {
  cnpj: string
  /** Braço escolhido pelo vendedor no cartão. */
  preferredClientId?: string
  phone: string
  email: string
  company: string
  /** Só consulta quando true (ex.: apenas no cadastro de lead novo). */
  enabled: boolean
  /** Lead a ignorar na busca (o próprio lead, em edição). */
  excludeId?: string
}

type RecurringState = { key: string; result: RecurringClientResult }

const EMPTY_RESULT: RecurringClientResult = { match: null, suppressed: false, cnpjLookup: null }

/**
 * Reconhece um cliente já cadastrado enquanto o vendedor digita: pelo telefone, e-mail,
 * nome da empresa ou domínio corporativo do e-mail. Também detecta opt-out (LGPD).
 * Espera o usuário parar de digitar e só consulta com dados completos.
 * Falhas de rede são silenciosas: o aviso é informativo, e o banco aplica o opt-out de qualquer forma.
 */
export function useRecurringClient({ cnpj, preferredClientId, phone, email, company, enabled, excludeId }: UseRecurringClientParams) {
  const cnpjDigits = isValidCNPJ(cnpj) ? onlyDigits(cnpj) : ''
  const phoneDigits = isValidPhoneBR(phone) ? onlyDigits(phone) : ''
  const normalizedEmail = isValidEmail(email) ? email.trim().toLowerCase() : ''
  const domain = getCorporateEmailDomain(email)
  const companyName = normalizeCompanyName(company)
  const normalizedCompany = companyName.length >= MIN_COMPANY_LENGTH ? companyName.toLocaleLowerCase('pt-BR') : ''
  const hasSignal = Boolean(cnpjDigits || phoneDigits || normalizedEmail || normalizedCompany)
  const key =
    enabled && hasSignal
      ? [cnpjDigits, preferredClientId ?? '', phoneDigits, normalizedEmail, normalizedCompany, excludeId ?? ''].join('|')
      : ''

  const [state, setState] = useState<RecurringState | null>(null)

  useEffect(() => {
    if (!key) return
    let isActive = true
    const controller = new AbortController()
    const signals: Signals = {
      cnpjDigits,
      preferredClientId,
      phoneDigits,
      email: normalizedEmail,
      domain,
      company: normalizedCompany,
      excludeId,
    }
    const timeout = window.setTimeout(() => {
      Promise.all([findSuppression(signals).catch(() => false), findClientMatch(signals).catch(() => null)])
        .then(async ([suppressed, match]) => {
          // CNPJ válido que não está no banco: tenta os dados públicos da Receita
          const cnpjLookup =
            cnpjDigits && !match?.reasons.includes('cnpj') ? await lookupCnpj(cnpjDigits, controller.signal) : null
          return { match, suppressed, cnpjLookup }
        })
        .then((result) => {
          if (isActive) setState({ key, result })
        })
    }, DEBOUNCE_MS)

    return () => {
      isActive = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [key, cnpjDigits, preferredClientId, phoneDigits, normalizedEmail, domain, normalizedCompany, excludeId])

  const result = key !== '' && state?.key === key ? state.result : EMPTY_RESULT
  const checking = key !== '' && state?.key !== key
  return {
    checking,
    // Enquanto confere os dados novos, mantém o cliente já encontrado na tela (evita o cartão piscar)
    match: checking ? (state?.result.match ?? null) : result.match,
    suppressed: result.suppressed,
    cnpjLookup: result.cnpjLookup,
  }
}

/** Escolha do vendedor diante de um cliente reconhecido. */
export type ClientLinkChoice = {
  clientId: string
  /** true = "Sim, adicionar ao histórico"; false = "Não, criar cadastro separado". */
  link: boolean
  /** Pessoa de contato escolhida; nulo = novo contato do cliente. */
  contactId: string | null
}
