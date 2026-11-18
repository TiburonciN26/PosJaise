-- =========================================================
-- Proveedores: registro dedicado, varios proveedores por producto y proveedor de cada ingreso de stock.
--
-- Hasta ahora «proveedor» era un texto suelto en cada producto: se duplicaba por mayúsculas o errores al escribir, no había
-- dónde guardar cómo contactarlo y un producto solo podía tener uno. Ahora:
--  1. `proveedores`: ficha completa (identificación, contacto, ubicación, condiciones comerciales). Solo la administradora
--     la lee (RLS) y solo se escribe con guardar_proveedor() / eliminar_proveedor(). Se pueden crear proveedores sueltos,
--     sin ningún producto (pestaña Proveedores).
--  2. `producto_proveedores`: vínculo N a N, con UN principal por producto. Se reemplaza entero con
--     vincular_proveedores_producto() desde el modal de producto.
--  3. `proveedores_nombres`: solo id/nombre/activo, para que la cajera elija proveedor al agregar stock sin ver contactos.
--  4. `movimientos_stock.proveedor_id` + agregar_stock(..., p_proveedor_id): de quién llegó ESE ingreso. Si no estaba
--     vinculado al producto, se vincula solo (no como principal, salvo que el producto no tuviera ninguno).
--  5. `productos_vista.proveedor` = nombre del proveedor principal (el texto antiguo queda solo como respaldo) y
--     `proveedor_id` = su id, al final de la vista.
-- Los nombres ya escritos en `productos.proveedor` se convierten en fichas y vínculos principales SIN hacer update sobre
-- `productos` (no se llena Auditoría con miles de filas de relleno). El texto antiguo deja de escribirse.
-- =========================================================

begin;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. Proveedores
-- ---------------------------------------------------------------------------------------------------------------
create table public.proveedores (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null check (char_length(btrim(nombre)) between 1 and 80),
  razon_social     text check (razon_social is null or char_length(razon_social) <= 120),
  ruc              text check (ruc is null or ruc ~ '^[0-9]{11}$'),
  rubro            text check (rubro is null or char_length(rubro) <= 120),
  contacto_nombre  text check (contacto_nombre is null or char_length(contacto_nombre) <= 80),
  celular          text check (celular is null or char_length(celular) <= 30),
  telefono         text check (telefono is null or char_length(telefono) <= 30),
  email            text check (email is null or char_length(email) <= 120),
  web              text check (web is null or char_length(web) <= 200),
  redes            text check (redes is null or char_length(redes) <= 200),
  direccion        text check (direccion is null or char_length(direccion) <= 200),
  ciudad           text check (ciudad is null or char_length(ciudad) <= 80),
  condiciones_pago text check (condiciones_pago is null or char_length(condiciones_pago) <= 120),
  dias_entrega     text check (dias_entrega is null or char_length(dias_entrega) <= 120),
  pedido_minimo    text check (pedido_minimo is null or char_length(pedido_minimo) <= 80),
  datos_pago       text check (datos_pago is null or char_length(datos_pago) <= 300),
  notas            text check (notas is null or char_length(notas) <= 1000),
  activo           boolean not null default true,
  creado_en        timestamptz not null default now()
);

create unique index proveedores_nombre_unico on public.proveedores (lower(btrim(nombre)));

comment on table public.proveedores is
  'Proveedores de productos. Solo la administradora la lee; escritura solo con guardar_proveedor() / eliminar_proveedor().';

alter table public.proveedores enable row level security;
create policy proveedores_select on public.proveedores for select to authenticated using (public.es_admin());
revoke all on table public.proveedores from public, anon, authenticated;
grant select on public.proveedores to authenticated;

drop trigger if exists auditoria_proveedores on public.proveedores;
create trigger auditoria_proveedores
  after insert or update or delete on public.proveedores
  for each row execute function public.registrar_auditoria();

-- Nombres para el resto del personal (elegir proveedor al agregar stock). Con los permisos del dueño de la vista: no
-- depende de la RLS de `proveedores`, pero solo responde a una sesión de personal.
create view public.proveedores_nombres as
select id, nombre, activo
from public.proveedores
where (select public.rol_actual()) is not null;

revoke all on table public.proveedores_nombres from public, anon, authenticated;
grant select on public.proveedores_nombres to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Vínculo producto ↔ proveedor
-- ---------------------------------------------------------------------------------------------------------------
create table public.producto_proveedores (
  producto_id  uuid not null references public.productos (id) on delete cascade,
  proveedor_id uuid not null references public.proveedores (id) on delete cascade,
  principal    boolean not null default false,
  creado_en    timestamptz not null default now(),
  primary key (producto_id, proveedor_id)
);

create unique index producto_proveedores_un_principal on public.producto_proveedores (producto_id) where principal;
create index producto_proveedores_proveedor on public.producto_proveedores (proveedor_id);

alter table public.producto_proveedores enable row level security;
create policy producto_proveedores_select on public.producto_proveedores for select to authenticated using (public.es_admin());
revoke all on table public.producto_proveedores from public, anon, authenticated;
grant select on public.producto_proveedores to authenticated;

-- Los nombres ya escritos en productos.proveedor pasan a ser fichas (una por nombre, sin distinguir mayúsculas ni espacios)
-- y vínculos principales.
insert into public.proveedores (nombre)
select distinct on (lower(btrim(proveedor))) btrim(proveedor)
from public.productos
where proveedor is not null
  and char_length(btrim(proveedor)) between 1 and 80
order by lower(btrim(proveedor)), btrim(proveedor);

insert into public.producto_proveedores (producto_id, proveedor_id, principal)
select p.id, pv.id, true
from public.productos p
join public.proveedores pv on lower(btrim(pv.nombre)) = lower(btrim(p.proveedor))
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Escritura de proveedores (solo administradora)
-- ---------------------------------------------------------------------------------------------------------------
-- Texto del jsonb sin espacios en los bordes; vacío → null.
create or replace function public.texto_jsonb(p_datos jsonb, p_clave text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select nullif(btrim(coalesce(p_datos ->> p_clave, '')), '')
$$;

-- `p_id` null = crear. `p_datos` trae las claves de la tabla (las que falten quedan vacías). Devuelve el id.
create or replace function public.guardar_proveedor(p_id uuid, p_datos jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_nombre  text := public.texto_jsonb(p_datos, 'nombre');
  v_ruc     text := public.texto_jsonb(p_datos, 'ruc');
  v_celular text := public.texto_jsonb(p_datos, 'celular');
  v_tel     text := public.texto_jsonb(p_datos, 'telefono');
  v_email   text := public.texto_jsonb(p_datos, 'email');
  v_web     text := public.texto_jsonb(p_datos, 'web');
  v_id      uuid;
begin
  if not coalesce(public.es_admin(), false) then
    raise exception 'Solo la administradora puede crear o editar proveedores.' using errcode = '42501';
  end if;
  if v_nombre is null or char_length(v_nombre) > 80 then
    raise exception 'El nombre del proveedor es obligatorio (máximo 80 caracteres).' using errcode = 'P0001';
  end if;
  if v_ruc is not null and v_ruc !~ '^[0-9]{11}$' then
    raise exception 'El RUC debe tener 11 dígitos.' using errcode = 'P0001';
  end if;
  if v_celular is not null and (char_length(v_celular) > 30 or v_celular !~ '^[0-9+() -]+$') then
    raise exception 'El celular solo puede tener números, espacios, + ( ) y guiones.' using errcode = 'P0001';
  end if;
  if v_tel is not null and (char_length(v_tel) > 30 or v_tel !~ '^[0-9+() -]+$') then
    raise exception 'El teléfono solo puede tener números, espacios, + ( ) y guiones.' using errcode = 'P0001';
  end if;
  if v_email is not null and (char_length(v_email) > 120 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'El correo no es válido.' using errcode = 'P0001';
  end if;
  if v_web is not null and v_web !~* '^https?://' then
    v_web := 'https://' || v_web; -- sin esquema el enlace no se abriría como página externa
  end if;
  if exists (select 1 from public.proveedores where lower(btrim(nombre)) = lower(v_nombre) and id is distinct from p_id) then
    raise exception 'Ya existe un proveedor llamado «%».', v_nombre using errcode = 'P0001';
  end if;

  if p_id is null then
    insert into public.proveedores (
      nombre, razon_social, ruc, rubro, contacto_nombre, celular, telefono, email, web, redes, direccion, ciudad,
      condiciones_pago, dias_entrega, pedido_minimo, datos_pago, notas, activo
    ) values (
      v_nombre, public.texto_jsonb(p_datos, 'razon_social'), v_ruc, public.texto_jsonb(p_datos, 'rubro'),
      public.texto_jsonb(p_datos, 'contacto_nombre'), v_celular, v_tel, v_email, v_web, public.texto_jsonb(p_datos, 'redes'),
      public.texto_jsonb(p_datos, 'direccion'), public.texto_jsonb(p_datos, 'ciudad'),
      public.texto_jsonb(p_datos, 'condiciones_pago'), public.texto_jsonb(p_datos, 'dias_entrega'),
      public.texto_jsonb(p_datos, 'pedido_minimo'), public.texto_jsonb(p_datos, 'datos_pago'),
      public.texto_jsonb(p_datos, 'notas'), coalesce((p_datos ->> 'activo')::boolean, true)
    )
    returning id into v_id;
  else
    update public.proveedores set
      nombre = v_nombre,
      razon_social = public.texto_jsonb(p_datos, 'razon_social'),
      ruc = v_ruc,
      rubro = public.texto_jsonb(p_datos, 'rubro'),
      contacto_nombre = public.texto_jsonb(p_datos, 'contacto_nombre'),
      celular = v_celular,
      telefono = v_tel,
      email = v_email,
      web = v_web,
      redes = public.texto_jsonb(p_datos, 'redes'),
      direccion = public.texto_jsonb(p_datos, 'direccion'),
      ciudad = public.texto_jsonb(p_datos, 'ciudad'),
      condiciones_pago = public.texto_jsonb(p_datos, 'condiciones_pago'),
      dias_entrega = public.texto_jsonb(p_datos, 'dias_entrega'),
      pedido_minimo = public.texto_jsonb(p_datos, 'pedido_minimo'),
      datos_pago = public.texto_jsonb(p_datos, 'datos_pago'),
      notas = public.texto_jsonb(p_datos, 'notas'),
      activo = coalesce((p_datos ->> 'activo')::boolean, activo)
    where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Ese proveedor ya no existe.' using errcode = 'P0001';
    end if;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.guardar_proveedor(uuid, jsonb) from public, anon;
grant execute on function public.guardar_proveedor(uuid, jsonb) to authenticated;

-- Con ingresos de stock registrados se DESACTIVA (el historial sigue diciendo de quién llegó cada ingreso); sin ellos se
-- borra junto con sus vínculos. Mismo criterio que eliminar_producto().
create or replace function public.eliminar_proveedor(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.es_admin(), false) then
    raise exception 'Solo la administradora puede eliminar proveedores.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.proveedores where id = p_id) then
    raise exception 'Ese proveedor ya no existe.' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.movimientos_stock where proveedor_id = p_id) then
    update public.proveedores set activo = false where id = p_id;
    return 'DESACTIVADO';
  end if;

  delete from public.proveedores where id = p_id;
  return 'ELIMINADO';
end;
$$;

revoke execute on function public.eliminar_proveedor(uuid) from public, anon;
grant execute on function public.eliminar_proveedor(uuid) to authenticated;

-- Reemplaza el conjunto de proveedores del producto. El principal es `p_principal` si está en la lista; si no, el primero.
create or replace function public.vincular_proveedores_producto(
  p_producto_id uuid,
  p_proveedor_ids uuid[],
  p_principal uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[] := coalesce(p_proveedor_ids, '{}');
  v_principal uuid;
begin
  if not coalesce(public.es_admin(), false) then
    raise exception 'Solo la administradora puede cambiar los proveedores de un producto.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.productos where id = p_producto_id) then
    raise exception 'El producto no existe.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_ids) as x(id) where not exists (select 1 from public.proveedores pv where pv.id = x.id)) then
    raise exception 'Uno de los proveedores ya no existe.' using errcode = 'P0001';
  end if;

  v_principal := case when p_principal = any (v_ids) then p_principal else v_ids[1] end;

  delete from public.producto_proveedores where producto_id = p_producto_id and not (proveedor_id = any (v_ids));
  -- Primero se quitan todas las marcas de principal: el índice único parcial no admite dos a la vez ni por un instante.
  update public.producto_proveedores set principal = false where producto_id = p_producto_id and principal;
  insert into public.producto_proveedores (producto_id, proveedor_id)
  select p_producto_id, x.id from unnest(v_ids) as x(id)
  on conflict do nothing;
  if v_principal is not null then
    update public.producto_proveedores set principal = true where producto_id = p_producto_id and proveedor_id = v_principal;
  end if;
end;
$$;

revoke execute on function public.vincular_proveedores_producto(uuid, uuid[], uuid) from public, anon;
grant execute on function public.vincular_proveedores_producto(uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Proveedor de cada ingreso de stock
-- ---------------------------------------------------------------------------------------------------------------
alter table public.movimientos_stock add column if not exists proveedor_id uuid references public.proveedores (id) on delete set null;
create index if not exists idx_movimientos_proveedor on public.movimientos_stock (proveedor_id) where proveedor_id is not null;

drop function if exists public.agregar_stock(uuid, integer, text);
drop function if exists public.agregar_stock(uuid, integer, text, uuid);

create function public.agregar_stock(
  p_producto_id uuid,
  p_cantidad integer,
  p_nota text,
  p_proveedor_id uuid default null
)
 returns table(stock_anterior integer, stock_nuevo integer)
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_stock_anterior int;
  v_stock_nuevo int;
begin
  if public.rol_actual() is null then
    raise exception 'No tienes una sesión activa o válida';
  end if;

  if public.rol_actual() not in ('ADMINISTRADOR', 'CAJERA', 'ENCARGADA') then
    raise exception 'Solo el administrador o la cajera pueden agregar stock';
  end if;

  if not public.es_admin() and not public.negocio_abierto() then
    raise exception 'El negocio se encuentra cerrado. Espere a que el administrador inicie la jornada.';
  end if;

  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'La cantidad a agregar debe ser mayor a 0';
  end if;

  if p_proveedor_id is not null and not exists (select 1 from public.proveedores where id = p_proveedor_id and activo) then
    raise exception 'Ese proveedor no existe o está inactivo';
  end if;

  select stock_actual into v_stock_anterior
  from public.productos
  where id = p_producto_id
  for update;

  if v_stock_anterior is null then
    raise exception 'El producto no existe';
  end if;

  v_stock_nuevo := v_stock_anterior + p_cantidad;

  update public.productos
  set stock_actual = v_stock_nuevo
  where id = p_producto_id;

  insert into public.movimientos_stock
    (producto_id, cantidad_agregada, stock_anterior, stock_nuevo, nota, usuario_id, proveedor_id)
  values
    (p_producto_id, p_cantidad, v_stock_anterior, v_stock_nuevo, nullif(trim(p_nota), ''), auth.uid(), p_proveedor_id);

  -- Un proveedor que trajo stock queda vinculado al producto (principal solo si el producto no tenía ninguno).
  if p_proveedor_id is not null then
    insert into public.producto_proveedores (producto_id, proveedor_id, principal)
    values (
      p_producto_id,
      p_proveedor_id,
      not exists (select 1 from public.producto_proveedores where producto_id = p_producto_id and principal)
    )
    on conflict do nothing;
  end if;

  return query select v_stock_anterior, v_stock_nuevo;
end;
$function$;

revoke execute on function public.agregar_stock(uuid, integer, text, uuid) from public, anon;
grant execute on function public.agregar_stock(uuid, integer, text, uuid) to authenticated;

drop function if exists public.historial_stock_producto(uuid);

create function public.historial_stock_producto(p_producto_id uuid)
returns table (
  fecha timestamptz,
  cantidad_agregada int,
  stock_anterior int,
  stock_nuevo int,
  nota text,
  usuario_nombre text,
  proveedor_id uuid,
  proveedor_nombre text,
  proveedor_celular text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not coalesce(public.es_admin(), false) then
    raise exception 'No autorizado';
  end if;

  return query
    select
      m.fecha,
      m.cantidad_agregada,
      m.stock_anterior,
      m.stock_nuevo,
      m.nota,
      u.nombre_completo,
      pv.id,
      pv.nombre,
      pv.celular
    from public.movimientos_stock m
    left join public.usuarios u on u.id = m.usuario_id
    left join public.proveedores pv on pv.id = m.proveedor_id
    where m.producto_id = p_producto_id
    order by m.fecha desc;
end;
$$;

revoke execute on function public.historial_stock_producto(uuid) from public, anon;
grant execute on function public.historial_stock_producto(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. productos_vista: proveedor principal
-- ---------------------------------------------------------------------------------------------------------------
-- Definición de 20261112000013 SIN cambios, salvo `proveedor` (nombre del principal; el texto antiguo como respaldo) y
-- `proveedor_id` (id del principal) agregado al final.
create or replace view public.productos_vista as
select
  p.id,
  p.codigo_barras,
  p.nombre,
  p.categoria,
  p.precio,
  case
    when es_admin() then p.costo
    else null::numeric
  end as costo,
  p.stock_actual,
  p.stock_minimo,
  coalesce(pv.nombre, p.proveedor) as proveedor,
  p.foto_url,
  p.activo,
  p.stock_actual > 0 and p.stock_actual <= p.stock_minimo as stock_bajo,
  p.stock_actual <= 0 as sin_stock,
  p.precio_antes,
  p.destacado,
  p.nuevo,
  p.en_inicio,
  p.subcategoria,
  p.descripcion,
  p.contenido,
  p.rinde,
  p.frecuencia,
  p.oferta_hasta,
  p.especificaciones,
  p.modo_uso,
  p.ideal_para,
  p.tips,
  p.ingredientes,
  p.libre_de,
  p.combo_con,
  greatest(
    p.creado_en,
    (select max(m.fecha) from public.movimientos_stock m where m.producto_id = p.id)
  ) as ultimo_ingreso,
  pv.id as proveedor_id
from public.productos p
left join lateral (
  select x.id, x.nombre
  from public.producto_proveedores pp
  join public.proveedores x on x.id = pp.proveedor_id
  where pp.producto_id = p.id
  order by pp.principal desc, pp.creado_en
  limit 1
) pv on true;

commit;
