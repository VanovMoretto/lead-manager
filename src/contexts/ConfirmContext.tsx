import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { CircleHelp, TriangleAlert, Trash2, type LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { ConfirmContext, type ConfirmFn, type ConfirmOptions, type ConfirmTone } from '../hooks/useConfirm'

type PendingConfirm = ConfirmOptions & { resolve: (confirmed: boolean) => void }

const TONES: Record<ConfirmTone, { icon: LucideIcon; iconClass: string; buttonClass: string }> = {
  danger: {
    icon: Trash2,
    iconClass: 'bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400',
    buttonClass: 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-600',
  },
  warning: {
    icon: TriangleAlert,
    iconClass: 'bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400',
    buttonClass: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-600',
  },
  default: {
    icon: CircleHelp,
    iconClass: 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300',
    buttonClass: 'bg-brand-600 hover:bg-brand-700 focus-visible:ring-brand-600',
  },
}

function ConfirmDialog({ pending, onAnswer }: { pending: PendingConfirm; onAnswer: (confirmed: boolean) => void }) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const tone = TONES[pending.tone ?? 'default']
  const Icon = tone.icon

  useEffect(() => {
    // Ação que apaga ou perde dados começa com o foco em "Cancelar"; as demais, no botão principal
    const initial = pending.tone === 'danger' || pending.tone === 'warning' ? cancelRef.current : confirmRef.current
    initial?.focus()

    // Captura: o Esc fecha só esta caixa, sem chegar ao modal que está por baixo
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onAnswer(false)
        return
      }
      if (event.key === 'Tab') {
        const focusable = [cancelRef.current, confirmRef.current].filter(Boolean) as HTMLElement[]
        const index = focusable.indexOf(document.activeElement as HTMLElement)
        const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length
        event.preventDefault()
        focusable[next]?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [pending, onAnswer])

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => onAnswer(false)} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={pending.description ? descriptionId : undefined}
        className="relative w-full max-w-md rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex gap-4 px-5 pb-4 pt-5">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-full', tone.iconClass)}>
            <Icon className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 pt-0.5">
            <h2 id={titleId} className="text-base font-semibold text-slate-900 dark:text-white">
              {pending.title}
            </h2>
            {pending.description && (
              <div id={descriptionId} className="mt-1.5 whitespace-pre-line text-sm text-slate-600 dark:text-slate-300">
                {pending.description}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end dark:border-slate-800">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onAnswer(false)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-900"
          >
            {pending.cancelLabel ?? 'Cancelar'}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => onAnswer(true)}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
              tone.buttonClass,
            )}
          >
            {pending.confirmLabel ?? 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Caixa de confirmação do app (substitui o window.confirm do navegador). */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        setPending((current) => {
          // Uma nova pergunta substitui a anterior, que conta como cancelada
          current?.resolve(false)
          return { ...options, resolve }
        })
      }),
    [],
  )

  const answer = useCallback(
    (confirmed: boolean) => {
      pending?.resolve(confirmed)
      setPending(null)
      // Devolve o foco para quem abriu a pergunta (se ainda estiver na tela)
      const target = returnFocusRef.current
      window.setTimeout(() => {
        if (target && document.contains(target)) target.focus()
      }, 0)
    },
    [pending],
  )

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmDialog pending={pending} onAnswer={answer} />}
    </ConfirmContext.Provider>
  )
}
