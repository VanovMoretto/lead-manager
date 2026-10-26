import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isValidEmail, isValidPhoneBR, onlyDigits } from '../lib/format'
import { escapeLikePattern } from '../lib/contactIdentity'
import type { Lead } from '../types/lead'

const DEBOUNCE_MS = 600
const MAX_ROWS_PER_QUERY = 100

const PREVIOUS_LEAD_COLUMNS =
  'id, created_at, status, room_interests, room_interest, contact_phone_digits, contact_email, marketing_opt_out'

export type PreviousLead = Pick<
  Lead,
  'id' | 'created_at' | 'status' | 'room_interests' | 'room_interest' | 'contact_phone_digits' | 'contact_email' | 'marketing_opt_out'
>

export type RecurringClientMatch = {
  /** Quantidade de solicitações anteriores (sem repetir lead que bate por telefone e e-mail). */
  count: number
  /** Solicitação mais recente. */
  last: PreviousLead
  /** Por qual dado o cliente foi reconhecido. */
  matchedByPhone: boolean
  matchedByEmail: boolean
}

export type RecurringClientResult = {
  match: RecurringClientMatch | null
  /**
   * O contato pediu opt-out de comunicações (LGPD): está na lista de supressão
   * (vale mesmo que os leads antigos tenham sido excluídos) ou algum lead anterior tem opt-out.
   */
  suppressed: boolean
}

/** Busca leads anteriores e a lista de supressão pelo mesmo telefone (dígitos) ou e-mail (sem diferenciar maiúsculas). */
async function findPreviousLeads(phoneDigits: string, email: string, excludeId?: string): Promise<RecurringClientResult> {
  const leadRequests = []
  if (phoneDigits) {
    leadRequests.push(
      supabase
        .from('leads')
        .select(PREVIOUS_LEAD_COLUMNS)
        .eq('contact_phone_digits', phoneDigits)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS_PER_QUERY),
    )
  }
  if (email) {
    leadRequests.push(
      supabase
        .from('leads')
        .select(PREVIOUS_LEAD_COLUMNS)
        .ilike('contact_email', escapeLikePattern(email))
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS_PER_QUERY),
    )
  }

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

  const byId = new Map<string, PreviousLead>()
  for (const response of responses) {
    if (response.error) throw response.error
    for (const row of (response.data ?? []) as PreviousLead[]) {
      if (row.id !== excludeId) byId.set(row.id, row)
    }
  }

  // A lista de supressão é a fonte principal; se ela não estiver disponível, os leads anteriores ainda avisam
  const suppressedByList = suppressionResponses.some((response) => !response.error && (response.data?.length ?? 0) > 0)
  const rows = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const suppressed = suppressedByList || rows.some((row) => row.marketing_opt_out)

  if (rows.length === 0) return { match: null, suppressed }

  return {
    match: {
      count: rows.length,
      last: rows[0],
      matchedByPhone: Boolean(phoneDigits) && rows.some((row) => row.contact_phone_digits === phoneDigits),
      matchedByEmail: Boolean(email) && rows.some((row) => row.contact_email?.toLowerCase() === email),
    },
    suppressed,
  }
}

type UseRecurringClientParams = {
  phone: string
  email: string
  /** Só consulta quando true (ex.: apenas no cadastro de lead novo). */
  enabled: boolean
  /** Lead a ignorar na busca (o próprio lead, em edição). */
  excludeId?: string
}

type RecurringState = { key: string; result: RecurringClientResult }

const EMPTY_RESULT: RecurringClientResult = { match: null, suppressed: false }

/**
 * Detecta cliente recorrente e opt-out (LGPD) enquanto o vendedor digita telefone/e-mail.
 * Espera o usuário parar de digitar e só consulta com telefone completo ou e-mail válido.
 * Falhas de rede são silenciosas: o aviso é informativo, e o banco aplica o opt-out de qualquer forma.
 */
export function useRecurringClient({ phone, email, enabled, excludeId }: UseRecurringClientParams) {
  const phoneDigits = isValidPhoneBR(phone) ? onlyDigits(phone) : ''
  const normalizedEmail = isValidEmail(email) ? email.trim().toLowerCase() : ''
  const key = enabled && (phoneDigits || normalizedEmail) ? `${phoneDigits}|${normalizedEmail}|${excludeId ?? ''}` : ''

  const [state, setState] = useState<RecurringState | null>(null)

  useEffect(() => {
    if (!key) return
    let isActive = true
    const timeout = window.setTimeout(() => {
      findPreviousLeads(phoneDigits, normalizedEmail, excludeId)
        .then((result) => {
          if (isActive) setState({ key, result })
        })
        .catch(() => {
          if (isActive) setState({ key, result: EMPTY_RESULT })
        })
    }, DEBOUNCE_MS)

    return () => {
      isActive = false
      window.clearTimeout(timeout)
    }
  }, [key, phoneDigits, normalizedEmail, excludeId])

  const result = key !== '' && state?.key === key ? state.result : EMPTY_RESULT
  return {
    checking: key !== '' && state?.key !== key,
    match: result.match,
    suppressed: result.suppressed,
  }
}
