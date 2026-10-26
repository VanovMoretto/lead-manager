/**
 * Tipos do domínio de Leads e Orçamentos de Eventos.
 * Espelham exatamente o schema em `supabase/schema.sql`.
 *
 * Convenções de serialização do Supabase (PostgREST):
 * - `uuid`, `text`         -> string
 * - `timestamptz`          -> string ISO 8601 (ex.: "2026-10-26T14:30:00.000Z")
 * - `date`                 -> string "YYYY-MM-DD" (sem fuso; não converta com `new Date()` direto)
 * - `numeric(12,2)`        -> number
 */

// =============================================================================
// Primitivos
// =============================================================================

/** UUID v4 gerado pelo banco. */
export type UUID = string

/** Data/hora ISO 8601 (coluna `timestamptz`). */
export type ISODateTime = string

/** Data no formato "YYYY-MM-DD" (coluna `date`). */
export type ISODate = string

// =============================================================================
// Configurações dinâmicas (Painel Admin)
// =============================================================================

export const SETTING_CATEGORIES = ['room', 'origin', 'loss_reason'] as const

/** Categoria de uma opção configurável. */
export type SettingCategory = (typeof SETTING_CATEGORIES)[number]

export const SETTING_CATEGORY_LABELS: Record<SettingCategory, string> = {
  room: 'Salas/Salões',
  origin: 'Meios de Prospecção',
  loss_reason: 'Motivos de Perda',
}

/** Linha da tabela `app_settings_options`. */
export type AppSettingOption = {
  id: UUID
  category: SettingCategory
  label: string
  /** Opções inativas somem dos formulários, mas continuam no histórico dos leads. */
  active: boolean
  created_at: ISODateTime
}

/** Payload para criar uma opção (campos com default no banco são opcionais). */
export type AppSettingOptionInsert = {
  id?: UUID
  category: SettingCategory
  label: string
  active?: boolean
  created_at?: ISODateTime
}

/** Payload para editar uma opção. */
export type AppSettingOptionUpdate = Partial<AppSettingOptionInsert>

/** Opções agrupadas por categoria, prontas para alimentar selects. */
export type SettingOptionsByCategory = Record<SettingCategory, AppSettingOption[]>

// =============================================================================
// Leads
// =============================================================================

export const LEAD_STATUSES = ['em_aberto', 'fechado', 'perdido'] as const

/** Situação do lead no funil. */
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  em_aberto: 'Em aberto',
  fechado: 'Fechado',
  perdido: 'Perdido',
}

/** Motivos de perda inseridos pelo seed inicial do banco. */
export const DEFAULT_LOSS_REASONS = [
  'Cliente não retornou contato',
  'Achou alto o valor de gastronomia (A&B)',
  'Data não disponível',
  'Achou alto o valor de locação',
  'Problema de infraestrutura',
  'Motivo não informado',
  'Outros',
] as const

/** Motivo que torna `loss_reason_details` obrigatório na interface. */
export const LOSS_REASON_OTHER = 'Outros'

/** Linha da tabela `leads`, como retornada pelo Supabase. */
export type Lead = {
  id: UUID
  created_at: ISODateTime
  /** Atualizado automaticamente por trigger a cada UPDATE. */
  updated_at: ISODateTime

  // Contato
  contact_name: string
  contact_phone: string | null
  contact_email: string | null
  /** Cliente pediu para não receber comunicações/mailing (opt-out LGPD). */
  marketing_opt_out: boolean

  // Origem e interesse (labels de `app_settings_options`)
  /** Meio de prospecção (categoria `origin`). */
  origin: string | null
  /** Salas/Salões de interesse (categoria `room`). Um lead pode citar várias. */
  room_interests: string[]
  /**
   * Espelho legível de `room_interests` ("Salão A | Salão B"), mantido por trigger no banco.
   * Somente leitura: o app grava apenas `room_interests`.
   */
  room_interest: string | null

  // Data do evento
  /** Nulo quando o cliente ainda não definiu a data. */
  event_date: ISODate | null
  is_date_flexible: boolean
  /** Ex.: "Previsão para Novembro". */
  date_notes: string | null

  // Proposta
  /** Valor de Locação / Espaço. */
  proposed_value: number | null
  /** Inclui proposta de Alimentos & Bebidas? */
  has_ab: boolean
  /** Valor de A&B (0 quando `has_ab` é false). */
  ab_value: number
  /** Inclui Hospedagem? */
  has_lodging: boolean
  /** Valor de Hospedagem (0 quando `has_lodging` é false). */
  lodging_value: number
  /** Coluna gerada: locação + A&B + hospedagem. Somente leitura. */
  total_value: number
  /** Proposta formal foi gerada/enviada? */
  proposal_sent: boolean
  /** Único quando informado. */
  proposal_number: string | null

  // Funil
  status: LeadStatus
  /** Obrigatório no banco quando `status = 'perdido'` (categoria `loss_reason`). */
  loss_reason: string | null
  /** Campo livre, usado principalmente quando o motivo é "Outros". */
  loss_reason_details: string | null

  /** Usuário que cadastrou o lead (default `auth.uid()`). */
  user_id: UUID | null

  /** Coluna gerada pelo banco: telefone só com dígitos (usada na busca). Somente leitura. */
  contact_phone_digits: string | null
}

/** Colunas que o banco calcula e que nunca são enviadas em INSERT/UPDATE. */
type LeadGeneratedFields = 'contact_phone_digits' | 'total_value' | 'room_interest'

/** Campos que o banco preenche sozinho quando omitidos. */
type LeadDbDefaults =
  | 'id'
  | 'created_at'
  | 'updated_at'
  | 'is_date_flexible'
  | 'marketing_opt_out'
  | 'has_ab'
  | 'ab_value'
  | 'has_lodging'
  | 'lodging_value'
  | 'room_interests'
  | 'proposal_sent'
  | 'status'
  | 'user_id'

/** Campos anuláveis, que podem ser omitidos num INSERT. */
type LeadNullableFields =
  | 'contact_phone'
  | 'contact_email'
  | 'origin'
  | 'event_date'
  | 'date_notes'
  | 'proposed_value'
  | 'proposal_number'
  | 'loss_reason'
  | 'loss_reason_details'

/** Payload para criar um lead: só `contact_name` é obrigatório. */
export type LeadInsert = Omit<Lead, LeadDbDefaults | LeadNullableFields | LeadGeneratedFields> &
  Partial<Pick<Lead, LeadDbDefaults | LeadNullableFields>>

/** Payload para editar um lead. */
export type LeadUpdate = Partial<LeadInsert>

/** Estado de um formulário de lead (sem campos controlados pelo banco). */
export type LeadFormData = Omit<Lead, 'id' | 'created_at' | 'updated_at' | 'user_id' | LeadGeneratedFields>

/** Valores iniciais de um formulário de novo lead. */
export const EMPTY_LEAD_FORM: LeadFormData = {
  contact_name: '',
  contact_phone: null,
  contact_email: null,
  marketing_opt_out: false,
  origin: null,
  room_interests: [],
  event_date: null,
  is_date_flexible: false,
  date_notes: null,
  proposed_value: null,
  has_ab: false,
  ab_value: 0,
  has_lodging: false,
  lodging_value: 0,
  proposal_sent: false,
  proposal_number: null,
  status: 'em_aberto',
  loss_reason: null,
  loss_reason_details: null,
}

/** Filtros da listagem de leads. */
export type LeadFilters = {
  search?: string
  status?: LeadStatus | 'todos'
  origin?: string
  room?: string
  /** Intervalo de data do evento ("YYYY-MM-DD"). */
  event_date_from?: ISODate
  event_date_to?: ISODate
  proposal_sent?: boolean
}

// =============================================================================
// Type guards
// =============================================================================

export function isLeadStatus(value: unknown): value is LeadStatus {
  return typeof value === 'string' && (LEAD_STATUSES as readonly string[]).includes(value)
}

export function isSettingCategory(value: unknown): value is SettingCategory {
  return typeof value === 'string' && (SETTING_CATEGORIES as readonly string[]).includes(value)
}

// =============================================================================
// Tipo do banco para o cliente Supabase
// Uso: createClient<Database>(url, key) -> consultas tipadas em .from('leads')
// =============================================================================

export type Database = {
  public: {
    Tables: {
      app_settings_options: {
        Row: AppSettingOption
        Insert: AppSettingOptionInsert
        Update: AppSettingOptionUpdate
        Relationships: []
      }
      leads: {
        Row: Lead
        Insert: LeadInsert
        Update: LeadUpdate
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
