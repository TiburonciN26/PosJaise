// Fase 9 V2.1 (F9-03b) · Prueba de las funciones del servidor migracion_medios_cambiar / migracion_medios_barrera en el
// Postgres REAL de Supabase Local, con concurrencia real (varias sesiones psql). Solo Local: verifica el puerto del contenedor
// y escribe únicamente en un producto fixture «QA-F9B-…» que crea al empezar y elimina al terminar.
// Uso: node scripts/migracion-medios/probar-plazo-pg.mjs --cuentas=<json con admin y clienteA> [--salida=archivo.json]
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3)
const CUENTAS = JSON.parse(readFileSync(arg('cuentas'), 'utf8'))
const CONTENEDOR = 'supabase_db_WedJaiseReact'
if (!/:54321->8000/.test(execFileSync('docker', ['ps', '--filter', 'name=^supabase_kong_WedJaiseReact$', '--format', '{{.Ports}}'], { encoding: 'utf8' }))) throw new Error('Supabase Local no verificado en 54321')
const argsPsql = ['exec', '-i', CONTENEDOR, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1']
const psql = (sql) => execFileSync('docker', argsPsql, { input: sql, encoding: 'utf8' }).trim()
// Sesión concurrente: devuelve { salida, ms } al terminar (incluye errores en la salida, sin lanzar).
const sesion = (sql) => new Promise((ok) => {
  const t0 = Date.now(), p = spawn('docker', argsPsql.filter((a) => a !== 'ON_ERROR_STOP=1' && a !== '-v'))
  let o = ''; p.stdout.on('data', (x) => (o += x)); p.stderr.on('data', (x) => (o += x))
  p.on('close', () => ok({ salida: o.trim(), ms: Date.now() - t0 })); p.stdin.end(sql)
})
const ESPERA = (ms) => new Promise((r) => setTimeout(r, ms))
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`
const uid = (email) => psql(`select id from auth.users where email = ${lit(email)}`)
const ADMIN = uid(CUENTAS.admin.email), CLIENTA = uid(CUENTAS.clienteA.email)
assert.match(ADMIN, /^[0-9a-f-]{36}$/); assert.match(CLIENTA, /^[0-9a-f-]{36}$/)
assert.equal(psql(`select rol from public.usuarios where id = ${lit(ADMIN)}`), 'ADMINISTRADOR')
// Prefijo de sesión con la identidad de una cuenta (como PostgREST: rol authenticated + claims del JWT).
const como = (id) => `set role authenticated; select set_config('request.jwt.claims', ${lit(JSON.stringify({ sub: id, role: 'authenticated' }))}, false);`
const MARCA = `QA-F9B-${Date.now().toString(36)}`, DE = `${MARCA}/de.webp`, A = `r2:fotos-productos/0d1c3a4e-1b2c-4d5e-8f90-123456789abc`
let FILA
const reiniciarFila = () => psql(`update public.productos set foto_url = ${lit(DE)} where id = ${lit(FILA)}`)
const valor = () => psql(`select foto_url from public.productos where id = ${lit(FILA)}`)
// Plazo calculado con el reloj DEL SERVIDOR, como texto timestamptz que el servidor vuelve a leer.
const venceEn = (ms) => psql(`select (clock_timestamp() + interval '${ms} milliseconds')::text`)
const cambiar = (vence, de = DE, a = A) => `select public.migracion_medios_cambiar('productos', 'foto_url', ${lit(FILA)}, ${lit(de)}, ${lit(a)}, ${lit(vence)});`
const barrera = (vence) => `select public.migracion_medios_barrera('productos', 'foto_url', ${lit(FILA)}, ${lit(vence)});`
const ultimaLinea = (s) => s.split('\n').filter((l) => l && !/^(SET|BEGIN|COMMIT|UPDATE \d+)$/.test(l) && !/^\s*$/.test(l)).at(-1)

const casos = []
async function caso(nombre, fn) {
  try { const detalle = await fn(); casos.push({ nombre, ok: true, detalle }); console.log(`OK    ${nombre}`) } catch (e) {
    casos.push({ nombre, ok: false, error: String(e.message).slice(0, 1500) }); console.log(`FALLA ${nombre}\n      ${String(e.message).slice(0, 600)}`)
  }
}

const auditoriaInicio = Number(psql('select count(*) from public.auditoria'))
FILA = psql(`insert into public.productos (nombre, precio, foto_url) values (${lit(`${MARCA} plazo`)}, 1, ${lit(DE)}) returning id`).split('\n')[0]
try {
  await caso('Plazo vigente: el cambio aplica (hecho); con p_de distinto no (sin-cambio); ya vencido devuelve «vencida» sin tocar la fila', async () => {
    reiniciarFila()
    assert.equal(ultimaLinea(psql(`${como(ADMIN)} ${cambiar(venceEn(5000))}`)), 'hecho'); assert.equal(valor(), A)
    reiniciarFila()
    assert.equal(ultimaLinea(psql(`${como(ADMIN)} ${cambiar(venceEn(5000), 'otro-valor')}`)), 'sin-cambio'); assert.equal(valor(), DE)
    assert.equal(ultimaLinea(psql(`${como(ADMIN)} ${cambiar(venceEn(-1))}`)), 'vencida'); assert.equal(valor(), DE)
  })
  await caso('Barrera antes del plazo: responde «esperar» y no toca la fila; después: «cerrada» con el valor', async () => {
    reiniciarFila()
    const v = venceEn(3000)
    const antes = JSON.parse(ultimaLinea(psql(`${como(ADMIN)} ${barrera(v)}`)))
    assert.equal(antes.estado, 'esperar'); assert.ok(antes.faltan_ms > 0 && antes.faltan_ms <= 3000)
    const despues = JSON.parse(ultimaLinea(psql(`${como(ADMIN)} ${barrera(venceEn(-1))}`)))
    assert.deepEqual(despues, { estado: 'cerrada', existe: true, valor: DE })
    return { antes, despues }
  })
  await caso('EN VUELO: cambio ejecutado antes del plazo y confirmado DESPUÉS; la barrera (tras el plazo) espera ese commit y devuelve el valor nuevo', async () => {
    reiniciarFila()
    const v = venceEn(1500)
    const enVuelo = sesion(`${como(ADMIN)} begin; ${cambiar(v)} select pg_sleep(3.5); commit;`)
    await ESPERA(2200) // ya vencido el plazo; el cambio aplicado sigue sin confirmar
    assert.equal(valor(), DE, 'desde fuera todavía se ve el valor anterior (lo que veía la lectura de reconciliación)')
    const b = await sesion(`${como(ADMIN)} ${barrera(v)}`)
    const r = await enVuelo
    assert.match(r.salida, /hecho/)
    assert.deepEqual(JSON.parse(ultimaLinea(b.salida)), { estado: 'cerrada', existe: true, valor: A }, b.salida)
    assert.ok(b.ms >= 800, `la barrera esperó al commit en vuelo (${b.ms} ms)`)
    assert.equal(valor(), A)
    return { esperaBarreraMs: b.ms }
  })
  await caso('EN VUELO bloqueado por otra transacción que REESCRIBE la fila hasta después del plazo: al desbloquearse re-evalúa el plazo y no aplica', async () => {
    reiniciarFila()
    const v = venceEn(1500)
    const bloqueo = sesion(`begin; update public.productos set foto_url = foto_url where id = ${lit(FILA)}; select pg_sleep(3); commit;`)
    await ESPERA(400)
    const enVuelo = sesion(`${como(ADMIN)} ${cambiar(v)}`) // evalúa antes del plazo y queda esperando el bloqueo
    await Promise.all([bloqueo])
    const r = await enVuelo
    assert.equal(ultimaLinea(r.salida), 'sin-cambio', r.salida); assert.equal(valor(), DE)
    const b = JSON.parse(ultimaLinea(psql(`${como(ADMIN)} ${barrera(v)}`)))
    assert.deepEqual(b, { estado: 'cerrada', existe: true, valor: DE })
    return { cambio: ultimaLinea(r.salida), esperaMs: r.ms }
  })
  await caso('EN VUELO bloqueado por un FOR UPDATE (sin reescribir) hasta después del plazo: el cambio aplica tarde, PERO la barrera queda detrás y lo ve', async () => {
    reiniciarFila()
    const v = venceEn(1500)
    const bloqueo = sesion(`begin; select 1 from public.productos where id = ${lit(FILA)} for update; select pg_sleep(3); commit;`)
    await ESPERA(400)
    const enVuelo = sesion(`${como(ADMIN)} ${cambiar(v)}`)
    await ESPERA(1800) // vencido el plazo, con el cambio todavía esperando el bloqueo
    const barreraP = sesion(`${como(ADMIN)} ${barrera(v)}`)
    const [, r, b] = await Promise.all([bloqueo, enVuelo, barreraP])
    // Medido: sin reescritura el UPDATE en espera no re-evalúa el plazo (por eso la barrera reescribe). Lo que importa: la
    // barrera, encolada detrás del cambio, devuelve el valor que de verdad quedó.
    assert.deepEqual(JSON.parse(ultimaLinea(b.salida)), { estado: 'cerrada', existe: true, valor: valor() }, b.salida)
    return { cambio: ultimaLinea(r.salida), barrera: JSON.parse(ultimaLinea(b.salida)).valor === A ? 'vio el cambio tardío' : 'vio el valor anterior', final: valor() === A ? 'nuevo' : 'anterior' }
  })
  await caso('Permisos: clienta (no admin) → 42501; columna fuera de la lista → 22023; anon sin EXECUTE', async () => {
    reiniciarFila()
    const cli = await sesion(`${como(CLIENTA)} ${cambiar(venceEn(5000))}`)
    assert.match(cli.salida, /solo administración/); assert.equal(valor(), DE)
    const col = await sesion(`${como(ADMIN)} select public.migracion_medios_cambiar('pedidos_web', 'comprobante_url', ${lit(FILA)}, 'a', 'b', ${lit(venceEn(5000))});`)
    assert.match(col.salida, /columna no permitida/)
    const anon = await sesion(`set role anon; ${barrera(venceEn(-1))}`)
    assert.match(anon.salida, /permission denied/)
    return { clienta: ultimaLinea(cli.salida), columna: ultimaLinea(col.salida), anon: ultimaLinea(anon.salida) }
  })
} finally {
  psql(`delete from public.productos where id = ${lit(FILA)}`)
  const quedan = Number(psql(`select count(*) from public.productos where nombre like ${lit(`${MARCA}%`)}`))
  casos.push({ nombre: 'Limpieza: el producto fixture se eliminó', ok: quedan === 0, detalle: { filasDeAuditoriaNuevas: Number(psql('select count(*) from public.auditoria')) - auditoriaInicio } })
}
const fallos = casos.filter((c) => !c.ok)
const salida = arg('salida')
if (salida) writeFileSync(salida, JSON.stringify({ fecha: new Date().toISOString(), entorno: 'Postgres 17 de Supabase Local (127.0.0.1:54321), sesiones psql concurrentes como admin QA por claims; fixture propio eliminado al terminar', marca: MARCA, total: casos.length, fallos: fallos.length, casos }, null, 1))
console.log(`\n${casos.length - fallos.length}/${casos.length} correctos`)
process.exit(fallos.length ? 1 : 0)
