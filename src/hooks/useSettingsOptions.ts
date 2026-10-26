import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AppSettingOption, SettingCategory, SettingOptionsByCategory } from '../types/lead'

type UseSettingsOptionsParams = {
  /** Busca só quando true (ex.: quando o modal abre). */
  enabled?: boolean
  /** Inclui opções inativas (usado no Painel Admin). */
  includeInactive?: boolean
}

type UseSettingsOptionsResult = {
  options: SettingOptionsByCategory
  loading: boolean
  error: string | null
  reload: () => Promise<void>
}

const EMPTY_OPTIONS: SettingOptionsByCategory = {
  room: [],
  origin: [],
  loss_reason: [],
}

function groupByCategory(rows: AppSettingOption[]): SettingOptionsByCategory {
  const grouped: Record<SettingCategory, AppSettingOption[]> = { room: [], origin: [], loss_reason: [] }
  for (const row of rows) {
    grouped[row.category].push(row)
  }
  return grouped
}

type FetchResult = { options: SettingOptionsByCategory; error: string | null }

async function fetchOptions(includeInactive: boolean): Promise<FetchResult> {
  let query = supabase
    .from('app_settings_options')
    .select('*')
    .order('category', { ascending: true })
    .order('label', { ascending: true })

  if (!includeInactive) {
    query = query.eq('active', true)
  }

  const { data, error } = await query
  if (error) {
    return { options: EMPTY_OPTIONS, error: 'Não foi possível carregar as opções cadastradas.' }
  }
  return { options: groupByCategory(data ?? []), error: null }
}

/** Carrega as opções dinâmicas de `app_settings_options`, agrupadas por categoria. */
export function useSettingsOptions({
  enabled = true,
  includeInactive = false,
}: UseSettingsOptionsParams = {}): UseSettingsOptionsResult {
  const [options, setOptions] = useState<SettingOptionsByCategory>(EMPTY_OPTIONS)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)

  const applyResult = useCallback((result: FetchResult) => {
    setOptions(result.options)
    setError(result.error)
    setLoading(false)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    applyResult(await fetchOptions(includeInactive))
  }, [includeInactive, applyResult])

  useEffect(() => {
    if (!enabled) return
    let isActive = true
    fetchOptions(includeInactive).then((result) => {
      if (isActive) applyResult(result)
    })
    return () => {
      isActive = false
    }
  }, [enabled, includeInactive, applyResult])

  return { options, loading, error, reload }
}
