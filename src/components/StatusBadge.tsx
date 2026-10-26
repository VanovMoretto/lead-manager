import { cn } from '../lib/utils'
import { LEAD_STATUS_LABELS, type LeadStatus } from '../types/lead'

const STATUS_BADGE_CLASSES: Record<LeadStatus, string> = {
  em_aberto: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-400/20',
  fechado: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20',
  perdido: 'bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-400/20',
}

const STATUS_BADGE_DOT: Record<LeadStatus, string> = {
  em_aberto: 'bg-amber-500',
  fechado: 'bg-emerald-500',
  perdido: 'bg-red-500',
}

export default function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset',
        STATUS_BADGE_CLASSES[status],
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_BADGE_DOT[status])} aria-hidden="true" />
      {LEAD_STATUS_LABELS[status]}
    </span>
  )
}
