// Generador de la Content-Security-Policy (scripts/lib/csp.mjs). Sin base de datos ni navegador:
//   node --test tests/e2e/csp.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { agregarCspAHeaders, construirCsp, hashesDeScriptsInline, NOMBRE_CABECERA, origenDe } from '../../scripts/lib/csp.mjs'

const directiva = (politica, nombre) => politica.split('; ').find((d) => d.startsWith(`${nombre} `))?.split(' ').slice(1) ?? null

test('origenDe: solo URLs absolutas http(s); relativas, vacías o raras → null', () => {
  assert.equal(origenDe('https://abc.supabase.co/rest/v1?x=1'), 'https://abc.supabase.co')
  assert.equal(origenDe('http://127.0.0.1:54321'), 'http://127.0.0.1:54321')
  for (const malo of [undefined, '', '/__supabase', 'javascript:alert(1)', 'ftp://x.com', 'no es url']) assert.equal(origenDe(malo), null, String(malo))
})

test('hashes: uno por <script> inline con contenido; los que tienen src no cuentan', () => {
  const html = '<script>var a=1</script><script type="module" src="/x.js"></script><script>  </script><SCRIPT>b()</SCRIPT>'
  const esperado = (c) => `'sha256-${createHash('sha256').update(c).digest('base64')}'`
  assert.deepEqual(hashesDeScriptsInline(html), [esperado('var a=1'), esperado('b()')])
})

test('hashes: CRLF se normaliza a LF como hace el parser HTML (si no, el navegador no reconoce el hash)', () => {
  const esperado = `'sha256-${createHash('sha256').update('a()\n  b()\n').digest('base64')}'`
  assert.deepEqual(hashesDeScriptsInline('<script>a()\r\n  b()\r\n</script>'), [esperado])
  assert.deepEqual(hashesDeScriptsInline('<script>a()\r  b()\r</script>'), [esperado])
})

test('la política usa los orígenes del entorno: Supabase (https y wss), medios y bases reconocidas', () => {
  const p = construirCsp({
    VITE_SUPABASE_URL: 'https://abc.supabase.co',
    VITE_MEDIOS_API_URL: 'https://medios-api.ejemplo.workers.dev/v1',
    VITE_MEDIOS_PUBLIC_URL: 'https://medios.ejemplo.pe/',
    VITE_MEDIOS_BASES_RECONOCIDAS: 'https://pub-x.r2.dev/a, https://medios.ejemplo.pe/b',
  }, ["'sha256-AAA='"])
  assert.deepEqual(directiva(p, 'connect-src'), ["'self'", 'https://abc.supabase.co', 'wss://abc.supabase.co', 'https://medios-api.ejemplo.workers.dev', 'https://medios.ejemplo.pe', 'https://pub-x.r2.dev', 'https://*.culqi.com'])
  assert.deepEqual(directiva(p, 'img-src'), ["'self'", 'data:', 'blob:', 'https://abc.supabase.co', 'https://medios.ejemplo.pe', 'https://pub-x.r2.dev'])
  assert.ok(directiva(p, 'script-src').includes("'sha256-AAA='"))
})

test('sin variables (build local sin .env) la política sigue siendo válida y estricta', () => {
  const p = construirCsp({}, [])
  assert.deepEqual(directiva(p, 'default-src'), ["'self'"])
  assert.deepEqual(directiva(p, 'connect-src'), ["'self'", 'https://*.culqi.com'])
  assert.ok(!p.includes('undefined') && !p.includes('null'))
})

test('Turnstile (Libro de Reclamaciones): su script y su iframe, y nada más de Cloudflare', () => {
  const p = construirCsp({}, [])
  assert.ok(directiva(p, 'script-src').includes('https://challenges.cloudflare.com'))
  assert.ok(directiva(p, 'frame-src').includes('https://challenges.cloudflare.com'))
  assert.ok(!directiva(p, 'connect-src').includes('https://challenges.cloudflare.com'))
})

test('nunca permite scripts inline sin hash, eval, objetos ni que otro sitio la enmarque', () => {
  const p = construirCsp({ VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }, [])
  const script = directiva(p, 'script-src')
  assert.ok(!script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'") && !script.includes('*'))
  assert.deepEqual(directiva(p, 'object-src'), ["'none'"])
  assert.deepEqual(directiva(p, 'frame-ancestors'), ["'none'"])
  assert.deepEqual(directiva(p, 'base-uri'), ["'self'"])
  assert.ok(directiva(p, 'connect-src').includes('ws://127.0.0.1:54321'), 'Realtime local usa ws://')
})

test('agregarCspAHeaders escribe UNA línea en el bloque /* (CRLF o LF) y rechaza una CSP escrita a mano', () => {
  for (const eol of ['\r\n', '\n']) {
    const dir = mkdtempSync(join(tmpdir(), 'csp-'))
    try {
      writeFileSync(join(dir, 'index.html'), '<html><head><script>tema()</script></head></html>')
      writeFileSync(join(dir, '_headers'), ['# c', '/*', "  Content-Security-Policy: frame-ancestors 'none'", '', '/assets/*', '  Cache-Control: x', ''].join(eol))
      const politica = agregarCspAHeaders(dir, { VITE_SUPABASE_URL: 'https://abc.supabase.co' })
      const lineas = readFileSync(join(dir, '_headers'), 'utf8').split(eol)
      assert.equal(lineas[2], `  ${NOMBRE_CABECERA}: ${politica}`)
      assert.equal(lineas[1], '/*')
      assert.equal(lineas[3], "  Content-Security-Policy: frame-ancestors 'none'")
      assert.ok(politica.includes(hashesDeScriptsInline('<script>tema()</script>')[0]))
      assert.throws(() => agregarCspAHeaders(dir, {}), /ya trae una CSP/) // dos veces = error, no dos líneas
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})
