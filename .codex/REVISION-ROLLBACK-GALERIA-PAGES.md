# Revisión del ensayo de rollback de URLs de Galería

10 de octubre de 2026, America/Lima. Codex, QA de solo lectura. Revisados plan, script nuevo y cambios de guardas. No se ejecutó ninguna escritura real: sin login, red, cambios de staging/R2/Cloudflare, commit o push. Solo se añaden este informe y su evidencia en `.codex` por la instrucción persistente del usuario.

## Veredicto

**El plan conceptual separa correctamente los alcances A y B, pero el script no queda aprobado para ejecutarlos todavía.** Dos hallazgos P2 reproducidos con el flujo completo: **RBG-01**, que afecta a ambos alcances, y **RBG-02**, que puede romper las referencias a fotos en el alcance B.

La aprobación anterior de PWA/entrega Pages en staging permanece vigente. Los hallazgos son del **nuevo script de QA**, no defectos nuevos demostrados en la aplicación o incidentes ocurridos en el negocio. No se borró ni rompió ninguna fila/foto real en esta revisión.

## Qué ejecutó Codex

- Guardas existentes ampliadas: **48/48**, cero fallos.
- `node --check` del ensayo y oxlint de ensayo/helper/suite: correctos.
- **12 escenarios independientes sobre el script completo actual**, con Auth/REST/R2/FS/Chromium/crypto ficticios. Se utilizan los validadores y helpers reales de URLs/guardas; los imports se adaptan únicamente en memoria. No se modifica la lógica de INSERT/PATCH/DELETE, selección de fila, limpieza o salida del script.
- Lectura de la migración existente de galeria_web: id UUID primario con default gen_random_uuid, sin restricción de título único. No se ejecutó SQL ni se cambió esquema.

Las pruebas de flujo completo son complementarias a la suite de guardas: ésta no pasa por la selección y limpieza del ensayo nuevo. Los bytes del doble son arbitrarios; el diagnóstico prueba control de flujo/referencias, no validación de WebP o comportamiento real de R2.

## RBG-01 (P2): la precondición fallida no detiene las escrituras y el fallback puede borrar una fila previa

**Ubicación:** `scripts/ensayo-rollback-galeria-pages.cjs:121` y limpieza en líneas 193–199.

`caso('precondición...', !baseFilas.some(...))` registra un fallo, pero no lanza ni retorna. El ensayo continúa con subidas/INSERT/PATCH. Además, cuando no recibió id del INSERT, la limpieza busca cualquier fila por título/activo/orden, aunque ya estuviera en el snapshot inicial.

**Reproducción:** el doble fuerza el id de ejecución a `a1b2c3` y empieza con una fila previa `QA rollback a1b2c3 (borrar)`, activo=false y orden=9999.

1. Con respuestas normales, el script registra la precondición falsa pero efectúa tres escrituras sobre una fila nueva (INSERT/PATCH/DELETE). El resultado es fallo, pero **no hubo aborto antes de escribir**.
2. Con INSERT 500 confirmado sin commit, idFila queda null. Tras la relectura, el fallback identifica la fila **previa** por sus metadatos y la borra por su id. El snapshot inicial tenía una fila; al final tiene cero. El script informa fallo después del borrado, cuando ya hizo daño en el doble.

La generación aleatoria hace menos probable una colisión; no transforma una precondición falsa en autorización para seguir o borrar filas iniciales. El HTTP 500 es una inyección de fallo del doble, no un error real observado.

**Corrección recomendada a Claude:** convertir las precondiciones de seguridad en abortos antes de cualquier escritura, incluido un `finally` que no borre nada por título tras ese aborto. No considerar propia una fila presente en el snapshot inicial. Definir identidad propia estable y la intención de creación antes del POST; no recuperar autoría de borrado usando únicamente título/orden/activo. La limpieza debe poder demostrar que el id procede de esta ejecución.

**Regresiones necesarias:** título propio ya presente con metadata igual/distinta → cero escrituras y fila previa conservada; INSERT rechazado/sin efecto después del preflight → no se borra ninguna fila inicial; colisión de id previsto → aborto. El caso sano sigue restaurando el estado inicial.

## RBG-02 (P2): perder el id del INSERT y no encontrar metadatos no prueba ausencia de fila

**Ubicación:** INSERT/id en líneas 142–145, fallback en 193 y condición de borrado de objetos en 205–216.

El id propio se obtiene solo de la respuesta del INSERT. Si éste confirma y la respuesta se pierde, idFila permanece null. El fallback exige título exacto, activo=false y orden=9999. Si uno cambia antes de la lectura de limpieza, no encuentra la fila, no establece conservaObjetos y pasa a borrar los dos grupos propios. Que no coincidan esos metadatos no demuestra que la fila no exista ni que sus referencias hayan desaparecido.

**Reproducción en B:** se simulan cuatro PUT correctos; INSERT confirma una fila con las URLs de esos grupos, pero pierde su respuesta. El doble simula una edición concurrente solo del título, solo de activo, o solo de orden. En las **tres variantes**:

- queda una fila viva con las dos URLs originales de Pages;
- no se ejecuta DELETE de esa fila;
- se borran ambos grupos (cuatro variantes);
- queda una fila con referencias propias rotas; el estado final falla después de borrar.

Control: con respuesta perdida y metadatos sin editar, el fallback sí encuentra la fila y mantiene el orden de eliminación. Esto confirma que la reproducción depende de la identificación por metadatos, no de un fallo genérico del doble.

**Corrección recomendada a Claude:** generar un UUID de fila antes del INSERT, enviarlo en la operación y usarlo para reconciliar su resultado y buscar por identidad exacta. Separar id previsto, creación intentada y creación confirmada para no interpretar preflight/POST no ejecutado como fila propia existente. Ante resultado/identidad desconocidos, conservar objetos y registrar el pendiente. Solo borrar los objetos después de confirmar que la fila identificada ya no existe; un cambio de título/orden/visibilidad nunca autoriza borrar sus fotos.

**Regresiones necesarias:** INSERT confirmado con respuesta perdida, con cada cambio de metadata antes de cleanup; fila sin respuesta pero id previsto legible; lectura por id caída/resultado incierto; DELETE con y sin efecto. Ninguna fila viva debe quedar referenciando objetos eliminados. Lo anterior no requiere modificar la aplicación o las políticas ni escribir remotamente para demostrarlo.

## Matriz del diagnóstico completo

| Escenario | Resultado observado en el doble |
| --- | --- |
| A sano | Exit 0, cero filas/objetos al final |
| B sano | Exit 0, cuatro PUT, limpieza ordenada, cero filas/objetos |
| Título previo, flujo normal | Exit 1, pero hace tres escrituras pese a precondición falsa |
| Título previo + INSERT 500 sin commit | Exit 1, borra la fila inicial (RBG-01) |
| INSERT confirmado, respuesta perdida, sin edición | Exit 1 por error original; limpia fila/objetos y confirma estado final |
| Respuesta perdida + título editado | Exit 1, fila viva y cuatro variantes borradas (RBG-02) |
| Respuesta perdida + activo editado | Igual |
| Respuesta perdida + orden editado | Igual |
| DELETE 204 sin efecto | Conserva fila y cuatro variantes, exit 1 |
| DELETE aplicado, relectura 503 | Conserva cuatro variantes y marca pendiente, exit 1 |
| Marca incorrecta | Cero escrituras, exit 1 |
| Sin salida | Cero peticiones/escrituras, exit 1 |

Los controles sanos, DELETE sin efecto y relectura caída funcionan correctamente. La salida no presenta falso éxito en los dos hallazgos: el problema es que el fallo final **no impide los borrados equivocados anteriores**.

## Precisiones del plan y límites

El alcance A distingue correctamente conversión/reconocimiento sin entrega de bytes; B añade objetos ficticios y comparación completa del contenido. Reconocimiento se comprueba con el módulo puro real, **no** con un recorrido de UI de un frontend recompilado a r2.dev ni con la operación de borrado a través de sus modales. Acotar esa afirmación de “administrable/borrable” al reconocimiento de la referencia y al cleanup del ensayo.

La lectura de galeria_web valida estado/array, pero no tiene paginación ni comprobación de que la respuesta cubra todas las filas. No llamar genéricamente “snapshot completo” a una respuesta parcial: antes del ensayo verificar/completar esa lectura, o acotar y comprobar la cardinalidad del staging. El inventario R2 sí rechaza un cursor presente. No se reprodujo truncamiento remoto en esta revisión.

Mantener Function/binding/variables intactos para el ensayo, conservar la fila antigua y excluir escrituras de negocio/producción. Después de las correcciones locales y su revisión, el usuario elige A o B y autoriza sus escrituras concretas. **No solicité ni asumí esa autorización ahora.** No ejecutar ninguno de los dos alcances todavía, ni publicar código para demostrar estas correcciones.

## Evidencia y fuentes

Informe nuevo: `.codex/REVISION-ROLLBACK-GALERIA-PAGES.md`. Evidencia nueva en `.codex/evidencia-revision-rollback-galeria/`: `diagnostico-rollback-v2.json` y `diagnostico-rollback.txt`. Se conserva solo la matriz final de 12 escenarios; el diagnóstico describe las inyecciones, ids y eventos ficticios. No contiene credenciales reales ni resultados remotos inventados.

Hashes SHA-256 revisados:

- Ensayo: `c28e8fef8d267b8e27b1c7c90f7a81be8028d85f09797a9e98191a36e5d5c8e2`.
- Guardas: `0f0d96c9b291a04cb33b4b10b2a141b12a9fa406445a65ce267310fdc3d4966d`.

No se editó el ensayo, plan, runbook, suite, migraciones ni informes anteriores. Siguen pendientes purga, CPU/cuota, fotos reales, otros navegadores/móvil, carga, recolector y migración inversa; la Fase 3 completa y producción no están aprobadas.
