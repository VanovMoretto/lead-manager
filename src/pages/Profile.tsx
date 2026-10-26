import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { CircleAlert, CircleCheck, ImageUp, KeyRound, LoaderCircle, ShieldCheck, Trash2, UserRound } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import PasswordInput from '../components/PasswordInput'
import UserAvatar from '../components/UserAvatar'
import { MIN_PASSWORD_LENGTH, useAuth } from '../contexts/AuthContext'
import { AVATAR_BUCKET } from '../hooks/useAvatarUrl'
import { formatFileSize, randomStorageName, resolveMimeType, translateStorageError } from '../lib/storage'
import { supabase } from '../lib/supabase'
import { cn } from '../lib/utils'

const AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
const MAX_AVATAR_BYTES = 2 * 1024 * 1024

type Feedback = { type: 'success' | 'error'; message: string } | null

const cardClassName = 'rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900'

function FeedbackMessage({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null
  const success = feedback.type === 'success'
  const Icon = success ? CircleCheck : CircleAlert
  return (
    <p
      role={success ? 'status' : 'alert'}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm',
        success
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {feedback.message}
    </p>
  )
}

function AvatarCard() {
  const { user, profile, isAdmin, refreshProfile } = useAuth()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const username = user?.email?.split('@')[0] ?? ''

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !user) return
    setFeedback(null)

    const mimeType = resolveMimeType(file, AVATAR_TYPES)
    if (!mimeType) {
      setFeedback({ type: 'error', message: 'Use uma imagem PNG, JPG ou WEBP.' })
      return
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setFeedback({ type: 'error', message: `A foto pode ter no máximo ${formatFileSize(MAX_AVATAR_BYTES)}.` })
      return
    }

    setBusy('upload')
    const path = `${user.id}/${randomStorageName(mimeType)}`
    const storage = supabase.storage.from(AVATAR_BUCKET)
    const upload = await storage.upload(path, file, { contentType: mimeType, upsert: false })
    if (upload.error) {
      setBusy(null)
      setFeedback({ type: 'error', message: translateStorageError(upload.error, 'Não foi possível enviar a foto.') })
      return
    }

    const { error } = await supabase.from('user_profiles').update({ avatar_path: path }).eq('user_id', user.id).select('user_id').single()
    if (error) {
      await storage.remove([path])
      setBusy(null)
      setFeedback({ type: 'error', message: 'Não foi possível salvar a foto no perfil. Tente novamente.' })
      return
    }

    // A foto anterior deixa de ser usada
    if (profile?.avatar_path) await storage.remove([profile.avatar_path])
    setBusy(null)
    setFeedback({ type: 'success', message: 'Foto atualizada.' })
    refreshProfile()
  }

  const handleRemove = async () => {
    if (!user || !profile?.avatar_path) return
    setFeedback(null)
    setBusy('remove')
    const { error } = await supabase.from('user_profiles').update({ avatar_path: null }).eq('user_id', user.id).select('user_id').single()
    if (error) {
      setBusy(null)
      setFeedback({ type: 'error', message: 'Não foi possível remover a foto. Tente novamente.' })
      return
    }
    await supabase.storage.from(AVATAR_BUCKET).remove([profile.avatar_path])
    setBusy(null)
    setFeedback({ type: 'success', message: 'Foto removida.' })
    refreshProfile()
  }

  return (
    <section className={cardClassName}>
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
        <UserRound className="h-5 w-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
        Dados do usuário
      </h2>

      <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
        <UserAvatar path={profile?.avatar_path} name={username} className="h-24 w-24 text-3xl" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="truncate text-lg font-semibold text-slate-900 dark:text-white">{username}</p>
          <p className="truncate text-sm text-slate-500 dark:text-slate-400">{user?.email}</p>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
              isAdmin
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300'
                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            {isAdmin ? 'Administrador' : 'Usuário comum'}
          </span>
        </div>
      </div>

      {profile ? (
        <div className="mt-5 flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept={AVATAR_TYPES.join(',')}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => void handleFile(event)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {busy === 'upload' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImageUp className="h-4 w-4" aria-hidden="true" />}
            {profile.avatar_path ? 'Trocar foto' : 'Enviar foto'}
          </button>
          {profile.avatar_path && (
            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-300"
            >
              {busy === 'remove' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" aria-hidden="true" />}
              Remover foto
            </button>
          )}
          <p className="w-full text-xs text-slate-500 dark:text-slate-400">PNG, JPG ou WEBP de até {formatFileSize(MAX_AVATAR_BYTES)}.</p>
        </div>
      ) : (
        <p className="mt-5 text-sm text-amber-700 dark:text-amber-300">
          A foto de perfil fica disponível depois que a migração 007 for aplicada no Supabase.
        </p>
      )}

      <div className="mt-4">
        <FeedbackMessage feedback={feedback} />
      </div>
    </section>
  )
}

function PasswordCard() {
  const { changePassword, user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setFeedback(null)

    if (!current) {
      setFeedback({ type: 'error', message: 'Informe a senha atual.' })
      return
    }
    if (next.length < MIN_PASSWORD_LENGTH) {
      setFeedback({ type: 'error', message: `A nova senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.` })
      return
    }
    if (next !== confirmation) {
      setFeedback({ type: 'error', message: 'A confirmação não confere com a nova senha.' })
      return
    }
    if (next === current) {
      setFeedback({ type: 'error', message: 'A nova senha precisa ser diferente da atual.' })
      return
    }

    setSaving(true)
    const result = await changePassword(current, next)
    setSaving(false)

    if (result.error) {
      setFeedback({ type: 'error', message: result.error })
      return
    }
    setCurrent('')
    setNext('')
    setConfirmation('')
    setFeedback({ type: 'success', message: 'Senha alterada com sucesso.' })
  }

  return (
    <section className={cardClassName}>
      <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-white">
        <KeyRound className="h-5 w-5 text-brand-600 dark:text-brand-400" aria-hidden="true" />
        Alterar senha
      </h2>
      <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
        {/* Ajuda o gerenciador de senhas do navegador a associar a senha ao usuário */}
        <input type="text" autoComplete="username" value={user?.email ?? ''} className="hidden" readOnly tabIndex={-1} aria-hidden="true" />
        <div>
          <label htmlFor="current-password" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
            Senha atual
          </label>
          <PasswordInput id="current-password" value={current} onChange={setCurrent} autoComplete="current-password" disabled={saving} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Nova senha
            </label>
            <PasswordInput id="new-password" value={next} onChange={setNext} autoComplete="new-password" disabled={saving} />
          </div>
          <div>
            <label htmlFor="confirm-password" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
              Confirmar nova senha
            </label>
            <PasswordInput id="confirm-password" value={confirmation} onChange={setConfirmation} autoComplete="new-password" disabled={saving} />
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">Mínimo de {MIN_PASSWORD_LENGTH} caracteres.</p>

        <FeedbackMessage feedback={feedback} />

        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {saving ? 'Salvando...' : 'Salvar nova senha'}
        </button>
      </form>
    </section>
  )
}

export default function Profile() {
  return (
    <>
      <PageHeader title="Meu perfil" description="Foto de perfil e senha de acesso." />
      <div className="grid max-w-5xl grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <AvatarCard />
        <PasswordCard />
      </div>
    </>
  )
}
