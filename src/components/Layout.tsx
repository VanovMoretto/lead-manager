import { useCallback, useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  CalendarHeart,
  CircleCheck,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { cn } from '../lib/utils'
import type { Lead } from '../types/lead'
import LeadFormModal, { type LeadFormMode } from './LeadFormModal'
import ThemeToggle from './ThemeToggle'

/** Disponível nas páginas via `useOutletContext<LayoutOutletContext>()`. */
export type LayoutOutletContext = {
  /** Abre o formulário de cadastro de lead. */
  openNewLead: () => void
  /** Abre o mesmo formulário preenchido para edição. */
  openEditLead: (lead: Lead) => void
  /** Muda a cada lead salvo: use como dependência para recarregar listas e indicadores. */
  leadsVersion: number
}

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/leads', label: 'Consultar Leads', icon: Search },
  { to: '/admin', label: 'Painel Admin', icon: Settings },
]

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-900 to-brand-600 text-white shadow-sm">
        <CalendarHeart className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="leading-tight">
        <p className="text-base font-bold text-slate-900 dark:text-white">Gestão de Leads</p>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Eventos &amp; Orçamentos</p>
      </div>
    </div>
  )
}

type SidebarContentProps = {
  onNewLead: () => void
  onNavigate?: () => void
}

function SidebarContent({ onNewLead, onNavigate }: SidebarContentProps) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    await signOut()
    setSigningOut(false)
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-5 pt-6">
        <Brand />
      </div>

      <div className="px-4">
        <button
          type="button"
          onClick={onNewLead}
          className={cn(
            'flex w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors',
            'hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2',
            'dark:focus-visible:ring-offset-slate-900',
          )}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Novo Lead
        </button>
      </div>

      <nav className="mt-6 flex-1 space-y-1 px-3" aria-label="Navegação principal">
        <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          Menu
        </p>
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand-50 text-brand-900 dark:bg-brand-900/40 dark:text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  className={cn(
                    'h-5 w-5 shrink-0',
                    isActive
                      ? 'text-brand-600 dark:text-brand-300'
                      : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300',
                  )}
                  aria-hidden="true"
                />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-1 border-t border-slate-200 px-3 py-4 dark:border-slate-800">
        {user?.email && (
          <div className="mb-2 flex items-center gap-3 px-3 py-1">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {user.email.charAt(0)}
            </span>
            <p className="truncate text-sm text-slate-600 dark:text-slate-300" title={user.email}>
              {user.email}
            </p>
          </div>
        )}
        <ThemeToggle showLabel />
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors',
            'hover:bg-red-50 hover:text-red-700 dark:text-slate-300 dark:hover:bg-red-950/40 dark:hover:text-red-300',
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
  const [leadForm, setLeadForm] = useState<{ open: boolean; lead: Lead | null }>({ open: false, lead: null })
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [leadsVersion, setLeadsVersion] = useState(0)
  const [toast, setToast] = useState<{ id: number; message: string } | null>(null)

  const openNewLead = useCallback(() => {
    setIsMobileMenuOpen(false)
    setLeadForm({ open: true, lead: null })
  }, [])

  const openEditLead = useCallback((lead: Lead) => {
    setIsMobileMenuOpen(false)
    setLeadForm({ open: true, lead })
  }, [])

  const closeLeadForm = useCallback(() => {
    // Mantém o lead durante a animação de saída
    setLeadForm((current) => ({ ...current, open: false }))
  }, [])

  const handleLeadSaved = useCallback((lead: Lead, mode: LeadFormMode) => {
    setLeadsVersion((current) => current + 1)
    setToast({
      id: Date.now(),
      message: mode === 'create' ? `Lead "${lead.contact_name}" cadastrado.` : `Lead "${lead.contact_name}" atualizado.`,
    })
  }, [])

  const handleLeadDeleted = useCallback((lead: Lead) => {
    setLeadsVersion((current) => current + 1)
    setToast({ id: Date.now(), message: `Lead "${lead.contact_name}" excluído.` })
  }, [])

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

  const outletContext: LayoutOutletContext = { openNewLead, openEditLead, leadsVersion }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Sidebar fixa (desktop) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900">
        <SidebarContent onNewLead={openNewLead} />
      </aside>

      {/* Barra superior (mobile/tablet) */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/90">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Abrir menu"
            className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <Brand />
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <button
            type="button"
            onClick={openNewLead}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Novo Lead</span>
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
            'absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300',
            isMobileMenuOpen ? 'opacity-100' : 'opacity-0',
          )}
        />
        <aside
          className={cn(
            'absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-slate-200 bg-white shadow-xl transition-transform duration-300 ease-out',
            'dark:border-slate-800 dark:bg-slate-900',
            isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(false)}
            aria-label="Fechar menu"
            className="absolute right-3 top-3 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <SidebarContent onNewLead={openNewLead} onNavigate={() => setIsMobileMenuOpen(false)} />
        </aside>
      </div>

      {/* Conteúdo full-width */}
      <main className="lg:pl-64">
        <div className="w-full px-4 py-6 sm:px-6 lg:px-10 lg:py-8">
          <Outlet context={outletContext} />
        </div>
      </main>

      <LeadFormModal
        open={leadForm.open}
        lead={leadForm.lead}
        onClose={closeLeadForm}
        onSaved={handleLeadSaved}
        onDeleted={handleLeadDeleted}
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
