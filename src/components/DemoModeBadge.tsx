import { useState } from 'react'
import { FlaskConical, LoaderCircle, RotateCcw } from 'lucide-react'
import { useConfirm } from '../hooks/useConfirm'
import { resetDemoData } from '../lib/demoStore'
import { cn } from '../lib/utils'

type DemoModeBadgeProps = {
  /** compact: só o selo e o botão em ícone (barra superior do celular). */
  compact?: boolean
  className?: string
}

/** Selo do Modo Demonstração com o botão que restaura a base fictícia original. */
export default function DemoModeBadge({ compact = false, className }: DemoModeBadgeProps) {
  const confirm = useConfirm()
  const [restoring, setRestoring] = useState(false)

  const restore = async () => {
    const confirmed = await confirm({
      title: 'Restaurar os dados de demonstração?',
      description: 'Tudo o que foi cadastrado, editado ou excluído nesta aba volta ao estado original da base fictícia.',
      confirmLabel: 'Restaurar dados',
      tone: 'warning',
    })
    if (!confirmed) return
    setRestoring(true)
    resetDemoData()
    window.location.reload()
  }

  const icon = restoring ? (
    <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
  ) : (
    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
  )

  if (compact) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        <span className="hidden rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 sm:inline dark:bg-amber-900/40 dark:text-amber-200">
          Modo Demo
        </span>
        <button
          type="button"
          onClick={() => void restore()}
          disabled={restoring}
          title="Restaurar dados de demonstração"
          aria-label="Restaurar dados de demonstração"
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-amber-700 transition-colors hover:bg-amber-50 disabled:opacity-60 dark:text-amber-300 dark:hover:bg-amber-950/40"
        >
          {icon}
        </button>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2.5 dark:border-amber-900/60 dark:bg-amber-950/30',
        className,
      )}
    >
      <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200">
        <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Modo Demo · Portfólio
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-amber-700/90 dark:text-amber-300/80">Dados fictícios, salvos só nesta aba.</p>
      <button
        type="button"
        onClick={() => void restore()}
        disabled={restoring}
        className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-800 dark:bg-slate-900 dark:text-amber-200 dark:hover:bg-amber-950/50"
      >
        {icon}
        {restoring ? 'Restaurando...' : 'Restaurar dados'}
      </button>
    </div>
  )
}
