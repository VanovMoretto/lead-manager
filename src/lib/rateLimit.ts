/** Intervalo mínimo entre duas mutações idênticas (cliques repetidos, loops de requisição). */
export const MIN_MUTATION_INTERVAL_MS = 1500

export class RateLimitError extends Error {
  constructor() {
    super('Aguarde um instante antes de repetir esta ação.')
    this.name = 'RateLimitError'
  }
}

const lastRunAt = new Map<string, number>()
const inFlight = new Set<string>()

/**
 * Executa uma mutação, recusando a mesma ação (mesma `key`) enquanto a anterior estiver
 * em andamento ou se ela terminou há menos de 1,5 s. Inclua os dados enviados na chave
 * para bloquear só repetições idênticas.
 */
export async function guardMutation<T>(key: string, action: () => Promise<T>): Promise<T> {
  const last = lastRunAt.get(key) ?? 0
  if (inFlight.has(key) || Date.now() - last < MIN_MUTATION_INTERVAL_MS) throw new RateLimitError()

  inFlight.add(key)
  try {
    return await action()
  } finally {
    inFlight.delete(key)
    lastRunAt.set(key, Date.now())
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (typeof error === 'object' && error !== null && 'name' in error && (error as { name?: string }).name === 'AbortError')
  )
}
