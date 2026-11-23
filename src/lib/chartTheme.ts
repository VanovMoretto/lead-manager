// Paleta dos gráficos: azul do Verto na série principal, verde para fechadas,
// âmbar para em aberto e vermelho para perdas. A ordem é fixa: a cor segue a
// categoria, nunca a posição no ranking.

export type ChartTheme = {
  series: string[]
  /** Cor única do ranking de perdas (slot 8, não usado pelos outros gráficos). */
  loss: string
  /** Composição do orçamento: locação, A&B, hospedagem, equipamentos e estacionamento. */
  composition: string[]
  /** Fatias "Outros" e "Não informado": neutras, sem competir com as categorias. */
  neutral: string
  grid: string
  axis: string
  surface: string
  cursor: string
}

export const CHART_THEMES: Record<'light' | 'dark', ChartTheme> = {
  light: {
    series: ['#2563EB', '#0E7490', '#059669', '#D97706', '#1E3A8A', '#64748B', '#BE185D'],
    loss: '#DC2626',
    composition: ['#2563EB', '#0E7490', '#1E3A8A', '#60A5FA', '#94A3B8'],
    neutral: '#CBD5E1',
    grid: '#e2e8f0',
    axis: '#64748b',
    surface: '#ffffff',
    cursor: 'rgba(148, 163, 184, 0.15)',
  },
  dark: {
    series: ['#60A5FA', '#22D3EE', '#34D399', '#FBBF24', '#93C5FD', '#94A3B8', '#F472B6'],
    loss: '#e66767',
    composition: ['#3B82F6', '#22D3EE', '#93C5FD', '#1D4ED8', '#64748B'],
    neutral: '#64748b',
    grid: '#1e293b',
    axis: '#94a3b8',
    surface: '#0f172a',
    cursor: 'rgba(148, 163, 184, 0.10)',
  },
}
