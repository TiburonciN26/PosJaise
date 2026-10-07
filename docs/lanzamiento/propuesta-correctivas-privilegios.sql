-- PROPUESTA (NO es una migración del repositorio y NO se aplicó en ningún entorno remoto): ajustes de privilegios que el ensayo de
-- lanzamiento detectó al aplicar las 21 migraciones con los privilegios por omisión de PRODUCCIÓN. Se ensayó solo en la instancia desechable.
-- PENDIENTE DE APROBACIÓN. Este archivo NO se ejecuta como SQL suelto en producción: si se aprueba, su contenido debe convertirse en
-- migraciones nuevas en supabase/migrations/, ensayarse en la instancia desechable y en QA Local, y aplicarse solo con autorización
-- explícita, DESPUÉS de las 21 migraciones y de su verificación, y antes de publicar el frontend.
begin;

-- 1) La migración 20261005000003 concede EXECUTE de confirmar_pedido_productos a anon y service_role. En producción hoy solo lo tienen
--    postgres y authenticated. Con anon, una llamada sin sesión llega a la función y recibe «Completa tu perfil…» (sin crear pedidos ni
--    exponer datos), pero es una ampliación innecesaria de la superficie.
revoke execute on function public.confirmar_pedido_productos(uuid[], text, date, time without time zone, text, text, uuid, text, text, text, text, text, text, jsonb, numeric) from anon, service_role;

-- 2) OPCIONAL (decisión del propietario): recompensas_establecer_activo(boolean) permite a un ADMINISTRADOR encender el programa nuevo desde
--    la interfaz de Recompensas Web (fija corte = now()) SIN haber ejecutado la apertura. Mientras Recompensas deba seguir apagado, se
--    retira el permiso; el día de la apertura se devuelve con:  grant execute on function public.recompensas_establecer_activo(boolean) to authenticated;
revoke execute on function public.recompensas_establecer_activo(boolean) from authenticated;

commit;
