import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

export default function RutaAdmin() {
  const { rol } = useAuth()

  if (rol !== 'ADMINISTRADOR') {
    return <Navigate to="/ventas" replace />
  }

  return <Outlet />
}
