// Ensayo del PROCEDIMIENTO DE RESPALDO Y RESTAURACIÓN con DATOS FICTICIOS, íntegramente dentro del contenedor de la instancia
// desechable «JaiseEnsayo» (rutas /tmp/respaldo-ensayo; nada sale a QA ni a producción, no se conecta a ningún proyecto remoto).
// Reproduce los pasos de docs/lanzamiento/PROCEDIMIENTO-RESPALDO-PRODUCCION.md: exportación (pg_dump -Fc con los privilegios de un
// rol que NO es superusuario, como «postgres» en Supabase alojado), lectura del archivo (pg_restore --list), roles globales
// (pg_dumpall --roles-only, que pg_dump NO guarda), restauración (A: destino con los roles ya creados; B: clúster vacío sin
// roles, primero sin y luego con los roles preparados) y comparación de propietarios, privilegios y datos.
// Uso: node tests/e2e/ensayo-respaldo-procedimiento.mjs   (escribe tests/e2e/results-ensayo/respaldo-procedimiento.json)
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { CONTENEDOR, verificarDestinoEnsayo } from './ensayo-destino.mjs';

verificarDestinoEnsayo('postgres');
const DIR = '/tmp/respaldo-ensayo';
const ESQUEMAS = ['public', 'auth', 'storage', 'supabase_migrations'];
const sh = (cmd, { usuario = 'root', permitirError = false } = {}) => {
  try {
    return { ok: true, out: execFileSync('docker', ['exec', '-u', usuario, CONTENEDOR, 'sh', '-c', cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 }).trim() };
  } catch (e) {
    if (!permitirError) throw new Error(`${cmd.slice(0, 120)} → ${String(e.stderr || e.message).slice(0, 400)}`);
    return { ok: false, out: String(e.stdout || '').trim(), err: String(e.stderr || e.message).trim() };
  }
};
const psql = (base, sql, { usuario = 'supabase_admin', puerto = null, socket = null } = {}) => {
  const conn = puerto ? `-h ${socket} -p ${puerto}` : '';
  return sh(`psql ${conn} -U ${usuario} -d ${base} -v ON_ERROR_STOP=1 -At -q -f - <<'SQL_FIN'\n${sql}\nSQL_FIN`, { permitirError: true });
};

const res = { version_pg_dump: '', version_servidor: '', pasos: {} };
res.version_pg_dump = sh('pg_dump --version').out;
res.version_servidor = psql('postgres', 'show server_version').out;
const mismoMayor = res.version_pg_dump.match(/(\d+)\./)?.[1] === res.version_servidor.split('.')[0];
if (!mismoMayor) throw new Error(`pg_dump (${res.version_pg_dump}) y servidor (${res.version_servidor}) deben ser del mismo mayor o pg_dump más nuevo`);

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
const huella = (base, o = {}) => {
  const r = psql(base, HUELLA, o);
  if (!r.ok) throw new Error(`huella ${base}: ${r.err}`);
  return Object.fromEntries(r.out.split('\n').filter(Boolean).map((l) => l.split('|')));
};
const comparar = (a, b) => Object.keys(a).filter((k) => a[k] !== b[k]);

sh(`rm -rf ${DIR} && mkdir -p ${DIR} && chmod 777 ${DIR}`);
const origen = huella('postgres');
const localeOrigen = psql('postgres', `select datcollate||'|'||datctype||'|'||pg_encoding_to_char(encoding)||'|'||datlocprovider::text||'|'||coalesce(datlocale,'') from pg_database where datname = current_database()`).out.split('|');
res.locale_origen = { lc_collate: localeOrigen[0], lc_ctype: localeOrigen[1], encoding: localeOrigen[2], proveedor: localeOrigen[3], locale: localeOrigen[4] };
res.origen_huella = origen;

// 1) EXPORTACIÓN como «postgres» (NO superusuario). Sin --no-owner ni --no-acl: se conservan propietarios y privilegios.
const nflag = ESQUEMAS.map((e) => `--schema=${e}`).join(' ');
const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
const dump = `${DIR}/ficticio_${ts}.dump`;
const t0 = Date.now();
const exp = sh(`pg_dump --format=custom ${nflag} --file=${dump} --dbname=postgres --username=postgres; echo "codigo=$?"`, { usuario: 'root', permitirError: true });
res.pasos.exportacion = { comando: `pg_dump --format=custom ${nflag} --file=<archivo> --dbname=<conexion>`, salida: exp.out.slice(-300), ms: Date.now() - t0 };
if (!/codigo=0/.test(exp.out)) throw new Error(`pg_dump falló: ${exp.err ?? exp.out}`);
res.pasos.exportacion.bytes = Number(sh(`wc -c < ${dump}`).out);
res.pasos.exportacion.sha256 = sh(`sha256sum ${dump} | cut -d' ' -f1`).out;

// 2) LECTURA del archivo (no restaura): cabecera y conteo de entradas por tipo; presencia de OWNER/ACL.
const lista = sh(`pg_restore --list ${dump} > ${DIR}/lista.txt; wc -l < ${DIR}/lista.txt`).out;
const cab = sh(`pg_restore --list ${dump} | head -14`).out;
const tipos = sh(`pg_restore --list ${dump} | grep -v '^;' | awk '{print $4" "$5}' | sort | uniq -c | sort -rn | head -12`).out;
res.pasos.lectura = { lineas: Number(lista), cabecera: cab.split('\n').filter((l) => /Archive created|Dumped from|Dumped by|Compression|Format|Dbname|TOC Entries|Database/.test(l)), tipos_mas_frecuentes: tipos };
const sinOwnerFlag = sh(`pg_restore --list ${dump} | grep -c ' ACL ' || true`).out;
res.pasos.lectura.entradas_acl = Number(sinOwnerFlag);
// El propietario va dentro de cada entrada (pg_restore --schema-only -f - muestra los ALTER ... OWNER TO).
res.pasos.lectura.alter_owner = Number(sh(`pg_restore --schema-only -f - ${dump} | grep -c 'OWNER TO' || true`).out);
res.pasos.lectura.grant_revoke = Number(sh(`pg_restore --schema-only -f - ${dump} | grep -cE '^(GRANT|REVOKE) ' || true`).out);

// 3) ROLES GLOBALES: pg_dump NO los guarda. Se exportan aparte (sin contraseñas) y se anota qué contiene el archivo.
const roles = `${DIR}/roles.sql`;
const r3 = sh(`pg_dumpall --roles-only --no-role-passwords --username=postgres > ${roles} 2>${DIR}/roles.err; echo "codigo=$?"`, { permitirError: true });
res.pasos.roles = { comando: 'pg_dumpall --roles-only --no-role-passwords --username=<usuario> > roles.sql', salida: r3.out.slice(-200) };
const rolesAnalisis = psql('postgres', `select string_agg(rolname, ',' order by rolname) from pg_roles where rolname !~ '^pg_'`).out;
res.pasos.roles.roles_en_origen = rolesAnalisis.split(',');
res.pasos.roles.lineas_create_role = Number(sh(`grep -c '^CREATE ROLE' ${roles} || true`).out);
res.pasos.roles.pertenencias = Number(sh(`grep -c 'GRANT .* TO .* GRANTED BY' ${roles} || grep -c '^GRANT' ${roles} || true`).out);
res.pasos.roles.alter_role_set = Number(sh(`grep -cE '^ALTER ROLE .* SET ' ${roles} || true`).out);
res.pasos.roles.alter_role_attributos = Number(sh(`grep -cE '^ALTER ROLE ' ${roles} || true`).out);
res.pasos.roles.contiene_contrasenas = Number(sh(`grep -ci 'PASSWORD' ${roles} || true`).out) > 0;
res.pasos.roles.dump_contiene_roles = Number(sh(`pg_restore --list ${dump} | grep -c ' ROLE ' || true`).out) > 0;

// La base nueva ya trae el esquema «public» (con sus privilegios por omisión): se omite su CREATE SCHEMA en la lista de restauración.
{
  // Comenta (;) la línea «SCHEMA - public» de la lista de restauración, sin tocar el resto.
  const sed = String.raw`awk '/^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public /{print ";" $0; next} {print}'`;
  sh(`pg_restore --list ${dump} | ${sed} > ${DIR}/lista_sin_public.txt`);
  res.pasos.lectura.entrada_schema_public_omitida = Number(sh(String.raw`grep -cE '^;[0-9]+; [0-9]+ [0-9]+ SCHEMA - public ' ${DIR}/lista_sin_public.txt || true`).out);
}

// 4A) RESTAURACIÓN en un destino que YA tiene los roles (p. ej. otra instancia Supabase): base nueva desde template0.
const PREP_EXT = `create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions; create schema if not exists vault; create extension if not exists supabase_vault with schema vault;`;
const base = 'recup_a';
psql('template1', `drop database if exists ${base} with (force); create database ${base} template template0;`);
psql(base, PREP_EXT);
const rA = sh(`pg_restore --exit-on-error --use-list=${DIR}/lista_sin_public.txt --dbname=${base} --username=supabase_admin ${dump} 2>&1; echo "codigo=$?"`, { permitirError: true });
res.pasos.restauracion_con_roles = { codigo: /codigo=0/.test(rA.out + (rA.err ?? '')) ? 0 : 1, salida: ((rA.err ?? '') + rA.out).slice(-400) };
const huellaA = huella(base);
res.pasos.restauracion_con_roles.diferencias = comparar(origen, huellaA);

// 4A') CONTRASTE: la misma restauración con --no-owner --no-acl pierde propietarios y privilegios (por eso NO se usan).
psql('template1', `drop database if exists recup_n with (force); create database recup_n template template0;`);
psql('recup_n', PREP_EXT);
const rN = sh(`pg_restore --exit-on-error --no-owner --no-acl --use-list=${DIR}/lista_sin_public.txt --dbname=recup_n --username=supabase_admin ${dump} 2>&1; echo "codigo=$?"`, { permitirError: true });
res.pasos.contraste_sin_propietarios = { codigo: /codigo=0/.test(rN.out) ? 0 : 1, categorias_que_difieren: comparar(origen, huella('recup_n')) };
psql('template1', `drop database if exists recup_n with (force)`);

// 4B) CLÚSTER VACÍO sin roles de Supabase: lo que pasa si no se prepara el destino.
const V = '/tmp/vanilla-ensayo'; const SOCK = '/tmp/vanilla-sock'; const P = 55432;
sh(`pkill -u postgres -f "${V}" 2>/dev/null; rm -rf ${V} ${SOCK}; mkdir -p ${SOCK}; chown postgres ${SOCK} ${DIR}; chmod 755 ${DIR}`, { permitirError: true });
sh(`initdb -D ${V} -U postgres --auth=trust -E UTF8 >/dev/null`, { usuario: 'postgres' });
sh(`pg_ctl -D ${V} -o "-p ${P} -k ${SOCK} -c listen_addresses=''" -l ${V}/log -w start >/dev/null`, { usuario: 'postgres' });
try {
  const v = (sql, base2 = 'postgres') => psql(base2, sql, { usuario: 'postgres', puerto: P, socket: SOCK });
  v(`create database sin_roles template template0`);
  const rolesAntes = v(`select count(*) from pg_roles where rolname !~ '^pg_'`).out;
  const rB1 = sh(`pg_restore --use-list=${DIR}/lista_sin_public.txt --dbname=sin_roles -h ${SOCK} -p ${P} --username=postgres ${dump} 2>&1 | grep -c 'does not exist' || true`, { usuario: 'postgres', permitirError: true });
  const errRol = sh(`pg_restore --use-list=${DIR}/lista_sin_public.txt --dbname=sin_roles -h ${SOCK} -p ${P} --username=postgres ${dump} 2>&1 | grep -m3 'does not exist' || true`, { usuario: 'postgres', permitirError: true });
  res.pasos.restauracion_sin_roles = { roles_en_destino_antes: Number(rolesAntes), errores_rol_inexistente: Number(rB1.out), ejemplos: errRol.out.split('\n') };
  // Preparar el destino: roles (del roles.sql) + extensiones/esquemas; luego restaurar con --exit-on-error.
  const localeDestinoPorOmision = v(`select datcollate||'|'||pg_encoding_to_char(encoding) from pg_database where datname = 'postgres'`).out;
  v(`create database con_roles_sin_locale template template0`);
    res.pasos.locale = { destino_por_omision: localeDestinoPorOmision, origen: res.locale_origen };
  v(`create database con_roles template template0 encoding '${res.locale_origen.encoding}' lc_collate '${res.locale_origen.lc_collate}' lc_ctype '${res.locale_origen.lc_ctype}'${res.locale_origen.proveedor === 'i' ? ` locale_provider icu icu_locale '${res.locale_origen.locale}'` : ''}`);
  res.pasos.locale.proveedor = { origen: psql('postgres', `select datlocprovider::text||coalesce(datlocale,'') from pg_database where datname=current_database()`).out, destino: v(`select datlocprovider::text||coalesce(datlocale,'') from pg_database where datname='con_roles'`).out };
  const rr = sh(`psql -h ${SOCK} -p ${P} -U postgres -d postgres -q -f ${roles} 2>&1 | grep -c ERROR || true`, { usuario: 'postgres', permitirError: true });
  v(PREP_EXT.replace('create extension if not exists supabase_vault with schema vault;', ''), 'con_roles');
  const rB2 = sh(`pg_restore --exit-on-error --use-list=${DIR}/lista_sin_public.txt --dbname=con_roles -h ${SOCK} -p ${P} --username=postgres ${dump} 2>&1; echo "codigo=$?"`, { usuario: 'postgres', permitirError: true });
  const rolesDespues = v(`select count(*) from pg_roles where rolname !~ '^pg_'`).out;
  res.pasos.restauracion_clúster_preparado = { errores_al_crear_roles: Number(rr.out), roles_en_destino_despues: Number(rolesDespues), codigo: /codigo=0/.test(rB2.out + (rB2.err ?? '')) ? 0 : 1, salida: ((rB2.err ?? '') + rB2.out).slice(-500) };
  if (res.pasos.restauracion_clúster_preparado.codigo === 0) {
    const hB = Object.fromEntries(v(HUELLA, 'con_roles').out.split('\n').filter(Boolean).map((l) => l.split('|')));
    res.pasos.restauracion_clúster_preparado.diferencias = comparar(origen, hB);
    if (res.pasos.restauracion_clúster_preparado.diferencias.length) {
      const det = (b, o) => psql(b, `set search_path = pg_catalog; select schemaname||'.'||tablename||'.'||policyname||'|'||cmd||'|'||roles::text||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') from pg_policies where schemaname in (${filtro}) order by 1`, o).out.split(String.fromCharCode(10));
      const a = new Set(det('postgres')); const bb = new Set(det('con_roles', { usuario: 'postgres', puerto: P, socket: SOCK }));
      const tabs = (b, o) => psql(b, `set search_path = pg_catalog; select n.nspname||'.'||c.relname||'='||(xpath('/row/h/text()', query_to_xml(format('select count(*)||'':''||md5(coalesce(string_agg(t::text, ''|'' order by t::text),'''')) as h from %I.%I t', n.nspname, c.relname), false, true, '')))[1]::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${filtro}) and c.relkind in ('r','p') order by 1`, o).out.split(String.fromCharCode(10));
      const ta = new Set(tabs('postgres')); const tb = new Set(tabs('con_roles', { usuario: 'postgres', puerto: P, socket: SOCK }));
      res.pasos.restauracion_clúster_preparado.tablas_con_datos_distintos = [...ta].filter((x) => !tb.has(x)).map((x) => x.split('=')[0]);
      res.pasos.restauracion_clúster_preparado.hash_tabla = { origen: [...ta].filter((x) => x.startsWith('storage.migrations=')), destino: [...tb].filter((x) => x.startsWith('storage.migrations=')) };
      const filasMig = (b, o) => psql(b, `select id||'|'||name||'|'||hash||'|'||coalesce(executed_at::text,'') from storage.migrations order by id`, o).out.split(String.fromCharCode(10));
      const fa = filasMig('postgres'); const fb = filasMig('con_roles', { usuario: 'postgres', puerto: P, socket: SOCK });
      res.pasos.restauracion_clúster_preparado.storage_migrations = { origen: fa.length, destino: fb.length, solo_origen: fa.filter((x) => !fb.includes(x)).slice(0, 3), solo_destino: fb.filter((x) => !fa.includes(x)).slice(0, 3) };
      res.pasos.restauracion_clúster_preparado.politicas_distintas = [...a].filter((x) => !bb.has(x)).slice(0, 3).map((x) => x.slice(0, 300));
      const cfg = (b, o) => psql(b, `select current_setting('TimeZone')||' '||current_setting('DateStyle')||' '||current_setting('IntervalStyle')||' '||current_setting('search_path')`, o).out;
      res.pasos.restauracion_clúster_preparado.config = { origen: cfg('postgres'), destino: cfg('con_roles', { usuario: 'postgres', puerto: P, socket: SOCK }) };
    }
  }
} finally {
  sh(`pg_ctl -D ${V} -m immediate stop >/dev/null 2>&1; rm -rf ${V} ${SOCK}`, { usuario: 'postgres', permitirError: true });
}

// 5) Limpieza: la base de prueba y los archivos de /tmp del contenedor (el dump ficticio no se conserva).
psql('template1', `drop database if exists ${base} with (force)`);
res.pasos.limpieza = sh(`rm -rf ${DIR}; echo ok`).out;
mkdirSync(new URL('./results-ensayo/', import.meta.url), { recursive: true });
writeFileSync(new URL('./results-ensayo/respaldo-procedimiento.json', import.meta.url), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res.pasos, null, 1).slice(0, 6000));
