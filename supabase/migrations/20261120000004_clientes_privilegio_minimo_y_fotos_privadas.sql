-- Auditoría global 2026-11-20 (docs/auditorias/auditoria-global-2026-11-20.md), hallazgos 7.5 y 7.2.
--
-- 1) PRIVILEGIO MÍNIMO EN clientes (Ley 29733: acceso a datos personales solo para quien lo necesita)
--    clientes_select deja leer las fichas a cualquier rol del personal, y authenticated tenía SELECT sobre
--    TODAS las columnas: una ASISTENTE o PERSONAL_APOYO podía pedir con la API el DNI, la dirección y las
--    notas privadas de cada clienta, aunque su menú no tenga la pantalla Clientes (solo ADMINISTRADOR).
--    Lo que el resto del personal usa de verdad (Ventas, Citas, Deudas, Historial, Mi Panel, cupones,
--    reseñas): id, nombre, teléfono y cumpleaños (calendario de Citas). Mismo patrón que productos.costo:
--      - authenticated pasa a tener SELECT por columna, SIN dni, direccion ni notas.
--      - la administradora lee la ficha completa por la vista clientes_admin (dueño postgres, filtra
--        es_admin(); security_barrier para que ningún filtro del usuario se evalúe antes que esa guarda).
--    INSERT/UPDATE/DELETE siguen a nivel de tabla (las políticas ya los limitan a la administradora), así
--    que ella puede seguir guardando DNI/dirección/notas; el front pide de vuelta solo columnas permitidas.
--    Las funciones security definer (mi_perfil_cliente, vincular_o_crear_cliente_web, …), las vistas
--    security_invoker (cupones_gestion, resenas_moderacion: solo id/nombre/teléfono) y los triggers de
--    auditoría no se ven afectados.
--
-- 2) fotos-clientes PASA A PRIVADO
--    En un bucket público cualquiera que conozca (o adivine) la ruta ve la foto de perfil de una clienta,
--    sin sesión, para siempre. Ahora se sirve solo con URL firmada de corta duración (lib/imagenes.js →
--    useUrlFotoCliente): la clienta ve la suya (política de carpeta propia, ya existente) y la
--    administradora las de todas (política nueva). Los límites de tamaño/tipo de la migración
--    20261120000001 se mantienen. Los archivos no se mueven: solo cambia cómo se leen.

begin;

-- 1) clientes ------------------------------------------------------------------------------------------
revoke select on table public.clientes from authenticated;
grant select (
  id, nombre, telefono, sexo, cumpleanos, foto_url, cliente_web_id, puntos_bono, codigo_referido,
  referido_por, fidelizacion_recompensas_reclamadas, creado_en
) on table public.clientes to authenticated;

create or replace view public.clientes_admin
with (security_barrier = true) as
select c.id, c.nombre, c.telefono, c.dni, c.cumpleanos, c.notas, c.cliente_web_id, c.foto_url, c.direccion,
       c.sexo, c.puntos_bono, c.codigo_referido, c.referido_por, c.fidelizacion_recompensas_reclamadas,
       c.creado_en
  from public.clientes c
 where public.es_admin();

comment on view public.clientes_admin is
  'Ficha completa de clientas (con DNI, dirección y notas) solo para ADMINISTRADOR. El resto del personal lee public.clientes, sin esas columnas. Ver migración 20261120000004.';

revoke all on table public.clientes_admin from public, anon, authenticated;
grant select on table public.clientes_admin to authenticated;

-- 2) fotos-clientes privado ----------------------------------------------------------------------------
update storage.buckets set public = false where id = 'fotos-clientes';

drop policy if exists fotos_clientes_select_admin on storage.objects;
create policy fotos_clientes_select_admin on storage.objects for select to authenticated
  using (bucket_id = 'fotos-clientes' and public.es_admin());

commit;
