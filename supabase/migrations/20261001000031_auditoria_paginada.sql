-- =========================================================
-- POS Negocio 2 — M1 de la 2ª auditoría: Auditoría se quedó
-- fuera de la paginación server-side que M2 (29_resumenes_
-- agregados.sql) ya le dio a Historial/Inventario/Clientes.
-- Traía todas las filas del período y paginaba solo en el
-- cliente (cantidadVisible) — con "Este mes" y triggers
-- registrando cada cambio de columna, ese fetch crece rápido.
--
-- Auditoría combina DOS tablas (auditoria + movimientos_stock)
-- fusionadas y ordenadas por fecha en un solo listado, así que
-- un .range() independiente por tabla no alcanza (no se puede
-- saber cuántas filas de cada una caen en "la página 1" sin
-- conocer la otra) — de ahí el RPC: hace el UNION ALL + ORDER
-- BY + OFFSET/LIMIT en Postgres y devuelve ya paginado.
--
-- security invoker: respeta las mismas políticas RLS que ya
-- aplican hoy (auditoria: solo admin: movimientos_stock: todo
-- autenticado) — mismo criterio que resumen_historial/
-- resumen_inventario.
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
  order by fecha desc
  offset p_offset
  limit p_limite
$$;

grant execute on function public.auditoria_paginada(timestamptz, timestamptz, integer, integer) to authenticated;
