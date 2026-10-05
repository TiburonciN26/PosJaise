// Cierre global de la suite de QA (Supabase Local TEST). Desactiva SOLO la promoción creada por la preparación global de ESTA
// corrida, identificada por su título exacto y único (prefijo + id de corrida). Motivo (preparación de QA-005): esa promoción
// vence hoy y, si queda activa, compite en Inicio con la promoción propia de las corridas siguientes del mismo día.
// No toca promociones de otras corridas ni usa filtros amplios.
import { readFile } from 'node:fs/promises';
import * as h from './recompensas-fase2-helpers.mjs';

export default async function globalTeardown() {
  let data;
  try { data = JSON.parse(await readFile('tests/e2e/fixtures/runtime.json', 'utf8')); } catch { return; }
  const titulo = data?.promotionName;
  if (!titulo || !data.prefix || !titulo.startsWith(data.prefix) || /'/.test(titulo)) return;
  await h.verificarLocalTest();
  const r = await h.admin(`update public.promociones set activo = false where titulo = '${titulo}' and activo;`);
  if (!r.ok) throw new Error(`No se pudo desactivar la promoción de la preparación global: ${String(r.err).split('\n')[0]}`);
}
