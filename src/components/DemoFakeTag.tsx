import { isDemoMode } from '../lib/demoMode'

/** Selo "fictício" ao lado de dados inventados para a demonstração (fora do modo demo não aparece). */
export default function DemoFakeTag({ label = 'CNPJ fictício, criado só para a demonstração' }: { label?: string }) {
  if (!isDemoMode) return null
  return (
    <span
      title={label}
      className="ml-1.5 inline-flex rounded bg-amber-100 px-1.5 py-px align-middle text-[11px] font-medium not-italic text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
    >
      fictício
    </span>
  )
}
