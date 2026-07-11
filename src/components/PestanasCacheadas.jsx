import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { secciones } from '../config/navegacion.js'
import Ventas from '../pages/Ventas.jsx'
import Inventario from '../pages/Inventario.jsx'
import Historial from '../pages/Historial.jsx'
import Servicios from '../pages/Servicios.jsx'
import Dashboard from '../pages/Dashboard.jsx'
import MiPanel from '../pages/MiPanel.jsx'
import Estadisticas from '../pages/Estadisticas.jsx'
import Auditoria from '../pages/Auditoria.jsx'
import Clientes from '../pages/Clientes.jsx'
import Porcentajes from '../pages/Porcentajes.jsx'
import Gastos from '../pages/Gastos.jsx'
import Asistentes from '../pages/Asistentes.jsx'

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
            <Pagina activo={activa} />
          </div>
        )
      })}
    </>
  )
}
