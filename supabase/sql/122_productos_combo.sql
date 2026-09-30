-- =========================================================
-- Migración 6/8 del rediseño de Productos/Detalle: "Se suele comprar
-- junto con" (combo sugerido) — mismo patrón que
-- 114_servicios_combo.sql: `combo_con` es un override manual del admin
-- (ModalProducto.jsx); si no lo puso, `productos_combo_sugerido()`
-- calcula el producto que más veces se compró JUNTO a este en el mismo
-- pedido web (pedidos_web_items), excluyendo pedidos CANCELADO.
-- Ejecutar en Supabase → SQL Editor → New query
-- =========================================================

begin;

alter table public.productos
  add column if not exists combo_con uuid references public.productos(id) on delete set null;

grant select (combo_con) on public.productos to authenticated;

create or replace function public.productos_combo_sugerido(p_producto_id uuid)
returns table (
  producto_id uuid,
  veces       bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    i2.producto_id,
    count(*) as veces
  from public.pedidos_web_items i1
  join public.pedidos_web_items i2 on i2.pedido_id = i1.pedido_id and i2.producto_id <> i1.producto_id
  join public.pedidos_web p on p.id = i1.pedido_id
  where i1.producto_id = p_producto_id
    and i2.producto_id is not null
    and p.estado <> 'CANCELADO'
  group by i2.producto_id
  order by veces desc
  limit 1;
$$;

grant execute on function public.productos_combo_sugerido(uuid) to authenticated;
revoke execute on function public.productos_combo_sugerido(uuid) from public;

commit;
