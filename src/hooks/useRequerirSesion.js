import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'

// Para acciones que de verdad necesitan cuenta (agregar al carrito, favoritos,
// reseñas, reclamar un cupón…). Devuelve una función: true si hay sesión (la
// acción sigue); si no, avisa, lleva a /login guardando la página actual para
// volver aquí después, y devuelve false (la acción NO debe continuar).
//   const requerirSesion = useRequerirSesion()
//   if (!requerirSesion('agregar productos al carrito')) return
export function useRequerirSesion() {
  const { usuario } = useAuth()
  const { mostrarToast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const desde = `${location.pathname}${location.search}`

  return useCallback(
    (motivo) => {
      if (usuario) return true
      mostrarToast(motivo ? `Inicia sesión para ${motivo}.` : 'Inicia sesión para continuar.', 'info')
      navigate('/login', { state: { desde } })
      return false
    },
    [usuario, mostrarToast, navigate, desde],
  )
}
