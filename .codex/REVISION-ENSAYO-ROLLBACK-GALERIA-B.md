# Revisión del ensayo real de rollback de Galería, alcance B

10 de octubre de 2026, America/Lima. Codex, QA. Evidencia de ejecución de Claude auditada y comprobaciones independientes actuales de lectura. No repetí INSERT/PATCH/DELETE/PUT, no hice commit/push ni cambié configuración, Function, binding o variables.

## Veredicto

**Aprobado el ensayo B para el alcance de staging revisado: 20/20 casos correctos, completo, estado final confirmado y sin pendientes.** Queda cerrada esta comprobación acotada de rollback de URLs de Galería Pages→r2.dev. El alcance A está incluido; no hace falta ejecutarlo aparte.

Sin hallazgos bloqueantes nuevos. Se conservan los cierres de RBG-01/RBG-02/RBG-03. **La Fase 3 completa, migración inversa general y producción continúan pendientes.** No se autorizan nuevos commits/pushes por este veredicto.

## Evidencia y fuentes

Informe original `.codex/evidencia-rollback-galeria/ensayo-B.json`, corrida `232ebb`, fecha registrada `2026-10-10T21:48:28.963Z`, marca `7ee3c78e`, alias aprobado y conObjetos=true.

Verifiqué que hay 20 casos efectivamente registrados, todos con ok=true, y resumen 20/0. Completa/estadoFinalConfirmado son true; error null; pendientes vacíos; creación intentada/confirmada true. Las fuentes CLI, núcleo y adaptadores conservan exactamente los hashes aprobados en V3. No repetí las suites 25/25, 48/48 o lint, porque esas fuentes no cambiaron.

El preflight se ejecuta antes de Auth por el código del CLI y se imprime fuera de los casos del núcleo; el JSON de 20 casos no guarda una traza adicional de ese preflight. Corroboré la marca/configuración/SW actuales de forma independiente. No afirmo haber presenciado el preflight o los 20 pasos originales ni haber reproducido la escritura.

## Resultado acotado del rollback

- Snapshot inicial registrado: una fila de Galería y cero claves en fotos-galeria, con cardinalidad verificada por el lector count=exact revisado.
- Cuatro PUT 201: dos grupos ficticios, variantes m/g. La fila UUID `2dfb468d-0388-42a3-8383-3dcc2eaea790` se crea con título propio, activo=false, orden=9999 y las URLs Pages previstas; relectura por id correcta.
- Reconocimiento del módulo puro: antes funciona con las bases de transición y no con solo-r2.dev. Dos fotos de detalle **g** por Pages retornan bytes exactos según el comparador de contenido del núcleo aprobado.
- Conversión preserve destino/UUID/variante. PATCH filtra id/título y registra exactamente una fila; después se registran las URLs r2.dev esperadas con id/título/orden/activo conservados. Las otras filas permanecen iguales al snapshot.
- Las dos fotos **g** de la fila retornan 200 image/webp con bytes exactos por r2.dev; Pages sigue sirviendo el objeto. Esto no retira la Function ni prueba un frontend recompilado a r2.dev.
- Limpieza de fila: DELETE 204 y ausencia confirmada por relectura. Solo después, dos DELETE de grupos 200; inventario igual al inicial, sin pendientes/errores, y snapshot igual.

El JSON conserva resultados y metadata antes/después, no bytes originales o sus hashes, ni el snapshot íntegro. La auditoría contrasta las condiciones del código aprobado y añade lecturas actuales; no transforma esos resultados en una captura independiente de toda la ejecución. Este ensayo comprueba entrega de las dos URLs g; no se afirma comparación de bytes de las cuatro variantes en este tramo.

## Comprobación independiente de Codex

**17 controles, cero fallos**, a `2026-10-10T21:52:30.263Z`:

- Recuento/resultado, correspondencia de fila antes/después, conversión de bases con el módulo puro real, PATCH y limpieza documentados, y hashes de las tres fuentes aprobadas.
- Alias actual: marca 7ee3c78e, entrega Pages por rol, SW SHA-256 `2a43dbc12adb80f8dcc8afef850c1c65f91691783e3b8c2aa878f8060650ce7e`, idéntico al B2 corroborado en la revisión PWA.
- Galería actual leída con count=exact y cardinalidad completa: única fila antigua `4ab5c994-9bb1-40bf-b5ff-186d45603781`, “Foto de prueba (Inicio)”; la fila/título de la corrida no existen.
- Inventario estricto de fotos-galeria: **cero claves**, sin respuesta parcial ni cursor.
- Las cuatro variantes de los dos grupos usados por el ensayo responden **404 en r2.dev**.
- Las dos fotos g en Pages todavía responden **200 HIT**, coherente con el TTL vigente. No se confundió una copia retenida con un objeto existente en R2.

Se utilizó una sesión QA existente de staging para las lecturas protegidas: **único POST a Auth**, seguido de GET de archivos públicos, REST e inventario con lista de orígenes aprobados y redirecciones rechazadas. No se usó SQL, cadena de BD, service_role, usuarios del negocio o endpoints de producción. Claves/contraseña/token permanecieron en memoria y no se imprimieron/guardaron.

Las lecturas actuales corroboran la limpieza del estado de datos/almacenamiento; no son una nueva prueba de entrega positiva antes del borrado. El HIT retenido no bloquea esta aprobación, pues la purga no formaba parte del ensayo y sigue pendiente por separado. No esperé ni forcé expiración/purga para perseguir un 404 de Pages.

## Paquete local para un posible commit agrupado

El estado leído permite preparar una lista explícita de **10 archivos candidatos**, sin modificar Git:

1. scripts/ensayo-rollback-galeria-pages.cjs
2. scripts/lib/ensayo-rollback.cjs
3. scripts/lib/ensayo-rollback-reales.cjs
4. scripts/verificar-ensayo-rollback-galeria.cjs
5. scripts/lib/guardas-interfaz-r2.cjs
6. scripts/verificar-guardas-interfaz-r2.cjs
7. docs/evidencia-rendimiento/fase-3/PLAN-ROLLBACK-GALERIA-PAGES.md
8. docs/evidencia-rendimiento/fase-3/clon-limpio-c892370.json
9. docs/evidencia-rendimiento/fase-3/clon-limpio-7ee3c78.json
10. docs/evidencia-rendimiento/fase-3/R2-REAL-RUNBOOK.md

Son siete archivos nuevos y tres modificados en el estado actual. Preparar/revisar el listado no autoriza commit/push. Mantener `.codex` (corridas, auditorías y capturas) y `.env*` excluidos de ese paquete. Antes del push autorizado a feat/cloudflare-pages, Claude debe validar el commit exacto desde checkout limpio y revisar la salida/identidad del nuevo build.

Agrupar notas útiles y no crear otro push solo para archivar una última corrida. Esta evidencia permanece atribuida a 7ee3c78e aunque un commit de scripts/documentación reconstruya el alias. No cambia la aplicación, pero el futuro build aún debe comprobarse; no se le atribuye este 20/20 retrospectivamente.

## Estado y pendientes

HEAD/main locales conservan `7ee3c78ea6c1fcba3a6be2f89e4045b6507ab536` / `0dc629e430ed07eeaccec273d31de93e9717d9bf`. No hice fetch ni una nueva inspección del panel de producción o del sitio GitHub Pages. El único acceso remoto de Codex fue el de lectura descrito.

El ensayo cierra **URLs de Galería**, no una migración inversa de todas las referencias r2: del negocio. Siguen pendientes purga/contrato de retirada, CPU/cuota, fotos reales, Firefox/Safari/móvil, carga/concurrencia, operación destructiva/programación del recolector y migración inversa general. El dominio propio sigue opcional futuro; no se exige para esta entrega por Pages.

## Informe y evidencia nuevos

`.codex/evidencia-revision-ensayo-rollback-real/`: `revision-evidencia.json` (17 controles, hashes y lecturas actuales) y `verificar-evidencia.txt` (diagnóstico externo). El JSON original del ensayo, runbook, plan, código e informes anteriores no se sobrescribieron.

Hashes revisados:

- CLI: `0654428e0a2cc915ecca08d401a0ea4c0cfbe4879d1ad5f25c489cad62122064`.
- Núcleo: `52c79c7b52dd1bdb866a068f02dcc9bdedfaa5431a2d35908b56e1e2d64b843d`.
- Adaptadores: `92c0728d318491f1764b4002f33e46f6762e7e6d992a7e1ea03cd26e41c86f6f`.
