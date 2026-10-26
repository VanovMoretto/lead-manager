import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import { cn } from '../lib/utils'

type ThemeToggleProps = {
  /** Mostra o texto "Tema escuro"/"Tema claro" ao lado do ícone. */
  showLabel?: boolean
  className?: string
}

export default function ThemeToggle({ showLabel = false, className }: ThemeToggleProps) {
  const { isDark, toggleTheme } = useTheme()
  const label = isDark ? 'Tema claro' : 'Tema escuro'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={`Mudar para ${label.toLowerCase()}`}
      aria-label={`Mudar para ${label.toLowerCase()}`}
      className={cn(
        'inline-flex items-center gap-3 rounded-lg text-sm font-medium text-slate-600 transition-colors',
        'hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
        showLabel ? 'w-full px-3 py-2' : 'h-9 w-9 justify-center',
        className,
      )}
    >
      {isDark ? (
        <Sun className="h-5 w-5 shrink-0" aria-hidden="true" />
      ) : (
        <Moon className="h-5 w-5 shrink-0" aria-hidden="true" />
      )}
      {showLabel && <span>{label}</span>}
    </button>
  )
}
