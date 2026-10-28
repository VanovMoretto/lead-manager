import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleAlert, LoaderCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../lib/demoStore'
import { cn } from '../lib/utils'

type DemoAccount = keyof typeof DEMO_ACCOUNTS

type DemoLoginPanelProps = {
  /** Para onde ir depois de entrar. */
  redirectTo: string
  disabled?: boolean
}

const buttonClassName = cn(
  'flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold shadow-sm transition-colors',
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
  'disabled:cursor-not-allowed disabled:opacity-70',
)

/** Modo Demonstração: explica que os dados são fictícios e oferece o login de 1 clique. */
export default function DemoLoginPanel({ redirectTo, disabled = false }: DemoLoginPanelProps) {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [pending, setPending] = useState<DemoAccount | null>(null)
  const [error, setError] = useState<string | null>(null)

  const enter = async (account: DemoAccount) => {
    setPending(account)
    setError(null)
    const result = await signIn(DEMO_ACCOUNTS[account], DEMO_PASSWORD, { remember: true })
    setPending(null)
    if (result.error) {
      setError(result.error)
      return
    }
    navigate(redirectTo, { replace: true })
  }

  const busy = disabled || pending !== null

  return (
    <section
      aria-labelledby="demo-mode-title"
      className="mb-8 rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 via-white to-amber-50 p-4 shadow-sm dark:border-brand-900/60 dark:from-brand-950/60 dark:via-slate-900 dark:to-slate-900"
    >
      <h2 id="demo-mode-title" className="text-sm font-bold text-brand-900 dark:text-brand-100">
        ✨ Modo Demonstração (Portfólio)
      </h2>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
        Todos os clientes, propostas e valores são <strong className="font-semibold">fictícios</strong> e ficam só neste
        navegador. Explore à vontade: cadastre, edite, exporte e exclua sem afetar nenhum sistema real.
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void enter('admin')}
          disabled={busy}
          className={cn(buttonClassName, 'bg-brand-600 text-white hover:bg-brand-700')}
        >
          {pending === 'admin' && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
          🚀 Entrar como Admin (1 Clique)
        </button>
        <button
          type="button"
          onClick={() => void enter('sales')}
          disabled={busy}
          className={cn(
            buttonClassName,
            'border border-brand-200 bg-white text-brand-800 hover:bg-brand-50',
            'dark:border-brand-800 dark:bg-slate-900 dark:text-brand-200 dark:hover:bg-brand-900/40',
          )}
        >
          {pending === 'sales' && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
          👤 Entrar como Comercial (1 Clique)
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
          <CircleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <p className="mt-3 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
        Prefere digitar? Use <span className="font-medium text-slate-700 dark:text-slate-200">admin</span>,{' '}
        <span className="font-medium text-slate-700 dark:text-slate-200">comercial</span> ou{' '}
        <span className="font-medium text-slate-700 dark:text-slate-200">estagio</span> (acesso desativado) com a senha{' '}
        <code className="rounded bg-white/80 px-1 py-0.5 font-mono text-slate-700 dark:bg-slate-800 dark:text-slate-200">{DEMO_PASSWORD}</code>.
      </p>
    </section>
  )
}
