import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isValidEmail, isValidPhoneBR, onlyDigits } from '../lib/format'
import { escapeLikePattern } from '../lib/contactIdentity'
import type { Lead } from '../types/lead'

const DEBOUNCE_MS = 600
const MAX_ROWS_PER_QUERY = 100

const PREVIOUS_LEAD_COLUMNS = 'id, created_at, status, room_interests, room_interest, contact_phone_digits, contact_email'

export type PreviousLead = Pick<
  Lead,
  'id' | 'created_at' | 'status' | 'room_interests' | 'room_interest' | 'contact_phone_digits' | 'contact_email'
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

/** Busca leads anteriores com o mesmo telefone (dígitos) ou o mesmo e-mail (sem diferenciar maiúsculas). */
async function findPreviousLeads(phoneDigits: string, email: string, excludeId?: string): Promise<RecurringClientMatch | null> {
  const requests = []
  if (phoneDigits) {
    requests.push(
      supabase
        .from('leads')
        .select(PREVIOUS_LEAD_COLUMNS)
        .eq('contact_phone_digits', phoneDigits)
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS_PER_QUERY),
    )
  }
  if (email) {
    requests.push(
      supabase
        .from('leads')
        .select(PREVIOUS_LEAD_COLUMNS)
        .ilike('contact_email', escapeLikePattern(email))
        .order('created_at', { ascending: false })
        .limit(MAX_ROWS_PER_QUERY),
    )
  }

  const responses = await Promise.all(requests)
  const byId = new Map<string, PreviousLead>()
  for (const response of responses) {
    if (response.error) throw response.error
    for (const row of (response.data ?? []) as PreviousLead[]) {
      if (row.id !== excludeId) byId.set(row.id, row)
    }
  }

  const rows = [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
  if (rows.length === 0) return null

  return {
    count: rows.length,
    last: rows[0],
    matchedByPhone: Boolean(phoneDigits) && rows.some((row) => row.contact_phone_digits === phoneDigits),
    matchedByEmail: Boolean(email) && rows.some((row) => row.contact_email?.toLowerCase() === email),
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

type RecurringState = { key: string; match: RecurringClientMatch | null }

/**
 * Detecta cliente recorrente enquanto o vendedor digita telefone/e-mail.
 * Espera o usuário parar de digitar e só consulta com telefone completo ou e-mail válido.
 * Falhas de rede são silenciosas: o aviso é informativo e nunca bloqueia o cadastro.
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
        .then((match) => {
          if (isActive) setState({ key, match })
        })
        .catch(() => {
          if (isActive) setState({ key, match: null })
        })
    }, DEBOUNCE_MS)

    return () => {
      isActive = false
      window.clearTimeout(timeout)
    }
  }, [key, phoneDigits, normalizedEmail, excludeId])

  return {
    checking: key !== '' && state?.key !== key,
    match: key !== '' && state?.key === key ? state.match : null,
  }
}
