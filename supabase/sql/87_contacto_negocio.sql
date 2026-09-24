-- =========================================================
-- POS Negocio 2 — Pestaña Web: Contacto (dirección, teléfono, redes)
-- Ejecutar en Supabase → SQL Editor → New query
-- Requiere que 86_resenas.sql ya se haya corrido.
--
-- No existía en ningún lado del proyecto una dirección física, teléfono
-- de contacto ni redes sociales DEL NEGOCIO (solo teléfonos de clientes/
-- asistentes individuales) — se agregan como columnas nuevas a
-- estado_negocio (ya es la fila singleton de configuración del
-- negocio, igual que ganó dias_atencion/bloques en 74_horario_atencion.sql
-- y cuenta_transferencia en 52_cuenta_transferencia_negocio.sql). Todas
-- nullable y sin sembrar ningún valor: las carga el admin desde el
-- nuevo panel "Contacto Web" (POS) — no se inventa ninguna dirección,
-- teléfono ni red social.
--
-- estado_negocio sigue staff-only por RLS de tabla (62_clientes_web.sql)
-- — un cliente lee estos campos vía datos_contacto(), mismo patrón que
-- horario_atencion(). estado_negocio_update_admin (44_estado_negocio.sql)
-- ya cubre las columnas nuevas sin cambios, es una policy a nivel de fila
-- no de columna.
-- =========================================================

begin;

alter table public.estado_negocio
  add column if not exists direccion     text,
  add column if not exists telefono      text,
  add column if not exists instagram_url text,
  add column if not exists facebook_url  text,
  add column if not exists tiktok_url    text;

create or replace function public.datos_contacto()
returns table (
  direccion     text,
  telefono      text,
  instagram_url text,
  facebook_url  text,
  tiktok_url    text,
  abierto       boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select direccion, telefono, instagram_url, facebook_url, tiktok_url, abierto
  from public.estado_negocio
  where id = 1;
$$;

grant execute on function public.datos_contacto() to authenticated;
revoke execute on function public.datos_contacto() from public;

commit;
