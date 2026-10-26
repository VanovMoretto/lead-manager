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
    },
  },
)
