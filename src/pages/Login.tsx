import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CalendarHeart, CircleAlert, CircleCheck, Eye, EyeOff, LoaderCircle, Lock, ShieldAlert, User } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import ThemeToggle from '../components/ThemeToggle'
import Turnstile, { type TurnstileHandle } from '../components/Turnstile'
import { TURNSTILE_SITE_KEY } from '../lib/turnstile'
import type { RedirectState } from '../components/PrivateRoute'
import { cn } from '../lib/utils'
import { getRememberSession } from '../lib/supabase'
import {
  MAX_FAILED_ATTEMPTS,
  clearLoginThrottle,
  getLoginThrottle,
  lockSecondsLeft,
  registerLoginFailure,
  registerResetRequest,
  resetCooldownLeft,
} from '../lib/loginThrottle'

/**
 * "Lembrar meu usuário": guarda só o usuário, nunca a senha. A senha fica a cargo do
 * gerenciador de senhas do navegador (campos com name/autocomplete corretos).
 */
const SAVED_USERNAME_KEY = 'gestao-leads-usuario-salvo'

function readSavedUsername(): string {
  try {
    return window.localStorage.getItem(SAVED_USERNAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeSavedUsername(username: string | null): void {
  try {
    if (username) window.localStorage.setItem(SAVED_USERNAME_KEY, username)
    else window.localStorage.removeItem(SAVED_USERNAME_KEY)
  } catch {
    // Navegador sem localStorage: apenas não lembra o usuário
  }
}

/** Erros que não contam como tentativa de senha (sem conexão, captcha pendente). */
function countsAsFailedAttempt(message: string): boolean {
  const normalized = message.toLowerCase()
  return !normalized.includes('conectar') && !normalized.includes('captcha')
}

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}min ${String(seconds % 60).padStart(2, '0')}s`
}

const checkboxClassName =
  'h-4 w-4 rounded border-slate-300 text-brand-600 accent-brand-600 focus:ring-brand-600 dark:border-slate-600 dark:bg-slate-900'

const inputClassName = cn(
  'block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm',
  'placeholder:text-slate-400 transition-colors',
  'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20',
  'dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500',
  'disabled:cursor-not-allowed disabled:opacity-60',
)

export default function Login() {
  const { session, loading, signIn, requestPasswordReset, accessNotice, clearAccessNotice, passwordRecovery } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [identifier, setIdentifier] = useState(readSavedUsername)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(getRememberSession)
  const [saveUsername, setSaveUsername] = useState(() => readSavedUsername() !== '')
  const [submitting, setSubmitting] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Freio contra força bruta e cooldown do "Esqueci minha senha" (persistidos no navegador)
  const [throttle, setThrottle] = useState(getLoginThrottle)
  const [resetUntil, setResetUntil] = useState(() => Date.now() + resetCooldownLeft() * 1000)
  const [now, setNow] = useState(() => Date.now())
  const lockLeft = lockSecondsLeft(throttle, now)
  const resetLeft = Math.max(0, Math.ceil((resetUntil - now) / 1000))

  const [captchaToken, setCaptchaToken] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileHandle>(null)
  const captchaRequired = TURNSTILE_SITE_KEY !== ''

  // Contador regressivo enquanto houver bloqueio ou cooldown
  const ticking = lockLeft > 0 || resetLeft > 0
  useEffect(() => {
    if (!ticking) return
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [ticking])

  const redirectTo = (location.state as RedirectState | null)?.from ?? '/'

  // Já logado: vai direto para o app (ou para definir a nova senha, se veio do link de recuperação)
  if (!loading && session) {
    return <Navigate to={passwordRecovery ? '/redefinir-senha' : redirectTo} replace />
  }

  const busy = submitting || sendingReset

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setInfo(null)

    if (lockSecondsLeft(getLoginThrottle()) > 0) {
      setThrottle(getLoginThrottle())
      setNow(Date.now())
      return
    }
    if (!identifier.trim() || !password) {
      setError('Informe usuário e senha.')
      return
    }
    if (captchaRequired && !captchaToken) {
      setError('Confirme a verificação de segurança para entrar.')
      return
    }

    setSubmitting(true)
    const result = await signIn(identifier, password, { remember, captchaToken: captchaToken ?? undefined })
    setSubmitting(false)
    // Cada token do captcha vale para uma tentativa só
    turnstileRef.current?.reset()

    if (result.error) {
      if (countsAsFailedAttempt(result.error)) {
        const next = registerLoginFailure()
        setThrottle(next)
        setNow(Date.now())
        setPassword('')
      }
      setError(result.error)
      return
    }

    clearLoginThrottle()
    writeSavedUsername(saveUsername ? identifier.trim() : null)
    navigate(redirectTo, { replace: true })
  }

  const handleForgotPassword = async () => {
    setError(null)
    setInfo(null)
    clearAccessNotice()

    if (!identifier.trim()) {
      setError('Informe seu usuário para receber o link de redefinição de senha.')
      document.getElementById('username')?.focus()
      return
    }
    if (resetCooldownLeft() > 0) {
      setResetUntil(Date.now() + resetCooldownLeft() * 1000)
      setNow(Date.now())
      return
    }
    if (captchaRequired && !captchaToken) {
      setError('Confirme a verificação de segurança para receber o link.')
      return
    }

    setSendingReset(true)
    const result = await requestPasswordReset(identifier, captchaToken ?? undefined)
    setSendingReset(false)
    turnstileRef.current?.reset()
    // Intervalo mínimo entre pedidos, para não disparar e-mails em massa
    registerResetRequest()
    setResetUntil(Date.now() + resetCooldownLeft() * 1000)
    setNow(Date.now())

    if (result.error) {
      setError(result.error)
      return
    }
    // Mensagem neutra: não revela se o usuário existe
    setInfo('Se o usuário estiver cadastrado, você receberá um e-mail com o link para criar uma nova senha.')
  }

  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Painel de marca (desktop) */}
      <section className="relative hidden w-1/2 overflow-hidden bg-gradient-to-br from-brand-900 via-brand-800 to-brand-600 lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-brand-400/20 blur-3xl" />

        <div className="relative flex items-center gap-3 text-white">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/20">
            <CalendarHeart className="h-6 w-6" aria-hidden="true" />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-bold">Gestão de Leads</p>
            <p className="text-sm text-brand-100">Eventos &amp; Orçamentos</p>
          </div>
        </div>

        <div className="relative max-w-lg text-white">
          <h1 className="text-4xl font-bold leading-tight">Cada evento começa com um bom atendimento.</h1>
          <p className="mt-4 text-lg text-brand-100">
            Acompanhe leads, propostas e fechamentos em um só lugar, do primeiro contato ao contrato assinado.
          </p>
        </div>

        <p className="relative text-sm text-brand-200">Acesso restrito à equipe comercial.</p>
      </section>

      {/* Formulário */}
      <section className="relative flex w-full flex-1 items-center justify-center px-4 py-12 sm:px-8">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-900 to-brand-600 text-white">
              <CalendarHeart className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="leading-tight">
              <p className="text-base font-bold text-slate-900 dark:text-white">Gestão de Leads</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Eventos &amp; Orçamentos</p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Entrar</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use seu usuário e senha cadastrados.</p>

            <form onSubmit={handleSubmit} method="post" action="#" className="mt-8 space-y-5" noValidate>
              <div>
                <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Usuário
                </label>
                <div className="relative">
                  <User
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="username"
                    name="username"
                    type="text"
                    autoComplete="username"
                    maxLength={254}
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Usuário"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    disabled={busy}
                    className={inputClassName}
                    required
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Senha
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    maxLength={72}
                    placeholder="••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy}
                    className={cn(inputClassName, 'pr-10')}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                <div className="space-y-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(event) => setRemember(event.target.checked)}
                      disabled={busy}
                      className={checkboxClassName}
                    />
                    Manter-me logado
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={saveUsername}
                      onChange={(event) => setSaveUsername(event.target.checked)}
                      disabled={busy}
                      className={checkboxClassName}
                    />
                    Lembrar meu usuário
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() => void handleForgotPassword()}
                  disabled={busy || resetLeft > 0}
                  title={resetLeft > 0 ? `Aguarde ${resetLeft}s para pedir outro link` : undefined}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline disabled:cursor-not-allowed disabled:opacity-60 dark:text-brand-400"
                >
                  {sendingReset && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  {resetLeft > 0 ? `Esqueci minha senha (${resetLeft}s)` : 'Esqueci minha senha'}
                </button>
              </div>

              <Turnstile ref={turnstileRef} onToken={setCaptchaToken} />

              {lockLeft > 0 ? (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                >
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Muitas tentativas sem sucesso. Por segurança, o login está bloqueado por{' '}
                    <strong className="tabular-nums">{formatWait(lockLeft)}</strong>.
                  </span>
                </div>
              ) : (
                throttle.lockLevel === 0 &&
                throttle.failures >= MAX_FAILED_ATTEMPTS - 2 && (
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    {MAX_FAILED_ATTEMPTS - throttle.failures === 1
                      ? 'Última tentativa antes do bloqueio temporário.'
                      : `Restam ${MAX_FAILED_ATTEMPTS - throttle.failures} tentativas antes do bloqueio temporário.`}
                  </p>
                )
              )}

              {accessNotice && !error && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{accessNotice}</span>
                </div>
              )}

              {info && (
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                >
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{info}</span>
                </div>
              )}

              {error && lockLeft === 0 && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                >
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={busy || lockLeft > 0}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors',
                  'hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-70 dark:focus-visible:ring-offset-slate-900',
                )}
              >
                {submitting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {submitting ? 'Entrando...' : lockLeft > 0 ? `Aguarde ${formatWait(lockLeft)}` : 'Entrar'}
              </button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-slate-400 dark:text-slate-500">
            Não tem acesso? Solicite ao administrador do sistema.
          </p>
        </div>
      </section>
    </div>
  )
}
