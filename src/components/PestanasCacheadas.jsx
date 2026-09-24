import { lazy, Suspense, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { secciones, rutaInicialPara } from '../config/navegacion.js'
import Ventas from '../pages/Ventas.jsx'

// Ventas queda con import normal (no lazy): es la pestaña de aterrizaje de
// TODOS los usuarios (index redirige ahí), así que no vale la pena pagar una
// ida y vuelta de red extra solo para achicar el bundle inicial. Las demás
// —sobre todo las 7 exclusivas de admin— sí van con React.lazy: una
// asistente nunca llega a pedir ese código, y el admin lo pide recién cuando
// entra a esa pestaña, no todo junto al abrir la app.
const Citas = lazy(() => import('../pages/Citas.jsx'))
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
const Mobiliario = lazy(() => import('../pages/Mobiliario.jsx'))
const Web = lazy(() => import('../pages/Web.jsx'))
const Deudas = lazy(() => import('../pages/Deudas.jsx'))
const Promociones = lazy(() => import('../pages/Promociones.jsx'))
const PedidosWeb = lazy(() => import('../pages/PedidosWeb.jsx'))
const ResenasWeb = lazy(() => import('../pages/ResenasWeb.jsx'))
const ContactoWeb = lazy(() => import('../pages/ContactoWeb.jsx'))
const PuntosWeb = lazy(() => import('../pages/PuntosWeb.jsx'))
const ReferidosWeb = lazy(() => import('../pages/ReferidosWeb.jsx'))

const PAGINAS = {
  '/ventas': Ventas,
  '/citas': Citas,
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
  '/mobiliario': Mobiliario,
  '/web': Web,
  '/deudas': Deudas,
  '/promociones': Promociones,
  '/pedidos-web': PedidosWeb,
  '/resenas-web': ResenasWeb,
  '/contacto-web': ContactoWeb,
  '/puntos-web': PuntosWeb,
  '/referidos-web': ReferidosWeb,
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
    // Bug real corregido: esto redirigía siempre a "/ventas" a mano, así
    // que una ASISTENTE (sin acceso a Ventas) caía en un loop mudo —
    // pantalla negra permanente, sin ningún contenido. Ahora manda a la
    // primera pestaña que el rol actual sí puede ver.
    return <Navigate to={rutaInicialPara(rol)} replace />
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
