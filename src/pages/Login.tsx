import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { CalendarHeart, CircleAlert, Eye, EyeOff, LoaderCircle, Lock, Mail } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import ThemeToggle from '../components/ThemeToggle'
import type { RedirectState } from '../components/PrivateRoute'
import { cn } from '../lib/utils'

const inputClassName = cn(
  'block w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm',
  'placeholder:text-slate-400 transition-colors',
  'focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20',
  'dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500',
  'disabled:cursor-not-allowed disabled:opacity-60',
)

export default function Login() {
  const { session, loading, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const redirectTo = (location.state as RedirectState | null)?.from ?? '/'

  // Já logado: vai direto para o app
  if (!loading && session) {
    return <Navigate to={redirectTo} replace />
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!email.trim() || !password) {
      setError('Informe e-mail e senha.')
      return
    }

    setSubmitting(true)
    const result = await signIn(email, password)
    setSubmitting(false)

    if (result.error) {
      setError(result.error)
      return
    }

    navigate(redirectTo, { replace: true })
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
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Use seu e-mail e senha cadastrados.</p>

            <form onSubmit={handleSubmit} className="mt-8 space-y-5" noValidate>
              <div>
                <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  E-mail
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="voce@empresa.com.br"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={submitting}
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
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={submitting}
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

              {error && (
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
                disabled={submitting}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors',
                  'hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
                  'disabled:cursor-not-allowed disabled:opacity-70 dark:focus-visible:ring-offset-slate-900',
                )}
              >
                {submitting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {submitting ? 'Entrando...' : 'Entrar'}
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
