import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { isSafeStoragePath } from '../lib/storage'

export const AVATAR_BUCKET = 'avatars'

/** Validade do link assinado da foto (o bucket é privado). */
const SIGNED_URL_SECONDS = 60 * 60
/** Renova o link um pouco antes de expirar. */
const CACHE_MS = (SIGNED_URL_SECONDS - 5 * 60) * 1000

// Cada caminho é único por foto enviada, então o cache por caminho nunca mostra foto antiga
const cache = new Map<string, { url: string; expiresAt: number }>()

/** Esquece os links ao sair da conta. */
export function clearAvatarUrlCache(): void {
  cache.clear()
}

function cachedUrl(path: string): string | null {
  const entry = cache.get(path)
  return entry && entry.expiresAt > Date.now() ? entry.url : null
}

/** Link temporário para exibir a foto de perfil guardada no Storage. */
export function useAvatarUrl(path: string | null | undefined): string | null {
  const [state, setState] = useState<{ path: string; url: string | null } | null>(null)

  useEffect(() => {
    // Caminho fora do formato do app (ex.: com "../") não vira requisição com a sessão de quem vê
    if (!path || !isSafeStoragePath(path) || cachedUrl(path)) return
    let isActive = true
    supabase.storage
      .from(AVATAR_BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS)
      .then(({ data, error }) => {
        const url = error ? null : data.signedUrl
        if (url) cache.set(path, { url, expiresAt: Date.now() + CACHE_MS })
        if (isActive) setState({ path, url })
      })
    return () => {
      isActive = false
    }
  }, [path])

  if (!path) return null
  return cachedUrl(path) ?? (state?.path === path ? state.url : null)
}
