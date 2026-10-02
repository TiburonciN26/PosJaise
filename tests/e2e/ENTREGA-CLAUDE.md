# Entrega QA para Claude Code

Codex sólo audita. Esta rama testing contiene tests, fixtures y documentos autorizados; no implementa correcciones de aplicación. Fuente vigente: CAMPANA-AMPLIADA.md, combinado desde las cinco fuentes de results/campaign-summary.json. Total: 77 escenarios distintos, 58 aprobados funcionalmente y 19 con incidencias reproducidas, correspondientes a 18 IDs. La segunda ampliación ejecutó 15 casos nuevos (11 aprobados y 4 defectos reproducidos); no se volvió a ejecutar todo el corte anterior. BASELINE-20260930.md conserva los resultados previos; no mezclar ambos cortes.

## Entorno y ejecución

Exclusivamente localhost:5173 con Supabase Local http://127.0.0.1:54321. La suite comprueba la rama testing y la URL efectiva de Supabase servida por Vite antes del aprovisionamiento y antes de cada test, y bloquea orígenes externos. No instalar dependencias ni editar .env para hacer pasar tests. El desarrollo ya debe estar ejecutándose. Se reutilizan Playwright y Chromium instalados.

```powershell
node node_modules/playwright/cli.js test --config=playwright.qa.config.mjs
node tests/e2e/archive-run.mjs nuevo-corte
node tests/e2e/report-campaign.mjs
```

Para ampliar un caso durante el desarrollo del test se admite QA_REUSE_FIXTURES=1 en el entorno del proceso, únicamente con el manifest TEST aislado completo. No es el modo de una campaña final: existen casos que requieren condiciones iniciales exactas. Cada ejecución completa prepara un CLIENTE nuevo y productos/servicio/promo aislados; las cuentas QA de personal existentes se mantienen. El alta Auth local es la única escritura directa administrativa; los datos de negocio se crean/modifican por UI. No se inyectan sesiones.

## Cómo interpretar y corregir

1. Abrir la incidencia existente en Notion; comprobar precondiciones, rol y alcance. Verificado en Notion significa que el usuario confirmó manualmente el defecto, no que Claude lo corrigió. Mantener ese significado y sus etiquetas; distinguir corrección confirmada mediante evidencia de re-test.
2. Ejecutar el caso aislado sobre una fixture apropiada; confirmar el resultado observado y la revisión de aplicación/DB en que se prueba. Los escenarios conocidos no se convierten en incidencias nuevas duplicadas.
3. Implementar la corrección fuera de la labor QA de Codex, conservando autorización y reglas de negocio existentes. No debilitar RLS ni cambiar la expectativa del negocio para que el test pase.
4. Una vez comprobada una corrección, retirar el ID de expectedFailureIDs en fixtures/issue-status.mjs. Las etiquetas de Notion no controlan esta lista. Conservar las aserciones saludables. Un unexpected pass de test.fail() es señal de re-test, no prueba automática de que todos los casos del defecto estén resueltos.
5. Ejecutar también casos relacionados y revisar red/consola. Documentar por separado la corrección y su re-test aprobado, sin reinterpretar el Verificado que el usuario emplea para defectos confirmados manualmente.

## Prioridad de revisión

- Integridad de citas e inventario: QA-004, QA-003, QA-012.
- Integraciones bloqueadas: QA-005 (reclamo promoción), QA-009 (verificación de pedido) y QA-019 (canje POS fidelización, error codigo ambiguo, independiente del id ambiguo de QA-005). Después de corregir, comprobar canje/reversión y entrega/reseña válida. La emisión por cinco fechas distintas sí pasó.
- Importes: QA-014, monto 12abc → 12, reproducido dos veces como CAJERA. Evidencia durable en results/phases/numeric-repro-1 y numeric-repro-2.
- Separación de vista y permisos UI: QA-001, QA-011. QA-001 no demuestra creación no autorizada; hay un test separado del rechazo de backend.
- Perfil con lectura lenta: QA-015. Editar se habilita antes de terminar la carga y deja Nombre vacío; sólo lectura, sin guardar ni pérdida de datos demostrada. Evidencia durable en results/phases/profile-load-1, profile-load-2 y profile-final.
- Contenido/validaciones/búsqueda: QA-006, QA-007, QA-008, QA-010, QA-013. Mantener distinción entre problemas de presentación y acceso/datos.

Notion: QA — Sistema Jaise Pos y Wed, https://app.notion.com/p/e46ae0a09e7649048333069ba79ebc09. No volver a registrar la impresión automática como un defecto: tras confirmar POS se recarga sin confirmar otra vez. La ampliación valida ticket/medios de impresión y PDF diagnóstico generado por Chromium, incluyendo extracción de texto y render visual. No valida el diálogo del sistema ni impresión física.

## Cobertura que aún necesita ampliar

Todas las rutas se revisan por rol, pero una redirección correcta no demuestra toda la autorización de acciones. El informe identifica CRUD y límites comprobados por módulo. Quedan pendientes: entrega del pedido y reseña de compra válida por QA-009; canje de fidelización y reversión por QA-019; porcentaje ASISTENTE asignado (sin precondición TEST, no se cambia configuración); referidos; todas las variantes de cupones, compras/garantías, notificaciones, expiración real de sesión, cámara física, diálogo de impresión/papel, estrés, lectores de pantalla y accesibilidad completa, otros navegadores/dispositivos. No inferir cobertura completa por haber abierto páginas.

## Evidencia y seguridad de los artefactos

Resultados JSON y capturas están ignorados por Git dentro de results/ y artifacts/. archive-run.mjs extrae capturas/diagnósticos incrustados por caso y preserva report.json e index.json para que sobrevivan a la siguiente ejecución. Se evitan HAR/traces/storageState y claves privilegiadas en documentos. Credenciales locales ficticias de personal en fixtures/accounts.mjs; nunca usar estas cuentas contra producción.

Se conservan registros TEST para reproducción. Los CRUD aprobados eliminan sus registros independientes por UI; datos de incidencias, citas canceladas, atenciones, pedido y productos del manifest pueden permanecer. La contraseña del cliente aislado se restaura al completar su test, la venta propia se anula y la promoción propia se desactiva al completar su caso. No hay limpieza masiva.

## Regenerar este informe y recuperar evidencia

```powershell
node tests/e2e/report-campaign.mjs tests/e2e/results/phases/final/report.json tests/e2e/results/phases/profile-confirmation-final/report.json tests/e2e/results/phases/phase2-final/report.json tests/e2e/results/phases/phase2-confirmation-final/report.json tests/e2e/results/phases/phase2-reservation-final/report.json
```

Cada carpeta durable incluye index.json con la correspondencia entre título de test y archivos PNG/JSON. Los resultados actuales de results/results.json y el HTML se reemplazan al ejecutar tests; no usarlos como si contuvieran siempre la campaña completa. Para identificar registros de negocio de este corte, consultar fixtures/runtime.json y el manifest preservado de runId mupts3sy-ecmf7. Sólo reutilizar fixtures con precondiciones apropiadas; para re-test completo preparar una ejecución nueva.

## Segunda ampliación terminada

Se aprobaron galería/imágenes y validaciones, CSV ADMIN y ocultación CAJERA, ticket/PDF, reserva CLIENTE con hora persistida/cancelación y disponibilidad, comisión ADMIN 100% S/2 y cancelación, ASISTENTE pendiente/rechazo sin porcentaje, cinco fechas distintas y cupón único, delivery dirección/costo/cancelación, última unidad y doble clic.

Incidencias nuevas Pendiente en Notion: QA-016 nombres accesibles de galería, QA-017 retorno del foco de producto, QA-018 foco/semántica de confirmación de pedido y QA-019 canje POS. Ninguna se corrigió. QA-019: S/2 −20%=S/1.60 visible, confirmación 400/42702; cupón sigue DISPONIBLE tras lectura UI posterior; venta/anulación no verificadas.

Evidencia: results/phases/phase2-final, phase2-confirmation-final y phase2-summary.json. El runner del primer lote dio 13 passed (incluye tres fallos esperados), un error de sincronización del test de canje y un caso no ejecutado. Tras ajustar sólo ese test, los dos casos restantes completaron: canje falló por QA-019 y comisión ADMIN pasó. El consolidado usa los resultados posteriores, no suma repeticiones ni cuenta passed esperado como éxito funcional. No se interpreta Verificado como corrección.

La comprobación final de reserva (results/phases/phase2-reservation-final) también exige que vuelva a estar disponible el horario reprogramado después de cancelar, además del horario inicial. Se aprobó; sustituye el resultado anterior de ese caso sin aumentar el conteo.
