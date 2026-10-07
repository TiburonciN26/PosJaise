// Aplica, SOLO en la instancia desechable, las migraciones de la actualización de lanzamiento (las 21 fechadas 20261002..20261007),
// en orden de nombre y una por una, con el rol «postgres» (el mismo que usa apply_migration de Supabase MCP en producción:
// sus objetos nuevos reciben los privilegios por omisión de producción, no los de Local). Cada archivo se confirma por separado
// (no hay una transacción común de las 21). Se detiene en el primer error, también si falla registrar la versión en
// supabase_migrations.schema_migrations o si, tras registrarla, no se encuentra. No usa el CLI, no toca QA ni producción.
// Uso: node tests/e2e/ensayo-aplicar-migraciones.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { CONTENEDOR, verificarDestinoEnsayo } from './ensayo-destino.mjs';
import { aplicarEnOrden } from './ensayo-aplicar-migraciones-nucleo.mjs';

verificarDestinoEnsayo('postgres');
const dir = new URL('../../supabase/migrations/', import.meta.url);
const archivos = readdirSync(dir).filter((f) => /^2026100[2-7]\d+_.+\.sql$/.test(f)).sort();
if (archivos.length !== 21) throw new Error(`Se esperaban 21 migraciones y hay ${archivos.length}.`);

const psql = (usuario, extra, input) => spawnSync('docker', ['exec', '-i', CONTENEDOR, 'psql', '-U', usuario, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', ...extra], { input, encoding: 'utf8' });
const soloDigitos = (v) => { if (!/^\d+$/.test(v)) throw new Error(`Versión inválida: ${v}`); return v; };
const soloNombre = (n) => { if (!/^[\w]+$/.test(n)) throw new Error(`Nombre inválido: ${n}`); return n; };

const t0 = Date.now();
const filas = await aplicarEnOrden(archivos, {
  aplicar: async (f) => {
    const r = psql('postgres', [], readFileSync(new URL(f, dir)));
    return { ok: r.status === 0, error: (r.stderr || '').trim().slice(0, 600) };
  },
  registrar: async (version, nombre) => {
    const r = psql('supabase_admin', ['-c', `insert into supabase_migrations.schema_migrations(version, name) values ('${soloDigitos(version)}', '${soloNombre(nombre)}') on conflict (version) do nothing`]);
    return { ok: r.status === 0, error: (r.stderr || '').trim().slice(0, 300) };
  },
  versionRegistrada: async (version) => {
    const r = psql('supabase_admin', ['-At', '-c', `select count(*) from supabase_migrations.schema_migrations where version = '${soloDigitos(version)}'`]);
    return r.status === 0 && (r.stdout || '').trim() === '1';
  },
});
for (const fila of filas) console.log(`${fila.ok ? 'OK ' : 'ERR'} ${fila.archivo}${fila.ok ? '' : ` [paso: ${fila.paso}]\n${fila.error}`}`);
const hechas = filas.filter((x) => x.ok).length;
if (hechas < archivos.length) console.log(`DETENIDO: ${hechas} migraciones completas; la siguiente quedó en estado parcial posible (paso «${filas.at(-1)?.paso}»). Revisar antes de continuar.`);
mkdirSync(new URL('./results-ensayo/', import.meta.url), { recursive: true });
writeFileSync(new URL('./results-ensayo/lanzamiento-aplicar.json', import.meta.url), JSON.stringify({ ms: Date.now() - t0, filas }, null, 1));
console.log(`${hechas}/${archivos.length} aplicadas y registradas`);
process.exit(hechas === archivos.length ? 0 : 1);
