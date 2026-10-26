import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { CalendarHeart, CircleAlert, CircleCheck, KeyRound, LoaderCircle } from 'lucide-react'
import { MIN_PASSWORD_LENGTH, useAuth } from '../contexts/AuthContext'
import PasswordInput from '../components/PasswordInput'
import ThemeToggle from '../components/ThemeToggle'
import { cn } from '../lib/utils'

/** Tela aberta pelo link de "Esqueci minha senha" enviado por e-mail. */
export default function ResetPassword() {
  const { session, loading, passwordRecovery, completePasswordRecovery } = useAuth()
  const navigate = useNavigate()

  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Logado normalmente (sem link de recuperação): a troca de senha fica no perfil
  if (!loading && session && !passwordRecovery && !done) {
    return <Navigate to="/perfil" replace />
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`A nova senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`)
      return
    }
    if (password !== confirmation) {
      setError('A confirmação não confere com a nova senha.')
      return
    }

    setSaving(true)
    const result = await completePasswordRecovery(password)
    setSaving(false)

    if (result.error) {
      setError(result.error)
      return
    }
    setDone(true)
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-900 to-brand-600 text-white">
            <CalendarHeart className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="leading-tight">
            <p className="text-base font-bold text-slate-900 dark:text-white">Gestão de Leads</p>
            <p className="text-xs text-slate-500 dark:text-slate-400">Eventos &amp; Orçamentos</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
            <KeyRound className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">Criar nova senha</h1>

          {loading ? (
            <p className="mt-6 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <LoaderCircle className="h-4 w-4 animate-spin text-brand-600" aria-hidden="true" />
              Validando o link...
            </p>
          ) : done ? (
            <div className="mt-6 space-y-5">
              <p
                role="status"
                className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Senha alterada com sucesso.
              </p>
              <button
                type="button"
                onClick={() => navigate('/', { replace: true })}
                className="flex w-full items-center justify-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
              >
                Ir para o sistema
              </button>
            </div>
          ) : !session ? (
            <div className="mt-6 space-y-5">
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Este link é inválido ou já expirou. Peça um novo em &quot;Esqueci minha senha&quot; na tela de login.
              </p>
              <Link to="/login" replace className="text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Voltar para o login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-6 space-y-5" noValidate>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Escolha uma senha com pelo menos {MIN_PASSWORD_LENGTH} caracteres.
              </p>
              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Nova senha
                </label>
                <PasswordInput id="new-password" value={password} onChange={setPassword} autoComplete="new-password" disabled={saving} />
              </div>
              <div>
                <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Confirmar nova senha
                </label>
                <PasswordInput
                  id="confirm-password"
                  value={confirmation}
                  onChange={setConfirmation}
                  autoComplete="new-password"
                  disabled={saving}
                />
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
                disabled={saving}
                className={cn(
                  'flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors',
                  'hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70',
                )}
              >
                {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {saving ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
