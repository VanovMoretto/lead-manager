import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/lead'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

/**
 * Indica se as variáveis do `.env` foram preenchidas.
 * O App usa isso para mostrar uma tela de configuração em vez de quebrar em branco.
 */
export const isSupabaseConfigured = supabaseUrl.length > 0 && supabaseAnonKey.length > 0

if (!isSupabaseConfigured) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL e/ou VITE_SUPABASE_ANON_KEY não estão definidos no arquivo .env.',
  )
}

const REMEMBER_SESSION_KEY = 'gestao-leads-manter-logado'

/** "Manter-me logado": grava a escolha antes do login (padrão: manter). */
export function setRememberSession(remember: boolean): void {
  try {
    window.localStorage.setItem(REMEMBER_SESSION_KEY, remember ? '1' : '0')
  } catch {
    // Navegador sem localStorage: a sessão segue o padrão
  }
}

export function getRememberSession(): boolean {
  try {
    return window.localStorage.getItem(REMEMBER_SESSION_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * Onde a sessão fica guardada: localStorage (continua logado ao reabrir o navegador)
 * ou sessionStorage (sai ao fechar a aba), conforme "Manter-me logado".
 */
const authStorage = {
  getItem(key: string): string | null {
    try {
      return window.localStorage.getItem(key) ?? window.sessionStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      const [target, other] = getRememberSession()
        ? [window.localStorage, window.sessionStorage]
        : [window.sessionStorage, window.localStorage]
      target.setItem(key, value)
      other.removeItem(key)
    } catch {
      // Sem armazenamento disponível: a sessão vale só enquanto a página estiver aberta
    }
  },
  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key)
      window.sessionStorage.removeItem(key)
    } catch {
      // Nada a remover
    }
  },
}

/**
 * Link de "Esqueci minha senha": o Supabase volta com type=recovery na URL.
 * Lido antes de criar o cliente, que limpa a URL ao processar o link.
 */
export const isPasswordRecoveryRedirect =
  typeof window !== 'undefined' && /(^|[#&?])type=recovery(&|$)/.test(`${window.location.hash}&${window.location.search}`)

/**
 * Cliente Supabase tipado com o schema do banco.
 * Enquanto o `.env` não estiver preenchido, usa valores fictícios só para não
 * lançar erro na importação; nenhuma chamada é feita nesse estado.
 */
export const supabase = createClient<Database>(
  isSupabaseConfigured ? supabaseUrl : 'http://localhost:54321',
  isSupabaseConfigured ? supabaseAnonKey : 'public-anon-key-not-configured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: authStorage,
    },
  },
)
