import { supabase } from './supabase'
import { onlyDigits } from './format'
import type { ClientSummary, ClientType } from '../types/lead'

export type ClientHistoryFilter = 'all' | 'closed' | 'open' | 'never_closed'

export type ClientSearchFilters = {
  search: string
  type: ClientType | 'all'
  history: ClientHistoryFilter
}

export const EMPTY_CLIENT_FILTERS: ClientSearchFilters = { search: '', type: 'all', history: 'all' }

export const CLIENT_HISTORY_LABELS: Record<ClientHistoryFilter, string> = {
  all: 'Todos',
  closed: 'Já fechou evento',
  open: 'Com proposta em aberto',
  never_closed: 'Sem fechamento',
}

export type ClientSortField = 'closed_revenue' | 'proposals_count' | 'last_proposal_at' | 'name'
export type ClientSort = { field: ClientSortField; direction: 'asc' | 'desc' }

export const CLIENT_SORT_LABELS: Record<ClientSortField, string> = {
  closed_revenue: 'Maior receita gerada',
  proposals_count: 'Qtd. de propostas',
  last_proposal_at: 'Último contato',
  name: 'Nome',
}

/** Direção natural de cada ordenação: nome em ordem alfabética, o resto do maior para o menor. */
export function defaultDirection(field: ClientSortField): ClientSort['direction'] {
  return field === 'name' ? 'asc' : 'desc'
}

export const DEFAULT_CLIENT_SORT: ClientSort = { field: 'last_proposal_at', direction: 'desc' }

export function countActiveClientFilters(filters: ClientSearchFilters): number {
  return (filters.search.trim() ? 1 : 0) + (filters.type !== 'all' ? 1 : 0) + (filters.history !== 'all' ? 1 : 0)
}

/** Remove caracteres que quebram a sintaxe do filtro `or()` do PostgREST. */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()"\\%*]/g, ' ').replace(/\s+/g, ' ').trim()
}

export type ClientPage = { rows: ClientSummary[]; total: number }

/** Uma página da lista de clientes (uma linha por empresa ou pessoa física). */
export async function fetchClientPage(
  filters: ClientSearchFilters,
  sort: ClientSort,
  page: number,
  pageSize: number,
  signal?: AbortSignal,
): Promise<ClientPage> {
  const from = page * pageSize
  let query = supabase.from('client_summaries').select('*', { count: 'exact' })

  const term = sanitizeSearchTerm(filters.search).toLowerCase()
  if (term) {
    // O texto de busca guarda também os telefones só com dígitos: "51 3333" encontra "(51) 3333-1000"
    const digits = onlyDigits(term)
    query =
      digits.length >= 3
        ? query.or(`search_text.like.*${term}*,search_text.like.*${digits}*`)
        : query.like('search_text', `%${term}%`)
  }
  if (filters.type !== 'all') query = query.eq('client_type', filters.type)
  if (filters.history === 'closed') query = query.gt('closed_count', 0)
  else if (filters.history === 'open') query = query.gt('open_count', 0)
  else if (filters.history === 'never_closed') query = query.eq('closed_count', 0)

  query = query
    .order(sort.field, { ascending: sort.direction === 'asc', nullsFirst: false })
    // Desempate estável para a paginação não repetir/pular linhas
    .order('id', { ascending: true })
    .range(from, from + pageSize - 1)
  if (signal) query = query.abortSignal(signal)

  const { data, error, count } = await query
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0 }
}
