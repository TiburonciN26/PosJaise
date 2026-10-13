-- Fase 7 · helpers constantes de RLS evaluados UNA vez por consulta (no una vez por fila).
--
-- Por qué: las políticas de lectura de las tablas que usan las pantallas de las Fases 4 y 5 llaman a es_admin(), rol_actual() y
-- mi_cliente_id() directamente. Son funciones SECURITY DEFINER, así que PostgreSQL no puede inlinearlas ni elevarlas: se ejecutan
-- una vez por cada fila examinada (cada llamada además consulta `usuarios` o `clientes`). En la medición local con volumen
-- ampliado (60.000 pedidos, 120.000 cupones, 23.000 productos) la primera página de Pedidos Web invocaba los helpers ~393.000
-- veces y tardaba ~10,5 s, y un catálogo público leído como clienta autenticada (`rol_actual() IS NOT NULL OR activo`) ~1,4 s
-- frente a ~31 ms como anónima. Ver .codex/ENTREGA-FASE7-SQL.md y .codex/evidencia-fase7/.
--
-- Qué hace: envuelve cada llamada constante en un sub-SELECT escalar, `(select es_admin())`. PostgreSQL lo evalúa una sola vez
-- (InitPlan) y usa el resultado como constante, recomendación oficial de Supabase para RLS. NO cambia quién ve qué:
--   · es_admin(), rol_actual() y mi_cliente_id() son STABLE, no reciben argumentos y solo dependen de auth.uid() (fijo durante
--     la sentencia) y del instante de la consulta; dentro de una misma sentencia devuelven el mismo valor para todas las filas, de
--     modo que evaluarlas una vez es equivalente a evaluarlas por fila;
--   · se conservan EXACTAMENTE los mismos operadores (OR / IS NOT NULL / =), los mismos roles destinatarios, el mismo comando
--     y el mismo WITH CHECK; solo se añade el envoltorio. Si el helper devuelve NULL (sin sesión o sin clienta), la comparación
--     sigue siendo NULL y la fila sigue sin pasar, igual que antes.
-- Alcance deliberadamente acotado a las tablas medidas en las rutas de las Fases 4 y 5. Las políticas de otras tablas (ventas,
-- citas, gastos, …) siguen igual: no se tocan lo que no se ha medido.
--
-- Reversión: .codex/evidencia-fase7/rollback-fase7.sql (restaura las expresiones originales con ALTER POLICY; no hay datos
-- que revertir).

begin;

-- ---------- Pedidos Web ----------
alter policy pedidos_web_select on public.pedidos_web
  using ((cliente_id = (select public.mi_cliente_id())) or (select public.es_admin()));

alter policy pedidos_web_items_select on public.pedidos_web_items
  using (exists (
    select 1 from public.pedidos_web p
    where p.id = pedidos_web_items.pedido_id
      and ((p.cliente_id = (select public.mi_cliente_id())) or (select public.es_admin()))
  ));

-- ---------- Reseñas (tres tablas) ----------
alter policy resenas_select on public.resenas
  using ((cliente_id = (select public.mi_cliente_id())) or (estado = 'APROBADA'::text) or (select public.es_admin()));
alter policy resenas_producto_select on public.resenas_producto
  using ((cliente_id = (select public.mi_cliente_id())) or (estado = 'APROBADA'::text) or (select public.es_admin()));
alter policy resenas_servicio_select on public.resenas_servicio
  using ((cliente_id = (select public.mi_cliente_id())) or (estado = 'APROBADA'::text) or (select public.es_admin()));

-- ---------- Cupones ----------
alter policy cupones_select_propio on public.cupones
  using (cliente_id = (select public.mi_cliente_id()));
alter policy cupones_select_staff on public.cupones
  using ((select public.rol_actual()) is not null);

-- ---------- Clientas (nombre embebido en pedidos, reseñas y cupones) ----------
alter policy clientes_select on public.clientes
  using ((select public.rol_actual()) is not null);

-- ---------- Catálogos y promociones ----------
alter policy productos_select on public.productos
  using (((select public.rol_actual()) is not null) or (activo = true));
alter policy servicios_select on public.servicios
  using (((select public.rol_actual()) is not null) or (activo = true));
alter policy promociones_admin_todo on public.promociones
  using ((select public.es_admin()))
  with check ((select public.es_admin()));
alter policy zonas_delivery_select on public.zonas_delivery
  using ((activo = true) or (select public.es_admin()));

commit;
