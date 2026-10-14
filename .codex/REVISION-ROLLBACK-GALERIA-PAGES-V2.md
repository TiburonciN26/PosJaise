# Revisión V2 del ensayo de rollback de Galería

10 de octubre de 2026, America/Lima. Codex, QA de solo lectura. No se ejecutaron escrituras reales, logins, peticiones remotas, SQL, commits ni cambios de configuración. Solo informe/evidencia nuevos en `.codex`, según la instrucción persistente del usuario.

## Veredicto

**RBG-01 y RBG-02 cerrados en las reproducciones revisadas. El alcance A (solo fila/conversión) queda aprobado localmente para preparar su ejecución autorizada. El alcance B (con objetos) sigue bloqueado por RBG-03 (P2).**

La autorización humana de escritura para A o B todavía no existe en este intercambio; no ejecuté ninguno. La aprobación de un alcance no significa que su resultado real ya esté validado. PWA y entrega Pages conservan sus aprobaciones anteriores; Fase 3 completa y producción siguen pendientes.

## Fuentes y pruebas

Revisados el CLI `scripts/ensayo-rollback-galeria-pages.cjs`, núcleo nuevo `scripts/lib/ensayo-rollback.cjs`, suite `scripts/verificar-ensayo-rollback-galeria.cjs`, cambios de guardas y plan v2.

- Suite del flujo: **19/19**, cero fallos, repetida por Codex.
- Guardas: **48/48**, cero fallos, repetidas por Codex.
- Sintaxis CLI/núcleo y oxlint de cinco archivos tocados: correctos.
- **16 escenarios independientes del CLI completo**, incluidos los adaptadores REST/Worker, ejecutados con fetch/FS/Auth/crypto/Chromium ficticios y núcleo/guardas/validadores/URLs reales. Los imports se adaptan solo en memoria; no se cambia el control de flujo o limpieza de las fuentes revisadas.

La inyección de dependencias facilita las regresiones, pero éstas no ejercitaban un primer PUT que escribe y pierde su respuesta. El diagnóstico de Codex añade esa ruta y el cableado real que propaga la excepción.

Los dobles no validan contenido WebP ni behavior real de PostgREST/Cloudflare. Los buffers son ficticios y no se abrió Chromium. No se copió ni leyó `.env.staging.local` real: se usan campos y credenciales ficticios dentro del doble de FS.

## RBG-01: cerrado

Ahora la colisión de título, id previsto o grupos genera un aborto antes de escrituras. Sin creación/subida marcada, el finally no busca por título ni borra filas. La identidad de una fila inicial no se confunde con la propia.

En el diagnóstico del CLI, la fila previa con título igual queda intacta, con metadata igual, y **cero POST de datos/PATCH/DELETE/PUT**. El caso configurado para responder 500 al INSERT tampoco lo alcanza. Las regresiones de la suite cubren además metadata distinta y colisiones de id/grupos.

## RBG-02: cerrado

El id se genera antes y se envía en el POST. Se separan intención y confirmación; la reconciliación/selección de cleanup compara ese id exacto, no título/orden/activo. Un INSERT confirmado con respuesta perdida ya no deja una fila viva mientras se borran sus fotos por un fallo de identificación.

Repetí por el CLI con dobles las variantes sin edición y con título, activo u orden editados: la fila propia se identifica y elimina por id; solo después se retiran sus grupos. Quedan cero filas/objetos propios y ninguna referencia rota. El resultado sigue siendo fallo por el INSERT incierto, con estado final reconciliado correcto: no se cuenta como éxito funcional del rollback.

DELETE sin efecto mantiene fila y cuatro variantes. DELETE aplicado con relectura 503 conserva los objetos y declara estado no confirmado. No se vuelve a confiar en un 2xx sin relectura.

## RBG-03 (P2): primer PUT incierto no se cuenta como posible escritura

**Ubicación:** `scripts/lib/ensayo-rollback.cjs:57`–58 y decisión de limpieza en líneas 110–114. Cableado real: `scripts/ensayo-rollback-galeria-pages.cjs:107`.

`subidos` se activa **después** de `await d.subir(...)`. El callback real propaga una excepción de red: no devuelve `null`. Si el primer PUT confirma en R2 pero pierde la respuesta, ese await lanza antes de asignar `subidos`. Todavía no se intentó el INSERT, por lo que la condición `creacionIntentada || subidos` queda falsa y el finally toma la rama “sin escrituras”, sin leer/limpiar el inventario.

**Reproducción completa del CLI (sin red real):** el fetch falso guarda la variante m del primer grupo y lanza “primer PUT confirmado, respuesta perdida”. Resultado:

- una petición PUT; ningún INSERT, PATCH o DELETE de datos;
- queda **una clave propia en R2 simulado**;
- `sinEscrituras=true`, `estadoFinalConfirmado=true`, `pendientes=[]`;
- exit 1 y corrida incompleta por el error original.

El código de salida no es un falso éxito global; el problema es el **estado final falsamente confirmado y un objeto propio huérfano sin pendiente ni cleanup**. No ocurrió en staging: es una inyección de fallo. El control “primer PUT cae antes de commit” tiene el mismo tratamiento del script pero cero objetos; la excepción por sí sola no distingue ambos casos.

**Corrección recomendada a Claude:** registrar una intención de subida y su grupo **antes de cada llamada que puede escribir**, y usar esa intención en el finally incluso si el callback lanza o la respuesta es incierta. Reconciliar por inventario estricto los prefijos propios; limpiar cuando corresponda y comprobar igualdad final. Si no se puede leer/limpiar, conservar y registrar pendientes con estado final no confirmado. No afirmar “sin escrituras” por no haber recibido 200/201; no convertir una red caída o 5xx en prueba de ausencia.

**Regresiones necesarias:** primer PUT confirmado con respuesta perdida, primer PUT sin commit, respuesta incierta posterior, primer PUT con error seguido de inventario caído/paginado, limpieza rechazada/sin efecto. En todos: ausencia real comprobada y estado restaurado, o pendientes explícitos/estado no confirmado; nunca archivo propio restante con sinEscrituras/estadoFinalConfirmado true. Añadir al menos una prueba del cableado real del CLI que hace lanzar al fetch, además del núcleo inyectado.

RBG-03 no afecta al modo A, que nunca ejecuta PUT. No hay motivo para revocar los cierres de RBG-01/RBG-02 ni las validaciones anteriores de la aplicación.

## Cableado y lectura completa

El CLI exige `Prefer: count=exact`, estado 200, array y longitud igual al total de Content-Range. En el doble del CLI: lectura parcial declarada y header ausente abortan con **cero escrituras**. La ruta sana con cardinalidad correcta completa A/B. Se inspeccionan los adaptadores reales: POST envía id previsto, PATCH filtra id/título, DELETE usa id, y cleanup Worker filtra grupos propios.

Esta auditoría cubre el control local del cableado contra fetch ficticio; no afirma que se hayan probado sus respuestas reales ni la fabricación WebP en Chromium. No repetí tráfico contra staging para este análisis.

## Matriz independiente

| Escenarios del CLI | Resultado esperado/reproducido |
| --- | --- |
| A sano y B sano | Exit 0, estado final limpio |
| Colisión de título (normal o INSERT configurado a 500) | Cero escrituras, fila previa conservada |
| INSERT perdido, sin edición o con título/activo/orden editados (4 variantes) | Se limpia por id; cero objetos/referencias rotas; exit 1 por resultado original incierto |
| DELETE sin efecto | Fila/objetos conservados, estado no confirmado |
| Relectura tras DELETE caída | Objetos conservados, estado no confirmado |
| Marca incorrecta o salida ausente | Cero escrituras; salida ausente también cero peticiones |
| Snapshot parcial o sin count | Cero escrituras |
| Primer PUT confirmado y respuesta perdida | **Un objeto restante, “sin escrituras”/estado final true: RBG-03** |
| Primer PUT sin commit | Cero objetos; mismo tratamiento sin reconciliación |

Son 16 escenarios de diagnóstico, no 16 éxitos funcionales: el penúltimo está diseñado para demostrar el defecto actual.

## Precisiones documentales sin bloqueo para A

El plan v2 incorpora los cierres y la lectura completa, pero su §4 conserva el párrafo histórico “la lógica de fila→relectura→limpieza no tiene todavía un doble”. Ya hay 19 casos del núcleo y este diagnóstico del CLI: actualizar/acotar ese texto al límite real, sin hacer un push solo por esa precisión.

En limpieza manual no usar título como autorización de borrado: el id previsto es la identidad; el título solo sirve como contexto. El alcance de “administrable/borrable” se acota correctamente al reconocimiento del módulo puro y cleanup, sin una UI recompilada.

Para autorizar A, describir exactamente una fila ficticia y su INSERT/PATCH/DELETE en staging. B añade cuatro PUT/dos grupos y su borrado; corregir RBG-03 antes de pedir/ejecutar ese alcance. Ningún modo retira Function/binding, cambia variables, migra negocio o requiere commit/push.

## Evidencia y estado

Nueva carpeta `.codex/evidencia-revision-rollback-galeria-v2/`: `diagnostico-cli.json` y `diagnostico-cli.txt`. Solo datos/credenciales ficticios; las URLs/ref de infraestructura son públicos. No se editaron plan, código, runbook, tests o informes anteriores.

SHA-256:

- CLI: `6872d225275d1f385a3a9a1fddc1c9802c25e25a4a4e8c727a33687ec1387f90`.
- Núcleo: `3ad78c4a4eb225d7a02ff2bc32e2090c559b9204a3d5f52bd31616e14b9f3f03`.
- Suite: `6b8cbca97a0533c3ce1aa45a49f712c0e0fe33bc7a9199d057b09db6245a5f47`.

HEAD/main locales conservan `7ee3c78ea6c1fcba3a6be2f89e4045b6507ab536` / `0dc629e430ed07eeaccec273d31de93e9717d9bf`; no hice fetch. La Fase 3 completa y producción permanecen sin aprobar.
