/** Utilitários de upload para o Supabase Storage (anexos e fotos de perfil). */

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/**
 * Tipo do arquivo, dentro dos permitidos. Usa o tipo informado pelo navegador e,
 * se ele vier vazio, a extensão do nome. Retorna null para tipos não aceitos.
 */
export function resolveMimeType(file: File, allowed: readonly string[]): string | null {
  const fromName = MIME_BY_EXTENSION[file.name.split('.').pop()?.toLowerCase() ?? '']
  const mime = file.type || fromName || ''
  return allowed.includes(mime) ? mime : null
}

/** Nome do arquivo no bucket: identificador aleatório + extensão (o nome original fica no banco). */
export function randomStorageName(mimeType: string): string {
  return `${crypto.randomUUID()}.${EXTENSION_BY_MIME[mimeType] ?? 'bin'}`
}

/** 1536 -> "1,5 KB" */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${units[unit]}`
}

/** Traduz os erros mais comuns do Storage. */
export function translateStorageError(error: { message: string } | null | undefined, fallback: string): string {
  const message = error?.message.toLowerCase() ?? ''
  if (message.includes('bucket not found')) {
    return 'O armazenamento de arquivos ainda não foi configurado. Rode a migração 007 no SQL Editor do Supabase.'
  }
  if (message.includes('row-level security') || message.includes('unauthorized') || message.includes('permission')) {
    return 'Você não tem permissão para esta ação.'
  }
  if (message.includes('too large') || message.includes('exceeded the maximum')) {
    return 'O arquivo é maior que o tamanho permitido.'
  }
  if (message.includes('mime type') || message.includes('invalid_mime_type')) {
    return 'Tipo de arquivo não permitido.'
  }
  if (message.includes('failed to fetch') || message.includes('network')) {
    return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.'
  }
  return fallback
}
