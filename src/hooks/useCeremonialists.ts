import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Client } from '../types/lead'

export type Ceremonialist = Pick<Client, 'id' | 'name'>

type CeremonialistsState = { key: number; items: Ceremonialist[]; error: boolean }

/** Cerimonialistas cadastradas, em ordem alfabética (só busca quando `enabled`). */
export function useCeremonialists(enabled: boolean) {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<CeremonialistsState | null>(null)
  // Recém-criadas no formulário entram na lista na hora, sem esperar a nova consulta
  const [added, setAdded] = useState<Ceremonialist[]>([])

  useEffect(() => {
    if (!enabled) return
    let isActive = true
    const controller = new AbortController()
    supabase
      .from('clients')
      .select('id, name')
      .eq('client_type', 'ceremonialist')
      .order('name', { ascending: true })
      .abortSignal(controller.signal)
      .then(({ data, error }) => {
        if (isActive) setState({ key: version, items: data ?? [], error: Boolean(error) })
      })
    return () => {
      isActive = false
      controller.abort()
    }
  }, [enabled, version])

  const fetched = state?.items ?? []
  const items = [...fetched, ...added.filter((item) => !fetched.some((current) => current.id === item.id))].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR'),
  )

  const add = useCallback((item: Ceremonialist) => setAdded((current) => [...current, item]), [])
  const reload = useCallback(() => setVersion((current) => current + 1), [])

  return {
    items,
    loading: enabled && state?.key !== version,
    error: enabled && state?.key === version && state.error,
    add,
    reload,
  }
}
