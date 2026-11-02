import { useEffect, useId, useRef, useState } from 'react'
import { Building2 } from 'lucide-react'
import type { KnownContactClient } from '../hooks/useRecurringClient'
import { describeBranch } from '../lib/clientIdentity'
import { cn } from '../lib/utils'

type ContactMergeDialogProps = {
  contactName: string
  companies: KnownContactClient[]
  /** Empresa escolhida para mesclar, ou null para "Não". */
  onAnswer: (clientId: string | null) => void
}

const joinNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}` : names[0])

/** Pergunta se a proposta usa os dados da empresa a que o contato digitado já está ligado. */
export default function ContactMergeDialog({ contactName, companies, onAnswer }: ContactMergeDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const single = companies.length === 1
  const [selected, setSelected] = useState<string | null>(single ? companies[0].id : null)

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.querySelector<HTMLElement>(single ? '[data-answer="yes"]' : 'input[type="radio"]')?.focus()

    // Captura: o Esc responde "Não" sem fechar o formulário que está por baixo
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onAnswer(null)
        return
      }
      if (event.key === 'Tab' && dialog) {
        const focusable = [...dialog.querySelectorAll<HTMLElement>('input, button:not(:disabled)')]
        const index = focusable.indexOf(document.activeElement as HTMLElement)
        const next = event.shiftKey ? (index <= 0 ? focusable.length - 1 : index - 1) : (index + 1) % focusable.length
        event.preventDefault()
        focusable[next]?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [single, onAnswer])

  const names = companies.map((company) => company.name)

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => onAnswer(null)} aria-hidden="true" />
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="relative w-full max-w-md rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <div className="flex gap-4 px-5 pb-4 pt-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
            <Building2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 pt-0.5">
            <h2 id={titleId} className="text-base font-semibold text-slate-900 dark:text-white">
              Contato já cadastrado{contactName ? `: ${contactName}` : ''}
            </h2>
            <p id={descriptionId} className="mt-1.5 text-sm text-slate-600 dark:text-slate-300">
              {single ? (
                <>
                  Este contato está atrelado à empresa <strong className="font-semibold text-slate-900 dark:text-white">{names[0]}</strong>.
                  Deseja mesclar os dados?
                </>
              ) : (
                <>
                  Este contato está atrelado às empresas: <strong className="font-semibold text-slate-900 dark:text-white">{joinNames(names)}</strong>.
                  Deseja mesclar os dados com alguma das empresas?
                </>
              )}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Sim preenche a Empresa e o CNPJ com o cadastro. Não segue sem empresa (você pode preencher depois).
            </p>

            {!single && (
              <fieldset className="mt-3 space-y-1.5">
                <legend className="sr-only">Empresa para mesclar</legend>
                {companies.map((company) => {
                  const detail = describeBranch(company) || 'CNPJ não informado'
                  return (
                    <label
                      key={company.id}
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors',
                        selected === company.id
                          ? 'border-brand-600 bg-brand-50/60 ring-1 ring-brand-600 dark:bg-brand-900/20'
                          : 'border-slate-200 hover:border-brand-300 dark:border-slate-700 dark:hover:border-brand-700',
                      )}
                    >
                      <input
                        type="radio"
                        name="merge-company"
                        value={company.id}
                        checked={selected === company.id}
                        onChange={() => setSelected(company.id)}
                        className="mt-0.5 h-4 w-4 border-slate-300 text-brand-600 focus:ring-brand-600 dark:border-slate-600 dark:bg-slate-900"
                      />
                      <span className="min-w-0">
                        <span className="block font-semibold text-slate-900 dark:text-white">{company.name}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">{detail}</span>
                      </span>
                    </label>
                  )
                })}
              </fieldset>
            )}
          </div>
        </div>
        <div className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end dark:border-slate-800">
          <button
            type="button"
            onClick={() => onAnswer(null)}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-900"
          >
            Não
          </button>
          <button
            type="button"
            data-answer="yes"
            disabled={!selected}
            onClick={() => selected && onAnswer(selected)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-slate-900"
          >
            Sim, mesclar
          </button>
        </div>
      </div>
    </div>
  )
}
