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

/** Situação do evento na planilha de faturamento. */
export const OPERATIONAL_STATUSES = ['a_confirmar', 'confirmado', 'realizado'] as const
export type OperationalStatus = (typeof OPERATIONAL_STATUSES)[number]
export const OPERATIONAL_STATUS_LABELS: Record<OperationalStatus, string> = {
  a_confirmar: 'À confirmar',
  confirmado: 'Confirmado',
  realizado: 'Realizado',
}

export const PAYMENT_STATUSES = ['pendente', 'pago', 'parcial'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
  parcial: 'Parcial',
}

export const SURVEY_STATUSES = ['nao_enviada', 'enviada', 'respondida'] as const
export type SurveyStatus = (typeof SURVEY_STATUSES)[number]
export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = {
  nao_enviada: 'Não enviada',
  enviada: 'Enviada',
  respondida: 'Respondida',
}

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
  /** Empresa do contato; nulo quando é pessoa física. */
  company: string | null
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
  /** Primeiro (ou único) dia do evento. Nulo quando o cliente ainda não definiu a data. */
  event_date: ISODate | null
  /** Último dia quando o evento dura mais de um dia; nulo para evento de um dia. */
  event_end_date: ISODate | null
  /** Coluna gerada: último dia efetivo (event_end_date ou event_date). Somente leitura. */
  event_last_date: ISODate | null
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
  /** Inclui Equipamentos / Extras? */
  has_equipment: boolean
  /** Valor de Equipamentos / Extras (0 quando `has_equipment` é false). */
  equipment_value: number
  /** Inclui Estacionamento? */
  has_parking: boolean
  /** Valor de Estacionamento (0 quando `has_parking` é false). */
  parking_value: number
  /** Coluna gerada: Receita Bruta (100% dos 5 serviços). Somente leitura. */
  total_value: number
  /** Coluna gerada: Receita Líquida do Hotel (100% locação e hospedagem, 50% estac., 15% equip., 6% A&B). Somente leitura. */
  net_value: number
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

  /** Observações da negociação (painel de detalhes do lead). */
  observations: string | null

  // Evento e pós-evento (planilha de faturamento)
  /** Nome do evento, ex.: "Reunião Virtueyes". */
  event_name: string | null
  /** Número de pessoas. */
  pax: number | null
  /** À confirmar, confirmado ou realizado (anda junto com `status`, por trigger). */
  operational_status: OperationalStatus
  nf_rental: string | null
  nf_ab: string | null
  nf_parking: string | null
  payment_status: PaymentStatus
  survey_status: SurveyStatus

  /** Usuário que cadastrou o lead (default `auth.uid()`). */
  user_id: UUID | null

  /** Coluna gerada pelo banco: telefone só com dígitos (usada na busca). Somente leitura. */
  contact_phone_digits: string | null

  /** CNPJ da empresa nesta proposta (00.000.000/0000-00). */
  cnpj: string | null
  /** Coluna gerada: CNPJ só com dígitos (usada na busca). Somente leitura. */
  cnpj_digits: string | null

  /** Cliente (empresa ou pessoa física) dono do histórico. Sem ele, o banco cria um cadastro próprio. */
  client_id: UUID | null
  /** Pessoa do cliente que pediu a proposta (localizada ou criada pelo banco). */
  contact_id: UUID | null
}

/** Colunas que o banco calcula e que nunca são enviadas em INSERT/UPDATE. */
type LeadGeneratedFields =
  | 'contact_phone_digits'
  | 'total_value'
  | 'net_value'
  | 'room_interest'
  | 'event_last_date'
  | 'cnpj_digits'

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
  | 'has_equipment'
  | 'equipment_value'
  | 'has_parking'
  | 'parking_value'
  | 'operational_status'
  | 'payment_status'
  | 'survey_status'

/** Campos anuláveis, que podem ser omitidos num INSERT. */
type LeadNullableFields =
  | 'contact_phone'
  | 'contact_email'
  | 'company'
  | 'origin'
  | 'event_date'
  | 'event_end_date'
  | 'date_notes'
  | 'proposed_value'
  | 'proposal_number'
  | 'loss_reason'
  | 'loss_reason_details'
  | 'observations'
  | 'client_id'
  | 'contact_id'
  | 'cnpj'
  | 'event_name'
  | 'pax'
  | 'nf_rental'
  | 'nf_ab'
  | 'nf_parking'

/** Payload para criar um lead: só `contact_name` é obrigatório. */
export type LeadInsert = Omit<Lead, LeadDbDefaults | LeadNullableFields | LeadGeneratedFields> &
  Partial<Pick<Lead, LeadDbDefaults | LeadNullableFields>>

/** Payload para editar um lead. */
export type LeadUpdate = Partial<LeadInsert>

/** Estado de um formulário de lead (sem campos controlados pelo banco). */
export type LeadFormData = Omit<
  Lead,
  'id' | 'created_at' | 'updated_at' | 'user_id' | 'client_id' | 'contact_id' | LeadGeneratedFields
>

/** Valores iniciais de um formulário de novo lead. */
export const EMPTY_LEAD_FORM: LeadFormData = {
  contact_name: '',
  contact_phone: null,
  contact_email: null,
  company: null,
  cnpj: null,
  marketing_opt_out: false,
  origin: null,
  room_interests: [],
  event_date: null,
  event_end_date: null,
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
  observations: null,
  event_name: null,
  pax: null,
  operational_status: 'a_confirmar',
  has_equipment: false,
  equipment_value: 0,
  has_parking: false,
  parking_value: 0,
  nf_rental: null,
  nf_ab: null,
  nf_parking: null,
  payment_status: 'pendente',
  survey_status: 'nao_enviada',
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
// Opt-out por contato (LGPD)
// =============================================================================

/** Linha da lista de supressão: um e-mail ou telefone normalizado que pediu opt-out. */
export type MarketingSuppression = {
  id: UUID
  kind: 'email' | 'phone'
  /** E-mail em minúsculas ou telefone só com dígitos (DDD + número, sem o 55). */
  value: string
  /** Lead em que o opt-out foi registrado (pode já ter sido excluído). */
  source_lead_id: UUID | null
  created_at: ISODateTime
}

// =============================================================================
// Anexos das propostas
// =============================================================================

export const ATTACHMENT_KINDS = ['rental_proposal', 'ab_proposal'] as const

/** Tipo de proposta anexada ao lead. */
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

export const ATTACHMENT_KIND_LABELS: Record<AttachmentKind, string> = {
  rental_proposal: 'Proposta de Locação',
  ab_proposal: 'Proposta de A&B',
}

/** Linha da tabela `lead_attachments` (o arquivo fica no bucket `lead-attachments`). */
export type LeadAttachment = {
  id: UUID
  lead_id: UUID
  kind: AttachmentKind
  /** Caminho no bucket: {lead_id}/{kind}/{arquivo}. */
  storage_path: string
  /** Nome original do arquivo, usado no download. */
  file_name: string
  mime_type: string
  size_bytes: number
  uploaded_by: UUID | null
  created_at: ISODateTime
}

export type LeadAttachmentInsert = Omit<LeadAttachment, 'id' | 'created_at' | 'uploaded_by'> &
  Partial<Pick<LeadAttachment, 'id' | 'created_at' | 'uploaded_by'>>

// =============================================================================
// Perfis de usuário
// =============================================================================

// =============================================================================
// Clientes e pessoas de contato
// =============================================================================

export const CLIENT_TYPES = ['company', 'individual'] as const
export type ClientType = (typeof CLIENT_TYPES)[number]

/** Linha da tabela `clients`: empresa ou pessoa física, com o histórico de propostas em `leads.client_id`. */
export type Client = {
  id: UUID
  name: string
  client_type: ClientType
  /** Domínio de e-mail corporativo (nulo para provedores públicos como gmail e hotmail). */
  email_domain: string | null
  notes: string | null
  /** CNPJ do braço (00.000.000/0000-00). Cada CNPJ é um cadastro único. */
  cnpj: string | null
  /** Coluna gerada: CNPJ só com dígitos. Somente leitura. */
  cnpj_digits: string | null
  /** Identifica o braço quando a marca tem mais de um CNPJ, ex.: "Matriz", "Filial Novo Hamburgo". */
  branch_label: string | null
  created_at: ISODateTime
  updated_at: ISODateTime
}

export type ClientInsert = Pick<Client, 'name'> &
  Partial<Pick<Client, 'client_type' | 'email_domain' | 'notes' | 'cnpj' | 'branch_label'>>
export type ClientUpdate = Partial<ClientInsert>

/** Linha da tabela `client_contacts`: uma pessoa que já falou em nome do cliente. */
export type ClientContact = {
  id: UUID
  client_id: UUID
  name: string
  /** Cargo ou setor, ex.: Marketing, RH. */
  role: string | null
  phone: string | null
  /** Coluna gerada: telefone só com dígitos. Somente leitura. */
  phone_digits: string | null
  email: string | null
  is_primary: boolean
  active: boolean
  created_at: ISODateTime
}

export type ClientContactInsert = Pick<ClientContact, 'client_id' | 'name'> &
  Partial<Pick<ClientContact, 'role' | 'phone' | 'email' | 'is_primary' | 'active'>>
export type ClientContactUpdate = Partial<Omit<ClientContactInsert, 'client_id'>>

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  company: 'Empresa',
  individual: 'Pessoa Física',
}

/** Linha da view `client_summaries`: o cliente com o resumo do histórico de propostas. */
export type ClientSummary = Client & {
  proposals_count: number
  closed_count: number
  open_count: number
  lost_count: number
  /** Soma de `total_value` das propostas fechadas. */
  closed_revenue: number
  /** Soma de `total_value` das propostas em aberto. */
  open_revenue: number
  last_proposal_at: ISODateTime | null
  contacts_count: number
  primary_contact_id: UUID | null
  primary_contact_name: string | null
  primary_contact_phone: string | null
  primary_contact_email: string | null
  /** O contato principal pediu opt-out (LGPD). */
  primary_contact_opt_out: boolean
  /** Nome, contatos, e-mails e telefones em minúsculas (usado na busca). */
  search_text: string
}

/** Linha da tabela `user_profiles` (um perfil por usuário do Supabase Auth). */
export type UserProfile = {
  user_id: UUID
  email: string | null
  /** ADMIN: Painel Admin, gestão de usuários e exclusões. */
  is_admin: boolean
  /** Usuário desativado não lê nem grava dados. */
  is_active: boolean
  /** Caminho da foto no bucket `avatars`. */
  avatar_path: string | null
  last_sign_in_at: ISODateTime | null
  created_at: ISODateTime
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
      marketing_suppressions: {
        Row: MarketingSuppression
        /** Somente leitura para o app: a lista é mantida por triggers no banco. */
        Insert: never
        Update: never
        Relationships: []
      }
      leads: {
        Row: Lead
        Insert: LeadInsert
        Update: LeadUpdate
        Relationships: []
      }
      clients: {
        Row: Client
        Insert: ClientInsert
        Update: ClientUpdate
        Relationships: []
      }
      client_contacts: {
        Row: ClientContact
        Insert: ClientContactInsert
        Update: ClientContactUpdate
        Relationships: []
      }
      lead_attachments: {
        Row: LeadAttachment
        Insert: LeadAttachmentInsert
        /** Anexos não são editados: troca = enviar outro arquivo. */
        Update: never
        Relationships: []
      }
      user_profiles: {
        Row: UserProfile
        /** Criado por trigger em auth.users. */
        Insert: never
        /** O próprio usuário só altera a foto; papel e acesso mudam por `admin_set_user_access`. */
        Update: { avatar_path?: string | null }
        Relationships: []
      }
    }
    Views: {
      client_summaries: {
        Row: ClientSummary
        Relationships: []
      }
    }
    Functions: {
      /** ADMIN corrige o nome de uma opção (e das propostas que usam o nome antigo). */
      admin_rename_setting_option: {
        Args: { p_option_id: UUID; p_label: string }
        Returns: AppSettingOption
      }
      /** ADMIN exclui uma opção; com substituta, as propostas passam a usar a outra. Retorna quantas mudaram. */
      admin_delete_setting_option: {
        Args: { p_option_id: UUID; p_replacement_id?: UUID }
        Returns: number
      }
      /** O usuário logado tem papel ADMIN? */
      is_admin: { Args: Record<string, never>; Returns: boolean }
      /** ADMIN ativa/desativa um usuário ou muda o papel (campo omitido = mantém). */
      admin_set_user_access: {
        Args: { p_user_id: UUID; p_is_admin?: boolean; p_is_active?: boolean }
        Returns: UserProfile
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
