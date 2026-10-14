-- Reversión de la Fase 7 (solo LOCAL). Restaura las expresiones ORIGINALES de las políticas y borra los índices añadidos.
-- Orden: primero los índices (no afectan permisos), luego las políticas. Idempotente: se puede ejecutar dos veces.
begin;

-- ---------- índices (los nombres empiezan por idx_f7_) ----------
drop index if exists public.idx_f7_cupones_origen_estado_creado;
drop index if exists public.idx_f7_pedidos_web_items_pedido;
drop index if exists public.idx_f7_pedidos_web_creado;

-- ---------- políticas: texto original capturado de pg_policies antes de la migración ----------
alter policy pedidos_web_select on public.pedidos_web
  using ((cliente_id = mi_cliente_id()) or es_admin());
alter policy pedidos_web_items_select on public.pedidos_web_items
  using (exists (
    select 1 from public.pedidos_web p
    where p.id = pedidos_web_items.pedido_id and ((p.cliente_id = mi_cliente_id()) or es_admin())
  ));
alter policy resenas_select on public.resenas
  using ((cliente_id = mi_cliente_id()) or (estado = 'APROBADA'::text) or es_admin());
alter policy resenas_producto_select on public.resenas_producto
  using ((cliente_id = mi_cliente_id()) or (estado = 'APROBADA'::text) or es_admin());
alter policy resenas_servicio_select on public.resenas_servicio
  using ((cliente_id = mi_cliente_id()) or (estado = 'APROBADA'::text) or es_admin());
alter policy cupones_select_propio on public.cupones using (cliente_id = mi_cliente_id());
alter policy cupones_select_staff on public.cupones using (rol_actual() is not null);
alter policy clientes_select on public.clientes using (rol_actual() is not null);
alter policy productos_select on public.productos using ((rol_actual() is not null) or (activo = true));
alter policy servicios_select on public.servicios using ((rol_actual() is not null) or (activo = true));
alter policy promociones_admin_todo on public.promociones using (es_admin()) with check (es_admin());
alter policy zonas_delivery_select on public.zonas_delivery using ((activo = true) or es_admin());

commit;
