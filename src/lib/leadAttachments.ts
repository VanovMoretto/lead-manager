import { supabase } from './supabase'
import { randomStorageName, translateStorageError, formatFileSize } from './storage'
import type { AttachmentKind, LeadAttachment } from '../types/lead'

export const ATTACHMENT_BUCKET = 'lead-attachments'
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

/** Formatos aceitos nas propostas: extensão, tipo MIME e assinatura dos primeiros bytes do arquivo. */
const ATTACHMENT_FORMATS = [
  { extensions: ['pdf'], mime: 'application/pdf', signature: [0x25, 0x50, 0x44, 0x46] },
  { extensions: ['doc'], mime: 'application/msword', signature: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1] },
  {
    extensions: ['docx'],
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    signature: [0x50, 0x4b, 0x03, 0x04],
  },
  { extensions: ['png'], mime: 'image/png', signature: [0x89, 0x50, 0x4e, 0x47] },
  { extensions: ['jpg', 'jpeg'], mime: 'image/jpeg', signature: [0xff, 0xd8, 0xff] },
] as const

/** Valor do `accept` do campo de arquivo. */
export const ATTACHMENT_ACCEPT = ATTACHMENT_FORMATS.flatMap((format) => [...format.extensions.map((ext) => `.${ext}`), format.mime]).join(',')

export const ATTACHMENT_FORMATS_LABEL = 'PDF, DOC, DOCX, PNG ou JPG'

/**
 * Confere o arquivo antes do envio: extensão permitida, tipo informado pelo navegador compatível
 * com a extensão e conteúdo começando com a assinatura do formato (evita arquivo renomeado).
 * Retorna o tipo MIME a gravar; lança Error com a mensagem para a tela.
 */
export async function validateAttachmentFile(file: File): Promise<string> {
  const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : ''
  const format = ATTACHMENT_FORMATS.find((item) => (item.extensions as readonly string[]).includes(extension))
  if (!format) throw new Error(`Formato não permitido. Envie ${ATTACHMENT_FORMATS_LABEL}.`)
  if (file.size === 0) throw new Error('O arquivo está vazio.')
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`O arquivo pode ter no máximo ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`)
  }
  const browserMime = file.type === 'image/jpg' ? 'image/jpeg' : file.type
  if (browserMime && browserMime !== format.mime) {
    throw new Error('O tipo do arquivo não corresponde à extensão.')
  }
  const header = new Uint8Array(await file.slice(0, format.signature.length).arrayBuffer())
  if (!format.signature.every((byte, index) => header[index] === byte)) {
    throw new Error('O conteúdo do arquivo não corresponde ao formato indicado pela extensão.')
  }
  return format.mime
}

/** Validade do link temporário para abrir/baixar um anexo. */
const SIGNED_URL_SECONDS = 60

export async function fetchLeadAttachments(leadId: string): Promise<LeadAttachment[]> {
  const { data, error } = await supabase
    .from('lead_attachments')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Envia o arquivo ao bucket e registra o anexo. Lança Error com mensagem pronta para a tela. */
export async function uploadLeadAttachment(leadId: string, kind: AttachmentKind, file: File): Promise<LeadAttachment> {
  const mimeType = await validateAttachmentFile(file)

  const path = `${leadId}/${kind}/${randomStorageName(mimeType)}`
  const upload = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, file, { contentType: mimeType, upsert: false })
  if (upload.error) throw new Error(translateStorageError(upload.error, 'Não foi possível enviar o arquivo. Tente novamente.'))

  const { data, error } = await supabase
    .from('lead_attachments')
    .insert({
      lead_id: leadId,
      kind,
      storage_path: path,
      file_name: file.name.trim().slice(0, 255) || `proposta.${path.split('.').pop()}`,
      mime_type: mimeType,
      size_bytes: file.size,
    })
    .select()
    .single()

  if (error) {
    // Tenta não deixar o arquivo solto no bucket (só o ADMIN consegue apagar)
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([path])
    throw new Error(
      error.code === '42P01' || error.code === 'PGRST205'
        ? 'O banco de dados está desatualizado. Rode a migração 007 no SQL Editor do Supabase.'
        : 'O arquivo foi enviado, mas não foi possível registrá-lo no lead. Tente novamente.',
    )
  }
  return data
}

/**
 * Nome do arquivo baixado sem acentos nem símbolos: a biblioteca do Storage codifica o nome
 * duas vezes na URL, e "Locação" chegaria como "Loca%C3%A7%C3%A3o".
 */
function downloadFileName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\w.\- ()]/g, '_')
}

/** Link temporário do anexo; com `download`, o navegador baixa com o nome original (sem acentos). */
async function signedUrl(attachment: LeadAttachment, download: boolean): Promise<string> {
  const { data, error } = await supabase.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.storage_path, SIGNED_URL_SECONDS, download ? { download: downloadFileName(attachment.file_name) } : undefined)
  if (error || !data) throw new Error(translateStorageError(error, 'Não foi possível acessar o arquivo. Tente novamente.'))
  return data.signedUrl
}

/** Abre o anexo numa nova aba. A aba é aberta antes da consulta para não ser barrada como pop-up. */
export async function openLeadAttachment(attachment: LeadAttachment): Promise<void> {
  const tab = window.open('', '_blank')
  if (tab) tab.opener = null
  try {
    const url = await signedUrl(attachment, false)
    if (tab) tab.location.href = url
    else window.location.assign(url)
  } catch (error) {
    tab?.close()
    throw error
  }
}

export async function downloadLeadAttachment(attachment: LeadAttachment): Promise<void> {
  const url = await signedUrl(attachment, true)
  const link = document.createElement('a')
  link.href = url
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

/** Exclui o anexo (somente ADMIN, pelas políticas do banco). */
export async function deleteLeadAttachment(attachment: LeadAttachment): Promise<void> {
  const { data, error } = await supabase.from('lead_attachments').delete().eq('id', attachment.id).select('id')
  if (error) throw new Error('Não foi possível excluir o anexo. Tente novamente.')
  if (!data || data.length === 0) throw new Error('Este anexo não foi excluído: ele já não existe ou apenas o ADMIN pode excluir anexos.')
  await supabase.storage.from(ATTACHMENT_BUCKET).remove([attachment.storage_path])
}

/** Caminhos dos arquivos de um lead (para apagar do bucket junto com o lead). */
export async function fetchLeadAttachmentPaths(leadId: string): Promise<string[]> {
  const { data, error } = await supabase.from('lead_attachments').select('storage_path').eq('lead_id', leadId)
  if (error) return []
  return (data ?? []).map((row) => row.storage_path)
}

export async function removeAttachmentFiles(paths: string[]): Promise<void> {
  if (paths.length > 0) await supabase.storage.from(ATTACHMENT_BUCKET).remove(paths)
}
