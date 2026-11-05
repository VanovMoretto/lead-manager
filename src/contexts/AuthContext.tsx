import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { getRememberSession, isRecoverySession, setRememberSession, supabase } from '../lib/supabase'
import { clearAvatarUrlCache } from '../hooks/useAvatarUrl'
import { clearUserLoginsCache } from '../hooks/useUserLogins'
import { toLoginEmail, translateAuthError } from '../lib/authHelpers'
import { recoveryClient, resetPasswordUrl } from '../lib/passwordRecovery'
import type { UserProfile } from '../types/lead'

type ActionResult = { error: string | null }

const INACTIVE_NOTICE = 'Seu acesso ainda não foi liberado ou está desativado. Peça a um administrador para ativá-lo no Painel Admin.'

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
  /** `identifier` é o usuário (sem domínio) ou um e-mail completo. */
  signIn: (identifier: string, password: string, options?: { remember?: boolean; captchaToken?: string }) => Promise<ActionResult>
  signOut: () => Promise<void>
  /** `captchaToken`: token do Turnstile, quando o captcha estiver ativo. */
  requestPasswordReset: (identifier: string, captchaToken?: string) => Promise<ActionResult>
  /** Troca de senha no perfil: confirma a senha atual antes. */
  changePassword: (currentPassword: string, newPassword: string, captchaToken?: string) => Promise<ActionResult>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

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
  const userId = session?.user.id ?? null

  useEffect(() => {
    let isMounted = true

    // Sessão aberta pelo link de recuperação nunca vale como login no app (ex.: guardada antes
    // desta regra): é encerrada e a pessoa entra de novo com a senha
    const acceptSession = (next: Session | null): Session | null => {
      if (next && isRecoverySession(next)) {
        void supabase.auth.signOut({ scope: 'local' })
        return null
      }
      return next
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!isMounted) return
      setSession(acceptSession(data.session))
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT') {
        // O próximo login consulta o perfil de novo (pode ter sido desativado nesse meio-tempo)
        setProfileState(null)
        // Dados de outros usuários guardados em memória não passam para o próximo login da aba
        clearUserLoginsCache()
        clearAvatarUrlCache()
      }
      setSession(acceptSession(nextSession))
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
    async (identifier: string, password: string, options?: { remember?: boolean; captchaToken?: string }): Promise<ActionResult> => {
      const previousRemember = getRememberSession()
      setRememberSession(options?.remember ?? true)
      setAccessNotice(null)
      const { error } = await supabase.auth.signInWithPassword({
        email: toLoginEmail(identifier),
        password,
        options: options?.captchaToken ? { captchaToken: options.captchaToken } : undefined,
      })
      // Tentativa que falhou não muda a escolha das sessões já abertas em outras abas
      if (error) setRememberSession(previousRemember)
      return { error: error ? translateAuthError(error, 'Não foi possível entrar. Tente novamente.') : null }
    },
    [],
  )

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const requestPasswordReset = useCallback(async (identifier: string, captchaToken?: string): Promise<ActionResult> => {
    // Pedido pelo cliente da recuperação: o link volta para a página própria de nova senha
    const { error } = await recoveryClient.auth.resetPasswordForEmail(toLoginEmail(identifier), {
      redirectTo: resetPasswordUrl(),
      captchaToken,
    })
    return {
      error: error ? translateAuthError(error, 'Não foi possível enviar o link agora. Tente novamente mais tarde.') : null,
    }
  }, [])

  const userEmail = session?.user.email ?? null

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string, captchaToken?: string): Promise<ActionResult> => {
      if (!userEmail) return { error: 'Sua sessão expirou. Entre novamente e tente de novo.' }

      // Confere a senha atual antes de trocar
      const check = await supabase.auth.signInWithPassword({
        email: userEmail,
        password: currentPassword,
        options: captchaToken ? { captchaToken } : undefined,
      })
      if (check.error) {
        const invalid =
          check.error.code === 'invalid_credentials' || check.error.message.toLowerCase().includes('invalid login credentials')
        return {
          error: invalid ? 'A senha atual está incorreta.' : translateAuthError(check.error, 'Não foi possível alterar a senha.'),
        }
      }

      // A senha atual vai junto: com "Require current password" ligado no Supabase Auth, o servidor também confere
      const { error } = await supabase.auth.updateUser({ password: newPassword, current_password: currentPassword })
      return { error: error ? translateAuthError(error, 'Não foi possível alterar a senha. Tente novamente.') : null }
    },
    [userEmail],
  )

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
      signIn,
      signOut,
      requestPasswordReset,
      changePassword,
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
      signIn,
      signOut,
      requestPasswordReset,
      changePassword,
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
