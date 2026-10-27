import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const PAGE_SIZE = 1000

/** Nomes de empresa distintos já cadastrados nos leads, em ordem alfabética. */
async function fetchCompanies(): Promise<string[]> {
  const names = new Map<string, string>()
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('leads')
      .select('company')
      .not('company', 'is', null)
      .order('company', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) throw error
    for (const row of data ?? []) {
      const name = row.company?.trim()
      // Agrupa variações só de maiúsculas/minúsculas, mantendo a primeira grafia encontrada
      if (name && !names.has(name.toLocaleLowerCase('pt-BR'))) names.set(name.toLocaleLowerCase('pt-BR'), name)
    }
    if (!data || data.length < PAGE_SIZE) break
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

/**
 * Empresas já cadastradas, para sugerir no formulário (evita "Acme" e "ACME Ltda" duplicadas)
 * e montar o filtro da consulta. `reloadKey` refaz a busca (ex.: depois de salvar um lead).
 */
export function useCompanies(reloadKey: unknown = null) {
  const [state, setState] = useState<{ key: unknown; companies: string[] } | null>(null)

  useEffect(() => {
    let isActive = true
    fetchCompanies()
      .then((companies) => {
        if (isActive) setState({ key: reloadKey, companies })
      })
      .catch(() => {
        if (isActive) setState({ key: reloadKey, companies: [] })
      })
    return () => {
      isActive = false
    }
  }, [reloadKey])

  return { companies: state?.companies ?? [], loading: state?.key !== reloadKey }
}

/** Empresa sugerida no formulário: um cadastro (braço) de `clients`, ou só o nome vindo das propostas. */
export type CompanyOption = { id: string | null; name: string; branch_label: string | null; cnpj: string | null }

/** Empresas cadastradas, cada braço separado. Sem a migração 009, cai nos nomes das propostas. */
async function fetchCompanyOptions(): Promise<CompanyOption[]> {
  const options: CompanyOption[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('clients')
      .select('id, name, branch_label, cnpj')
      .eq('client_type', 'company')
      .order('name', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (error) {
      const names = await fetchCompanies()
      return names.map((name) => ({ id: null, name, branch_label: null, cnpj: null }))
    }
    options.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
  }
  return options
}

export function useCompanyOptions(reloadKey: unknown = null) {
  const [state, setState] = useState<{ key: unknown; options: CompanyOption[] } | null>(null)

  useEffect(() => {
    let isActive = true
    fetchCompanyOptions()
      .then((options) => {
        if (isActive) setState({ key: reloadKey, options })
      })
      .catch(() => {
        if (isActive) setState({ key: reloadKey, options: [] })
      })
    return () => {
      isActive = false
    }
  }, [reloadKey])

  return { options: state?.options ?? [] }
}
