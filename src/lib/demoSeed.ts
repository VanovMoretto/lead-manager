/**
 * Base fictícia do Modo Demonstração (portfólio). Nenhum dado aqui é real: empresas, pessoas,
 * telefones, e-mails e CNPJs foram inventados (os CNPJs só têm dígitos verificadores válidos).
 *
 * As datas são relativas a "hoje", para a Dashboard sempre abrir com o mês atual preenchido,
 * propostas antigas aguardando retorno e eventos passados e futuros.
 */
import { DEFAULT_LOSS_REASONS, type AttachmentKind, type LeadInsert, type LeadStatus, type SettingCategory } from '../types/lead'

export const DEMO_PASSWORD = 'demo1234'

export const DEMO_USER_IDS = {
  admin: '00000000-0000-4000-8000-00000000a001',
  sales: '00000000-0000-4000-8000-00000000a002',
  intern: '00000000-0000-4000-8000-00000000a003',
} as const

/** Contas do acesso de 1 clique na tela de login. */
export const DEMO_ACCOUNTS = {
  admin: 'admin@portfolio.demo',
  sales: 'comercial@portfolio.demo',
} as const

export type DemoUserSeed = {
  id: string
  email: string
  is_admin: boolean
  is_active: boolean
  /** Dias desde o último acesso (null = nunca acessou). */
  lastSignInDaysAgo: number | null
  createdDaysAgo: number
}

export function demoUsers(): DemoUserSeed[] {
  return [
  { id: DEMO_USER_IDS.admin, email: DEMO_ACCOUNTS.admin, is_admin: true, is_active: true, lastSignInDaysAgo: 1, createdDaysAgo: 240 },
  { id: DEMO_USER_IDS.sales, email: DEMO_ACCOUNTS.sales, is_admin: false, is_active: true, lastSignInDaysAgo: 0, createdDaysAgo: 200 },
  { id: DEMO_USER_IDS.intern, email: 'estagio@portfolio.demo', is_admin: false, is_active: false, lastSignInDaysAgo: null, createdDaysAgo: 12 },
  ]
}

export function demoOptions(): Array<{ category: SettingCategory; label: string; active?: boolean }> {
  return [
  ...['Salão Imperial', 'Sala Executiva', 'Auditório Panorama', 'Terraço Gourmet', 'Sala Rubi'].map((label) => ({
    category: 'room' as const,
    label,
  })),
  ...['Instagram', 'Google', 'Indicação', 'Site Oficial', 'WhatsApp Comercial', 'Cliente Recorrente'].map((label) => ({
    category: 'origin' as const,
    label,
  })),
  ...DEFAULT_LOSS_REASONS.map((label) => ({ category: 'loss_reason' as const, label })),
  ]
}

/**
 * Quando a proposta foi criada: dias atrás, ou uma fração do mês atual
 * (0.5 = metade dos dias já passados deste mês), para cair sempre no mês corrente.
 */
type CreatedAt = { daysAgo: number } | { thisMonth: number }

export type DemoLeadSeed = {
  created: CreatedAt
  /** Dias desde a última atualização (padrão: logo depois da criação). */
  updatedDaysAgo?: number
  /** Dias a partir de hoje (negativo = evento já aconteceu) e duração em dias. */
  event?: { inDays: number; days?: number }
  user: keyof typeof DEMO_USER_IDS
  attachment?: AttachmentKind
  lead: Omit<LeadInsert, 'event_date' | 'event_end_date' | 'user_id' | 'status'> & { status: LeadStatus }
}

/** Calcula os dois dígitos verificadores de um CNPJ fictício a partir dos 12 primeiros. */
function demoCnpj(base: string): string {
  const digits = base.split('').map(Number)
  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const rest = weights.reduce((sum, weight, index) => sum + digits[index] * weight, 0) % 11
    return rest < 2 ? 0 : 11 - rest
  }
  digits.push(check(12))
  digits.push(check(13))
  const d = digits.join('')
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
}


/** Valores de A&B, hospedagem, equipamentos e estacionamento com os "has_*" coerentes. */
function services(values: { ab?: number; lodging?: number; equipment?: number; parking?: number }) {
  return {
    has_ab: (values.ab ?? 0) > 0,
    ab_value: values.ab ?? 0,
    has_lodging: (values.lodging ?? 0) > 0,
    lodging_value: values.lodging ?? 0,
    has_equipment: (values.equipment ?? 0) > 0,
    equipment_value: values.equipment ?? 0,
    has_parking: (values.parking ?? 0) > 0,
    parking_value: values.parking ?? 0,
  }
}

export function demoLeads(): DemoLeadSeed[] {
const CNPJ = {
    vertice: demoCnpj('482310740001'),
    aurora: demoCnpj('301958220001'),
    horizonte: demoCnpj('117402690001'),
    nexa: demoCnpj('276605130001'),
    biovida: demoCnpj('093481560001'),
    agrovale: demoCnpj('550127380001'),
    meridiano: demoCnpj('620045910001'),
    atlas: demoCnpj('338712040001'),
  }

  return [
  // ---------------------------------------------------------------------------
  // Vértice Engenharia: cliente recorrente (3 propostas, 2 fechadas)
  // ---------------------------------------------------------------------------
  {
    created: { daysAgo: 168 },
    updatedDaysAgo: 150,
    event: { inDays: -128 },
    user: 'sales',
    attachment: 'rental_proposal',
    lead: {
      contact_name: 'Patrícia Nogueira',
      contact_phone: '(11) 98234-5170',
      contact_email: 'patricia.nogueira@verticeengenharia.com.br',
      company: 'Vértice Engenharia',
      cnpj: CNPJ.vertice,
      origin: 'Indicação',
      room_interests: ['Auditório Panorama'],
      event_name: 'Convenção Anual Vértice',
      pax: 180,
      proposed_value: 18500,
      ...services({ ab: 32400, equipment: 4200, parking: 1800 }),
      proposal_sent: true,
      status: 'fechado',
      payment_status: 'pago',
      survey_status: 'respondida',
      nf_rental: 'NF 10482',
      nf_ab: 'NF 10483',
      observations: 'Cliente pediu coffee break reforçado no segundo intervalo. Avaliação final: 9,5.',
    },
  },
  {
    created: { daysAgo: 74 },
    updatedDaysAgo: 60,
    event: { inDays: -21, days: 2 },
    user: 'sales',
    lead: {
      contact_name: 'Patrícia Nogueira',
      contact_phone: '(11) 98234-5170',
      contact_email: 'patricia.nogueira@verticeengenharia.com.br',
      company: 'Vértice Engenharia',
      cnpj: CNPJ.vertice,
      origin: 'Cliente Recorrente',
      room_interests: ['Sala Executiva', 'Terraço Gourmet'],
      event_name: 'Treinamento de Lideranças',
      pax: 45,
      proposed_value: 9600,
      ...services({ ab: 11250, lodging: 14400, equipment: 1500 }),
      proposal_sent: true,
      status: 'fechado',
      payment_status: 'parcial',
      survey_status: 'enviada',
      nf_rental: 'NF 11027',
    },
  },
  {
    created: { thisMonth: 0.85 },
    updatedDaysAgo: 2,
    event: { inDays: 54 },
    user: 'sales',
    lead: {
      contact_name: 'Ricardo Almeida',
      contact_phone: '(11) 97410-2286',
      contact_email: 'ricardo.almeida@verticeengenharia.com.br',
      company: 'Vértice Engenharia',
      cnpj: CNPJ.vertice,
      origin: 'Cliente Recorrente',
      room_interests: ['Salão Imperial'],
      event_name: 'Confraternização de Fim de Ano',
      pax: 220,
      proposed_value: 22000,
      ...services({ ab: 48400, parking: 2200 }),
      proposal_sent: true,
      status: 'em_aberto',
      observations: 'Novo contato do RH. Aguardando aprovação do orçamento pela diretoria.',
    },
  },

  // ---------------------------------------------------------------------------
  // Grupo Horizonte Seguros: 3 propostas (fechada, em aberto, perdida)
  // ---------------------------------------------------------------------------
  {
    created: { daysAgo: 132 },
    updatedDaysAgo: 120,
    event: { inDays: -95, days: 3 },
    user: 'admin',
    attachment: 'ab_proposal',
    lead: {
      contact_name: 'Marcelo Tavares',
      contact_phone: '(21) 99188-4032',
      contact_email: 'marcelo.tavares@horizonteseguros.com.br',
      company: 'Grupo Horizonte Seguros',
      cnpj: CNPJ.horizonte,
      origin: 'Google',
      room_interests: ['Auditório Panorama', 'Sala Rubi'],
      event_name: 'Encontro Nacional de Corretores',
      pax: 150,
      proposed_value: 36000,
      ...services({ ab: 54000, lodging: 42600, equipment: 5800, parking: 1500 }),
      proposal_sent: true,
      status: 'fechado',
      payment_status: 'pago',
      survey_status: 'respondida',
      nf_rental: 'NF 10611',
      nf_ab: 'NF 10612',
      nf_parking: 'NF 10613',
    },
  },
  {
    created: { daysAgo: 22 },
    updatedDaysAgo: 9,
    event: { inDays: 75 },
    user: 'admin',
    lead: {
      contact_name: 'Marcelo Tavares',
      contact_phone: '(21) 99188-4032',
      contact_email: 'marcelo.tavares@horizonteseguros.com.br',
      company: 'Grupo Horizonte Seguros',
      cnpj: CNPJ.horizonte,
      origin: 'Cliente Recorrente',
      room_interests: ['Salão Imperial'],
      event_name: 'Premiação Top Corretores',
      pax: 260,
      proposed_value: 28000,
      ...services({ ab: 67600, parking: 2600 }),
      proposal_sent: true,
      status: 'em_aberto',
      observations: 'Comparando com outro espaço. Prometeu retorno até o fim da semana.',
    },
  },
  {
    created: { daysAgo: 58 },
    updatedDaysAgo: 40,
    event: { inDays: -30 },
    user: 'admin',
    lead: {
      contact_name: 'Luana Prado',
      contact_phone: '(21) 98820-1457',
      contact_email: 'luana.prado@horizonteseguros.com.br',
      company: 'Grupo Horizonte Seguros',
      cnpj: CNPJ.horizonte,
      origin: 'Cliente Recorrente',
      room_interests: ['Terraço Gourmet'],
      event_name: 'Happy Hour Comercial',
      pax: 80,
      proposed_value: 7800,
      ...services({ ab: 15200 }),
      proposal_sent: true,
      status: 'perdido',
      loss_reason: 'Achou alto o valor de gastronomia (A&B)',
    },
  },

  // ---------------------------------------------------------------------------
  // Aurora Cosméticos: 2 propostas
  // ---------------------------------------------------------------------------
  {
    created: { daysAgo: 110 },
    updatedDaysAgo: 100,
    event: { inDays: -70 },
    user: 'sales',
    lead: {
      contact_name: 'Camila Duarte',
      contact_phone: '(11) 99671-3308',
      contact_email: 'camila.duarte@auroracosmeticos.com.br',
      company: 'Aurora Cosméticos',
      cnpj: CNPJ.aurora,
      origin: 'Instagram',
      room_interests: ['Terraço Gourmet'],
      event_name: 'Lançamento Linha Primavera',
      pax: 120,
      proposed_value: 14500,
      ...services({ ab: 26400, equipment: 3600 }),
      proposal_sent: true,
      status: 'fechado',
      payment_status: 'pago',
      survey_status: 'respondida',
      nf_rental: 'NF 10777',
      nf_ab: 'NF 10778',
    },
  },
  {
    created: { thisMonth: 0.3 },
    updatedDaysAgo: 3,
    event: { inDays: 40 },
    user: 'sales',
    lead: {
      contact_name: 'Camila Duarte',
      contact_phone: '(11) 99671-3308',
      contact_email: 'camila.duarte@auroracosmeticos.com.br',
      company: 'Aurora Cosméticos',
      cnpj: CNPJ.aurora,
      origin: 'Cliente Recorrente',
      room_interests: ['Salão Imperial'],
      event_name: 'Workshop de Maquiagem',
      pax: 60,
      proposed_value: 12000,
      ...services({ ab: 9000 }),
      proposal_sent: true,
      status: 'perdido',
      loss_reason: 'Data não disponível',
      loss_reason_details: 'Queriam sábado e o salão já estava reservado para casamento.',
    },
  },

  // ---------------------------------------------------------------------------
  // Empresas com uma proposta
  // ---------------------------------------------------------------------------
  {
    created: { thisMonth: 0.15 },
    updatedDaysAgo: 5,
    event: { inDays: 18 },
    user: 'admin',
    attachment: 'rental_proposal',
    lead: {
      contact_name: 'Gustavo Lins',
      contact_phone: '(11) 3456-7821',
      contact_email: 'gustavo.lins@nexatec.com.br',
      company: 'Nexa Tecnologia',
      cnpj: CNPJ.nexa,
      origin: 'Site Oficial',
      room_interests: ['Auditório Panorama'],
      event_name: 'Nexa Dev Summit',
      pax: 200,
      proposed_value: 24000,
      ...services({ ab: 30000, equipment: 6200, parking: 2000 }),
      proposal_sent: true,
      status: 'fechado',
      payment_status: 'pendente',
    },
  },
  {
    created: { daysAgo: 34 },
    updatedDaysAgo: 18,
    event: { inDays: 28 },
    user: 'sales',
    lead: {
      contact_name: 'Dra. Helena Castro',
      contact_phone: '(31) 99702-6614',
      contact_email: 'helena.castro@biovidalab.com.br',
      company: 'Laboratório BioVida',
      cnpj: CNPJ.biovida,
      origin: 'Google',
      room_interests: ['Sala Executiva'],
      event_name: 'Reunião de Conselho',
      pax: 25,
      proposed_value: 4800,
      ...services({ ab: 3750 }),
      proposal_sent: true,
      status: 'em_aberto',
      observations: 'Pediram proposta com almoço executivo. Sem retorno desde o envio.',
    },
  },
  {
    created: { daysAgo: 96 },
    updatedDaysAgo: 80,
    event: { inDays: -60 },
    user: 'admin',
    lead: {
      contact_name: 'Roberto Siqueira',
      contact_phone: '(41) 99345-2290',
      contact_email: 'roberto@institutoeducarmais.org.br',
      company: 'Instituto Educar+',
      origin: 'Indicação',
      room_interests: ['Auditório Panorama'],
      event_name: 'Seminário de Educação Inclusiva',
      pax: 140,
      proposed_value: 16500,
      ...services({ ab: 12600 }),
      proposal_sent: true,
      status: 'perdido',
      loss_reason: 'Achou alto o valor de locação',
    },
  },
  {
    created: { daysAgo: 45 },
    updatedDaysAgo: 41,
    event: { inDays: -10 },
    user: 'sales',
    lead: {
      contact_name: 'Fábio Rezende',
      contact_phone: '(35) 99812-7743',
      contact_email: 'fabio@cafemontanha.com.br',
      company: 'Café Montanha',
      origin: 'Instagram',
      room_interests: ['Terraço Gourmet'],
      event_name: 'Degustação para Parceiros',
      pax: 50,
      proposed_value: 6200,
      ...services({ ab: 8750, parking: 600 }),
      proposal_sent: true,
      status: 'fechado',
      payment_status: 'pago',
      survey_status: 'enviada',
      nf_rental: 'NF 11240',
    },
  },
  {
    created: { thisMonth: 0.6 },
    updatedDaysAgo: 4,
    event: { inDays: 95 },
    user: 'sales',
    lead: {
      contact_name: 'Tatiane Moura',
      contact_phone: '(11) 98123-4409',
      contact_email: 'tatiane.moura@atlaslog.com.br',
      company: 'Atlas Logística',
      cnpj: CNPJ.atlas,
      origin: 'WhatsApp Comercial',
      room_interests: ['Sala Rubi', 'Sala Executiva'],
      event_name: 'Planejamento Estratégico 2027',
      pax: 35,
      proposed_value: 8400,
      ...services({ ab: 7350, lodging: 9800 }),
      proposal_sent: false,
      status: 'em_aberto',
    },
  },
  {
    created: { daysAgo: 66 },
    updatedDaysAgo: 50,
    user: 'admin',
    lead: {
      contact_name: 'Dr. Paulo Arantes',
      contact_phone: '(11) 3222-9081',
      contact_email: 'contato@sorrisopleno.com.br',
      company: 'Clínica Sorriso Pleno',
      origin: 'Site Oficial',
      room_interests: ['Sala Rubi'],
      event_name: 'Curso de Atualização Clínica',
      pax: 30,
      proposed_value: 5200,
      ...services({ ab: 2400, equipment: 900 }),
      date_notes: 'Previsão para o próximo semestre',
      is_date_flexible: true,
      proposal_sent: true,
      status: 'perdido',
      loss_reason: 'Problema de infraestrutura',
      loss_reason_details: 'Precisavam de cadeiras com prancheta para 30 alunos.',
    },
  },
  {
    created: { daysAgo: 25 },
    updatedDaysAgo: 11,
    event: { inDays: 33 },
    user: 'sales',
    lead: {
      contact_name: 'Bruno Kenji',
      contact_phone: '(11) 99456-0187',
      contact_email: 'bruno@pulsarmkt.com.br',
      company: 'Agência Pulsar Marketing',
      origin: 'Instagram',
      room_interests: ['Terraço Gourmet', 'Salão Imperial'],
      event_name: 'Ativação de Marca — Cliente Varejo',
      pax: 300,
      proposed_value: 26000,
      ...services({ ab: 39000, equipment: 5400, parking: 1200 }),
      proposal_sent: true,
      status: 'em_aberto',
      observations: 'Agência ainda depende do aprovado do cliente final.',
    },
  },
  {
    created: { daysAgo: 150 },
    updatedDaysAgo: 140,
    event: { inDays: -112, days: 3 },
    user: 'admin',
    attachment: 'rental_proposal',
    lead: {
      contact_name: 'Sérgio Bortolini',
      contact_phone: '(54) 99623-1150',
      contact_email: 'eventos@agrovale.coop.br',
      company: 'Cooperativa Agrovale',
      cnpj: CNPJ.agrovale,
      origin: 'Indicação',
      room_interests: ['Salão Imperial', 'Auditório Panorama'],
      event_name: 'Congresso de Cooperados',
      pax: 350,
      proposed_value: 38000,
      ...services({ ab: 78750, lodging: 46800, equipment: 6000, parking: 3500 }),
      proposal_sent: true,
      status: 'fechado',
      payment_status: 'pago',
      survey_status: 'respondida',
      nf_rental: 'NF 10390',
      nf_ab: 'NF 10391',
      nf_parking: 'NF 10392',
    },
  },
  {
    created: { thisMonth: 0.95 },
    updatedDaysAgo: 1,
    event: { inDays: 120, days: 2 },
    user: 'admin',
    lead: {
      contact_name: 'Juliana Freitas',
      contact_phone: '(11) 97012-5530',
      contact_email: 'juliana.freitas@bancomeridiano.com.br',
      company: 'Banco Meridiano',
      cnpj: CNPJ.meridiano,
      origin: 'Google',
      room_interests: ['Auditório Panorama', 'Salão Imperial', 'Sala Executiva'],
      event_name: 'Fórum de Investimentos',
      pax: 280,
      proposed_value: 34000,
      ...services({ ab: 61600, lodging: 28500, equipment: 6800, parking: 2800 }),
      proposal_sent: true,
      status: 'em_aberto',
      observations: 'Maior proposta do trimestre. Reunião de alinhamento marcada.',
    },
  },
  {
    created: { daysAgo: 82 },
    updatedDaysAgo: 75,
    event: { inDays: -40, days: 2 },
    user: 'sales',
    lead: {
      contact_name: 'Dra. Renata Vilela',
      contact_phone: '(31) 3344-8890',
      contact_email: 'secretaria@amregional.org.br',
      company: 'Associação Médica Regional',
      origin: 'Site Oficial',
      room_interests: ['Auditório Panorama', 'Sala Rubi'],
      event_name: 'Jornada de Cardiologia',
      pax: 160,
      proposed_value: 21000,
      ...services({ ab: 28800, lodging: 24000, equipment: 3200 }),
      proposal_sent: true,
      status: 'fechado',
      payment_status: 'pago',
      survey_status: 'nao_enviada',
      nf_rental: 'NF 10945',
    },
  },
  {
    created: { daysAgo: 52 },
    updatedDaysAgo: 30,
    event: { inDays: -5 },
    user: 'admin',
    lead: {
      contact_name: 'Amanda Reis',
      contact_phone: '(11) 99877-6120',
      contact_email: 'amanda@studiolumiere.com.br',
      company: 'Studio Lumière Fotografia',
      origin: 'Instagram',
      room_interests: ['Sala Rubi'],
      event_name: 'Workshop de Fotografia',
      pax: 20,
      proposed_value: 3200,
      ...services({ ab: 1800 }),
      proposal_sent: false,
      status: 'perdido',
      loss_reason: 'Cliente não retornou contato',
    },
  },

  // ---------------------------------------------------------------------------
  // Pessoa Física
  // ---------------------------------------------------------------------------
  {
    created: { daysAgo: 160 },
    updatedDaysAgo: 120,
    event: { inDays: 48 },
    user: 'sales',
    attachment: 'ab_proposal',
    lead: {
      contact_name: 'Juliana e Rafael Monteiro',
      contact_phone: '(11) 98455-3021',
      contact_email: 'juliana.rafael.casamento@gmail.com',
      origin: 'Instagram',
      room_interests: ['Salão Imperial', 'Terraço Gourmet'],
      event_name: 'Casamento Juliana & Rafael',
      pax: 180,
      proposed_value: 19800,
      ...services({ ab: 45000, lodging: 6400, parking: 1800 }),
      proposal_sent: true,
      status: 'fechado',
      payment_status: 'parcial',
      observations: 'Cerimônia no terraço e recepção no salão. Degustação agendada.',
    },
  },
  {
    created: { daysAgo: 30 },
    updatedDaysAgo: 16,
    event: { inDays: 62 },
    user: 'sales',
    lead: {
      contact_name: 'Cláudia Bernardes',
      contact_phone: '(11) 99234-7751',
      contact_email: 'claudia.bernardes@hotmail.com',
      origin: 'Instagram',
      room_interests: ['Salão Imperial'],
      event_name: '15 anos da Beatriz',
      pax: 120,
      proposed_value: 12000,
      ...services({ ab: 21600 }),
      proposal_sent: true,
      status: 'em_aberto',
      observations: 'Mãe da debutante. Quer incluir DJ e pista de LED.',
    },
  },
  {
    created: { daysAgo: 120 },
    updatedDaysAgo: 110,
    event: { inDays: -84 },
    user: 'admin',
    lead: {
      contact_name: 'Antônio Ferraz',
      contact_phone: '(11) 3876-2215',
      contact_email: null,
      origin: 'Indicação',
      room_interests: ['Terraço Gourmet'],
      event_name: 'Bodas de Ouro — Antônio e Lúcia',
      pax: 70,
      proposed_value: 6800,
      ...services({ ab: 11900 }),
      proposal_sent: true,
      status: 'fechado',
      payment_status: 'pago',
      survey_status: 'respondida',
    },
  },
  {
    created: { daysAgo: 140 },
    updatedDaysAgo: 128,
    event: { inDays: -90 },
    user: 'sales',
    lead: {
      contact_name: 'Comissão Formatura Medicina',
      contact_phone: '(11) 99001-4478',
      contact_email: 'formatura.med26@gmail.com',
      origin: 'Google',
      room_interests: ['Salão Imperial'],
      event_name: 'Baile de Formatura Medicina',
      pax: 400,
      proposed_value: 32000,
      ...services({ ab: 88000, parking: 4000 }),
      proposal_sent: true,
      status: 'perdido',
      loss_reason: 'Achou alto o valor de gastronomia (A&B)',
    },
  },
  {
    created: { thisMonth: 0.45 },
    updatedDaysAgo: 6,
    event: { inDays: 12 },
    user: 'sales',
    lead: {
      contact_name: 'Larissa Gomes',
      contact_phone: '(11) 98777-2063',
      contact_email: 'larissa.gomes@outlook.com',
      origin: 'WhatsApp Comercial',
      room_interests: ['Sala Rubi'],
      event_name: 'Chá Revelação',
      pax: 40,
      proposed_value: 2800,
      ...services({ ab: 4400 }),
      proposal_sent: true,
      status: 'perdido',
      loss_reason: 'Outros',
      loss_reason_details: 'Decidiu fazer o evento na casa da família.',
      marketing_opt_out: true,
    },
  },
  {
    created: { thisMonth: 0.05 },
    updatedDaysAgo: 0,
    event: { inDays: 26 },
    user: 'sales',
    lead: {
      contact_name: 'Mariana Lopes',
      contact_phone: '(11) 99540-8812',
      contact_email: 'mari.lopes@gmail.com',
      origin: 'Instagram',
      room_interests: ['Terraço Gourmet'],
      event_name: 'Aniversário de 40 anos',
      pax: 90,
      proposed_value: 7500,
      ...services({ ab: 14400 }),
      proposal_sent: false,
      status: 'em_aberto',
    },
  },
  {
    created: { daysAgo: 38 },
    updatedDaysAgo: 36,
    user: 'admin',
    lead: {
      contact_name: 'Carlos Mendes',
      contact_phone: '(21) 99612-0034',
      contact_email: 'carlos.mendes.palestras@gmail.com',
      origin: 'Site Oficial',
      room_interests: ['Sala Executiva'],
      event_name: 'Palestra Motivacional',
      pax: 60,
      proposed_value: 4200,
      ...services({}),
      is_date_flexible: true,
      date_notes: 'Previsão para o início do ano que vem',
      proposal_sent: false,
      status: 'perdido',
      loss_reason: 'Cliente não retornou contato',
    },
  },
  // Cliente PF recorrente: mesmo e-mail e telefone em duas propostas
  {
    created: { daysAgo: 178 },
    updatedDaysAgo: 170,
    event: { inDays: -150 },
    user: 'sales',
    lead: {
      contact_name: 'Fernanda Ribeiro',
      contact_phone: '(11) 98612-4470',
      contact_email: 'fernanda.ribeiro@gmail.com',
      origin: 'Google',
      room_interests: ['Sala Executiva'],
      event_name: 'Workshop de Confeitaria',
      pax: 30,
      proposed_value: 3600,
      ...services({ ab: 2700 }),
      proposal_sent: true,
      status: 'fechado',
      payment_status: 'pago',
      survey_status: 'respondida',
    },
  },
  {
    created: { thisMonth: 0.7 },
    updatedDaysAgo: 8,
    event: { inDays: 45, days: 2 },
    user: 'sales',
    lead: {
      contact_name: 'Fernanda Ribeiro',
      contact_phone: '(11) 98612-4470',
      contact_email: 'fernanda.ribeiro@gmail.com',
      origin: 'Cliente Recorrente',
      room_interests: ['Sala Executiva', 'Terraço Gourmet'],
      event_name: 'Curso Intensivo de Confeitaria',
      pax: 40,
      proposed_value: 7200,
      ...services({ ab: 6000, lodging: 3200 }),
      proposal_sent: true,
      status: 'em_aberto',
      observations: 'Voltou depois do primeiro workshop. Quer pacote com hospedagem para 2 instrutoras.',
    },
  },
]
}
