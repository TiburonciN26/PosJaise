// QA-054 — reproducción en ROJO: ejecuta el escenario de Codex contra las definiciones ANTERIORES (migraciones 102 y
// 20261002000003) de confirmar_pedido_productos y verificar_pago_pedido_web, instaladas SOLO dentro de una transacción que
// termina en ROLLBACK (la base de Supabase Local TEST no se modifica). Capa SQL; no es E2E con sesión real.
//
//   node tests/e2e/qa-054-rojo.mjs
//
// Resultado esperado con el código anterior: el pedido SE ACEPTA (la clienta pagaría S/40) y «Verificar pago» lo rechaza.
import { readFileSync } from 'node:fs';
import * as h from './recompensas-fase2-helpers.mjs';

await h.verificarLocalTest();
const cortar = (archivo, desde, hasta) => {
  const t = readFileSync(archivo, 'utf8').replace(/\r\n/g, '\n');
  const i = t.search(desde);
  const j = hasta ? t.indexOf(hasta, i) : t.lastIndexOf('commit;');
  return t.slice(i, j);
};
const viejoPedido = cortar('supabase/migrations/20261001000102_pedidos_web_descuento_cupon.sql', /create or replace function public\.confirmar_pedido_productos/i, '\ncommit;');
const viejoVerificar = cortar('supabase/migrations/20261002000003_pedidos_cupones_ambiguedades_pago.sql', /CREATE OR REPLACE FUNCTION public\.verificar_pago_pedido_web/, null);

// Escenario de Codex: producto S50, costo S20 + transporte S3 + otros S25 = protección S48; cupón S10.
const c = await h.nuevaClienta();
const p = await h.nuevoProducto(50, 10, { costo: 20, transporte: 3, otros: 25 });
const cup = await h.nuevoCupon(c.clienteId, { valor: 10 });
await h.ponerEnCarrito(c.uid, p, 1);
const dia = await h.diaEntregaValido();

const claims = (uid) => h.como(uid, { rol: true }).replace('set role authenticated;\n', '');
const sql = `begin;
drop function if exists public.confirmar_pedido_productos(uuid[], text, date, time without time zone, text, text, uuid, text, text, text, text, text, text, jsonb, numeric);
${viejoPedido}
${viejoVerificar}
${claims(c.uid)}set role authenticated;
create temp table res (paso text, valor text);
grant all on res to authenticated;
insert into res select 'pedido_creado', public.confirmar_pedido_productos(array['${p}']::uuid[], 'RECOJO_TIENDA', '${dia}', '10:00', 'YAPE', 'ficticio/c.jpg', null, null, null, '${cup.codigo}')::text;
insert into res select 'total_anunciado_a_la_clienta', total::text from public.pedidos_web where cliente_id='${c.clienteId}';
reset role;
${claims(h.ADMIN)}set role authenticated;
do $$ declare m text; begin
  perform public.verificar_pago_pedido_web((select id from public.pedidos_web where cliente_id='${c.clienteId}'));
  insert into res values ('verificar_pago', 'ACEPTADO');
exception when others then insert into res values ('verificar_pago', 'RECHAZADO: ' || sqlerrm); end $$;
select paso || ' = ' || valor from res;
rollback;`;
const r = await h.admin(sql);
console.log(r.ok ? r.out : `ERROR: ${r.err}`);
const quedo = await h.json(`select to_json((select count(*) from public.pedidos_web where cliente_id='${c.clienteId}'))`);
console.log(`Tras el ROLLBACK, pedidos de la clienta de prueba en la base: ${quedo} (la base no cambió)`);
