import { useId, type ReactNode } from 'react'
import { formatBRL } from '../lib/format'
import { cn } from '../lib/utils'
import type { DetailRow } from '../lib/valueDetails'

type ValueDetailsProps = {
  title: string
  rows: DetailRow[]
  total?: { label: string; value: number }
  /** Linhas fora do total (ex.: o que ainda está à confirmar). */
  extraRows?: DetailRow[]
  footnote?: string
  /** Cartão de fundo escuro (destaque): mantém o contorno do foco visível. */
  dark?: boolean
  align?: 'left' | 'right'
  className?: string
  children: ReactNode
}

/**
 * Cartão que mostra, ao passar o mouse (ou ao focar pelo teclado / tocar), uma janelinha
 * com o que compõe o valor.
 */
export default function ValueDetails({ title, rows, total, extraRows = [], footnote, dark = false, align = 'left', className, children }: ValueDetailsProps) {
  const tooltipId = useId()
  return (
    <div
      tabIndex={0}
      aria-describedby={tooltipId}
      className={cn(
        'group/details relative cursor-help focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900',
        dark ? 'focus-visible:ring-white' : 'focus-visible:ring-brand-600',
        className,
      )}
    >
      {children}
      <div
        id={tooltipId}
        role="tooltip"
        className={cn(
          'pointer-events-none invisible absolute top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)] translate-y-1 rounded-lg border border-slate-200 bg-white p-3 text-left text-sm font-normal text-slate-700 opacity-0 shadow-xl transition duration-150 group-hover/details:visible group-hover/details:translate-y-0 group-hover/details:opacity-100 group-focus/details:visible group-focus/details:translate-y-0 group-focus/details:opacity-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200',
          align === 'right' ? 'right-0' : 'left-0',
        )}
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</p>
        <ul className="space-y-1.5">
          {rows.map((row) => (
            <li key={row.label} className={cn('flex items-baseline justify-between gap-3', row.value === 0 && 'opacity-50')}>
              <span>
                {row.label}
                {row.hint && <span className="block text-[11px] text-slate-500 dark:text-slate-400">{row.hint}</span>}
              </span>
              <span className="shrink-0 font-semibold tabular-nums text-slate-900 dark:text-white">{formatBRL(row.value)}</span>
            </li>
          ))}
        </ul>
        {total && (
          <p className="mt-2 flex items-baseline justify-between gap-3 border-t border-slate-200 pt-2 font-semibold dark:border-slate-700">
            <span>{total.label}</span>
            <span className="tabular-nums text-slate-900 dark:text-white">{formatBRL(total.value)}</span>
          </p>
        )}
        {extraRows.length > 0 && (
          <ul className="mt-2 space-y-1.5 border-t border-dashed border-slate-200 pt-2 dark:border-slate-700">
            {extraRows.map((row) => (
              <li key={row.label} className="flex items-baseline justify-between gap-3 text-slate-500 dark:text-slate-400">
                <span>{row.label}</span>
                <span className="shrink-0 font-semibold tabular-nums">{formatBRL(row.value)}</span>
              </li>
            ))}
          </ul>
        )}
        {footnote && <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{footnote}</p>}
      </div>
    </div>
  )
}
