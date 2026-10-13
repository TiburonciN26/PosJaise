// Fase 7 · siembra de volumen para medir y verificar (Supabase LOCAL). Se ejecuta SIEMPRE dentro de una transacción que termina
// en ROLLBACK (ver medir-fase7.cjs y verificar-fase7.cjs). Copia filas existentes con claves nuevas; sin triggers ni FK (réplica).
const AMPLIADA = { clientes: 30000, pedidos: 60000, cupones: 120000, resenas: 20000, promociones: 5000, productos: 20000, servicios: 20000 }
const REDUCIDA = { clientes: 3000, pedidos: 6000, cupones: 12000, resenas: 2000, promociones: 500, productos: 2000, servicios: 2000 }
const siembra = (N) => `
set local session_replication_role = replica;
-- clientes: nombres con fragmentos buscables; sin teléfono ni cuenta web (restricciones únicas parciales)
insert into clientes select (jsonb_populate_record(null::clientes, to_jsonb(s) || jsonb_build_object(
    'id', gen_random_uuid(), 'nombre', (array['Maria','Ana','Lucia','Carmen','Rosa','Julia','Elena','Paola'])[1 + (g % 8)] || ' QA7 ' || g,
    'telefono', null, 'cliente_web_id', null, 'codigo_referido', 'QA7' || g || substr(md5(g::text), 1, 5)))).*
  from (select * from clientes order by id limit 1) s, generate_series(1, ${N.clientes}) g;
create temp table cli7 as select row_number() over () rn, id from clientes where nombre like '% QA7 %';
create index on cli7(rn);
-- pedidos: 5 estados ponderados, repartidos en 3 años; una clienta concreta recibe 60 pedidos (rol cliente)
insert into pedidos_web select (jsonb_populate_record(null::pedidos_web, to_jsonb(s) || jsonb_build_object(
    'id', gen_random_uuid(), 'cliente_id', (select id from cli7 where rn = 1 + (g % ${N.clientes})),
    'estado', (array['PENDIENTE','LISTO','ENTREGADO','ENTREGADO','ENTREGADO','ENTREGADO','CANCELADO'])[1 + (g % 7)],
    'creado_en', now() - (g * interval '27 minutes'), 'pasarela_charge_id', null, 'venta_id', null, 'pago_verificado_por', null))).*
  from (select * from pedidos_web order by id limit 1) s, generate_series(1, ${N.pedidos}) g;
insert into pedidos_web_items select (jsonb_populate_record(null::pedidos_web_items, to_jsonb(s) || jsonb_build_object(
    'id', gen_random_uuid(), 'pedido_id', p.id))).*
  from (select * from pedidos_web_items order by id limit 1) s cross join pedidos_web p cross join generate_series(1, 2) k
  where p.cliente_id in (select id from cli7);
-- cupones: orígenes y estados ponderados; códigos únicos
insert into cupones select (jsonb_populate_record(null::cupones, to_jsonb(s) || jsonb_build_object(
    'id', gen_random_uuid(), 'cliente_id', (select id from cli7 where rn = 1 + (g % ${N.clientes})),
    'codigo', 'QA7-' || g || '-' || substr(md5(g::text), 1, 6),
    'origen', (array['PROMOCION','PROMOCION','PROMOCION','FIDELIZACION','RECOMPENSA_MONEDAS','RECOMPENSA_SELLOS','REFERIDO_BIENVENIDA','REFERIDO_RECOMPENSA'])[1 + (g % 8)],
    'estado', (array['DISPONIBLE','DISPONIBLE','CANJEADO','ANULADO'])[1 + (g % 4)],
    'creado_en', now() - (g * interval '19 minutes'), 'promocion_id', null, 'referido_id', null, 'venta_id', null, 'catalogo_id', null))).*
  from (select * from cupones order by id limit 1) s, generate_series(1, ${N.cupones}) g;
-- reseñas de las tres tablas (una por clienta: restricciones únicas)
insert into resenas select (jsonb_populate_record(null::resenas, to_jsonb(s) || jsonb_build_object(
    'id', gen_random_uuid(), 'cliente_id', (select id from cli7 where rn = g),
    'estado', (array['PENDIENTE','APROBADA','APROBADA','RECHAZADA'])[1 + (g % 4)], 'creado_en', now() - (g * interval '41 minutes')))).*
  from (select * from resenas order by id limit 1) s, generate_series(1, ${N.resenas}) g;
insert into resenas_producto select (jsonb_populate_record(null::resenas_producto, to_jsonb(s) || jsonb_build_object(
    'id', gen_random_uuid(), 'cliente_id', (select id from cli7 where rn = g),
    'estado', (array['PENDIENTE','APROBADA','APROBADA','RECHAZADA'])[1 + (g % 4)], 'creado_en', now() - (g * interval '37 minutes')))).*
  from (select * from resenas_producto order by id limit 1) s, generate_series(1, ${N.resenas}) g;
insert into resenas_servicio select (jsonb_populate_record(null::resenas_servicio, to_jsonb(s) || jsonb_build_object(
    'id', gen_random_uuid(), 'cliente_id', (select id from cli7 where rn = g),
    'estado', (array['PENDIENTE','APROBADA','APROBADA','RECHAZADA'])[1 + (g % 4)], 'creado_en', now() - (g * interval '43 minutes')))).*
  from (select * from resenas_servicio order by id limit 1) s, generate_series(1, ${N.resenas}) g;
insert into promociones select (jsonb_populate_record(null::promociones, to_jsonb(s) || jsonb_build_object(
    'id', gen_random_uuid(), 'titulo', 'Promo QA7 ' || g || (array[' descuento',' verano',' amigas',' bienvenida'])[1 + (g % 4)],
    'creado_en', now() - (g * interval '3 hours')))).*
  from (select * from promociones order by id limit 1) s, generate_series(1, ${N.promociones}) g;
-- catálogos: nombres/categorías con distribución desigual (pocas categorías grandes, muchas pequeñas)
insert into productos select (jsonb_populate_record(null::productos, to_jsonb(s) || jsonb_build_object(
    'id', gen_random_uuid(), 'nombre', (array['Shampoo','Acondicionador','Tinte','Mascarilla','Ampolla','Aceite','Gel','Crema'])[1 + (g % 8)] || ' QA7 ' || g,
    'categoria', 'Cat QA7 ' || (g % 60), 'codigo_barras', 'QA7' || g, 'activo', (g % 10) <> 0, 'stock_actual', 1 + (g % 9),
    'destacado', (g % 40) = 0, 'en_inicio', (g % 500) = 0, 'precio_antes', case when g % 25 = 0 then 99 else null end))).*
  from (select * from productos where activo order by id limit 1) s, generate_series(1, ${N.productos}) g;
insert into servicios select (jsonb_populate_record(null::servicios, to_jsonb(s) || jsonb_build_object(
    'id', gen_random_uuid(), 'nombre', (array['Corte','Peinado','Tinte','Manicure','Pedicure','Alisado','Maquillaje','Keratina'])[1 + (g % 8)] || ' QA7 ' || g,
    'categoria', 'Cat QA7 ' || (g % 40), 'activo', (g % 10) <> 0, 'en_tendencia', (g % 50) = 0))).*
  from (select * from servicios where activo order by id limit 1) s, generate_series(1, ${N.servicios}) g;
analyze;
`
module.exports = { AMPLIADA, REDUCIDA, siembra }
