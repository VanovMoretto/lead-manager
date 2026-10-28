import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Check,
  CircleAlert,
  DoorOpen,
  Info,
  ListChecks,
  LoaderCircle,
  Megaphone,
  Pencil,
  Plus,
  RefreshCw,
  ThumbsDown,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { PostgrestError } from '@supabase/supabase-js'
import PageHeader from '../components/PageHeader'
import ToggleSwitch from '../components/ToggleSwitch'
import UserManagement from '../components/UserManagement'
import { supabase } from '../lib/supabase'
import { RateLimitError, guardMutation } from '../lib/rateLimit'
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

/** Quantas propostas usam a opção (null se não deu para contar). */
async function countOptionUsage(option: AppSettingOption): Promise<number | null> {
  const base = supabase.from('leads').select('id', { count: 'exact', head: true })
  const query =
    option.category === 'room'
      ? base.contains('room_interests', [option.label])
      : base.eq(option.category === 'origin' ? 'origin' : 'loss_reason', option.label)
  const { count, error } = await query
  return error ? null : (count ?? 0)
}

function translateError(error: PostgrestError): string {
  if (error.code === '23505') return 'Essa opção já existe nesta categoria.'
  if (error.code === '23514') return 'O nome da opção não pode ficar vazio.'
  if (error.code === '42501') return 'Você não tem permissão para alterar as opções. Faça login novamente.'
  if (error.message.toLowerCase().includes('failed to fetch')) return 'Sem conexão com o servidor. Tente novamente.'
  return 'Não foi possível salvar. Tente novamente.'
}

// =============================================================================
// Exclusão de uma opção (com a escolha de outra para receber as propostas)
// =============================================================================

type DeleteOptionModalProps = {
  option: AppSettingOption
  candidates: AppSettingOption[]
  onClose: () => void
  onDelete: (option: AppSettingOption, replacementId: string | null) => Promise<string | null>
}

function DeleteOptionModal({ option, candidates, onClose, onDelete }: DeleteOptionModalProps) {
  const singular = CATEGORY_CONFIG[option.category].singular
  const [usage, setUsage] = useState<{ id: string; count: number | null } | null>(null)
  const [replacementId, setReplacementId] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const usageCount = usage?.id === option.id ? usage.count : undefined

  useEffect(() => {
    let isActive = true
    countOptionUsage(option).then((count) => {
      if (isActive) setUsage({ id: option.id, count })
    })
    return () => {
      isActive = false
    }
  }, [option])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !deleting) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, deleting])

  const confirm = async () => {
    setDeleting(true)
    setError(null)
    const result = await onDelete(option, replacementId || null)
    setDeleting(false)
    if (result) setError(result)
    else onClose()
  }

  const selectId = `replace-${option.id}`
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => !deleting && onClose()} aria-hidden="true" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-option-title"
        className="relative w-full max-w-md rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex gap-4 px-5 pb-4 pt-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400">
            <Trash2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 id="delete-option-title" className="text-base font-semibold text-slate-900 dark:text-white">
              Excluir {singular} &quot;{option.label}&quot;?
            </h2>
            <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
              {usageCount === undefined
                ? 'Verificando quantas propostas usam esta opção...'
                : usageCount === null
                  ? 'Não foi possível contar as propostas que usam esta opção.'
                  : usageCount === 0
                    ? 'Nenhuma proposta usa esta opção.'
                    : `${usageCount} proposta(s) usam esta opção.`}
            </p>
            {usageCount !== 0 && candidates.length > 0 && (
              <div className="mt-3">
                <label htmlFor={selectId} className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  O que fazer com essas propostas?
                </label>
                <select
                  id={selectId}
                  value={replacementId}
                  onChange={(event) => setReplacementId(event.target.value)}
                  className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  <option value="">Manter o nome antigo no histórico delas</option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      Passar para &quot;{candidate.label}&quot;{candidate.active ? '' : ' (inativa)'}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                  Para juntar uma opção duplicada, escolha a opção certa: as propostas passam a usar ela.
                </p>
              </div>
            )}
            {error && (
              <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm font-medium text-red-600 dark:text-red-400">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end dark:border-slate-800">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            disabled={deleting}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={deleting || usageCount === undefined}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Excluir {singular}
          </button>
        </div>
      </div>
    </div>
  )
}

// =============================================================================
// Linha de uma opção (nome editável, ativar/desativar e excluir)
// =============================================================================

type OptionRowProps = {
  option: AppSettingOption
  toggling: boolean
  onToggle: () => void
  onRename: (label: string) => Promise<string | null>
  onRequestDelete: () => void
}

function OptionRow({ option, toggling, onToggle, onRename, onRequestDelete }: OptionRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(option.label)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // "Outros" é usado pelo formulário para pedir a descrição do motivo
  const locked = option.category === 'loss_reason' && option.label === LOSS_REASON_OTHER
  const inputId = `edit-option-${option.id}`

  const startEditing = () => {
    setDraft(option.label)
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    const label = draft.trim().replace(/\s+/g, ' ')
    if (!label) {
      setError('O nome não pode ficar vazio.')
      return
    }
    if (label === option.label) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    const result = await onRename(label)
    setSaving(false)
    if (result) setError(result)
    else setEditing(false)
  }

  const iconButton =
    'rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-slate-800 dark:hover:text-slate-200'

  if (editing) {
    return (
      <li className="px-5 py-3">
        <label htmlFor={inputId} className="sr-only">
          Novo nome de &quot;{option.label}&quot;
        </label>
        <div className="flex items-center gap-2">
          <input
            id={inputId}
            type="text"
            autoFocus
            value={draft}
            maxLength={MAX_LABEL_LENGTH}
            disabled={saving}
            onChange={(event) => {
              setDraft(event.target.value)
              if (error) setError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void save()
              }
              if (event.key === 'Escape') {
                event.stopPropagation()
                setEditing(false)
              }
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${inputId}-error` : undefined}
            className="block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            aria-label="Salvar nome"
            title="Salvar (Enter)"
            className="rounded-lg bg-brand-600 p-2 text-white transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => setEditing(false)} disabled={saving} aria-label="Cancelar edição" title="Cancelar (Esc)" className={iconButton}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {error ? (
          <p id={`${inputId}-error`} role="alert" className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
            <CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error}
          </p>
        ) : (
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">As propostas que usam este nome também são corrigidas.</p>
        )}
      </li>
    )
  }

  return (
    <li className="group flex items-center justify-between gap-3 px-5 py-3">
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
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={startEditing}
          disabled={locked}
          aria-label={`Editar "${option.label}"`}
          title={locked ? 'O formulário usa este motivo para pedir detalhes' : 'Editar nome'}
          className={iconButton}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onRequestDelete}
          disabled={locked}
          aria-label={`Excluir "${option.label}"`}
          title={locked ? 'O formulário usa este motivo para pedir detalhes' : 'Excluir'}
          className={cn(iconButton, 'hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400')}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="ml-1">
          <ToggleSwitch
            checked={option.active}
            disabled={toggling}
            onChange={onToggle}
            label={option.active ? `Desativar "${option.label}"` : `Ativar "${option.label}"`}
          />
        </span>
      </div>
    </li>
  )
}

// =============================================================================
// Card de uma categoria
// =============================================================================

type CategoryCardProps = {
  category: SettingCategory
  options: AppSettingOption[]
  onAdd: (category: SettingCategory, label: string) => Promise<string | null>
  onToggle: (option: AppSettingOption) => Promise<string | null>
  onRename: (option: AppSettingOption, label: string) => Promise<string | null>
  onDelete: (option: AppSettingOption, replacementId: string | null) => Promise<string | null>
}

function CategoryCard({ category, options, onAdd, onToggle, onRename, onDelete }: CategoryCardProps) {
  const config = CATEGORY_CONFIG[category]
  const Icon = config.icon
  const inputId = `new-option-${category}`

  const [newLabel, setNewLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<AppSettingOption | null>(null)

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
            <OptionRow
              key={option.id}
              option={option}
              toggling={togglingId === option.id}
              onToggle={() => void handleToggle(option)}
              onRename={(label) => onRename(option, label)}
              onRequestDelete={() => setDeleting(option)}
            />
          ))}
        </ul>
      )}

      {category === 'loss_reason' && (
        <p className="flex items-start gap-2 border-t border-slate-200 px-5 py-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
          <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Mantenha &quot;{LOSS_REASON_OTHER}&quot; ativo: ao escolhê-lo, o formulário pede uma descrição do motivo.
        </p>
      )}

      {deleting && (
        <DeleteOptionModal
          option={deleting}
          candidates={sorted.filter((option) => option.id !== deleting.id)}
          onClose={() => setDeleting(null)}
          onDelete={onDelete}
        />
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
    let response
    try {
      response = await guardMutation(`option:add:${category}:${label.toLocaleLowerCase('pt-BR')}`, async () =>
        supabase.from('app_settings_options').insert({ category, label }).select().single(),
      )
    } catch (error) {
      return error instanceof RateLimitError ? error.message : 'Não foi possível salvar. Tente novamente.'
    }
    const { data, error } = response
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

    let response
    try {
      // Liga/desliga a mesma opção no máximo uma vez a cada 1,5 s
      response = await guardMutation(`option:toggle:${option.id}`, async () => {
        applyActive(nextActive)
        return supabase.from('app_settings_options').update({ active: nextActive }).eq('id', option.id)
      })
    } catch (error) {
      return error instanceof RateLimitError ? error.message : 'Não foi possível salvar. Tente novamente.'
    }
    const { error } = response
    if (error) {
      applyActive(option.active)
      return translateError(error)
    }
    return null
  }

  const handleRename = async (option: AppSettingOption, label: string): Promise<string | null> => {
    const duplicate = state.options.find(
      (item) => item.id !== option.id && item.category === option.category && item.label.localeCompare(label, 'pt-BR', { sensitivity: 'base' }) === 0,
    )
    if (duplicate) {
      return `Já existe "${duplicate.label}". Para juntar as duas, exclua esta e escolha "${duplicate.label}" para receber as propostas.`
    }
    let response
    try {
      response = await guardMutation(`option:rename:${option.id}:${label}`, async () =>
        supabase.rpc('admin_rename_setting_option', { p_option_id: option.id, p_label: label }),
      )
    } catch (error) {
      return error instanceof RateLimitError ? error.message : 'Não foi possível salvar. Tente novamente.'
    }
    const { data, error } = response
    if (error || !data) {
      if (error?.code === 'PGRST202' || error?.code === '42883') return 'O banco de dados está desatualizado. Rode a migração 015 no SQL Editor do Supabase.'
      return error ? translateError(error) : 'Não foi possível salvar. Tente novamente.'
    }
    setState((current) => ({ ...current, options: current.options.map((item) => (item.id === data.id ? data : item)) }))
    return null
  }

  const handleDelete = async (option: AppSettingOption, replacementId: string | null): Promise<string | null> => {
    let response
    try {
      response = await guardMutation(`option:delete:${option.id}`, async () =>
        supabase.rpc('admin_delete_setting_option', {
          p_option_id: option.id,
          ...(replacementId ? { p_replacement_id: replacementId } : {}),
        }),
      )
    } catch (error) {
      return error instanceof RateLimitError ? error.message : 'Não foi possível excluir. Tente novamente.'
    }
    const { error } = response
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') return 'O banco de dados está desatualizado. Rode a migração 015 no SQL Editor do Supabase.'
      if (error.code === '42501') return 'Apenas o ADMIN pode excluir opções.'
      return 'Não foi possível excluir. Tente novamente.'
    }
    setState((current) => ({ ...current, options: current.options.filter((item) => item.id !== option.id) }))
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
            ? 'Gerencie as opções dos formulários sem alterar o código. Corrija um nome com o lápis; desative para esconder dos formulários; exclua para remover (e juntar duplicadas).'
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
                <CategoryCard
                  category={category}
                  options={byCategory[category]}
                  onAdd={handleAdd}
                  onToggle={handleToggle}
                  onRename={handleRename}
                  onDelete={handleDelete}
                />
              </div>
            ))}
          </div>
        )}
        </>
      )}
    </>
  )
}
