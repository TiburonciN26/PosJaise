## 48. Rendimiento · Fase 5: listas administrativas paginadas y cargas por demanda — 2026-10-11 (local, sin commit)

**Por qué.** Pedidos Web, Promociones, Reseñas, Referidos, Fidelización y Recompensas Web descargaban y montaban toda su tabla (Pedidos: 429 filas → 18.400 nodos y 343 KB; Protección de servicios: 3.340 filas → 20.457 nodos; Recompensas Web: 1,12 MB al abrir). Inicio bajaba el catálogo de servicios, todas las reseñas y la galería para mostrar 4, 3 y 3 elementos, y esperaba 11 consultas antes de pintar el hero. Recompensas (clienta) lanzaba 22 lecturas al abrir «Cómo funciona». La restauración de sesión leía dos veces el perfil y el estado del negocio y abría dos canales Realtime.

**Qué cambió.**
- `hooks/useListaPaginada.js` + `components/PaginadorLista.jsx`: hasta 40 filas por página, conteo exacto del servidor, orden determinista (fecha + id), respuestas tardías descartadas, retroceso si la página queda fuera de rango, errores con «Reintentar» (nunca una página como lista completa). `lib/listasAdmin.js` reúne las lecturas.
- Contadores globales por estado (Pedidos, Reseñas, Referidos/Fidelización) con consultas de solo conteo; filtros de estado y búsqueda resueltos en el servidor.
- `CampoColapsable` acepta `diferido`: el detalle solo existe en el DOM mientras está abierto. Pedidos pide los ítems al expandir (una vez). Recompensas Web: los canjes de cada premio se cuentan al expandirlo. Borradores de Protección (servicios y productos) viven en el padre por id: sobreviven a plegar, paginar y buscar.
- Recompensas Web: al entrar solo se lee `recompensas_config`; cada subpestaña pide lo suyo; el selector de servicio del premio busca en el servidor (≤ 40 opciones).
- Migración **local** `20261011000002_vistas_listas_admin.sql`: vistas `resenas_moderacion` y `cupones_gestion` (security_invoker, solo `authenticated`) porque PostgREST no puede unir tres tablas ni hacer un OR entre columnas de tablas distintas. Rollback: `drop view` de ambas.
- Inicio: hero y tira inmediatos; cada sección con su lectura (`hooks/useLectura.js`, atada a la cuenta): 4 destacados (ranking limitado a 12 candidatos + lectura por id), galería `limit 3`, tarjetas de reseñas `limit 3` (total y promedio salen de una columna de calificaciones; con más de 1.000 aprobadas el servidor entrega las 1.000 más recientes), promoción `limit 1`; contacto/horario por la caché compartida.
- Recompensas (clienta): `asegurar()` pide los recursos de la subpestaña al entrar, una vez por cuenta; el catálogo público solo en «Canjear».
- Sesión: `cargarPerfil` comparte la lectura en vuelo por usuario; `EstadoNegocioContext` depende del id de la cuenta (no del objeto `session` ni de `cargando`); `App` no precarga el portal mientras se resuelve el rol.

**Límites conocidos.** La búsqueda del servidor no ignora tildes (antes Referidos/Fidelización sí). Los contadores por estado cuestan una consulta de conteo por estado. Las lecturas de `servicios`/`pedidos_web` para administración siguen costando por la RLS (Fase 7). Login conserva su precarga ociosa del portal (decisión de la Fase 2 para clientas).

**Pendiente.** Revisión de Codex; commit/push no autorizados; la migración no está en staging ni producción; la Fase 6 no se inicia.
