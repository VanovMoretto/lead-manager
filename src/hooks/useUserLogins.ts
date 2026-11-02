import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { UserLogin } from '../types/lead'

// Uma busca por sessão do app: a lista muda pouco e é usada em várias telas
let cache: Promise<UserLogin[]> | null = null

function loadLogins(): Promise<UserLogin[]> {
  cache ??= Promise.resolve(supabase.rpc('list_user_logins')).then(({ data, error }) => {
    if (error) {
      cache = null
      return []
    }
    return data ?? []
  })
  return cache
}

/** Login de cada usuário (e-mail sem o domínio), para a coluna Responsável. Falha silenciosa: mostra "—". */
export function useUserLogins() {
  const [logins, setLogins] = useState<UserLogin[]>([])

  useEffect(() => {
    let isActive = true
    loadLogins().then((data) => {
      if (isActive) setLogins(data)
    })
    return () => {
      isActive = false
    }
  }, [])

  return logins
}
