import { MessageCircle } from 'lucide-react'
import { buildFollowUpWhatsAppUrl } from '../lib/whatsapp'
import { cn } from '../lib/utils'
import type { Lead } from '../types/lead'

type WhatsAppButtonProps = {
  lead: Pick<Lead, 'contact_name' | 'contact_phone' | 'room_interests' | 'room_interest'>
  className?: string
}

/** Abre o WhatsApp em nova aba com a mensagem de follow-up pronta. Não aparece sem telefone válido. */
export default function WhatsAppButton({ lead, className }: WhatsAppButtonProps) {
  const url = buildFollowUpWhatsAppUrl(lead)
  if (!url) return null

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Enviar mensagem de follow-up pelo WhatsApp"
      aria-label={`Enviar follow-up para ${lead.contact_name} pelo WhatsApp`}
      onClick={(event) => event.stopPropagation()}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20 transition-colors',
        'hover:bg-emerald-100 hover:text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20 dark:hover:bg-emerald-900/50',
        className,
      )}
    >
      <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
      WhatsApp
    </a>
  )
}
