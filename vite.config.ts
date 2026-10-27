import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// O WhatsApp e as redes sociais só leem og:image com endereço absoluto.
// Na Vercel o domínio de produção vem de VERCEL_PROJECT_PRODUCTION_URL; VITE_SITE_URL tem prioridade.
function siteUrlPlugin(siteUrl: string): Plugin {
  return {
    name: 'site-url',
    transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl),
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const vercelHost = env.VERCEL_PROJECT_PRODUCTION_URL
  const siteUrl = (env.VITE_SITE_URL || (vercelHost ? `https://${vercelHost}` : '')).replace(/\/+$/, '')

  return {
    plugins: [react(), siteUrlPlugin(siteUrl)],
  }
})
