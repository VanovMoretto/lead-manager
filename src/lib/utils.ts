import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Junta classes condicionais e resolve conflitos do Tailwind (ex.: `px-2` vs `px-4`). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Clique numa linha de tabela que não caiu em um botão, link ou campo dentro dela. */
export function isRowClick(target: EventTarget): boolean {
  return !(target instanceof Element && target.closest('a, button, input, select, textarea, label'))
}
