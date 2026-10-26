import { useEffect, useRef } from 'react'
import { CircleAlert, Download, FileSpreadsheet, FileText, LoaderCircle, Mail, X, type LucideIcon } from 'lucide-react'
import { formatBRL } from '../lib/format'
import { formatLeadEventPeriod, getLeadValues, hasAnyValue } from '../lib/leadFields'
import { cn } from '../lib/utils'
import type { MailingPreview } from '../lib/exporters'
import StatusBadge from './StatusBadge'
import type { Lead } from '../types/lead'

export type ExportKind = 'xlsx' | 'csv' | 'pdf'

/** Dados já carregados para exportar; o arquivo só é gerado na confirmação. */
export type ExportPreviewData =
  | { kind: 'xlsx' | 'pdf'; leads: Lead[]; filters: string[] }
  | { kind: 'csv'; leads: Lead[]; filters: string[]; mailing: MailingPreview }

const SAMPLE_ROWS = 8

const KIND_INFO: Record<ExportKind, { title: string; file: string; icon: LucideIcon }> = {
  xlsx: { title: 'Planilha Excel', file: 'leads_AAAA-MM-DD_HHMM.xlsx', icon: FileSpreadsheet },
  csv: { title: 'Mailing (CSV)', file: 'mailing_AAAA-MM-DD_HHMM.csv', icon: Mail },
  pdf: { title: 'Relatório em PDF', file: 'relatorio-leads_AAAA-MM-DD_HHMM.pdf', icon: FileText },
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        highlight
          ? 'border-brand-200 bg-brand-50 dark:border-brand-900/60 dark:bg-brand-950/30'
          : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40',
      )}
    >
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 truncate text-base font-bold tabular-nums text-slate-900 dark:text-white" title={value}>
        {value}
      </p>
    </div>
  )
}

const headCell = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'
const bodyCell = 'px-3 py-2 align-top text-slate-700 dark:text-slate-200'

function LeadsSample({ leads }: { leads: Lead[] }) {
  return (
    <table className="w-full min-w-[560px] text-sm">
      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50">
        <tr>
          <th className={headCell}>Contato</th>
          <th className={headCell}>Evento</th>
          <th className={cn(headCell, 'text-right')}>Receita total</th>
          <th className={headCell}>Situação</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {leads.slice(0, SAMPLE_ROWS).map((lead) => (
          <tr key={lead.id}>
            <td className={bodyCell}>
              <p className="font-medium text-slate-900 dark:text-white">{lead.contact_name}</p>
              {lead.company && <p className="text-xs text-slate-500 dark:text-slate-400">{lead.company}</p>}
            </td>
            <td className={cn(bodyCell, 'whitespace-nowrap')}>{formatLeadEventPeriod(lead) ?? lead.date_notes ?? 'Sem data'}</td>
            <td className={cn(bodyCell, 'whitespace-nowrap text-right tabular-nums')}>
              {hasAnyValue(lead) ? formatBRL(getLeadValues(lead).total) : '—'}
            </td>
            <td className={bodyCell}>
              <StatusBadge status={lead.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function MailingSample({ mailing }: { mailing: MailingPreview }) {
  return (
    <table className="w-full min-w-[560px] text-sm">
      <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/50">
        <tr>
          <th className={headCell}>Nome</th>
          <th className={headCell}>Empresa</th>
          <th className={headCell}>E-mail</th>
          <th className={headCell}>Telefone</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
        {mailing.contacts.slice(0, SAMPLE_ROWS).map((contact) => (
          <tr key={`${contact.email}|${contact.phone}|${contact.latestAt}`}>
            <td className={cn(bodyCell, 'font-medium text-slate-900 dark:text-white')}>{contact.name}</td>
            <td className={bodyCell}>{contact.company || '—'}</td>
            <td className={bodyCell}>{contact.email || '—'}</td>
            <td className={cn(bodyCell, 'whitespace-nowrap')}>{contact.phone || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

type ExportPreviewModalProps = {
  preview: ExportPreviewData | null
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}

export default function ExportPreviewModal({ preview, busy, onCancel, onConfirm }: ExportPreviewModalProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const open = preview !== null

  useEffect(() => {
    if (!open) return
    confirmRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, busy, onCancel])

  if (!preview) return null

  const info = KIND_INFO[preview.kind]
  const Icon = info.icon
  const leads = preview.leads
  const totalRows = preview.kind === 'csv' ? preview.mailing.contacts.length : leads.length
  const nothingToExport = totalRows === 0

  let stats: Array<{ label: string; value: string; highlight?: boolean }>
  if (preview.kind === 'csv') {
    const summary = preview.mailing.summary
    stats = [
      { label: 'Contatos únicos', value: summary.contacts.toLocaleString('pt-BR'), highlight: true },
      { label: 'Orçamentos agrupados', value: summary.mergedDuplicates.toLocaleString('pt-BR') },
      { label: 'Opt-out LGPD (fora)', value: summary.optedOut.toLocaleString('pt-BR') },
      { label: 'Sem e-mail/telefone (fora)', value: summary.skipped.toLocaleString('pt-BR') },
    ]
  } else {
    const closed = leads.filter((lead) => lead.status === 'fechado')
    const sum = (list: Lead[]) => list.reduce((total, lead) => total + getLeadValues(lead).total, 0)
    stats = [
      { label: 'Leads', value: leads.length.toLocaleString('pt-BR'), highlight: true },
      { label: 'Em aberto', value: leads.filter((lead) => lead.status === 'em_aberto').length.toLocaleString('pt-BR') },
      { label: 'Fechados', value: closed.length.toLocaleString('pt-BR') },
      { label: 'Perdidos', value: leads.filter((lead) => lead.status === 'perdido').length.toLocaleString('pt-BR') },
      { label: 'Receita total', value: formatBRL(sum(leads)) },
      { label: 'Receita total fechada', value: formatBRL(sum(closed)) },
    ]
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => !busy && onCancel()} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-preview-title"
        className="relative flex max-h-[92vh] w-full max-w-3xl flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl dark:bg-slate-900"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="export-preview-title" className="text-base font-semibold text-slate-900 dark:text-white">
                Pré-visualização: {info.title}
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Arquivo: {info.file}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Fechar"
            className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Filtros aplicados</p>
            <div className="flex flex-wrap gap-1.5">
              {preview.filters.map((filter) => (
                <span key={filter} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {filter}
                </span>
              ))}
            </div>
          </div>

          <div className={cn('grid grid-cols-2 gap-2', stats.length > 4 ? 'sm:grid-cols-3' : 'sm:grid-cols-4')}>
            {stats.map((stat) => (
              <Stat key={stat.label} {...stat} />
            ))}
          </div>

          {nothingToExport ? (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Nenhum contato pode entrar no mailing com os filtros atuais.
            </p>
          ) : (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Primeiras linhas do arquivo
              </p>
              <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                {preview.kind === 'csv' ? <MailingSample mailing={preview.mailing} /> : <LeadsSample leads={leads} />}
              </div>
              {totalRows > SAMPLE_ROWS && (
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  + {(totalRows - SAMPLE_ROWS).toLocaleString('pt-BR')} linha(s) no arquivo completo.
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end dark:border-slate-800">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy || nothingToExport}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            {busy ? 'Gerando...' : 'Confirmar e Baixar'}
          </button>
        </footer>
      </div>
    </div>
  )
}
