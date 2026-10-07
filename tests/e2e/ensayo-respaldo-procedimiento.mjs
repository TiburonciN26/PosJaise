// Ensayo del PROCEDIMIENTO DE RESPALDO Y RESTAURACIÓN con DATOS FICTICIOS, íntegramente dentro del contenedor de la instancia
// desechable «JaiseEnsayo» (rutas /tmp/respaldo-ensayo; nada sale a QA ni a producción, no se conecta a ningún proyecto remoto).
// Reproduce los pasos de docs/lanzamiento/PROCEDIMIENTO-RESPALDO-PRODUCCION.md: exportación (pg_dump -Fc con los privilegios de un
// rol que NO es superusuario, como «postgres» en Supabase alojado), lectura del archivo (pg_restore --list), roles globales
// (pg_dumpall --roles-only, que pg_dump NO guarda), restauración (A: destino con los roles ya creados; B: clúster vacío sin
// roles —control negativo— y luego con los roles preparados) y comparación de propietarios, privilegios y datos.
//
// Termina con código 0 SOLO si todo salió como se espera. Código 1 si: una exportación, lectura, exportación de roles, preparación
// del destino (incluye CUALQUIER error inesperado al aplicar roles.sql) o restauración devuelve un código distinto de cero cuando no
// debía; si una comparación encuentra diferencias; si un control negativo NO falla como se espera; o si falla la limpieza. Un fallo
// de limpieza nunca oculta el error original. La decisión está en ensayo-respaldo-nucleo.mjs (con pruebas aisladas).
// Uso: node tests/e2e/ensayo-respaldo-procedimiento.mjs   (escribe tests/e2e/results-ensayo/respaldo-procedimiento.json)
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CONTENEDOR, verificarDestinoEnsayo } from './ensayo-destino.mjs';
import { clasificarErroresRoles, sinOtorgante, clasificarErroresSinRoles, evaluarResultado, codigoDeSalida, ejecutarConLimpieza } from './ensayo-respaldo-nucleo.mjs';

verificarDestinoEnsayo('postgres');
const DIR = '/tmp/respaldo-ensayo';
const V = '/tmp/vanilla-ensayo'; const SOCK = '/tmp/vanilla-sock'; const P = 55432;
const ESQUEMAS = ['public', 'auth', 'storage', 'supabase_migrations'];
const NL = String.fromCharCode(10);

// ---- ejecución: siempre devuelve el código de salida real; `exigir*` lanza ante un código distinto de cero ----
const ejec = (cmd, { usuario = 'root' } = {}) => {
  const r = spawnSync('docker', ['exec', '-u', usuario, CONTENEDOR, 'sh', '-c', cmd], { encoding: 'utf8', maxBuffer: 1 << 27 });
  return { codigo: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? (r.error ? String(r.error.message) : '')).trim() };
};
const exigir = (cmd, o) => {
  const r = ejec(cmd, o);
  if (r.codigo !== 0) throw new Error(`«${cmd.slice(0, 140)}» terminó con código ${r.codigo}: ${r.err.slice(0, 500)}`);
  return r.out;
};
const psqlR = (base, sql, { usuario = 'supabase_admin', puerto = null, socket = null } = {}) =>
  ejec(`psql ${puerto ? `-h ${socket} -p ${puerto}` : ''} -U ${usuario} -d ${base} -v ON_ERROR_STOP=1 -At -q -f - <<'SQL_FIN'${NL}${sql}${NL}SQL_FIN`);
const psql = (base, sql, o) => {
  const r = psqlR(base, sql, o);
  if (r.codigo !== 0) throw new Error(`psql en «${base}» terminó con código ${r.codigo}: ${r.err.slice(0, 500)}`);
  return r.out;
};
const lineas = (t) => t.split(NL).filter(Boolean);

// Huella de propietarios, privilegios y datos de los esquemas respaldados. Se calcula igual en origen y destino.
const filtro = ESQUEMAS.map((e) => `'${e}'`).join(',');
const HUELLA = `
set search_path = pg_catalog; -- neutro: el texto de las políticas (auth.uid()) depende del search_path de la sesión que lo lee
select 'esquemas', md5(coalesce(string_agg(nspname||'|'||pg_get_userbyid(nspowner)||'|'||coalesce(nspacl::text,''), E'\\n' order by nspname),'')) from pg_namespace where nspname in (${filtro});
select 'relaciones', md5(coalesce(string_agg(n.nspname||'.'||c.relname||'|'||c.relkind::text||'|'||pg_get_userbyid(c.relowner)||'|'||coalesce(c.relacl::text,'')||'|'||c.relrowsecurity::text||c.relforcerowsecurity::text, E'\\n' order by n.nspname, c.relname),'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${filtro}) and c.relkind in ('r','v','m','S','p','f');
select 'columnas_acl', md5(coalesce(string_agg(n.nspname||'.'||c.relname||'.'||a.attname||'|'||a.attacl::text, E'\\n' order by n.nspname,c.relname,a.attname),'')) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${filtro}) and a.attacl is not null;
select 'funciones', md5(coalesce(string_agg(n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')|'||pg_get_userbyid(p.proowner)||'|'||coalesce(p.proacl::text,'')||'|'||p.prosecdef::text||'|'||coalesce(p.proconfig::text,''), E'\\n' order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'')) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in (${filtro});
select 'tipos', md5(coalesce(string_agg(n.nspname||'.'||t.typname||'|'||pg_get_userbyid(t.typowner), E'\\n' order by n.nspname,t.typname),'')) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in (${filtro}) and t.typtype in ('e','d','c') and (t.typtype <> 'c' or exists (select 1 from pg_class c where c.reltype=t.oid and c.relkind='c'));
select 'privilegios_por_omision', md5(coalesce(string_agg(pg_get_userbyid(d.defaclrole)||'|'||coalesce(n.nspname,'*')||'|'||d.defaclobjtype::text||'|'||d.defaclacl::text, E'\\n' order by 1),'')) from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where n.nspname is null or n.nspname in (${filtro});
select 'politicas', md5(coalesce(string_agg(schemaname||'.'||tablename||'.'||policyname||'|'||cmd||'|'||roles::text||'|'||coalesce(qual,'')||'|'||coalesce(with_check,''), E'\\n' order by schemaname,tablename,policyname),'')) from pg_policies where schemaname in (${filtro});
select 'triggers', md5(coalesce(string_agg(n.nspname||'.'||c.relname||'.'||t.tgname||'|'||t.tgenabled::text, E'\\n' order by n.nspname,c.relname,t.tgname),'')) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and n.nspname in (${filtro});
select 'datos', md5(coalesce(string_agg(n.nspname||'.'||c.relname||'='||(xpath('/row/h/text()', query_to_xml(format('select count(*)||'':''||md5(coalesce(string_agg(t::text, ''|'' order by t::text),'''')) as h from %I.%I t', n.nspname, c.relname), false, true, '')))[1]::text, E'\\n' order by n.nspname,c.relname),'')) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${filtro}) and c.relkind in ('r','p');
`;
const huella = (base, o) => Object.fromEntries(lineas(psql(base, HUELLA, o)).map((l) => l.split('|')));
const comparar = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]);
const prefijo = (r) => lineas(r.err).filter((l) => /^pg_restore: error:/.test(l));

const res = { pasos: {}, fallos: [], error: null };
const PREP_EXT = `create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions; create schema if not exists vault; create extension if not exists supabase_vault with schema vault;`;
const PREP_EXT_VACIO = PREP_EXT.replace(' create schema if not exists vault; create extension if not exists supabase_vault with schema vault;', '');
const dump = `${DIR}/ficticio.dump`; const roles = `${DIR}/roles.sql`; const listaSinPublic = `${DIR}/lista_sin_public.txt`;

async function principal() {
  // Estado inicial limpio (restos de una ejecución interrumpida). No es un resultado: no se registra.
  ejec(`pkill -u postgres -f "${V}" 2>/dev/null; rm -rf ${V} ${SOCK} ${DIR}`);
  exigir(`mkdir -p ${DIR} ${SOCK} && chmod 777 ${DIR} && chown postgres ${SOCK}`);
  psql('template1', 'drop database if exists recup_a with (force); drop database if exists recup_n with (force);');

  const vDump = exigir('pg_dump --version');
  const vServ = psql('postgres', 'show server_version');
  res.version_pg_dump = vDump; res.version_servidor = vServ;
  res.mismo_mayor = vDump.match(/(\d+)\./)?.[1] === vServ.split('.')[0];
  if (!res.mismo_mayor) throw new Error(`pg_dump (${vDump}) y servidor (${vServ}) deben ser del mismo mayor (pg_dump igual o más nuevo)`);

  const origen = huella('postgres');
  const [lc_collate, lc_ctype, encoding, proveedor, locale] = psql('postgres', `select datcollate||'|'||datctype||'|'||pg_encoding_to_char(encoding)||'|'||datlocprovider::text||'|'||coalesce(datlocale,'') from pg_database where datname = current_database()`).split('|');
  res.locale_origen = { lc_collate, lc_ctype, encoding, proveedor, locale };
  res.origen_huella = origen;
  const sqlLocale = ` encoding '${encoding}' lc_collate '${lc_collate}' lc_ctype '${lc_ctype}'${proveedor === 'i' ? ` locale_provider icu icu_locale '${locale}'` : ''}`;

  // 1) EXPORTACIÓN como «postgres» (NO superusuario). Sin --no-owner ni --no-acl.
  const nflag = ESQUEMAS.map((e) => `--schema=${e}`).join(' ');
  const t0 = Date.now();
  const exp = ejec(`pg_dump --format=custom ${nflag} --file=${dump} --dbname=postgres --username=postgres`);
  res.pasos.exportacion = { comando: `pg_dump --format=custom ${nflag} --file=<archivo> --dbname=<conexion>`, codigo: exp.codigo, error: exp.err.slice(0, 300), ms: Date.now() - t0 };
  if (exp.codigo !== 0) throw new Error(`pg_dump terminó con código ${exp.codigo}: ${exp.err.slice(0, 300)}`);
  res.pasos.exportacion.bytes = Number(exigir(`wc -c < ${dump}`));
  res.pasos.exportacion.sha256 = exigir(`sha256sum ${dump} | cut -d' ' -f1`);

  // 2) LECTURA del archivo (no restaura).
  const lis = ejec(`pg_restore --list ${dump}`);
  const so = ejec(`pg_restore --schema-only -f - ${dump}`);
  res.pasos.lectura = { codigo: lis.codigo || so.codigo, lineas: lineas(lis.out).length };
  res.pasos.lectura.cabecera = lineas(lis.out).filter((l) => /Archive created|Dumped from|Dumped by|Compression|Format|TOC Entries/.test(l));
  res.pasos.lectura.entradas_acl = lineas(lis.out).filter((l) => / ACL /.test(l)).length;
  res.pasos.lectura.alter_owner = (so.out.match(/OWNER TO/g) ?? []).length;
  res.pasos.lectura.grant_revoke = lineas(so.out).filter((l) => /^(GRANT|REVOKE) /.test(l)).length;
  // La base nueva ya trae «public»: se comenta su entrada en la lista de restauración.
  exigir(`pg_restore --list ${dump} | awk '/^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public /{print ";" $0; next} {print}' > ${listaSinPublic}`);
  res.pasos.lectura.entrada_schema_public_omitida = lineas(exigir(`cat ${listaSinPublic}`)).filter((l) => /^;[0-9]+; [0-9]+ [0-9]+ SCHEMA - public /.test(l)).length;

  // 3) ROLES GLOBALES (pg_dump no los guarda).
  const rr = ejec(`pg_dumpall --roles-only --no-role-passwords --username=postgres > ${roles}`);
  res.pasos.roles = { comando: 'pg_dumpall --roles-only --no-role-passwords --username=<usuario> > roles.sql', codigo: rr.codigo, error: rr.err.slice(0, 300) };
  if (rr.codigo !== 0) throw new Error(`pg_dumpall terminó con código ${rr.codigo}: ${rr.err.slice(0, 300)}`);
  const rolesTxt = exigir(`cat ${roles}`);
  res.pasos.roles.roles_en_origen = lineas(psql('postgres', `select rolname from pg_roles where rolname !~ '^pg_' order by 1`));
  res.pasos.roles.lineas_create_role = lineas(rolesTxt).filter((l) => /^CREATE ROLE /.test(l)).length;
  res.pasos.roles.alter_role = lineas(rolesTxt).filter((l) => /^ALTER ROLE /.test(l)).length;
  res.pasos.roles.pertenencias = lineas(rolesTxt).filter((l) => /^GRANT /.test(l)).length;
  res.pasos.roles.contiene_contrasenas = /PASSWORD/i.test(rolesTxt);
  res.pasos.roles.dump_contiene_roles = lineas(lis.out).some((l) => / ROLE /.test(l));

  // 4A) RESTAURACIÓN en un destino que YA tiene los roles (misma instancia Supabase): base nueva desde template0.
  psql('template1', `create database recup_a template template0`);
  psql('recup_a', PREP_EXT);
  const rA = ejec(`pg_restore --exit-on-error --use-list=${listaSinPublic} --dbname=recup_a --username=supabase_admin ${dump}`);
  res.pasos.restauracion_con_roles = { codigo: rA.codigo, salida: rA.err.slice(-400) };
  if (rA.codigo === 0) res.pasos.restauracion_con_roles.diferencias = comparar(origen, huella('recup_a'));

  // 4A') CONTROL NEGATIVO: --no-owner --no-acl debe PERDER propietarios y privilegios (si no los pierde, el control no sirve).
  psql('template1', `create database recup_n template template0`);
  psql('recup_n', PREP_EXT);
  const rN = ejec(`pg_restore --exit-on-error --no-owner --no-acl --use-list=${listaSinPublic} --dbname=recup_n --username=supabase_admin ${dump}`);
  res.pasos.contraste_sin_propietarios = { codigo: rN.codigo, salida: rN.err.slice(-300) };
  if (rN.codigo === 0) res.pasos.contraste_sin_propietarios.categorias_que_difieren = comparar(origen, huella('recup_n'));

  // 4B) CLÚSTER VACÍO (sin los roles de Supabase).
  exigir(`initdb -D ${V} -U postgres --auth=trust -E UTF8 >/dev/null`, { usuario: 'postgres' });
  exigir(`pg_ctl -D ${V} -o "-p ${P} -k ${SOCK} -c listen_addresses=''" -l ${V}/log -w start >/dev/null`, { usuario: 'postgres' });
  const v = (sql, base2 = 'postgres') => psql(base2, sql, { usuario: 'postgres', puerto: P, socket: SOCK });
  // Control negativo: sin roles la restauración DEBE fallar con «role … does not exist».
  v(`create database sin_roles template template0`);
  const rolesAntes = lineas(v(`select rolname from pg_roles where rolname !~ '^pg_' order by 1`));
  const rS = ejec(`pg_restore --use-list=${listaSinPublic} --dbname=sin_roles -h ${SOCK} -p ${P} --username=postgres ${dump}`, { usuario: 'postgres' });
  const cs = clasificarErroresSinRoles(prefijo(rS));
  res.pasos.restauracion_sin_roles = { codigo: rS.codigo, roles_en_destino_antes: rolesAntes.length, errores_rol_inexistente: cs.esperados.length, otros_errores: cs.otros.length, ejemplos_otros: cs.otros.slice(0, 3), ejemplos: cs.esperados.slice(0, 2) };
  // Preparar el destino: base con el MISMO locale/proveedor, roles (de roles.sql), extensiones. Cada paso se comprueba.
  v(`create database con_roles template template0${sqlLocale}`);
  res.locale = { origen: res.locale_origen, destino: v(`select datcollate||'|'||pg_encoding_to_char(encoding)||'|'||datlocprovider::text||'|'||coalesce(datlocale,'') from pg_database where datname='con_roles'`) };
  // Preparar el destino: aplicar roles.sql TAL COMO SE EXPORTÓ, clasificar CADA error y reparar lo que quedó sin aplicar.
  const sqlLineas = rolesTxt.split(NL);
  const ar = ejec(`psql -h ${SOCK} -p ${P} -U postgres -d postgres -X -q -f ${roles}`, { usuario: 'postgres' });
  const errRoles = lineas(ar.err).filter((l) => /ERROR:/.test(l));
  const cr = clasificarErroresRoles(errRoles, rolesAntes, sqlLineas);
  // Reparación: las pertenencias rechazadas por «GRANTED BY» se re-aplican sin otorgante (la otorga el superusuario del destino).
  const reparar = cr.sentenciasPorReparar.map(sinOtorgante);
  const rep = reparar.length ? psqlR('postgres', reparar.join(NL), { usuario: 'postgres', puerto: P, socket: SOCK }) : { codigo: 0, err: '' };
  // Verificación: pertenencias y atributos del destino iguales a los del origen (salvo el superusuario inicial del clúster).
  const consultaMembresias = `select g.rolname||'>'||r.rolname||'|'||m.admin_option::text||m.inherit_option::text||m.set_option::text from pg_auth_members m join pg_roles r on r.oid=m.member join pg_roles g on g.oid=m.roleid where r.rolname !~ '^pg_' order by 1`;
  const consultaAtributos = `select rolname||'|'||rolsuper::text||rolinherit::text||rolcreaterole::text||rolcreatedb::text||rolcanlogin::text||rolreplication::text||rolbypassrls::text||rolconnlimit::text||'|'||coalesce(rolconfig::text,'') from pg_roles where rolname !~ '^pg_' order by 1`;
  const mO = new Set(lineas(psql('postgres', consultaMembresias))); const mD = new Set(lineas(v(consultaMembresias)));
  const aO = lineas(psql('postgres', consultaAtributos)); const aD = new Set(lineas(v(consultaAtributos)));
  const rolesDespues = lineas(v(`select rolname from pg_roles where rolname !~ '^pg_' order by 1`));
  res.pasos.restauracion_cluster_preparado = {
    preparacion_roles: {
      codigo_psql: ar.codigo, errores_total: errRoles.length, por_categoria: cr.porCategoria, esperados: cr.esperados.map((x) => `${x.categoria}: ${x.linea.replace(/^psql:\S+?:/, '')}`).slice(0, 4), inesperados: cr.inesperados,
      reparacion: { aplicadas: reparar.length, codigo: rep.codigo, error: rep.err.slice(0, 300) },
    },
    verificacion_roles: {
      pertenencias_origen: mO.size, pertenencias_destino: mD.size,
      pertenencias_distintas: [...mO].filter((x) => !mD.has(x)).concat([...mD].filter((x) => !mO.has(x))),
      atributos_distintos: aO.filter((x) => !aD.has(x)).map((x) => x.split('|')[0]),
      atributos_distintos_esperados: rolesAntes, // el superusuario inicial del clúster conserva sus atributos
    },
    roles_en_destino_despues: rolesDespues.length,
  };
  v(PREP_EXT_VACIO, 'con_roles');
  const rB = ejec(`pg_restore --exit-on-error --use-list=${listaSinPublic} --dbname=con_roles -h ${SOCK} -p ${P} --username=postgres ${dump}`, { usuario: 'postgres' });
  res.pasos.restauracion_cluster_preparado.codigo = rB.codigo;
  res.pasos.restauracion_cluster_preparado.salida = rB.err.slice(-400);
  if (rB.codigo === 0) res.pasos.restauracion_cluster_preparado.diferencias = comparar(origen, Object.fromEntries(lineas(v(HUELLA, 'con_roles')).map((l) => l.split('|'))));
}

// 5) Limpieza: SIEMPRE se intenta (bases de prueba, clúster vacío y archivos); un fallo aquí nunca oculta el error original.
const limpiezas = [
  () => { exigir(`pg_ctl -D ${V} -m immediate stop >/dev/null 2>&1; rm -rf ${V} ${SOCK}`, { usuario: 'postgres' }); },
  () => { psql('template1', 'drop database if exists recup_a with (force); drop database if exists recup_n with (force);'); },
  () => { exigir(`rm -rf ${DIR}`); },
  () => { // verificación: no quedan residuos
    const resto = lineas(psql('postgres', `select datname from pg_database where datname in ('recup_a','recup_n')`));
    const dir = ejec(`test -e ${DIR} -o -e ${V} -o -e ${SOCK}`).codigo === 0;
    if (resto.length || dir) throw new Error(`quedaron residuos: bases=${resto.join(',') || '-'} archivos=${dir}`);
  },
];

let errorOriginal = null;
try {
  await ejecutarConLimpieza(principal, limpiezas);
  res.pasos.limpieza = { errores: [] };
} catch (e) {
  errorOriginal = e;
  res.pasos.limpieza = { errores: e.limpiezaErrores ?? [] };
}
if (errorOriginal) { res.error = String(errorOriginal.message ?? errorOriginal); }
res.fallos = errorOriginal ? [`error: ${res.error}`] : evaluarResultado(res);
mkdirSync(new URL('./results-ensayo/', import.meta.url), { recursive: true });
writeFileSync(new URL('./results-ensayo/respaldo-procedimiento.json', import.meta.url), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res.pasos, null, 1).slice(0, 5000));
console.log(res.fallos.length ? `\nENSAYO FALLIDO (${res.fallos.length}):\n- ${res.fallos.join('\n- ')}` : '\nENSAYO CORRECTO: sin fallos ni diferencias; los controles negativos fallaron como se esperaba.');
process.exit(codigoDeSalida({ fallos: res.fallos, error: errorOriginal }));
