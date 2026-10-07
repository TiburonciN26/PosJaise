-- =========================================================
-- Privilegios de confirmar_pedido_productos: solo usuarias con sesión (authenticated).
--
-- Por qué: la migración 20261005000003 recreó la función con 15 parámetros y le concedió EXECUTE a anon y service_role.
-- En producción hoy solo la ejecutan postgres y authenticated. Sin sesión la función ya rechaza la llamada («Completa tu
-- perfil…») y no crea nada, pero es una ampliación innecesaria de la superficie. Se deja como estaba: sin anon ni service_role.
-- Alcance: solo privilegios. No cambia el cuerpo de la función, sus parámetros ni datos. Idempotente.
-- =========================================================
begin;

revoke execute on function public.confirmar_pedido_productos(uuid[], text, date, time without time zone, text, text, uuid, text, text, text, text, text, text, jsonb, numeric)
  from public, anon, service_role;
grant execute on function public.confirmar_pedido_productos(uuid[], text, date, time without time zone, text, text, uuid, text, text, text, text, text, text, jsonb, numeric)
  to authenticated;

commit;
