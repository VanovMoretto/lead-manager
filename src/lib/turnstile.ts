import { isDemoMode } from './demoMode'

/** Chave pública do Cloudflare Turnstile; sem ela (ou no Modo Demonstração), o captcha fica desligado. */
export const TURNSTILE_SITE_KEY = isDemoMode ? '' : (import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? '')
