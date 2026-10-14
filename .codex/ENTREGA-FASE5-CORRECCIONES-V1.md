# Entrega Fase 5 — correcciones de la revisión V1 (F5-01 … F5-05)

Fecha: 2026-10-11. Base `6929c619`, solo local, sin commit/push/migraciones remotas/hosting. Fase 6 no iniciada. Responde a `REVISION-FASE5-LISTAS-ADMIN-V1.md`.

| Hallazgo | Corrección | Regresión (`scripts/verificar-fase5.cjs`) |
| --- | --- | --- |
| F5-01 fallo presentado como página/filtro nuevo | `useListaPaginada` recuerda la última lectura confirmada (`de`): con un fallo sigue rotulada la página confirmada (no la pedida), muestra aviso + Reintentar (`fallo`), y una búsqueda nueva fallida NO deja los resultados del filtro anterior (`error`). Conteo ausente/ inválido = fallo. Volver a pedir la misma página tras fallar funciona | página 2 falla → «Página 1», filas confirmadas, aviso; Reintentar sano → «Página 2». Búsqueda fallida / sin conteo → 0 filas, sin paginador, aviso; Reintentar → total exacto. Página 2 lenta + búsqueda → gana la última |
| F5-02 borrador perdido al cambiar de subpestaña | Almacén de borradores en `RecompensasWeb` (claves tipo+id, atado al id de cuenta) usado por Protección de servicios, de productos y por Programa | Escribir en servicios/productos/Programa, cambiar de subpestaña y volver: valores conservados. Los modales (Premio) son transitorios y bloquean el cambio de pestaña mientras están abiertos; no se conservan |
| F5-03 B no pide recursos con la pantalla montada | El efecto de `RecompensasCliente` depende también de `userId` | Otra pestaña sale y entra Beta con el saldo de Alfa fallido y lento: Beta ve su cupón sin tocar pestañas, sin cupones de Alfa, saldo de B pedido |
| F5-04 búsqueda sin equivalencia de tildes | La vista `cupones_gestion` añade `codigo_busqueda` y `cliente_busqueda` (minúsculas, sin diacríticos, `translate()` SQL puro, sin extensión); el texto se normaliza igual (NFD) y se compara con ILIKE; comodines escapados y valores citados. Se corrigió un error propio de la tabla de traducción (una `o` de más) hallado por la prueba | 20 términos (jose/josé/JOSE/José, pena/peña/PEÑA, nino/niño, código, `_100%`, `%`, `_`, `a,b`, `(`, `)`, `"`, `o'b`, `\`): cada total = SQL de referencia, HTTP 200 |
| F5-05 catálogo público cargando bajo StrictMode | `useCatalogoPublico` decide por «terminó bien» (no «se pidió») y el cleanup invalida solo lo en vuelo | Servidor de **desarrollo** (StrictMode): entrada directa a Canjear, desde Cómo funciona, fallo + reintento, y Mis cupones de la clienta: terminan de cargar, sin consultas personales del visitante |

Observaciones atendidas: texto de RLS corregido (la clienta ve aprobadas **y las suyas**, incluso pendientes); Inicio rotula «Al menos N» si falta el conteo exacto y «promedio de las N más recientes» si hay más reseñas que filas entregadas.

## Verificación
`verificar-fase5.cjs` **32/32** (24 anteriores + 8 nuevos; 6 con build de producción en :5192 y 2 con servidor de desarrollo en :5193, ya cerrados). Limpieza comprobada (0 filas «QA F5»/«QAF5-»; 429 pedidos, 208 promociones). Build y oxlint sin diagnósticos nuevos. La migración local se reaplicó con el SQL corregido. No se repitió el laboratorio de rendimiento: los cambios no alteran las rutas medidas (solo rotulado/errores del hook, el disparo por identidad, un almacén en memoria y columnas de búsqueda). **No se ejecutó un control negativo** (no se conservó un build V1 para repetir las regresiones; Codex las reprodujo en V1).

## Rollback exclusivo de Fase 5
- `evidencia-fase5/parche-fase5-modificados.patch`: 13 archivos modificados solo por Fase 5 (`git apply -R --check` correcto; no incluye archivos de Fase 4 ni del CLI).
- Borrar archivos nuevos: `src/hooks/{useListaPaginada,useCuponesAdmin,useLectura}.js`, `src/lib/listasAdmin.js`, `src/components/{PaginadorLista,FiltroEstadoContadores}.jsx`, `scripts/{medir-fase5,verificar-fase5}.cjs`, `supabase/migrations/20261011000002_vistas_listas_admin.sql` y `drop view public.resenas_moderacion; drop view public.cupones_gestion;`.
- `implementacionesWed.md`: quitar solo la sección «## 48» (texto en `evidencia-fase5/seccion-48-implementacionesWed.md`); la §47 es de Fase 4.
No se ejecutó ningún rollback.

## Límites
Los de la entrega anterior (RLS/latencia → Fase 7; cifras de laboratorio; solo cuentas locales; vistas solo en Local, sin matriz de roles cajera/asistente). Búsqueda de pedidos/promociones/reseñas sigue sin ignorar tildes (igual que antes de la Fase 5).

Fase 5 lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario.
