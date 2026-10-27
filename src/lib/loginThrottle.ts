/**
 * Freio de tentativas no navegador: após 5 falhas seguidas o login fica bloqueado por 30 s,
 * e cada nova falha depois do desbloqueio dobra a espera (60 s, 120 s...). O estado fica no
 * localStorage para valer também depois de recarregar a página. A proteção definitiva
 * continua no servidor (limites do Supabase Auth e captcha).
 */
const LOGIN_KEY = 'gestao-leads-login-tentativas'
const RESET_KEY = 'gestao-leads-reset-senha'

export const MAX_FAILED_ATTEMPTS = 5
const BASE_LOCK_SECONDS = 30
const MAX_LOCK_SECONDS = 30 * 60
export const RESET_COOLDOWN_SECONDS = 60

type LoginThrottleState = {
  /** Falhas seguidas antes do primeiro bloqueio. */
  failures: number
  /** Quantos bloqueios já aconteceram desde o último login certo. */
  lockLevel: number
  /** Fim do bloqueio atual (timestamp em ms). */
  lockedUntil: number
}

const EMPTY_STATE: LoginThrottleState = { failures: 0, lockLevel: 0, lockedUntil: 0 }

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Sem localStorage: o freio vale só enquanto a página estiver aberta
  }
}

export function getLoginThrottle(): LoginThrottleState {
  return read(LOGIN_KEY, EMPTY_STATE)
}

/** Segundos restantes de bloqueio (0 = liberado). */
export function lockSecondsLeft(state: LoginThrottleState, now = Date.now()): number {
  return Math.max(0, Math.ceil((state.lockedUntil - now) / 1000))
}

/** Registra uma falha e devolve o novo estado (já com o bloqueio aplicado, se for o caso). */
export function registerLoginFailure(now = Date.now()): LoginThrottleState {
  const state = getLoginThrottle()
  let next: LoginThrottleState
  if (state.lockLevel > 0) {
    // Já foi bloqueado antes: qualquer nova falha bloqueia de novo, com o dobro do tempo
    const seconds = Math.min(BASE_LOCK_SECONDS * 2 ** state.lockLevel, MAX_LOCK_SECONDS)
    next = { failures: 0, lockLevel: state.lockLevel + 1, lockedUntil: now + seconds * 1000 }
  } else if (state.failures + 1 >= MAX_FAILED_ATTEMPTS) {
    next = { failures: 0, lockLevel: 1, lockedUntil: now + BASE_LOCK_SECONDS * 1000 }
  } else {
    next = { ...state, failures: state.failures + 1 }
  }
  write(LOGIN_KEY, next)
  return next
}

export function clearLoginThrottle(): void {
  try {
    window.localStorage.removeItem(LOGIN_KEY)
  } catch {
    // Nada a limpar
  }
}

/** Segundos até poder pedir outro e-mail de redefinição de senha. */
export function resetCooldownLeft(now = Date.now()): number {
  const { requestedAt } = read(RESET_KEY, { requestedAt: 0 })
  return Math.max(0, Math.ceil((requestedAt + RESET_COOLDOWN_SECONDS * 1000 - now) / 1000))
}

export function registerResetRequest(now = Date.now()): void {
  write(RESET_KEY, { requestedAt: now })
}
