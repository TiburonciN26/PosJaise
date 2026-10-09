-- Web pública para visitantes (sin sesión): el enlace principal abre la web de
-- clientas en vez del login. Esta migración solo concede al rol `anon` lo mínimo
-- que esa web necesita; no abre tablas completas ni expone costos, proveedores ni
-- datos personales.
--
-- POR QUÉ así (y no abriendo las tablas con `using (true)`):
--  * Hasta hoy TODAS las políticas de catálogo eran `to authenticated`: un visitante
--    veía 0 filas de servicios/productos/fotos/promociones. Los visitantes deben ver
--    lo mismo que ya ve una clienta (solo filas activas), nada más.
--  * Los GRANT son por columna: `anon` nunca recibe `costo`, `codigo_barras`,
--    `stock_minimo` ni `proveedor` de productos (mismo criterio que `authenticated`,
--    que tampoco ve `costo`, y más estricto: tampoco ve el resto de datos internos).
--  * Todo lo que mezcla datos de clientas (reseñas, equipo, galería, contacto) ya
--    sale por funciones `security definer`; aquí solo se les concede EXECUTE a `anon`
--    de forma explícita (no se depende de privilegios por omisión del proyecto).
--
-- Alcance (NO se aplica a producción desde aquí; ver docs/web-publica/README.md):
--   1. Lectura de catálogo para `anon`: servicios, servicio_fotos, productos,
--      producto_fotos, promociones vigentes (columnas y filas acotadas).
--   2. EXECUTE explícito a `anon` para las funciones públicas que usa la web.
--   3. politicas_cita_publicas(): adelanto mínimo y plazo de cancelación (solo esos
--      dos datos; las cuentas de Yape/Plin siguen exclusivas de `estado_negocio`).
--   4. Reseñas: el nombre sale abreviado desde el servidor («María G.»). Antes la
--      función devolvía el nombre completo de la clienta y solo la pantalla lo
--      recortaba — cualquiera con la clave pública podía leerlo completo.
--   5. Cierra dos fugas previas que un visitante podía explotar con la clave pública:
--      productos_vista (todas las filas, activas o no, con proveedor y stock mínimo)
--      y las listas de personal usuarios_para_citas()/asistentes_para_citas().

begin;

-- 1. Catálogo legible por visitantes ---------------------------------------------

revoke all on public.servicios from anon;
grant select (
  id, nombre, categoria, precio, duracion_min, activo, foto_url, descripcion, en_tendencia,
  a_domicilio, costo_domicilio, precio_variable, nota_precio, duracion_resultado, pasos,
  especificaciones, herramientas, materiales, cuidados_antes, cuidados_despues, combo_con
) on public.servicios to anon;

drop policy if exists servicios_select_anon on public.servicios;
create policy servicios_select_anon on public.servicios
  for select to anon
  using (activo = true);

revoke all on public.servicio_fotos from anon;
grant select (id, servicio_id, foto_url, etiqueta, orden) on public.servicio_fotos to anon;

drop policy if exists servicio_fotos_select_anon on public.servicio_fotos;
create policy servicio_fotos_select_anon on public.servicio_fotos
  for select to anon
  using (exists (
    select 1 from public.servicios s
    where s.id = servicio_fotos.servicio_id and s.activo = true
  ));

-- Sin: costo, codigo_barras, stock_minimo, proveedor.
revoke all on public.productos from anon;
grant select (
  id, nombre, categoria, subcategoria, precio, precio_antes, stock_actual, foto_url, activo,
  destacado, nuevo, en_inicio, descripcion, contenido, rinde, frecuencia, oferta_hasta,
  especificaciones, modo_uso, ideal_para, tips, ingredientes, libre_de, combo_con
) on public.productos to anon;

drop policy if exists productos_select_anon on public.productos;
create policy productos_select_anon on public.productos
  for select to anon
  using (activo = true);

revoke all on public.producto_fotos from anon;
grant select (id, producto_id, foto_url, etiqueta, orden) on public.producto_fotos to anon;

drop policy if exists producto_fotos_select_anon on public.producto_fotos;
create policy producto_fotos_select_anon on public.producto_fotos
  for select to anon
  using (exists (
    select 1 from public.productos p
    where p.id = producto_fotos.producto_id and p.activo = true
  ));

-- Misma ventana de vigencia que promociones_select_web (la que ya ve una clienta).
revoke all on public.promociones from anon;
grant select (id, titulo, descripcion, tipo_descuento, valor, vigente_desde, vigente_hasta, activo)
  on public.promociones to anon;

drop policy if exists promociones_select_anon on public.promociones;
create policy promociones_select_anon on public.promociones
  for select to anon
  using (
    activo = true
    and (vigente_desde is null or vigente_desde <= (now() at time zone 'America/Lima')::date)
    and (vigente_hasta is null or vigente_hasta >= (now() at time zone 'America/Lima')::date)
  );

-- 2. Fugas previas hacia `anon` --------------------------------------------------

-- La vista es del dueño (bypassa RLS): mostraba a cualquiera todas las filas con
-- proveedor y stock mínimo. La web de visitantes no la usa (lee `productos` con
-- columnas acotadas). `authenticated` conserva su acceso.
revoke all on public.productos_vista from anon;

-- Nombres y ids del personal: solo para sesiones iniciadas.
revoke execute on function public.usuarios_para_citas() from public, anon;
grant execute on function public.usuarios_para_citas() to authenticated;
revoke execute on function public.asistentes_para_citas() from public, anon;
grant execute on function public.asistentes_para_citas() to authenticated;

-- 3. Políticas de cita legibles sin sesión ---------------------------------------

create or replace function public.politicas_cita_publicas()
returns table (adelanto_minimo numeric, cancelacion_plazo_horas integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.adelanto_minimo, e.cancelacion_plazo_horas
  from public.estado_negocio e
  where e.id = 1;
$$;

revoke execute on function public.politicas_cita_publicas() from public;
grant execute on function public.politicas_cita_publicas() to anon, authenticated;

-- 4. Reseñas con nombre abreviado desde el servidor ------------------------------

-- Mismo criterio que lib/resenas.js → nombrePublico(): nombre + inicial del segundo
-- término («María Gómez Ruiz» → «María G.»). Es idempotente: «María G.» queda igual,
-- así que la pantalla puede seguir aplicándolo sin duplicar la inicial.
create or replace function public.nombre_publico_resena(p_nombre text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when nullif(btrim(coalesce(p_nombre, '')), '') is null then 'Clienta'
    when array_length(regexp_split_to_array(btrim(p_nombre), '\s+'), 1) < 2
      then (regexp_split_to_array(btrim(p_nombre), '\s+'))[1]
    else (regexp_split_to_array(btrim(p_nombre), '\s+'))[1] || ' '
      || upper(left((regexp_split_to_array(btrim(p_nombre), '\s+'))[2], 1)) || '.'
  end;
$$;

create or replace function public.resenas_publicas()
returns table (id uuid, nombre text, calificacion integer, comentario text, creado_en timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, public.nombre_publico_resena(c.nombre), r.calificacion, r.comentario, r.creado_en
  from public.resenas r
  join public.clientes c on c.id = r.cliente_id
  where r.estado = 'APROBADA'
  order by r.creado_en desc;
$$;

create or replace function public.resenas_inicio()
returns table (
  id uuid, nombre text, calificacion integer, comentario text, creado_en timestamptz,
  servicio_nombre text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, public.nombre_publico_resena(c.nombre), r.calificacion, r.comentario, r.creado_en,
         null::text as servicio_nombre
  from public.resenas r
  join public.clientes c on c.id = r.cliente_id
  where r.estado = 'APROBADA'
  union all
  select rs.id, public.nombre_publico_resena(c.nombre), rs.calificacion, rs.comentario, rs.creado_en,
         s.nombre
  from public.resenas_servicio rs
  join public.clientes c on c.id = rs.cliente_id
  join public.servicios s on s.id = rs.servicio_id
  where rs.estado = 'APROBADA'
  order by creado_en desc;
$$;

create or replace function public.resenas_servicio_publicas(p_servicio_id uuid)
returns table (id uuid, nombre text, calificacion integer, comentario text, creado_en timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rs.id, public.nombre_publico_resena(c.nombre), rs.calificacion, rs.comentario, rs.creado_en
  from public.resenas_servicio rs
  join public.clientes c on c.id = rs.cliente_id
  where rs.servicio_id = p_servicio_id
    and rs.estado = 'APROBADA'
  order by rs.creado_en desc;
$$;

create or replace function public.resenas_producto_publicas(p_producto_id uuid)
returns table (id uuid, nombre text, calificacion integer, comentario text, creado_en timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rp.id, public.nombre_publico_resena(c.nombre), rp.calificacion, rp.comentario, rp.creado_en
  from public.resenas_producto rp
  join public.clientes c on c.id = rp.cliente_id
  where rp.producto_id = p_producto_id
    and rp.estado = 'APROBADA'
  order by rp.creado_en desc;
$$;

-- 5. EXECUTE explícito a `anon` solo de lo que la web pública usa -----------------

grant execute on function public.nombre_publico_resena(text) to anon, authenticated;
grant execute on function public.datos_contacto() to anon, authenticated;
grant execute on function public.horario_atencion() to anon, authenticated;
grant execute on function public.equipo_para_web() to anon, authenticated;
grant execute on function public.galeria_para_web() to anon, authenticated;
grant execute on function public.resenas_publicas() to anon, authenticated;
grant execute on function public.resenas_inicio() to anon, authenticated;
grant execute on function public.resenas_servicio_resumen(uuid) to anon, authenticated;
grant execute on function public.resenas_servicio_publicas(uuid) to anon, authenticated;
grant execute on function public.resenas_producto_resumen(uuid) to anon, authenticated;
grant execute on function public.resenas_producto_publicas(uuid) to anon, authenticated;
grant execute on function public.servicios_mas_pedidos(integer) to anon, authenticated;
grant execute on function public.servicios_combo_sugerido(uuid) to anon, authenticated;
grant execute on function public.productos_combo_sugerido(uuid) to anon, authenticated;
grant execute on function public.catalogo_recompensas_publico() to anon, authenticated;
grant execute on function public.recompensas_reglas_publicas() to anon, authenticated;

commit;
