import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { formatCentsBRL, parseCurrencyInputToCents } from '../lib/format'
import { inputClassName } from '../lib/leadForm'

type FieldProps = {
  label: string
  htmlFor: string
  required?: boolean
  error?: string
  hint?: string
  className?: string
  children: ReactNode
}

export function Field({ label, htmlFor, required, error, hint, className, children }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      )}
    </div>
  )
}

type SectionProps = {
  icon: LucideIcon
  title: string
  children: ReactNode
}

export function Section({ icon: Icon, title, children }: SectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-200">{title}</h3>
      </div>
      {children}
    </section>
  )
}

type MoneyInputProps = {
  id: string
  cents: number | null
  invalid?: boolean
  onChange: (cents: number | null) => void
}

/** Campo de moeda em R$: os dígitos entram da direita (centavos primeiro). */
export function MoneyInput({ id, cents, invalid = false, onChange }: MoneyInputProps) {
  return (
    <input
      id={id}
      aria-invalid={invalid}
      aria-describedby={invalid ? `${id}-error` : undefined}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="R$ 0,00"
      value={cents === null ? '' : formatCentsBRL(cents)}
      onChange={(event) => onChange(parseCurrencyInputToCents(event.target.value))}
      className={cn(inputClassName(invalid), 'tabular-nums')}
    />
  )
}

type YesNoToggleProps = {
  id: string
  label: string
  icon?: LucideIcon
  value: boolean
  onChange: (value: boolean) => void
  disabled?: boolean
  /** Rótulo em cima e botões embaixo, na altura de um campo (alinha com um campo ao lado). */
  stacked?: boolean
}

/** Botões Sim/Não lado a lado: um clique e pronto. */
export function YesNoToggle({ id, label, icon: Icon, value, onChange, disabled, stacked = false }: YesNoToggleProps) {
  if (stacked) {
    return (
      <div>
        <p id={`${id}-label`} className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
          {Icon && <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />}
          {label}
        </p>
        <div
          role="radiogroup"
          aria-labelledby={`${id}-label`}
          className="grid h-[42px] grid-cols-2 gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800"
        >
          {[
            { optionValue: true, text: 'Sim' },
            { optionValue: false, text: 'Não' },
          ].map(({ optionValue, text }) => {
            const selected = value === optionValue
            return (
              <button
                key={text}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onChange(optionValue)}
                className={cn(
                  'rounded-md text-sm font-semibold transition-colors disabled:cursor-not-allowed',
                  selected
                    ? optionValue
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white'
                    : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
                )}
              >
                {text}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950">
      <span id={`${id}-label`} className="flex min-w-0 items-center gap-2 text-sm font-medium leading-tight text-slate-700 dark:text-slate-200">
        {Icon && <Icon className="h-4 w-4 text-slate-400" aria-hidden="true" />}
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        className="inline-flex shrink-0 rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
      >
        {[
          { optionValue: true, text: 'Sim' },
          { optionValue: false, text: 'Não' },
        ].map(({ optionValue, text }) => {
          const selected = value === optionValue
          return (
            <button
              key={text}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(optionValue)}
              className={cn(
                'min-w-[2.75rem] rounded-md px-2.5 py-1 text-sm font-semibold transition-colors disabled:cursor-not-allowed',
                selected
                  ? optionValue
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white'
                  : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
              )}
            >
              {text}
            </button>
          )
        })}
      </div>
    </div>
  )
}
