# Suite QA/E2E local — rama testing

Esta suite usa la excepción explícita del usuario a AGENTS.md: permite únicamente archivos de tests, fixtures, configuración de Playwright y documentación. No modifica la aplicación, dependencias, archivos .env ni esquema. La suite Playwright define 213 casos en 31 archivos `*.spec.mjs` (corte 2026-10-04; QA-049 y los casos nuevos de `qa-catalogo-web` aún no se ejecutaron), más 14 archivos `node --test` de capa de datos/SQL, saneador y catálogo POS/Web (170 casos; ver «Dos capas»). COBERTURA.md lista lo cubierto y las brechas; no es cobertura total ni Fase 2 completa.

## Ejecutar

Antes de ejecutar, define la contraseña de las cuentas QA locales en el entorno del proceso (no se versiona):
`$env:QA_TEST_PASSWORD='<contraseña de las cuentas ficticias>'` (PowerShell) o `export QA_TEST_PASSWORD=...` (bash).

Desde C:/WedJaiseReact, con la rama testing activa, Vite ya ejecutándose en http://localhost:5173 y Supabase Local en http://127.0.0.1:54321:

```powershell
node node_modules/playwright/cli.js test --config=playwright.qa.config.mjs
node tests/e2e/sanear-salidas.mjs
node tests/e2e/archive-run.mjs nuevo-corte
node tests/e2e/report-campaign.mjs
```

No usar npx para instalar herramientas. Se reutilizan playwright/test y Chromium ya instalados. No se cambió package.json ni el lockfile. Para listar los casos sin crear datos:

```powershell
node node_modules/playwright/cli.js test --config=playwright.qa.config.mjs --list
```

El aprovisionamiento necesita acceso al contenedor Docker local supabase_kong_WedJaiseReact. Alternativamente puede entregarse QA_LOCAL_SERVICE_ROLE_KEY en el entorno del proceso, sin editar .env. La clave se mantiene en memoria, nunca se imprime ni se entrega al navegador. Si Docker o la clave no están disponibles, la preparación falla y no se declara que los tests hayan pasado.

## Dos capas de pruebas (no se mezclan)

- **Playwright (`*.spec.mjs`)**: interfaz real con sesiones iniciadas por el formulario. Requiere `QA_TEST_PASSWORD`, Vite y Supabase Local.
- **`node --test` (`*.test.mjs`)**: capa de datos/SQL contra Supabase Local (Recompensas Fase 2, QA-043 a QA-047). Usan claims simulados
  (`request.jwt.claims` + `set role authenticated`): **no son sesiones HTTP ni evidencia de interfaz**. Se ejecutan en serie:
  `node --test --test-concurrency=1 tests/e2e/*.test.mjs` (con la rama `testing` y Vite activos; no necesitan la contraseña).

## Higiene de salidas (secretos)

Playwright escribe `error-context.md` (snapshot de accesibilidad) al fallar un caso; si ocurre con el login lleno puede incluir el valor
del campo Contraseña. Antes de archivar o publicar evidencia se ejecuta `node tests/e2e/sanear-salidas.mjs` (redacta ese valor sin
imprimirlo; `archive-run.mjs` también lo ejecuta). Solo cubre archivos de texto: las capturas PNG enmascaran el campo, pero una captura
de un login fallido debe revisarse antes de publicarla. `artifacts/`, `results/` y `fixtures/runtime.json` están ignorados por Git.

## Guardas e aislamiento

- Se exige la rama testing y se lee la URL efectiva del módulo Supabase servido por Vite. Cualquier URL distinta de http://127.0.0.1:54321 impide la preparación y ejecución.
- Se bloquean solicitudes HTTP(S) del navegador a orígenes distintos de localhost:5173 y 127.0.0.1:54321. No se siguen redirecciones en el aprovisionamiento Auth.
- ADMINISTRADOR, CAJERA y ASISTENTE usan las cuentas ficticias QA existentes. Cada ejecución crea un CLIENTE ficticio separado, con email @test.local y prefijo TEST PW único, mediante la excepción de aprovisionamiento QA local de AGENTS.md. No se inventan roles.
- El perfil del cliente, tres productos, servicio, promoción, cita, atenciones, pedido y venta se preparan/manipulan por UI. No hay SQL de escritura ni llamadas API directas para crear datos de negocio.
- Los logins se hacen con el formulario web; no se inyectan sesiones ni storageState. Cada test tiene un contexto nuevo. Los casos de roles incluyen logout y comprobación posterior sin sesión.
- Sólo el alta Auth usa el endpoint administrativo local. No se cambia ninguna cuenta existente, permisos, porcentaje ni configuración.
- Los datos TEST se conservan para reproducir fallos. No hay reset ni limpieza masiva. El teléfono del cliente aislado se restaura por UI, la promoción de esta ejecución se desactiva por UI después del test de cupón, y la venta POS se anula por UI cuando el flujo completa.
- Los identificadores se guardan en fixtures/runtime.json y results/fixtures/<runId>.json, ignorados por Git. No contienen claves privilegiadas ni tokens.

## Interpretar resultados

La lista `expectedFailureIDs` (`fixtures/issue-status.mjs`) es **explícita** y no se deriva de los estados de Notion: contiene solo los defectos conocidos sin corrección (hoy vacía; ningún caso se oculta con ella). Esos casos usan `test.fail()` justo antes de verificar el comportamiento correcto; un fallo esperado significa **incidencia reproducida**, no funcionalidad aprobada, y Playwright lo cuenta en `expected`. `issueStatus` solo rotula los informes con el estado de Notion (ver la cabecera de `fixtures/issue-status.mjs` para la fecha y el alcance de cada rótulo; no se sincronizó en bloque). «Verificado» en Notion es una marca de revisión del propietario y no controla ninguna expectativa de la suite. Un `expectedFailureIDs` vacío no significa que todas las incidencias estén resueltas.

Si una aserción esperada deja de fallar, Playwright señala un unexpected pass: eso exige re-test y retirar el ID de la lista tras una pasada sana. Si falla la preparación, un selector o aparece un error distinto, se conserva como fallo inesperado. Los tests no sustituyen respuestas de backend por éxitos falsos. Un caso omitido (`skipped`) no cuenta como aprobado.

Preparación independiente: cada caso crea sus propios datos con nombres y códigos únicos (`sufijoUnico`, `nombreUnico`); no hay que desactivar nada a mano. QA-005 crea su propia promoción y desactiva la de la preparación global (la que ya desactivaba) y falla con un mensaje de precondición si otra promoción vigente de un tercero le antecede. Las ejecuciones parciales o fallidas pueden dejar promociones TEST activas que vencen hoy: la precondición de QA-005 lo detecta y falla con un mensaje claro (es un error de preparación, no del producto); hay que desactivar esas promociones sobrantes (solo registros `TEST …` de Local) antes de repetir.

QA-004 utiliza una interrupción controlada: espera que el DELETE real de líneas de cita termine, retiene y aborta el POST de reemplazo y recarga. Comprueba la integridad tras interrumpir el guardado; no mide la frecuencia del problema en una red normal. No llama manualmente a DELETE/INSERT: los emite la propia UI.

QA-009 utiliza una captura generada en memoria, con nombre NO-PAGO, como comprobante ficticio. No se hace ningún pago real. El test comprueba la verificación administrativa y persistencia del pedido, pero el fallo conocido bloquea estados posteriores.

El POS usa un producto independiente de stock 10: vende 3, comprueba 7, anula y comprueba 10 después de recargar. La impresión automática es esperada. Se recarga tras confirmar sin volver a vender; el contenido imprimible y un PDF diagnóstico de Chromium sí se comprobaron en la ampliación; no se validó el diálogo del sistema ni la impresora. Para localizar la venta se usa el código completo VENxxx como alternativa UI: el código visible Vxxx no se encuentra, incidencia conocida QA-013 registrada en Notion. Su regresión es un caso independiente, no una corrección de aplicación.

## Artefactos

Los informes generados (CAMPANA-AMPLIADA.md, RESULTADOS.md, BASELINE-*.md, RENDIMIENTO-*.md) son salidas históricas de las primeras campañas, están ignorados por Git y **no describen el estado actual**. La referencia vigente es COBERTURA.md (matriz) y `archive-run.mjs` (evidencia de cada regresión archivada en `results/phases/<corte>`).

- COBERTURA.md: matriz de cobertura y brechas (documento vigente).
- CAMPANA-AMPLIADA.md, RESULTADOS.md y BASELINE-20260930.md: informes generados por campañas anteriores (históricos, ignorados por Git).
- ENTREGA-CLAUDE.md: criterios de interpretación, corrección y re-test.
- results/results.json: resultados originales de Playwright, estado esperado/obtenido y anexos.
- results/html/index.html: informe HTML.
- artifacts/: capturas y diagnósticos de consola/HTTP; sólo ruta, método y estado HTTP, sin headers ni cuerpo de autenticación.
- results/*-attempt.json: ejecuciones de preparación conservadas durante la creación de esta suite.

No se guardan HAR, storageState, vídeos ni traces porque pueden incluir tokens. Los screenshots finales y anexos de RPC de negocio contienen datos ficticios locales.

## Alcance y brechas

Ver COBERTURA.md. Las brechas conocidas más importantes: matriz exhaustiva de autorización por tabla y Storage, expiración natural del token de sesión, cupones en concurrencia distintos de los de referido, decisión de negocio sobre pedidos ENTREGADOS cuya venta se anula, delivery con cupón por UI, accesibilidad completa y lectores de pantalla, otros navegadores/dispositivos y rendimiento en teléfono físico. Los selectores de calendario de QA-004 cubren el cambio de mes dentro del mismo año.

Referencias de implementación del harness: [anotaciones Playwright](https://playwright.dev/docs/test-annotations) y [aprovisionamiento Auth administrativo](https://supabase.com/docs/reference/javascript/auth-admin-createuser). La implementación instalada también se inspeccionó en modo lectura.
