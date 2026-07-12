import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import RutaProtegida from './components/RutaProtegida.jsx'
import Layout from './components/Layout.jsx'
import PestanasCacheadas from './components/PestanasCacheadas.jsx'

// B5 de la 2ª auditoría: por consistencia con el resto de las pantallas
// (ver PestanasCacheadas), aunque el impacto es mínimo — Login es liviana.
const Login = lazy(() => import('./pages/Login.jsx'))

function CargandoPantalla() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-bg">
      <p className="font-mono text-sm text-ink/60">Cargando...</p>
    </main>
  )
}

function App() {
  const { cargando, session, usuario, errorPerfil, reintentarPerfil } = useAuth()

  if (cargando) {
    return <CargandoPantalla />
  }

  // Hay sesión válida pero el perfil no se pudo leer (fallo de red): sin
  // esto, RutaProtegida rebotaría al login aunque la sesión siga viva —
  // pantalla de reintento en vez de pedir credenciales que ya son correctas.
  if (session && !usuario && errorPerfil) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <p className="text-lg font-semibold text-ink">Sin conexión</p>
        <p className="max-w-sm text-sm text-ink/60">
          No se pudo cargar tu perfil. Revisa tu conexión a internet e intenta de nuevo.
        </p>
        <button
          type="button"
          onClick={reintentarPerfil}
          className="rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-bg"
        >
          Reintentar
        </button>
      </main>
    )
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route
          path="/login"
          element={
            <Suspense fallback={<CargandoPantalla />}>
              <Login />
            </Suspense>
          }
        />

        <Route element={<RutaProtegida />}>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/ventas" replace />} />
            {/* Un solo comodín: así el router nunca desmonta PestanasCacheadas
                al cambiar de pestaña; ella decide sola qué mostrar/ocultar y
                aplica el guard de rol (antes hecho por RutaAdmin). */}
            <Route path="*" element={<PestanasCacheadas />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
