-- Auditoría global 2026-11-20 (docs/auditorias/auditoria-global-2026-11-20.md), hallazgo 16.1 / roadmap 13.
--
-- EL LIBRO DE RECLAMACIONES SOLO SE ESCRIBE TRAS PASAR CLOUDFLARE TURNSTILE
-- registrar_reclamo(p_datos) era ejecutable por anon: valida los campos y tiene un tope de 5 por documento y
-- hora, pero un bot puede inventar documentos y llenar la tabla (que la ley obliga a conservar y responder en
-- 15 días hábiles). Ahora el navegador ya no llama a la RPC: llama a la Edge Function `registrar-reclamo`, que
-- verifica el token de Turnstile con Cloudflare (secreto TURNSTILE_SECRET_KEY, solo en Supabase) y recién
-- entonces llama, como service_role, a registrar_reclamo_verificado().
--
-- registrar_reclamo() guardaba auth.uid() en cliente_user_id (enlace con la clienta si tenía sesión). Llamada
-- como service_role, auth.uid() es null; por eso el envoltorio recibe el id que la Edge Function obtuvo al
-- validar el JWT de la persona (nunca uno que mande el navegador) y lo escribe en la fila recién creada.
-- registrar_reclamo() no se reescribe: sus validaciones y su tope por documento siguen siendo la única regla.
--
-- Producción no da EXECUTE por defecto a ningún rol (ni a service_role): el GRANT explícito es obligatorio.

begin;

create or replace function public.registrar_reclamo_verificado(p_datos jsonb, p_cliente_user_id uuid default null)
returns table (codigo text, creado_en timestamptz, fecha_limite date)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v record;
begin
  select r.codigo, r.creado_en, r.fecha_limite into v from public.registrar_reclamo(p_datos) r;
  if p_cliente_user_id is not null then
    update public.libro_reclamaciones l set cliente_user_id = p_cliente_user_id where l.codigo = v.codigo;
  end if;
  return query select v.codigo, v.creado_en, v.fecha_limite;
end;
$$;

comment on function public.registrar_reclamo_verificado(jsonb, uuid) is
  'Solo service_role (Edge Function registrar-reclamo, tras verificar Turnstile). Ver migración 20261120000005.';

revoke all on function public.registrar_reclamo_verificado(jsonb, uuid) from public, anon, authenticated;
grant execute on function public.registrar_reclamo_verificado(jsonb, uuid) to service_role;

revoke execute on function public.registrar_reclamo(jsonb) from public, anon, authenticated;

commit;
