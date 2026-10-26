import { Navigate, Outlet } from 'react-router-dom'
import { LoaderCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

/**
 * Protege as rotas exclusivas do ADMIN (Painel Admin). Usuário comum volta para a Dashboard.
 * É só a camada de interface: as políticas do banco recusam as alterações de quem não é ADMIN.
 */
export default function AdminRoute() {
  const { isAdmin, roleLoading } = useAuth()

  if (roleLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-brand-600" aria-hidden="true" />
        Verificando permissões...
      </div>
    )
  }

  if (!isAdmin) return <Navigate to="/" replace />

  return <Outlet />
}
