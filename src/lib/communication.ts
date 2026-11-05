import { supabase } from './supabase'
import type { CommunicationLogInsert } from '../types/lead'

/**
 * Registra em segundo plano uma mensagem iniciada pelo app (métricas de Mailing & Pesquisas).
 * Não trava a navegação e falha em silêncio: o registro é informativo.
 */
export function logCommunication(entry: CommunicationLogInsert): void {
  void Promise.resolve(supabase.from('communication_logs').insert(entry)).catch(() => undefined)
}
