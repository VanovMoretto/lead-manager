/** Tamanho mínimo de senha exigido pelo app (o Supabase pode exigir mais). */
export const MIN_PASSWORD_LENGTH = 8

export const PASSWORD_RULE_TEXT = `Mínimo de ${MIN_PASSWORD_LENGTH} caracteres, com letras e números.`

/** Regra de senha do app: tamanho mínimo, com pelo menos uma letra e um número. Retorna o erro ou null. */
export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `A nova senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`
  if (!/\p{L}/u.test(password) || !/\d/.test(password)) return 'A nova senha precisa ter letras e números.'
  if (password.length > 72) return 'A senha pode ter no máximo 72 caracteres.'
  return null
}
