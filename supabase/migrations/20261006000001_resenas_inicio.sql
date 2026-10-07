-- =========================================================
-- Inicio (web cliente): reseñas con fecha y servicio
--
-- Por qué: las tarjetas "Lo que dicen nuestras clientas" de Inicio leían
-- resenas_publicas(), que son reseñas GENERALES del salón (una por
-- clienta, sin servicio). El diseño pide mostrar la fecha y a qué
-- servicio pertenece cada reseña, y ese dato solo existe en
-- resenas_servicio. Esta función junta ambas fuentes, ya APROBADAS, en
-- una sola lista ordenada por fecha: `servicio_nombre` viene null en las
-- generales (el frontend simplemente no pinta la etiqueta).
--
-- security definer + search_path fijo + grant a authenticated / revoke a
-- public: mismo patrón que resenas_publicas() y resenas_servicio_publicas()
-- (agregado entre clientas que RLS restringiría a las filas propias).
-- =========================================================

begin;

create or replace function public.resenas_inicio()
returns table (
  id              uuid,
  nombre          text,
  calificacion    integer,
  comentario      text,
  creado_en       timestamptz,
  servicio_nombre text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.id, c.nombre, r.calificacion, r.comentario, r.creado_en,
         null::text as servicio_nombre
  from public.resenas r
  join public.clientes c on c.id = r.cliente_id
  where r.estado = 'APROBADA'
  union all
  select rs.id, c.nombre, rs.calificacion, rs.comentario, rs.creado_en,
         s.nombre
  from public.resenas_servicio rs
  join public.clientes c on c.id = rs.cliente_id
  join public.servicios s on s.id = rs.servicio_id
  where rs.estado = 'APROBADA'
  order by creado_en desc;
$$;

grant execute on function public.resenas_inicio() to authenticated;
revoke execute on function public.resenas_inicio() from public;

commit;
