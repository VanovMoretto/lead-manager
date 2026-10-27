import { createContext, useContext, type ReactNode } from 'react'

export type ConfirmTone = 'danger' | 'warning' | 'default'

export type ConfirmOptions = {
  title: string
  /** Texto de apoio; quebras de linha são respeitadas. */
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** danger: exclusões e ações sem volta (botão vermelho). */
  tone?: ConfirmTone
}

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>

export const ConfirmContext = createContext<ConfirmFn | null>(null)

/** `const confirm = useConfirm(); if (!(await confirm({ title: '...' }))) return` */
export function useConfirm(): ConfirmFn {
  const context = useContext(ConfirmContext)
  if (!context) throw new Error('useConfirm precisa estar dentro de <ConfirmProvider>.')
  return context
}
