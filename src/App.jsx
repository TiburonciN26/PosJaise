import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import RutaProtegida from './components/RutaProtegida.jsx'
import Layout from './components/Layout.jsx'
import PestanasCacheadas from './components/PestanasCacheadas.jsx'
import Login from './pages/Login.jsx'

function App() {
  const { cargando } = useAuth()

  if (cargando) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-bg">
        <p className="font-mono text-sm text-ink/60">Cargando...</p>
      </main>
    )
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route path="/login" element={<Login />} />

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
