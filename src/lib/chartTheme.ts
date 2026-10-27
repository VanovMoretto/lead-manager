// Paleta categórica validada (contraste, daltonismo e separação entre cores
// vizinhas) para o fundo branco e para o fundo escuro. A ordem é fixa: a cor
// segue a categoria, nunca a posição no ranking.

export type ChartTheme = {
  series: string[]
  /** Cor única do ranking de perdas (slot 8, não usado pelos outros gráficos). */
  loss: string
  /** Fatias "Outros" e "Não informado": neutras, sem competir com as categorias. */
  neutral: string
  grid: string
  axis: string
  surface: string
  cursor: string
}

export const CHART_THEMES: Record<'light' | 'dark', ChartTheme> = {
  light: {
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6'],
    loss: '#e34948',
    neutral: '#94a3b8',
    grid: '#e2e8f0',
    axis: '#64748b',
    surface: '#ffffff',
    cursor: 'rgba(148, 163, 184, 0.15)',
  },
  dark: {
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'],
    loss: '#e66767',
    neutral: '#64748b',
    grid: '#1e293b',
    axis: '#94a3b8',
    surface: '#0f172a',
    cursor: 'rgba(148, 163, 184, 0.10)',
  },
}
