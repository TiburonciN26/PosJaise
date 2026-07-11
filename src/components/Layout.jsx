import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { CarritoProvider } from '../context/CarritoContext.jsx'
import Header from './Header.jsx'
import MenuLateral from './MenuLateral.jsx'

export default function Layout() {
  const [menuAbierto, setMenuAbierto] = useState(false)

  return (
    <CarritoProvider>
      <div className="flex h-svh flex-col bg-bg text-ink">
        <Header
          menuAbierto={menuAbierto}
          onToggleMenu={() => setMenuAbierto((abierto) => !abierto)}
        />

        {/* relative + overflow-hidden: alto fijo (viewport - header), el scroll
            del contenido va dentro de <main>, así el drawer nunca se estira */}
        <div className="relative flex-1 overflow-hidden">
          <main className="h-full overflow-y-auto">
            <Outlet />
          </main>
          <MenuLateral abierto={menuAbierto} onCerrar={() => setMenuAbierto(false)} />
        </div>
      </div>
    </CarritoProvider>
  )
}
