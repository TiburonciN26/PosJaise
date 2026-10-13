// Fase 7 · regresión de seguridad y resultados: las migraciones de la Fase 7 NO deben cambiar quién ve qué ni qué devuelve cada consulta.
//
// Una sola transacción con ROLLBACK sobre el Supabase LOCAL (54321, pila WedJaiseReact; se comprueba). Dentro:
//   1. siembra reducida (≈10 % del volumen de medición) para que haya páginas intermedias, última página y página vacía;
//   2. «foto» de lo que ve cada rol (anon, autenticada sin rol ni clienta, clientas A y B, asistente, cajera, cajera INACTIVA,
//      administración) en cada tabla/vista afectada, en las páginas de cada consulta de las Fases 4 y 5 (primera, segunda, última y
//      vacía, con su conteo exacto), en las funciones de catálogo y en una matriz de escrituras permitidas/denegadas;
//   3. se aplica cada migración y se repite la foto; las fotos deben ser IDÉNTICAS a la de «antes»;
//   4. CONTROL NEGATIVO (--control-negativo): se rompen a propósito dos políticas (USING true) y la comparación debe DETECTARLO;
//   5. se aplica la reversión documentada y la foto, más las definiciones de todas las políticas, deben volver a ser las de «antes».
// También comprueba por estructura que cada política modificada difiere de la original SOLO por el envoltorio `(select helper())`.
//
// Uso: node scripts/verificar-fase7.cjs --migracion=a.sql,b.sql --reversion=rollback.sql [--control-negativo] [--salida=ruta.json]
const { execFileSync } = require('node:child_process')
const { readFileSync, writeFileSync } = require('node:fs')
const { REDUCIDA, siembra } = require('./lib/volumen-fase7.cjs')
const { lineaBase } = require('./lib/consultas-fase7.cjs')

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d ?? ''}`).split('=').slice(1).join('=')
const MIGRACIONES = arg('migracion', '').split(',').filter(Boolean)
const REVERSION = arg('reversion', '')
const SALIDA = arg('salida', '')
const CONTROL = process.argv.includes('--control-negativo')

const puertos = execFileSync('docker', ['ps', '--filter', 'name=^supabase_kong_WedJaiseReact$', '--format', '{{.Ports}}'], { encoding: 'utf8' })
if (!/:54321->8000\/tcp/.test(puertos)) throw new Error('54321 no es la pila WedJaiseReact: no se verifica')
const psql = (sql) =>
  execFileSync('docker', ['exec', '-i', 'supabase_db_WedJaiseReact', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-F', '\t'], {
    input: sql, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
  })
const quitarTransaccion = (sql) => sql.replace(/^\s*begin\s*;\s*$/gim, '').replace(/^\s*commit\s*;\s*$/gim, '')
const q = (s) => s.replace(/'/g, "''")

// ---- qué se fotografía ----
const ROLES = ['anon', 'nadie', 'clienteA', 'clienteB', 'asistente', 'cajera', 'inactiva', 'admin']
const firma = (tabla, clave = 'id::text') => `select count(*)::text || ':' || coalesce(md5(string_agg(${clave}, ',' order by ${clave})), '') from ${tabla}`
const OBJETOS = [
  ['t:pedidos_web', firma('public.pedidos_web')],
  ['t:pedidos_web_items', firma('public.pedidos_web_items')],
  ['t:resenas', firma('public.resenas')],
  ['t:resenas_producto', firma('public.resenas_producto')],
  ['t:resenas_servicio', firma('public.resenas_servicio')],
  ['t:cupones', firma('public.cupones')],
  ['t:clientes', firma('public.clientes')],
  ['t:productos', firma('public.productos')],
  ['t:servicios', firma('public.servicios')],
  ['t:promociones', firma('public.promociones')],
  ['t:zonas_delivery', firma('public.zonas_delivery')],
  ['v:resenas_moderacion', firma('public.resenas_moderacion', "(origen || id::text)")],
  ['v:cupones_gestion', firma('public.cupones_gestion')],
  ['c:productos', `select md5(string_agg(id::text || '|' || nombre || '|' || coalesce(categoria, '') || '|' || precio::text || '|' || activo::text || '|' || stock_actual::text, ',' order by id)) from public.productos`],
  ['c:pedidos_web', `select md5(string_agg(id::text || '|' || estado || '|' || total::text || '|' || coalesce(cliente_id::text, ''), ',' order by id)) from public.pedidos_web`],
  ['f:productos_categorias', `select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.productos_categorias_publicas() t`],
  ['f:productos_vitrina', `select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.productos_vitrina_publica(4, 0, 10) t`],
  ['f:servicios_categorias', `select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.servicios_categorias_publicas() t`],
  ['f:servicios_vitrina', `select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.servicios_vitrina_publica(4, 30, 0, 10) t`],
]
// Páginas: [nombre, from+where (sin order), columnas, order]. Cada una se lee en 4 posiciones con su conteo exacto, como PostgREST.
const PAGINAS = [
  ['pedidos', `from public.pedidos_web p`, 'p.id, p.estado, p.total, p.creado_en', 'p.creado_en desc, p.id desc'],
  ['pedidos_pendientes', `from public.pedidos_web p where p.estado = 'PENDIENTE'`, 'p.id, p.estado, p.total', 'p.creado_en desc, p.id desc'],
  ['pedidos_busqueda', `from public.pedidos_web p join public.clientes c on c.id = p.cliente_id where p.estado = 'ENTREGADO' and c.nombre ilike '%maria%'`, 'p.id, p.estado, c.nombre', 'p.creado_en desc, p.id desc'],
  ['promociones', `from public.promociones x`, 'x.id, x.titulo, x.activo', 'x.creado_en desc, x.id desc'],
  ['promociones_busqueda', `from public.promociones x where x.titulo ilike '%verano%'`, 'x.id, x.titulo', 'x.creado_en desc, x.id desc'],
  ['resenas', `from public.resenas_moderacion x`, 'x.origen, x.id, x.estado, x.creado_en, x.cliente_nombre, x.item_nombre', 'x.creado_en desc, x.id desc, x.origen'],
  ['resenas_pendientes', `from public.resenas_moderacion x where x.estado = 'PENDIENTE'`, 'x.origen, x.id, x.estado', 'x.creado_en desc, x.id desc, x.origen'],
  ['resenas_busqueda', `from public.resenas_moderacion x where (x.cliente_nombre ilike '%ana%' or x.item_nombre ilike '%ana%')`, 'x.origen, x.id', 'x.creado_en desc, x.id desc, x.origen'],
  ['cupones_referidos', `from public.cupones_gestion x where x.origen = any (array['REFERIDO_BIENVENIDA','REFERIDO_RECOMPENSA'])`, 'x.id, x.codigo, x.estado, x.cliente_nombre', 'x.creado_en desc, x.id desc'],
  ['cupones_fidelizacion', `from public.cupones_gestion x where x.origen = any (array['FIDELIZACION']) and x.estado = 'DISPONIBLE'`, 'x.id, x.codigo, x.estado', 'x.creado_en desc, x.id desc'],
  ['cupones_busqueda', `from public.cupones_gestion x where (x.codigo_busqueda ilike '%ana%' or x.cliente_busqueda ilike '%ana%') and x.origen = any (array['REFERIDO_BIENVENIDA','REFERIDO_RECOMPENSA'])`, 'x.id, x.codigo', 'x.creado_en desc, x.id desc'],
  ['productos_busqueda', `from public.productos x where x.activo = true and x.nombre ilike '%shampoo%'`, 'x.id, x.nombre, x.categoria, x.precio', 'x.nombre, x.id'],
  ['productos_categoria', `from public.productos x where x.activo = true and x.categoria = 'Cat QA7 3'`, 'x.id, x.nombre', 'x.nombre, x.id'],
  ['servicios_categoria', `from public.servicios x where x.activo = true and x.categoria = 'Cat QA7 3'`, 'x.id, x.nombre', 'x.nombre, x.id'],
]
const paginasSQL = ([nombre, desde, cols, orden]) => {
  const total = `(select count(*) from (select 1 ${desde}) c)`
  return [['0', '0'], ['40', '40'], ['ultima', `greatest(0, (${total} - 1) / 40 * 40)`], ['vacia', `(${total} + 40)`]].map(([pos, off]) => [
    `p:${nombre}:${pos}`,
    `select ${total}::text || ':' || coalesce(md5(json_agg(t)::text), '') from (select ${cols} ${desde} order by ${orden} limit 40 offset ${off}) t`,
  ])
}
// Matriz de escrituras: cada una se ejecuta en una subtransacción que SIEMPRE se deshace; se registra filas afectadas o SQLSTATE.
const ESCRITURAS = [
  ['w:promociones_insert', `insert into public.promociones select (jsonb_populate_record(null::public.promociones, to_jsonb(p) || jsonb_build_object('id', gen_random_uuid()))).* from public.promociones p limit 1`],
  ['w:promociones_update', `update public.promociones set activo = activo where id = (select id from public.promociones order by id limit 1)`],
  ['w:promociones_delete', `delete from public.promociones where id = (select id from public.promociones order by id limit 1)`],
  ['w:resenas_update', `update public.resenas set estado = estado where id = (select id from public.resenas order by id limit 1)`],
  ['w:pedidos_update', `update public.pedidos_web set estado = estado where id = (select id from public.pedidos_web order by id limit 1)`],
  ['w:clientes_update', `update public.clientes set nombre = nombre where id = (select id from public.clientes order by id limit 1)`],
  ['w:productos_update', `update public.productos set nombre = nombre where id = (select id from public.productos order by id limit 1)`],
  ['w:zonas_update', `update public.zonas_delivery set nombre = nombre where id = (select id from public.zonas_delivery order by id limit 1)`],
]
const TODAS = [...OBJETOS, ...PAGINAS.flatMap(paginasSQL)]

const valores = (lista, tipo) => lista.map(([clave, sql]) => `('${q(clave)}', '${q(sql)}', '${tipo}')`).join(',\n    ')

const FUNCION = `
create temp table f7_obj(clave text, sql text, tipo text);
insert into f7_obj values
    ${valores(TODAS, 'lectura')},
    ${valores(ESCRITURAS, 'escritura')};
create temp table f7_ids(rol text, uid text, pgrol text);
insert into f7_ids values
  ('anon', null, 'anon'), ('nadie', gen_random_uuid()::text, 'authenticated'),
  ('clienteA', :'cliente_a', 'authenticated'), ('clienteB', :'cliente_b', 'authenticated'),
  ('asistente', :'asistente_id', 'authenticated'), ('cajera', :'cajera_id', 'authenticated'),
  ('inactiva', :'inactiva_id', 'authenticated'), ('admin', :'admin_id', 'authenticated');
create temp table f7_snap(fase text, rol text, clave text, valor text);
create function pg_temp.f7_tomar(p_fase text) returns void language plpgsql as $f$
declare r record; o record; v text; n bigint;
begin
  for r in select * from f7_ids order by rol loop
    for o in select * from f7_obj order by clave loop
      v := null;
      execute 'set local role ' || r.pgrol;
      perform set_config('request.jwt.claims', case when r.uid is null then json_build_object('role', 'anon')::text else json_build_object('sub', r.uid, 'role', 'authenticated')::text end, true);
      begin
        if o.tipo = 'lectura' then
          execute o.sql into v;
        else
          execute o.sql;
          get diagnostics n = row_count;
          v := 'filas=' || n;
          raise exception 'f7_deshacer';
        end if;
      exception when others then
        if sqlerrm = 'f7_deshacer' then null; else v := 'ERROR:' || sqlstate; end if;
      end;
      reset role;
      insert into f7_snap values (p_fase, r.rol, o.clave, v);
    end loop;
  end loop;
end $f$;
create function pg_temp.f7_politicas(p_fase text) returns void language plpgsql as $f$
begin
  insert into f7_pol select p_fase, tablename, policyname, cmd, permissive, roles::text, coalesce(qual, ''), coalesce(with_check, '')
  from pg_policies where schemaname = 'public';
  insert into f7_extra select p_fase, 'grants', md5(string_agg(grantee || table_name || privilege_type, ',' order by grantee, table_name, privilege_type))
  from information_schema.role_table_grants where table_schema = 'public';
  insert into f7_extra select p_fase, 'helpers', md5(string_agg(pg_get_functiondef(p.oid), '|' order by p.proname))
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('es_admin', 'rol_actual', 'mi_cliente_id');
  insert into f7_extra select p_fase, 'indices_f7', coalesce(string_agg(c.relname || ':' || i.indisvalid::text, ',' order by c.relname), '')
  from pg_index i join pg_class c on c.oid = i.indexrelid where c.relnamespace = 'public'::regnamespace and c.relname like 'idx_f7_%';
  insert into f7_extra select p_fase, 'rls_activo', string_agg(relname || ':' || relrowsecurity::text, ',' order by relname)
  from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r';
end $f$;
create temp table f7_pol(fase text, tabla text, nombre text, cmd text, permisiva text, roles text, usando text, con_check text);
create temp table f7_extra(fase text, clave text, valor text);
`

let guion = `\\set ON_ERROR_STOP on
select 'FILAS|' || (select count(*) from clientes) || ',' || (select count(*) from pedidos_web) || ',' || (select count(*) from cupones) || ',' || (select count(*) from productos) || ',' || (select count(*) from pg_policies where schemaname='public');
begin;
${lineaBase(arg('rollback', REVERSION || '.codex/evidencia-fase7/rollback-fase7.sql'))}
${siembra(REDUCIDA)}
set local session_replication_role = origin;
select id as admin_id from usuarios where rol = 'ADMINISTRADOR' and activo order by id limit 1 \\gset
select id as cajera_id from usuarios where rol = 'CAJERA' and activo order by id limit 1 \\gset
select id as inactiva_id from usuarios where rol = 'CAJERA' and activo order by id offset 1 limit 1 \\gset
select id as asistente_id from usuarios where rol = 'ASISTENTE' and activo order by id limit 1 \\gset
select cw.id as cliente_a, c.id as cliente_a_pk from clientes c join clientes_web cw on cw.id = c.cliente_web_id order by (select count(*) from pedidos_web p where p.cliente_id = c.id) desc, c.id limit 1 \\gset
select cw.id as cliente_b, c.id as cliente_b_pk from clientes c join clientes_web cw on cw.id = c.cliente_web_id where cw.id <> :'cliente_a' order by (select count(*) from cupones p where p.cliente_id = c.id) desc, c.id limit 1 \\gset
update usuarios set activo = false where id = :'inactiva_id';
-- A y B reciben parte de lo sembrado para que su visibilidad propia sea no trivial
set local session_replication_role = replica;
update pedidos_web set cliente_id = :'cliente_a_pk' where id in (select id from pedidos_web where cliente_id in (select id from cli7) order by id limit 40);
update cupones set cliente_id = :'cliente_a_pk' where id in (select id from cupones where cliente_id in (select id from cli7) order by id limit 40);
update cupones set cliente_id = :'cliente_b_pk' where id in (select id from cupones where cliente_id in (select id from cli7) order by id desc limit 40);
update resenas set cliente_id = :'cliente_b_pk' where id in (select id from resenas where cliente_id in (select id from cli7) order by id limit 1) and not exists (select 1 from resenas where cliente_id = :'cliente_b_pk');
set local session_replication_role = origin;
analyze;
${FUNCION}
select pg_temp.f7_tomar('antes'); select pg_temp.f7_politicas('antes');
`
const fases = ['antes']
MIGRACIONES.forEach((ruta, k) => {
  const f = `despues${k + 1}`
  fases.push(f)
  guion += `\\echo @@@MIGRACION ${k + 1}\n${quitarTransaccion(readFileSync(ruta, 'utf8'))}\nanalyze;\nselect pg_temp.f7_tomar('${f}'); select pg_temp.f7_politicas('${f}');\n`
})
if (CONTROL) {
  fases.push('control')
  guion += `-- CONTROL NEGATIVO: se rompen a propósito dos políticas; la comparación debe detectarlo\nalter policy pedidos_web_select on public.pedidos_web using (true);\nalter policy productos_select on public.productos using (true);\nselect pg_temp.f7_tomar('control'); select pg_temp.f7_politicas('control');\n`
}
if (REVERSION) {
  fases.push('revertida')
  guion += `\\echo @@@REVERSION\n${quitarTransaccion(readFileSync(REVERSION, 'utf8'))}\nanalyze;\nselect pg_temp.f7_tomar('revertida'); select pg_temp.f7_politicas('revertida');\n`
}
guion += `
\\echo @@@SNAP
select fase, rol, clave, coalesce(valor, '<null>') from f7_snap order by 1, 2, 3;
\\echo @@@POL
select fase, tabla, nombre, cmd, permisiva, roles, replace(usando, E'\\n', ' '), replace(con_check, E'\\n', ' ') from f7_pol order by 1, 2, 3;
\\echo @@@EXTRA
select fase, clave, valor from f7_extra order by 1, 2;
rollback;
select 'FILAS|' || (select count(*) from clientes) || ',' || (select count(*) from pedidos_web) || ',' || (select count(*) from cupones) || ',' || (select count(*) from productos) || ',' || (select count(*) from pg_policies where schemaname='public');
`

const t0 = Date.now()
const salida = psql(guion)
const filasAntes = (/^FILAS\|(.*)$/m.exec(salida) ?? [])[1]
const filasDespues = [...salida.matchAll(/^FILAS\|(.*)$/gm)].pop()?.[1]
const seccion = (nombre, sig) => salida.slice(salida.indexOf(`@@@${nombre}`) + nombre.length + 4, sig ? salida.indexOf(`@@@${sig}`) : salida.lastIndexOf('FILAS|')).trim().split('\n').filter(Boolean).map((l) => l.split('\t'))
const snap = seccion('SNAP', 'POL')
const pol = seccion('POL', 'EXTRA')
const extra = seccion('EXTRA', null)

// ---- 1. fotos de resultados por rol ----
const porFase = {}
for (const [fase, rol, clave, valor] of snap) (porFase[fase] ??= new Map()).set(`${rol}|${clave}`, valor)
const base = porFase.antes
const informe = { escala: 'reducida (≈10 %)', fases, claves_comparadas: base.size, diferencias: {}, filas_base: filasAntes, filas_tras_rollback: filasDespues, duracion_s: 0 }
const difs = (a, b) => [...a.keys()].filter((k) => a.get(k) !== b.get(k)).map((k) => ({ clave: k, antes: a.get(k), despues: b.get(k) }))
for (const f of fases.slice(1)) informe.diferencias[f] = difs(base, porFase[f])

// visibilidad de «antes» para que se vea que la prueba tiene dientes (no todo vacío ni todo igual)
const visibilidad = {}
for (const rol of ROLES) {
  visibilidad[rol] = Object.fromEntries(['t:pedidos_web', 't:pedidos_web_items', 't:resenas', 't:cupones', 't:clientes', 't:productos', 't:promociones', 'v:resenas_moderacion', 'v:cupones_gestion'].map((c) => [c.slice(2), (base.get(`${rol}|${c}`) ?? '').split(':')[0]]))
}
const escrituras = {}
for (const rol of ROLES) escrituras[rol] = Object.fromEntries(ESCRITURAS.map(([c]) => [c.slice(2), base.get(`${rol}|${c}`)]))
informe.linea_base = (/@@@LINEA_BASE\|(.*)/.exec(salida) ?? [])[1]
informe.visibilidad_antes = visibilidad
informe.escrituras_antes = escrituras

// ---- 2. políticas: solo cambia el envoltorio ----
const polFase = {}
for (const [fase, tabla, nombre, cmd, permisiva, roles, usando, conCheck] of pol) (polFase[fase] ??= new Map()).set(`${tabla}.${nombre}`, { cmd, permisiva, roles, usando, conCheck })
const normalizar = (s) => s.replace(/\(\s*SELECT\s+((?:public\.)?[a-z_]+\(\))\s+AS\s+[a-z_]+\)/gi, '$1').replace(/public\./g, '').replace(/\s+/g, ' ').trim()
const politicas = { modificadas: [], estructura_ajena: [], solo_envoltorio: 0, no_equivalentes: [], _solo: new Set() }
const pA = polFase.antes
for (const f of fases.filter((x) => x.startsWith('despues'))) {
  const pF = polFase[f]
  for (const [k, a] of pA) {
    const d = pF.get(k)
    if (!d) { politicas.estructura_ajena.push(`${k}: desaparece en ${f}`); continue }
    if (a.cmd !== d.cmd || a.permisiva !== d.permisiva || a.roles !== d.roles) politicas.estructura_ajena.push(`${k}: cambia cmd/permisiva/roles en ${f}`)
    if (a.usando !== d.usando || a.conCheck !== d.conCheck) {
      if (!politicas.modificadas.includes(k)) politicas.modificadas.push(k)
      if (normalizar(a.usando) === normalizar(d.usando) && normalizar(a.conCheck) === normalizar(d.conCheck)) politicas._solo.add(k)
      else politicas.no_equivalentes.push({ politica: k, antes: a.usando, despues: d.usando })
    }
  }
  for (const k of pF.keys()) if (!pA.has(k)) politicas.estructura_ajena.push(`${k}: política nueva en ${f}`)
}
politicas.solo_envoltorio = politicas._solo.size // políticas DISTINTAS que difieren solo por el envoltorio (no una por fase)
delete politicas._solo
informe.politicas = politicas
if (polFase.revertida) {
  const distintas = [...pA.keys()].filter((k) => JSON.stringify(pA.get(k)) !== JSON.stringify(polFase.revertida.get(k)))
  informe.politicas_revertidas_identicas = distintas.length === 0 && pA.size === polFase.revertida.size
  informe.politicas_revertidas_distintas = distintas
}
if (polFase.control) informe.control_politicas_alteradas = [...pA.keys()].filter((k) => JSON.stringify(pA.get(k)) !== JSON.stringify(polFase.control.get(k)))

const exFase = {}
for (const [fase, clave, valor] of extra) (exFase[fase] ??= {})[clave] = valor
informe.extra = exFase
informe.grants_y_helpers_sin_cambios = fases.every((f) => exFase[f].grants === exFase.antes.grants && exFase[f].helpers === exFase.antes.helpers && exFase[f].rls_activo === exFase.antes.rls_activo)
informe.duracion_s = Math.round((Date.now() - t0) / 1000)

// ---- 3. veredicto ----
const reales = fases.filter((f) => f.startsWith('despues'))
const fallos = []
for (const f of reales) if (informe.diferencias[f].length) fallos.push(`${f}: ${informe.diferencias[f].length} diferencias de resultados/permisos`)
if (politicas.estructura_ajena.length) fallos.push(`políticas con estructura ajena: ${politicas.estructura_ajena.join('; ')}`)
if (politicas.no_equivalentes.length) fallos.push(`${politicas.no_equivalentes.length} políticas difieren más que el envoltorio`)
if (!informe.grants_y_helpers_sin_cambios) fallos.push('cambiaron GRANT, helpers o RLS activo')
if (filasAntes !== filasDespues) fallos.push(`la base cambió tras el rollback: ${filasAntes} → ${filasDespues}`)
if (REVERSION && (!informe.politicas_revertidas_identicas || informe.diferencias.revertida.length)) fallos.push('la reversión no restaura exactamente el estado anterior')
if (CONTROL) {
  informe.control_negativo_detectado = informe.diferencias.control.length > 0
  if (!informe.control_negativo_detectado) fallos.push('el control negativo NO fue detectado: la comparación no tiene dientes')
}
informe.veredicto = fallos.length ? 'FALLA' : 'CORRECTO'
informe.fallos = fallos
if (SALIDA) writeFileSync(SALIDA, JSON.stringify(informe, null, 1))
console.log(`claves comparadas por fase: ${base.size} (8 roles × ${base.size / 8} objetos/páginas/escrituras)  fases: ${fases.join(' → ')}  (${informe.duracion_s}s)`)
for (const f of fases.slice(1)) console.log(`  ${f.padEnd(10)} diferencias respecto de «antes»: ${informe.diferencias[f].length}${f === 'control' ? ' (esperadas: es el control negativo)' : ''}`)
console.log(`  políticas modificadas: ${politicas.modificadas.length}  (solo envoltorio: ${politicas.solo_envoltorio}, más que envoltorio: ${politicas.no_equivalentes.length}, estructura ajena: ${politicas.estructura_ajena.length})`)
console.log(`  grants/helpers/RLS sin cambios: ${informe.grants_y_helpers_sin_cambios}  base tras rollback igual: ${filasAntes === filasDespues}`)
if (REVERSION) console.log(`  reversión: políticas idénticas a «antes»=${informe.politicas_revertidas_identicas}, resultados idénticos=${informe.diferencias.revertida.length === 0}`)
if (CONTROL) console.log(`  control negativo detectado: ${informe.control_negativo_detectado} (${informe.diferencias.control.length} diferencias, políticas alteradas: ${informe.control_politicas_alteradas.join(', ')})`)
console.log(`VEREDICTO: ${informe.veredicto}${fallos.length ? '\n  - ' + fallos.join('\n  - ') : ''}`)
process.exit(fallos.length ? 1 : 0)
