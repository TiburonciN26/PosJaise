-- =========================================================
-- POS Negocio 2 — M1 de la 3ª auditoría: auditoria_paginada
-- ordenaba solo por "fecha desc". Un UPDATE que toca N columnas
-- inserta N filas de auditoría con EXACTAMENTE el mismo now()
-- (now() es fijo dentro de una transacción), así que con empates
-- masivos de fecha el OFFSET/LIMIT entre páginas puede duplicar o
-- saltarse filas (el orden de dos filas con la misma fecha no está
-- garantizado y puede cambiar entre una página y la siguiente).
--
-- Se agrega "id desc" como desempate estable. Redefine la función
-- de 31_auditoria_paginada.sql (misma firma) — hay que re-correr
-- este archivo en Supabase → SQL Editor → New query.
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
  offset p_offset
  limit p_limite
$$;

grant execute on function public.auditoria_paginada(timestamptz, timestamptz, integer, integer) to authenticated;
