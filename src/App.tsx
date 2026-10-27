import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { LoaderCircle, Settings2 } from 'lucide-react'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ConfirmProvider } from './contexts/ConfirmContext'
import { isSupabaseConfigured } from './lib/supabase'
import Layout from './components/Layout'
import PrivateRoute from './components/PrivateRoute'
import AdminRoute from './components/AdminRoute'
import AppLogo from './components/AppLogo'
import ThemeToggle from './components/ThemeToggle'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'

// Prefixo das rotas: "/" localmente e "/lead-manager" no GitHub Pages (definido por --base no build)
const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

// Páginas carregadas sob demanda: o Recharts só é baixado ao abrir a Dashboard, etc.
const Dashboard = lazy(() => import('./pages/Dashboard'))
const LeadSearch = lazy(() => import('./pages/LeadSearch'))
const AdminPanel = lazy(() => import('./pages/AdminPanel'))
const LeadDetails = lazy(() => import('./pages/LeadDetails'))
const ClientList = lazy(() => import('./pages/ClientList'))
const ClientDashboard = lazy(() => import('./pages/ClientDashboard'))
const RevenueMap = lazy(() => import('./pages/RevenueMap'))
const Profile = lazy(() => import('./pages/Profile'))

function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
      <LoaderCircle className="mr-2 h-5 w-5 animate-spin text-brand-600" aria-hidden="true" />
      Carregando...
    </div>
  )
}

/** Exibida enquanto o arquivo .env não tem as chaves do Supabase. */
function SetupNotice() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-lg">
        <AppLogo size="md" className="mb-8" />
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-300">
            <Settings2 className="h-6 w-6" aria-hidden="true" />
          </span>
          <h1 className="mt-4 text-xl font-bold text-slate-900 dark:text-white">Configure o Supabase</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Preencha o arquivo <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">.env</code> na
            raiz do projeto e reinicie o <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-800">npm run dev</code>:
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs text-slate-100 dark:bg-slate-950">
            {'VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co\nVITE_SUPABASE_ANON_KEY=sua-chave-anon'}
          </pre>
          <p className="mt-4 text-xs text-slate-500 dark:text-slate-400">
            Os valores ficam em Supabase → Project Settings → API.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ConfirmProvider>
      {isSupabaseConfigured ? (
        <AuthProvider>
          <BrowserRouter basename={ROUTER_BASENAME}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/redefinir-senha" element={<ResetPassword />} />

              <Route element={<PrivateRoute />}>
                <Route element={<Layout />}>
                  <Route
                    index
                    element={
                      <Suspense fallback={<PageLoader />}>
                        <Dashboard />
                      </Suspense>
                    }
                  />
                  <Route
                    path="propostas"
                    element={
                      <Suspense fallback={<PageLoader />}>
                        <LeadSearch />
                      </Suspense>
                    }
                  />
                  <Route
                    path="propostas/:proposalId"
                    element={
                      <Suspense fallback={<PageLoader />}>
                        <LeadDetails />
                      </Suspense>
                    }
                  />
                  <Route
                    path="leads"
                    element={
                      <Suspense fallback={<PageLoader />}>
                        <ClientList />
                      </Suspense>
                    }
                  />
                  <Route
                    path="leads/:clientId"
                    element={
                      <Suspense fallback={<PageLoader />}>
                        <ClientDashboard />
                      </Suspense>
                    }
                  />
                  <Route
                    path="faturamento"
                    element={
                      <Suspense fallback={<PageLoader />}>
                        <RevenueMap />
                      </Suspense>
                    }
                  />
                  <Route
                    path="perfil"
                    element={
                      <Suspense fallback={<PageLoader />}>
                        <Profile />
                      </Suspense>
                    }
                  />
                  {/* Painel Admin: somente usuários com papel ADMIN */}
                  <Route element={<AdminRoute />}>
                    <Route
                      path="admin"
                      element={
                        <Suspense fallback={<PageLoader />}>
                          <AdminPanel />
                        </Suspense>
                      }
                    />
                  </Route>
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      ) : (
        <SetupNotice />
      )}
      </ConfirmProvider>
    </ThemeProvider>
  )
}
