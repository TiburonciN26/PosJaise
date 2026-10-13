import { componenteDiferido } from '../lib/moduloDiferido.js'

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
//
// Fase 8 V2 (F8-01): ese mecanismo vive ahora en lib/moduloDiferido.js (lo comparte el POS). Antes, una página cuya
// descarga fallaba se borraba del registro y el siguiente render la volvía a pedir: sin red eso es un bucle de descargas
// fallidas. Ahora el fallo se conserva hasta reintentarlo explícitamente (reintentarPaginasFallidas, que llama el límite de
// error local de PortalCliente al pulsar «Reintentar», al volver la red o al cambiar de ruta).

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
  LibroReclamacionesCliente: () => import('../pages/cliente/LibroReclamacionesCliente.jsx'),
  TerminosCliente: () => import('../pages/cliente/TerminosCliente.jsx'),
  PoliticaCambiosCliente: () => import('../pages/cliente/PoliticaCambiosCliente.jsx'),
  PrivacidadCliente: () => import('../pages/cliente/PrivacidadCliente.jsx'),
}

export const pagina = Object.fromEntries(
  Object.entries(importadores).map(([clave, importar]) => [clave, componenteDiferido(importar, clave)]),
)

// Resuelve true/false (nunca rechaza): una precarga fallida no deja la página rota, se vuelve a pedir al abrirla.
const precargar = (clave) => pagina[clave].precargar()

/** Descarta los fallos de descarga guardados: el próximo render vuelve a pedir esas páginas. */
export function reintentarPaginasFallidas() {
  for (const Pagina of Object.values(pagina)) Pagina.reintentar()
}

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
  [/^\/libro-de-reclamaciones\/?$/, 'LibroReclamacionesCliente'],
  [/^\/terminos-y-condiciones\/?$/, 'TerminosCliente'],
  [/^\/politica-de-cambios-y-devoluciones\/?$/, 'PoliticaCambiosCliente'],
  [/^\/politica-de-privacidad\/?$/, 'PrivacidadCliente'],
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
// Fase 8: con «ahorrar datos» (Save-Data) o una conexión 2G no se precargan en reposo las 8 pestañas (~330 kB de JS que quizá no se usen);
// cada una se descarga al navegar a ella, como siempre ocurría con las demás páginas del portal. Con una conexión normal no cambia nada.
function conexionLimitada() {
  const c = typeof navigator !== 'undefined' ? navigator.connection : undefined
  return c?.saveData === true || /(^|-)2g$/.test(c?.effectiveType ?? '')
}

export function precargarPestanasPrincipales() {
  if (conexionLimitada()) return
  const lanzar = () => PRINCIPALES.forEach((nombre) => precargar(nombre).catch(() => {}))
  if ('requestIdleCallback' in window) window.requestIdleCallback(lanzar, { timeout: 4000 })
  else setTimeout(lanzar, 1500)
}
