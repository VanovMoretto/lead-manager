import { useEffect, useState, type FormEvent } from 'react'
import { CircleAlert, LoaderCircle, UserPen, UserPlus, X } from 'lucide-react'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { formatPhoneBR, isValidEmail, isValidPhoneBR, onlyDigits } from '../lib/format'
import { RateLimitError, guardMutation } from '../lib/rateLimit'
import { cn } from '../lib/utils'
import type { ClientContact } from '../types/lead'

type ContactFormModalProps = {
  clientId: string
  /** Contato a editar; null cadastra uma pessoa nova. */
  contact: ClientContact | null
  /** Primeira pessoa do cliente já nasce como principal. */
  isFirstContact: boolean
  onClose: () => void
  onSaved: (contact: ClientContact) => void
}

type FormState = { name: string; role: string; phone: string; email: string; is_primary: boolean; active: boolean }
type FormErrors = Partial<Record<'name' | 'phone' | 'email', string>>

const inputClassName = (hasError: boolean) =>
  cn(
    'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400',
    'focus:outline-none focus:ring-2 dark:bg-slate-950 dark:text-white',
    hasError
      ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
      : 'border-slate-200 focus:border-brand-600 focus:ring-brand-600/20 dark:border-slate-700',
  )

function translateContactError(error: PostgrestError): string {
  if (error.message.includes('client_contacts_name_not_blank')) return 'Informe o nome da pessoa.'
  if (error.message.includes('client_contacts_text_lengths')) return 'Algum campo passou do tamanho máximo permitido.'
  if (error.code === '23505') return 'Este cliente já tem um contato principal. Tente salvar de novo.'
  if (error.code === '42501') return 'Você não tem permissão para alterar contatos. Faça login novamente.'
  if (error.message.toLowerCase().includes('failed to fetch')) return 'Sem conexão com o servidor. O contato não foi salvo.'
  return 'Não foi possível salvar o contato. Tente novamente.'
}

const CONTACT_COLUMNS = 'id, client_id, name, role, phone, phone_digits, email, is_primary, active, created_at'

/** Cadastro e edição de uma pessoa de contato do cliente. */
export default function ContactFormModal({ clientId, contact, isFirstContact, onClose, onSaved }: ContactFormModalProps) {
  const [form, setForm] = useState<FormState>({
    name: contact?.name ?? '',
    role: contact?.role ?? '',
    phone: contact?.phone ? formatPhoneBR(contact.phone) : '',
    email: contact?.email ?? '',
    is_primary: contact?.is_primary ?? isFirstContact,
    active: contact?.active ?? true,
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, saving])

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (field in errors) setErrors((current) => ({ ...current, [field]: undefined }))
    setSubmitError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return

    const nextErrors: FormErrors = {}
    if (!form.name.trim()) nextErrors.name = 'Informe o nome da pessoa.'
    if (onlyDigits(form.phone).length > 0 && !isValidPhoneBR(form.phone)) nextErrors.phone = 'Telefone incompleto. Use DDD + número.'
    if (form.email.trim() && !isValidEmail(form.email)) nextErrors.email = 'E-mail inválido.'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    const phoneDigits = onlyDigits(form.phone)
    const payload = {
      name: form.name.trim().replace(/\s+/g, ' '),
      role: form.role.trim() || null,
      phone: phoneDigits ? formatPhoneBR(phoneDigits) : null,
      email: form.email.trim() ? form.email.trim().toLowerCase() : null,
      // Contato inativo deixa de ser o principal
      is_primary: form.is_primary && form.active,
      active: form.active,
    }

    setSaving(true)
    setSubmitError(null)
    try {
      const saved = await guardMutation(`contact:${contact?.id ?? `novo:${clientId}`}:${JSON.stringify(payload)}`, async () => {
        // Só um principal por cliente: tira a marca do anterior antes de marcar este
        if (payload.is_primary && !contact?.is_primary) {
          const { error } = await supabase
            .from('client_contacts')
            .update({ is_primary: false })
            .eq('client_id', clientId)
            .eq('is_primary', true)
          if (error) return { data: null, error }
        }
        return contact
          ? supabase.from('client_contacts').update(payload).eq('id', contact.id).select(CONTACT_COLUMNS).single()
          : supabase
              .from('client_contacts')
              .insert({ ...payload, client_id: clientId })
              .select(CONTACT_COLUMNS)
              .single()
      })
      if (saved.error || !saved.data) {
        setSubmitError(saved.error ? translateContactError(saved.error) : 'Não foi possível salvar o contato.')
        return
      }
      onSaved(saved.data)
    } catch (error) {
      setSubmitError(error instanceof RateLimitError ? error.message : 'Não foi possível salvar o contato. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  const Icon = contact ? UserPen : UserPlus

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => !saving && onClose()} />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="contact-form-title"
        onSubmit={handleSubmit}
        noValidate
        className="relative w-full max-w-lg rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
            <h2 id="contact-form-title" className="text-base font-semibold text-slate-900 dark:text-white">
              {contact ? 'Editar pessoa de contato' : 'Adicionar pessoa de contato'}
            </h2>
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

        <div className="space-y-4 px-5 py-5">
          <div>
            <label htmlFor="contact-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Nome <span className="text-red-500">*</span>
            </label>
            <input
              id="contact-name"
              type="text"
              autoFocus
              autoComplete="off"
              maxLength={150}
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              aria-invalid={Boolean(errors.name)}
              className={inputClassName(Boolean(errors.name))}
            />
            {errors.name && <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="contact-role" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Cargo / Setor
            </label>
            <input
              id="contact-role"
              type="text"
              autoComplete="off"
              maxLength={100}
              placeholder="Ex.: Marketing, RH, Diretoria"
              value={form.role}
              onChange={(event) => update('role', event.target.value)}
              className={inputClassName(false)}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="contact-phone" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Telefone / WhatsApp
              </label>
              <input
                id="contact-phone"
                type="tel"
                inputMode="numeric"
                autoComplete="off"
                placeholder="Ex.: (51) 99999-8888"
                value={form.phone}
                onChange={(event) => update('phone', formatPhoneBR(event.target.value))}
                aria-invalid={Boolean(errors.phone)}
                className={inputClassName(Boolean(errors.phone))}
              />
              {errors.phone && <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{errors.phone}</p>}
            </div>
            <div>
              <label htmlFor="contact-email" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                E-mail
              </label>
              <input
                id="contact-email"
                type="email"
                autoComplete="off"
                maxLength={254}
                value={form.email}
                onChange={(event) => update('email', event.target.value)}
                aria-invalid={Boolean(errors.email)}
                className={inputClassName(Boolean(errors.email))}
              />
              {errors.email && <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{errors.email}</p>}
            </div>
          </div>
          <div className="space-y-2.5 rounded-lg bg-slate-50 px-3 py-3 dark:bg-slate-950/50">
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={form.is_primary && form.active}
                disabled={!form.active}
                onChange={(event) => update('is_primary', event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900"
              />
              <span>
                Contato principal
                <span className="block text-xs text-slate-500 dark:text-slate-400">Aparece primeiro na lista de leads e nas propostas novas.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-700 dark:text-slate-200">
              <input
                type="checkbox"
                checked={!form.active}
                onChange={(event) => update('active', !event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600 dark:border-slate-600 dark:bg-slate-900"
              />
              <span>
                Inativo / saiu da empresa
                <span className="block text-xs text-slate-500 dark:text-slate-400">Continua no histórico, mas não é sugerido em propostas novas.</span>
              </span>
            </label>
          </div>

          {submitError && (
            <p role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              {submitError}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {contact ? 'Salvar alterações' : 'Adicionar contato'}
          </button>
        </footer>
      </form>
    </div>
  )
}
