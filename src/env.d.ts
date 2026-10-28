/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  /** Cloudflare Turnstile (opcional): com ela, login e recuperação de senha exigem o captcha. */
  readonly VITE_TURNSTILE_SITE_KEY?: string
  /** Domínio completado no login quando só o usuário é digitado (ex.: "@empresa.com.br"). */
  readonly VITE_DEFAULT_EMAIL_DOMAIN?: string
  /** "true" liga o Modo Portfólio / Demonstração (dados fictícios, sem Supabase). */
  readonly VITE_DEMO_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
