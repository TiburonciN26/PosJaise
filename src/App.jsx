import { lazy, Suspense, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { rutaInicialPara } from './config/navegacion.js'
import { pagina, precargarPortalYRuta } from './config/paginasCliente.js'
import RutaProtegida from './components/RutaProtegida.jsx'
import Layout from './components/Layout.jsx'
import PestanasCacheadas from './components/PestanasCacheadas.jsx'

// B5 de la 2ª auditoría: por consistencia con el resto de las pantallas
// (ver PestanasCacheadas), aunque el impacto es mínimo — Login es liviana.
const Login = lazy(() => import('./pages/Login.jsx'))

// QA-021: el portal cliente (PortalCliente + ~20 páginas) viajaba en el bundle
// inicial de TODOS los roles, incluido el POS que jamás lo usa. Ahora cada página
// es un chunk precargable (ver config/paginasCliente.js por qué no React.lazy).
const { PortalCliente } = pagina
const { InicioCliente, MiPerfil, ServiciosCliente, DetalleServicioCliente, ProductosCliente, DetalleProductoCliente, CitasCliente, HistorialCliente, FidelizacionCliente, OfertasCliente, NosotrosCliente, CarritoCliente, CarritoServiciosCliente, MisResenasCliente, MisPuntosCliente, DireccionesCliente, PedidosCliente, NotificacionesCliente, SeguridadCuentaCliente, ReferidosCliente } = pagina

function CargandoPantalla() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-bg">
      <p className="font-mono text-sm text-ink/60">Cargando...</p>
    </main>
  )
}

function App() {
  const { cargando, session, usuario, rol, modoVista, errorPerfil, reintentarPerfil } = useAuth()
  // Personal (asistente/cajera/admin) que activó su perfil de clienta
  // (MenuUsuario.jsx → "Mi perfil de clienta") y eligió mirarlo: monta el
  // árbol de rutas de cliente con la MISMA sesión, sin dejar de ser
  // personal (rol sigue siendo el suyo real — ver AuthContext.jsx). Un
  // cliente puro (rol === 'CLIENTE', sin fila en "usuarios") no depende
  // de esto en absoluto, siempre entra por la primera condición.
  const vistaCliente = rol === 'CLIENTE' || (Boolean(rol) && rol !== 'CLIENTE' && modoVista === 'CLIENTE')

  // El portal (y la página de la URL actual) se descargan ANTES de montarlo, con
  // el mismo "Cargando..." de siempre: así React no muestra ni estrangula un
  // fallback de Suspense (~300 ms medidos) y los POS no descargan nada de esto.
  const [portalListo, setPortalListo] = useState(false)
  useEffect(() => {
    if (!vistaCliente) return undefined
    let vigente = true
    precargarPortalYRuta()
      .catch(() => {})
      .then(() => vigente && setPortalListo(true))
    return () => {
      vigente = false
    }
  }, [vistaCliente])

  if (cargando) {
    return <CargandoPantalla />
  }

  // Hay sesión válida pero el perfil no se pudo leer (fallo de red): sin
  // esto, RutaProtegida rebotaría al login aunque la sesión siga viva —
  // pantalla de reintento en vez de pedir credenciales que ya son correctas.
  if (session && !usuario && errorPerfil) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-bg p-6 text-center">
        <p className="text-lg font-semibold text-ink">Sin conexión</p>
        <p className="max-w-sm text-sm text-ink/60">
          No se pudo cargar tu perfil. Revisa tu conexión a internet e intenta de nuevo.
        </p>
        <button
          type="button"
          onClick={reintentarPerfil}
          className="rounded-lg bg-amber px-4 py-2 text-sm font-semibold text-bg"
        >
          Reintentar
        </button>
      </main>
    )
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <Routes>
        <Route
          path="/login"
          element={
            <Suspense fallback={<CargandoPantalla />}>
              <Login />
            </Suspense>
          }
        />

        <Route element={<RutaProtegida />}>
          {vistaCliente ? (
            // Un cliente puro nunca monta Layout/MenuLateral (eso es del
            // POS, solo para personal) — su único árbol es este. Personal
            // en "modo cliente" (ver arriba) también cae acá, con la misma
            // sesión — MenuUsuarioCliente.jsx le suma un botón para volver.
            <Route
              element={
                portalListo ? (
                  <Suspense fallback={<CargandoPantalla />}>
                    <PortalCliente />
                  </Suspense>
                ) : (
                  <CargandoPantalla />
                )
              }
            >
              <Route index element={<Navigate to="/inicio" replace />} />
              <Route path="inicio" element={<InicioCliente />} />
              <Route path="mi-perfil" element={<MiPerfil />} />
              <Route path="servicios" element={<ServiciosCliente />} />
              <Route path="servicios/:id" element={<DetalleServicioCliente />} />
              <Route path="productos" element={<ProductosCliente />} />
              <Route path="productos/:id" element={<DetalleProductoCliente />} />
              <Route path="citas" element={<CitasCliente />} />
              <Route path="citas/carrito" element={<CarritoServiciosCliente />} />
              <Route path="historial" element={<HistorialCliente />} />
              <Route path="fidelizacion" element={<FidelizacionCliente />} />
              <Route path="ofertas" element={<OfertasCliente />} />
              <Route path="nosotros" element={<NosotrosCliente />} />
              <Route path="carrito" element={<CarritoCliente />} />
              <Route path="mis-resenas" element={<MisResenasCliente />} />
              <Route path="mis-puntos" element={<MisPuntosCliente />} />
              <Route path="mi-perfil/direcciones" element={<DireccionesCliente />} />
              <Route path="mi-perfil/pedidos" element={<PedidosCliente />} />
              <Route path="mi-perfil/notificaciones" element={<NotificacionesCliente />} />
              <Route path="mi-perfil/seguridad" element={<SeguridadCuentaCliente />} />
              <Route path="mi-perfil/referidos" element={<ReferidosCliente />} />
              <Route path="*" element={<Navigate to="/inicio" replace />} />
            </Route>
          ) : (
            <Route element={<Layout />}>
              <Route index element={<Navigate to={rutaInicialPara(rol)} replace />} />
              {/* Un solo comodín: así el router nunca desmonta PestanasCacheadas
                  al cambiar de pestaña; ella decide sola qué mostrar/ocultar y
                  aplica el guard de rol (antes hecho por RutaAdmin). */}
              <Route path="*" element={<PestanasCacheadas />} />
            </Route>
          )}
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
