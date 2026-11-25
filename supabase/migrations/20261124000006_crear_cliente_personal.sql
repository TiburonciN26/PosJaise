-- =========================================================
-- Clientes: cajera, encargada y asistente también registran clientas desde los modales de Ventas, Citas y Mis atenciones
--
-- ANTES: clientes_insert_admin solo dejaba INSERTAR a la administradora, así que los modales ocultaban «Registrar como cliente
-- nuevo» a los demás roles (la 20261121…: «cliente nuevo solo admin»). En el día a día eso frena la caja: llega una clienta nueva,
-- la cajera no puede registrarla y tiene que pedirle a la administradora.
--
-- AHORA: una función security definer `crear_cliente_personal()` que la crea por ellas, SIN abrir el INSERT de la tabla:
--   · Abrir la política de INSERT dejaría que un rol del personal escribiera columnas que no son suyas (puntos_bono,
--     codigo_referido, referido_por, cliente_web_id…) pegándole directo a la API. La función solo escribe los 7 datos de la ficha
--     y deja el resto con sus valores por defecto.
--   · Solo ADMINISTRADOR, CAJERA, ASISTENTE y ENCARGADA (PERSONAL_APOYO no: no se le pidió y no cobra ni agenda).
--   · Devuelve únicamente las columnas que el personal puede leer (igual que COLUMNAS_DEVUELTAS de ModalCliente): DNI, dirección y
--     notas se pueden ESCRIBIR pero no leer de vuelta (privilegio mínimo, migración 20261120000004).
--   · El teléfono duplicado sigue fallando con el código 23505 del índice único (idx_clientes_telefono_unico) y el DNI mal formado
--     con 23514 (clientes_dni_formato): el front ya traduce esos dos códigos.
-- Editar una ficha existente sigue siendo solo de la administradora (clientes_update_admin).
-- =========================================================

begin;

create or replace function public.crear_cliente_personal(
  p_nombre     text,
  p_telefono   text default null,
  p_dni        text default null,
  p_sexo       text default null,
  p_direccion  text default null,
  p_cumpleanos date default null,
  p_notas      text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rol text := public.rol_actual();
  v_fila public.clientes%rowtype;
begin
  if v_rol is null or v_rol not in ('ADMINISTRADOR', 'CAJERA', 'ASISTENTE', 'ENCARGADA') then
    raise exception 'No tienes permiso para registrar clientes' using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_nombre, '')), '') is null then
    raise exception 'El nombre completo es obligatorio.' using errcode = 'P0001';
  end if;

  if p_cumpleanos is not null and p_cumpleanos > current_date then
    raise exception 'La fecha de cumpleaños no puede ser futura.' using errcode = 'P0001';
  end if;

  insert into public.clientes (nombre, telefono, dni, sexo, direccion, cumpleanos, notas)
  values (
    btrim(p_nombre),
    nullif(btrim(coalesce(p_telefono, '')), ''),
    nullif(btrim(coalesce(p_dni, '')), ''),
    nullif(btrim(coalesce(p_sexo, '')), ''),
    nullif(btrim(coalesce(p_direccion, '')), ''),
    p_cumpleanos,
    nullif(btrim(coalesce(p_notas, '')), '')
  )
  returning * into v_fila;

  return jsonb_build_object(
    'id', v_fila.id,
    'nombre', v_fila.nombre,
    'telefono', v_fila.telefono,
    'sexo', v_fila.sexo,
    'cumpleanos', v_fila.cumpleanos,
    'foto_url', v_fila.foto_url,
    'cliente_web_id', v_fila.cliente_web_id
  );
end;
$$;

revoke execute on function public.crear_cliente_personal(text, text, text, text, text, date, text) from public, anon;
grant execute on function public.crear_cliente_personal(text, text, text, text, text, date, text) to authenticated;

commit;
