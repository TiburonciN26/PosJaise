// Instantánea de lo que ve el negocio en el ensayo de lanzamiento: huella de los datos existentes y lecturas del portal/paneles.
// Se toma ANTES y DESPUÉS de aplicar las migraciones y se comparan (ensayo-lanzamiento-comparar.mjs). Solo lecturas (RPC STABLE o
// de consulta); ninguna escritura. Uso: ENSAYO_PASSWORD=... FASE=pre|post node tests/e2e/ensayo-lanzamiento-instantanea.mjs
import { request } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { R, sesion, rpc, huellaNegocio, LECTURAS, verificarEntorno } from './ensayo-ui/lanzamiento-ayuda.mjs';

const fase = process.env.FASE;
if (!['pre', 'post'].includes(fase)) throw new Error('FASE debe ser pre o post.');
const api = await request.newContext();
await verificarEntorno(api);
const out = { fase, negocio: await huellaNegocio(), lecturas: {} };
const rango = { p_desde: '2020-01-01T00:00:00Z', p_hasta: '2030-01-01T00:00:00Z' };
const quien = { CLIENTE1: R.cuentas.CLIENTE1, CLIENTE2: R.cuentas.CLIENTE2, ADMINISTRADOR: R.cuentas.ADMINISTRADOR, CAJERA: R.cuentas.CAJERA };
for (const [rol, email] of Object.entries(quien)) {
  const { token } = await sesion(api, email);
  out.lecturas[rol] = {};
  const lista = rol.startsWith('CLIENTE') ? LECTURAS
    : [['resumen_dashboard', rango], ['resumen_estadisticas', { ...rango, p_incluir_detalle: true }], ['resumen_historial', rango], ['resumen_inventario', {}], ['resumen_asistentes_periodo', rango], ['datos_contacto', {}]];
  for (const [fn, args] of lista) {
    const r = await rpc(api, token, fn, args);
    out.lecturas[rol][fn] = { status: r.status, cuerpo: r.cuerpo };
  }
}
await mkdir(new URL('./results-ensayo/', import.meta.url), { recursive: true });
await writeFile(new URL(`./results-ensayo/lanzamiento-instantanea-${fase}.json`, import.meta.url), JSON.stringify(out, null, 1));
const ok = Object.values(out.lecturas).flatMap((m) => Object.entries(m)).filter(([, v]) => v.status !== 200).map(([k, v]) => `${k}:${v.status}`);
console.log(`Instantánea ${fase}: negocio=${Object.keys(out.negocio).length} tablas; lecturas con estado ≠ 200: ${ok.length ? ok.join(', ') : 'ninguna'}`);
await api.dispose();
