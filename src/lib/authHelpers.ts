import type { AuthError } from '@supabase/supabase-js'
import { isDemoMode } from './demoMode'

/** "empresa.com.br" ou "@empresa.com.br" -> "@empresa.com.br". */
function toEmailDomain(value: string): string {
  return value.startsWith('@') ? value : `@${value}`
}

/**
 * Domínio dos logins da equipe: quem digita só o usuário (ex.: nome.sobrenome) entra com este sufixo.
 * Definido por `VITE_DEFAULT_EMAIL_DOMAIN`; no Modo Demonstração, o padrão é o domínio das contas fictícias.
 */
export const DEFAULT_EMAIL_DOMAIN = toEmailDomain(
  import.meta.env.VITE_DEFAULT_EMAIL_DOMAIN?.trim().toLowerCase() || (isDemoMode ? '@portfolio.demo' : '@empresa.com.br'),
)

/** "Nome.Sobrenome " -> "nome.sobrenome@empresa.com.br"; um e-mail completo é mantido como foi digitado. */
export function toLoginEmail(identifier: string): string {
  const value = identifier.trim().toLowerCase()
  return value.includes('@') ? value : `${value}${DEFAULT_EMAIL_DOMAIN}`
}

/** Traduz as mensagens mais comuns do Supabase Auth. */
export function translateAuthError(error: Pick<AuthError, 'message'> & { code?: string }, fallback: string): string {
  const normalized = error.message.toLowerCase()

  if (error.code === 'invalid_credentials' || normalized.includes('invalid login credentials')) {
    return 'Usuário ou senha incorretos.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'Este e-mail ainda não foi confirmado. Verifique sua caixa de entrada.'
  }
  if (error.code === 'same_password' || normalized.includes('different from the old password')) {
    return 'A nova senha precisa ser diferente da atual.'
  }
  if (error.code === 'weak_password' || normalized.includes('password should')) {
    return 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.'
  }
  if (error.code === 'otp_expired' || normalized.includes('token has expired') || normalized.includes('invalid or has expired')) {
    return 'Código ou link inválido ou expirado. Peça um novo em "Esqueci minha senha".'
  }
  if (error.code === 'reauthentication_needed' || error.code === 'session_not_found' || error.code === 'session_expired') {
    return 'Sua sessão expirou. Entre novamente e tente de novo.'
  }
  if (normalized.includes('captcha')) {
    return 'Confirme a verificação de segurança (captcha) e tente de novo.'
  }
  if (normalized.includes('too many requests') || normalized.includes('rate limit')) {
    return 'Muitas tentativas seguidas. Aguarde alguns instantes e tente novamente.'
  }
  if (normalized.includes('failed to fetch') || normalized.includes('network')) {
    return 'Não foi possível conectar ao servidor. Verifique sua internet.'
  }
  return fallback
}
