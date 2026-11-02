import { useEffect, useState, type FormEvent } from 'react'
import { CircleAlert, LoaderCircle, Sparkles, X } from 'lucide-react'
import type { PostgrestError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { formatPhoneBR, isValidEmail, isValidPhoneBR, onlyDigits } from '../lib/format'
import { RateLimitError, guardMutation } from '../lib/rateLimit'
import { cn } from '../lib/utils'
import type { Ceremonialist } from '../hooks/useCeremonialists'

type CeremonialistFormModalProps = {
  onClose: () => void
  onCreated: (ceremonialist: Ceremonialist) => void
}

type FormState = { name: string; phone: string; email: string }
type FormErrors = Partial<Record<keyof FormState, string>>

const inputClassName = (hasError: boolean) =>
  cn(
    'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400',
    'focus:outline-none focus:ring-2 dark:bg-slate-950 dark:text-white',
    hasError
      ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
      : 'border-slate-200 focus:border-brand-600 focus:ring-brand-600/20 dark:border-slate-700',
  )

function translateError(error: PostgrestError): { message: string; field?: keyof FormState } {
  if (error.code === '23505') return { message: 'Já existe uma cerimonialista com esse nome.', field: 'name' }
  if (error.code === '23514') return { message: 'Informe o nome da cerimonialista.', field: 'name' }
  if (error.code === '42501') return { message: 'Seu acesso não permite cadastrar. Faça login novamente.' }
  if (error.code === 'PGRST202' || error.code === '42883') {
    return { message: 'Cadastro de cerimonialistas indisponível. Rode a migração 016 no Supabase.' }
  }
  if (error.message.toLowerCase().includes('failed to fetch')) return { message: 'Sem conexão com o servidor. Nada foi salvo.' }
  return { message: 'Não foi possível cadastrar a cerimonialista. Tente novamente.' }
}

/** Cadastro rápido de uma cerimonialista (nome, telefone e e-mail), aberto pelo formulário da proposta. */
export default function CeremonialistFormModal({ onClose, onCreated }: CeremonialistFormModalProps) {
  const [form, setForm] = useState<FormState>({ name: '', phone: '', email: '' })
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Captura: o Esc fecha só esta janela, sem chegar ao formulário da proposta
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      if (!saving) onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onClose, saving])

  const update = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }))
    setSubmitError(null)
  }

  // Formulário dentro de outro formulário: o envio não pode chegar ao da proposta
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (saving) return

    const nextErrors: FormErrors = {}
    if (!form.name.trim()) nextErrors.name = 'Informe o nome da cerimonialista.'
    if (onlyDigits(form.phone).length > 0 && !isValidPhoneBR(form.phone)) nextErrors.phone = 'Telefone incompleto. Use DDD + número.'
    if (form.email.trim() && !isValidEmail(form.email)) nextErrors.email = 'E-mail inválido.'
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    const phoneDigits = onlyDigits(form.phone)
    const args = {
      p_name: form.name.trim().replace(/\s+/g, ' '),
      p_phone: phoneDigits ? formatPhoneBR(phoneDigits) : null,
      p_email: form.email.trim() ? form.email.trim().toLowerCase() : null,
    }

    setSaving(true)
    setSubmitError(null)
    try {
      const { data, error } = await guardMutation(`ceremonialist:novo:${JSON.stringify(args)}`, async () =>
        supabase.rpc('create_ceremonialist', args),
      )
      if (error || !data) {
        const translated = error ? translateError(error) : { message: 'Não foi possível cadastrar a cerimonialista.' }
        setSubmitError(translated.message)
        if (translated.field) setErrors((current) => ({ ...current, [translated.field as keyof FormState]: translated.message }))
        return
      }
      onCreated({ id: data.id, name: data.name })
    } catch (error) {
      setSubmitError(error instanceof RateLimitError ? error.message : 'Não foi possível cadastrar a cerimonialista. Tente novamente.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={() => !saving && onClose()} aria-hidden="true" />
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="ceremonialist-form-title"
        onSubmit={handleSubmit}
        noValidate
        className="relative w-full max-w-lg rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl dark:border-slate-800 dark:bg-slate-900"
      >
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="ceremonialist-form-title" className="text-base font-semibold text-slate-900 dark:text-white">
                Nova cerimonialista
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Fica em Consultar Leads, com o painel das indicações dela.</p>
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

        <div className="space-y-4 px-5 py-5">
          <div>
            <label htmlFor="ceremonialist-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Nome <span className="text-red-500">*</span>
            </label>
            <input
              id="ceremonialist-name"
              type="text"
              autoFocus
              autoComplete="off"
              maxLength={150}
              placeholder="Ex.: Ana Festas & Eventos"
              value={form.name}
              onChange={(event) => update('name', event.target.value)}
              aria-invalid={Boolean(errors.name)}
              className={inputClassName(Boolean(errors.name))}
            />
            {errors.name && <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{errors.name}</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ceremonialist-phone" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                Telefone / WhatsApp
              </label>
              <input
                id="ceremonialist-phone"
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
              <label htmlFor="ceremonialist-email" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                E-mail
              </label>
              <input
                id="ceremonialist-email"
                type="email"
                autoComplete="off"
                maxLength={254}
                placeholder="Ex.: contato@cerimonial.com.br"
                value={form.email}
                onChange={(event) => update('email', event.target.value)}
                aria-invalid={Boolean(errors.email)}
                className={inputClassName(Boolean(errors.email))}
              />
              {errors.email && <p className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">{errors.email}</p>}
            </div>
          </div>
          {submitError && (
            <p role="alert" className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <CircleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              {submitError}
            </p>
          )}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-200 px-5 py-4 sm:flex-row sm:justify-end dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
          >
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Cadastrar cerimonialista
          </button>
        </footer>
      </form>
    </div>
  )
}
