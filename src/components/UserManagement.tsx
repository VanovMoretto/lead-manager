import { useEffect, useMemo, useState } from 'react'
import { CircleAlert, Info, RefreshCw, Search, ShieldCheck, UserCheck, Users } from 'lucide-react'
import type { PostgrestError } from '@supabase/supabase-js'
import { DEFAULT_EMAIL_DOMAIN, useAuth } from '../contexts/AuthContext'
import { useConfirm } from '../hooks/useConfirm'
import { supabase } from '../lib/supabase'
import { RateLimitError, guardMutation } from '../lib/rateLimit'
import { cn } from '../lib/utils'
import type { UserProfile } from '../types/lead'
import ToggleSwitch from './ToggleSwitch'
import UserAvatar from './UserAvatar'

type LoadState = { key: number; profiles: UserProfile[] | null; error: string | null }

function translateError(error: PostgrestError): string {
  if (error.code === 'PGRST205' || error.code === '42P01' || error.code === 'PGRST202') {
    return 'A gestão de usuários fica disponível depois que a migração 007 for aplicada no Supabase.'
  }
  if (error.code === '42501') return 'Apenas administradores podem alterar o acesso de usuários.'
  if (error.message.includes('self_access_change')) return 'Você não pode alterar o próprio acesso.'
  if (error.code === 'P0002') return 'Usuário não encontrado. Atualize a lista.'
  if (error.message.toLowerCase().includes('failed to fetch')) return 'Sem conexão com o servidor. Tente novamente.'
  return 'Não foi possível salvar a alteração. Tente novamente.'
}

/** "nome.sobrenome@swanhoteis.com.br" -> "nome.sobrenome"; outros domínios aparecem completos. */
function displayName(profile: UserProfile): string {
  const email = profile.email ?? ''
  return email.endsWith(DEFAULT_EMAIL_DOMAIN) ? email.slice(0, -DEFAULT_EMAIL_DOMAIN.length) : email || 'Sem e-mail'
}

function formatLastSignIn(timestamp: string | null): string {
  if (!timestamp) return 'Nunca acessou'
  return new Date(timestamp).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

async function fetchProfiles(): Promise<UserProfile[]> {
  const { data, error } = await supabase.from('user_profiles').select('*').order('email', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** Aba "Usuários" do Painel Admin: acesso ativo/inativo e papel de cada usuário. */
export default function UserManagement() {
  const { user } = useAuth()
  const confirm = useConfirm()
  const [reloadCount, setReloadCount] = useState(0)
  const [state, setState] = useState<LoadState | null>(null)
  const [search, setSearch] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => {
    let isActive = true
    fetchProfiles()
      .then((profiles) => {
        if (isActive) setState({ key: reloadCount, profiles, error: null })
      })
      .catch((error: PostgrestError) => {
        if (isActive) setState({ key: reloadCount, profiles: null, error: translateError(error) })
      })
    return () => {
      isActive = false
    }
  }, [reloadCount])

  const loading = state?.key !== reloadCount
  const profiles = useMemo(() => state?.profiles ?? [], [state])
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return term ? profiles.filter((profile) => (profile.email ?? '').toLowerCase().includes(term)) : profiles
  }, [profiles, search])

  const activeCount = profiles.filter((profile) => profile.is_active).length
  const adminCount = profiles.filter((profile) => profile.is_admin && profile.is_active).length

  const updateAccess = async (profile: UserProfile, change: { is_admin?: boolean; is_active?: boolean }) => {
    const name = displayName(profile)
    if (
      change.is_active === false &&
      !(await confirm({
        title: `Desativar o acesso de "${name}"?`,
        description: 'O usuário deixa de ver e alterar qualquer dado do sistema. Você pode reativar depois.',
        confirmLabel: 'Desativar acesso',
        tone: 'danger',
      }))
    ) {
      return
    }
    if (
      change.is_admin === true &&
      !(await confirm({
        title: `Tornar "${name}" administrador?`,
        description: 'ADMIN pode excluir propostas, clientes e anexos e gerenciar usuários e opções do Painel Admin.',
        confirmLabel: 'Tornar ADMIN',
        tone: 'warning',
      }))
    ) {
      return
    }

    const apply = (next: UserProfile) =>
      setState((current) =>
        current?.profiles ? { ...current, profiles: current.profiles.map((item) => (item.user_id === next.user_id ? next : item)) } : current,
      )

    setSavingId(profile.user_id)
    setActionError(null)
    let response
    try {
      // Uma alteração por usuário a cada 1,5 s
      response = await guardMutation(`user:access:${profile.user_id}`, async () => {
        // Atualização otimista: desfaz se o banco recusar
        apply({ ...profile, ...change })
        return supabase
          .rpc('admin_set_user_access', {
            p_user_id: profile.user_id,
            ...(change.is_admin !== undefined && { p_is_admin: change.is_admin }),
            ...(change.is_active !== undefined && { p_is_active: change.is_active }),
          })
          .single()
      })
    } catch (guardError) {
      setSavingId(null)
      setActionError(guardError instanceof RateLimitError ? guardError.message : 'Não foi possível salvar a alteração. Tente novamente.')
      return
    }
    const { data, error } = response
    setSavingId(null)

    if (error || !data) {
      apply(profile)
      setActionError(error ? translateError(error) : 'Não foi possível salvar a alteração. Tente novamente.')
      return
    }
    apply(data)
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="flex flex-col gap-4 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between dark:border-slate-800">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
            <Users className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Gestão de usuários</h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              {profiles.length} usuário(s) · {activeCount} ativo(s) · {adminCount} administrador(es)
            </p>
          </div>
        </div>
        <div className="relative w-full md:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <label htmlFor="user-search" className="sr-only">
            Buscar usuário
          </label>
          <input
            id="user-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por usuário ou e-mail"
            className="block w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500"
          />
        </div>
      </header>

      <p className="flex items-start gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-300">
        <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Novos usuários são criados no Supabase (Authentication → Users) e aparecem aqui como <strong className="font-semibold">inativos</strong>: ative o acesso
        para a pessoa conseguir entrar. Você não pode alterar o próprio acesso.
      </p>

      {actionError && (
        <p
          role="alert"
          className="mx-5 mt-4 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {actionError}
        </p>
      )}

      {loading ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : state?.error ? (
        <div className="m-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
          <span className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            {state.error}
          </span>
          <button type="button" onClick={() => setReloadCount((current) => current + 1)} className="inline-flex items-center gap-1 font-semibold hover:underline">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Tentar de novo
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <p className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
          {profiles.length === 0 ? 'Nenhum usuário cadastrado.' : 'Nenhum usuário encontrado com essa busca.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:border-slate-800 dark:bg-slate-950/50 dark:text-slate-400">
              <tr>
                <th scope="col" className="px-5 py-3">Usuário</th>
                <th scope="col" className="px-3 py-3">Último acesso</th>
                <th scope="col" className="px-3 py-3">Permissão</th>
                <th scope="col" className="px-5 py-3 text-right">Acesso</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filtered.map((profile) => {
                const isSelf = profile.user_id === user?.id
                const saving = savingId === profile.user_id
                const name = displayName(profile)
                return (
                  <tr key={profile.user_id} className={cn(!profile.is_active && 'bg-slate-50/60 dark:bg-slate-950/30')}>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <UserAvatar path={profile.avatar_path} name={name} className="h-9 w-9" />
                        <div className="min-w-0">
                          <p className={cn('truncate font-medium', profile.is_active ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500')}>
                            {name}
                            {isSelf && <span className="ml-2 rounded-full bg-brand-50 px-1.5 py-0.5 text-xs font-semibold text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">Você</span>}
                          </p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{profile.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-slate-300">{formatLastSignIn(profile.last_sign_in_at)}</td>
                    <td className="px-3 py-3">
                      <label htmlFor={`role-${profile.user_id}`} className="sr-only">
                        Permissão de {name}
                      </label>
                      <div className="flex items-center gap-2">
                        {profile.is_admin ? (
                          <ShieldCheck className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" aria-hidden="true" />
                        ) : (
                          <UserCheck className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                        )}
                        <select
                          id={`role-${profile.user_id}`}
                          value={profile.is_admin ? 'admin' : 'user'}
                          disabled={isSelf || saving}
                          title={isSelf ? 'Você não pode alterar a própria permissão' : undefined}
                          onChange={(event) => void updateAccess(profile, { is_admin: event.target.value === 'admin' })}
                          className="rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        >
                          <option value="user">Usuário Comum</option>
                          <option value="admin">Admin</option>
                        </select>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <span className={cn('text-xs font-semibold', profile.is_active ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')}>
                          {profile.is_active ? 'Ativo' : 'Desativado'}
                        </span>
                        <ToggleSwitch
                          checked={profile.is_active}
                          disabled={isSelf || saving}
                          onChange={() => void updateAccess(profile, { is_active: !profile.is_active })}
                          label={isSelf ? 'Você não pode desativar o próprio acesso' : profile.is_active ? `Desativar ${name}` : `Ativar ${name}`}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
