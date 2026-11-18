-- Servicios: fecha en que se agregó cada servicio (pestaña Servicios: se muestra en el desplegable y permite ordenar
-- por «Agregados recientemente").
--
--  1. `servicios.creado_en`: se agrega SIN default y después se le pone `default now()`. Si se agregara con el
--     default de una vez, Postgres rellenaría TODAS las filas existentes con la fecha de esta migración y todos los
--     servicios viejos aparecerían como «agregados hoy» (mismo cuidado que en 20261112000013 para productos).
--  2. Rellenado desde `auditoria`: el trigger `registrar_auditoria()` deja una fila «creado» (campo null,
--     valor_nuevo 'creado') por cada INSERT, con su fecha. Se toma la más antigua por servicio. Los creados antes de
--     que existiera la auditoría (20261001000025) quedan en null y el front los muestra sin fecha.
--     Este UPDATE no llena Auditoría: `registrar_auditoria()` salta la clave `creado_en` al comparar OLD/NEW y es la
--     única columna que cambia.
--  3. GRANT: `servicios` da SELECT por columna a `authenticated` (no a nivel de tabla), así que la columna nueva no
--     se hereda; sin este grant la primera consulta que la pida devuelve 403. Solo la lee el personal (pestaña
--     Servicios), por eso no se concede a `anon`.
--  4. Índice para ordenar la lista paginada por fecha sin recorrer la tabla.
begin;

alter table public.servicios add column if not exists creado_en timestamptz;
alter table public.servicios alter column creado_en set default now();

update public.servicios s
set creado_en = a.primera
from (
  select registro_id, min(fecha) as primera
  from public.auditoria
  where tabla = 'servicios' and campo is null and valor_nuevo = 'creado'
  group by registro_id
) a
where a.registro_id = s.id::text
  and s.creado_en is null;

grant select (creado_en) on public.servicios to authenticated;

create index if not exists idx_servicios_creado_en on public.servicios (creado_en desc nulls last, id);

commit;
