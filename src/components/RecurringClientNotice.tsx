import { History, LoaderCircle } from 'lucide-react'
import { useRecurringClient } from '../hooks/useRecurringClient'
import { formatDateBR } from '../lib/format'
import { toLocalISODate } from '../lib/dashboard'
import { getLeadRooms } from '../lib/leadFields'
import { LEAD_STATUS_LABELS } from '../types/lead'

type RecurringClientNoticeProps = {
  phone: string
  email: string
}

/** Aviso discreto de cliente recorrente, exibido abaixo dos campos de contato no cadastro. */
export default function RecurringClientNotice({ phone, email }: RecurringClientNoticeProps) {
  const { checking, match } = useRecurringClient({ phone, email, enabled: true })

  if (checking) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500" aria-live="polite">
        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Verificando histórico do cliente...
      </p>
    )
  }

  if (!match) return null

  const { count, last } = match
  const rooms = getLeadRooms(last)
  const roomText = rooms.length > 0 ? rooms.join(', ') : 'sem sala definida'
  const requestsText = count === 1 ? '1 solicitação anterior' : `${count} solicitações anteriores`
  const matchedBy = [match.matchedByPhone && 'telefone', match.matchedByEmail && 'e-mail'].filter(Boolean).join(' e ')

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2.5 text-sm text-brand-900 dark:border-brand-900/60 dark:bg-brand-900/20 dark:text-brand-100"
    >
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-600 text-white">
        <History className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="leading-snug">
        <p>
          <strong className="font-semibold">Cliente recorrente:</strong> já possui {requestsText}. Última em{' '}
          <strong className="font-semibold">{formatDateBR(toLocalISODate(new Date(last.created_at)))}</strong> ({roomText} -{' '}
          {LEAD_STATUS_LABELS[last.status]}).
        </p>
        {matchedBy && <p className="mt-0.5 text-xs text-brand-700/80 dark:text-brand-300/80">Reconhecido pelo mesmo {matchedBy}.</p>}
      </div>
    </div>
  )
}
