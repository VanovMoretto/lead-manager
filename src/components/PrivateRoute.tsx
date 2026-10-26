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
  const { session, loading, roleLoading, passwordRecovery } = useAuth()
  const location = useLocation()

  // Espera também o perfil: usuário desativado sai antes de ver qualquer tela
  if (loading || (session && roleLoading)) {
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

  // Entrou pelo link de "Esqueci minha senha": primeiro define a nova senha
  if (passwordRecovery) return <Navigate to="/redefinir-senha" replace />

  return <Outlet />
}
