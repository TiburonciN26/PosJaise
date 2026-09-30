-- =========================================================
-- Migración 2/10 (parte 2) — "Lo más pedido" para el hero de Servicios,
-- sin columna nueva (README: "calcular con las citas de los últimos 30
-- días"). Ejecutar en Supabase → SQL Editor → New query
--
-- Por qué una función y no una consulta directa desde el cliente: la
-- portal-cliente solo puede leer, vía RLS, SUS PROPIAS citas
-- (cliente_id = mi_cliente_id()) — nunca las de otras clientas. Un
-- ranking real de "más pedido" necesita contar TODAS las citas del
-- negocio, así que hace falta una función security definer que exponga
-- solo el conteo agregado por servicio (nunca cliente_id, fecha exacta
-- ni nada identificable de otra clienta) — mismo patrón que
-- resenas_publicas()/datos_contacto()/horario_atencion().
--
-- Cuenta por fecha de RESERVA (cita_servicios.created_at), no por fecha
-- de la cita en sí — así refleja demanda reciente real, no una agenda a
-- futuro. Excluye citas CANCELADA.
-- =========================================================

begin;

create or replace function public.servicios_mas_pedidos(dias int default 30)
returns table (
  servicio_id uuid,
  reservas    bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    cs.servicio_id,
    count(*) as reservas
  from public.cita_servicios cs
  join public.citas c on c.id = cs.cita_id
  where c.estado <> 'CANCELADA'
    and cs.created_at >= now() - (dias || ' days')::interval
  group by cs.servicio_id
  order by reservas desc;
$$;

grant execute on function public.servicios_mas_pedidos(int) to authenticated;
revoke execute on function public.servicios_mas_pedidos(int) from public;

commit;
