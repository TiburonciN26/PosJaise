-- =========================================================
-- Mis atenciones: la discrepancia lleva una NOTA con el motivo
--
-- Hasta ahora la administradora abría la discrepancia con un solo clic y la persona que atendió solo veía «hay que conversarla»,
-- sin saber POR QUÉ (¿precio distinto?, ¿otra clienta?, ¿otro servicio?). Ahora la administradora escribe el motivo al iniciarla y
-- esa nota se le muestra a quien atendió, en la misma atención y en el aviso de su panel, para que llegue a la conversación
-- sabiendo de qué se trata.
--
--   · registro_discrepancias.motivo (texto, máx. 300). Obligatorio al marcar desde ahora; las discrepancias abiertas antes de esta
--     migración quedan con motivo NULL y la pantalla simplemente no muestra nota.
--   · marcar_discrepancia_atencion(uuid, text): suma p_motivo (de 1 a 2 parámetros). DROP de la firma anterior para que PostgREST no
--     vea dos candidatas. Misma regla de siempre (solo la administradora, solo atenciones ajenas, una abierta por atención).
--   · La política de lectura no cambia: la administradora ve todas y cada quien solo las de sus propias atenciones, así que la
--     dueña de la atención ve el motivo y nadie más.
-- =========================================================

begin;

alter table public.registro_discrepancias
  add column if not exists motivo text
    check (motivo is null or char_length(motivo) <= 300);

drop function if exists public.marcar_discrepancia_atencion(uuid);

create or replace function public.marcar_discrepancia_atencion(p_registro_id uuid, p_motivo text default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registro public.registro_servicios%rowtype;
  v_id uuid;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if not public.es_admin() then
    raise exception 'Solo la administradora puede marcar una discrepancia';
  end if;

  if v_motivo is null then
    raise exception 'Escribe el motivo de la discrepancia para que la otra persona sepa de qué se trata';
  end if;
  if char_length(v_motivo) > 300 then
    raise exception 'El motivo no puede pasar de 300 caracteres';
  end if;

  select * into v_registro from public.registro_servicios where id = p_registro_id;
  if not found then
    raise exception 'La atención no existe';
  end if;
  if v_registro.usuario_id = auth.uid() then
    raise exception 'Es tu propia atención: puedes editarla directamente';
  end if;
  if v_registro.estado = 'CANCELADO' then
    raise exception 'La atención ya está cancelada';
  end if;
  if exists (
    select 1 from public.registro_discrepancias
    where registro_id = p_registro_id and resuelta_en is null and retirada_en is null
  ) then
    raise exception 'Esta atención ya tiene una discrepancia abierta';
  end if;

  insert into public.registro_discrepancias (registro_id, creada_por, motivo)
  values (p_registro_id, auth.uid(), v_motivo)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.marcar_discrepancia_atencion(uuid, text) from public, anon;
grant execute on function public.marcar_discrepancia_atencion(uuid, text) to authenticated;

commit;
