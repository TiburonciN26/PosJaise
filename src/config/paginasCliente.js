import { createElement, use } from 'react'

// QA-021: el portal cliente (PortalCliente + ~20 páginas) ya no viaja en el
// bundle inicial de todos los roles: cada página es un chunk.
//
// Por qué no React.lazy a secas: React.lazy suspende SIEMPRE en su primer
// render, aunque el módulo ya esté descargado, y React revela con ~300 ms de
// retraso un Suspense cuyo fallback ya se mostró. Medido (vite preview): los
// chunks terminaban a ~190 ms pero el portal aparecía a ~520 ms. Aquí cada
// página es un componente que lee el import con `use()` sobre una promesa a la
// que se le registra su estado (status/value, el mecanismo que React usa para
// resolver de forma síncrona): tras precargar no hay fallback ni espera.
const promesas = new Map()

function cargar(clave, importar) {
  let promesa = promesas.get(clave)
  if (!promesa) {
    promesa = importar()
    promesa.then(
      (modulo) => {
        promesa.status = 'fulfilled'
        promesa.value = modulo
      },
      (error) => {
        promesa.status = 'rejected'
        promesa.reason = error
        promesas.delete(clave)
      },
    )
    promesas.set(clave, promesa)
  }
  return promesa
}

export function paginaPrecargable(clave, importar) {
  function Pagina(props) {
    const modulo = use(cargar(clave, importar))
    return createElement(modulo.default, props)
  }
  Pagina.displayName = clave
  return Pagina
}

export const importadores = {
  PortalCliente: () => import('../pages/PortalCliente.jsx'),
  InicioCliente: () => import('../pages/cliente/InicioCliente.jsx'),
  MiPerfil: () => import('../pages/cliente/MiPerfil.jsx'),
  ServiciosCliente: () => import('../pages/cliente/ServiciosCliente.jsx'),
  DetalleServicioCliente: () => import('../pages/cliente/DetalleServicioCliente.jsx'),
  ProductosCliente: () => import('../pages/cliente/ProductosCliente.jsx'),
  DetalleProductoCliente: () => import('../pages/cliente/DetalleProductoCliente.jsx'),
  CitasCliente: () => import('../pages/cliente/CitasCliente.jsx'),
  HistorialCliente: () => import('../pages/cliente/HistorialCliente.jsx'),
  RecompensasCliente: () => import('../pages/cliente/RecompensasCliente.jsx'),
  NosotrosCliente: () => import('../pages/cliente/NosotrosCliente.jsx'),
  PerfilEquipoCliente: () => import('../pages/cliente/PerfilEquipoCliente.jsx'),
  CarritoCliente: () => import('../pages/cliente/CarritoCliente.jsx'),
  CarritoServiciosCliente: () => import('../pages/cliente/CarritoServiciosCliente.jsx'),
  MisResenasCliente: () => import('../pages/cliente/MisResenasCliente.jsx'),
  DireccionesCliente: () => import('../pages/cliente/DireccionesCliente.jsx'),
  PedidosCliente: () => import('../pages/cliente/PedidosCliente.jsx'),
  NotificacionesCliente: () => import('../pages/cliente/NotificacionesCliente.jsx'),
  SeguridadCuentaCliente: () => import('../pages/cliente/SeguridadCuentaCliente.jsx'),
  ReferidosCliente: () => import('../pages/cliente/ReferidosCliente.jsx'),
}

export const pagina = Object.fromEntries(
  Object.entries(importadores).map(([clave, importar]) => [clave, paginaPrecargable(clave, importar)]),
)

const precargar = (clave) => cargar(clave, importadores[clave])

const RUTAS = [
  [/^\/(inicio)?\/?$/, 'InicioCliente'],
  [/^\/mi-perfil\/?$/, 'MiPerfil'],
  [/^\/servicios\/?$/, 'ServiciosCliente'],
  [/^\/servicios\/[^/]+\/?$/, 'DetalleServicioCliente'],
  [/^\/productos\/?$/, 'ProductosCliente'],
  [/^\/productos\/[^/]+\/?$/, 'DetalleProductoCliente'],
  [/^\/citas\/?$/, 'CitasCliente'],
  [/^\/citas\/carrito\/?$/, 'CarritoServiciosCliente'],
  [/^\/historial\/?$/, 'HistorialCliente'],
  [/^\/recompensas\/?$/, 'RecompensasCliente'],
  [/^\/nosotros\/?$/, 'NosotrosCliente'],
  [/^\/nosotros\/equipo\/[^/]+\/?$/, 'PerfilEquipoCliente'],
  [/^\/carrito\/?$/, 'CarritoCliente'],
  [/^\/mis-resenas\/?$/, 'MisResenasCliente'],
  [/^\/mi-perfil\/direcciones\/?$/, 'DireccionesCliente'],
  [/^\/mi-perfil\/pedidos\/?$/, 'PedidosCliente'],
  [/^\/mi-perfil\/notificaciones\/?$/, 'NotificacionesCliente'],
  [/^\/mi-perfil\/seguridad\/?$/, 'SeguridadCuentaCliente'],
  [/^\/mi-perfil\/referidos\/?$/, 'ReferidosCliente'],
]

// Carga el portal y la página de la URL actual (más Inicio, aterrizaje de la
// clienta) en paralelo; la app espera esa promesa antes de montar el portal.
export function precargarPortalYRuta() {
  const base = import.meta.env.BASE_URL
  const ruta = window.location.pathname.slice(Math.max(base.length - 1, 0)) || '/'
  const nombre = RUTAS.find(([patron]) => patron.test(ruta))?.[1] ?? 'InicioCliente'
  return Promise.all([precargar('PortalCliente'), precargar(nombre), precargar('InicioCliente')])
}

// Mientras se muestra el formulario de login (aún sin saber el rol) se
// descargan en reposo, con prioridad baja, el portal y su página de aterrizaje:
// medido con red limitada, sin esto el CLIENTE esperaba ~0,6 s más tras "Entrar"
// porque esa descarga se había movido del arranque a después del login. El POS
// paga ~45 kB de transferencia a cambio de no cargar ~115 kB que antes sí.
export function precargarPortalEnReposo() {
  const lanzar = () => {
    precargar('PortalCliente').catch(() => {})
    precargar('InicioCliente').catch(() => {})
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(lanzar, { timeout: 3000 })
  else setTimeout(lanzar, 1000)
}

// Con el portal ya visible, en reposo se descargan las pestañas más usadas:
// navegar entre ellas no suspende (ni muestra el fallback).
const PRINCIPALES = [
  'ServiciosCliente', 'ProductosCliente', 'CitasCliente', 'NosotrosCliente',
  'DetalleServicioCliente', 'DetalleProductoCliente', 'RecompensasCliente', 'CarritoCliente',
]
export function precargarPestanasPrincipales() {
  const lanzar = () => PRINCIPALES.forEach((nombre) => precargar(nombre).catch(() => {}))
  if ('requestIdleCallback' in window) window.requestIdleCallback(lanzar, { timeout: 4000 })
  else setTimeout(lanzar, 1500)
}
