import { useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { cn } from '../lib/utils'

type PasswordInputProps = {
  id: string
  /** Nome do campo para o gerenciador de senhas (padrão: o id). */
  name?: string
  value: string
  onChange: (value: string) => void
  autoComplete: 'current-password' | 'new-password'
  disabled?: boolean
  invalid?: boolean
  describedBy?: string
}

/** Campo de senha com o botão de mostrar/ocultar. */
export default function PasswordInput({ id, name, value, onChange, autoComplete, disabled, invalid, describedBy }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
      <input
        id={id}
        name={name ?? id}
        type={visible ? 'text' : 'password'}
        autoComplete={autoComplete}
        maxLength={72}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        className={cn(
          'block w-full rounded-lg border bg-white py-2.5 pl-10 pr-10 text-sm text-slate-900 shadow-sm transition-colors',
          'focus:outline-none focus:ring-2 dark:bg-slate-900 dark:text-white',
          'disabled:cursor-not-allowed disabled:opacity-60',
          invalid
            ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20 dark:border-red-700'
            : 'border-slate-200 focus:border-brand-600 focus:ring-brand-600/20 dark:border-slate-700',
        )}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  )
}
