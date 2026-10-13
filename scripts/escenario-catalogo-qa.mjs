// Escenarios de escala de los catálogos públicos (Fase 4) sobre el Supabase LOCAL de QA. Solo local, reversible y con respaldo.
//   node scripts/escenario-catalogo-qa.mjs estado
//   node scripts/escenario-catalogo-qa.mjs reducir  --respaldo=<archivo.json> [--productos=300] [--servicios=100]
//   node scripts/escenario-catalogo-qa.mjs restaurar --respaldo=<archivo.json>
//   node scripts/escenario-catalogo-qa.mjs sembrar-categorias [--categorias=25] [--por-categoria=6]
//   node scripts/escenario-catalogo-qa.mjs limpiar-categorias
//
// «sembrar-categorias» agrega categorías ficticias (nombres «QA F4 …»: «QA F4 Cat 01», «QA F4 Cat 02», …, con productos y servicios
// activos y con stock) para probar catálogos con MUCHAS categorías; «limpiar-categorias» borra exactamente esas filas por su prefijo.
// Misma guarda de destino y mismo cuidado con la bitácora (disparadores suspendidos solo dentro de la transacción).
//
// «reducir» deja activos solo N productos y M servicios (primero los que tienen categoría, luego por nombre e id) para medir un
// catálogo del tamaño del negocio sin perder la réplica de miles: las filas desactivadas se guardan por id en el respaldo y
// «restaurar» las reactiva y comprueba que los conteos vuelven EXACTAMENTE a los originales. Los disparadores de auditoría se
// desactivan solo dentro de la transacción (session_replication_role=replica) para no ensuciar la bitácora local con miles de filas.
// Guardas: contenedor Postgres de la pila WedJaiseReact (la que atiende http://127.0.0.1:54321), base «postgres», y nunca
// se ejecuta si el respaldo ya existe al reducir (evita pisar un respaldo vivo y perder el estado original).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const CONTENEDOR_DB = 'supabase_db_WedJaiseReact'
const CONTENEDOR_API = 'supabase_kong_WedJaiseReact'
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? '').slice(n.length + 3)
const orden = process.argv[2]
const falla = (m) => { console.error('escenario-catalogo-qa: ' + m); process.exit(1) }

function docker(args, input) {
  return execFileSync('docker', args, { encoding: 'utf8', input, maxBuffer: 1 << 27 })
}
function psql(sql) {
  return docker(['exec', '-i', CONTENEDOR_DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'], sql).trim()
}

// Guarda: este contenedor DEBE ser el que atiende el puerto 54321 que usa la app local.
const puertos = docker(['ps', '--filter', `name=^${CONTENEDOR_API}$`, '--format', '{{.Ports}}']).trim()
if (!/:54321->8000\/tcp/.test(puertos)) falla(`${CONTENEDOR_API} no atiende 54321 (puertos: «${puertos}»); no se toca nada.`)
if (psql('select current_database()') !== 'postgres') falla('base de datos inesperada.')

const conteos = () => {
  const [p, ps, s, ss] = psql(`select (select count(*) from productos), (select count(*) from productos where activo), (select count(*) from servicios), (select count(*) from servicios where activo)`).split('|')
  return { productos: Number(p), productosActivos: Number(ps), servicios: Number(s), serviciosActivos: Number(ss) }
}

if (orden === 'estado') {
  console.log(JSON.stringify(conteos()))
} else if (orden === 'reducir') {
  const archivo = arg('respaldo') && resolve(arg('respaldo'))
  if (!archivo) falla('falta --respaldo=<archivo.json>')
  if (existsSync(archivo)) falla(`el respaldo ${archivo} ya existe: restáurelo antes de reducir otra vez.`)
  const nProductos = Number(arg('productos') || 300)
  const nServicios = Number(arg('servicios') || 100)
  if (!Number.isInteger(nProductos) || nProductos < 1 || !Number.isInteger(nServicios) || nServicios < 1) falla('--productos y --servicios deben ser enteros positivos.')
  const antes = conteos()
  if (antes.productosActivos <= nProductos && antes.serviciosActivos <= nServicios) falla('no hay nada que reducir (ya hay pocos activos).')
  const idsDe = (tabla, n) => psql(`
    select id from ${tabla} where activo and id not in (
      select id from ${tabla} where activo order by (categoria is null), nombre, id limit ${n}
    ) order by id`).split('\n').filter(Boolean)
  const productos = idsDe('productos', nProductos)
  const servicios = idsDe('servicios', nServicios)
  // El respaldo se escribe ANTES de tocar la base.
  writeFileSync(archivo, JSON.stringify({ fecha: new Date().toISOString(), antes, mantenidos: { productos: nProductos, servicios: nServicios }, desactivados: { productos, servicios } }, null, 1))
  const lista = (ids) => (ids.length ? `array['${ids.join("','")}']::uuid[]` : "array[]::uuid[]")
  psql(`begin;
    set local session_replication_role = replica;
    update productos set activo = false where id = any(${lista(productos)});
    update servicios set activo = false where id = any(${lista(servicios)});
    commit;`)
  console.log(JSON.stringify({ antes, despues: conteos(), respaldo: archivo }))
} else if (orden === 'restaurar') {
  const archivo = arg('respaldo') && resolve(arg('respaldo'))
  if (!archivo || !existsSync(archivo)) falla('falta --respaldo=<archivo.json> existente.')
  const r = JSON.parse(readFileSync(archivo, 'utf8'))
  const lista = (ids) => (ids.length ? `array['${ids.join("','")}']::uuid[]` : "array[]::uuid[]")
  psql(`begin;
    set local session_replication_role = replica;
    update productos set activo = true where id = any(${lista(r.desactivados.productos)});
    update servicios set activo = true where id = any(${lista(r.desactivados.servicios)});
    commit;`)
  const ahora = conteos()
  const igual = ahora.productosActivos === r.antes.productosActivos && ahora.serviciosActivos === r.antes.serviciosActivos
  console.log(JSON.stringify({ original: r.antes, ahora, restaurado: igual }))
  if (!igual) falla('los conteos NO coinciden con el estado original: revise el respaldo antes de continuar.')
} else if (orden === 'sembrar-categorias') {
  const nCat = Number(arg('categorias') || 25)
  const nPor = Number(arg('por-categoria') || 6)
  if (!Number.isInteger(nCat) || nCat < 1 || nCat > 200 || !Number.isInteger(nPor) || nPor < 1 || nPor > 50) falla('--categorias (1–200) y --por-categoria (1–50) deben ser enteros.')
  if (Number(psql(`select (select count(*) from productos where nombre like 'QA F4 %') + (select count(*) from servicios where nombre like 'QA F4 %')`)) > 0) {
    falla('ya existen filas «QA F4 …»: ejecute limpiar-categorias antes de sembrar otra vez.')
  }
  const antes = conteos()
  psql(`begin;
    set local session_replication_role = replica;
    insert into productos (codigo_barras, nombre, categoria, precio, costo, stock_actual, stock_minimo, activo)
    select 'QAF4-' || lpad(c::text, 3, '0') || '-' || i, 'QA F4 Cat ' || lpad(c::text, 3, '0') || ' Producto ' || lpad(i::text, 2, '0'),
           'QA F4 Cat ' || lpad(c::text, 3, '0'), (10 + i)::numeric, 1, 5 + i, 1, true
    from generate_series(1, ${nCat}) c, generate_series(1, ${nPor}) i;
    insert into servicios (nombre, categoria, precio, duracion_min, activo)
    select 'QA F4 Cat ' || lpad(c::text, 3, '0') || ' Servicio ' || lpad(i::text, 2, '0'),
           'QA F4 Cat ' || lpad(c::text, 3, '0'), (20 + i)::numeric, 30, true
    from generate_series(1, ${nCat}) c, generate_series(1, ${nPor}) i;
    commit;`)
  console.log(JSON.stringify({ antes, despues: conteos(), categoriasSembradas: nCat, porCategoria: nPor }))
} else if (orden === 'limpiar-categorias') {
  const antes = conteos()
  psql(`begin;
    set local session_replication_role = replica;
    delete from productos where nombre like 'QA F4 %';
    delete from servicios where nombre like 'QA F4 %';
    commit;`)
  const despues = conteos()
  console.log(JSON.stringify({ antes, despues }))
} else {
  falla('uso: estado | reducir --respaldo=<json> | restaurar --respaldo=<json> | sembrar-categorias [--categorias=N --por-categoria=M] | limpiar-categorias')
}
