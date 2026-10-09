import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

// Guard de las rutas PRIVADAS de la web de clientas (perfil, historial, citas,
// pedidos, direcciones, notificaciones, seguridad…). Un visitante nunca monta la
// pantalla —por eso tampoco dispara sus consultas—: va a /login guardando en
// location.state.desde la ruta pedida para continuar ahí tras iniciar sesión.
// Con sesión no hace nada (el árbol de rutas ya fue elegido por rol en App.jsx).
export default function RutaPrivada() {
  const { usuario } = useAuth()
  const location = useLocation()

  if (!usuario) {
    return <Navigate to="/login" replace state={{ desde: `${location.pathname}${location.search}` }} />
  }

  return <Outlet />
}
