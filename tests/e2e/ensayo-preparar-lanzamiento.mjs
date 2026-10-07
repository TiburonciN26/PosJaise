// Prepara, SOLO en la instancia desechable «JaiseEnsayo», una base equivalente a la de PRODUCCIÓN ANTES de la actualización
// de lanzamiento: esquema de las migraciones ≤ 20261001 (db reset con esas 124 migraciones), los privilegios de producción
// (prod-equivalente.sql: anon sin datos, authenticated por tabla, productos con SELECT por columna) y datos FICTICIOS con la
// forma de los de producción (cifras comprobadas el 2026-10-07 solo con consultas de agregados: 270 productos con 5 de costo 0,
// 33 servicios de S/10 a S/350, 69 clientes, 127 ventas con 13 anuladas hasta VEN129, 47 citas, 3 cupones, 1 promoción inactiva).
// No copia usuarios, contraseñas, nombres, teléfonos ni ningún dato personal de producción: todo es inventado.
//
// Uso (la contraseña solo por entorno del proceso):  ENSAYO_PASSWORD=... node tests/e2e/ensayo-preparar-lanzamiento.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { ejecutarEnsayo, clavesDelEnsayo, supabaseURL, verificarDestinoEnsayo, verificarMismaBase } from './ensayo-destino.mjs';

const PW = process.env.ENSAYO_PASSWORD;
if (!PW) throw new Error('Falta ENSAYO_PASSWORD en el entorno del proceso.');
verificarDestinoEnsayo('postgres');
verificarMismaBase('postgres');
if (!supabaseURL.startsWith('http://127.0.0.1:56321')) throw new Error('El destino HTTP no es el del ensayo.');
const { servicio } = clavesDelEnsayo();

async function sql(s) { const r = await ejecutarEnsayo('postgres', s); if (!r.ok) throw new Error(r.err); return r.out; }

async function crearUsuarioAuth(email) {
  const r = await fetch(`${supabaseURL}/auth/v1/admin/users`, {
    method: 'POST', redirect: 'error',
    headers: { apikey: servicio, Authorization: `Bearer ${servicio}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PW, email_confirm: true, user_metadata: { ensayo: true } }),
  });
  if (!r.ok) throw new Error(`Auth del ensayo rechazó crear ${email} (${r.status}).`);
  return (await r.json()).id;
}

const cuentas = {
  ADMINISTRADOR: 'admin.lanzamiento@ensayo.local',
  CAJERA: 'cajera.lanzamiento@ensayo.local',
  ASISTENTE: 'asistente.lanzamiento@ensayo.local',
  CLIENTE1: 'clienta1.lanzamiento@ensayo.local',
  CLIENTE2: 'clienta2.lanzamiento@ensayo.local',
};
const ids = {};
for (const [rol, email] of Object.entries(cuentas)) ids[rol] = await crearUsuarioAuth(email);

await sql(`
begin;
-- Configuración con los valores de producción (config_referidos de producción: 10 / 5; fidelización 20 %).
update public.config_referidos set credito_referido = 10, credito_referidor = 5;
update public.config_fidelizacion set porcentaje_recompensa = 20;

-- Personal
insert into public.usuarios (id, email, nombre_completo, rol, activo) values
  ('${ids.ADMINISTRADOR}', '${cuentas.ADMINISTRADOR}', 'Admin Ficticio', 'ADMINISTRADOR', true),
  ('${ids.CAJERA}', '${cuentas.CAJERA}', 'Cajera Ficticia', 'CAJERA', true),
  ('${ids.ASISTENTE}', '${cuentas.ASISTENTE}', 'Asistente Ficticia', 'ASISTENTE', true);
insert into public.asistentes (usuario_id, nombres_completos, activo) values ('${ids.ASISTENTE}', 'Asistente Ficticia', true);
insert into public.asistentes (usuario_id, nombres_completos, activo) values (null, 'Asistente Sin Cuenta', true);

-- 270 productos (5 con costo 0, 2 inactivos) y 33 servicios de S/10 a S/350
insert into public.productos (codigo_barras, nombre, categoria, precio, costo, stock_actual, stock_minimo, activo)
select 'ENS-P' || lpad(g::text, 4, '0'), 'Producto ficticio ' || g, 'Categoría ' || (g % 8),
       (5 + (g % 40))::numeric, case when g > 265 then 0 else round(((5 + (g % 40)) * 0.4)::numeric, 2) end,
       3 + (g % 10), 2, g not in (11, 12)
from generate_series(1, 270) g;
insert into public.servicios (nombre, precio, categoria, duracion_min, activo)
select 'Servicio ficticio ' || g, case when g = 1 then 10 when g = 33 then 350 else 10 + (g * 9) end::numeric, 'Cat ' || (g % 5), 30 + (g % 4) * 15, true
from generate_series(1, 33) g;
insert into public.porcentajes (servicio_id, asistente_id, porcentaje)
select s.id, a.id, 40 from public.servicios s, public.asistentes a where a.usuario_id = '${ids.ASISTENTE}' and s.nombre in ('Servicio ficticio 2', 'Servicio ficticio 3', 'Servicio ficticio 4');

-- 69 clientes; las dos primeras con cuenta web
insert into public.clientes_web (id, email) values ('${ids.CLIENTE1}', '${cuentas.CLIENTE1}'), ('${ids.CLIENTE2}', '${cuentas.CLIENTE2}');
insert into public.clientes (nombre, telefono, cliente_web_id, codigo_referido)
select 'Clienta ficticia ' || g, '9' || lpad((10000000 + g)::text, 8, '0'),
       case when g = 1 then '${ids.CLIENTE1}'::uuid when g = 2 then '${ids.CLIENTE2}'::uuid end,
       case when g <= 2 then 'ENSREF' || g end
from generate_series(1, 69) g;

-- 127 ventas históricas (13 anuladas), códigos VEN001..VEN129 con huecos como en producción; secuencia en 129
insert into public.ventas (codigo, fecha, estado, total, metodo_pago, monto_recibido, vendedor_id, cliente_id)
select 'VEN' || lpad(g::text, 3, '0'), now() - ((130 - g) || ' hours')::interval * 12,
       case when g % 10 = 0 or g = 129 then 'ANULADA' else 'ACTIVA' end, 20 + (g % 30),
       (array['Efectivo','Yape','Yape','Tarjeta'])[1 + (g % 4)], 20 + (g % 30), '${ids.CAJERA}', null
from generate_series(1, 129) g where g not in (50, 77);
insert into public.venta_items (venta_id, tipo, producto_id, nombre, cantidad, precio_unitario, subtotal)
select v.id, 'PRODUCTO', p.id, p.nombre, 1, v.total, v.total
from public.ventas v join lateral (select id, nombre from public.productos order by id limit 1) p on true;
select setval('public.ventas_codigo_seq', 129);

-- 47 citas: 4 canceladas, 30 completadas, 13 pendientes futuras
insert into public.citas (cliente_id, asistente_id, creado_por, fecha_hora, estado, cliente_nombre_referencia)
select (select id from public.clientes order by nombre limit 1 offset (g % 60)),
       (select id from public.asistentes where usuario_id = '${ids.ASISTENTE}'), '${ids.ADMINISTRADOR}',
       case when g <= 34 then now() - (g || ' days')::interval else now() + ((g - 34) || ' days')::interval end,
       case when g <= 4 then 'CANCELADA' when g <= 34 then 'COMPLETADA' else 'PENDIENTE' end, null
from generate_series(1, 47) g;
insert into public.cita_servicios (cita_id, servicio_id, duracion_min, precio)
select c.id, s.id, 30, 25
from (select id, row_number() over (order by created_at, id) rn from public.citas) c
join (select id, row_number() over (order by nombre) rn from public.servicios) s on s.rn = 1 + (c.rn % 33);

-- Cupones (los 3 de producción) y 1 promoción inactiva del 30 %
insert into public.cupones (cliente_id, codigo, origen, valor, estado, tipo_descuento)
select id, 'ENSFID001', 'FIDELIZACION', 20, 'DISPONIBLE', 'PORCENTAJE' from public.clientes where cliente_web_id = '${ids.CLIENTE1}';
insert into public.cupones (cliente_id, codigo, origen, valor, estado, tipo_descuento)
select id, 'ENSBIE001', 'REFERIDO_BIENVENIDA', 10, 'DISPONIBLE', 'MONTO_FIJO' from public.clientes where cliente_web_id = '${ids.CLIENTE2}';
insert into public.cupones (cliente_id, codigo, origen, valor, estado, tipo_descuento)
select id, 'ENSREC001', 'REFERIDO_RECOMPENSA', 5, 'ANULADO', 'MONTO_FIJO' from public.clientes where cliente_web_id = '${ids.CLIENTE1}';
insert into public.promociones (titulo, tipo_descuento, valor, activo) values ('Promoción ficticia 30%', 'PORCENTAJE', 30, false);
commit;`);

const conteos = await sql(`select json_build_object('productos',(select count(*) from productos),'costo0',(select count(*) from productos where costo=0),
  'servicios',(select count(*) from servicios),'clientes',(select count(*) from clientes),'ventas',(select count(*) from ventas),
  'anuladas',(select count(*) from ventas where estado='ANULADA'),'citas',(select count(*) from citas),'cupones',(select count(*) from cupones),
  'promociones',(select count(*) from promociones),'usuarios',(select count(*) from usuarios));`);

await mkdir(new URL('./fixtures/', import.meta.url), { recursive: true });
await writeFile(new URL('./fixtures/ensayo-lanzamiento-runtime.json', import.meta.url), JSON.stringify({ cuentas, ids, conteos: JSON.parse(conteos) }, null, 2));
console.log('Base de ensayo equivalente a producción lista:', conteos);
