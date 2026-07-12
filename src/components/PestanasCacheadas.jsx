import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { secciones } from '../config/navegacion.js'
import Ventas from '../pages/Ventas.jsx'

// Ventas queda con import normal (no lazy): es la pestaña de aterrizaje de
// TODOS los usuarios (index redirige ahí), así que no vale la pena pagar una
// ida y vuelta de red extra solo para achicar el bundle inicial. Las demás
// —sobre todo las 7 exclusivas de admin— sí van con React.lazy: una
// asistente nunca llega a pedir ese código, y el admin lo pide recién cuando
// entra a esa pestaña, no todo junto al abrir la app.
const Inventario = lazy(() => import('../pages/Inventario.jsx'))
const Historial = lazy(() => import('../pages/Historial.jsx'))
const Servicios = lazy(() => import('../pages/Servicios.jsx'))
const Dashboard = lazy(() => import('../pages/Dashboard.jsx'))
const MiPanel = lazy(() => import('../pages/MiPanel.jsx'))
const Estadisticas = lazy(() => import('../pages/Estadisticas.jsx'))
const Auditoria = lazy(() => import('../pages/Auditoria.jsx'))
const Clientes = lazy(() => import('../pages/Clientes.jsx'))
const Porcentajes = lazy(() => import('../pages/Porcentajes.jsx'))
const Gastos = lazy(() => import('../pages/Gastos.jsx'))
const Asistentes = lazy(() => import('../pages/Asistentes.jsx'))

const PAGINAS = {
  '/ventas': Ventas,
  '/inventario': Inventario,
  '/historial': Historial,
  '/servicios': Servicios,
  '/dashboard': Dashboard,
  '/mi-panel': MiPanel,
  '/estadisticas': Estadisticas,
  '/auditoria': Auditoria,
  '/clientes': Clientes,
  '/porcentajes': Porcentajes,
  '/gastos': Gastos,
  '/asistentes': Asistentes,
}

function puedeVer(seccion, rol) {
  return Boolean(seccion) && seccion.roles.includes(rol)
}

function CargandoPagina() {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <p className="font-mono text-sm text-ink/60">Cargando...</p>
    </div>
  )
}

// Cada pestaña visitada queda montada (oculta con display:none, no
// desmontada) en vez de que el router la destruya al cambiar de ruta: volver
// a una pestaña es instantáneo, sin "Cargando...", y conserva scroll y
// búsqueda. Cada página recibe `activo` y decide sola si refresca sus datos
// en silencio al volver a mostrarse.
export default function PestanasCacheadas() {
  const { pathname } = useLocation()
  const { rol } = useAuth()
  const seccion = secciones.find((s) => s.path === pathname)
  const permitido = puedeVer(seccion, rol)

  const [visitadas, setVisitadas] = useState(() => (permitido ? [pathname] : []))

  useEffect(() => {
    if (!permitido) return
    setVisitadas((anterior) => (anterior.includes(pathname) ? anterior : [...anterior, pathname]))
  }, [pathname, permitido])

  if (!seccion || !permitido) {
    return <Navigate to="/ventas" replace />
  }

  return (
    <>
      {visitadas.map((ruta) => {
        const Pagina = PAGINAS[ruta]
        if (!Pagina) return null
        const activa = ruta === pathname
        return (
          <div key={ruta} className={activa ? 'contents' : 'hidden'}>
            <Suspense fallback={<CargandoPagina />}>
              <Pagina activo={activa} />
            </Suspense>
          </div>
        )
      })}
    </>
  )
}
