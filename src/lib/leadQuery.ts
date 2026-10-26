import { supabase } from './supabase'
import { formatDateBR, onlyDigits } from './format'
import { rangeToTimestampBounds } from './dashboard'
import { LEAD_STATUS_LABELS, type Lead, type LeadStatus } from '../types/lead'

// =============================================================================
// Filtros da consulta
// =============================================================================

export type DateField = 'created_at' | 'event_date'
export type YesNoFilter = 'all' | 'yes' | 'no'

export type LeadSearchFilters = {
  /** Qual data o intervalo filtra: criação do orçamento ou data do evento. */
  dateField: DateField
  /** "YYYY-MM-DD" ou vazio. */
  dateFrom: string
  dateTo: string
  status: LeadStatus | 'all'
  proposalSent: YesNoFilter
  room: string
  /** Meio de prospecção. */
  origin: string
  lossReason: string
  search: string
}

export const EMPTY_FILTERS: LeadSearchFilters = {
  dateField: 'created_at',
  dateFrom: '',
  dateTo: '',
  status: 'all',
  proposalSent: 'all',
  room: '',
  origin: '',
  lossReason: '',
  search: '',
}

export const DATE_FIELD_LABELS: Record<DateField, string> = {
  created_at: 'Data de criação',
  event_date: 'Data do evento',
}

export type SortField = 'created_at' | 'contact_name' | 'event_date' | 'total_value' | 'status'
export type SortDirection = 'asc' | 'desc'
export type LeadSort = { field: SortField; direction: SortDirection }

export const DEFAULT_SORT: LeadSort = { field: 'created_at', direction: 'desc' }

/** Quantos filtros estão ativos (para o contador do botão "Limpar"). */
export function countActiveFilters(filters: LeadSearchFilters): number {
  let count = 0
  if (filters.dateFrom || filters.dateTo) count += 1
  if (filters.status !== 'all') count += 1
  if (filters.proposalSent !== 'all') count += 1
  if (filters.room) count += 1
  if (filters.origin) count += 1
  if (filters.lossReason) count += 1
  if (filters.search.trim()) count += 1
  return count
}

// =============================================================================
// Montagem da consulta no Supabase
// =============================================================================

/** Remove caracteres que quebram a sintaxe do filtro `or()` do PostgREST. */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()"\\%*]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Condições de busca textual (nome, e-mail, telefone ou nº da proposta).
 * Telefones ficam salvos com máscara; quando a busca tem dígitos, procura também
 * na coluna gerada `contact_phone_digits` ("11987654321" encontra "(11) 98765-4321").
 */
function buildSearchConditions(rawTerm: string): string | null {
  const term = sanitizeSearchTerm(rawTerm)
  if (!term) return null

  const pattern = `*${term}*`
  const conditions = [
    `contact_name.ilike.${pattern}`,
    `contact_email.ilike.${pattern}`,
    `contact_phone.ilike.${pattern}`,
    `proposal_number.ilike.${pattern}`,
  ]

  const digits = onlyDigits(term)
  if (digits.length >= 3) {
    conditions.push(`contact_phone_digits.like.*${digits}*`)
  }

  return conditions.join(',')
}

/** Literal de array do Postgres com aspas: nomes com vírgula, espaço ou aspas continuam funcionando. */
function toPgArrayLiteral(values: string[]): string {
  const quoted = values.map((value) => `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`)
  return `{${quoted.join(',')}}`
}

/**
 * Aplica os filtros a uma consulta de `leads`.
 * Genérico para servir tanto à listagem paginada quanto à exportação completa.
 */
function applyFilters<Q extends { eq: any; gte: any; lt: any; lte: any; or: any; filter: any }>(query: Q, filters: LeadSearchFilters): Q {
  let next = query

  if (filters.dateField === 'created_at') {
    if (filters.dateFrom) {
      next = next.gte('created_at', rangeToTimestampBounds({ from: filters.dateFrom, to: filters.dateFrom }).gte)
    }
    if (filters.dateTo) {
      next = next.lt('created_at', rangeToTimestampBounds({ from: filters.dateTo, to: filters.dateTo }).lt)
    }
  } else {
    if (filters.dateFrom) next = next.gte('event_date', filters.dateFrom)
    if (filters.dateTo) next = next.lte('event_date', filters.dateTo)
  }

  if (filters.status !== 'all') next = next.eq('status', filters.status)
  if (filters.proposalSent !== 'all') next = next.eq('proposal_sent', filters.proposalSent === 'yes')
  // Lead com várias salas: basta conter a sala filtrada
  if (filters.room) next = next.filter('room_interests', 'cs', toPgArrayLiteral([filters.room]))
  if (filters.origin) next = next.eq('origin', filters.origin)
  if (filters.lossReason) next = next.eq('loss_reason', filters.lossReason)

  const searchConditions = buildSearchConditions(filters.search)
  if (searchConditions) next = next.or(searchConditions)

  return next
}

export type LeadPage = { rows: Lead[]; total: number }

/** Uma página da listagem, já ordenada, com o total de resultados. */
export async function fetchLeadPage(
  filters: LeadSearchFilters,
  sort: LeadSort,
  page: number,
  pageSize: number,
): Promise<LeadPage> {
  const from = page * pageSize
  const query = applyFilters(supabase.from('leads').select('*', { count: 'exact' }), filters)
    .order(sort.field, { ascending: sort.direction === 'asc', nullsFirst: false })
    // Desempate estável para a paginação não repetir/pular linhas
    .order('id', { ascending: true })
    .range(from, from + pageSize - 1)

  const { data, error, count } = await query
  if (error) throw error
  return { rows: data ?? [], total: count ?? 0 }
}

const EXPORT_PAGE_SIZE = 1000

/** Todos os leads que batem com os filtros (para exportação), paginando de 1000 em 1000. */
export async function fetchAllFilteredLeads(filters: LeadSearchFilters, sort: LeadSort): Promise<Lead[]> {
  const rows: Lead[] = []

  for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
    const { data, error } = await applyFilters(supabase.from('leads').select('*'), filters)
      .order(sort.field, { ascending: sort.direction === 'asc', nullsFirst: false })
      .order('id', { ascending: true })
      .range(offset, offset + EXPORT_PAGE_SIZE - 1)

    if (error) throw error
    rows.push(...(data ?? []))
    if (!data || data.length < EXPORT_PAGE_SIZE) break
  }

  return rows
}

// =============================================================================
// Descrição legível dos filtros (cabeçalho do PDF)
// =============================================================================

export function describeFilters(filters: LeadSearchFilters): string[] {
  const lines: string[] = []

  if (filters.dateFrom || filters.dateTo) {
    const from = filters.dateFrom ? formatDateBR(filters.dateFrom) : 'início'
    const to = filters.dateTo ? formatDateBR(filters.dateTo) : 'hoje'
    lines.push(`${DATE_FIELD_LABELS[filters.dateField]}: ${from} a ${to}`)
  }
  if (filters.status !== 'all') lines.push(`Situação: ${LEAD_STATUS_LABELS[filters.status]}`)
  if (filters.proposalSent !== 'all') lines.push(`Proposta enviada: ${filters.proposalSent === 'yes' ? 'Sim' : 'Não'}`)
  if (filters.room) lines.push(`Sala/Salão: ${filters.room}`)
  if (filters.origin) lines.push(`Meio de prospecção: ${filters.origin}`)
  if (filters.lossReason) lines.push(`Motivo de perda: ${filters.lossReason}`)
  if (filters.search.trim()) lines.push(`Busca: "${filters.search.trim()}"`)

  return lines.length > 0 ? lines : ['Sem filtros (todos os leads)']
}
