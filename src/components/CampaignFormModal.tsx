import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CircleAlert, Download, LoaderCircle, Megaphone, Users, X } from 'lucide-react'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { RateLimitError, guardMutation } from '../lib/rateLimit'
import { buildCampaignAudience, formatRate, type SuppressionRow } from '../lib/mailingHub'
import { cn } from '../lib/utils'
import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_SEGMENTS,
  CAMPAIGN_SEGMENT_LABELS,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABELS,
  type CampaignChannel,
  type CampaignSegment,
  type CampaignStatus,
  type Lead,
  type MailingCampaign,
  type MailingCampaignInsert,
} from '../types/lead'

type CampaignFormModalProps = {
  /** Campanha existente (edição e contadores); sem ela, nova campanha. */
  campaign: MailingCampaign | null
  leads: Lead[]
  suppressions: SuppressionRow[]
  /** Lista de opt-out carregada: sem ela, o público não é calculado nem exportado (LGPD). */
  suppressionsReady: boolean
  onClose: () => void
  onSaved: (campaign: MailingCampaign) => void
  onExport: (segment: CampaignSegment, channel: CampaignChannel, name: string) => void
}

type Counters = { sent: string; delivered: string; opened: string; clicked: string }

const inputClassName =
  'block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 dark:border-slate-700 dark:bg-slate-950 dark:text-white'

const labelClassName = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400'

function toCount(value: string): number | null {
  if (value.trim() === '') return 0
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 && number <= 10_000_000 ? number : null
}

function translateError(error: PostgrestError): string {
  if (error.code === '23514') return 'Os números não fecham: entregues ≤ enviados, abertos ≤ entregues e cliques ≤ abertos.'
  if (error.code === '42501') return 'Você não tem permissão para salvar campanhas.'
  if (error.code === '42P01' || error.code === 'PGRST205') return 'O banco está desatualizado. Rode a migração 017 no SQL Editor do Supabase.'
  return 'Não foi possível salvar a campanha. Tente novamente.'
}

/** Nova campanha de mailing ou atualização dos contadores de retorno de uma campanha. */
export default function CampaignFormModal({
  campaign,
  leads,
  suppressions,
  suppressionsReady,
  onClose,
  onSaved,
  onExport,
}: CampaignFormModalProps) {
  const isEdit = campaign !== null
  const [name, setName] = useState(campaign?.name ?? '')
  const [channel, setChannel] = useState<CampaignChannel>(campaign?.channel ?? 'email')
  const [segment, setSegment] = useState<CampaignSegment>(campaign?.segment_filter ?? 'all')
  const [status, setStatus] = useState<CampaignStatus>(campaign?.status ?? 'rascunho')
  const [notes, setNotes] = useState(campaign?.notes ?? '')
  const [counters, setCounters] = useState<Counters>({
    sent: String(campaign?.sent_count ?? ''),
    delivered: String(campaign?.delivered_count ?? ''),
    opened: String(campaign?.opened_count ?? ''),
    clicked: String(campaign?.clicked_count ?? ''),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, saving])

  const audience = useMemo(
    () => (suppressionsReady ? buildCampaignAudience(leads, suppressions, segment, channel).contacts.length : null),
    [leads, suppressions, suppressionsReady, segment, channel],
  )

  const parsed = {
    sent: toCount(counters.sent),
    delivered: toCount(counters.delivered),
    opened: toCount(counters.opened),
    clicked: toCount(counters.clicked),
  }
  const funnelError =
    Object.values(parsed).some((value) => value === null)
      ? 'Use números inteiros, sem pontos nem vírgulas.'
      : parsed.delivered! > parsed.sent!
        ? 'Entregues não pode passar dos enviados.'
        : parsed.opened! > parsed.delivered!
          ? 'Abertos não pode passar dos entregues.'
          : parsed.clicked! > parsed.opened!
            ? 'Cliques/respostas não pode passar dos abertos.'
            : null

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const trimmed = name.trim().replace(/\s+/g, ' ')
    if (!trimmed) {
      setError('Informe o nome da campanha.')
      return
    }
    if (trimmed.length > 150) {
      setError('O nome pode ter até 150 caracteres.')
      return
    }
    if (funnelError) {
      setError(funnelError)
      return
    }

    const payload: MailingCampaignInsert = {
      name: trimmed,
      channel,
      segment_filter: segment,
      status,
      notes: notes.trim() || null,
      sent_count: parsed.sent!,
      delivered_count: parsed.delivered!,
      opened_count: parsed.opened!,
      clicked_count: parsed.clicked!,
    }
    // O público fica registrado como estava ao montar a campanha (ou ao trocar o segmento/canal)
    if (audience !== null && (!isEdit || segment !== campaign.segment_filter || channel !== campaign.channel)) {
      payload.audience_count = audience
    }

    setSaving(true)
    try {
      const { data, error: dbError } = await guardMutation(`campaign:${campaign?.id ?? 'new'}:${JSON.stringify(payload)}`, async () =>
        isEdit
          ? supabase.from('mailing_campaigns').update(payload).eq('id', campaign.id).select('*').single()
          : supabase.from('mailing_campaigns').insert(payload).select('*').single(),
      )
      if (dbError || !data) {
        setError(dbError ? translateError(dbError) : 'Não foi possível salvar a campanha. Tente novamente.')
        return
      }
      onSaved(data)
    } catch (caught) {
      setError(caught instanceof RateLimitError ? caught.message : 'Não foi possível salvar a campanha. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  const counterField = (key: keyof Counters, label: string, hint: string) => (
    <div>
      <label htmlFor={`campaign-${key}`} className={labelClassName}>
        {label}
      </label>
      <input
        id={`campaign-${key}`}
        inputMode="numeric"
        value={counters[key]}
        onChange={(event) => setCounters((current) => ({ ...current, [key]: event.target.value.replace(/\D/g, '') }))}
        placeholder="0"
        className={cn(inputClassName, 'tabular-nums')}
      />
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => !saving && onClose()} aria-hidden="true" />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="campaign-form-title"
        onSubmit={handleSubmit}
        noValidate
        className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
              <Megaphone className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="campaign-form-title" className="text-base font-semibold text-slate-900 dark:text-white">
                {isEdit ? 'Campanha de mailing' : 'Nova campanha de mailing'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isEdit ? 'Atualize os números de retorno à medida que chegarem.' : 'Escolha o público, exporte a lista e registre o envio.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fechar"
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div>
            <label htmlFor="campaign-name" className={labelClassName}>
              Nome da campanha <span className="text-red-500">*</span>
            </label>
            <input
              id="campaign-name"
              value={name}
              maxLength={150}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Campanha Eventos Corporativos Q4"
              className={inputClassName}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="campaign-channel" className={labelClassName}>
                Canal
              </label>
              <select id="campaign-channel" value={channel} onChange={(event) => setChannel(event.target.value as CampaignChannel)} className={inputClassName}>
                {CAMPAIGN_CHANNELS.map((value) => (
                  <option key={value} value={value}>
                    {CAMPAIGN_CHANNEL_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="campaign-segment" className={labelClassName}>
                Segmento da base
              </label>
              <select id="campaign-segment" value={segment} onChange={(event) => setSegment(event.target.value as CampaignSegment)} className={inputClassName}>
                {CAMPAIGN_SEGMENTS.map((value) => (
                  <option key={value} value={value}>
                    {CAMPAIGN_SEGMENT_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50/60 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-brand-900/60 dark:bg-brand-950/20">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 shrink-0 text-brand-700 dark:text-brand-300" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">
                  {audience === null ? 'Público indisponível' : `${audience.toLocaleString('pt-BR')} contato(s) único(s) elegível(is)`}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {audience === null
                    ? 'A lista de opt-out (LGPD) não carregou: o público não é calculado.'
                    : `Sem opt-out LGPD e com ${channel === 'email' ? 'e-mail válido' : channel === 'whatsapp' ? 'WhatsApp válido' : 'e-mail ou WhatsApp'}.`}
                  {isEdit && ` Registrado na campanha: ${campaign.audience_count.toLocaleString('pt-BR')}.`}
                </p>
              </div>
            </div>
            <button
              type="button"
              disabled={audience === null || audience === 0}
              onClick={() => onExport(segment, channel, name.trim() || 'Campanha')}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-brand-300 bg-white px-3 py-2 text-sm font-semibold text-brand-700 shadow-sm transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-brand-800 dark:bg-slate-900 dark:text-brand-300 dark:hover:bg-slate-800"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Exportar CSV
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label htmlFor="campaign-status" className={labelClassName}>
                Situação
              </label>
              <select id="campaign-status" value={status} onChange={(event) => setStatus(event.target.value as CampaignStatus)} className={inputClassName}>
                {CAMPAIGN_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {CAMPAIGN_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="campaign-notes" className={labelClassName}>
                Observações
              </label>
              <input
                id="campaign-notes"
                value={notes}
                maxLength={2000}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Assunto, oferta, ferramenta de envio..."
                className={inputClassName}
              />
            </div>
          </div>

          <fieldset className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <legend className="px-1 text-sm font-semibold text-slate-900 dark:text-white">Números de retorno</legend>
            <div className="grid gap-4 sm:grid-cols-4">
              {counterField('sent', 'Enviados', 'Total disparado')}
              {counterField('delivered', 'Entregues', `Entrega ${formatRate(parsed.delivered ?? 0, parsed.sent ?? 0)}`)}
              {counterField('opened', 'Abertos', `Abertura ${formatRate(parsed.opened ?? 0, parsed.delivered ?? 0)}`)}
              {counterField('clicked', 'Cliques/respostas', `Conversão ${formatRate(parsed.clicked ?? 0, parsed.opened ?? 0)}`)}
            </div>
            {funnelError && <p className="mt-3 text-xs font-medium text-red-600 dark:text-red-400">{funnelError}</p>}
          </fieldset>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {error}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isEdit ? 'Salvar números' : 'Criar campanha'}
          </button>
        </footer>
      </form>
    </div>
  )
}
