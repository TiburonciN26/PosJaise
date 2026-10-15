// Prueba reproducible en PostgreSQL DESECHABLE: sin red, sin volúmenes ni
// conexión a las bases Supabase del proyecto. Requiere Docker y la imagen local.
const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const raiz = resolve(__dirname, '..')
const nombre = `qa-login-fotos-sql-${process.pid}`
const imagen = 'public.ecr.aws/supabase/postgres:17.11.0.002'
const docker = (args, opciones = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opciones })
let creado = false

async function ejecutar() {
  try {
    docker(['run', '--detach', '--rm', '--pull=never', '--name', nombre, '--network', 'none', '--user', 'postgres', '--entrypoint', 'sh', imagen,
      '-c', "initdb -D /tmp/qa-login-pg -A trust --no-locale >/tmp/init.log && exec postgres -D /tmp/qa-login-pg -k /tmp -c listen_addresses='' "])
    creado = true
    let listo = false
    for (let intento = 0; intento < 60; intento++) {
      try { docker(['exec', nombre, 'pg_isready', '-h', '/tmp', '-U', 'postgres']); listo = true; break } catch { await new Promise((r) => setTimeout(r, 250)) }
    }
    if (!listo) throw new Error('PostgreSQL temporal no inició.')
    const original = readFileSync(resolve(raiz, 'supabase/migrations/20261001000003_rls.sql'), 'utf8')
    const correccion = readFileSync(resolve(raiz, 'supabase/migrations/20261002000006_es_admin_siempre_boolean.sql'), 'utf8')
    const rolActual = original.match(/create or replace function public\.rol_actual\(\)[\s\S]+?\$\$;/)[0]
    const esAdmin = correccion.match(/create or replace function public\.es_admin\(\)[\s\S]+?\$function\$;/)[0]
    const prefijo = `
      create role anon;
      create role authenticated;
      create schema auth;
      grant usage on schema public, auth to anon, authenticated;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table public.usuarios(id uuid primary key, rol text, activo boolean);
      insert into public.usuarios values
        ('00000000-0000-0000-0000-000000000001','ADMINISTRADOR',true),
        ('00000000-0000-0000-0000-000000000002','CAJERA',true),
        ('00000000-0000-0000-0000-000000000003','ASISTENTE',true),
        ('00000000-0000-0000-0000-000000000004','ADMINISTRADOR',false);
      ${rolActual}
      ${esAdmin}
    `
    const migracion = readFileSync(resolve(raiz, 'supabase/migrations/20261015150644_login_web_fotos.sql'), 'utf8')
    const pruebas = readFileSync(resolve(raiz, 'tests/sql/login-web-fotos.sql'), 'utf8')
    docker(['exec', '-i', nombre, 'psql', '-h', '/tmp', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: prefijo + migracion + pruebas })
    console.log('PASS: SQL real, RLS anon/cliente/cajera/asistente/admin inactivo, guardado atómico, conflictos y validación. Sin conexiones a Supabase.')
  } finally {
    // Solo el contenedor creado por ESTA ejecución, nunca un Supabase existente.
    if (creado) docker(['rm', '--force', nombre])
  }
}
ejecutar().catch((e) => { console.error(e.stderr?.toString() || e.message); process.exitCode = 1 })
