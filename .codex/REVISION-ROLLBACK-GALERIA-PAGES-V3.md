# Revisión V3: cierre local de RBG-03

10 de octubre de 2026, America/Lima. Codex, QA de solo lectura. No se ejecutó el ensayo real A/B, no hubo login o red real, escrituras de staging/R2, commit/push ni cambios de configuración. Solo informe/evidencia nuevos en `.codex`, conforme a la instrucción persistente del usuario.

## Veredicto

**RBG-03 cerrado en la implementación y reproducciones revisadas. Alcances A y B aprobados localmente para preparar su ejecución autorizada. Sin nuevos bloqueos.** Se conservan los cierres de RBG-01/RBG-02 y las aprobaciones anteriores de staging/PWA.

La aprobación del código no equivale a ejecutar o validar el rollback real ni a aprobar la Fase 3 completa/producción. Hace falta la elección y autorización expresa del usuario para las escrituras concretas. El texto de Claude que pregunta por autorización no la concede por sí mismo. No ejecuté ninguno de los dos alcances.

**Recomendación:** elegir solo **B**, si el usuario desea validar también las fotos. B ya contiene la conversión de la fila y las comprobaciones de A; no hace falta duplicar el ensayo con una corrida A adicional.

## Revisión y pruebas ejecutadas por Codex

- Flujo con dependencias inyectadas: **25/25**, cero fallos.
- Guardas: **48/48**, cero fallos.
- `node --check` del CLI, núcleo y adaptadores; oxlint de seis archivos revisados: correctos.
- **21 escenarios independientes del CLI completo** con dobles de FS/Auth/fetch/Chromium/crypto, usando núcleo, adaptadores REST/Worker, validadores y URLs reales. Se adaptan los imports solo en memoria; no se altera el control de flujo, registro de intención o limpieza de las fuentes.

Los seis nuevos casos de la suite incluyen el fetch falso que lanza desde los mismos adaptadores que importa el CLI. También inspeccioné que el CLI llama `dependenciasReales` y pasa su fetch seguro, token y generador WebP. El ensayo independiente ejercita ese cableado y sus lecturas con count=exact, PATCH/DELETE y llamadas al Worker.

La mutación que Claude reportó sobre el comportamiento anterior no se repitió modificando archivos del proyecto. La reproducción independiente de la revisión V2 conservada mostraba un objeto restante con sinEscrituras/estadoFinalConfirmado true; la matriz actual confirma la corrección sobre esa secuencia.

## RBG-03: resultado comprobado

El núcleo registra la intención **antes** de `await d.subir(...)`. Una excepción del fetch ya no deja `subidos=false` ni conduce a la rama “sin escrituras”. El finally consulta el inventario estricto para los prefijos previstos y comprueba el estado final, o registra pendientes cuando no puede confirmarlo.

En el diagnóstico del CLI completo:

| Fallo inyectado | Resultado actual |
| --- | --- |
| Primer PUT confirmado, respuesta perdida | Limpia el objeto propio; cero objetos restantes, estado final confirmado; no sinEscrituras; exit 1 por error original |
| Primer PUT sin commit | Relee/verifica inventario; cero objetos; no sinEscrituras; exit 1 |
| Segundo PUT confirmado, respuesta perdida | Limpia ambas variantes del grupo; cero objetos; estado final confirmado; exit 1 |
| PUT perdido, inventario de red caído | Conserva objeto, pendientes y estado final no confirmado; exit 1 |
| PUT perdido, inventario con cursor | Igual: no se trata como lista vacía |
| PUT perdido, inventario malformado | Igual |
| PUT perdido, DELETE del grupo 500 sin efecto | Objeto conservado y pendiente por clave; estado final no confirmado; exit 1 |

Las tres primeras corridas siguen siendo fallidas/incompletas por la operación original incierta: confirmar que se restauró el estado no las convierte en un rollback funcional exitoso. Las últimas cuatro no afirman limpieza o ausencia que no pudieron verificar.

## Regresiones previas conservadas en el diagnóstico

Los otros 14 escenarios del CLI cubren A/B sanos; título ya presente con flujo normal o INSERT configurado a 500 (cero escrituras, fila previa conservada); INSERT confirmado con respuesta perdida y sin edición/con título/activo/orden editados (limpieza por id, sin referencias rotas); DELETE sin efecto y relectura caída (objetos conservados); marca incorrecta/salida ausente; snapshot parcial o sin count (cero escrituras).

A sano termina con tres operaciones de fila; B sano con esas tres, cuatro PUT y dos DELETE de grupos. Ambos restauran el estado inicial del doble y terminan con exit 0. Los negativos de startup/precondiciones no llegan a escribir. Esto mantiene los cierres de RBG-01/RBG-02 y no confunde filas iniciales con la propia.

## Alcance de la aprobación y preparación de la ejecución

**A:** INSERT, PATCH y DELETE de una fila ficticia identificada por UUID propio en galeria_web de staging. Valida conversión/relectura/reconocimiento del módulo puro; no entrega de imágenes.

**B:** lo anterior, más cuatro PUT y eliminación de dos grupos ficticios en el R2 de staging. Valida bytes entregados por Pages y r2.dev después de convertir URLs. No hay cambios de Function, binding, variables o deployments, ni commit/push.

Al ejecutar el alcance elegido: usar el preflight del alias/marca/entrega vigentes, salida en archivo nuevo de `.codex`, conservar snapshot e inventario inicial/final, y detener/informar si la lectura o cleanup dejan pendientes. El título nunca autoriza borrar; la identidad de la fila es el id previsto. La fila antigua y objetos ajenos deben conservarse.

**Observación operativa sin bloqueo:** cuando el inventario no se puede leer, el informe registra el error como pendiente, pero sería útil conservar también `idAntes`, `idDespues` o sus prefijos previstos en los metadatos del informe. Así se facilita una reconciliación posterior sin deducir la autoría desde un listado de bucket. No autoriza una limpieza manual por suposiciones; mantener el estado fallido y pendiente mientras no se pueda verificar.

## Límites

Los dobles no validan WebP real, no abren Chromium, ni demuestran respuestas reales de PostgREST/Cloudflare. El generador WebP se inspeccionó, pero no se ejecutó remotamente. Las URLs/ref de infraestructura del diagnóstico son públicos; no se leyó `.env` real ni se guardaron credenciales.

El ensayo todavía no está ejecutado con escritura. La comprobación “administrable/borrable” sigue acotada al módulo puro y al cleanup del script, sin recorrido de un frontend recompilado a r2.dev. Se mantienen pendientes purga, CPU/cuota, fotos reales, otros navegadores/móvil, carga, recolector y migración inversa. La Fase 3 completa, migración del negocio y retiro de GitHub Pages no están aprobados.

## Evidencia y estado

Carpeta nueva `.codex/evidencia-revision-rollback-galeria-v3/`: `diagnostico-cli.json` y copia `.txt` del diagnóstico externo. Incluye los 21 escenarios, eventos HTTP ficticios y hashes de fuentes. No se editaron código, plan, runbook, suites ni informes anteriores.

SHA-256 de fuentes revisadas:

- CLI: `0654428e0a2cc915ecca08d401a0ea4c0cfbe4879d1ad5f25c489cad62122064`.
- Núcleo: `52c79c7b52dd1bdb866a068f02dcc9bdedfaa5431a2d35908b56e1e2d64b843d`.
- Adaptadores reales: `92c0728d318491f1764b4002f33e46f6762e7e6d992a7e1ea03cd26e41c86f6f`.

HEAD/main locales conservan `7ee3c78ea6c1fcba3a6be2f89e4045b6507ab536` / `0dc629e430ed07eeaccec273d31de93e9717d9bf`. No hice fetch ni nuevas comprobaciones de la publicación en este turno.
