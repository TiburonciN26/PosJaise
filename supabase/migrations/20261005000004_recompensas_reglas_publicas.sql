-- =========================================================
-- Coherencia de Recompensas en el portal — lectura mínima y pública de las reglas VIGENTES.
--
-- SOLO LOCAL (TEST). No se aplica a producción sin autorización aparte. Recompensas permanece apagado.
--
-- Por qué: las pantallas del portal (Citas, detalle de servicio y de producto, carrito de servicios, Inicio y «Cómo funciona»)
-- escribían las tasas de monedas, los umbrales de nivel y las cifras de sellos directamente en el código (5/20, 5/40, 50/150,
-- 20 y 5) o las leían de config_puntos, que es la fórmula ANTIGUA. Cambiarlas en administración no cambiaba lo que la clienta
-- leía, y un fallo de carga terminaba mostrando una tasa inventada. «Cómo funciona» además es pública (sin sesión), y
-- recompensas_config solo se puede leer con sesión.
--
-- Qué hace: una función de SOLO LECTURA que devuelve únicamente lo que el texto de las reglas necesita:
--   * activo (si el programa nuevo está encendido),
--   * tasas de monedas por sol (servicios y productos), umbrales de nivel, tope de sellos y sellos por premio.
-- Mientras el programa está APAGADO devuelve activo = false y todo lo demás nulo: no se anuncian reglas que todavía no rigen ni
-- se adelantan valores que el administrador aún puede cambiar.
--
-- Qué NO expone: costos, materiales protegidos, protección económica, porcentajes de asistentes, corte, fechas internas,
-- saldos ni datos de ninguna clienta. No concede acceso a recompensas_config ni a ninguna otra tabla administrativa.
-- =========================================================

begin;

create or replace function public.recompensas_reglas_publicas()
returns table (
  activo boolean,
  tasa_serv_monedas numeric,
  tasa_serv_soles numeric,
  tasa_prod_monedas numeric,
  tasa_prod_soles numeric,
  umbral_premium numeric,
  umbral_vip numeric,
  sellos_max integer,
  sellos_por_premio integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.activo,
         case when c.activo then c.tasa_serv_monedas end,
         case when c.activo then c.tasa_serv_soles end,
         case when c.activo then c.tasa_prod_monedas end,
         case when c.activo then c.tasa_prod_soles end,
         case when c.activo then c.umbral_premium end,
         case when c.activo then c.umbral_vip end,
         case when c.activo then c.sellos_max end,
         case when c.activo then c.sellos_por_premio end
  from public.recompensas_config c
  where c.id = 1;
$$;

revoke execute on function public.recompensas_reglas_publicas() from public;
grant execute on function public.recompensas_reglas_publicas() to anon, authenticated;

commit;
