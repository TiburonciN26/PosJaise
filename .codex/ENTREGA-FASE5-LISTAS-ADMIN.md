# Entrega Fase 5 — listas administrativas paginadas y cargas por demanda

Fecha: 2026-10-11 (America/Lima). Base HEAD `6929c619`, rama `feat/cloudflare-pages`. Implementación **solo local, sin commit ni push**. Conserva las reglas comerciales y todo lo aprobado de la Fase 4. Fase 6 no iniciada.

## Alcance completado

| Requisito | Resultado |
| --- | --- |
| Listas administrativas de hasta 40 filas con contadores globales | Pedidos Web, Promociones, Reseñas, Referidos, Fidelización, premios de monedas/sellos, Protección de servicios y de productos: 40 por página, total exacto del servidor, contadores por estado (Pedidos, Reseñas, cupones) con consultas de solo conteo |
| Detalles al expandir, con borradores | `CampoColapsable diferido`: detalle fuera del DOM si está cerrado. Pedidos pide los ítems al expandir (una vez); premios cuentan sus canjes al expandir. Borradores de Protección en el padre, por id: sobreviven a plegar, paginar y buscar |
| Recompensas Web por subpestaña | Al entrar solo `recompensas_config` (308 B); cada subpestaña pide lo suyo; el selector de servicio del premio busca en el servidor (≤ 40 opciones) |
| Inicio acotado | 4 destacados (ranking de 12 candidatos + lectura por id), galería `limit 3`, tarjetas de reseñas `limit 3`, promoción `limit 1`, contacto/horario por la caché compartida. Hero y tira inmediatos; cada sección con su lectura independiente |
| Sin lecturas/suscripciones duplicadas | Perfil compartido en vuelo, `EstadoNegocio` atado al id de cuenta, portal no se precarga mientras se resuelve el rol |
| Recompensas de la clienta | `asegurar()` por subpestaña, una vez por cuenta; «Cómo funciona» no lee nada personal |
| Login / logout / cambio de cuenta | Probado, incluida otra pestaña que sale y entra otra clienta con la pantalla abierta |

## Archivos

Modificados: `src/pages/{PedidosWeb,Promociones,ResenasWeb,ReferidosWeb,FidelizacionWeb,RecompensasWeb}.jsx`, `src/pages/cliente/{InicioCliente,RecompensasCliente}.jsx`, `src/pages/cliente/recompensas/useRecursosRecompensas.js`, `src/components/CampoColapsable.jsx`, `src/context/{AuthContext,EstadoNegocioContext}.jsx`, `src/App.jsx`, `implementacionesWed.md` (§48).
Nuevos: `src/hooks/{useListaPaginada,useCuponesAdmin,useLectura}.js`, `src/lib/listasAdmin.js`, `src/components/{PaginadorLista,FiltroEstadoContadores}.jsx`, `supabase/migrations/20261011000002_vistas_listas_admin.sql`, `scripts/{medir-fase5,verificar-fase5}.cjs`, evidencia en `.codex/evidencia-fase5/`.
(Los archivos de Fase 4 siguen listados en `PAQUETE-FASE4-ARCHIVOS.md`; `RecompensasCliente.jsx` no cambió en Fase 4.)

## Migración (solo LOCAL)

`20261011000002_vistas_listas_admin.sql` crea las vistas `resenas_moderacion` y `cupones_gestion` (`security_invoker`, `grant select` solo a `authenticated`). Motivo: PostgREST no puede unir/ordenar tres tablas de reseñas ni hacer un OR entre una columna de cupones y el nombre de la clienta (comprobado: «failed to parse logic tree»). RLS de las tablas de origen se sigue aplicando: una clienta que consulta la vista ve las reseñas que la política de las tablas ya le permite (aprobadas y las suyas, incluso pendientes) con nombre/teléfono nulos de otras personas y 0 cupones ajenos. **No aplicada en staging ni producción.** Rollback: `drop view public.resenas_moderacion; drop view public.cupones_gestion;`. Sin esta migración, Reseñas, Referidos y Fidelización fallan con «Reintentar».

## Medición antes/después (mismo dataset: réplica local, build de producción, 3 repeticiones, medianas)

Ver `evidencia-fase5/tabla-antes-despues.md` (y `antes.json` / `despues.json` con muestras y peticiones). Resumen:

- Pedidos Web: 18.400 → 1.012 nodos; 335 → 23 KB. Promociones: 8.956 → 1.287 nodos. Reseñas: 7.446 → 1.359. Referidos: 4.091 → 1.224. Fidelización: 2.266 → 1.219.
- Recompensas Web: 1.097 KB → 22 KB (catálogo), 0,3 KB (Programa); Protección de servicios 20.457 → 649 nodos.
- Inicio: 546 KB → 6 KB; 27 → 19 peticiones; duplicadas 5 → 0.
- Recompensas clienta «Cómo funciona»: 22 → 8 peticiones (las 8 son la base del portal); duplicadas 4 → 0.
- Restauración de sesión: duplicadas 2–3 → 0; canales Realtime 2 → 1.
- **Costo honesto:** Pedidos, Reseñas, Referidos y Fidelización pasan de 1–3 a 4–5 peticiones por los contadores de estado (conteos de 0 bytes de cuerpo). El tiempo no se midió como mejora: las consultas a `servicios` y `pedidos_web` tardan 0,2–1,2 s por el costo de RLS (Fase 7).

## Pruebas

`scripts/verificar-fase5.cjs` (24 casos, ver `verificacion-despues.json`): totales y contadores contra SQL, recorrido de todas las páginas sin duplicados/omisiones, detalles ausentes del DOM, búsqueda/filtros en servidor, alta/edición/baja de promoción, moderación de reseña y cancelación de pedido con contadores actualizados, borradores, Inicio con 1,5 s de demora y fallo (hero disponible), lecturas por subpestaña, sesión sin duplicados, refresco de token sin reabrir el canal, POS sin precarga del portal, login/logout/cambio de cuenta (incluido con pantalla abierta en otra pestaña). Siembra filas «QA F5» y las borra al final (verificado 0 restantes). Build y oxlint sin diagnósticos nuevos.

## Límites

- La búsqueda del servidor ignora mayúsculas pero **no tildes** (Referidos/Fidelización antes sí).
- Promedio/total de reseñas en Inicio: total exacto; promedio sobre las 1.000 aprobadas más recientes si hubiera más.
- Login mantiene su precarga ociosa del portal (decisión de Fase 2 para clientas); se retiró solo la del arranque del POS.
- Cifras de laboratorio (preview local, sin CPU 4×); no son INP/LCP. Los miles de registros son la réplica de pruebas.
- Solo cuentas ficticias locales; sin prueba con roles cajera/asistente ni con el backend de staging.
- Cuentas `qa-f5-*@test.local` locales conservadas (credenciales fuera del repositorio).

## Rollback

Revertir con git los archivos modificados listados (el árbol aún contiene cambios de Fase 4 sin commit; no usar un revert global), borrar los archivos nuevos y las dos vistas. Los cambios son solo de frontend más las vistas.

## No se hizo

Commit, push, migraciones remotas, Cloudflare/hosting, producción, Fase 6.

Fase 5 lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario.
