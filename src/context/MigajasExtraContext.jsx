import { createContext, useContext, useEffect, useMemo } from 'react'
import { useLocation } from 'react-router-dom'

// Niveles extra de la migaja del header del portal de clientes para rutas dinámicas que no están en
// navegacionCliente.js (ej. /servicios/:id → «Inicio | Servicios | Categoría | Nombre»). PortalCliente guarda el estado y
// provee el registrador; la pantalla de detalle llama a useRegistrarMigajas con sus niveles: {titulo, ruta?}. Sin `ruta` el
// nivel es solo texto. Se limpia al salir de la pantalla.
export const MigajasExtraContext = createContext(() => {})

export function useRegistrarMigajas(niveles) {
  const registrar = useContext(MigajasExtraContext)
  const { pathname } = useLocation()
  const clave = JSON.stringify(niveles)
  const estables = useMemo(() => JSON.parse(clave), [clave])

  useEffect(() => {
    registrar({ pathname, niveles: estables })
    return () => registrar(null)
  }, [registrar, pathname, estables])
}
