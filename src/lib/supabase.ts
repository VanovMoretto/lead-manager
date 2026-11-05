import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/lead'
import { isDemoMode } from './demoMode'
import { createDemoClient } from './demoStore'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

/**
 * Indica se as variáveis do `.env` foram preenchidas.
 * O App usa isso para mostrar uma tela de configuração em vez de quebrar em branco.
 * No Modo Demonstração o app não precisa do Supabase: os dados fictícios ficam no navegador.
 */
export const isSupabaseConfigured = isDemoMode || (supabaseUrl.length > 0 && supabaseAnonKey.length > 0)

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
 * Uma sessão já gravada continua onde está ao renovar o token: a escolha vale para a
 * sessão inteira, não para a última tela de login aberta em outra aba.
 */
const authStorage = {
  getItem(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      const remember =
        window.sessionStorage.getItem(key) !== null
          ? false
          : window.localStorage.getItem(key) !== null
            ? true
            : getRememberSession()
      const [target, other] = remember
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

// Enquanto o `.env` não estiver preenchido, valores fictícios só para não lançar erro na importação
export const SUPABASE_URL = supabaseUrl || 'http://localhost:54321'
export const SUPABASE_ANON_KEY = supabaseAnonKey || 'public-anon-key-not-configured'

/**
 * Cliente Supabase tipado com o schema do banco.
 * Não lê sessão da URL: o link de "Esqueci minha senha" é tratado só na página de nova senha,
 * por um cliente à parte, e nunca vira login no app.
 * No Modo Demonstração, um cliente local com a mesma interface responde às chamadas.
 */
// Comparação direta com a variável (e não com `isDemoMode`) para o build descartar o cliente demo fora do modo demo
export const supabase: SupabaseClient<Database> = import.meta.env.VITE_DEMO_MODE === 'true'
  ? createDemoClient()
  : createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: authStorage,
      },
    })

/**
 * A sessão foi aberta pelo link de "Esqueci minha senha"? O Supabase registra no token
 * como cada login aconteceu (`amr`). Uma sessão assim não vale como login no app.
 */
export function isRecoverySession(session: { access_token: string } | null): boolean {
  if (!session) return false
  try {
    const payload = session.access_token.split('.')[1] ?? ''
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='))
    const claims = JSON.parse(json) as { amr?: Array<{ method?: string }> }
    return Array.isArray(claims.amr) && claims.amr.some((entry) => entry.method === 'recovery')
  } catch {
    return false
  }
}
