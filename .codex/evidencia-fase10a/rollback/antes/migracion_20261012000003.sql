-- Fase 9 V2.1 (F9-03b) · cambio de referencias de medios CON PLAZO y barrera de cierre, para la herramienta
-- scripts/migracion-medios/medios-migracion.mjs (actualizar / revertir). Solo la usa esa herramienta; la app no la llama.
--
-- Por qué: un UPDATE enviado por PostgREST puede seguir en vuelo (encolado en un proxy o en el pool, o esperando un bloqueo)
-- después de que el cliente recibió un 503 o un corte. Una lectura que todavía muestra el valor anterior NO prueba que ese
-- UPDATE ya no vaya a confirmarse, y el UPDATE condicional (`columna = valor anterior`) no lo detiene: la reversión deja la
-- fila justo en ese valor anterior. Hace falta evidencia del lado del servidor de que la operación ya no puede aplicarse:
--   1. migracion_medios_cambiar: el cambio lleva un plazo (`p_vence`) y la condición `clock_timestamp() < p_vence` va DENTRO
--      del WHERE del UPDATE. Ejecutado tarde (por encolado), no aplica nada.
--   2. migracion_medios_barrera: solo responde una vez vencido el plazo (por el reloj del servidor) y entonces reescribe la
--      columna con su mismo valor (`col = col`). Eso crea una versión nueva de la fila, de modo que:
--        · un UPDATE con plazo que ya había evaluado su WHERE y espera el bloqueo vuelve a evaluarlo (EvalPlanQual) y, con
--          el plazo vencido, no aplica;
--        · uno que ya escribió y aún no confirmó retiene el bloqueo: la barrera espera su confirmación y devuelve su valor;
--        · uno que llega después encuentra el plazo vencido.
--      Medido en Postgres 17 (Local): un bloqueo que solo hace FOR UPDATE NO provoca esa re-evaluación; reescribir la fila sí
--      (ver .codex/ENTREGA-FASE9-CORRECCIONES-V2.1.md). Por eso la barrera escribe y no solo bloquea.
-- La reescritura no cambia ningún valor: el trigger de auditoría solo registra campos que cambian.
--
-- Seguridad: SECURITY INVOKER (aplican RLS y GRANTs de quien llama: las políticas *_update_admin), además exige es_admin() y
-- una lista cerrada de tabla/columna (las mismas de la herramienta). Ejecutable solo por authenticated.
-- Reversión: drop de ambas funciones (.codex/evidencia-fase9-v2.1/rollback/rollback-migracion.sql). No toca datos ni esquema
-- de tablas.
begin;

create or replace function public.migracion_medios_columna_permitida(p_tabla text, p_columna text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select (p_tabla, p_columna) in (
    ('productos', 'foto_url'), ('producto_fotos', 'foto_url'), ('servicios', 'foto_url'),
    ('servicio_fotos', 'foto_url'), ('galeria_web', 'antes_url'), ('galeria_web', 'despues_url')
  );
$$;

-- Devuelve 'hecho' (1 fila), 'sin-cambio' (la fila no tenía p_de o RLS no la permite) o 'vencida' (plazo cumplido).
create or replace function public.migracion_medios_cambiar(
  p_tabla text, p_columna text, p_fila uuid, p_de text, p_a text, p_vence timestamptz
)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_filas integer;
begin
  if not public.es_admin() then
    raise exception 'migracion_medios_cambiar: solo administración' using errcode = '42501';
  end if;
  if not public.migracion_medios_columna_permitida(p_tabla, p_columna) then
    raise exception 'migracion_medios_cambiar: columna no permitida %.%', p_tabla, p_columna using errcode = '22023';
  end if;
  if p_de is null or p_a is null or p_vence is null then
    raise exception 'migracion_medios_cambiar: faltan valores' using errcode = '22023';
  end if;
  if clock_timestamp() >= p_vence then
    return 'vencida';
  end if;
  -- El plazo va en el WHERE: se re-evalúa si la fila cambia de versión mientras este UPDATE espera su bloqueo.
  execute format('update public.%I set %I = $1 where id = $2 and %I = $3 and clock_timestamp() < $4', p_tabla, p_columna, p_columna)
    using p_a, p_fila, p_de, p_vence;
  get diagnostics v_filas = row_count;
  return case when v_filas = 1 then 'hecho' else 'sin-cambio' end;
end;
$$;

-- Antes del plazo: {"estado":"esperar","faltan_ms":n}. Después: {"estado":"cerrada","existe":bool,"valor":text}; desde
-- ese momento ningún migracion_medios_cambiar con ese plazo puede aplicarse ya sobre la fila.
create or replace function public.migracion_medios_barrera(p_tabla text, p_columna text, p_fila uuid, p_vence timestamptz)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_valor text;
  v_filas integer;
begin
  if not public.es_admin() then
    raise exception 'migracion_medios_barrera: solo administración' using errcode = '42501';
  end if;
  if not public.migracion_medios_columna_permitida(p_tabla, p_columna) then
    raise exception 'migracion_medios_barrera: columna no permitida %.%', p_tabla, p_columna using errcode = '22023';
  end if;
  if p_vence is null then
    raise exception 'migracion_medios_barrera: falta el plazo' using errcode = '22023';
  end if;
  if clock_timestamp() < p_vence then
    return jsonb_build_object('estado', 'esperar', 'faltan_ms', ceil(extract(epoch from (p_vence - clock_timestamp())) * 1000));
  end if;
  -- Reescritura con el mismo valor: espera a quien tenga la fila y crea una versión nueva (re-evaluación de los UPDATE en espera).
  execute format('update public.%I set %I = %I where id = $1 returning %I', p_tabla, p_columna, p_columna, p_columna)
    using p_fila into v_valor;
  get diagnostics v_filas = row_count;
  return jsonb_build_object('estado', 'cerrada', 'existe', v_filas = 1, 'valor', v_valor);
end;
$$;

revoke execute on function public.migracion_medios_columna_permitida(text, text) from public, anon;
revoke execute on function public.migracion_medios_cambiar(text, text, uuid, text, text, timestamptz) from public, anon;
revoke execute on function public.migracion_medios_barrera(text, text, uuid, timestamptz) from public, anon;
grant execute on function public.migracion_medios_columna_permitida(text, text) to authenticated;
grant execute on function public.migracion_medios_cambiar(text, text, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.migracion_medios_barrera(text, text, uuid, timestamptz) to authenticated;

commit;
