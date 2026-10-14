# Revisión Fase 7 · V1

Fecha: 2026-10-11, America/Lima. HEAD `6929c619`, rama `feat/cloudflare-pages`. Entrega: `.codex/ENTREGA-FASE7-SQL.md`. Solo Supabase Local del proyecto, puerto 54321.

## Veredicto

**PENDIENTE DE CORRECCIONES; no se aprueba todavía el cierre de la Fase 7.** Hay dos hallazgos **P2 en las herramientas y conclusiones de medición**, F7-01 y F7-02. No se encontró una diferencia de acceso en las lecturas independientes ni un cambio lógico adicional en las dos migraciones revisadas. La optimización de los helpers y los tres índices cuentan con evidencia favorable, pero el informe presenta Q03 como una consulta equivalente a la app y el costo de escritura como una comparación controlada que no son tales.

La corrección se limita a los ensayos afectados, sus regresiones y documentación. No se exige repetir todas las fases previas ni todas las ablaciones. No avanzar a Fase 8, publicar ni aplicar migraciones remotas a partir de esta revisión.

## F7-01 · Q03 cuenta pedidos fuera de la búsqueda

**P2.** `scripts/medir-fase7.cjs:35–40`; relación con `src/lib/listasAdmin.js:18–26`.

`pedidosLista(where, true)` aplica `c.nombre ilike '%maria%'` a la página mediante un lateral `INNER`. Su `cuenta`, en cambio, solo aplica el estado a `pedidos_web`; omite la relación y el filtro de nombre. La app usa `clientes!inner` y filtra `clientes.nombre` con conteo exacto, de modo que el conteo debe corresponder al mismo conjunto de pedidos que la página.

**Reproducción independiente, READ ONLY, administración Local:**

| Conteo | Resultado |
| --- | ---: |
| El que usa el medidor Q03: ENTREGADO, sin buscar clienta | **90** |
| ENTREGADO con clienta que coincide con `%maria%` | **0** |

Un contraejemplo mínimo con tres pedidos (entregado de María, entregado de Ana y listo de María) da 2 en el medidor y 1 en el filtro correcto. No se sembró ese ejemplo; se documenta en memoria.

El tiempo Q03 incluye un `count(*)` de un conjunto distinto y trabajo RLS adicional. Por tanto, su antes/después y las ablaciones que lo incluyen no acreditan exactamente la consulta definitiva de búsqueda de la aplicación. No es un fallo del paginador de la web: el defecto está en su medidor.

**Corrección para Claude:** hacer que la página y el conteo usen el mismo filtro completo, incluyendo el `!inner`/EXISTS equivalente y sus permisos. Añadir una regresión que compare el conteo del SQL medido con el de `leerPedidos`/PostgREST, con pedidos de nombres coincidentes y no coincidentes. Repetir Q03 en réplica y ampliada, y las mediciones de Q03 relevantes para A/B. Preservar los informes originales como históricos; no reasignarles cifras corregidas.

## F7-02 · El ensayo de escritura no controla la condición sin índices ni acredita la cota del 3 %

**P2.** `scripts/costo-indices-fase7.cjs:15–23`; entrega §5, línea 100.

La ejecución generada tiene este orden:

`sin0 → sin1 → sin2 → crear índices/ANALYZE → con0 → con1 → con2`.

Son dos bucles separados, no tres repeticiones alternadas como afirman el comentario y la entrega. `ROLLBACK TO SAVEPOINT` revierte los datos lógicos, pero por sí mismo no asegura que las condiciones físicas y de caché sean iguales después de cada inserción abortada. El segundo grupo además se ejecuta después de construir los índices y analizar. La diferencia es pequeña respecto a la variación y al trabajo incluido en el lote.

**Hay una segunda precondición concreta del mismo ensayo:** no elimina ni rechaza índices F7 presentes al comenzar. En la Local actual están los tres. Si se repite el comando sobre este estado, los lotes etiquetados `sin` también mantendrían esos índices; `CREATE INDEX IF NOT EXISTS` posterior no separaría las condiciones. Se demuestra por lectura del código y por el inventario real, sin ejecutar escrituras.

Los números entregados son aritméticamente coherentes:

- sin: 31.165, 31.327 y 31.521 ms;
- con: 31.245, 32.266 y 32.311 ms;
- diferencia de medianas: **+2,997 %**; intervalos observados solapados.

Eso describe esos seis tiempos del **lote total**, no demuestra «el sobrecosto puro de mantener los índices es menor o igual a 3 %». El denominador incluye generación de filas y otro trabajo, y el orden del ensayo no permite aislar el mantenimiento de índices. Tampoco es una cota de producción: la siembra usa `session_replication_role=replica`.

**Corrección para Claude:** validar y registrar la condición de índices antes de cada muestra; fallar si los supuestos `sin`/`con` no se cumplen. Comparar muestras controladas/pareadas con estado inicial equivalente, y alternar o contrabalancear las condiciones; registrar el orden y la dispersión. Repetir solo el costo afectado, preservando el ensayo anterior. Presentar el resultado como diferencia del lote total y su incertidumbre; retirar la cota del costo puro salvo que se mida y defina de forma separada. Mantener el ensayo en Local, con una transacción/finalización robusta y comprobación de limpieza.

Esta revisión no ejecuta el script: contiene INSERT, construcción de índices, `session_replication_role` y siembra. No se intenta reparar su estado inicial desde Codex.

## Comprobaciones favorables de Codex

### Estado y seguridad, solo lectura

Se verificó la pila `supabase_kong_WedJaiseReact` en el puerto 54321 y el contenedor de base correspondiente. Todas las consultas propias se ejecutaron dentro de **BEGIN READ ONLY**. No se usaron ALTER, DROP, INSERT, UPDATE, DELETE, funciones temporales ni cambios de esquema.

- Las migraciones Local llegan a `20261012000002`.
- Los tres helpers son SQL, **STABLE**, SECURITY DEFINER, sin argumentos, con `search_path=public, pg_temp`. Sus cuerpos dependen de `auth.uid()` y consultan el perfil activo o la clienta. No dependen de la fila del catálogo/pedido evaluada.
- El cambio de la 001 solo envuelve llamadas constantes en SELECT; conserva los operadores y las condiciones de las doce políticas. Incluye `promociones_admin_todo`, que es **ALL**, y conserva su `WITH CHECK`: no debe describirse toda la migración como exclusivamente SELECT.
- Los tres índices actuales están `indisvalid=true` e `indisready=true`, con las columnas y orden declarados. Tamaños Local: **40.960 / 32.768 / 237.568 bytes**, total 311.296 bytes.
- Los hashes actuales de grants de tablas, definiciones de helpers y RLS activo coinciden con los hashes de «antes» registrados por Claude. Es una comparación con su evidencia, no un snapshot antiguo independiente tomado por Codex.
- **77 comparaciones, 0 diferencias:** siete contextos (anónimo, autenticada sin perfil, clientas A/B, asistente, cajera y administración) × once tablas. Se compara conteo y hash de ids visibles por RLS actual contra la evaluación explícita de los predicados anteriores. La evaluación esperada se hace con postgres y claims del contexto: no sustituye una ejecución del motor RLS antiguo ni prueba escrituras. No se modifica ninguna política para obtenerla.
- No hay perfiles inactivos en la Local actual. El caso inactivo se revisa en el JSON de Claude, que lo construyó dentro de su transacción; Codex no desactiva usuarios para repetirlo.

Dos planes actuales independientes muestran InitPlans con **un bucle por nodo**: página de pedidos como admin ≈1,02 ms usando `idx_f7_pedidos_web_creado`; búsqueda de productos como clienta ≈4,64 ms. Son muestras de las consultas simples indicadas en el JSON, sobre la réplica actual, no repeticiones de toda la forma PostgREST ni de los tiempos sintéticos de Claude.

La técnica está documentada por [Supabase, recomendaciones de rendimiento RLS](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select), condicionada a que el resultado no dependa de la fila. La caché corresponde a cada InitPlan/expresión de la sentencia: puede haber varios nodos y llamadas recursivas; no debe prometerse exactamente una llamada total por helper en cualquier consulta compleja.

### Limpieza y navegador

Los conteos actuales son: 4.749 clientes, 429 pedidos, 429 ítems, 3.067 cupones, 3.245 productos, 3.340 servicios, 208 promociones, 49/89/80 reseñas y **25.860 filas de auditoría**. Coinciden con los conteos anteriores declarados. Las marcas QA7/COSTO examinadas en clientes, cupones, productos, servicios y promociones están en **0**. Los conteos propios antes/después de la inspección son iguales.

Esto acredita conteos y ausencia de esas marcas, **no identidad completa de todas las filas ni una reconstrucción independiente de los borrados del incidente**. Los contadores históricos inflados de Postgres no se usan como prueba de actividad nueva.

Se abrió la aplicación real en `/productos` y `/servicios`, con contexto anónimo nuevo de Chromium y backend Local verificado. Ambas pantallas muestran categorías y paginador, sin errores de página ni intentos de escritura bloqueados en la corrida final. Se permiten únicamente GET y RPC de lectura explícitamente revisadas. Son pruebas de lectura de catálogos, no una matriz de sesiones administrativas ni QA de ventas. No se guardan datos.

Los hashes de los archivos SQL y scripts revisados se mantienen. `node --check` pasa en los cuatro scripts; oxlint registra **2 advertencias de variables sin uso** en el medidor (líneas 145 y 158), sin errores. No se ejecuta un build ni se modifica `src/`, variables, hosting o Git.

## Auditoría de la evidencia de Claude

Los JSON informan 664 claves por fase: 0 diferencias tras 001, 0 tras 001+002 y 0 tras reversión; el control negativo registra 76 diferencias. El código contrasta ids, columnas seleccionadas, RPC y páginas, además de ocho operaciones de escritura por contexto en subtransacciones deshechas. Esto es más que comparar conteos.

Se audita la estructura y el resultado, **sin ejecutar esa suite mutante ni repetir su rollback de esquema**. La reversión SQL enumera las doce políticas originales y los tres índices; el JSON reporta políticas restauradas idénticas. Codex no aplica el rollback.

Precisiones no bloqueantes que debe sincronizar Claude:

1. Hay **37** combinaciones consulta×contexto en cada JSON final, no 38.
2. El verificador tiene **14** tipos de consulta paginada, no 15: 19 objetos/firma/RPC + 14×4 páginas + 8 escrituras = **83** por contexto, ×8 = 664.
3. `solo_envoltorio=24` cuenta doce políticas en dos fases «después». No son 24 expresiones distintas comprobadas una sola vez.
4. Los ocho «roles» son ocho contextos de seguridad; los roles PostgreSQL son anon/authenticated y los perfiles del negocio son los existentes. La condición inactiva es transitoria del ensayo.
5. Reejecutar los medidores después de aplicar las migraciones necesita establecer/validar la línea base apropiada: no llamar «antes sin migraciones» al estado Local actual. El verificador con rollback exacto también depende de conocer su estado inicial.
6. `CREATE INDEX` normal y su eventual bloqueo se dejan para la planificación de migraciones remotas, con aprobación del usuario; esta revisión no decide una publicación.

Los resultados favorables de Q01/Q05/Q13/Q15 y el resto de la reducción de helpers siguen siendo evidencia útil; F7-01 no los invalida por asociación. Deben conservar su atribución a los escenarios de laboratorio y no convertirse en promesas para el negocio de unos 300 productos.

## Traspaso

Claude corrige F7-01 y F7-02, añade regresiones del filtro de conteo y de las condiciones/orden del ensayo de costo, repite las mediciones afectadas y sincroniza las precisiones. Guarda entrega V2 y evidencia nueva en `.codex`, preservando V1. Luego Codex revisa esas correcciones. Producción, staging, commit/push y Fase 8 siguen fuera de esta revisión.

Evidencia independiente: `.codex/evidencia-revision-fase7-v1/` (`auditoria-evidencias.json`, `inspeccion-local.json`, `metadatos-comparados.json`, `reproducciones-evidencia.json`, `navegador-lectura.json` y diagnósticos de consulta en `.txt`).
