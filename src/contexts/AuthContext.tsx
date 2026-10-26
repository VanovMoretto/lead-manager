import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AuthError, Session, User } from '@supabase/supabase-js'
import { isPasswordRecoveryRedirect, setRememberSession, supabase } from '../lib/supabase'
import type { UserProfile } from '../types/lead'

type ActionResult = { error: string | null }

/** Domínio dos logins da equipe: quem digita só o usuário (ex.: nome.sobrenome) entra com este sufixo. */
export const DEFAULT_EMAIL_DOMAIN = '@swanhoteis.com.br'

/** Tamanho mínimo de senha exigido pelo app (o Supabase pode exigir mais). */
export const MIN_PASSWORD_LENGTH = 8

/** "Nome.Sobrenome " -> "nome.sobrenome@swanhoteis.com.br"; um e-mail completo é mantido como foi digitado. */
function toLoginEmail(identifier: string): string {
  const value = identifier.trim().toLowerCase()
  return value.includes('@') ? value : `${value}${DEFAULT_EMAIL_DOMAIN}`
}

const INACTIVE_NOTICE = 'Seu acesso está desativado. Fale com um administrador do sistema.'

type AuthContextValue = {
  session: Session | null
  user: User | null
  /** true enquanto a sessão salva ainda está sendo verificada. */
  loading: boolean
  /** Usuário logado tem papel ADMIN (Painel Admin, usuários e exclusões). */
  isAdmin: boolean
  /** true enquanto o perfil do usuário logado ainda está sendo consultado. */
  roleLoading: boolean
  /** Perfil do usuário logado (nulo enquanto carrega ou se o banco ainda não tem a migração 007). */
  profile: UserProfile | null
  /** Recarrega o perfil (ex.: depois de trocar a foto). */
  refreshProfile: () => void
  /** Aviso para a tela de login (ex.: acesso desativado). */
  accessNotice: string | null
  clearAccessNotice: () => void
  /** Chegou pelo link de "Esqueci minha senha" e ainda não definiu a nova senha. */
  passwordRecovery: boolean
  /** `identifier` é o usuário (sem domínio) ou um e-mail completo. */
  signIn: (identifier: string, password: string, options?: { remember?: boolean }) => Promise<ActionResult>
  signOut: () => Promise<void>
  requestPasswordReset: (identifier: string) => Promise<ActionResult>
  /** Troca de senha no perfil: confirma a senha atual antes. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<ActionResult>
  /** Define a nova senha depois do link de recuperação. */
  completePasswordRecovery: (newPassword: string) => Promise<ActionResult>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

/** Traduz as mensagens mais comuns do Supabase Auth. */
function translateAuthError(error: Pick<AuthError, 'message'> & { code?: string }, fallback: string): string {
  const normalized = error.message.toLowerCase()

  if (error.code === 'invalid_credentials' || normalized.includes('invalid login credentials')) {
    return 'Usuário ou senha incorretos.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'Este e-mail ainda não foi confirmado. Verifique sua caixa de entrada.'
  }
  if (error.code === 'same_password' || normalized.includes('different from the old password')) {
    return 'A nova senha precisa ser diferente da atual.'
  }
  if (error.code === 'weak_password' || normalized.includes('password should')) {
    return 'Senha fraca. Use pelo menos 8 caracteres, misturando letras e números.'
  }
  if (error.code === 'reauthentication_needed' || error.code === 'session_not_found' || error.code === 'session_expired') {
    return 'Sua sessão expirou. Entre novamente e tente de novo.'
  }
  if (normalized.includes('too many requests') || normalized.includes('rate limit')) {
    return 'Muitas tentativas seguidas. Aguarde alguns instantes e tente novamente.'
  }
  if (normalized.includes('failed to fetch') || normalized.includes('network')) {
    return 'Não foi possível conectar ao servidor. Verifique sua internet.'
  }
  return fallback
}

type ProfileState = {
  userId: string
  profile: UserProfile | null
  isAdmin: boolean
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  // Perfil guardado junto com o id, para nunca valer para outra sessão
  const [profileState, setProfileState] = useState<ProfileState | null>(null)
  const [profileVersion, setProfileVersion] = useState(0)
  const [accessNotice, setAccessNotice] = useState<string | null>(null)
  const [passwordRecovery, setPasswordRecovery] = useState(isPasswordRecoveryRedirect)
  const userId = session?.user.id ?? null

  useEffect(() => {
    let isMounted = true

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      if (event === 'SIGNED_OUT') {
        setPasswordRecovery(false)
        // O próximo login consulta o perfil de novo (pode ter sido desativado nesse meio-tempo)
        setProfileState(null)
      }
      setSession(nextSession)
      setLoading(false)
    })

    return () => {
      isMounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  // Perfil no banco (public.user_profiles). Usuário desativado é desconectado com aviso.
  // Na dúvida, trata como usuário comum: a autorização de verdade está nas políticas do banco.
  useEffect(() => {
    if (!userId) return
    let isActive = true

    const load = async () => {
      const { data, error } = await supabase.from('user_profiles').select('*').eq('user_id', userId).maybeSingle()
      if (!isActive) return

      if (error) {
        // Banco sem a migração 007: o papel ainda vem só de is_admin()
        const role = await supabase.rpc('is_admin')
        if (isActive) setProfileState({ userId, profile: null, isAdmin: !role.error && role.data === true })
        return
      }

      if (!data || !data.is_active) {
        // O perfil fica "carregando" até a saída terminar, então nenhuma tela do app chega a abrir
        setAccessNotice(INACTIVE_NOTICE)
        await supabase.auth.signOut()
        return
      }

      setProfileState({ userId, profile: data, isAdmin: data.is_admin })
    }

    void load()
    return () => {
      isActive = false
    }
  }, [userId, profileVersion])

  const currentProfile = userId !== null && profileState?.userId === userId ? profileState : null
  const isAdmin = currentProfile?.isAdmin ?? false
  const roleLoading = userId !== null && currentProfile === null

  const refreshProfile = useCallback(() => setProfileVersion((current) => current + 1), [])
  const clearAccessNotice = useCallback(() => setAccessNotice(null), [])

  const signIn = useCallback(
    async (identifier: string, password: string, options?: { remember?: boolean }): Promise<ActionResult> => {
      setRememberSession(options?.remember ?? true)
      setAccessNotice(null)
      const { error } = await supabase.auth.signInWithPassword({
        email: toLoginEmail(identifier),
        password,
      })
      return { error: error ? translateAuthError(error, 'Não foi possível entrar. Tente novamente.') : null }
    },
    [],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const requestPasswordReset = useCallback(async (identifier: string): Promise<ActionResult> => {
    const { error } = await supabase.auth.resetPasswordForEmail(toLoginEmail(identifier), {
      redirectTo: `${window.location.origin}${import.meta.env.BASE_URL}redefinir-senha`,
    })
    return {
      error: error ? translateAuthError(error, 'Não foi possível enviar o link agora. Tente novamente mais tarde.') : null,
    }
  }, [])

  const userEmail = session?.user.email ?? null

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<ActionResult> => {
      if (!userEmail) return { error: 'Sua sessão expirou. Entre novamente e tente de novo.' }

      // Confere a senha atual antes de trocar
      const check = await supabase.auth.signInWithPassword({ email: userEmail, password: currentPassword })
      if (check.error) {
        const invalid =
          check.error.code === 'invalid_credentials' || check.error.message.toLowerCase().includes('invalid login credentials')
        return {
          error: invalid ? 'A senha atual está incorreta.' : translateAuthError(check.error, 'Não foi possível alterar a senha.'),
        }
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword })
      return { error: error ? translateAuthError(error, 'Não foi possível alterar a senha. Tente novamente.') : null }
    },
    [userEmail],
  )

  const completePasswordRecovery = useCallback(async (newPassword: string): Promise<ActionResult> => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) return { error: translateAuthError(error, 'Não foi possível salvar a nova senha. Tente novamente.') }
    setPasswordRecovery(false)
    return { error: null }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      isAdmin,
      roleLoading,
      profile: currentProfile?.profile ?? null,
      refreshProfile,
      accessNotice,
      clearAccessNotice,
      passwordRecovery,
      signIn,
      signOut,
      requestPasswordReset,
      changePassword,
      completePasswordRecovery,
    }),
    [
      session,
      loading,
      isAdmin,
      roleLoading,
      currentProfile,
      refreshProfile,
      accessNotice,
      clearAccessNotice,
      passwordRecovery,
      signIn,
      signOut,
      requestPasswordReset,
      changePassword,
      completePasswordRecovery,
    ],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de <AuthProvider>.')
  }
  return context
}
