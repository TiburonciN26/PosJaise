// Fase 8 V2 (F8-02) · Reglas de la caché POR USO del service worker. Lo importa sw.js (workbox.importScripts en
// vite.config.js); las reglas runtimeCaching de allí solo llaman a estas funciones. Es un script clásico de service worker,
// no pasa por Vite: sin imports ni sintaxis de módulo.
//
// Contrato: solo se guardan recursos ESTÁTICOS PÚBLICOS DEL BUILD, reconocidos por su espacio de nombres bajo el alcance del
// service worker (`/` en Cloudflare, `/PosJaise/` en GitHub Pages), sin query string y con el tipo de contenido esperado.
// «Mismo origen» NO basta: con VITE_SUPABASE_URL relativa (`/__supabase`, modo móvil) la API, Storage y las URLs firmadas
// de comprobantes viven en el mismo origen. Nunca se guardan: datos/Storage/Auth/Realtime/Functions (ni por el proxy), /medios
// (fotos del negocio con retirada propia), nada con query (?token=… de las URLs firmadas), respuestas de error,
// redirigidas, opacas, `private`/`no-store`, ni el index.html que el fallback de SPA devuelve con 200 en lugar de un
// archivo que ya no existe (guardarlo envenenaría esa URL durante 30 días).
;(function (alcance) {
  const raiz = new URL(alcance.registration.scope).pathname // '/' o '/PosJaise/'
  const ASSET = /^assets\/[^/]+\.(js|css|woff2?|ttf|png|jpe?g|webp|avif|svg)$/
  const IMAGEN_PUBLICA = /^(?:(?:inicio-web|icons)\/[^/]+\.(png|jpe?g|webp|avif|svg)|(?:favicon[\w-]*|icon-[\w-]+)\.(png|ico)|icons\.(svg))$/
  // Defensa explícita además de la lista positiva: rutas de datos o privadas, bajo cualquier prefijo.
  const PRIVADA = /(?:^|\/)(?:__supabase|medios)(?:\/|$)|\/(?:rest|auth|storage|functions|realtime|graphql)\/v\d+(?:\/|$)|\/object\/(?:sign|authenticated)\//
  const TIPOS = {
    js: /javascript|ecmascript/,
    css: /^text\/css/,
    woff: /^font\/|^application\/(?:x-)?font|^application\/octet-stream/,
    woff2: /^font\/|^application\/(?:x-)?font|^application\/octet-stream/,
    ttf: /^font\/|^application\/(?:x-)?font|^application\/octet-stream/,
    ico: /^image\//,
    svg: /^image\/svg\+xml/,
  }

  // Ruta relativa al alcance, o null si la petición no es de este sitio/alcance o lleva query/hash.
  function relativa(url) {
    const u = typeof url === 'string' ? new URL(url, alcance.location.href) : url
    if (u.origin !== alcance.location.origin || u.search !== '' || u.hash !== '') return null
    if (!u.pathname.startsWith(raiz)) return null
    const rel = u.pathname.slice(raiz.length)
    return PRIVADA.test('/' + rel) ? null : rel
  }
  function extension(rel, patron) {
    const m = rel === null ? null : rel.match(patron)
    return m ? (m.slice(1).find(Boolean) ?? null) : null
  }

  /** Chunk/CSS/fuente/imagen con hash del propio build (CacheFirst). */
  function esAssetDelBuild(url) {
    return extension(relativa(url), ASSET) !== null
  }
  /** Imagen pública de nombre fijo del build: hero de Inicio, íconos, favicons (StaleWhileRevalidate). */
  function esImagenPublica(url) {
    return extension(relativa(url), IMAGEN_PUBLICA) !== null
  }

  /** ¿Se puede guardar esta respuesta para esta URL? */
  function guardable(url, respuesta, patron) {
    if (!respuesta || respuesta.status !== 200 || respuesta.type !== 'basic' || respuesta.redirected) return false
    if (/(?:^|,)\s*(?:no-store|private)\b/i.test(respuesta.headers.get('Cache-Control') ?? '')) return false
    const ext = extension(relativa(url), patron)
    if (ext === null) return false
    const tipo = (respuesta.headers.get('Content-Type') ?? '').toLowerCase()
    const esperado = TIPOS[ext] ?? /^image\//
    return esperado.test(tipo)
  }
  const respuestaDeAsset = (url, r) => guardable(url, r, ASSET)
  const respuestaDeImagen = (url, r) => guardable(url, r, IMAGEN_PUBLICA)

  alcance.reglasCache = { esAssetDelBuild, esImagenPublica, respuestaDeAsset, respuestaDeImagen }

  // Al activarse una versión nueva: retirar de las cachés por uso SOLO las entradas que estas reglas no admitirían (p. ej.
  // las que guardó la regla anterior, demasiado amplia: una imagen firmada del proxy, un index.html guardado como chunk).
  // Lo válido se conserva: puede ser código que una pestaña abierta de la versión anterior todavía necesita.
  const CACHES = { 'assets-por-uso': respuestaDeAsset, 'imagenes-del-sitio': respuestaDeImagen }
  async function retirarEntradasIndebidas() {
    const retiradas = []
    for (const [nombre, admite] of Object.entries(CACHES)) {
      if (!(await alcance.caches.has(nombre))) continue
      const cache = await alcance.caches.open(nombre)
      for (const peticion of await cache.keys()) {
        const respuesta = await cache.match(peticion)
        if (!admite(peticion.url, respuesta)) {
          await cache.delete(peticion)
          retiradas.push(peticion.url)
        }
      }
    }
    return retiradas
  }
  alcance.reglasCache.retirarEntradasIndebidas = retirarEntradasIndebidas
  if (typeof alcance.addEventListener === 'function') {
    alcance.addEventListener('activate', (evento) => evento.waitUntil(retirarEntradasIndebidas().catch(() => [])))
  }
})(self)
