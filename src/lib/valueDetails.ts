import { formatBRL } from './format'
import { NET_RATES, type LeadValueBreakdown } from './leadFields'
import { netShare } from './revenue'

export type DetailRow = { label: string; value: number; hint?: string }

const percentOf = (rate: number) => `${Math.round(rate * 100)}%`

/** Composição da receita bruta: cada serviço pelo valor integral. */
export function grossDetailRows(values: LeadValueBreakdown): DetailRow[] {
  return [
    { label: 'Locação de sala', value: values.rental },
    { label: 'A&B', value: values.ab },
    { label: 'Hospedagem', value: values.lodging },
    { label: 'Equipamentos / extras', value: values.equipment },
    { label: 'Estacionamento', value: values.parking },
  ]
}

/** Composição da receita líquida: a parte de cada serviço que fica no hotel. */
export function netDetailRows(values: LeadValueBreakdown): DetailRow[] {
  const row = (label: string, gross: number, rate: number): DetailRow => ({
    label: `${label} (${percentOf(rate)})`,
    value: netShare(gross, rate),
    hint: rate < 1 && gross > 0 ? `de ${formatBRL(gross)}` : undefined,
  })
  return [
    row('Locação de sala', values.rental, NET_RATES.rental),
    row('Hospedagem', values.lodging, NET_RATES.lodging),
    row('Estacionamento', values.parking, NET_RATES.parking),
    row('Equipamentos / extras', values.equipment, NET_RATES.equipment),
    row('A&B', values.ab, NET_RATES.ab),
  ]
}
