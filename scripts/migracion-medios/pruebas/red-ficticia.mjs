// Preload de PRUEBA (node --import): redirige los hosts ficticios `*.qa.invalid` (y, como red de seguridad, el Supabase de
// producción) al servidor HTTP en memoria de probar-cli.mjs, marcando el host pedido en `x-qa-host`. Cualquier otro host no
// local se BLOQUEA: ninguna prueba puede conectar con un remoto real. Mapa en QA_F9_REDIRIGIR = {"host": "http://127.0.0.1:N"}.
const MAPA = JSON.parse(process.env.QA_F9_REDIRIGIR ?? '{}')
const LOCALES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])
const original = globalThis.fetch

globalThis.fetch = async (entrada, init = {}) => {
  const url = new URL(typeof entrada === 'string' || entrada instanceof URL ? String(entrada) : entrada.url)
  if (LOCALES.has(url.hostname)) return original(entrada, init)
  const destino = MAPA[url.host]
  if (!destino) throw new TypeError(`conexión externa bloqueada por la prueba: ${url.host}`)
  if (entrada instanceof Request) {
    init = { method: entrada.method, headers: entrada.headers, body: ['GET', 'HEAD'].includes(entrada.method) ? undefined : await entrada.arrayBuffer(), ...init }
  }
  const headers = new Headers(init.headers ?? {})
  headers.set('x-qa-host', url.host)
  return original(`${destino}${url.pathname}${url.search}`, { ...init, headers })
}
