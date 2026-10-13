import { createElement, use } from 'react'

// Fase 8 V2 (F8-01): componentes cargados con import() que se pueden REINTENTAR y PRECARGAR.
//
// Con el precaché reducido de la Fase 8 una pantalla/modal que nunca se abrió no está en este dispositivo: sin red, o
// después de una publicación que retiró los archivos de la versión en uso, su import() falla. React.lazy guarda ese
// rechazo para siempre (no hay forma de reintentar sin recargar la página, y recargar borra la venta en curso). Aquí:
//   · el rechazo se CONSERVA hasta que alguien llame a `reintentar()` (un límite de error local, al pulsar «Reintentar»,
//     al volver la red o al volver a la pestaña). Si se descartara solo, React volvería a renderizar, pediría el módulo
//     otra vez y quedaría en un bucle de descargas fallidas mientras no haya red;
//   · `precargar()` descarga y evalúa el módulo en reposo. Un módulo ya evaluado queda en memoria del documento: abrir esa
//     pantalla después no necesita red ni los archivos del servidor. Si la precarga falla no deja el rechazo guardado
//     (la apertura real lo vuelve a intentar);
//   · se lee con `use()` sobre una promesa con estado (mismo mecanismo que config/paginasCliente.js): tras precargar no
//     hay fallback de Suspense.
//
// Reintentar de verdad exige OTRA URL: el navegador guarda el fallo de un import() en el mapa de módulos del documento y no
// vuelve a pedir esa URL hasta recargar (medido en Chromium: un segundo import() de la misma URL falla sin tocar la red).
// Por eso el reintento importa la URL que falló con `?reintento=N` (un módulo nuevo). Sus dependencias se piden con su URL
// normal: por eso vite.config.js no precarga con <link rel=modulepreload> las dependencias JS de estos imports (un
// modulepreload fallido sin red dejaría envenenada la dependencia del mismo modo). Si aun así falla una dependencia, el
// aviso sigue ofreciendo los controles seguros (volver a la venta; recargar solo sin trabajo pendiente).
export function componenteDiferido(importar, nombre) {
  let promesa = null
  let urlFallida = null
  let reintentos = 0

  function cargar() {
    if (!promesa) {
      const actual = urlFallida ? import(/* @vite-ignore */ conReintento(urlFallida, ++reintentos)) : importar()
      promesa = actual
      actual.then(
        (modulo) => {
          actual.status = 'fulfilled'
          actual.value = modulo
        },
        (error) => {
          actual.status = 'rejected'
          actual.reason = error
          urlFallida = urlDelError(error) ?? urlFallida
        },
      )
    }
    return promesa
  }

  function reintentar() {
    if (promesa?.status === 'rejected') promesa = null
  }

  function Componente(props) {
    const modulo = use(cargar())
    return createElement(modulo.default, props)
  }
  Componente.displayName = nombre
  Componente.reintentar = reintentar
  Componente.precargar = () =>
    cargar().then(
      () => true,
      () => {
        reintentar()
        return false
      },
    )
  return Componente
}

// Chromium y Firefox incluyen en el mensaje la URL del módulo que no se pudo importar (Safari no: ahí se reintenta igual).
function urlDelError(error) {
  const encontrada = String(error?.message ?? '').match(/https?:\/\/[^\s'"]+?\.js(?=[?#\s'"]|$)/)?.[0]
  return encontrada && new URL(encontrada).origin === window.location.origin ? encontrada : null
}

function conReintento(url, n) {
  const u = new URL(url)
  u.searchParams.set('reintento', String(n))
  return u.href
}

// Mensajes con que cada motor rechaza un import() cuyo archivo no llega (sin red, 404, o el HTML del fallback de SPA en
// lugar del JS), más el error de Vite al no poder precargar el CSS de un chunk.
const ERRORES_DE_CARGA = [
  /Failed to fetch dynamically imported module/i, // Chromium
  /error loading dynamically imported module/i, // Firefox
  /Importing a module script failed/i, // Safari
  /Unable to preload CSS/i, // Vite
  /Expected a JavaScript.* module script/i,
]

/** ¿El error es de DESCARGA de código (y no un fallo de la propia pantalla)? */
export function esErrorDeCarga(error) {
  if (!error) return false
  if (error.name === 'ChunkLoadError') return true
  const mensaje = String(error.message ?? error)
  return ERRORES_DE_CARGA.some((patron) => patron.test(mensaje))
}
