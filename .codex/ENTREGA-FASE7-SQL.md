# Entrega Fase 7 · SQL bajo las consultas definitivas (solo LOCAL)

> **Aviso (2026-10-12):** tras `REVISION-FASE7-SQL-V1.md`, las cifras de **Q03** (§4) y del **costo de escritura** (§5, «+3 %») de este documento son históricas y quedaron sustituidas por `ENTREGA-FASE7-CORRECCIONES-V2.md`. El resto se mantiene.

Fecha: 2026-10-11/12. Base HEAD `6929c619`, rama `feat/cloudflare-pages`. Sin commit, push, migraciones remotas, cambios de hosting ni producción. Fase 8 no iniciada. Lista para revisión de Codex.

## 1. Qué se midió y con qué datos (léase primero)

| Escenario | Qué es | Cardinalidades |
| --- | --- | --- |
| **Actual (réplica local)** | La base Supabase Local tal como está. **No es producción.** Son datos de prueba acumulados de las fases anteriores. | 429 pedidos, 3.067 cupones, 4.749 clientas, **3.245 productos**, 3.340 servicios, 208 promociones, 218 reseñas |
| **Ampliada (sintética)** | La réplica + filas sintéticas sembradas **dentro de una transacción que termina en ROLLBACK**. Es una prueba de crecimiento, **no una predicción de producción**. | 60.429 pedidos (120.429 ítems), 123.067 cupones, 34.749 clientas, 23.245 productos, 23.340 servicios, 5.208 promociones, 60.218 reseñas |

El negocio real tiene, según el usuario, **unos 300 productos**; los 3.245 de la réplica no son su catálogo. Las cifras del escenario actual son de la réplica; las del ampliado, de laboratorio. Ninguna es una medición de producción, y no se promete su ahorro allí.

Método: `scripts/medir-fase7.cjs`. Cada consulta reproduce la forma que genera PostgREST (capturada de `pg_stat_statements`: página con `LIMIT/OFFSET` + `count(*)` exacto del filtro completo) y se ejecuta con `set local role` + claims JWT del rol, de modo que RLS actúa como en la app. `EXPLAIN (ANALYZE, BUFFERS)`, 1 pasada de calentamiento descartada, mediana de 5 (actual) o 3 (ampliada) repeticiones. Se contabilizan además las llamadas a `es_admin()/rol_actual()/mi_cliente_id()` (`pg_stat_xact_user_functions`, columna «helpers»). Los números son tiempos de ejecución en el servidor, sin red ni PostgREST.

## 2. Hallazgo comprobado

Las políticas de lectura llaman a los helpers directamente. Son `SECURITY DEFINER`, no se inlinean y se ejecutan **una vez por fila examinada** (cada una consulta `usuarios` o `clientes`). El `count(*)` exacto que pide la paginación examina toda la tabla filtrada por RLS. Con volumen ampliado, la primera página de Pedidos Web invocaba los helpers **392.994 veces**. Con los datos de la réplica ya se ve (95 ms, 3.005 llamadas), pero allí no es un cuello grave.

## 3. Cambios (2 migraciones, ya aplicadas en Local)

1. `supabase/migrations/20261012000001_rls_helpers_una_vez_por_consulta.sql` — 12 políticas de lectura (`pedidos_web`, `pedidos_web_items`, `resenas`, `resenas_producto`, `resenas_servicio`, `cupones` ×2, `clientes`, `productos`, `servicios`, `promociones` (ALL), `zonas_delivery`). Solo se envuelve cada helper en `(select …)` para que se evalúe una vez (InitPlan). Mismos operadores, roles destinatarios, comando y `WITH CHECK`. Justificación de equivalencia: los tres helpers son `STABLE`, sin argumentos y dependen de `auth.uid()` y del snapshot de la sentencia; devuelven el mismo valor para todas las filas. No se tocó ningún GRANT, función ni regla de negocio. Políticas de otras tablas (ventas, citas, gastos…) **no** se modificaron: no se midieron.
2. `supabase/migrations/20261012000002_indices_listas_medidos.sql` — tres índices:
   - `idx_f7_pedidos_web_creado` (`pedidos_web (creado_en desc, id desc)`)
   - `idx_f7_pedidos_web_items_pedido` (`pedidos_web_items (pedido_id)`; FK que no tenía índice)
   - `idx_f7_cupones_origen_estado_creado` (`cupones (origen, estado, creado_en desc, id desc)`)

Rollback: `.codex/evidencia-fase7/rollback-fase7.sql` (borra los 3 índices y restaura con `ALTER POLICY` el texto original capturado de `pg_policies`; idempotente). **Se ejecutó solo dentro de la transacción de verificación (§5), no sobre la base Local real, que mantiene las migraciones aplicadas.** Estado Local: `schema_migrations` llega a `20261012000002`.

## 4. Resultados antes → después (mediana, ms)

«Antes» = sin ninguna migración; «Política» = solo la 001; «Final» = 001 + 002. Detalle completo, con buffers, nodos de plan y llamadas de helpers: `evidencia-fase7/medicion-actual.json` y `medicion-ampliada.json` (más los `.txt`).

### Réplica local (volumen actual)

| Consulta (rol) | Antes | Política | Final |
| --- | ---: | ---: | ---: |
| Q01 Pedidos, 1.ª página (admin) | 95,7 | 2,6 | 0,9 |
| Q03 Pedidos, búsqueda+estado (admin) | 21,4 | 0,8 | 1,0 |
| Q06 Promociones, 1.ª página (admin) | 36,1 | 0,5 | 0,5 |
| Q08 Reseñas, 1.ª página (admin) | 93,9 | 4,7 | 3,9 |
| Q10 Reseñas, búsqueda (admin) | 167,4 | 14,3 | 12,7 |
| Q14 Cupones, búsqueda (admin) | 20,1 | 6,1 | 5,7 |
| Q16 Productos, búsqueda (clienta autenticada) | 238,0 | 6,9 | 6,0 |
| Q16 Productos, búsqueda (anónimo) | 6,9 | 6,4 | 5,4 |
| Q23 Vitrina de productos (clienta) | 120,9 | 1,4 | 1,3 |
| Q25 Vitrina de servicios (clienta) | 163,7 | 3,2 | 3,2 |
| Q26 Pedidos de la clienta | 95,8 | 0,5 | 0,5 |
| Q29 Cupones de la clienta | 263,9 | 0,8 | 0,8 |

### Escenario ampliado (sintético)

| Consulta (rol) | Antes | Política | Final | Helpers (antes → final) |
| --- | ---: | ---: | ---: | --- |
| Q01 Pedidos, 1.ª página (admin) | 11.902 | 196 | **7,3** | 392.994 → 9 |
| Q02 Pedidos PENDIENTE (admin) | 1.861 | 56 | 8,8 | 60.307 → 9 |
| Q03 Pedidos, búsqueda+estado (admin) | 6.980 | 97 | 10,3 | 232.061 → 9 |
| Q05 Ítems de un pedido (admin) | 15,2 | 13,8 | **0,9** | 32 → 12 |
| Q06 Promociones (admin) | 864 | 1,7 | 1,8 | 20.828 → 4 |
| Q08 Reseñas, 1.ª página (admin) | 8.018 | 72 | 71 | 345.394 → 23 |
| Q10 Reseñas, búsqueda (admin) | 7.919 | 231 | 227 | 374.564 → 28 |
| Q13 Cupones Fidelización DISPONIBLE (admin) | 30,6 | 40,6 | **5,5** | 269 → 3 |
| Q14 Cupones, búsqueda (admin) | 3.059 | 661 | 632 | 129.866 → 4 |
| Q15 Conteo cupones por estado (admin) | 14,6 | 16,2 | **0,2** | 6 → 2 |
| Q16 Productos, búsqueda (clienta) | 1.493 | 36 | 39 | 42.490 → 2 |
| Q16 Productos, búsqueda (anónimo) | 35,8 | 32,4 | 35,3 | 0 |
| Q23 Vitrina de productos (clienta) | 1.415 | 14,2 | 14,4 | 39.276 → 2 |
| Q26 Pedidos de la clienta | 12.881 | 9,8 | 14,1 | 362.560 → 6 |
| Q29 Cupones de la clienta | 11.347 | 22,1 | 19,8 | 492.270 → 4 |

(Q01 cajera, que RLS deja sin filas: 10.058 → 8,9 → 12,3 ms. El resto de las 38 combinaciones consulta×rol está en los JSON.)

Lectura honesta: casi todo el beneficio viene de la migración 001 (helpers). Los índices de la 002 solo se justifican en Q01/Q02/Q03 (pedidos), Q05 (ítems) y Q13/Q15 (cupones). En la réplica actual, la 002 no aporta nada medible (las tablas son pequeñas; el ligero «+» de Q05 es ruido, ~1 ms).

## 5. Ablaciones: índices evaluados y descartados

Cada candidato se midió **solo**, encima de la 001, con las consultas a las que apunta (`evidencia-fase7/borradores/ablaciones.txt`, y `exploracion-indices-ampliada.json` con el conjunto completo):

| Candidato | Resultado (ampliado) | Decisión |
| --- | --- | --- |
| A `pedidos_web (creado_en desc, id desc)` | Q01 161→7 ms, Q02 46→9, Q03 92→13 | **Conservado** |
| B `pedidos_web (estado, creado_en desc, id desc)` | Q02 52→4, Q04 8→3; Q01 sin cambio | Descartado: la ganancia sobre A es de ~4 ms (no se probó A+B combinado) |
| C `pedidos_web_items (pedido_id)` | Q05 53→0,7 ms | **Conservado** (además es FK sin índice) |
| D `cupones (origen, estado, creado_en desc, id desc)` | Q13 34→5,7, Q15 14→0,26, Q12 56→31 | **Conservado** |
| D2 `cupones (estado, creado_en…)`, D3 `(origen, creado_en…)` | Q13 →17/→15, Q15 →8,8/→5 | Descartados: peores que D |
| F `pedidos_web (cliente_id, creado_en desc, id desc)` | Q26/27/29 sin cambio, plan no lo usa | Descartado |
| E catálogos parciales `(categoria, nombre, id) where activo` | Q17/Q18 4→0,3 ms; funciones de vitrina/categorías sin cambio | Descartado: no es cuello confirmado |
| Reseñas ×3 `(creado_en…)`/`(estado, creado_en…)`; promociones `(creado_en…)` | Planes sin cambio (Q08–Q11, Q28, Q06/Q07) | Descartados |

No evaluado: búsquedas `ilike '%…%'` con `pg_trgm`. Q10 (231 ms) y Q14 (632 ms) a escala ampliada siguen siendo las más lentas y se deben a ese patrón y a la vista de tres tablas; añadir la extensión es una decisión aparte, no justificada con el volumen actual.

### Costo de los índices (`scripts/costo-indices-fase7.cjs`, `evidencia-fase7/costo-indices.json`)

| Índice | Tamaño, escenario ampliado | Tamaño, réplica actual |
| --- | ---: | ---: |
| `idx_f7_pedidos_web_creado` | 2,4 MB | 40 kB |
| `idx_f7_pedidos_web_items_pedido` | 2,9 MB | 32 kB |
| `idx_f7_cupones_origen_estado_creado` | 8,7 MB | 232 kB |

Costo de escritura: lote de 20.000 pedidos + 20.000 ítems + 40.000 cupones, 3 repeticiones alternadas sin/con índices: mediana **31,3 s → 32,3 s (+3 %)**, que incluye la generación de filas, así que el sobrecosto puro de mantener los índices es menor o igual a esa cifra. Variación entre repeticiones ≈ 1–3 %: el +3 % está al borde del ruido.

## 6. Regresión de seguridad y contenido (`scripts/verificar-fase7.cjs`, `evidencia-fase7/verificacion-roles.json`)

Una transacción con ROLLBACK, siembra reducida (≈10 %) para tener páginas intermedias, última y vacía. **8 roles**: anónimo, autenticada sin rol ni clienta, clienta A, clienta B, asistente, cajera, cajera **inactiva**, administración. **83 comprobaciones por rol, 664 en total**, repetidas tras cada migración:

- identificadores visibles de 11 tablas y 2 vistas (conteo + hash de la lista de ids, no solo conteos);
- contenido de columnas (hash sobre id, nombre, categoría, precio, estado, total, cliente… de productos y pedidos);
- resultado completo de las 4 funciones de catálogo;
- 15 consultas paginadas × 4 posiciones (primera, segunda, **última**, **vacía**) con su conteo exacto y hash del contenido de la página;
- 8 escrituras (insert/update/delete) por rol, ejecutadas en una subtransacción que siempre se deshace; se registra filas afectadas o SQLSTATE. Ejemplo: cajera → `promociones_insert` = `ERROR:42501`, resto `filas=0`; administración → `filas=1` en todas.

Resultados (veredicto **CORRECTO**):
- «antes» → tras 001: **0 diferencias**; tras 001+002: **0 diferencias**;
- las 12 políticas modificadas difieren de la original **solo por el envoltorio** (comprobado normalizando el texto de `pg_policies`: 24/24 expresiones, 0 «más que envoltorio»); comando, permisividad y roles sin cambios; GRANTs, definición de los tres helpers y RLS activo idénticos;
- **control negativo**: se rompen a propósito `pedidos_web_select` y `productos_select` (`using (true)`); la comparación lo detecta con **76 diferencias** (asistente y cajera ven pedidos que antes no; clientas, inactiva y «nadie» ven pedidos y productos inactivos) → la prueba tiene dientes;
- **reversión** (`rollback-fase7.sql`): políticas idénticas a «antes» (comparación exacta de todas las políticas del esquema `public`) y 0 diferencias de contenido; índices eliminados;
- tras el ROLLBACK la base queda con las mismas filas.

Tras aplicar las migraciones en Local se repitió por la API REST el mismo conjunto de 16 consultas de la Fase 4/5 con la cuenta de administración (`capturar_sql`): mismos códigos y conteos que antes (429 pedidos, 44 PENDIENTE, 218 reseñas, 72 APROBADAS, 89 cupones de fidelización disponibles…).

## 7. Incidente propio, ya corregido (para transparencia)

Mi primera versión de `costo-indices-fase7.cjs` perdió el `\set`/`begin` al escribirse (escape de barra invertida) y se ejecutó **sin transacción**: la siembra sintética y los índices quedaron confirmados en la base Local, y los triggers de auditoría escribieron 90.000 filas en `auditoria`. Lo detecté de inmediato, identifiqué lo sembrado por sus marcas (`QA7`, `COSTO…`, pedidos con `creado_en` futuro, ítems duplicados por pedido), lo borré en una transacción y comprobé que los conteos volvían **exactamente** a los previos (4.749 clientas, 429 pedidos, 429 ítems, 3.067 cupones, 3.245 productos, 3.340 servicios, 208 promociones, 49/89/80 reseñas, 25.860 filas de auditoría de las cuales las 90.000 sembradas desaparecen). Solo se borró lo que llevaba esas marcas. Los contadores de `pg_stat_user_tables` (inserciones/borrados acumulados) quedaron inflados por ese incidente. Corregido: todos los scripts usan `-v ON_ERROR_STOP=1` en la línea de comandos y el script de costo se reescribió; después se repitieron las mediciones y la verificación con una base verificada intacta (4749, 429, 25860).

## 8. Aplicado en Local / archivos

- **Aplicado en Local (54321):** migraciones `20261012000001` y `20261012000002`; 3 índices y 12 políticas modificadas. Nada más en la base.
- Nuevos: `supabase/migrations/20261012000001_…sql`, `…000002_…sql`; `scripts/medir-fase7.cjs`, `scripts/verificar-fase7.cjs`, `scripts/costo-indices-fase7.cjs`, `scripts/lib/volumen-fase7.cjs`; `.codex/ENTREGA-FASE7-SQL.md`; `.codex/evidencia-fase7/` (`medicion-actual|ampliada.{json,txt}`, `verificacion-roles.json`, `costo-indices.json`, `rollback-fase7.sql`, `exploracion-indices-ampliada.json`, `borradores/` con las ablaciones y el script que las lanzó). Sin cambios en `src/`: la aplicación no se modifica.
- Fuera de alcance de este paquete: las migraciones 001/002 de las Fases 4/5 siguen sin aplicarse en remoto.

## 9. Limitaciones

- Nada de esto se midió en producción ni staging; el negocio tiene ~300 productos y volúmenes muy inferiores al escenario ampliado. Con datos reales de ese tamaño, el beneficio será pequeño (la propia réplica de 3.245 productos ya solo sufre ~240 ms en la peor consulta). El valor principal es **prevenir degradación al crecer** y quitar trabajo repetido por fila.
- Escenario ampliado sintético: distribuciones inventadas (estados, orígenes, nombres con fragmentos de búsqueda); los planes en otros datos podrían diferir. Tiempos del servidor, no extremo a extremo, con la máquina compartida con Docker; variación entre repeticiones de ±10 % en las consultas rápidas.
- Las ablaciones midieron cada índice solo; no se probaron todas las combinaciones (p. ej. A+B).
- Búsquedas `ilike '%x%'` (Q10, Q14, productos) y la vista de reseñas de tres tablas siguen lineales; Q10 ≈ 230 ms y Q14 ≈ 630 ms a escala ampliada. No se propone `pg_trgm` sin evidencia de necesidad.
- Otras tablas con políticas que llaman a helpers por fila (ventas, citas, gastos, deudas…) no se midieron ni modificaron.
- `CREATE INDEX` bloquea escrituras mientras construye; con volumen real pequeño es instantáneo, pero si en producción las tablas fueran grandes convendría `CONCURRENTLY` fuera de transacción (anotado en la migración).
- La reversión se probó dentro de una transacción de verificación, no ejecutándola sobre la base Local real.
- No se probaron los flujos de la aplicación en navegador en esta fase (no hay cambios en `src/`); la comprobación por API REST es de lectura con administración.
- Aplicar a producción requiere confirmación explícita del usuario; no se ha hecho ni propuesto aquí.
