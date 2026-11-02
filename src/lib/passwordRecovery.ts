import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/lead'
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase'

export const RESET_PASSWORD_PATH = 'redefinir-senha'

/** Endereço da página de nova senha (para onde o link do e-mail leva). */
export function resetPasswordUrl(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${RESET_PASSWORD_PATH}`
}

/**
 * Cliente usado só na redefinição de senha. A sessão aberta pelo link (ou código) do e-mail
 * fica em memória nesta página e nunca é gravada: não vira login no app, serve apenas para
 * gravar a nova senha. No Modo Demonstração nenhum e-mail é enviado e o cliente local responde.
 */
export const recoveryClient: SupabaseClient<Database> = import.meta.env.VITE_DEMO_MODE === 'true'
  ? supabase
  : createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: 'implicit',
        storageKey: 'gestao-leads-recuperacao-senha',
      },
    })

export type RecoveryLink =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'token_hash'; tokenHash: string }
  | { kind: 'error' }

/** Dados do link de "Esqueci minha senha" na URL (o Supabase devolve no hash ou na query). */
export function readRecoveryLink(location: Pick<Location, 'hash' | 'search'> = window.location): RecoveryLink | null {
  const params = new URLSearchParams(`${location.search.replace(/^\?/, '')}&${location.hash.replace(/^#/, '')}`)
  // Link vencido ou já usado: o Supabase volta com o erro em vez dos dados
  if (params.get('error_code') || params.get('error')) return { kind: 'error' }
  if (params.get('type') !== 'recovery') return null

  const tokenHash = params.get('token_hash')
  if (tokenHash) return { kind: 'token_hash', tokenHash }
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (accessToken && refreshToken) return { kind: 'tokens', accessToken, refreshToken }
  return { kind: 'error' }
}

// O mesmo link é conferido uma vez só (o token_hash não pode ser usado duas vezes)
const verifications = new Map<string, Promise<boolean>>()

/** Abre a sessão de recuperação (só em memória) a partir do link. */
export function openRecoveryFromLink(link: Exclude<RecoveryLink, { kind: 'error' }>): Promise<boolean> {
  const key = link.kind === 'tokens' ? link.accessToken : link.tokenHash
  let verification = verifications.get(key)
  if (!verification) {
    const request =
      link.kind === 'tokens'
        ? recoveryClient.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
        : recoveryClient.auth.verifyOtp({ token_hash: link.tokenHash, type: 'recovery' })
    verification = request.then(({ data, error }) => !error && Boolean(data.session)).catch(() => false)
    verifications.set(key, verification)
  }
  return verification
}
