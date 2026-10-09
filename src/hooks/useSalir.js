import { useCallback } from 'react'
import { useAuth } from '../context/AuthContext.jsx'

// Cerrar sesión desde cualquier menú (POS o web de clientas) termina en el inicio
// público de la web, no en el formulario de login.
//
// Es una navegación COMPLETA (no navigate()) a propósito: al cerrar sesión el árbol de
// rutas cambia del POS al de visitante; con navigate() la ruta nueva y el cambio de
// árbol se aplican en renders distintos, y por un instante el visitante estaría en la
// ruta del POS (p. ej. /ventas), que lo mandaría al login. Recargar además descarta
// de la memoria todo lo cargado por la sesión anterior (importante en un POS
// compartido). BASE_URL respeta el prefijo de GitHub Pages (/PosJaise/).
export function useSalir() {
  const { cerrarSesion } = useAuth()

  return useCallback(async () => {
    await cerrarSesion()
    window.location.replace(import.meta.env.BASE_URL)
  }, [cerrarSesion])
}
