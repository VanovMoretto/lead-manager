import { BellOff, MessageCircle } from 'lucide-react'
import { buildFollowUpWhatsAppUrl, buildGreetingWhatsAppUrl, buildSurveyWhatsAppUrl, toWhatsAppNumber } from '../lib/whatsapp'
import { logCommunication } from '../lib/communication'
import { cn } from '../lib/utils'
import type { Lead } from '../types/lead'

export type WhatsAppPurpose = 'follow_up' | 'greeting' | 'survey'

type WhatsAppButtonProps = {
  lead: Pick<Lead, 'contact_name' | 'contact_phone' | 'room_interests' | 'room_interest'> &
    Partial<Pick<Lead, 'id' | 'client_id' | 'marketing_opt_out' | 'event_name'>>
  className?: string
  /** Só uma saudação, sem falar de evento (contato de cliente, fora de uma proposta). */
  greeting?: boolean
  /** Finalidade da mensagem; sem ela, follow-up (ou saudação, com `greeting`). */
  purpose?: WhatsAppPurpose
  /** Cliente do contato, quando não há proposta (página do cliente). */
  clientId?: string | null
  /** Rótulo do botão (padrão "WhatsApp"). */
  label?: string
  /** Chamado depois de abrir o WhatsApp (ex.: marcar a pesquisa como enviada). */
  onSent?: () => void
}

const TITLES: Record<WhatsAppPurpose, string> = {
  follow_up: 'Enviar mensagem de follow-up pelo WhatsApp',
  greeting: 'Conversar pelo WhatsApp',
  survey: 'Enviar a pesquisa de satisfação pelo WhatsApp',
}

/**
 * Abre o WhatsApp em nova aba com a mensagem pronta e registra o envio em segundo plano.
 * Não aparece sem telefone válido. Cliente com opt-out (LGPD) não recebe o atalho: no lugar
 * aparece um selo de aviso.
 */
export default function WhatsAppButton({ lead, className, greeting = false, purpose, clientId, label = 'WhatsApp', onSent }: WhatsAppButtonProps) {
  if (lead.marketing_opt_out) {
    return (
      <span
        title="O cliente pediu para não receber comunicações/mailing (LGPD)"
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300',
          className,
        )}
      >
        <BellOff className="h-3.5 w-3.5" aria-hidden="true" />
        Opt-out LGPD
      </span>
    )
  }

  const kind: WhatsAppPurpose = purpose ?? (greeting ? 'greeting' : 'follow_up')
  const url =
    kind === 'greeting'
      ? buildGreetingWhatsAppUrl(lead.contact_name, lead.contact_phone)
      : kind === 'survey'
        ? buildSurveyWhatsAppUrl(lead)
        : buildFollowUpWhatsAppUrl(lead)
  if (!url) return null

  const handleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation()
    logCommunication({
      channel: 'whatsapp',
      purpose: kind,
      lead_id: lead.id ?? null,
      client_id: clientId ?? lead.client_id ?? null,
      recipient: toWhatsAppNumber(lead.contact_phone),
    })
    onSent?.()
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={TITLES[kind]}
      aria-label={`${TITLES[kind]}: ${lead.contact_name}`}
      onClick={handleClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 transition-colors',
        'hover:bg-emerald-100 hover:text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20 dark:hover:bg-emerald-900/50',
        className,
      )}
    >
      <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </a>
  )
}
