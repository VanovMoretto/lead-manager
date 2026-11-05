import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CircleAlert, CircleCheck, KeyRound, LoaderCircle, Mail } from 'lucide-react'
import { PASSWORD_RULE_TEXT, validatePassword } from '../lib/password'
import { toLoginEmail, translateAuthError } from '../lib/authHelpers'
import { openRecoveryFromLink, readRecoveryLink, recoveryClient } from '../lib/passwordRecovery'
import { supabase } from '../lib/supabase'
import PasswordInput from '../components/PasswordInput'
import AppLogo from '../components/AppLogo'
import ThemeToggle from '../components/ThemeToggle'
import { cn } from '../lib/utils'

type Step = 'checking' | 'code' | 'invalid' | 'password' | 'done'

const inputClassName = cn(
  'block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm',
  'placeholder:text-slate-400 transition-colors focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20',
  'dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:placeholder:text-slate-500 disabled:opacity-60',
)

const buttonClassName = cn(
  'flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors',
  'hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70',
)

function ErrorMessage({ children }: { children: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
    >
      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

/**
 * Página independente de nova senha, fora do app. Chega-se a ela pelo link do e-mail de
 * "Esqueci minha senha" ou digitando o código do e-mail. A sessão de recuperação fica só em
 * memória nesta página: não dá acesso ao app e não pede a senha atual. Depois de salvar,
 * todas as sessões do usuário são encerradas e o login é feito com a nova senha.
 */
export default function ResetPassword() {
  const navigate = useNavigate()
  const [link] = useState(readRecoveryLink)
  const [step, setStep] = useState<Step>(() => (!link ? 'code' : link.kind === 'error' ? 'invalid' : 'checking'))

  const [identifier, setIdentifier] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [otherSessionsEnded, setOtherSessionsEnded] = useState(true)

  // Tira os dados do link da barra de endereço e do histórico
  useEffect(() => {
    if (link) window.history.replaceState(null, '', window.location.pathname)
  }, [link])

  useEffect(() => {
    if (!link || link.kind === 'error') return
    let isActive = true
    openRecoveryFromLink(link).then((valid) => {
      if (isActive) setStep(valid ? 'password' : 'invalid')
    })
    return () => {
      isActive = false
    }
  }, [link])

  const handleCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const token = code.replace(/\s/g, '')
    if (!identifier.trim() || !/^\d{6,10}$/.test(token)) {
      setError('Informe o usuário (ou e-mail) e o código numérico recebido por e-mail.')
      return
    }
    setBusy(true)
    const { data, error: verifyError } = await recoveryClient.auth.verifyOtp({
      email: toLoginEmail(identifier),
      token,
      type: 'recovery',
    })
    setBusy(false)
    if (verifyError || !data.session) {
      setError(verifyError ? translateAuthError(verifyError, 'Código inválido ou expirado.') : 'Código inválido ou expirado.')
      return
    }
    setStep('password')
  }

  const handlePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const passwordError = validatePassword(password)
    if (passwordError) {
      setError(passwordError)
      return
    }
    if (password !== confirmation) {
      setError('A confirmação não confere com a nova senha.')
      return
    }

    setBusy(true)
    const { error: updateError } = await recoveryClient.auth.updateUser({ password })
    if (updateError) {
      setBusy(false)
      setError(translateAuthError(updateError, 'Não foi possível salvar a nova senha. Peça um novo link e tente de novo.'))
      return
    }
    // Encerra todas as sessões do usuário (inclusive a do link): o acesso volta só com a nova senha
    const globalSignOut = await recoveryClient.auth.signOut({ scope: 'global' }).catch(() => ({ error: true }))
    setOtherSessionsEnded(!globalSignOut.error)
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    setBusy(false)
    setPassword('')
    setConfirmation('')
    setStep('done')
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-md">
        <AppLogo size="md" className="mb-8" />

        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
            <KeyRound className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-2xl font-bold text-slate-900 dark:text-white">Redefinir senha</h1>

          {step === 'checking' && (
            <p className="mt-6 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400" aria-live="polite">
              <LoaderCircle className="h-4 w-4 animate-spin text-brand-600" aria-hidden="true" />
              Validando o link...
            </p>
          )}

          {(step === 'code' || step === 'invalid') && (
            <form onSubmit={handleCode} className="mt-6 space-y-5" noValidate>
              {step === 'invalid' ? (
                <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  Este link é inválido ou já expirou. Peça um novo em &quot;Esqueci minha senha&quot; ou use o código do e-mail.
                </p>
              ) : (
                <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Mail className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
                  Abra o link do e-mail de &quot;Esqueci minha senha&quot; ou digite abaixo o código que veio nele.
                </p>
              )}
              <div>
                <label htmlFor="reset-identifier" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Usuário ou e-mail
                </label>
                <input
                  id="reset-identifier"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  disabled={busy}
                  className={inputClassName}
                />
              </div>
              <div>
                <label htmlFor="reset-code" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Código do e-mail
                </label>
                <input
                  id="reset-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={12}
                  placeholder="000000"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/[^\d\s]/g, ''))}
                  disabled={busy}
                  className={cn(inputClassName, 'tracking-[0.3em] tabular-nums')}
                />
              </div>
              {error && <ErrorMessage>{error}</ErrorMessage>}
              <button type="submit" disabled={busy} className={buttonClassName}>
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {busy ? 'Conferindo...' : 'Continuar'}
              </button>
              <Link to="/login" replace className="block text-center text-sm font-semibold text-brand-600 hover:underline dark:text-brand-400">
                Voltar para o login
              </Link>
            </form>
          )}

          {step === 'password' && (
            <form onSubmit={handlePassword} className="mt-6 space-y-5" noValidate>
              <p className="text-sm text-slate-500 dark:text-slate-400">{PASSWORD_RULE_TEXT}</p>
              <div>
                <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Nova senha
                </label>
                <PasswordInput id="new-password" name="new-password" value={password} onChange={setPassword} autoComplete="new-password" disabled={busy} />
              </div>
              <div>
                <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Confirmar nova senha
                </label>
                <PasswordInput id="confirm-password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" disabled={busy} />
              </div>
              {error && <ErrorMessage>{error}</ErrorMessage>}
              <button type="submit" disabled={busy} className={buttonClassName}>
                {busy && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {busy ? 'Salvando...' : 'Salvar nova senha'}
              </button>
            </form>
          )}

          {step === 'done' && (
            <div className="mt-6 space-y-5">
              <p
                role="status"
                className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {otherSessionsEnded
                  ? 'Senha alterada. Por segurança, todas as sessões foram encerradas: entre com a nova senha.'
                  : 'Senha alterada. Não foi possível encerrar as sessões abertas em outros aparelhos: entre com a nova senha e use "Sair" nos outros aparelhos.'}
              </p>
              <button type="button" onClick={() => navigate('/login', { replace: true })} className={buttonClassName}>
                Ir para o login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
