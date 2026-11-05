import { useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { RateLimitError, guardMutation } from '../lib/rateLimit'
import { buildInitialState, buildPayload, translateDbError, validate, type FieldName, type FormErrors, type FormState } from '../lib/leadForm'
import type { Lead, LeadInsert, LeadStatus } from '../types/lead'

/** Cards da página da proposta que editam a proposta direto, cada um com o seu rascunho. */
export type LeadSection = 'contact' | 'event' | 'proposal'

const SECTION_FIELDS: Record<LeadSection, FieldName[]> = {
  contact: ['contact_name', 'contact_phone', 'contact_email', 'company', 'cnpj', 'marketing_opt_out', 'origin', 'ceremonialist_id'],
  event: ['event_name', 'pax', 'room_interests', 'no_date', 'event_date', 'multi_day', 'event_end_date', 'date_notes'],
  proposal: [
    'value_cents',
    'has_ab',
    'ab_cents',
    'has_lodging',
    'lodging_cents',
    'has_equipment',
    'equipment_cents',
    'has_parking',
    'parking_cents',
    'proposal_sent',
    'proposal_number',
    'status',
    'loss_reason',
    'loss_reason_details',
    'show_loss_details',
  ],
}

/** Colunas que cada card grava: salvar um card não leva junto o que está pendente em outro. */
const SECTION_COLUMNS: Record<LeadSection, Array<keyof LeadInsert>> = {
  contact: ['contact_name', 'contact_phone', 'contact_email', 'company', 'cnpj', 'marketing_opt_out', 'origin', 'ceremonialist_id'],
  event: ['event_name', 'pax', 'room_interests', 'is_date_flexible', 'event_date', 'event_end_date', 'date_notes'],
  proposal: [
    'proposed_value',
    'has_ab',
    'ab_value',
    'has_lodging',
    'lodging_value',
    'has_equipment',
    'equipment_value',
    'has_parking',
    'parking_value',
    'proposal_sent',
    'proposal_number',
    'status',
    'loss_reason',
    'loss_reason_details',
  ],
}

/** Troca a situação como no formulário: Fechou implica proposta enviada. */
export function withStatus(state: FormState, status: LeadStatus): FormState {
  return { ...state, status, proposal_sent: status === 'fechado' ? true : state.proposal_sent }
}

type Options = {
  /** Há salas cadastradas (a validação de salas depende disso). */
  hasRooms: boolean
  /** Situação já escolhida ao abrir a página (botões Fechou/Perdeu das listas). */
  initialStatus?: LeadStatus
  onSaved: (lead: Lead) => void
}

/**
 * Rascunho de um card da proposta: começa com os dados salvos, acompanha a proposta quando
 * ela muda por fora (se não houver alteração pendente) e grava só as colunas do card.
 */
export function useLeadSectionDraft(lead: Lead, section: LeadSection, { hasRooms, initialStatus, onSaved }: Options) {
  const external = useMemo(() => buildInitialState(lead), [lead])
  const fields = SECTION_FIELDS[section]
  const keyOf = (state: FormState) => JSON.stringify(fields.map((field) => state[field]))
  const externalKey = keyOf(external)

  const [draft, setDraft] = useState<FormState>(() => (initialStatus ? withStatus(external, initialStatus) : external))
  const [syncedKey, setSyncedKey] = useState(externalKey)
  const [errors, setErrors] = useState<FormErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Proposta salva por outro card ou recarregada: acompanha se este card não tiver alteração
  if (externalKey !== syncedKey) {
    setSyncedKey(externalKey)
    if (keyOf(draft) === syncedKey) setDraft(external)
  }

  const dirty = keyOf(draft) !== externalKey

  const update = <K extends FieldName>(field: K, value: FormState[K]) => {
    setDraft((current) => ({ ...current, [field]: value }))
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }))
    setSaveError(null)
  }

  const change = (next: (current: FormState) => FormState, clear: FieldName[] = []) => {
    setDraft(next)
    if (clear.length > 0) setErrors((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !clear.includes(key as FieldName))))
    setSaveError(null)
  }

  const discard = () => {
    setDraft(external)
    setErrors({})
    setSaveError(null)
  }

  const focusField = (field: FieldName) => {
    const element = document.getElementById(`lead-${field}`)
    element?.focus()
    element?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  /** Valida o card e grava; retorna true quando salvou. */
  const save = async (): Promise<boolean> => {
    if (saving) return false
    const all = validate(draft, { requireCore: false, hasRooms })
    const sectionErrors: FormErrors = Object.fromEntries(Object.entries(all).filter(([key]) => fields.includes(key as FieldName)))
    const first = Object.keys(sectionErrors)[0] as FieldName | undefined
    if (first) {
      setErrors(sectionErrors)
      setSaveError('Revise os campos destacados.')
      focusField(first)
      return false
    }

    const full = buildPayload(draft)
    const payload = Object.fromEntries(SECTION_COLUMNS[section].map((column) => [column, full[column]])) as Partial<LeadInsert>

    setSaving(true)
    setSaveError(null)
    try {
      // Mesmo envio repetido em menos de 1,5 s (duplo clique) é recusado
      const { data, error } = await guardMutation(`lead:${section}:${lead.id}:${JSON.stringify(payload)}`, async () =>
        supabase.from('leads').update(payload).eq('id', lead.id).select().single(),
      )
      if (error || !data) {
        const translated = error ? translateDbError(error) : { message: 'Não foi possível salvar. Tente novamente.' }
        setSaveError(translated.message)
        const field = 'field' in translated ? translated.field : undefined
        if (field) {
          setErrors((current) => ({ ...current, [field]: translated.message }))
          focusField(field)
        }
        return false
      }
      // Volta ao formato salvo (telefone, CNPJ e espaços normalizados), para não ficar "alterado"
      setDraft(buildInitialState(data))
      onSaved(data)
      setErrors({})
      return true
    } catch (caught) {
      setSaveError(caught instanceof RateLimitError ? caught.message : 'Não foi possível salvar. Tente novamente.')
      return false
    } finally {
      setSaving(false)
    }
  }

  return { draft, update, change, errors, saveError, saving, dirty, save, discard }
}

export type LeadSectionDraft = ReturnType<typeof useLeadSectionDraft>
