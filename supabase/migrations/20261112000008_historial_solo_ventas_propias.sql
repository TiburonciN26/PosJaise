-- Historial POS: la CAJERA y la ENCARGADA ven solo SUS PROPIAS ventas (las que registraron ellas, vendedor_id = auth.uid()).
--
-- POR QUÉ EN RLS Y NO EN EL FRONT: Historial.jsx es el único consumidor de `ventas`/`venta_items` desde el cliente, pero filtrar
-- solo ahí dejaría las ventas ajenas legibles por PostgREST. Además resumen_historial() es `security invoker`, así que al
-- endurecer la política las tarjetas de resumen (cantidad, total recaudado, productos vendidos) pasan a contar también solo
-- lo propio sin tocar la función — si el filtro estuviera solo en el front, el resumen seguiría sumando las ventas de todas.
--
-- QUÉ SE MANTIENE: el límite de "solo ventas de HOY" para CAJERA/ENCARGADA (es_hoy) y el acceso total del ADMINISTRADOR.
-- La inserción ya exigía vendedor_id = auth.uid() (ventas_insert), así que la venta recién confirmada sigue siendo visible
-- para quien la registró. anular_venta no cambia: es la misma regla de rol/hoy de antes.
--
-- Cuerpos de partida: los de 20261110000001_rol_encargada.sql (la última definición de ambas políticas).

begin;

drop policy ventas_select on public.ventas;
create policy ventas_select on public.ventas for select to authenticated
  using (
    es_admin()
    or (
      rol_actual() in ('CAJERA', 'ENCARGADA')
      and es_hoy(fecha)
      and vendedor_id = (select auth.uid())
    )
  );

drop policy venta_items_select on public.venta_items;
create policy venta_items_select on public.venta_items for select to authenticated
  using (
    exists (
      select 1 from public.ventas v
      where v.id = venta_items.venta_id
        and (
          es_admin()
          or (
            rol_actual() in ('CAJERA', 'ENCARGADA')
            and es_hoy(v.fecha)
            and v.vendedor_id = (select auth.uid())
          )
        )
    )
  );

commit;
