# Verificación Fase 7 · V2

Fecha: **2026-10-12**, America/Lima. HEAD `6929c619e88a91434cb16ee6a8d2de90de94c091`, rama `feat/cloudflare-pages`. Entrega revisada: `.codex/ENTREGA-FASE7-CORRECCIONES-V2.md`.

## Veredicto

**APROBADA CON OBSERVACIONES, SOLO PARA IMPLEMENTACIÓN Y QA LOCAL.** Se cierran **F7-01** y **F7-02** en el alcance revisado. No quedan hallazgos P2 bloqueantes de V1. Se conservan observaciones sobre estadística, estado físico de Local y alcance de la guarda.

Esto no acredita staging, producción, migraciones remotas, commit/push o cambios de hosting, ni inicia la Fase 8. La publicación y la siguiente fase esperan la indicación del usuario.

Las dos migraciones tienen los mismos SHA-256 que en V1. Su lógica RLS y los tres índices no se modificaron. Se revisa el contenido del rollback vigente sin aplicarlo; no se dispone en V1 de una huella independiente de ese archivo para afirmar identidad binaria histórica.

## Qué verificó Codex

**141 controles correctos, 0 fallos inesperados**, más el control negativo de Q03 que detecta el defecto anterior:

- **20** controles de JSON, orden, aritmética pareada y SQL generado. El script de costo se evaluó con adaptadores de proceso interceptados: se captura el SQL que enviaría, **sin enviarlo** ni ejecutar INSERT/DDL.
- **24** combinaciones estado × término del ejemplo mínimo, ejecutadas con SELECT y CTE ficticias, sin insertar las tres filas en ninguna tabla.
- **16** combinaciones de la réplica actual: conteo y página del constructor corregido frente al filtro serializado por `leerPedidos` real y el SDK. Las peticiones HTTP del SDK se simulan; el conteo esperado se calcula en SQL de solo lectura. No es una segunda ejecución autenticada de PostgREST.
- **4** casos de la guarda aislada: se ejecuta únicamente su DO de comprobación contra catálogos ficticios en transacciones READ ONLY. Tres excepciones esperadas rechazan estados inválidos; no se ejecuta la reversión de políticas.
- **77** comparaciones de lecturas RLS: siete contextos × once tablas, contenido identificado por conteo y hash de ids. El resultado actual coincide con la evaluación explícita de los predicados anteriores bajo claims del contexto. No se activa el motor RLS antiguo ni se prueban escrituras.

Se verificó el contenedor `supabase_kong_WedJaiseReact` y el puerto 54321 antes de las consultas. Todo SQL propio contra Local va en **BEGIN READ ONLY**. No hubo INSERT, UPDATE, DELETE, ALTER, DROP, aplicación de migraciones ni cambios de usuarios. El SELECT con CTE y el DO aislado no crean tablas ni funciones persistentes.

Los seis scripts revisados pasan oxlint sin diagnósticos; las comprobaciones de sintaxis ejecutadas pasan. Los hashes de los archivos revisados se mantienen durante la revisión.

## F7-01 · Cerrado

`pedidosLista` de `scripts/lib/consultas-fase7.cjs` añade al conteo un EXISTS con el mismo vínculo `cliente_id` y filtro de nombre usados por el lateral INNER de la página. El caso sin búsqueda mantiene el lateral LEFT. El filtro de estado coincide en ambos conjuntos.

El ejemplo mínimo de María/Ana produce conteo **1** para ENTREGADO + María, **1** para LISTO + María, **2** para ENTREGADO + ambos nombres y **0** para el término inexistente. Las 24 combinaciones coinciden con las filas de su propia página. Al simular el conteo antiguo, el caso principal vuelve a dar **2 en lugar de 1**: el diagnóstico distingue la corrección.

Las 16 lecturas actuales también coinciden con los filtros que construye la app. El JSON de Claude acredita adicionalmente el conteo real de PostgREST en sus 16 combinaciones; se audita ese resultado, sin repetir su login.

Se revisan las nuevas medidas y las ablaciones A/B/AB:

- Actual: Q03 ≈25,0 → 5,8 → 5,4 ms, término TEST con 90 coincidencias.
- Ampliada: Q03 ≈7.600 → 120 → 37 ms, término Ana con 4.285 coincidencias en la corrida final.
- Con A, Q03 ≈36 ms; B ≈34,4; A+B ≈35,3. A mejora Q01 y Q03; B aporta principalmente unos milisegundos en Q02/Q04. No se justifica agregar B por Q03.

Son mediciones **de Claude**, auditadas por estructura y coherencia, no cronometrajes sintéticos repetidos por Codex. Las ablaciones se ejecutan en transacciones distintas con UUID/datos sintéticos nuevos; alguna cardinalidad difiere en una fila (4.286 vs 4.285 coincidencias). No constituyen pares sobre una identidad de filas idéntica. La distribución y la variación siguen siendo límites de laboratorio.

Las cifras antiguas de Q03 quedan correctamente separadas como históricas no válidas para ese filtro. No se atribuyen mejoras de laboratorio al negocio de unos 300 productos.

## F7-02 · Cerrado con observaciones de medición

El SQL generado confirma:

1. Estado sin índices establecido dentro de la transacción antes de medir; los índices existentes en Local no permanecen inadvertidamente en la condición `sin`.
2. Orden **sin-con-con-sin-sin-con-con-sin**.
3. Validación 0/3 antes de cada muestra; nueve validaciones contando la preparación inicial.
4. Materialización de las tres tablas temporales antes del cronómetro del INSERT.
5. Ocho SAVEPOINT/ROLLBACK por muestra y ROLLBACK exterior.
6. Estado lógico examinado antes/después igual y ocho condiciones registradas correctas en el JSON.

Las cuatro diferencias pareadas se recalculan correctamente: **+238, +413, +214 y +226 ms**; **+67,6 %, +80,7 %, +52,3 % y +47,9 %**. Su media es **62,125 %**, redondeada a 62,1 %. En términos absolutos, las diferencias corresponden aproximadamente a 2,7–5,2 µs por fila de ese lote masivo; no son latencias de una operación real de la app.

Se retiró la cota «costo puro ≤3 %». La nueva separación de generación e INSERT permite observar una señal consistente en esos cuatro pares. El orden contrabalanceado mitiga la deriva; no demuestra que el estado físico o las cachés sean idénticos en cada muestra ni da una cota garantizada. Triggers/FK desactivados, tablas en caché, cuatro pares y volumen sintético impiden extrapolar a producción. Conviene llamarlo **resultado observado de laboratorio**, no «cota».

Codex no ejecuta el nuevo ensayo mutante ni reproduce sus tiempos. La aprobación cubre el diseño corregido, el código revisado y la evidencia auditada.

### O1 · Precisión estadística P3, no bloqueante

En `scripts/costo-indices-fase7.cjs:74`, `med()` toma el elemento de índice `floor(n/2)`. Con cuatro valores devuelve la **mediana superior**, no la mediana habitual que promedia los dos centrales.

| Condición | Valores ordenados (ms) | Mediana habitual | Mediana superior informada |
| --- | --- | ---: | ---: |
| Sin índices | 352, 409, 472, 512 | **440,5** | 472 |
| Con índices | 590, 623, 698, 925 | **660,5** | 698 |

Con la definición habitual, el cambio de medianas es aproximadamente **+49,94 %**. Es un estadístico distinto de la media de los cuatro porcentajes pareados (**62,1 %**), que sigue correcta. Esto no invierte el signo de los cuatro pares ni reabre F7-02.

**Claude:** calcular la mediana para cardinalidad par o rotularla explícitamente como mediana superior. Actualizar el JSON/entrega a partir de los mismos ocho tiempos, preservando el original. Se puede corregir y verificar en memoria; no se requiere otra corrida de INSERT ni un nuevo ensayo ampliado para esta precisión.

## Estado Local y observación física

Los conteos actuales siguen siendo: 4.749 clientes, 429 pedidos, 429 ítems, 3.067 cupones, 3.245 productos, 3.340 servicios, 208 promociones, 49/89/80 reseñas y 25.860 auditorías. Las marcas QA7/COSTO examinadas están en 0. Los conteos propios antes/después de la inspección son iguales.

Los tres índices siguen válidos y listos, con las definiciones esperadas. Las migraciones llegan a `20261012000002`. Los hashes actuales de grants de tablas, helpers y RLS activo coinciden con la evidencia de «antes» de Claude.

**O2: el estado físico no quedó igual al de V1.** Tamaños medidos independientemente:

| Índice | V1, bytes | Ahora, bytes |
| --- | ---: | ---: |
| Pedidos por fecha | 40.960 | **7.397.376** |
| Ítems por pedido | 32.768 | **5.652.480** |
| Cupones por origen/estado/fecha | 237.568 | **31.252.480** |
| Total | 311.296 (~0,30 MiB) | **44.302.336 (42,25 MiB)** |

No se identifica cuál corrida produjo el crecimiento ni se afirma corrupción o nuevas filas. Revertir datos/DDL no equivale a restituir todos los tamaños físicos y estadísticas. El `base_intacta` de este ensayo compara conteos, número de índices y algunas marcas; no compara tamaños, definición completa de toda la base ni identidad de todas las filas.

**Claude:** actualizar la descripción del tamaño actual y acotar «base intacta» a los campos examinados. Registrar el estado físico antes de nuevas comparaciones de rendimiento/espacio y valorar cómo preparar una línea base compacta de Local. Codex no ejecuta VACUUM, REINDEX, borrados ni reconstrucciones. Los 2,4/2,9/8,7 MB siguen siendo tamaños de índices construidos en el escenario sintético correspondiente, no los tamaños actuales de la réplica.

Las 77 lecturas RLS propias no muestran diferencias; el perfil inactivo no existe en la Local actual y se acredita solo por el contexto transitorio del ensayo de Claude. Dos planes simples actuales mantienen InitPlans con un bucle y el índice de fecha en la consulta de admin. No se convierten esas dos muestras en los tiempos completos de PostgREST.

## Línea base, roles y límites

La revisión del helper confirma que, en la Local actual con índices F7, se incorpora el rollback dentro de la transacción del ensayo. La guarda aislada acepta política centinela original + 0 índices y rechaza política envuelta, índices presentes o ambos. Las nuevas evidencias registran `linea_base: revertida dentro de la transaccion`.

**O3:** la guarda consulta `pedidos_web_select` como centinela y el prefijo `idx_f7_`; no compara exhaustivamente las doce expresiones originales. No debe describirse como una comparación completa de todas las políticas por sí sola. El rollback literal y el verificador de metadatos aportan el resto de la evidencia de esta corrida. Antes de reutilizarla con estados de esquema distintos, reforzar la verificación si se necesita esa garantía completa.

Se audita el JSON V2 de roles: **664** claves; diferencias tras 001=0, tras 001+002=0, tras reversión=0; control negativo=76; doce políticas distintas solo con envoltorio; helpers/grants/RLS sin cambio. No se vuelve a ejecutar esa suite con siembra, escrituras, ALTER y rollback de esquema. Los métodos de firma cubren las columnas/ids seleccionados, no igualdad de toda la base.

No se repiten navegador, staging o producción: la aplicación y las migraciones no cambiaron respecto de V1. Los catálogos públicos tuvieron verificación de lectura en navegador en V1; no se reasigna a V2 una corrida nueva. Tampoco se acredita una matriz completa de ventas, pagos o sesiones reales del negocio.

Persisten las reservas de búsquedas parciales lineales y tablas no medidas. Las optimizaciones de permisos de otras tablas, extensiones nuevas o índices adicionales no se deducen de este veredicto.

## Traspaso a Claude

- Registrar la Fase 7 como **aprobada con observaciones, solo implementación y QA Local**, enlazando este informe y preservando el V1.
- Corregir/rotular O1 usando las muestras existentes, y sincronizar O2/O3 y las limitaciones.
- Mantener separados los archivos de Fases 3–7 y sus migraciones pendientes de remoto. No publicar para archivar esta auditoría.
- Commit/push, staging, producción y comienzo de Fase 8 requieren la indicación del usuario. Esta revisión no los autoriza ni ejecuta.

Evidencia nueva: `.codex/evidencia-revision-fase7-v2/` — `resumen-verificacion.json`, `auditoria-v2.json`, `diagnosticos-v2.json`, `inspeccion-local.json`, `metadatos-comparados.json` y los diagnósticos en `.txt`. La reproducción histórica de Q03 guardada en la inspección se rotula `q03ConsultaHistoricaV1`; las comprobaciones del constructor corregido están en `diagnosticos-v2.json`.
