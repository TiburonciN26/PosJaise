-- =========================================================
-- POS Negocio 2 — B7 de la 3ª auditoría: auditoria_paginada no
-- tenía tope en p_limite. El cliente siempre pide TAMANO_PAGINA
-- (50), pero al ser un RPC público cualquiera con una sesión
-- válida podría llamarlo por la API directa pidiendo, por
-- ejemplo, 100000 filas de un saque. Se acota con least() en el
-- propio SQL — no alcanza con confiar en que el frontend nunca
-- mande un número más grande.
-- Redefine la función de 35_auditoria_orden_desempate.sql (misma
-- firma, sin cambio de parámetros: reemplaza sin dejar overload).
-- Ejecutar en Supabase → SQL Editor → New query
-- =========================================================

create or replace function public.auditoria_paginada(
  p_desde timestamptz,
  p_hasta timestamptz,
  p_offset integer,
  p_limite integer
)
returns table (
  origen text,
  id uuid,
  fecha timestamptz,
  usuario_email text,
  tabla text,
  registro_id text,
  descripcion text,
  campo text,
  valor_anterior text,
  valor_nuevo text,
  cantidad_agregada integer,
  nota text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select origen, id, fecha, usuario_email, tabla, registro_id, descripcion, campo,
         valor_anterior, valor_nuevo, cantidad_agregada, nota
  from (
    select
      'auditoria' as origen,
      a.id,
      a.fecha,
      a.usuario_email,
      a.tabla,
      a.registro_id,
      a.descripcion,
      a.campo,
      a.valor_anterior,
      a.valor_nuevo,
      null::integer as cantidad_agregada,
      null::text as nota
    from public.auditoria a
    where a.fecha >= p_desde and a.fecha < p_hasta

    union all

    select
      'stock' as origen,
      m.id,
      m.fecha,
      u.email as usuario_email,
      'stock' as tabla,
      null::text as registro_id,
      coalesce(p.nombre, 'Producto eliminado') as descripcion,
      null::text as campo,
      m.stock_anterior::text as valor_anterior,
      m.stock_nuevo::text as valor_nuevo,
      m.cantidad_agregada,
      m.nota
    from public.movimientos_stock m
    left join public.productos p on p.id = m.producto_id
    left join public.usuarios u on u.id = m.usuario_id
    where m.fecha >= p_desde and m.fecha < p_hasta
  ) combinado
  order by fecha desc, id desc
  offset greatest(p_offset, 0)
  limit least(coalesce(p_limite, 50), 200)
$$;

grant execute on function public.auditoria_paginada(timestamptz, timestamptz, integer, integer) to authenticated;
