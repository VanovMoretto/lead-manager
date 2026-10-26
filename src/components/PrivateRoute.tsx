import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

/** Estado enviado para o Login, para voltar à página original após entrar. */
export type RedirectState = { from?: string }

/**
 * Protege as rotas filhas: sem sessão, redireciona para /login
 * guardando a página que o usuário tentou abrir.
 */
export default function PrivateRoute() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-500 dark:text-slate-400">
          <LoaderCircle className="h-5 w-5 animate-spin text-brand-600" aria-hidden="true" />
          Verificando sessão...
        </div>
      </div>
    )
  }

  if (!session) {
    const state: RedirectState = { from: `${location.pathname}${location.search}` }
    return <Navigate to="/login" replace state={state} />
  }

  return <Outlet />
}
