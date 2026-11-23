import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Building2,
  ChevronRight,
  CircleCheck,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  MailCheck,
  Receipt,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import AppLogo from './AppLogo'
import { cn } from '../lib/utils'
import type { Lead } from '../types/lead'
import type { RecurringClientMatch } from '../hooks/useRecurringClient'
import LeadFormModal from './LeadFormModal'
import ThemeToggle from './ThemeToggle'
import UserAvatar from './UserAvatar'

// Só existe no Modo Demonstração (comparação direta com a variável: fora dele, nem entra no build)
const DemoModeBadge = import.meta.env.VITE_DEMO_MODE === 'true' ? lazy(() => import('./DemoModeBadge')) : null

/** Disponível nas páginas via `useOutletContext<LayoutOutletContext>()`. */
export type LayoutOutletContext = {
  /** Abre o formulário de cadastro de proposta. */
  openNewLead: () => void
  /** Abre o cadastro de proposta já vinculado a um cliente (página do cliente). */
  openNewLeadForClient: (client: RecurringClientMatch) => void
  /** Mostra o aviso de sucesso no canto da tela. */
  showToast: (message: string) => void
  /** Muda a cada lead salvo: use como dependência para recarregar listas e indicadores. */
  leadsVersion: number
}

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  /** Só aparece para usuários com papel ADMIN. */
  adminOnly?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/propostas', label: 'Consultar Propostas', icon: FileText },
  { to: '/leads', label: 'Consultar Leads', icon: Building2 },
  { to: '/faturamento', label: 'Faturamento & Eventos', icon: Receipt },
  { to: '/mailing', label: 'Mailing & Pesquisas', icon: MailCheck },
  { to: '/admin', label: 'Painel Admin', icon: Settings, adminOnly: true },
]

type SidebarContentProps = {
  onNewLead: () => void
  onNavigate?: () => void
}

function SidebarContent({ onNewLead, onNavigate }: SidebarContentProps) {
  const { user, profile, signOut, isAdmin } = useAuth()
  const navItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin)
  // Só o ID do usuário (parte antes do @), sem o domínio
  const username = user?.email?.split('@')[0] ?? ''
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    setSigningOut(false)
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-full flex-col bg-rail text-white">
      <div className="flex h-16 items-center px-5">
        <AppLogo size="md" variant="onDark" />
      </div>

      <div className="px-3 pt-2">
        <button
          type="button"
          onClick={onNewLead}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors',
            'hover:bg-brand-500 focus-visible:ring-offset-rail',
          )}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nova Proposta
        </button>
      </div>

      <nav className="mt-5 flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="Navegação principal">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-offset-rail',
                isActive ? 'bg-rail-active text-white' : 'text-rail-muted hover:bg-rail-hover hover:text-white',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn('h-[18px] w-[18px] shrink-0', isActive ? 'text-brand-300' : 'text-rail-muted group-hover:text-white')}
                  aria-hidden="true"
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {DemoModeBadge && (
        <Suspense fallback={null}>
          <DemoModeBadge className="mx-3 mb-3" />
        </Suspense>
      )}

      <div className="space-y-0.5 border-t border-rail-line px-3 py-3">
        {username && (
          <Link
            to="/perfil"
            onClick={onNavigate}
            title="Editar perfil"
            className="group mb-1 flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-rail-hover focus-visible:ring-offset-rail"
          >
            <UserAvatar path={profile?.avatar_path} name={username} className="h-8 w-8" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-white">{username}</span>
              <span className="block text-xs text-rail-muted">Meu perfil</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-rail-muted group-hover:text-white" aria-hidden="true" />
          </Link>
        )}
        <ThemeToggle showLabel onRail />
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-rail-muted transition-colors',
            'hover:bg-rail-hover hover:text-white focus-visible:ring-offset-rail',
            'disabled:cursor-not-allowed disabled:opacity-60',
          )}
        >
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
          {signingOut ? 'Saindo...' : 'Sair'}
        </button>
      </div>
    </div>
  )
}

export default function Layout() {
  const [leadForm, setLeadForm] = useState<{ open: boolean; client: RecurringClientMatch | null }>({
    open: false,
    client: null,
  })
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [leadsVersion, setLeadsVersion] = useState(0)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)

  const openNewLead = useCallback(() => {
    setIsMobileMenuOpen(false)
    setLeadForm({ open: true, client: null })
  }, [])

  const openNewLeadForClient = useCallback((client: RecurringClientMatch) => {
    setIsMobileMenuOpen(false)
    setLeadForm({ open: true, client })
  }, [])

  const closeLeadForm = useCallback(() => {
    // Mantém o lead durante a animação de saída
    setLeadForm((current) => ({ ...current, open: false }))
  }, [])

  const handleLeadSaved = useCallback((lead: Lead) => {
    setLeadsVersion((current) => current + 1)
    setToast({ id: Date.now(), message: `Proposta de "${lead.contact_name}" cadastrada.` })
  }, [])

  const showToast = useCallback((message: string) => setToast({ id: Date.now(), message }), [])

  // Esconde o aviso de sucesso depois de alguns segundos
  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 3500)
    return () => window.clearTimeout(timeout)
  }, [toast])

  // Fecha o menu mobile com ESC
  useEffect(() => {
    if (!isMobileMenuOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMobileMenuOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isMobileMenuOpen])

  const outletContext: LayoutOutletContext = { openNewLead, openNewLeadForClient, showToast, leadsVersion }

  return (
    <div className="min-h-screen bg-canvas dark:bg-slate-950">
      {/* Sidebar fixa (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 bg-rail lg:block dark:border-r dark:border-slate-800">
        <SidebarContent onNewLead={openNewLead} />
      </aside>

      {/* Barra superior (mobile/tablet) */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:hidden dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Abrir menu"
            className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <AppLogo size="sm" />
        </div>
        <div className="flex items-center gap-1">
          {DemoModeBadge && (
            <Suspense fallback={null}>
              <DemoModeBadge compact />
            </Suspense>
          )}
          <ThemeToggle />
          <button
            type="button"
            onClick={openNewLead}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Nova Proposta</span>
          </button>
        </div>
      </header>

      {/* Menu lateral (mobile/tablet) */}
      <div
        className={cn('fixed inset-0 z-40 lg:hidden', isMobileMenuOpen ? 'pointer-events-auto' : 'pointer-events-none')}
        aria-hidden={!isMobileMenuOpen}
      >
        <div
          onClick={() => setIsMobileMenuOpen(false)}
          className={cn(
            'absolute inset-0 bg-slate-950/50 transition-opacity duration-200',
            isMobileMenuOpen ? 'opacity-100' : 'opacity-0',
          )}
        />
        <aside
          className={cn(
            'absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-rail shadow-xl transition-transform duration-200 ease-out',
            isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-label="Fechar menu"
            className="absolute right-3 top-3 z-10 rounded-lg p-2 text-rail-muted transition-colors hover:bg-rail-hover hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <SidebarContent onNewLead={openNewLead} onNavigate={() => setIsMobileMenuOpen(false)} />
        </aside>
      </div>

      {/* Conteúdo full-width */}
      <main className="lg:pl-60">
        <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-7">
          <Outlet context={outletContext} />
        </div>
      </main>

      <LeadFormModal
        open={leadForm.open}
        presetClient={leadForm.client}
        onClose={closeLeadForm}
        onSaved={handleLeadSaved}
      />

      {/* Aviso de sucesso */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex justify-center sm:inset-x-auto sm:right-6 sm:justify-end">
        {toast && (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg dark:bg-white dark:text-slate-900"
          >
            <CircleCheck className="h-5 w-5 shrink-0 text-emerald-400 dark:text-emerald-600" aria-hidden="true" />
            {toast.message}
          </div>
        )}
      </div>
    </div>
  )
}
