import { isValidCNPJ, onlyDigits } from './format'

const BRASIL_API_URL = 'https://brasilapi.com.br/api/cnpj/v1/'
const LOOKUP_TIMEOUT_MS = 3000

/** Respostas já recebidas nesta sessão (inclusive "não encontrado"), para não consultar o mesmo CNPJ de novo. */
const cache = new Map<string, CnpjLookupResult | null>()

export type CnpjLookupResult = {
  /** Nome fantasia ou, sem ele, a razão social. */
  name: string
  /** Município e UF do cadastro, ex.: "Porto Alegre/RS". */
  city: string | null
}

type BrasilApiCnpj = {
  nome_fantasia?: string | null
  razao_social?: string | null
  municipio?: string | null
  uf?: string | null
}

/** "PADARIA BOM PAO LTDA" -> "Padaria Bom Pao Ltda" (a Receita devolve tudo em maiúsculas). */
function toTitleCase(value: string): string {
  return value
    .toLocaleLowerCase('pt-BR')
    .replace(/(^|[\s/-])(\p{L})/gu, (_, separator: string, letter: string) => separator + letter.toLocaleUpperCase('pt-BR'))
    .replace(/\b(Ltda|Me|Epp|Eireli|S\.?a\.?)\b/gi, (word) => word.toUpperCase())
}

/**
 * Consulta o CNPJ na BrasilAPI (dados públicos da Receita Federal), com tempo máximo de 3 s.
 * Informativa: qualquer falha (sem internet, CNPJ não encontrado, API fora do ar) devolve null.
 */
export async function lookupCnpj(cnpj: string, signal?: AbortSignal): Promise<CnpjLookupResult | null> {
  if (!isValidCNPJ(cnpj)) return null
  const digits = onlyDigits(cnpj)
  if (cache.has(digits)) return cache.get(digits) ?? null
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS)
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort)

  try {
    const response = await fetch(`${BRASIL_API_URL}${digits}`, { signal: controller.signal })
    if (!response.ok) {
      // 404 é resposta definitiva (CNPJ não existe); outros erros podem ser passageiros
      if (response.status === 404) cache.set(digits, null)
      return null
    }
    const data = (await response.json()) as BrasilApiCnpj
    const name = (data.nome_fantasia?.trim() || data.razao_social?.trim() || '').replace(/\s+/g, ' ')
    if (!name) return null
    const city = data.municipio ? `${toTitleCase(data.municipio.trim())}${data.uf ? `/${data.uf.trim().toUpperCase()}` : ''}` : null
    const result = { name: toTitleCase(name), city }
    cache.set(digits, result)
    return result
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}
