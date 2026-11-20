import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { CarritoProvider } from '../context/CarritoContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { detenerPresencia, iniciarPresencia } from '../lib/presenciaPersonal.js'
import Header from './Header.jsx'
import MenuLateral from './MenuLateral.jsx'
import AvisoNegocioCerrado from './AvisoNegocioCerrado.jsx'

// `children`: el POS se monta como <Layout><PestanasCacheadas /></Layout> (components/ArmazonPos.jsx). Sin hijos sigue
// sirviendo como ruta de diseño con <Outlet />.
export default function Layout({ children }) {
  const [menuAbierto, setMenuAbierto] = useState(false)
  const { usuario } = useAuth()

  // Presencia en tiempo real (pestaña Personal → «En línea»): mientras haya una sesión del POS abierta, esta cuenta se
  // anuncia en el canal. Al cerrar sesión, pasar a «modo cliente» o cerrar la pestaña, deja de estarlo.
  const usuarioId = usuario?.id
  useEffect(() => {
    if (!usuarioId) return undefined
    iniciarPresencia(usuarioId)
    return () => detenerPresencia()
  }, [usuarioId])

  return (
    <CarritoProvider>
      <div className="flex h-svh flex-col bg-bg text-ink">
        <Header
          menuAbierto={menuAbierto}
          onToggleMenu={() => setMenuAbierto((abierto) => !abierto)}
        />

        {/* relative + overflow-hidden: alto fijo (viewport - header), el scroll
            del contenido va dentro de <main>, así el drawer nunca se estira.
            md+ (tablets y PC): fila con el menú fijo a la izquierda y el contenido al lado;
            en móvil el menú es un cajón absoluto encima del contenido. */}
        <div className="relative flex flex-1 overflow-hidden">
          <MenuLateral abierto={menuAbierto} onCerrar={() => setMenuAbierto(false)} />
          <main className="h-full min-w-0 flex-1 overflow-y-auto">
            {children ?? <Outlet />}
          </main>
        </div>
      </div>

      <AvisoNegocioCerrado />
    </CarritoProvider>
  )
}
