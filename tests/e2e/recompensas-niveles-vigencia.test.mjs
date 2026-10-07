// QA-064 y QA-075 — nivel canónico de premios/cupones y vigencia de uso de los cupones especiales (capa SQL, solo Supabase Local TEST;
// datos ficticios «TEST F2»).
//
//   node --test --test-concurrency=1 tests/e2e/recompensas-niveles-vigencia.test.mjs
//
// IMPORTANTE: esta capa simula la identidad con request.jwt.claims (rol authenticated); NO es E2E con sesión real ni evidencia de interfaz.
// La interfaz con sesión (canje y reclamo reales, «Mis cupones») NO está cubierta aquí ni se ejecutó sin QA_TEST_PASSWORD: ver
// docs/recompensas-fase2/COHERENCIA-NIVELES-Y-VIGENCIA.md, «Pendiente con sesión». Sin sesión: niveles-visuales*.test.mjs, tarjetas-cupon-niveles.test.mjs
// y qa-062-niveles-visuales-publico.mjs.
//
// Cada prueba restaura el programa (activo/parámetros) al terminar y desactiva las promociones que creó (QA-005 exige que no queden
// promociones TEST activas). El «paso del tiempo» se simula moviendo `cupones.vigente_hasta` al pasado: now() no se puede adelantar, y lo que se
// verifica aparte, con valores exactos, es CUÁNDO vence cada cupón emitido.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as h from './recompensas-fase2-helpers.mjs';

let cfg0;
const promos = [];
before(async () => { await h.verificarLocalTest(); cfg0 = await h.configActual(); await h.activar(true); });
after(async () => {
  if (promos.length) await h.admin(`update public.promociones set activo = false where id in (${promos.map((p) => `'${p}'`).join(',')});`);
  if (cfg0) await h.restaurarConfig(cfg0);
});

const casi = (a, b, msg) => assert.ok(Math.abs(Number(a) - Number(b)) < 1e-9, `${msg ?? ''} esperado ${b}, obtenido ${a}`);
const ORDEN = { BASICO: 0, PREMIUM: 1, VIP: 2 };
const NIVELES = ['BASICO', 'PREMIUM', 'VIP'];

// Clienta del nivel pedido, con saldo suficiente. Umbrales vigentes: PREMIUM 50, VIP 150 (clasificación).
async function clientaNivel(nivel, monedas = 1000) {
  const c = await h.nuevaClienta();
  await h.darMonedas(c.clienteId, monedas, 0);
  if (nivel === 'PREMIUM') await h.darMonedas(c.clienteId, 0, 60);
  if (nivel === 'VIP') await h.darMonedas(c.clienteId, 0, 200);
  assert.equal((await h.saldos(c.clienteId)).nivel, nivel, 'preparación del nivel');
  return c;
}

const fechaLima = (dias) => h.json(`select to_json(((now() at time zone 'America/Lima')::date + (${dias}))::text);`);

async function nuevaPromocion({ desde = null, hasta = null, valor = 10, tipo = 'MONTO_FIJO' } = {}) {
  const id = await h.json(`with p as (insert into public.promociones (titulo, tipo_descuento, valor, vigente_desde, vigente_hasta, activo)
    values ('TEST F2 especial ${h.runId}-${Math.random().toString(36).slice(2, 6)}', '${tipo}', ${valor},
            ${desde ? `'${desde}'` : 'null'}, ${hasta ? `'${hasta}'` : 'null'}, true) returning id) select to_json(id) from p;`);
  promos.push(id);
  return id;
}

const reclamar = async (uid, promoId) => {
  const r = await h.paso(uid, `select row_to_json(t) from public.reclamar_cupon_promocion('${promoId}') t;`, { rol: true });
  return r.ok ? { ok: true, cupon: JSON.parse(r.out.split('\n').filter(Boolean).pop()) } : { ok: false, err: r.err };
};
const cuponDe = (clienteId, promoId) =>
  h.json(`select row_to_json(c) from public.cupones c where cliente_id='${clienteId}' and promocion_id='${promoId}';`);
const expirar = (cuponId) => h.admin(`update public.cupones set vigente_hasta = now() - interval '1 second' where id='${cuponId}';`);
const conteoCupones = (clienteId, promoId) =>
  h.json(`select to_json(count(*)) from public.cupones where cliente_id='${clienteId}' and promocion_id='${promoId}';`);

// ───────────────────────────────── QA-064 ─────────────────────────────────
describe('QA-064 · un solo nivel de negocio para catálogo, permiso de canje y cupón emitido', () => {
  // Costos que NO siguen la escala por nivel: el premio BASICO es el más caro y el VIP el más barato, y el costo cambia por
  // nivel de la clienta (descuento de precio por nivel). El nivel visual/permiso no puede depender de nada de esto.
  const PREMIOS = {
    BASICO: { nivelMinimo: 'BASICO', costoBasico: 300, costoPremium: 250, costoVip: 200 },
    PREMIUM: { nivelMinimo: 'PREMIUM', costoBasico: 120, costoPremium: 90, costoVip: 60 },
    VIP: { nivelMinimo: 'VIP', costoBasico: 40, costoPremium: 30, costoVip: 20 },
  };
  const costoPara = (premio, nivelClienta) =>
    ({ BASICO: premio.costoBasico, PREMIUM: premio.costoPremium, VIP: premio.costoVip })[nivelClienta];

  test('matriz 3×3: cada clienta canjea su nivel y los inferiores; el backend rechaza los superiores sin tocar nada', async () => {
    const premios = {};
    for (const n of NIVELES) premios[n] = await h.nuevoPremio(PREMIOS[n]);
    for (const nivelClienta of NIVELES) {
      for (const nivelPremio of NIVELES) {
        const c = await clientaNivel(nivelClienta);
        const antes = await h.saldos(c.clienteId);
        const r = await h.paso(c.uid, `select * from public.canjear_recompensa('${premios[nivelPremio]}', 'm-${nivelClienta}-${nivelPremio}');`);
        const etiqueta = `clienta ${nivelClienta} × premio ${nivelPremio}`;
        const cupones = await h.json(`select to_json(count(*)) from public.cupones where cliente_id='${c.clienteId}';`);
        const despues = await h.saldos(c.clienteId);
        if (ORDEN[nivelClienta] >= ORDEN[nivelPremio]) {
          assert.ok(r.ok, `${etiqueta}: debe canjear (${r.err})`);
          assert.equal(cupones, 1, etiqueta);
          const k = await h.json(`select row_to_json(c) from public.cupones c where cliente_id='${c.clienteId}';`);
          // El cupón congela el nivel de negocio del PREMIO (no el de la clienta, ni uno derivado de costo o descuento).
          assert.equal(k.nivel_minimo, nivelPremio, `${etiqueta}: nivel del cupón`);
          assert.equal(k.nivel_aplicado, nivelClienta, `${etiqueta}: nivel de la clienta al canjear`);
          casi(k.costo_aplicado, costoPara(PREMIOS[nivelPremio], nivelClienta), `${etiqueta}: costo por nivel`);
          casi(Number(antes.monedas) - Number(despues.monedas), costoPara(PREMIOS[nivelPremio], nivelClienta), `${etiqueta}: monedas descontadas`);
        } else {
          assert.equal(r.ok, false, `${etiqueta}: el backend debe rechazar`);
          assert.match(r.err, new RegExp(`requiere nivel ${nivelPremio}`), etiqueta);
          assert.equal(cupones, 0, `${etiqueta}: no se emite cupón`);
          casi(despues.monedas, antes.monedas, `${etiqueta}: no se descuentan monedas`);
          casi(despues.clasificacion, antes.clasificacion);
        }
      }
    }
  });

  test('el catálogo, el motivo de bloqueo y mis_cupones usan el MISMO nivel que el permiso (también con costos por nivel distintos)', async () => {
    const premios = {};
    for (const n of NIVELES) premios[n] = await h.nuevoPremio(PREMIOS[n]);
    for (const nivelClienta of NIVELES) {
      const c = await clientaNivel(nivelClienta);
      const cat = await h.paso(c.uid, `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.mi_catalogo_recompensas('MONEDAS') t where t.id in (${Object.values(premios).map((p) => `'${p}'`).join(',')});`, { rol: true });
      assert.ok(cat.ok, cat.err);
      const filas = JSON.parse(cat.out.split('\n').filter(Boolean).pop());
      assert.equal(filas.length, 3);
      for (const nivelPremio of NIVELES) {
        const fila = filas.find((f) => f.id === premios[nivelPremio]);
        const debePoder = ORDEN[nivelClienta] >= ORDEN[nivelPremio];
        assert.equal(fila.nivel_minimo, nivelPremio, `catálogo: nivel del premio ${nivelPremio}`);
        assert.equal(fila.canjeable, debePoder, `clienta ${nivelClienta} × premio ${nivelPremio}: canjeable`);
        if (!debePoder) assert.equal(fila.motivo, `Requiere nivel ${nivelPremio}.`);
        casi(fila.costo, costoPara(PREMIOS[nivelPremio], nivelClienta), 'el costo cambia por nivel, el nivel del premio no');
      }
      // Canje de cada premio permitido y lectura del cupón por la RPC del portal.
      for (const nivelPremio of NIVELES.filter((n) => ORDEN[n] <= ORDEN[nivelClienta])) {
        assert.ok((await h.paso(c.uid, `select * from public.canjear_recompensa('${premios[nivelPremio]}', 'c-${nivelPremio}');`)).ok);
      }
      const mis = await h.paso(c.uid, `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.mis_cupones() t;`, { rol: true });
      const cupones = JSON.parse(mis.out.split('\n').filter(Boolean).pop());
      // Un cupón por premio canjeado y cada uno con el nivel de SU premio (el que se mostró y el que dio permiso).
      assert.deepEqual(
        cupones.map((k) => k.nivel_minimo).sort(),
        NIVELES.filter((n) => ORDEN[n] <= ORDEN[nivelClienta]).sort(),
      );
    }
  });

  test('un descuento de precio por nivel (costo_vip menor) no cambia el nivel del premio ni el del cupón', async () => {
    const premio = await h.nuevoPremio({ nivelMinimo: 'BASICO', costoBasico: 400, costoPremium: 200, costoVip: 10 });
    const vip = await clientaNivel('VIP');
    assert.ok((await h.paso(vip.uid, `select * from public.canjear_recompensa('${premio}', 'dv');`)).ok);
    const k = await h.json(`select row_to_json(c) from public.cupones c where cliente_id='${vip.clienteId}' and catalogo_id='${premio}';`);
    assert.equal(k.nivel_minimo, 'BASICO', 'cupón del nivel del premio, no del nivel de quien paga menos');
    casi(k.costo_aplicado, 10);
    assert.equal(k.nivel_aplicado, 'VIP');
  });

  test('canjear reduce monedas pero conserva clasificación, nivel y progreso', async () => {
    const c = await clientaNivel('PREMIUM', 200);
    const premio = await h.nuevoPremio(PREMIOS.PREMIUM);
    const antes = await h.saldos(c.clienteId);
    assert.ok((await h.paso(c.uid, `select * from public.canjear_recompensa('${premio}', 'rd');`)).ok);
    const despues = await h.saldos(c.clienteId);
    casi(despues.monedas, Number(antes.monedas) - 90);
    casi(despues.clasificacion, antes.clasificacion, 'la clasificación no baja');
    assert.equal(despues.nivel, 'PREMIUM');
    assert.equal(despues.nivel, antes.nivel);
  });

  test('un cupón de bienvenida/referido ya emitido no recibe restricciones nuevas: sigue usable con nivel_minimo BASICO', async () => {
    const c = await clientaNivel('BASICO', 0);
    const cup = await h.nuevoCupon(c.clienteId, { valor: 5 }); // origen PROMOCION fixture con nivel BASICO (el valor por defecto de toda fila anterior)
    const p = await h.nuevoProducto(40, 10, { costo: 5 });
    await h.ponerEnCarrito(c.uid, p, 1);
    const vp = await h.vistaPreviaCupon(c.uid, cup.codigo, [p]);
    assert.equal(vp.fila.valido, true, vp.fila.motivo);
  });
});

// ───────────────────────────────── QA-075 ─────────────────────────────────
describe('QA-075 · las fechas de una campaña limitan el reclamo Y el uso del cupón especial', () => {
  test('campaña vigente, para los tres niveles: se reclama, vence al terminar el último día (Lima) y se puede usar', async () => {
    const hoy = await fechaLima(0);
    const manana = await fechaLima(1);
    const promo = await nuevaPromocion({ desde: await fechaLima(-1), hasta: hoy, valor: 7 });
    for (const nivel of NIVELES) {
      const c = await clientaNivel(nivel, 0);
      const r = await reclamar(c.uid, promo);
      assert.ok(r.ok, `${nivel}: ${r.err}`);
      const k = await cuponDe(c.clienteId, promo);
      assert.equal(k.estado, 'DISPONIBLE');
      assert.equal(k.origen, 'PROMOCION');
      assert.equal(k.nivel_minimo, 'BASICO', 'los especiales están fuera de la escala: los puede usar cualquier nivel');
      // Vence en el INICIO del día siguiente a la campaña, hora de Lima (UTC−5, sin horario de verano): todo el último día cuenta.
      assert.equal(new Date(k.vigente_hasta).toISOString(), `${manana}T05:00:00.000Z`, `${nivel}: vencimiento exacto`);
      const p = await h.nuevoProducto(40, 10, { costo: 5 });
      await h.ponerEnCarrito(c.uid, p, 1);
      const vp = await h.vistaPreviaCupon(c.uid, k.codigo, [p]);
      assert.equal(vp.fila.valido, true, `${nivel}: ${vp.fila.motivo}`);
      casi(vp.fila.descuento, 7);
    }
  });

  test('límite del último día en Perú: no vence al empezar ese día ni a las 23:59:59, vence al empezar el siguiente', async () => {
    const hoy = await fechaLima(0);
    const promo = await nuevaPromocion({ hasta: hoy });
    const c = await clientaNivel('BASICO', 0);
    assert.ok((await reclamar(c.uid, promo)).ok);
    const k = await cuponDe(c.clienteId, promo);
    const cmp = await h.json(`select to_json(t) from (select
        (c.vigente_hasta > ('${hoy} 00:00:00'::timestamp at time zone 'America/Lima')) as despues_del_inicio_del_ultimo_dia,
        (c.vigente_hasta > ('${hoy} 23:59:59.999999'::timestamp at time zone 'America/Lima')) as despues_del_ultimo_instante,
        (c.vigente_hasta = (('${hoy}'::date + 1)::timestamp at time zone 'America/Lima')) as justo_al_empezar_el_dia_siguiente,
        (c.vigente_hasta > now()) as aun_vigente
      from public.cupones c where c.id = '${k.id}') t;`);
    assert.deepEqual(cmp, {
      despues_del_inicio_del_ultimo_dia: true,
      despues_del_ultimo_instante: true,
      justo_al_empezar_el_dia_siguiente: true,
      aun_vigente: true,
    });
  });

  test('campaña sin fecha final: el cupón no vence (como antes); campaña con fecha futura lejana vence al final de ESE día', async () => {
    const sinFin = await nuevaPromocion({});
    const lejana = await fechaLima(30);
    const conFin = await nuevaPromocion({ hasta: lejana });
    const c = await clientaNivel('BASICO', 0);
    assert.ok((await reclamar(c.uid, sinFin)).ok);
    assert.ok((await reclamar(c.uid, conFin)).ok);
    assert.equal((await cuponDe(c.clienteId, sinFin)).vigente_hasta, null);
    const fin = await cuponDe(c.clienteId, conFin);
    assert.equal(new Date(fin.vigente_hasta).toISOString(), `${await fechaLima(31)}T05:00:00.000Z`);
  });

  test('campaña futura y campaña vencida, para los tres niveles: el reclamo se rechaza y no se crea ningún cupón', async () => {
    const futura = await nuevaPromocion({ desde: await fechaLima(1), hasta: await fechaLima(5) });
    const vencida = await nuevaPromocion({ desde: await fechaLima(-5), hasta: await fechaLima(-1) });
    for (const nivel of NIVELES) {
      const c = await clientaNivel(nivel, 0);
      for (const [promo, nombre] of [[futura, 'futura'], [vencida, 'vencida']]) {
        const r = await reclamar(c.uid, promo);
        assert.equal(r.ok, false, `${nivel} · ${nombre}`);
        assert.match(r.err, /ya no está activa/);
        assert.equal(await conteoCupones(c.clienteId, promo), 0);
      }
    }
  });

  test('cupón de una campaña que ya terminó: bloqueado en vista previa, pedido y Caja ANTES de anunciar un importe pagable', async () => {
    const promo = await nuevaPromocion({ hasta: await fechaLima(0), valor: 15 });
    const c = await clientaNivel('PREMIUM', 0);
    assert.ok((await reclamar(c.uid, promo)).ok);
    const k = await cuponDe(c.clienteId, promo);
    const p = await h.nuevoProducto(100, 10, { costo: 10 });
    await h.ponerEnCarrito(c.uid, p, 1);
    // Mientras dura la campaña, sí aplica (S/15 sobre S/100).
    const vivo = await h.vistaPreviaCupon(c.uid, k.codigo, [p]);
    assert.equal(vivo.fila.valido, true, vivo.fila.motivo);
    casi(vivo.fila.descuento, 15);
    // Pasa el último día.
    await expirar(k.id);
    const vp = await h.vistaPreviaCupon(c.uid, k.codigo, [p]);
    assert.equal(vp.fila.valido, false);
    assert.match(vp.fila.motivo, /venció/);
    casi(vp.fila.descuento, 0, 'no se anuncia ningún descuento');
    const ped = await h.crearPedido(c.uid, [p], k.codigo);
    assert.equal(ped.ok, false, 'el servidor también lo rechaza (sin pasar por la interfaz)');
    assert.match(ped.err, /venció/);
    const caja = await h.vender({ uid: h.ADMIN, clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: k.codigo });
    assert.equal(caja.ok, false);
    assert.match(caja.err, /venció/);
    const e = await h.estadoCupon(k.id);
    assert.equal(e.estado, 'DISPONIBLE', 'rechazar no consume ni reactiva nada');
    assert.equal(await h.stock(p), 10, 'sin stock descontado');
    assert.equal(await h.json(`select to_json(count(*)) from public.pedidos_web where cliente_id='${c.clienteId}';`), 0);
    // mis_cupones lo marca vencido (la interfaz lo muestra así).
    const mis = await h.paso(c.uid, `select row_to_json(t) from public.mis_cupones() t where t.id='${k.id}';`, { rol: true });
    assert.equal(JSON.parse(mis.out.split('\n').filter(Boolean).pop()).vencido, true);
  });

  test('verificación de pago: si el cupón venció entre el pedido y la verificación, no se cobra ni se cambia nada', async () => {
    const promo = await nuevaPromocion({ hasta: await fechaLima(0), valor: 10 });
    const c = await clientaNivel('VIP', 0);
    assert.ok((await reclamar(c.uid, promo)).ok);
    const k = await cuponDe(c.clienteId, promo);
    const p = await h.nuevoProducto(100, 10, { costo: 10 });
    await h.ponerEnCarrito(c.uid, p, 1);
    const ped = await h.crearPedido(c.uid, [p], k.codigo);
    assert.ok(ped.ok, ped.err);
    await expirar(k.id);
    const v = await h.verificarPagoPedido(ped.pedidoId);
    assert.equal(v.ok, false);
    assert.match(v.err, /venció/);
    const w = await h.json(`select to_json(w) from (select pago_verificado, venta_id is not null as con_venta from public.pedidos_web where id='${ped.pedidoId}') w;`);
    assert.deepEqual(w, { pago_verificado: false, con_venta: false });
    assert.equal((await h.estadoCupon(k.id)).estado, 'DISPONIBLE');
  });

  test('anular una venta con un cupón que ya venció NO lo reactiva; uno vigente sí vuelve a estar disponible', async () => {
    const promo = await nuevaPromocion({ hasta: await fechaLima(0), valor: 10 });
    for (const [vence, esperado] of [[true, 'CANJEADO'], [false, 'DISPONIBLE']]) {
      const c = await clientaNivel('BASICO', 0);
      assert.ok((await reclamar(c.uid, promo)).ok);
      const k = await cuponDe(c.clienteId, promo);
      const p = await h.nuevoProducto(100, 10, { costo: 10 });
      const v = await h.vender({ uid: h.ADMIN, clienteId: c.clienteId, items: [h.itemProducto(p)], cupon: k.codigo });
      assert.ok(v.ok, v.err);
      assert.equal((await h.estadoCupon(k.id)).estado, 'CANJEADO');
      if (vence) await expirar(k.id);
      const a = await h.anular(v.venta.venta_id);
      assert.ok(a.ok, a.err);
      const e = await h.estadoCupon(k.id);
      assert.equal(e.estado, esperado, vence ? 'vencido: queda consumido' : 'vigente: se reactiva con su vencimiento original');
      assert.equal(await h.stock(p), 10, 'el stock sí se repone');
      if (vence) assert.ok(e.venta_id, 'sigue ligado a la venta anulada (no se desliga)');
    }
  });

  test('idempotencia: reintento y doble clic devuelven el MISMO cupón, con su vencimiento original, sin duplicar', async () => {
    const hasta = await fechaLima(0);
    const promo = await nuevaPromocion({ hasta });
    const c = await clientaNivel('BASICO', 0);
    const primera = await reclamar(c.uid, promo);
    assert.ok(primera.ok, primera.err);
    const original = await cuponDe(c.clienteId, promo);
    // Si la campaña se alarga después, el cupón ya emitido conserva su vencimiento (condiciones congeladas al reclamar).
    await h.admin(`update public.promociones set vigente_hasta = vigente_hasta + 10 where id='${promo}';`);
    const segunda = await reclamar(c.uid, promo);
    assert.ok(segunda.ok, segunda.err);
    assert.equal(segunda.cupon.codigo, primera.cupon.codigo);
    assert.equal(segunda.cupon.id, primera.cupon.id);
    assert.equal((await cuponDe(c.clienteId, promo)).vigente_hasta, original.vigente_hasta);
    assert.equal(await conteoCupones(c.clienteId, promo), 1);
  });

  test('doble clic SIMULTÁNEO: todas las llamadas responden con el mismo cupón y solo hay uno (y una sola notificación)', async () => {
    const promo = await nuevaPromocion({ hasta: await fechaLima(2) });
    const c = await clientaNivel('BASICO', 0);
    const rs = await Promise.all(Array.from({ length: 6 }, () => reclamar(c.uid, promo)));
    for (const r of rs) assert.ok(r.ok, `ninguna llamada debe fallar: ${r.err}`);
    assert.equal(new Set(rs.map((r) => r.cupon.codigo)).size, 1, 'mismo código en todas');
    assert.equal(await conteoCupones(c.clienteId, promo), 1);
    assert.equal(await h.json(`select to_json(count(*)) from public.notificaciones where cliente_id='${c.clienteId}' and tipo='PROMOCION';`), 1);
  });
});
