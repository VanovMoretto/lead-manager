import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RESET_PASSWORD_PATH, readRecoveryLink } from './lib/passwordRecovery'

// Link de "Esqueci minha senha" que voltou para outra página (ex.: a Site URL do Supabase):
// leva para a página própria de nova senha, que é a única que trata o link
const recoveryLink = readRecoveryLink()
if (recoveryLink && recoveryLink.kind !== 'error' && !window.location.pathname.endsWith(`/${RESET_PASSWORD_PATH}`)) {
  window.history.replaceState(null, '', `${import.meta.env.BASE_URL}${RESET_PASSWORD_PATH}${window.location.search}${window.location.hash}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
