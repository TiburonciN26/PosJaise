-- Fase 4 · catálogos públicos escalables (Productos y Servicios del portal).
--
-- Por qué: ProductosCliente y ServiciosCliente descargaban el catálogo completo para derivar en el navegador las categorías,
-- sus conteos y las primeras tarjetas de cada fila. PostgREST no puede agrupar ni numerar filas por categoría con una consulta
-- simple, así que hacen falta funciones. Son DOS por catálogo, a propósito separadas:
--   · *_categorias_publicas()  → una fila por categoría (nombre y total). Metadatos COMPLETOS y baratos: la barra de categorías y
--     sus contadores salen de aquí, de modo que todas las categorías son alcanzables sin importar cuántas tarjetas se muestren.
--   · *_vitrina_publica(por_categoria, grupo_desde, grupos_max) → las primeras tarjetas de cada categoría, pero SOLO de una
--     ventana de categorías (desde la posición `grupo_desde`, hasta `grupos_max`). Así la vista «Todos» queda acotada por
--     ventana: grupos_max × por_categoria tarjetas como máximo (10 × 4 = 40 por defecto), crezca lo que crezca el número de
--     categorías. La página pagina las ventanas; no se descarga todo para cortarlo en React.
-- Los parámetros están acotados en el servidor (por_categoria 1–12, grupos_max 1–20, grupo_desde ≥ 0): un llamador no puede
-- pedir una respuesta ilimitada. El listado plano (categoría elegida o búsqueda) NO usa estas funciones: va por consultas
-- normales con range() y conteo exacto.
--
-- Seguridad: todas son SECURITY INVOKER a propósito. Se ejecutan con los permisos de quien llama, así que respetan las mismas
-- políticas RLS (anon: activo = true) y los mismos GRANT por columna que la consulta directa a la tabla. No amplían nada:
-- `productos.costo`, `proveedor`, `stock_minimo` y `codigo_barras` ni se leen ni se devuelven. Solo se agrega EXECUTE para
-- anon y authenticated (los mismos roles que ya pueden leer el catálogo).
--
-- Orden (idéntico al que la página calculaba en el navegador, para no cambiar lo que ve la clienta):
--   · categorías: por el nombre de su primer producto/servicio (la página las tomaba en el orden de aparición de una lista
--     ordenada por nombre); desempate por nombre de categoría;
--   · dentro de una categoría de PRODUCTOS: nombre, id;
--   · dentro de una categoría de SERVICIOS: primero los más pedidos en los últimos `dias` (servicios_mas_pedidos, ya existente),
--     luego nombre, id. Los servicios con el MISMO número de reservas comparten posición (dense_rank) y se ordenan entre sí por
--     nombre e id: antes el orden entre empatados dependía del plan de ejecución de servicios_mas_pedidos (arbitrario); ahora es
--     determinista y legible.
-- Los registros sin categoría no forman fila (igual que antes); siguen alcanzables por búsqueda.
--
-- Esta migración puede haberse aplicado antes en el Supabase LOCAL con una firma anterior de `*_vitrina_publica` (sin ventana):
-- el `drop function if exists` inicial la reemplaza; en una base que no la tenga no hace nada.

begin;

drop function if exists public.productos_vitrina_publica(integer);
drop function if exists public.servicios_vitrina_publica(integer, integer);

-- ---------- Productos ----------

create or replace function public.productos_categorias_publicas()
returns table (categoria text, total bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.categoria, count(*) as total
  from public.productos p
  where p.activo and p.categoria is not null
  group by p.categoria
  order by min(p.nombre), p.categoria;
$$;

create or replace function public.productos_vitrina_publica(
  por_categoria integer default 4,
  grupo_desde integer default 0,
  grupos_max integer default 10
)
returns table (
  id uuid,
  nombre text,
  categoria text,
  subcategoria text,
  precio numeric,
  precio_antes numeric,
  stock_actual integer,
  foto_url text,
  descripcion text,
  destacado boolean,
  nuevo boolean,
  en_inicio boolean,
  total_categoria bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with categorias as (
    select p.categoria, count(*) as total,
           row_number() over (order by min(p.nombre), p.categoria) - 1 as pos
    from public.productos p
    where p.activo and p.categoria is not null
    group by p.categoria
  ),
  ventana as (
    select c.categoria, c.total, c.pos
    from categorias c
    where c.pos >= greatest(coalesce(grupo_desde, 0), 0)
      and c.pos <  greatest(coalesce(grupo_desde, 0), 0) + least(greatest(coalesce(grupos_max, 10), 1), 20)
  )
  select t.id, t.nombre, t.categoria, t.subcategoria, t.precio, t.precio_antes, t.stock_actual, t.foto_url,
         t.descripcion, t.destacado, t.nuevo, t.en_inicio, t.total_categoria
  from (
    select p.id, p.nombre, p.categoria, p.subcategoria, p.precio, p.precio_antes, p.stock_actual, p.foto_url,
           p.descripcion, p.destacado, p.nuevo, p.en_inicio,
           v.total as total_categoria, v.pos,
           row_number() over (partition by p.categoria order by p.nombre, p.id) as posicion
    from public.productos p
    join ventana v on v.categoria = p.categoria
    where p.activo
  ) t
  where t.posicion <= least(greatest(coalesce(por_categoria, 4), 1), 12)
  order by t.pos, t.posicion;
$$;

-- ---------- Servicios ----------

create or replace function public.servicios_categorias_publicas()
returns table (categoria text, total bigint)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select s.categoria, count(*) as total
  from public.servicios s
  where s.activo and s.categoria is not null
  group by s.categoria
  order by min(s.nombre), s.categoria;
$$;

create or replace function public.servicios_vitrina_publica(
  por_categoria integer default 4,
  dias integer default 30,
  grupo_desde integer default 0,
  grupos_max integer default 10
)
returns table (
  id uuid,
  nombre text,
  categoria text,
  precio numeric,
  duracion_min integer,
  foto_url text,
  descripcion text,
  en_tendencia boolean,
  total_categoria bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with ranking as (
    select m.servicio_id, dense_rank() over (order by m.reservas desc) as rango
    from public.servicios_mas_pedidos(coalesce(dias, 30)) m
  ),
  categorias as (
    select s.categoria, count(*) as total,
           row_number() over (order by min(s.nombre), s.categoria) - 1 as pos
    from public.servicios s
    where s.activo and s.categoria is not null
    group by s.categoria
  ),
  ventana as (
    select c.categoria, c.total, c.pos
    from categorias c
    where c.pos >= greatest(coalesce(grupo_desde, 0), 0)
      and c.pos <  greatest(coalesce(grupo_desde, 0), 0) + least(greatest(coalesce(grupos_max, 10), 1), 20)
  )
  select t.id, t.nombre, t.categoria, t.precio, t.duracion_min, t.foto_url, t.descripcion, t.en_tendencia, t.total_categoria
  from (
    select s.id, s.nombre, s.categoria, s.precio, s.duracion_min, s.foto_url, s.descripcion, s.en_tendencia,
           v.total as total_categoria, v.pos,
           row_number() over (partition by s.categoria order by r.rango nulls last, s.nombre, s.id) as posicion
    from public.servicios s
    join ventana v on v.categoria = s.categoria
    left join ranking r on r.servicio_id = s.id
    where s.activo
  ) t
  where t.posicion <= least(greatest(coalesce(por_categoria, 4), 1), 12)
  order by t.pos, t.posicion;
$$;

revoke execute on function public.productos_categorias_publicas() from public;
revoke execute on function public.productos_vitrina_publica(integer, integer, integer) from public;
revoke execute on function public.servicios_categorias_publicas() from public;
revoke execute on function public.servicios_vitrina_publica(integer, integer, integer, integer) from public;
grant execute on function public.productos_categorias_publicas() to anon, authenticated;
grant execute on function public.productos_vitrina_publica(integer, integer, integer) to anon, authenticated;
grant execute on function public.servicios_categorias_publicas() to anon, authenticated;
grant execute on function public.servicios_vitrina_publica(integer, integer, integer, integer) to anon, authenticated;

commit;
