import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import RutaProtegida from './components/RutaProtegida.jsx'
import RutaAdmin from './components/RutaAdmin.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Ventas from './pages/Ventas.jsx'
import Inventario from './pages/Inventario.jsx'
import Historial from './pages/Historial.jsx'
import Servicios from './pages/Servicios.jsx'
import Dashboard from './pages/Dashboard.jsx'
import MiPanel from './pages/MiPanel.jsx'
import Estadisticas from './pages/Estadisticas.jsx'
import Auditoria from './pages/Auditoria.jsx'
import Clientes from './pages/Clientes.jsx'
import Porcentajes from './pages/Porcentajes.jsx'
import Gastos from './pages/Gastos.jsx'
import Asistentes from './pages/Asistentes.jsx'

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
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route element={<RutaProtegida />}>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/ventas" replace />} />
            <Route path="ventas" element={<Ventas />} />
            <Route path="inventario" element={<Inventario />} />
            <Route path="historial" element={<Historial />} />
            <Route path="servicios" element={<Servicios />} />
            <Route path="mi-panel" element={<MiPanel />} />

            <Route element={<RutaAdmin />}>
              <Route path="dashboard" element={<Dashboard />} />
              <Route path="estadisticas" element={<Estadisticas />} />
              <Route path="auditoria" element={<Auditoria />} />
              <Route path="clientes" element={<Clientes />} />
              <Route path="porcentajes" element={<Porcentajes />} />
              <Route path="gastos" element={<Gastos />} />
              <Route path="asistentes" element={<Asistentes />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
