import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import {
  BadgeCheck,
  BedDouble,
  Car,
  Check,
  CalendarDays,
  CircleAlert,
  FileText,
  LoaderCircle,
  MapPin,
  MonitorSpeaker,
  RefreshCw,
  User,
  UserPlus,
  UtensilsCrossed,
  X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'
import {
  NEW_CEREMONIALIST,
  STATUS_OPTIONS,
  buildInitialState,
  buildPayload,
  inputClassName,
  needsProposalNumber,
  translateDbError,
  validate,
  withCurrentValue,
  type FieldName,
  type FormErrors,
  type FormState,
} from '../lib/leadForm'
import { Field, MoneyInput, Section, YesNoToggle } from './LeadFormFields'
import {
  formatCNPJ,
  formatPhoneBR,
  isValidCNPJ,
  onlyDigits,
} from '../lib/format'
import { useSettingsOptions } from '../hooks/useSettingsOptions'
import { countEventDays, isCeremonialistOrigin } from '../lib/leadFields'
import { useCeremonialists, type Ceremonialist } from '../hooks/useCeremonialists'
import CeremonialistFormModal from './CeremonialistFormModal'
import ContactMergeDialog from './ContactMergeDialog'
import RecurringClientNotice from './RecurringClientNotice'
import { useConfirm } from '../hooks/useConfirm'
import {
  useKnownContacts,
  useRecurringClient,
  type ClientBranch,
  type KnownContactClient,
  type ClientLinkChoice,
  type RecurringClientMatch,
} from '../hooks/useRecurringClient'
import { isSameContactName } from '../lib/clientIdentity'
import { useCompanyOptions, type CompanyOption } from '../hooks/useCompanies'
import CompanyAutocomplete from './CompanyAutocomplete'
import { RateLimitError, guardMutation } from '../lib/rateLimit'
import {
  DEFAULT_LOSS_REASONS,
  LOSS_REASON_OTHER,
  type ClientContact,
  type Lead,
  type LeadInsert,
  type LeadStatus,
} from '../types/lead'

// =============================================================================
// Tipos públicos
// =============================================================================


type LeadFormModalProps = {
  open: boolean
  onClose: () => void
  /** Chamado após salvar com sucesso, com a linha retornada pelo banco. */
  onSaved?: (lead: Lead) => void
  /** Proposta nova já vinculada a este cliente (aberta pela página do cliente). */
  presetClient?: RecurringClientMatch | null
}

// =============================================================================
// Formulário (remontado a cada abertura, para sempre começar limpo)
// =============================================================================


type LeadFormProps = {
  onCancel: () => void
  onSaved?: (lead: Lead) => void
  /** Pede um formulário novo e vazio (usado em "Salvar e cadastrar outro"). */
  onRequestReset: () => void
  /** Informa ao modal se há alterações não salvas e se está salvando. */
  onStateChange: (state: { dirty: boolean; submitting: boolean }) => void
  presetClient: RecurringClientMatch | null
}

function LeadForm({ onCancel, onSaved, onRequestReset, onStateChange, presetClient }: LeadFormProps) {
  const initialState = useMemo(() => buildInitialState(null, presetClient), [presetClient])

  const [form, setForm] = useState<FormState>(initialState)
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  /** Salvando: trava os botões e o fechamento do modal. */
  const busy = submitting
  const submitIntentRef = useRef<'close' | 'new'>('close')

  const { options, loading: optionsLoading, error: optionsError, reload: reloadOptions } = useSettingsOptions()

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialState), [form, initialState])

  useEffect(() => {
    onStateChange({ dirty, submitting: busy })
  }, [dirty, busy, onStateChange])

  const originLabels = useMemo(
    () => withCurrentValue(options.origin.map((option) => option.label), form.origin),
    [options.origin, form.origin],
  )
  // Salas ativas + salas já marcadas no lead que tenham sido desativadas depois
  const roomLabels = useMemo(() => {
    const active = options.room.map((option) => option.label)
    const missing = form.room_interests.filter((room) => !active.includes(room))
    return [...missing, ...active]
  }, [options.room, form.room_interests])

  const toggleRoom = (room: string) => {
    if (errors.room_interests) setErrors((current) => ({ ...current, room_interests: undefined }))
    setForm((current) => ({
      ...current,
      room_interests: current.room_interests.includes(room)
        ? current.room_interests.filter((item) => item !== room)
        : [...current.room_interests, room],
    }))
    if (submitError) setSubmitError(null)
  }

  /** Liga/desliga um serviço extra; ao desligar, zera o valor; ao ligar, foca o campo de valor. */
  const toggleExtra = (kind: 'ab' | 'lodging' | 'equipment' | 'parking', enabled: boolean) => {
    setForm((current) => {
      const cents = `${kind}_cents` as const
      return { ...current, [`has_${kind}`]: enabled, [cents]: enabled ? current[cents] : null }
    })
    if (enabled) pendingFocusRef.current = `lead-${kind}_cents`
  }

  // Foca o campo de valor recém-exibido (depois que o React o desenhou)
  const pendingFocusRef = useRef<string | null>(null)
  useEffect(() => {
    if (!pendingFocusRef.current) return
    document.getElementById(pendingFocusRef.current)?.focus()
    pendingFocusRef.current = null
  }, [form.has_ab, form.has_lodging, form.has_equipment, form.has_parking])

  const eventDays = form.multi_day
    ? countEventDays({ event_date: form.event_date || null, event_end_date: form.event_end_date || null })
    : null
  // Empresas já cadastradas (cada braço com o CNPJ), sugeridas no campo Empresa
  const { options: companyOptions } = useCompanyOptions()

  /** Braço da empresa escolhido no cartão (marca com mais de um CNPJ). */
  const [preferredClientId, setPreferredClientId] = useState<string | undefined>(undefined)
  /** "+ Outro CNPJ / Novo braço": a proposta vira um cadastro novo da mesma marca. */
  const [newBranch, setNewBranch] = useState(false)

  // Telefone ou e-mail de um contato já cadastrado: preenche o contato e pergunta se mescla com a empresa dele.
  // Aberto pela página do cliente, a empresa já está decidida e não há pergunta.
  const askMerge = !presetClient
  const known = useKnownContacts({ phone: form.contact_phone, email: form.contact_email, enabled: true })
  const knownCompanies = useMemo(() => {
    const unique = new Map<string, KnownContactClient>()
    for (const item of known.contacts) {
      if (item.client.client_type === 'company') unique.set(item.client.id, item.client)
    }
    return [...unique.values()]
  }, [known.contacts])
  const mergeKey = knownCompanies.map((company) => company.id).sort().join(',')
  /** Resposta da pergunta de mesclar para cada grupo de empresas: a empresa escolhida, ou null para "Não". */
  const [mergeAnswers, setMergeAnswers] = useState<Record<string, string | null>>({})
  const mergeAnswer = mergeKey ? mergeAnswers[mergeKey] : undefined
  // Empresas recusadas (ou ainda sem resposta) não aparecem só pelo telefone, e-mail ou domínio
  const blockedClientIds = useMemo(() => {
    if (!askMerge) return []
    const blocked = new Set<string>()
    for (const [key, accepted] of Object.entries(mergeAnswers)) {
      for (const id of key.split(',')) if (id !== accepted) blocked.add(id)
    }
    if (mergeAnswer === undefined) knownCompanies.forEach((company) => blocked.add(company.id))
    if (mergeAnswer) blocked.delete(mergeAnswer)
    return [...blocked]
  }, [askMerge, mergeAnswers, mergeAnswer, knownCompanies])

  const [appliedKnownKey, setAppliedKnownKey] = useState('')
  if (!known.checking && known.key && known.key !== appliedKnownKey) {
    setAppliedKnownKey(known.key)
    const best = known.contacts.find((item) => item.byPhone) ?? known.contacts[0]
    if (best) {
      const { contact } = best
      setForm((current) => ({
        ...current,
        contact_name: current.contact_name.trim() ? current.contact_name : contact.name,
        contact_email: current.contact_email.trim() ? current.contact_email : (contact.email ?? ''),
        contact_phone: onlyDigits(current.contact_phone) ? current.contact_phone : contact.phone ? formatPhoneBR(contact.phone) : '',
      }))
      setErrors((current) => ({ ...current, contact_name: undefined, contact_email: undefined }))
    }
  }

  // No cadastro: reconhece cliente já cadastrado (CNPJ, telefone, e-mail, empresa ou domínio) e opt-out da LGPD
  const recurring = useRecurringClient({
    cnpj: form.cnpj,
    preferredClientId,
    phone: form.contact_phone,
    email: form.contact_email,
    company: form.company,
    enabled: true,
    blockedClientIds,
    // Sem resposta (ou com "Não"), os dados do contato não trazem empresa nenhuma sozinhos
    contactSignalsPending: askMerge && (known.checking || (mergeKey !== '' && !mergeAnswer)),
  })
  // Aberto pela página do cliente: o vínculo já está decidido
  const lockedClient = presetClient
  const clientMatch = lockedClient ?? recurring.match
  const [clientChoice, setClientChoice] = useState<ClientLinkChoice | null>(null)
  /** Sem escolha do vendedor para este cliente: "Sim" com o contato reconhecido (ou de mesmo nome). */
  const linkChoice: ClientLinkChoice | null = clientMatch
    ? newBranch && !lockedClient
      ? { clientId: clientMatch.client.id, link: false, contactId: null }
      : clientChoice?.clientId === clientMatch.client.id
      ? clientChoice
      : {
          clientId: clientMatch.client.id,
          link: true,
          contactId:
            clientMatch.matchedContactId ??
            clientMatch.contacts.find((contact) => isSameContactName(contact.name, form.contact_name))?.id ??
            null,
        }
    : null
  /** "Não adicionar": a proposta fica como pessoa física; Empresa e CNPJ ficam travados e não são salvos. */
  const personMode = Boolean(clientMatch && linkChoice && !linkChoice.link && !newBranch && !lockedClient)

  // Indicação de cerimonialista: proposta de pessoa física entra no histórico dela; com empresa, fica na empresa
  const showCeremonialist = isCeremonialistOrigin(form.origin)
  const ceremonialists = useCeremonialists(showCeremonialist)
  const [ceremonialistModal, setCeremonialistModal] = useState(false)
  const ceremonialistId = showCeremonialist && form.ceremonialist_id ? form.ceremonialist_id : null
  const companyLinked = Boolean(clientMatch?.client.client_type === 'company' && linkChoice?.link)
  const personProposal = personMode || (!companyLinked && !form.company.trim() && !isValidCNPJ(form.cnpj))
  const ceremonialistOwns = !lockedClient && Boolean(ceremonialistId) && personProposal
  const handleCeremonialistCreated = (created: Ceremonialist) => {
    ceremonialists.add(created)
    ceremonialists.reload()
    update('ceremonialist_id', created.id)
    setCeremonialistModal(false)
  }

  // A empresa do contato já é a do formulário (pelo CNPJ ou pela lista de empresas): não precisa perguntar
  const mergePending = askMerge && mergeKey !== '' && mergeAnswer === undefined && !known.checking && !recurring.checking
  const currentClientId = recurring.match?.client.id
  const alreadyMerged = Boolean(currentClientId && knownCompanies.some((company) => company.id === currentClientId))
  if (mergePending && alreadyMerged && currentClientId) {
    setMergeAnswers((current) => ({ ...current, [mergeKey]: currentClientId }))
  }
  const showMergeDialog = mergePending && !alreadyMerged

  /** "Sim": a proposta usa a Empresa e o CNPJ do cadastro e o contato desta empresa. */
  const handleMergeAnswer = useCallback(
    (clientId: string | null) => {
      setMergeAnswers((current) => ({ ...current, [mergeKey]: clientId }))
      const client = clientId ? knownCompanies.find((company) => company.id === clientId) : undefined
      if (!client) return
      const contact = known.contacts.find((item) => item.client.id === client.id)?.contact
      setNewBranch(false)
      setPreferredClientId(client.id)
      setClientChoice({ clientId: client.id, link: true, contactId: contact?.id ?? null })
      setForm((current) => ({
        ...current,
        company: client.name,
        cnpj: client.cnpj ? formatCNPJ(client.cnpj) : current.cnpj,
        contact_name: current.contact_name.trim() || !contact ? current.contact_name : contact.name,
        contact_email: current.contact_email.trim() || !contact?.email ? current.contact_email : contact.email,
      }))
      setErrors((current) => ({ ...current, cnpj: undefined }))
    },
    [mergeKey, knownCompanies, known.contacts],
  )

  /** "Sim": a proposta usa o nome e o CNPJ do cadastro (o vendedor vê o vínculo no formulário). */
  const handleLinkChange = (link: boolean) => {
    setNewBranch(false)
    if (linkChoice) setClientChoice({ ...linkChoice, link })
    if (link && clientMatch) {
      const { client } = clientMatch
      setForm((current) => ({
        ...current,
        company: client.client_type === 'company' ? client.name : current.company,
        cnpj: !onlyDigits(current.cnpj) && client.cnpj ? formatCNPJ(client.cnpj) : current.cnpj,
      }))
      setErrors((current) => ({ ...current, cnpj: undefined }))
    }
  }

  /** Empresa escolhida na lista de sugestões: já aponta o braço certo (e o CNPJ dele). */
  const handleSelectCompany = (option: CompanyOption) => {
    setNewBranch(false)
    setPreferredClientId(option.id ?? undefined)
    if (option.id) setClientChoice({ clientId: option.id, link: true, contactId: null })
    setForm((current) => ({
      ...current,
      company: option.name,
      cnpj: option.cnpj ? formatCNPJ(option.cnpj) : onlyDigits(current.cnpj) ? current.cnpj : '',
    }))
    setErrors((current) => ({ ...current, cnpj: undefined }))
    if (submitError) setSubmitError(null)
  }

  /** Braço existente: entra no histórico dele e o CNPJ vem do cadastro. */
  const handleSelectBranch = (branch: ClientBranch) => {
    setNewBranch(false)
    setPreferredClientId(branch.id)
    setClientChoice({ clientId: branch.id, link: true, contactId: null })
    setForm((current) => ({ ...current, cnpj: branch.cnpj ? formatCNPJ(branch.cnpj) : '' }))
    setErrors((current) => ({ ...current, cnpj: undefined }))
  }

  /** Novo braço: tira o CNPJ de um braço existente e pede o CNPJ da filial. */
  const handleNewBranch = () => {
    setNewBranch(true)
    setPreferredClientId(undefined)
    const branchCnpjs = (clientMatch?.branches ?? []).map((branch) => onlyDigits(branch.cnpj ?? ''))
    if (branchCnpjs.includes(onlyDigits(form.cnpj))) setForm((current) => ({ ...current, cnpj: '' }))
    document.getElementById('lead-cnpj')?.focus()
  }

  // CNPJ digitado: preenche a Empresa vazia com o nome do cadastro ou da Receita Federal.
  // Espera a consulta do CNPJ atual terminar (durante a consulta o cartão ainda mostra o cliente anterior)
  const cnpjSuggestion =
    !recurring.checking && isValidCNPJ(form.cnpj)
      ? clientMatch?.reasons.includes('cnpj')
        ? { name: clientMatch.client.name, city: null, source: 'cadastro' as const }
        : recurring.cnpjLookup
          ? { ...recurring.cnpjLookup, source: 'receita' as const }
          : null
      : null
  const suggestionKey = cnpjSuggestion ? `${onlyDigits(form.cnpj)}|${cnpjSuggestion.source}|${cnpjSuggestion.name}` : ''
  const [appliedSuggestion, setAppliedSuggestion] = useState('')
  const [companyAutofill, setCompanyAutofill] = useState<NonNullable<typeof cnpjSuggestion> | null>(null)
  if (suggestionKey && suggestionKey !== appliedSuggestion) {
    setAppliedSuggestion(suggestionKey)
    if (cnpjSuggestion && !form.company.trim()) {
      setForm((current) => ({ ...current, company: cnpjSuggestion.name }))
      setCompanyAutofill(cnpjSuggestion)
    }
  }
  const showAutofillNote = companyAutofill !== null && form.company === companyAutofill.name
  const cnpjDigitsTyped = onlyDigits(form.cnpj).length
  const cnpjLiveError = !personMode && cnpjDigitsTyped === 14 && !isValidCNPJ(form.cnpj) ? 'CNPJ inválido. Confira os dígitos.' : null

  /**
   * Contato existente preenche nome, telefone e e-mail. "Novo contato" limpa os dados do
   * contato que estava escolhido (o que foi digitado à mão continua).
   */
  const handleSelectContact = (contact: ClientContact | null) => {
    if (!linkChoice || !clientMatch) return
    const previous = clientMatch.contacts.find((item) => item.id === linkChoice.contactId)
    setClientChoice({ ...linkChoice, link: true, contactId: contact?.id ?? null })
    if (contact) {
      setForm((current) => ({
        ...current,
        contact_name: contact.name,
        contact_phone: contact.phone ? formatPhoneBR(contact.phone) : current.contact_phone,
        contact_email: contact.email ?? current.contact_email,
      }))
    } else if (previous) {
      setForm((current) => ({
        ...current,
        contact_name: isSameContactName(current.contact_name, previous.name) ? '' : current.contact_name,
        contact_phone:
          previous.phone && onlyDigits(current.contact_phone) === onlyDigits(previous.phone) ? '' : current.contact_phone,
        contact_email:
          previous.email && current.contact_email.trim().toLowerCase() === previous.email.toLowerCase() ? '' : current.contact_email,
      }))
      document.getElementById('lead-contact_name')?.focus()
    }
    setErrors((current) => ({ ...current, contact_name: undefined, contact_phone: undefined, contact_email: undefined }))
  }
  /** Contato já suprimido: o lead novo nasce com opt-out (o banco também garante isso). */
  const optOutForced = recurring.suppressed
  const optOutHint = optOutForced
    ? 'Marcado automaticamente: o contato está na lista de opt-out.'
    : form.marketing_opt_out && !initialState.marketing_opt_out
      ? 'Vale para todas as propostas com o mesmo e-mail ou telefone, inclusive as futuras, e continua valendo se esta proposta for excluída.'
      : null
  const lossReasonLabels = useMemo(() => {
    // Usa os motivos do Painel Admin; se não houver nenhum, cai nos motivos padrão
    const fromDb = options.loss_reason.map((option) => option.label)
    const base = fromDb.length > 0 ? fromDb : [...DEFAULT_LOSS_REASONS]
    // "Outros" sempre por último
    const sorted = [...base.filter((label) => label !== LOSS_REASON_OTHER), ...base.filter((label) => label === LOSS_REASON_OTHER)]
    return withCurrentValue(sorted, form.loss_reason)
  }, [options.loss_reason, form.loss_reason])

  const update = <K extends FieldName>(field: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }))
    }
    if (submitError) setSubmitError(null)
  }

  const handleStatusChange = (status: LeadStatus) => {
    setForm((current) => ({
      ...current,
      status,
      // Fechou: a proposta com certeza foi enviada
      proposal_sent: status === 'fechado' ? true : current.proposal_sent,
    }))
    setErrors((current) => ({
      ...current,
      proposal_number: undefined,
      loss_reason: undefined,
      loss_reason_details: undefined,
    }))
    setSubmitError(null)
  }

  const focusField = (field: FieldName) => {
    const element = document.getElementById(`lead-${field}`)
    if (element) {
      element.focus()
      element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    const validationErrors = validate(personMode ? { ...form, cnpj: '' } : form, {
      requireCore: true,
      hasRooms: roomLabels.length > 0,
    })
    const firstError = Object.keys(validationErrors)[0] as FieldName | undefined
    if (firstError) {
      setErrors(validationErrors)
      setSubmitError('Revise os campos destacados.')
      focusField(firstError)
      return
    }

    setSubmitting(true)
    setSubmitError(null)

    const selectedContact = clientMatch?.contacts.find((contact) => contact.id === linkChoice?.contactId)
    // Pessoa física: entra no cadastro de pessoa física de quem pediu, se já existir
    const individual =
      personMode && clientMatch?.client.client_type === 'company'
        ? known.contacts.find((item) => item.client.client_type === 'individual')
        : undefined
    const payload: LeadInsert = {
      ...buildPayload(form, optOutForced),
      ...(personMode
        ? {
            company: null,
            cnpj: null,
            ...(individual
              ? {
                  client_id: individual.client.id,
                  ...(isSameContactName(individual.contact.name, form.contact_name) ? { contact_id: individual.contact.id } : {}),
                }
              : {}),
          }
        : {}),
      // "Sim": vai para o histórico do cliente. Sem client_id o banco cria um cadastro próprio.
      ...(clientMatch && linkChoice?.link
        ? {
            client_id: clientMatch.client.id,
            // Empresa com o nome do cadastro (relatórios não separam "cremolatto" de "Cremolatto")
            ...(clientMatch.client.client_type === 'company' ? { company: clientMatch.client.name } : {}),
            // O contato escolhido só vale se o nome não foi trocado por outra pessoa depois
            ...(selectedContact && isSameContactName(selectedContact.name, form.contact_name)
              ? { contact_id: selectedContact.id }
              : {}),
          }
        : {}),
    }
    // Pessoa física indicada por cerimonialista: o histórico é o dela (o cliente vira contato dela)
    if (ceremonialistOwns && ceremonialistId) {
      payload.client_id = ceremonialistId
      payload.company = null
      payload.cnpj = null
      delete payload.contact_id
    }
    let response
    try {
      // Mesmo envio repetido em menos de 1,5 s (duplo clique, Enter segurado) é recusado
      response = await guardMutation(`lead:save:novo:${JSON.stringify(payload)}`, async () =>
        supabase.from('leads').insert(payload).select().single(),
      )
    } catch (guardError) {
      setSubmitting(false)
      if (guardError instanceof RateLimitError) setSubmitError(guardError.message)
      return
    }

    setSubmitting(false)

    if (response.error) {
      const translated = translateDbError(response.error)
      setSubmitError(translated.message)
      if (translated.field) {
        setErrors((current) => ({ ...current, [translated.field as FieldName]: translated.message }))
        focusField(translated.field)
      }
      return
    }

    onSaved?.(response.data)

    if (submitIntentRef.current === 'new') {
      onRequestReset()
    } else {
      onCancel()
    }
  }

  const showProposalNumber = needsProposalNumber(form)
  const isLost = form.status === 'perdido'
  const isOtherReason = form.loss_reason === LOSS_REASON_OTHER

  return (
    <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-8 overflow-y-auto px-5 py-6 sm:px-6">
        {optionsError && (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
            <span className="flex items-center gap-2">
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              {optionsError}
            </span>
            <button
              type="button"
              onClick={() => void reloadOptions()}
              className="inline-flex shrink-0 items-center gap-1 font-semibold hover:underline"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              Tentar de novo
            </button>
          </div>
        )}

        {/* 1. Dados do contato */}
        <Section icon={User} title="Contato">
          <Field label="Nome do contato" htmlFor="lead-contact_name" required error={errors.contact_name}>
            <input
              id="lead-contact_name"
              type="text"
              maxLength={150}
              autoFocus
              autoComplete="off"
              placeholder="Ex.: Nome do contato"
              value={form.contact_name}
              onChange={(event) => update('contact_name', event.target.value)}
              aria-invalid={Boolean(errors.contact_name)}
              aria-describedby={errors.contact_name ? 'lead-contact_name-error' : undefined}
              className={inputClassName(Boolean(errors.contact_name))}
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Telefone / WhatsApp" htmlFor="lead-contact_phone" error={errors.contact_phone}>
              <input
                id="lead-contact_phone"
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Ex.: (51) 99999-8888"
                value={form.contact_phone}
                onChange={(event) => update('contact_phone', formatPhoneBR(event.target.value))}
                aria-invalid={Boolean(errors.contact_phone)}
                aria-describedby={errors.contact_phone ? 'lead-contact_phone-error' : undefined}
                className={inputClassName(Boolean(errors.contact_phone))}
              />
            </Field>
            <Field label="E-mail" htmlFor="lead-contact_email" error={errors.contact_email}>
              <input
                id="lead-contact_email"
                type="email"
                maxLength={254}
                autoComplete="off"
                placeholder="Ex.: email@dominio.com.br"
                value={form.contact_email}
                onChange={(event) => update('contact_email', event.target.value)}
                aria-invalid={Boolean(errors.contact_email)}
                aria-describedby={errors.contact_email ? 'lead-contact_email-error' : undefined}
                className={inputClassName(Boolean(errors.contact_email))}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
          <Field
            label="CNPJ"
            htmlFor="lead-cnpj"
            error={errors.cnpj ?? cnpjLiveError ?? undefined}
            hint={
              personMode
                ? 'Não será salvo: proposta como pessoa física.'
                : linkChoice?.link && clientMatch?.client.cnpj && !onlyDigits(form.cnpj)
                  ? `Será usado o do cadastro: ${clientMatch.client.cnpj}`
                  : 'Opcional em sondagens.'
            }
          >
            <input
              id="lead-cnpj"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              placeholder="00.000.000/0000-00"
              value={form.cnpj}
              disabled={personMode}
              onChange={(event) => update('cnpj', formatCNPJ(event.target.value))}
              aria-invalid={Boolean(errors.cnpj ?? cnpjLiveError)}
              aria-describedby={errors.cnpj ?? cnpjLiveError ? 'lead-cnpj-error' : undefined}
              className={inputClassName(Boolean(errors.cnpj ?? cnpjLiveError))}
            />
          </Field>
          <Field
            label="Empresa"
            htmlFor="lead-company"
            hint={
              personMode
                ? 'Não será salva: proposta como pessoa física.'
                : showAutofillNote
                  ? undefined
                  : 'Deixe em branco se o cliente for pessoa física.'
            }
          >
            <CompanyAutocomplete
              id="lead-company"
              maxLength={120}
              placeholder="Ex.: Empresa / Organização"
              value={form.company}
              options={companyOptions}
              onChange={(value) => update('company', value)}
              onSelect={handleSelectCompany}
              disabled={personMode}
              className={inputClassName(false)}
            />
            {!personMode && showAutofillNote && companyAutofill && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <BadgeCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {companyAutofill.source === 'receita'
                  ? `Dados preenchidos via CNPJ (Receita Federal)${companyAutofill.city ? ` · ${companyAutofill.city}` : ''}`
                  : 'Preenchido pelo cadastro deste CNPJ'}
              </p>
            )}
          </Field>
          </div>

          {/* Só no cadastro: cliente já cadastrado (pergunta se entra no histórico) e opt-out da LGPD (não bloqueia) */}
          <RecurringClientNotice
              checking={recurring.checking}
              // Pessoa física indicada por cerimonialista: o cadastro de pessoa física dá lugar ao histórico dela
              match={ceremonialistOwns && clientMatch?.client.client_type === 'individual' ? null : clientMatch}
              suppressed={recurring.suppressed}
              choice={linkChoice}
              locked={Boolean(lockedClient)}
              onLinkChange={handleLinkChange}
              onSelectContact={handleSelectContact}
              onSelectBranch={handleSelectBranch}
              onNewBranch={handleNewBranch}
            />
          {showMergeDialog &&
            createPortal(
              <ContactMergeDialog contactName={form.contact_name.trim()} companies={knownCompanies} onAnswer={handleMergeAnswer} />,
              document.body,
            )}

          <div>
            <label
              className={cn(
                'flex w-fit items-start gap-2.5 text-sm text-slate-600 dark:text-slate-300',
                optOutForced ? 'cursor-not-allowed' : 'cursor-pointer',
              )}
            >
              <input
                type="checkbox"
                checked={form.marketing_opt_out || optOutForced}
                disabled={optOutForced}
                onChange={(event) => update('marketing_opt_out', event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
              />
              <span>
                Cliente solicitou não receber comunicações/mailing{' '}
                <span className="text-xs font-medium text-slate-400 dark:text-slate-500">(Opt-out LGPD)</span>
              </span>
            </label>
            {optOutHint && <p className="mt-1 pl-[1.625rem] text-xs text-slate-500 dark:text-slate-400">{optOutHint}</p>}
          </div>
        </Section>

        {/* 2. Origem e espaço */}
        <Section icon={MapPin} title="Origem e Espaço">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Meio de prospecção"
              htmlFor="lead-origin"
              hint={!optionsLoading && originLabels.length === 0 ? 'Nenhuma opção cadastrada. Configure no Painel Admin.' : undefined}
            >
              <select
                id="lead-origin"
                value={form.origin}
                onChange={(event) => update('origin', event.target.value)}
                disabled={optionsLoading}
                className={inputClassName(false)}
              >
                <option value="">{optionsLoading ? 'Carregando...' : 'Selecione'}</option>
                {originLabels.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {showCeremonialist && (
              <Field
                label="Cerimonialista"
                htmlFor="lead-ceremonialist_id"
                hint={
                  ceremonialists.error
                    ? 'Não foi possível carregar as cerimonialistas (rode a migração 016).'
                    : !ceremonialistId
                      ? 'Quem indicou esta proposta.'
                      : ceremonialistOwns
                        ? undefined
                        : lockedClient && lockedClient.client.client_type !== 'ceremonialist'
                          ? 'A proposta fica no cliente aberto e a indicação aparece no painel da cerimonialista.'
                          : 'Com empresa: a proposta fica na empresa e a indicação aparece no painel da cerimonialista.'
                }
              >
                <select
                  id="lead-ceremonialist_id"
                  value={form.ceremonialist_id}
                  onChange={(event) => {
                    if (event.target.value === NEW_CEREMONIALIST) setCeremonialistModal(true)
                    else update('ceremonialist_id', event.target.value)
                  }}
                  disabled={ceremonialists.loading && ceremonialists.items.length === 0}
                  className={inputClassName(false)}
                >
                  <option value="">{ceremonialists.loading && ceremonialists.items.length === 0 ? 'Carregando...' : 'Selecione a cerimonialista'}</option>
                  {ceremonialists.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                  {form.ceremonialist_id && !ceremonialists.items.some((item) => item.id === form.ceremonialist_id) && (
                    <option value={form.ceremonialist_id}>Cerimonialista cadastrada</option>
                  )}
                  <option value={NEW_CEREMONIALIST}>+ Nova cerimonialista</option>
                </select>
              </Field>
            )}
          </div>
          {ceremonialistModal &&
            createPortal(
              <CeremonialistFormModal onClose={() => setCeremonialistModal(false)} onCreated={handleCeremonialistCreated} />,
              document.body,
            )}

          {/* Salas: seleção múltipla com chips clicáveis */}
          <div
            id="lead-room_interests"
            tabIndex={-1}
            role="group"
            aria-labelledby="lead-rooms-label"
            aria-describedby={errors.room_interests ? 'lead-room_interests-error' : undefined}
            className="rounded-lg focus:outline-none"
          >
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
              <p id="lead-rooms-label" className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Salas/Salões de interesse
                {roomLabels.length > 0 && <span className="ml-0.5 text-red-500">*</span>}
              </p>
              {form.room_interests.length > 0 && (
                <span className="text-xs font-medium text-brand-700 dark:text-brand-300">
                  {form.room_interests.length} selecionada{form.room_interests.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {optionsLoading ? (
              <div className="flex flex-wrap gap-2" aria-hidden="true">
                {Array.from({ length: 3 }, (_, index) => (
                  <span key={index} className="h-9 w-32 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
                ))}
              </div>
            ) : roomLabels.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-slate-400">Nenhuma sala cadastrada. Configure no Painel Admin.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {roomLabels.map((room) => {
                  const checked = form.room_interests.includes(room)
                  return (
                    <button
                      key={room}
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => toggleRoom(room)}
                      className={cn(
                        'inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-slate-900',
                        checked
                          ? 'border-brand-600 bg-brand-600 text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-brand-700 dark:hover:bg-brand-900/30',
                      )}
                    >
                      <span
                        className={cn(
                          'flex h-4 w-4 items-center justify-center rounded border',
                          checked ? 'border-white bg-white text-brand-600' : 'border-slate-300 dark:border-slate-600',
                        )}
                        aria-hidden="true"
                      >
                        {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                      </span>
                      {room}
                    </button>
                  )
                })}
              </div>
            )}
            {errors.room_interests && (
              <p id="lead-room_interests-error" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                {errors.room_interests}
              </p>
            )}
          </div>
        </Section>

        {/* 3. Data e escopo */}
        <Section icon={CalendarDays} title="Data e Escopo">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <Field label="Nome do evento" htmlFor="lead-event_name" hint="Aparece na planilha de faturamento.">
              <input
                id="lead-event_name"
                type="text"
                maxLength={200}
                autoComplete="off"
                placeholder="Ex.: Reunião anual de vendas"
                value={form.event_name}
                onChange={(event) => update('event_name', event.target.value)}
                className={inputClassName(false)}
              />
            </Field>
            <Field label="PAX (nº de pessoas)" htmlFor="lead-pax">
              <input
                id="lead-pax"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                placeholder="Ex.: 80"
                value={form.pax}
                onChange={(event) => update('pax', onlyDigits(event.target.value).slice(0, 6))}
                className={cn(inputClassName(false), 'tabular-nums')}
              />
            </Field>
          </div>

          <label className="flex w-fit cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-200">
            <input
              type="checkbox"
              checked={form.no_date}
              onChange={(event) => update('no_date', event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600 dark:border-slate-600 dark:bg-slate-900"
            />
            Cliente ainda sem data definida
          </label>

          {form.no_date ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Previsão / Mês de interesse" htmlFor="lead-date_notes">
                <input
                  id="lead-date_notes"
                  type="text"
                  maxLength={80}
                  placeholder="Ex.: Mês/Ano previsto"
                  value={form.date_notes}
                  onChange={(event) => update('date_notes', event.target.value)}
                  className={inputClassName(false)}
                />
              </Field>
            </div>
          ) : (
            <div className="space-y-3">
              <div role="radiogroup" aria-label="Duração do evento" className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                {[
                  { value: false, label: 'Um dia' },
                  { value: true, label: 'Mais de um dia' },
                ].map((option) => {
                  const selected = form.multi_day === option.value
                  return (
                    <button
                      key={option.label}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => update('multi_day', option.value)}
                      className={cn(
                        'rounded-md px-3 py-1 text-sm font-semibold transition-colors',
                        selected
                          ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white'
                          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
                      )}
                    >
                      {option.label}
                    </button>
                  )
                })}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label={form.multi_day ? 'Data inicial' : 'Data de interesse'}
                  htmlFor="lead-event_date"
                  required
                  error={errors.event_date}
                >
                  <input
                    id="lead-event_date"
                    type="date"
                    value={form.event_date}
                    max={form.multi_day && form.event_end_date ? form.event_end_date : undefined}
                    onChange={(event) => update('event_date', event.target.value)}
                    aria-invalid={Boolean(errors.event_date)}
                    className={inputClassName(Boolean(errors.event_date))}
                  />
                </Field>
                {form.multi_day && (
                  <Field
                    label="Data final"
                    htmlFor="lead-event_end_date"
                    error={errors.event_end_date}
                    hint={eventDays && eventDays > 1 ? `${eventDays} dias de evento` : undefined}
                  >
                    <input
                      id="lead-event_end_date"
                      type="date"
                      value={form.event_end_date}
                      min={form.event_date || undefined}
                      onChange={(event) => update('event_end_date', event.target.value)}
                      aria-invalid={Boolean(errors.event_end_date)}
                      className={inputClassName(Boolean(errors.event_end_date))}
                    />
                  </Field>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Valor de Locação / Espaço (R$)" htmlFor="lead-value_cents" required error={errors.value_cents}>
              <MoneyInput
                id="lead-value_cents"
                cents={form.value_cents}
                invalid={Boolean(errors.value_cents)}
                onChange={(cents) => update('value_cents', cents)}
              />
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-start">
            <div className="space-y-2">
              <YesNoToggle
                id="lead-has_ab"
                label="Inclui A&B?"
                icon={UtensilsCrossed}
                value={form.has_ab}
                onChange={(value) => toggleExtra('ab', value)}
              />
              {form.has_ab && (
                <Field label="Valor de A&B (R$)" htmlFor="lead-ab_cents">
                  <MoneyInput id="lead-ab_cents" cents={form.ab_cents} onChange={(cents) => update('ab_cents', cents)} />
                </Field>
              )}
            </div>
            <div className="space-y-2">
              <YesNoToggle
                id="lead-has_lodging"
                label="Inclui Hospedagem?"
                icon={BedDouble}
                value={form.has_lodging}
                onChange={(value) => toggleExtra('lodging', value)}
              />
              {form.has_lodging && (
                <Field label="Valor de Hospedagem (R$)" htmlFor="lead-lodging_cents">
                  <MoneyInput
                    id="lead-lodging_cents"
                    cents={form.lodging_cents}
                    onChange={(cents) => update('lodging_cents', cents)}
                  />
                </Field>
              )}
            </div>
            <div className="space-y-2">
              <YesNoToggle
                id="lead-has_equipment"
                label="Inclui Equipamentos / Extras?"
                icon={MonitorSpeaker}
                value={form.has_equipment}
                onChange={(value) => toggleExtra('equipment', value)}
              />
              {form.has_equipment && (
                <Field label="Valor de Equipamentos (R$)" htmlFor="lead-equipment_cents">
                  <MoneyInput
                    id="lead-equipment_cents"
                    cents={form.equipment_cents}
                    onChange={(cents) => update('equipment_cents', cents)}
                  />
                </Field>
              )}
            </div>
            <div className="space-y-2">
              <YesNoToggle
                id="lead-has_parking"
                label="Inclui Estacionamento?"
                icon={Car}
                value={form.has_parking}
                onChange={(value) => toggleExtra('parking', value)}
              />
              {form.has_parking && (
                <Field label="Valor de Estacionamento (R$)" htmlFor="lead-parking_cents">
                  <MoneyInput
                    id="lead-parking_cents"
                    cents={form.parking_cents}
                    onChange={(cents) => update('parking_cents', cents)}
                  />
                </Field>
              )}
            </div>
          </div>

        </Section>

        {/* 4. Proposta e fechamento */}
        <Section icon={FileText} title="Proposta e Situação">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:items-start">
            <YesNoToggle
              id="lead-proposal_sent"
              label="Proposta formal enviada?"
              icon={FileText}
              stacked
              value={form.proposal_sent}
              onChange={(value) => update('proposal_sent', value)}
            />
            {showProposalNumber && (
              <Field
                label="Número da proposta"
                htmlFor="lead-proposal_number"
                required={form.status === 'fechado'}
                error={errors.proposal_number}
              >
                <input
                  id="lead-proposal_number"
                  type="text"
                  maxLength={50}
                  autoComplete="off"
                  placeholder="Ex.: Número da proposta"
                  value={form.proposal_number}
                  onChange={(event) => update('proposal_number', event.target.value)}
                  aria-invalid={Boolean(errors.proposal_number)}
                  aria-describedby={errors.proposal_number ? 'lead-proposal_number-error' : undefined}
                  className={inputClassName(Boolean(errors.proposal_number))}
                />
              </Field>
            )}
          </div>

          <div>
            <p id="lead-status-label" className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
              Situação atual
            </p>
            <div role="radiogroup" aria-labelledby="lead-status-label" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {STATUS_OPTIONS.map(({ value, title, subtitle, icon: Icon, selectedClassName, iconClassName }) => {
                const selected = form.status === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => handleStatusChange(value)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border px-3 py-3 text-left transition-all',
                      selected
                        ? selectedClassName
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-slate-600 dark:hover:bg-slate-900',
                    )}
                  >
                    <Icon className={cn('h-5 w-5 shrink-0', selected ? iconClassName : 'text-slate-400')} aria-hidden="true" />
                    <span className="leading-tight">
                      <span className="block text-sm font-semibold text-slate-900 dark:text-white">{title}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">{subtitle}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {isLost && (
            <div className="space-y-4 rounded-lg border border-red-200 bg-red-50/50 p-4 dark:border-red-900/50 dark:bg-red-950/20">
              <Field label="Por qual motivo?" htmlFor="lead-loss_reason" required error={errors.loss_reason}>
                <select
                  id="lead-loss_reason"
                  value={form.loss_reason}
                  onChange={(event) => update('loss_reason', event.target.value)}
                  disabled={optionsLoading}
                  aria-invalid={Boolean(errors.loss_reason)}
                  aria-describedby={errors.loss_reason ? 'lead-loss_reason-error' : undefined}
                  className={inputClassName(Boolean(errors.loss_reason))}
                >
                  <option value="">{optionsLoading ? 'Carregando...' : 'Selecione o motivo'}</option>
                  {lossReasonLabels.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>

              {isOtherReason || form.show_loss_details ? (
                <Field
                  label={isOtherReason ? 'Descreva o motivo' : 'Detalhes (opcional)'}
                  htmlFor="lead-loss_reason_details"
                  required={isOtherReason}
                  error={errors.loss_reason_details}
                >
                  <textarea
                    id="lead-loss_reason_details"
                    rows={3}
                    maxLength={2000}
                    placeholder="Descreva o motivo da perda"
                    value={form.loss_reason_details}
                    onChange={(event) => update('loss_reason_details', event.target.value)}
                    aria-invalid={Boolean(errors.loss_reason_details)}
                    aria-describedby={errors.loss_reason_details ? 'lead-loss_reason_details-error' : undefined}
                    className={cn(inputClassName(Boolean(errors.loss_reason_details)), 'resize-y')}
                  />
                </Field>
              ) : (
                <button
                  type="button"
                  onClick={() => update('show_loss_details', true)}
                  className="text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
                >
                  + Adicionar detalhes
                </button>
              )}
            </div>
          )}
        </Section>
      </div>

      {/* Rodapé fixo com ações */}
      <footer className="border-t border-slate-200 bg-white px-5 py-4 sm:px-6 dark:border-slate-800 dark:bg-slate-900">
        {submitError && (
          <div
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{submitError}</span>
          </div>
        )}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="hidden sm:block" aria-hidden="true" />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            onClick={() => {
              submitIntentRef.current = 'new'
            }}
            className="rounded-lg border border-brand-200 px-4 py-2.5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:opacity-60 dark:border-brand-800 dark:text-brand-300 dark:hover:bg-brand-900/30"
          >
            Salvar e cadastrar outro
          </button>
          <button
            type="submit"
            disabled={busy}
            onClick={() => {
              submitIntentRef.current = 'close'
            }}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {submitting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitting ? 'Salvando...' : 'Cadastrar proposta'}
          </button>
          </div>
        </div>
      </footer>
    </form>
  )
}

// =============================================================================
// Modal (painel lateral)
// =============================================================================

export default function LeadFormModal({ open, onClose, onSaved, presetClient = null }: LeadFormModalProps) {
  // A cada abertura, gera uma nova chave para remontar o formulário limpo
  const [sessionKey, setSessionKey] = useState(open ? 1 : 0)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setSessionKey((current) => current + 1)
  }

  const formStateRef = useRef({ dirty: false, submitting: false })
  const handleFormStateChange = useCallback((state: { dirty: boolean; submitting: boolean }) => {
    formStateRef.current = state
  }, [])

  const confirm = useConfirm()
  const requestClose = useCallback(async () => {
    if (formStateRef.current.submitting) return
    if (formStateRef.current.dirty) {
      const discard = await confirm({
        title: 'Descartar as informações preenchidas?',
        description: 'O que você digitou nesta proposta ainda não foi salvo.',
        confirmLabel: 'Descartar',
        cancelLabel: 'Continuar editando',
        tone: 'warning',
      })
      if (!discard) return
    }
    onClose()
  }, [onClose, confirm])

  // ESC fecha e a página de fundo não rola enquanto o modal está aberto
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose()
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, requestClose])

  return (
    <div
      className={cn('fixed inset-0 z-50', open ? 'pointer-events-auto' : 'pointer-events-none')}
      aria-hidden={!open}
      inert={!open}
    >
      <div
        onClick={requestClose}
        className={cn(
          'absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0',
        )}
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-form-title"
        className={cn(
          'absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ease-out',
          'border-l border-slate-200 dark:border-slate-800 dark:bg-slate-900',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
              <UserPlus className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id="lead-form-title" className="text-lg font-semibold text-slate-900 dark:text-white">
                Nova Proposta
              </h2>
              {presetClient && (
                <p className="truncate text-sm text-slate-500 dark:text-slate-400">Para {presetClient.client.name}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Fechar"
            className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </header>

        {sessionKey > 0 && (
          <LeadForm
            key={`${sessionKey}-${presetClient?.client.id ?? ''}`}
            presetClient={presetClient}
            onCancel={onClose}
            onSaved={onSaved}
            onRequestReset={() => setSessionKey((current) => current + 1)}
            onStateChange={handleFormStateChange}
          />
        )}
      </aside>
    </div>
  )
}
