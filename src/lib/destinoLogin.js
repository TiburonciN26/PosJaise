import { rutaInicialPara, secciones } from '../config/navegacion.js'

// Destino tras iniciar sesión. Quien pide login (RutaPrivada, useRequerirSesion o
// el botón «Iniciar sesión» del encabezado) guarda en location.state.desde la ruta
// a la que quería ir; aquí se decide a dónde llega de verdad según su ROL REAL:
//   · CLIENTE → continúa en la web (a `desde` si es una ruta interna, si no a Inicio).
//   · Personal → solo a `desde` si es una pantalla del POS que su rol puede abrir;
//     una página de la web (p. ej. /servicios/:id) no existe en el POS, así que cae
//     en la pantalla inicial de su rol.

// Solo rutas internas absolutas (evita redirecciones abiertas tipo //otro.sitio o
// https://otro.sitio) y nunca el propio login.
export function rutaInternaSegura(ruta) {
  if (typeof ruta !== 'string') return null
  if (!ruta.startsWith('/') || ruta.startsWith('//') || ruta.includes('\\')) return null
  const sinConsulta = ruta.split(/[?#]/)[0]
  if (sinConsulta === '/login') return null
  return ruta
}

function pathDe(ruta) {
  return ruta.split(/[?#]/)[0].replace(/\/+$/, '') || '/'
}

// ¿La ruta es una pantalla del POS (sin importar el rol)? Sirve para pedir login a un
// visitante que abre, por ejemplo, /ventas o /dashboard.
export function esRutaDePersonal(ruta) {
  const segura = rutaInternaSegura(ruta)
  if (!segura) return false
  const path = pathDe(segura)
  return secciones.some((seccion) => seccion.path === path)
}

export function resolverDestino(rol, desde) {
  const segura = rutaInternaSegura(desde)
  if (rol === 'CLIENTE') return segura ?? '/inicio'
  if (segura) {
    const path = pathDe(segura)
    const permitida = secciones.some((seccion) => seccion.path === path && seccion.roles.includes(rol))
    if (permitida) return segura
  }
  return rutaInicialPara(rol)
}
