-- Mis atenciones en tiempo real
--
-- POR QUÉ: la pestaña Mis atenciones debe reflejar al instante lo que hace la otra persona (la administradora marca una
-- discrepancia, la trabajadora confirma el acuerdo con la manito…): las cuentas se cierran en persona los sábados y ambas
-- tienen la pantalla abierta. Sin estas tablas en la publicación `supabase_realtime`, la suscripción postgres_changes del
-- front no recibe nada (ni en Local ni en producción) y hay que refrescar a mano.
--
-- SEGURIDAD: Realtime respeta la RLS con el JWT de cada suscriptora: registro_servicios y registro_discrepancias solo llegan
-- a quien ya puede leerlas (cada persona las suyas; la administradora todas). Los GRANT SELECT a `authenticated` ya existen.
--
-- CITAS: la pestaña Citas ya se suscribía a esta tabla (src/pages/Citas.jsx) pero nunca estuvo en la publicación, así que
-- su tiempo real no hacía nada. Con esto empieza a funcionar: cambios de otra persona (agendar, cancelar, completar) se ven solos.
--
-- Idempotente: no falla si la tabla ya estaba en la publicación.

begin;

do $$
declare
  t text;
begin
  foreach t in array array['registro_servicios', 'registro_discrepancias', 'citas'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

commit;
