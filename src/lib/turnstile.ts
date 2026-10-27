/** Chave pública do Cloudflare Turnstile; sem ela, o captcha fica desligado. */
export const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() ?? ''
