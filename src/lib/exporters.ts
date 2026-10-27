/**
 * Exportações da Consulta de Propostas (Excel, CSV de mailing e PDF) e da planilha de Faturamento.
 * Este módulo é carregado sob demanda (import dinâmico), para que xlsx e jsPDF
 * só sejam baixados quando alguém clicar em exportar.
 */
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatBRL, formatDateBR, formatPhoneBR } from './format'
import { toLocalISODate } from './dashboard'
import { NET_RATES, formatLeadEventPeriod, formatLeadRooms, getLeadValues, hasAnyValue, sumLeadValues } from './leadFields'
import { formatEventDays, netShare, revenueSituation, type RevenueLead } from './revenue'
import { normalizeEmail, normalizePhoneDigits } from './contactIdentity'
import {
  LEAD_STATUS_LABELS,
  OPERATIONAL_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SURVEY_STATUS_LABELS,
  type Lead,
  type MarketingSuppression,
} from '../types/lead'

// =============================================================================
// Utilitários
// =============================================================================

function timestampForFilename(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`
}

/**
 * Data de criação (dia local, sem horário) como número de série do Excel,
 * para a coluna ser filtrada e ordenada como data.
 */
function toExcelDateSerial(timestamp: string): number {
  const [year, month, day] = toLocalISODate(new Date(timestamp)).split('-').map(Number)
  // 25569 = dias entre 1900-01-00 (base do Excel) e 1970-01-01
  return Date.UTC(year, month - 1, day) / 86_400_000 + 25569
}

/** "20/11/2026", "20/11/2026 a 22/11/2026 (3 dias)" ou "Sem data (previsão)". */
function formatEventDate(lead: Lead): string {
  const period = formatLeadEventPeriod(lead)
  if (period) return period
  return lead.date_notes ? `Sem data (${lead.date_notes})` : 'Sem data'
}

const yesNo = (value: boolean) => (value ? 'Sim' : 'Não')

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Proteção contra "formula injection" (CSV/Excel): um texto que comece com
 * =, +, -, @, tab ou retorno de carro poderia ser interpretado como fórmula ao abrir
 * a planilha. Um apóstrofo no início faz o Excel tratar o conteúdo como texto.
 */
export function sanitizeSpreadsheetText(val: string): string {
  return /^[=+\-@\t\r]/.test(val) ? `'${val}` : val
}

/** Aplica a sanitização em todas as células de texto de uma linha (números passam direto). */
function sanitizeRow<T extends string | number | null>(row: T[]): T[] {
  return row.map((cell) => (typeof cell === 'string' ? (sanitizeSpreadsheetText(cell) as T) : cell))
}

/** Soma os componentes de valor de uma lista de leads. */
const sumValues = sumLeadValues

// =============================================================================
// 1. Excel completo (.xlsx)
// =============================================================================

const CURRENCY_FORMAT = '"R$" #,##0.00'
const DATE_FORMAT = 'dd/mm/yyyy'

export function exportLeadsToXlsx(leads: Lead[]): void {
  const header = [
    'Criado em',
    'Contato',
    'Empresa',
    'CNPJ',
    'Telefone',
    'E-mail',
    'Meio de prospecção',
    'Salas/Salões de interesse',
    'Data do evento',
    'Inclui A&B',
    'Inclui hospedagem',
    'Locação / Espaço (R$)',
    'A&B (R$)',
    'Hospedagem (R$)',
    'Equipamentos / Extras (R$)',
    'Estacionamento (R$)',
    'Receita Bruta Total (R$)',
    'Receita Líquida Total (R$)',
    'Proposta enviada',
    'Nº da proposta',
    'Situação',
    'Motivo de perda',
    'Detalhes da perda',
    'Opt-out LGPD',
    'Observações',
  ]
  const dateColumn = 0
  // Colunas numéricas de valor (L a R)
  const valueColumns = [11, 12, 13, 14, 15, 16, 17]

  const rows: Array<Array<string | number | null>> = leads.map((lead) => {
    const values = getLeadValues(lead)
    return sanitizeRow<string | number | null>([
      toExcelDateSerial(lead.created_at),
      lead.contact_name,
      lead.company ?? '',
      lead.cnpj ?? '',
      lead.contact_phone ?? '',
      lead.contact_email ?? '',
      lead.origin ?? '',
      formatLeadRooms(lead, ', '),
      formatEventDate(lead),
      yesNo(lead.has_ab),
      yesNo(lead.has_lodging),
      // Números de verdade (não texto), para a gerência conseguir somar no Excel
      lead.proposed_value ?? null,
      values.ab,
      values.lodging,
      values.equipment,
      values.parking,
      hasAnyValue(lead) ? values.total : null,
      hasAnyValue(lead) ? values.net : null,
      yesNo(lead.proposal_sent || lead.status === 'fechado'),
      lead.proposal_number ?? '',
      LEAD_STATUS_LABELS[lead.status],
      lead.loss_reason ?? '',
      lead.loss_reason_details ?? '',
      yesNo(lead.marketing_opt_out),
      lead.observations ?? '',
    ])
  })

  const sheet = XLSX.utils.aoa_to_sheet([header, ...rows])
  const lastDataRow = rows.length // índice 0 = cabeçalho

  // Linha de totais com fórmulas (continua certa se alguém filtrar/editar na planilha)
  if (rows.length > 0) {
    const totalsRow = lastDataRow + 1
    sheet[XLSX.utils.encode_cell({ r: totalsRow, c: 0 })] = { t: 's', v: 'TOTAL' }
    for (const column of valueColumns) {
      const columnLetter = XLSX.utils.encode_col(column)
      // `v` é o valor já calculado (a planilha abre certa); a fórmula recalcula ao filtrar no Excel
      const cachedSum = rows.reduce((sum, row) => sum + (typeof row[column] === 'number' ? (row[column] as number) : 0), 0)
      sheet[XLSX.utils.encode_cell({ r: totalsRow, c: column })] = {
        t: 'n',
        v: Math.round(cachedSum * 100) / 100,
        f: `SUBTOTAL(9,${columnLetter}2:${columnLetter}${lastDataRow + 1})`,
        z: CURRENCY_FORMAT,
      }
    }
    sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalsRow, c: header.length - 1 } })
  }

  // Formato de data e de moeda
  for (let rowIndex = 1; rowIndex <= lastDataRow; rowIndex += 1) {
    const dateCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: dateColumn })]
    if (dateCell && typeof dateCell.v === 'number') dateCell.z = DATE_FORMAT
    for (const column of valueColumns) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })]
      if (cell && typeof cell.v === 'number') cell.z = CURRENCY_FORMAT
    }
  }

  // Largura das colunas pelo maior conteúdo (limitada)
  sheet['!cols'] = header.map((title, columnIndex) => {
    if (columnIndex === dateColumn) return { wch: 12 }
    const longest = rows.reduce((max, row) => Math.max(max, String(row[columnIndex] ?? '').length), title.length)
    return { wch: Math.min(Math.max(longest + 2, 10), 50) }
  })
  // Filtro automático no cabeçalho (sem incluir a linha de totais)
  sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastDataRow, c: header.length - 1 } }) }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Leads')
  XLSX.writeFile(workbook, `leads_${timestampForFilename()}.xlsx`, { compression: true })
}

// =============================================================================
// 2. Mailing para marketing (.csv)
// =============================================================================

/** Escapa um campo CSV (aspas, separador e quebras de linha). */
function csvField(value: string): string {
  return /[";\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Um contato único do mailing (vários orçamentos do mesmo cliente viram uma linha). */
export type MailingContact = {
  name: string
  /** Empresa mais recente informada para o contato (vazio = pessoa física). */
  company: string
  email: string
  phone: string
  rooms: string
  /** Situação do orçamento mais recente. */
  status: string
  /** Quantos orçamentos esse contato fez no período filtrado. */
  requests: number
  /** Pelo menos um orçamento fechado. */
  everClosed: boolean
  /** Data do orçamento mais recente (para ordenar). */
  latestAt: string
  /** Algum orçamento desse contato pediu opt-out de comunicações (LGPD). */
  optedOut: boolean
}

export type MailingSummary = {
  /** Contatos únicos exportados. */
  contacts: number
  /** Leads com e-mail ou telefone (antes de agrupar). */
  leadsWithContact: number
  /** Leads sem e-mail nem telefone (ficaram de fora). */
  skipped: number
  /** Contatos únicos ignorados por opt-out LGPD. */
  optedOut: number
  /** Orçamentos repetidos agrupados entre os contatos exportados. */
  mergedDuplicates: number
}

/**
 * Agrupa leads do mesmo cliente: mesmo e-mail (sem diferenciar maiúsculas) OU mesmo telefone (dígitos).
 * Os vínculos são transitivos: se o lead A tem o e-mail do B e o B tem o telefone do C, os três são o mesmo contato.
 * Cada grupo vira uma linha com os dados do orçamento mais recente.
 */
/** Chaves da lista de supressão (LGPD) já normalizadas, para consulta rápida. */
export type SuppressionKeys = { emails: Set<string>; phones: Set<string> }

export function toSuppressionKeys(rows: Array<Pick<MarketingSuppression, 'kind' | 'value'>>): SuppressionKeys {
  return {
    emails: new Set(rows.filter((row) => row.kind === 'email').map((row) => row.value)),
    phones: new Set(rows.filter((row) => row.kind === 'phone').map((row) => row.value)),
  }
}

export function groupMailingContacts(leads: Lead[], suppression?: SuppressionKeys): MailingContact[] {
  const contactable = leads.filter((lead) => normalizeEmail(lead.contact_email) || normalizePhoneDigits(lead))

  // Union-find: cada lead começa no próprio grupo; leads que dividem e-mail/telefone são unidos
  const parent = contactable.map((_, index) => index)
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]]
      index = parent[index]
    }
    return index
  }
  const firstLeadByKey = new Map<string, number>()
  contactable.forEach((lead, index) => {
    const keys = [normalizeEmail(lead.contact_email), normalizePhoneDigits(lead)]
      .map((value, position) => (value ? `${position === 0 ? 'email' : 'phone'}:${value}` : null))
      .filter((key): key is string => key !== null)
    for (const key of keys) {
      const other = firstLeadByKey.get(key)
      if (other === undefined) firstLeadByKey.set(key, index)
      else parent[find(index)] = find(other)
    }
  })

  const groups = new Map<number, Lead[]>()
  contactable.forEach((lead, index) => {
    const root = find(index)
    const group = groups.get(root)
    if (group) group.push(lead)
    else groups.set(root, [lead])
  })

  return [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort((a, b) => b.created_at.localeCompare(a.created_at))
      const latest = sorted[0]
      // Dados do mais recente; se ele não tiver e-mail/telefone/sala, usa o mais recente que tiver
      const email = sorted.find((lead) => lead.contact_email)?.contact_email ?? ''
      const phoneDigits = sorted.map((lead) => normalizePhoneDigits(lead)).find(Boolean) ?? ''
      const phone = phoneDigits ? formatPhoneBR(phoneDigits) : ''
      const withRooms = sorted.find((lead) => formatLeadRooms(lead))
      return {
        name: latest.contact_name,
        company: sorted.find((lead) => lead.company)?.company ?? '',
        email,
        phone,
        rooms: withRooms ? formatLeadRooms(withRooms, ', ') : '',
        status: LEAD_STATUS_LABELS[latest.status],
        requests: group.length,
        everClosed: group.some((lead) => lead.status === 'fechado'),
        latestAt: latest.created_at,
        // Basta um orçamento com opt-out para o contato inteiro sair do mailing
        optedOut: group.some(
          (lead) =>
            lead.marketing_opt_out ||
            // Opt-out por contato: vale mesmo para leads fora do filtro ou já excluídos
            Boolean(suppression?.emails.has(normalizeEmail(lead.contact_email) ?? '')) ||
            Boolean(suppression?.phones.has(normalizePhoneDigits(lead) ?? '')),
        ),
      }
    })
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt))
}

export type MailingPreview = {
  /** Contatos que vão para o arquivo (já sem os de opt-out). */
  contacts: MailingContact[]
  summary: MailingSummary
}

/**
 * Agrupa e filtra os contatos do mailing sem gerar o arquivo (usado na pré-visualização).
 * `suppressions` é a lista de opt-out por contato (LGPD) inteira, não só a do filtro:
 * um contato que pediu opt-out em qualquer lead, atual ou excluído, nunca sai no mailing.
 */
export function buildMailing(leads: Lead[], suppressions: Array<Pick<MarketingSuppression, 'kind' | 'value'>>): MailingPreview {
  const grouped = groupMailingContacts(leads, toSuppressionKeys(suppressions))
  const contacts = grouped.filter((contact) => !contact.optedOut)
  const leadsWithContact = leads.filter((lead) => normalizeEmail(lead.contact_email) || normalizePhoneDigits(lead)).length

  return {
    contacts,
    summary: {
      contacts: contacts.length,
      leadsWithContact,
      skipped: leads.length - leadsWithContact,
      optedOut: grouped.length - contacts.length,
      mergedDuplicates: contacts.reduce((sum, contact) => sum + contact.requests - 1, 0),
    },
  }
}

/** Gera o CSV a partir de um mailing já montado por `buildMailing`. */
export function exportMailingToCsv(mailing: MailingPreview): MailingSummary {
  const header = ['Nome', 'Empresa', 'Email', 'Telefone', 'Sala de Interesse', 'Status', 'Qtd Solicitações', 'Já Fechou Evento?']

  const lines = [
    header.join(';'),
    ...mailing.contacts.map((contact) =>
      [
        contact.name,
        contact.company,
        contact.email,
        contact.phone,
        contact.rooms,
        contact.status,
        String(contact.requests),
        contact.everClosed ? 'Sim' : 'Não',
      ]
        .map(sanitizeSpreadsheetText)
        .map(csvField)
        .join(';'),
    ),
  ]

  // BOM + ";" como separador: o Excel em português abre com acentos e colunas certas
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  downloadBlob(blob, `mailing_${timestampForFilename()}.csv`)

  return mailing.summary
}

// =============================================================================
// 3. Relatório em PDF
// =============================================================================

const BRAND_900: [number, number, number] = [30, 58, 138]
const BRAND_600: [number, number, number] = [37, 99, 235]
const BRAND_50: [number, number, number] = [239, 246, 255]
const SLATE_500: [number, number, number] = [100, 116, 139]
const SLATE_900: [number, number, number] = [15, 23, 42]

/** Índice da coluna "Situação" na tabela do PDF (colorida por status). */
const PDF_STATUS_COLUMN = 12

/** `filterLabels`: descrição dos filtros aplicados (`describeFilters`). */
export function exportLeadsToPdf(leads: Lead[], filterLabels: string[]): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 12

  // ---- Faixa de título ----
  doc.setFillColor(...BRAND_900)
  doc.rect(0, 0, pageWidth, 22, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.text('Relatório de Leads e Orçamentos', margin, 14)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 14, { align: 'right' })

  // ---- Filtros aplicados ----
  let cursorY = 31
  doc.setTextColor(...SLATE_900)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.text('Filtros aplicados', margin, cursorY)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...SLATE_500)
  const filterText = doc.splitTextToSize(filterLabels.join('   |   '), pageWidth - margin * 2)
  doc.text(filterText, margin, cursorY + 5)
  cursorY += 5 + filterText.length * 4 + 4

  // ---- Resumo ----
  const closed = leads.filter((lead) => lead.status === 'fechado')
  const lost = leads.filter((lead) => lead.status === 'perdido').length
  const open = leads.length - closed.length - lost
  const sent = leads.filter((lead) => lead.proposal_sent || lead.status === 'fechado').length
  const closedValues = sumValues(closed)
  const allValues = sumValues(leads)
  const conversion = leads.length > 0 ? `${((closed.length / leads.length) * 100).toFixed(1).replace('.', ',')}%` : '0%'

  const drawBoxes = (boxes: Array<[string, string]>, highlightLast = false) => {
    const boxGap = 3
    const boxWidth = (pageWidth - margin * 2 - boxGap * (boxes.length - 1)) / boxes.length
    boxes.forEach(([label, value], index) => {
      const x = margin + index * (boxWidth + boxGap)
      const highlight = highlightLast && index === boxes.length - 1
      doc.setDrawColor(...(highlight ? BRAND_600 : ([226, 232, 240] as [number, number, number])))
      doc.setFillColor(...(highlight ? BRAND_50 : ([248, 250, 252] as [number, number, number])))
      doc.roundedRect(x, cursorY, boxWidth, 15, 1.5, 1.5, 'FD')
      doc.setFontSize(8)
      doc.setTextColor(...SLATE_500)
      doc.text(label, x + 3, cursorY + 5.5)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...(highlight ? BRAND_900 : SLATE_900))
      doc.text(value, x + 3, cursorY + 11.5)
      doc.setFont('helvetica', 'normal')
    })
    cursorY += 15 + 3
  }

  drawBoxes([
    ['Leads', String(leads.length)],
    ['Propostas enviadas', String(sent)],
    ['Em aberto', String(open)],
    ['Fechados', String(closed.length)],
    ['Perdidos', String(lost)],
    ['Conversão', conversion],
    ['Receita bruta orçada', formatBRL(allValues.total)],
  ])
  drawBoxes(
    [
      ['Fechado | Locação de sala', formatBRL(closedValues.rental)],
      ['Fechado | A&B', formatBRL(closedValues.ab)],
      ['Fechado | Hospedagem', formatBRL(closedValues.lodging)],
      ['Fechado | Equip. + Estac.', formatBRL(closedValues.equipment + closedValues.parking)],
      ['Receita líquida total', formatBRL(closedValues.net)],
      ['Receita bruta fechada', formatBRL(closedValues.total)],
    ],
    true,
  )
  cursorY += 3

  // ---- Tabela ----
  const money = (value: number, show: boolean) => (show ? formatBRL(value) : '-')

  autoTable(doc, {
    startY: cursorY,
    margin: { left: margin, right: margin, bottom: 14 },
    head: [
      [
        'Criado em',
        'Contato',
        'Telefone / E-mail',
        'Salas / Origem',
        'Evento',
        'Locação',
        'A&B',
        'Hosp.',
        'Equip. + Estac.',
        'Bruta total',
        'Líquida total',
        'Proposta',
        'Situação',
        'Motivo de perda',
      ],
    ],
    body: leads.map((lead) => {
      const values = getLeadValues(lead)
      return [
        formatDateBR(toLocalISODate(new Date(lead.created_at))),
        [lead.contact_name, lead.company, lead.cnpj ? `CNPJ ${lead.cnpj}` : null].filter(Boolean).join('\n'),
        [lead.contact_phone, lead.contact_email].filter(Boolean).join('\n') || '-',
        [formatLeadRooms(lead, ', '), lead.origin].filter(Boolean).join('\n') || '-',
        formatEventDate(lead),
        money(values.rental, lead.proposed_value !== null),
        money(values.ab, lead.has_ab || values.ab > 0),
        money(values.lodging, lead.has_lodging || values.lodging > 0),
        money(values.equipment + values.parking, values.equipment + values.parking > 0),
        money(values.total, hasAnyValue(lead)),
        money(values.net, hasAnyValue(lead)),
        lead.proposal_sent || lead.status === 'fechado' ? lead.proposal_number || 'Enviada' : 'Sondagem',
        LEAD_STATUS_LABELS[lead.status],
        lead.status === 'perdido' ? [lead.loss_reason, lead.loss_reason_details].filter(Boolean).join(': ') : '',
      ]
    }),
    // Totais da listagem (aparece só no fim da tabela)
    foot:
      leads.length > 0
        ? [
            [
              '',
              `Totais (${leads.length})`,
              '',
              '',
              '',
              formatBRL(allValues.rental),
              formatBRL(allValues.ab),
              formatBRL(allValues.lodging),
              formatBRL(allValues.equipment + allValues.parking),
              formatBRL(allValues.total),
              formatBRL(allValues.net),
              '',
              '',
              '',
            ],
          ]
        : undefined,
    showFoot: 'lastPage',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.8, textColor: SLATE_900, lineColor: [226, 232, 240], lineWidth: 0.1 },
    headStyles: { fillColor: BRAND_600, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: BRAND_50, textColor: BRAND_900, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    // Larguras em mm (A4 paisagem: 273 mm úteis). Valores com espaço para "R$ 999.999,99" sem quebrar.
    columnStyles: {
      0: { cellWidth: 17 },
      1: { cellWidth: 25, fontStyle: 'bold' },
      2: { cellWidth: 27 },
      3: { cellWidth: 24 },
      4: { cellWidth: 17 },
      5: { cellWidth: 19, halign: 'right' },
      6: { cellWidth: 18, halign: 'right' },
      7: { cellWidth: 18, halign: 'right' },
      8: { cellWidth: 18, halign: 'right' },
      9: { cellWidth: 21, halign: 'right', fontStyle: 'bold' },
      10: { cellWidth: 20, halign: 'right' },
      11: { cellWidth: 15 },
      12: { cellWidth: 14 },
    },
    didParseCell: (data) => {
      // Valores alinhados à direita também no rodapé de totais
      if (data.section === 'foot' && data.column.index >= 5 && data.column.index <= 10) {
        data.cell.styles.halign = 'right'
      }
      // Situação colorida (texto, sem depender de fundo)
      if (data.section === 'body' && data.column.index === PDF_STATUS_COLUMN) {
        const status = String(data.cell.raw)
        if (status === LEAD_STATUS_LABELS.fechado) data.cell.styles.textColor = [4, 120, 87]
        if (status === LEAD_STATUS_LABELS.perdido) data.cell.styles.textColor = [185, 28, 28]
        if (status === LEAD_STATUS_LABELS.em_aberto) data.cell.styles.textColor = [180, 83, 9]
        data.cell.styles.fontStyle = 'bold'
      }
    },
    didDrawPage: () => {
      // Rodapé em todas as páginas
      doc.setFontSize(8)
      doc.setTextColor(...SLATE_500)
      doc.text('Gestão de Leads | Eventos & Orçamentos', margin, pageHeight - 7)
      doc.text(`Página ${doc.getNumberOfPages()}`, pageWidth - margin, pageHeight - 7, { align: 'right' })
    },
  })

  if (leads.length === 0) {
    doc.setFontSize(10)
    doc.setTextColor(...SLATE_500)
    doc.text('Nenhum lead encontrado com os filtros aplicados.', margin, cursorY + 20)
  }

  doc.save(`relatorio-leads_${timestampForFilename()}.pdf`)
}

// =============================================================================
// 4. Planilha de Faturamento & Eventos (.xlsx e .pdf)
// =============================================================================

const REVENUE_HEADER = [
  'Data',
  'Evento',
  'Empresa / Contato',
  'Origem',
  'Local',
  'PAX',
  'Situação',
  'Locação de sala',
  'Extras / Equip. (100%)',
  'Extras 15%',
  'A&B (100%)',
  'A&B 6%',
  'Hospedagem (100%)',
  'Estacionamento (100%)',
  'Estac. 50%',
  'NF Locação',
  'NF A&B',
  'NF Estac.',
  'Pagamento',
  'Faturamento Bruto',
  'Faturamento Líquido',
  'Nº Proposta',
  'Pesquisa',
]

/** Colunas de valor da planilha de faturamento (índices em REVENUE_HEADER). */
const REVENUE_VALUE_COLUMNS = [7, 8, 9, 10, 11, 12, 13, 14, 19, 20]

function revenueRow(lead: RevenueLead): Array<string | number | null> {
  const values = getLeadValues(lead)
  return sanitizeRow<string | number | null>([
    formatEventDays(lead),
    lead.event_name ?? '',
    [lead.company, lead.contact_name].filter(Boolean).join(' · '),
    lead.origin ?? '',
    formatLeadRooms(lead, ', '),
    lead.pax ?? null,
    OPERATIONAL_STATUS_LABELS[revenueSituation(lead)],
    values.rental,
    values.equipment,
    netShare(values.equipment, NET_RATES.equipment),
    values.ab,
    netShare(values.ab, NET_RATES.ab),
    values.lodging,
    values.parking,
    netShare(values.parking, NET_RATES.parking),
    lead.nf_rental ?? '',
    lead.nf_ab ?? '',
    lead.nf_parking ?? '',
    PAYMENT_STATUS_LABELS[lead.payment_status],
    values.total,
    values.net,
    lead.proposal_number ?? '',
    SURVEY_STATUS_LABELS[lead.survey_status],
  ])
}

/** As três linhas de fechamento: faturamento bruto, faturamento líquido e a locação de salas isolada. */
function revenueTotals(leads: RevenueLead[]) {
  const gross = sumLeadValues(leads)
  const metaConfirmed = leads
    .filter((lead) => lead.status === 'fechado')
    .reduce((sum, lead) => sum + Number(lead.proposed_value ?? 0), 0)
  return {
    gross,
    net: {
      rental: gross.rental,
      equipment: netShare(gross.equipment, NET_RATES.equipment),
      ab: netShare(gross.ab, NET_RATES.ab),
      lodging: gross.lodging,
      parking: netShare(gross.parking, NET_RATES.parking),
      total: gross.net,
    },
    metaConfirmed,
    metaPending: gross.rental - metaConfirmed,
  }
}

export function exportRevenueToXlsx(leads: RevenueLead[], periodLabel: string): void {
  const rows = leads.map(revenueRow)
  const totals = revenueTotals(leads)
  const blank = () => REVENUE_HEADER.map(() => null as string | number | null)

  const grossRow = blank()
  grossRow[0] = 'FATURAMENTO BRUTO'
  grossRow[7] = totals.gross.rental
  grossRow[8] = totals.gross.equipment
  grossRow[10] = totals.gross.ab
  grossRow[12] = totals.gross.lodging
  grossRow[13] = totals.gross.parking
  grossRow[19] = totals.gross.total

  const netRow = blank()
  netRow[0] = 'FATURAMENTO LÍQUIDO'
  netRow[7] = totals.net.rental
  netRow[9] = totals.net.equipment
  netRow[11] = totals.net.ab
  netRow[12] = totals.net.lodging
  netRow[14] = totals.net.parking
  netRow[20] = totals.net.total

  const metaRow = blank()
  metaRow[0] = 'TOTAL LOCAÇÃO DE SALAS'
  metaRow[7] = totals.metaConfirmed
  metaRow[8] = `À confirmar: ${formatBRL(totals.metaPending)}`

  const title = [`Faturamento & Eventos · ${periodLabel}`]
  const sheet = XLSX.utils.aoa_to_sheet([title, REVENUE_HEADER, ...rows, blank(), grossRow, netRow, metaRow])
  const firstDataRow = 2
  const lastRow = firstDataRow + rows.length + 3
  for (let rowIndex = firstDataRow; rowIndex <= lastRow; rowIndex += 1) {
    for (const column of REVENUE_VALUE_COLUMNS) {
      const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })]
      if (cell && typeof cell.v === 'number') cell.z = CURRENCY_FORMAT
    }
  }
  sheet['!cols'] = REVENUE_HEADER.map((header, index) => ({
    wch: index === 0 ? 14 : index === 1 || index === 2 ? 28 : Math.max(header.length + 2, 12),
  }))
  sheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: 1, c: 0 }, e: { r: firstDataRow + rows.length - 1, c: REVENUE_HEADER.length - 1 } }),
  }

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, sheet, 'Faturamento')
  XLSX.writeFile(workbook, `faturamento_${timestampForFilename()}.xlsx`, { compression: true })
}

export function exportRevenueToPdf(leads: RevenueLead[], periodLabel: string): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 10
  const totals = revenueTotals(leads)

  doc.setFillColor(...BRAND_900)
  doc.rect(0, 0, pageWidth, 20, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text(`Faturamento & Eventos · ${periodLabel}`, margin, 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, pageWidth - margin, 13, { align: 'right' })

  const money = (value: number) => (value === 0 ? '-' : formatBRL(value))
  const withShare = (value: number, rate: number) =>
    value === 0 ? '-' : `${formatBRL(value)}\n${Math.round(rate * 100)}%: ${formatBRL(netShare(value, rate))}`

  autoTable(doc, {
    startY: 26,
    margin: { left: margin, right: margin, bottom: 14 },
    head: [
      [
        'Data',
        'Evento',
        'PAX',
        'Situação',
        'Locação de sala',
        'Equip. / Extras',
        'A&B',
        'Hosp.',
        'Estac.',
        'NFs Loc / A&B / Estac',
        'Pagto',
        'Faturamento bruto',
        'Faturamento líquido',
        'Proposta',
      ],
    ],
    body: leads.map((lead) => {
      const values = getLeadValues(lead)
      return [
        formatEventDays(lead),
        `${lead.event_name || 'Evento sem nome'}\n${[lead.company, lead.contact_name].filter(Boolean).join(' · ')}`,
        lead.pax === null ? '-' : String(lead.pax),
        OPERATIONAL_STATUS_LABELS[revenueSituation(lead)],
        money(values.rental),
        withShare(values.equipment, NET_RATES.equipment),
        withShare(values.ab, NET_RATES.ab),
        money(values.lodging),
        withShare(values.parking, NET_RATES.parking),
        [lead.nf_rental, lead.nf_ab, lead.nf_parking].map((nf) => nf || '-').join(' / '),
        PAYMENT_STATUS_LABELS[lead.payment_status],
        money(values.total),
        money(values.net),
        lead.proposal_number || '-',
      ]
    }),
    foot:
      leads.length > 0
        ? [
            [
              'FATURAMENTO BRUTO',
              `${leads.length} eventos`,
              '',
              '',
              formatBRL(totals.gross.rental),
              formatBRL(totals.gross.equipment),
              formatBRL(totals.gross.ab),
              formatBRL(totals.gross.lodging),
              formatBRL(totals.gross.parking),
              '',
              '',
              formatBRL(totals.gross.total),
              '',
              '',
            ],
            [
              'FATURAMENTO LÍQUIDO',
              '',
              '',
              '',
              formatBRL(totals.net.rental),
              formatBRL(totals.net.equipment),
              formatBRL(totals.net.ab),
              formatBRL(totals.net.lodging),
              formatBRL(totals.net.parking),
              '',
              '',
              '',
              formatBRL(totals.net.total),
              '',
            ],
            [
              'TOTAL LOCAÇÃO DE SALAS',
              'Confirmado / Realizado',
              '',
              '',
              formatBRL(totals.metaConfirmed),
              `À confirmar: ${formatBRL(totals.metaPending)}`,
              '',
              '',
              '',
              '',
              '',
              '',
              '',
              '',
            ],
          ]
        : undefined,
    showFoot: 'lastPage',
    styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.6, textColor: SLATE_900, lineColor: [226, 232, 240], lineWidth: 0.1 },
    headStyles: { fillColor: BRAND_600, textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: BRAND_50, textColor: BRAND_900, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    // A4 paisagem: 277 mm úteis com margem de 10 mm
    columnStyles: {
      0: { cellWidth: 17 },
      1: { cellWidth: 42, fontStyle: 'bold' },
      2: { cellWidth: 10, halign: 'right' },
      3: { cellWidth: 17 },
      4: { cellWidth: 21, halign: 'right', fontStyle: 'bold' },
      5: { cellWidth: 20, halign: 'right' },
      6: { cellWidth: 20, halign: 'right' },
      7: { cellWidth: 19, halign: 'right' },
      8: { cellWidth: 20, halign: 'right' },
      9: { cellWidth: 24 },
      10: { cellWidth: 14 },
      11: { cellWidth: 20, halign: 'right', fontStyle: 'bold' },
      12: { cellWidth: 20, halign: 'right' },
    },
    didParseCell: (data) => {
      if (data.section === 'foot' && data.column.index >= 4 && data.column.index <= 12) data.cell.styles.halign = 'right'
      // Locação de salas isolada em destaque
      if (data.section === 'foot' && data.row.index === 2) {
        data.cell.styles.fillColor = BRAND_900
        data.cell.styles.textColor = 255
      }
    },
    didDrawPage: () => {
      doc.setFontSize(8)
      doc.setTextColor(...SLATE_500)
      doc.text('Gestão de Leads | Faturamento & Eventos', margin, pageHeight - 7)
      doc.text(`Página ${doc.getNumberOfPages()}`, pageWidth - margin, pageHeight - 7, { align: 'right' })
    },
  })

  doc.save(`faturamento_${timestampForFilename()}.pdf`)
}
