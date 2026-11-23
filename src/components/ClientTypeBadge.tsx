import { Building2, HeartHandshake, UserRound } from 'lucide-react'
import { cn } from '../lib/utils'
import { CLIENT_TYPE_LABELS, type ClientType } from '../types/lead'

const TYPE_STYLES: Record<ClientType, string> = {
  company: 'bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-900/40 dark:text-brand-300 dark:ring-brand-400/20',
  individual: 'bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-400/20',
  ceremonialist: 'bg-teal-50 text-teal-800 ring-teal-600/20 dark:bg-teal-950/40 dark:text-teal-300 dark:ring-teal-400/20',
}

const TYPE_ICONS = { company: Building2, individual: UserRound, ceremonialist: HeartHandshake } as const

export default function ClientTypeBadge({ type }: { type: ClientType }) {
  const Icon = TYPE_ICONS[type]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', TYPE_STYLES[type])}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {CLIENT_TYPE_LABELS[type]}
    </span>
  )
}
