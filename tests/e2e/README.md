# Suite QA/E2E local — rama testing

Esta suite usa la excepción explícita del usuario a AGENTS.md: permite únicamente archivos de tests, fixtures, configuración de Playwright y documentación. No modifica la aplicación, dependencias, archivos .env ni esquema. La suite define 91 casos (incluye `qa-025-029.spec.mjs` y `qa-031-032.spec.mjs`, regresión de QA-025 a QA-032); el informe vigente es CAMPANA-AMPLIADA.md y la entrega para correcciones es ENTREGA-CLAUDE.md. BASELINE-20260930.md conserva los 23 casos anteriores. Los estados de incidencias se tomaron de Notion al comenzar y se contrastan con la aplicación, Verificado significa que el usuario comprobó el defecto manualmente; no significa que esté corregido.

## Ejecutar

Antes de ejecutar, define la contraseña de las cuentas QA locales en el entorno del proceso (no se versiona):
`$env:QA_TEST_PASSWORD='<contraseña de las cuentas ficticias>'` (PowerShell) o `export QA_TEST_PASSWORD=...` (bash).

Desde C:/WedJaiseReact, con la rama testing activa, Vite ya ejecutándose en http://localhost:5173 y Supabase Local en http://127.0.0.1:54321:

```powershell
node node_modules/playwright/cli.js test --config=playwright.qa.config.mjs
node tests/e2e/archive-run.mjs nuevo-corte
node tests/e2e/report-campaign.mjs
```

No usar npx para instalar herramientas. Se reutilizan playwright/test y Chromium ya instalados. No se cambió package.json ni el lockfile. Para listar los casos sin crear datos:

```powershell
node node_modules/playwright/cli.js test --config=playwright.qa.config.mjs --list
```

El aprovisionamiento necesita acceso al contenedor Docker local supabase_kong_WedJaiseReact. Alternativamente puede entregarse QA_LOCAL_SERVICE_ROLE_KEY en el entorno del proceso, sin editar .env. La clave se mantiene en memoria, nunca se imprime ni se entrega al navegador. Si Docker o la clave no están disponibles, la preparación falla y no se declara que los tests hayan pasado.

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

Los casos conocidos sin corrección confirmada usan test.fail() justo antes de verificar el resultado correcto esperado, una vez cumplidas sus precondiciones. La lista explícita expectedFailureIDs es independiente de los estados de Notion, incluido Verificado (defecto confirmado manualmente por el usuario). Una aserción fallida esperada significa **incidencia reproducida**, no funcionalidad aprobada ni problema corregido. Playwright puede incluir fallos esperados en passed: CAMPANA-AMPLIADA.md separa aprobados reales e incidencias reproducidas, con la fuente original de cada caso. fixtures/issue-status.mjs conserva el snapshot inicial y no representa el estado más reciente tras las notas de auditoría.

Si una aserción esperada deja de fallar, Playwright señala un unexpected pass. Eso exige revisión/re-test; no marca la incidencia Verificada en Notion. Si falla la preparación, un selector, una acción o aparece un error diferente al registrado, se conserva como fallo inesperado. Los tests no sustituyen las respuestas de backend por éxitos falsos.

QA-004 utiliza una interrupción controlada: espera que el DELETE real de líneas de cita termine, retiene y aborta el POST de reemplazo y recarga. Comprueba la integridad tras interrumpir el guardado; no mide la frecuencia del problema en una red normal. No llama manualmente a DELETE/INSERT: los emite la propia UI.

QA-009 utiliza una captura generada en memoria, con nombre NO-PAGO, como comprobante ficticio. No se hace ningún pago real. El test comprueba la verificación administrativa y persistencia del pedido, pero el fallo conocido bloquea estados posteriores.

El POS usa un producto independiente de stock 10: vende 3, comprueba 7, anula y comprueba 10 después de recargar. La impresión automática es esperada. Se recarga tras confirmar sin volver a vender; el contenido imprimible y un PDF diagnóstico de Chromium sí se comprobaron en la ampliación; no se validó el diálogo del sistema ni la impresora. Para localizar la venta se usa el código completo VENxxx como alternativa UI: el código visible Vxxx no se encuentra, incidencia conocida QA-013 registrada en Notion. Su regresión es un caso independiente, no una corrección de aplicación.

## Artefactos

El informe combina las cinco fuentes durables listadas en campaign-summary.json: 77 escenarios distintos, 58 aprobados funcionalmente y 19 casos de incidencias reproducidas (18 IDs). Esta ampliación ejecutó 15 escenarios nuevos: 11 aprobados y 4 incidencias nuevas reproducidas. No se volvió a ejecutar todo el corte anterior. Para regenerar exactamente este corte:

```powershell
node tests/e2e/report-campaign.mjs tests/e2e/results/phases/final/report.json tests/e2e/results/phases/profile-confirmation-final/report.json tests/e2e/results/phases/phase2-final/report.json tests/e2e/results/phases/phase2-confirmation-final/report.json tests/e2e/results/phases/phase2-reservation-final/report.json
```

Las salidas originales conservan las expectativas del runner de cada ejecución; el informe distingue el comportamiento funcional de esas expectativas. Se ajustó únicamente la suite a la aclaración sobre Verificado, sin corregir aplicación ni incidencias.

- CAMPANA-AMPLIADA.md: resumen legible de la campaña ampliada.
- RESULTADOS.md y BASELINE-20260930.md: corte histórico de los 23 casos anteriores.
- ENTREGA-CLAUDE.md: criterios de interpretación, corrección y re-test.
- results/results.json: resultados originales de Playwright, estado esperado/obtenido y anexos.
- results/html/index.html: informe HTML.
- artifacts/: capturas y diagnósticos de consola/HTTP; sólo ruta, método y estado HTTP, sin headers ni cuerpo de autenticación.
- results/*-attempt.json: ejecuciones de preparación conservadas durante la creación de esta suite.

No se guardan HAR, storageState, vídeos ni traces porque pueden incluir tokens. Los screenshots finales y anexos de RPC de negocio contienen datos ficticios locales.

## Alcance y brechas

77 casos: los 23 iniciales más matriz completa de rutas por rol, obligatorios de ocho módulos, permisos de botones y rechazo backend de crear servicio por ASISTENTE, CRUD de clientes/direcciones/productos/servicios/fichas de personal/mobiliario/deudas/gastos/promociones, cita normal, búsquedas vacías, límites de formularios, reposición de stock, carrito, cambio/restauración de contraseña QA y QA-014/QA-015. La segunda ampliación añade reserva CLIENTE completa con recarga, comisión ADMIN/cancelación y ASISTENTE sin porcentaje, emisión de fidelización y fallo de canje QA-019, delivery pendiente/cancelado, galería/imágenes, CSV, PDF, última unidad/doble clic y accesibilidad QA-016/017/018. Son controles representativos, no automatización completa de todos los estados y variantes de cada módulo.

Quedan pendientes: entrega del pedido y reseña de compra válida por QA-009; canje de fidelización y reversión por QA-019; porcentaje ASISTENTE asignado (sin precondición TEST, no se cambia configuración); referidos; todas las variantes de cupones, compras/garantías, notificaciones, expiración real de sesión, cámara física, diálogo de impresión/papel, estrés, lectores de pantalla y accesibilidad completa, otros navegadores/dispositivos. No se guardan ajustes ni se fuerza una corrección para desbloquear una prueba.

Los selectores de calendario de QA-004 cubren el cambio de mes dentro del mismo año. El cambio de año requiere ampliar el flujo de navegación antes de ejecutar ese escenario a finales de diciembre. El cupón requiere que la promoción TEST de esta ejecución sea la primera según vigencia; si otra promoción vigente tiene prioridad, el caso queda bloqueado como preparación y no se modifica esa promoción ajena.

Referencias de implementación del harness: [anotaciones Playwright](https://playwright.dev/docs/test-annotations) y [aprovisionamiento Auth administrativo](https://supabase.com/docs/reference/javascript/auth-admin-createuser). La implementación instalada también se inspeccionó en modo lectura.

## Ejecutar sólo la segunda ampliación

Con el manifest local aislado de este corte (productos/servicio/venta base ya preparados), se permite reutilizarlo porque los casos nuevos crean sus propios registros TEST. No reutilizarlo indiscriminadamente en todos los escenarios iniciales.

```powershell
$env:QA_REUSE_FIXTURES='1'
node node_modules/playwright/cli.js test --config=playwright.qa.config.mjs --grep 'AMPLIACIÓN'
node tests/e2e/archive-run.mjs phase2-retest
```

Los dos casos finales se repitieron después de ajustar sólo sincronización del test; sus resultados posteriores sustituyen los anteriores por título. index.json preserva correspondencia entre casos y PNG/JSON/TXT/PDF. Los errores del propio harness no se registran como defectos de aplicación.

La comprobación final de reserva (results/phases/phase2-reservation-final) también exige que vuelva a estar disponible el horario reprogramado después de cancelar, además del horario inicial. Se aprobó; sustituye el resultado anterior de ese caso sin aumentar el conteo.
