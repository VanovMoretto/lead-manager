/**
 * Modo Portfólio / Demonstração (`VITE_DEMO_MODE=true`): o app roda com dados fictícios,
 * guardados só no navegador, sem conectar ao Supabase. Lido em tempo de build: fora do
 * modo demo, o código da demonstração nem entra no pacote final.
 */
export const isDemoMode = import.meta.env.VITE_DEMO_MODE === 'true'
