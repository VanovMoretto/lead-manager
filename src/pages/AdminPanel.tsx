import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  CircleAlert,
  DoorOpen,
  Info,
  ListChecks,
  LoaderCircle,
  Megaphone,
  Plus,
  RefreshCw,
  ThumbsDown,
  Users,
  type LucideIcon,
} from 'lucide-react'
import type { PostgrestError } from '@supabase/supabase-js'
import PageHeader from '../components/PageHeader'
import ToggleSwitch from '../components/ToggleSwitch'
import UserManagement from '../components/UserManagement'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import {
  LOSS_REASON_OTHER,
  SETTING_CATEGORIES,
  SETTING_CATEGORY_LABELS,
  type AppSettingOption,
  type SettingCategory,
} from '../types/lead'

// =============================================================================
// Configuração de cada categoria
// =============================================================================

type CategoryConfig = {
  icon: LucideIcon
  description: string
  placeholder: string
  singular: string
}

const CATEGORY_CONFIG: Record<SettingCategory, CategoryConfig> = {
  room: {
    icon: DoorOpen,
    description: 'Espaços oferecidos no select "Sala/Salão de interesse".',
    placeholder: 'Ex.: Nome da sala ou salão',
    singular: 'sala',
  },
  origin: {
    icon: Megaphone,
    description: 'Canais pelos quais o cliente chegou até vocês.',
    placeholder: 'Ex.: Canal de prospecção',
    singular: 'meio de prospecção',
  },
  loss_reason: {
    icon: ThumbsDown,
    description: 'Motivos exibidos quando um lead "Não Fechou".',
    placeholder: 'Ex.: Motivo da perda',
    singular: 'motivo',
  },
}

const MAX_LABEL_LENGTH = 80

type AdminSection = 'options' | 'users'

const ADMIN_SECTIONS: Array<{ value: AdminSection; label: string; icon: LucideIcon }> = [
  { value: 'options', label: 'Opções dos formulários', icon: ListChecks },
  { value: 'users', label: 'Usuários', icon: Users },
]

/** Ativas primeiro, depois ordem alfabética. */
function sortOptions(options: AppSettingOption[]): AppSettingOption[] {
  return [...options].sort((a, b) => Number(b.active) - Number(a.active) || a.label.localeCompare(b.label, 'pt-BR'))
}

function translateError(error: PostgrestError): string {
  if (error.code === '23505') return 'Essa opção já existe nesta categoria.'
  if (error.code === '23514') return 'O nome da opção não pode ficar vazio.'
  if (error.code === '42501') return 'Você não tem permissão para alterar as opções. Faça login novamente.'
  if (error.message.toLowerCase().includes('failed to fetch')) return 'Sem conexão com o servidor. Tente novamente.'
  return 'Não foi possível salvar. Tente novamente.'
}

// =============================================================================
// Card de uma categoria
// =============================================================================

type CategoryCardProps = {
  category: SettingCategory
  options: AppSettingOption[]
  onAdd: (category: SettingCategory, label: string) => Promise<string | null>
  onToggle: (option: AppSettingOption) => Promise<string | null>
}

function CategoryCard({ category, options, onAdd, onToggle }: CategoryCardProps) {
  const config = CATEGORY_CONFIG[category]
  const Icon = config.icon
  const inputId = `new-option-${category}`

  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)

  const sorted = useMemo(() => sortOptions(options), [options])
  const activeCount = options.filter((option) => option.active).length

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const label = newLabel.trim().replace(/\s+/g, ' ')
    if (!label) {
      setError(`Digite o nome do(a) ${config.singular}.`)
      return
    }

    const duplicate = options.find((option) => option.label.localeCompare(label, 'pt-BR', { sensitivity: 'base' }) === 0)
    if (duplicate) {
      setError(duplicate.active ? 'Essa opção já existe.' : 'Essa opção já existe, mas está inativa. Reative-a na lista abaixo.')
      return
    }

    setAdding(true)
    setError(null)
    const result = await onAdd(category, label)
    setAdding(false)

    if (result) {
      setError(result)
      return
    }
    setNewLabel('')
  }

  const handleToggle = async (option: AppSettingOption) => {
    setTogglingId(option.id)
    setToggleError(null)
    const result = await onToggle(option)
    setTogglingId(null)
    if (result) setToggleError(result)
  }

  return (
    <section className="flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-start gap-3 border-b border-slate-200 p-5 dark:border-slate-800">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{SETTING_CATEGORY_LABELS[category]}</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {activeCount} ativa{activeCount === 1 ? '' : 's'} · {options.length} no total
            </span>
          </div>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{config.description}</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="border-b border-slate-200 p-5 dark:border-slate-800" noValidate>
        <label htmlFor={inputId} className="sr-only">
          Nova opção em {SETTING_CATEGORY_LABELS[category]}
        </label>
        <div className="flex gap-2">
          <input
            id={inputId}
            type="text"
            value={newLabel}
            maxLength={MAX_LABEL_LENGTH}
            placeholder={config.placeholder}
            onChange={(event) => {
              setNewLabel(event.target.value)
              if (error) setError(null)
            }}
            disabled={adding}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className={cn(
              'block w-full min-w-0 rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors',
              'placeholder:text-slate-400 focus:outline-none focus:ring-2',
              'dark:bg-slate-950 dark:text-white dark:placeholder:text-slate-500',
              error
                ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20 dark:border-red-700'
                : 'border-slate-200 focus:border-brand-600 focus:ring-brand-600/20 dark:border-slate-700',
            )}
          />
          <button
            type="submit"
            disabled={adding}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {adding ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
            Adicionar
          </button>
        </div>
        {error && (
          <p id={`${inputId}-error`} role="alert" className="mt-2 flex items-start gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        )}
      </form>

      {toggleError && (
        <p
          role="alert"
          className="mx-5 mt-4 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
        >
          <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {toggleError}
        </p>
      )}

      {sorted.length === 0 ? (
        <p className="flex-1 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          Nenhuma opção cadastrada. Adicione a primeira acima.
        </p>
      ) : (
        <ul className="flex-1 divide-y divide-slate-100 dark:divide-slate-800">
          {sorted.map((option) => (
            <li key={option.id} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p
                  className={cn(
                    'truncate text-sm font-medium',
                    option.active ? 'text-slate-900 dark:text-white' : 'text-slate-400 line-through dark:text-slate-500',
                  )}
                  title={option.label}
                >
                  {option.label}
                </p>
                {!option.active && <p className="text-xs text-slate-400 dark:text-slate-500">Inativa · não aparece nos formulários</p>}
              </div>
              <ToggleSwitch
                checked={option.active}
                disabled={togglingId === option.id}
                onChange={() => void handleToggle(option)}
                label={option.active ? `Desativar "${option.label}"` : `Ativar "${option.label}"`}
              />
            </li>
          ))}
        </ul>
      )}

      {category === 'loss_reason' && (
        <p className="flex items-start gap-2 border-t border-slate-200 px-5 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Mantenha &quot;{LOSS_REASON_OTHER}&quot; ativo: ao escolhê-lo, o formulário pede uma descrição do motivo.
        </p>
      )}
    </section>
  )
}

// =============================================================================
// Página
// =============================================================================

type LoadState = { status: 'loading' | 'ready' | 'error'; options: AppSettingOption[] }

async function fetchAllOptions(): Promise<AppSettingOption[]> {
  const { data, error } = await supabase.from('app_settings_options').select('*').order('label', { ascending: true })
  if (error) throw error
  return data ?? []
}

export default function AdminPanel() {
  const [state, setState] = useState<LoadState>({ status: 'loading', options: [] })
  const [reloadCount, setReloadCount] = useState(0)
  const [mobileTab, setMobileTab] = useState<SettingCategory>('room')
  const [section, setSection] = useState<AdminSection>('options')

  useEffect(() => {
    let isActive = true
    fetchAllOptions()
      .then((options) => {
        if (isActive) setState({ status: 'ready', options })
      })
      .catch(() => {
        if (isActive) setState((current) => ({ ...current, status: 'error' }))
      })
    return () => {
      isActive = false
    }
  }, [reloadCount])

  const byCategory = useMemo(() => {
    const grouped: Record<SettingCategory, AppSettingOption[]> = { room: [], origin: [], loss_reason: [] }
    for (const option of state.options) grouped[option.category].push(option)
    return grouped
  }, [state.options])

  const handleAdd = async (category: SettingCategory, label: string): Promise<string | null> => {
    const { data, error } = await supabase.from('app_settings_options').insert({ category, label }).select().single()
    if (error) return translateError(error)
    setState((current) => ({ ...current, options: [...current.options, data] }))
    return null
  }

  /** Atualização otimista: muda na tela na hora e desfaz se o banco recusar. */
  const handleToggle = async (option: AppSettingOption): Promise<string | null> => {
    const nextActive = !option.active
    const applyActive = (active: boolean) =>
      setState((current) => ({
        ...current,
        options: current.options.map((item) => (item.id === option.id ? { ...item, active } : item)),
      }))

    applyActive(nextActive)
    const { error } = await supabase.from('app_settings_options').update({ active: nextActive }).eq('id', option.id)
    if (error) {
      applyActive(option.active)
      return translateError(error)
    }
    return null
  }

  const retry = () => {
    setState((current) => ({ ...current, status: 'loading' }))
    setReloadCount((current) => current + 1)
  }

  return (
    <>
      <PageHeader
        title="Painel Admin"
        description={
          section === 'options'
            ? 'Gerencie as opções dos formulários sem alterar o código. Desativar uma opção a esconde dos formulários, mas preserva o histórico dos leads.'
            : 'Ative ou desative o acesso dos usuários e defina quem é administrador.'
        }
      />

      <div
        role="tablist"
        aria-label="Seções do Painel Admin"
        className="mb-6 inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        {ADMIN_SECTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={section === value}
            onClick={() => setSection(value)}
            className={cn(
              'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              section === value
                ? 'bg-brand-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {section === 'users' ? (
        <UserManagement />
      ) : (
        <>
        {state.status === 'error' && (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            <span className="flex items-center gap-2">
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              Não foi possível carregar as opções.
            </span>
            <button type="button" onClick={retry} className="inline-flex items-center gap-1 font-semibold hover:underline">
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Tentar de novo
            </button>
          </div>
        )}

        {/* Abas no celular/tablet; três colunas no desktop */}
        <div
          role="tablist"
          aria-label="Categorias"
          className="mb-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 shadow-sm xl:hidden dark:border-slate-800 dark:bg-slate-900"
        >
          {SETTING_CATEGORIES.map((category) => (
            <button
              key={category}
              type="button"
              role="tab"
              aria-selected={mobileTab === category}
              onClick={() => setMobileTab(category)}
              className={cn(
                'flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                mobileTab === category
                  ? 'bg-brand-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
              )}
            >
              {SETTING_CATEGORY_LABELS[category]}
            </button>
          ))}
        </div>

        {state.status === 'loading' ? (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            {SETTING_CATEGORIES.map((category) => (
              <div
                key={category}
                className={cn(
                  'h-80 animate-pulse rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900',
                  mobileTab !== category && 'hidden xl:block',
                )}
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
            {SETTING_CATEGORIES.map((category) => (
              <div key={category} className={cn(mobileTab !== category && 'hidden xl:block')}>
                <CategoryCard category={category} options={byCategory[category]} onAdd={handleAdd} onToggle={handleToggle} />
              </div>
            ))}
          </div>
        )}
        </>
      )}
    </>
  )
}
