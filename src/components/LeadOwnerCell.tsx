import { useState } from 'react'
import { UserRound } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useConfirm } from '../hooks/useConfirm'
import { supabase } from '../lib/supabase'
import { RateLimitError, guardMutation } from '../lib/rateLimit'
import { cn } from '../lib/utils'
import type { UserLogin } from '../types/lead'

type LeadOwnerCellProps = {
  leadId: string
  userId: string | null
  logins: UserLogin[]
  /** Proposta (nome do evento ou do contato), para a pergunta de confirmação. */
  leadLabel: string
  onError?: (message: string) => void
}

const pillClassName =
  'inline-flex max-w-[11rem] items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200'

/**
 * Responsável pela proposta (quem cadastrou). Só o ADMIN troca; para os demais é só leitura.
 * A troca é feita pela função do banco, que também confere se quem pede é ADMIN.
 */
export default function LeadOwnerCell({ leadId, userId, logins, leadLabel, onError }: LeadOwnerCellProps) {
  const { isAdmin } = useAuth()
  const confirm = useConfirm()
  const [owner, setOwner] = useState(userId)
  const [saving, setSaving] = useState(false)
  const login = logins.find((item) => item.user_id === owner)?.login

  if (!isAdmin) {
    return (
      <span className={cn(pillClassName, !login && 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400')}>
        <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{login || '—'}</span>
      </span>
    )
  }

  const handleChange = async (nextId: string) => {
    if (!nextId || nextId === owner) return
    const nextLogin = logins.find((item) => item.user_id === nextId)?.login ?? 'outro usuário'
    const confirmed = await confirm({
      title: 'Trocar o responsável?',
      description: `A proposta "${leadLabel}" passa de ${login ?? 'sem responsável'} para ${nextLogin}.`,
      confirmLabel: 'Trocar responsável',
      tone: 'warning',
    })
    if (!confirmed) return

    setSaving(true)
    try {
      const { error } = await guardMutation(`lead:owner:${leadId}:${nextId}`, async () =>
        supabase.rpc('admin_set_lead_owner', { p_lead_id: leadId, p_user_id: nextId }),
      )
      if (error) {
        onError?.(
          error.code === 'PGRST202' || error.code === '42883'
            ? 'Troca de responsável indisponível. Rode a migração 016 no Supabase.'
            : error.code === '42501'
              ? 'Só o ADMIN pode trocar o responsável.'
              : 'Não foi possível trocar o responsável. Tente novamente.',
        )
        return
      }
      setOwner(nextId)
    } catch (error) {
      onError?.(error instanceof RateLimitError ? error.message : 'Não foi possível trocar o responsável. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  // Usuários desativados só aparecem se forem o responsável atual
  const options = logins.filter((item) => item.is_active || item.user_id === owner)

  return (
    <select
      aria-label="Responsável pela proposta"
      value={owner ?? ''}
      disabled={saving}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => void handleChange(event.target.value)}
      className="w-full min-w-[7.5rem] max-w-[11rem] rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-800 focus:outline-none focus:ring-2 focus:ring-brand-600/30 disabled:opacity-60 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200"
    >
      {!owner && <option value="">—</option>}
      {owner && !login && <option value={owner}>—</option>}
      {options.map((item) => (
        <option key={item.user_id} value={item.user_id}>
          {item.login || 'sem login'}
          {item.is_active ? '' : ' (inativo)'}
        </option>
      ))}
    </select>
  )
}
