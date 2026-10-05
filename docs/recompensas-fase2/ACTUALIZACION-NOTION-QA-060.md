# Texto preparado para Notion — QA-060 y preparación de QA-005 (NO escrito en Notion)

El conector de Notion no estaba disponible en esta sesión: la ficha **no se actualizó**. Pegar lo siguiente y pasar QA-060 a **Re-test** (nunca Verificado). QA-056 a QA-059 siguen Verificado; no se tocan.

Historial que se conserva (Codex): 36 aprobadas y 2 fallos de 38; la repetición aislada de AMPLIACIÓN CANJE pasó.

## QA-060 — sincronización de readCoupon — Estado: Re-test
- **Causa comprobada (arnés, no backend):** `readCoupon` armaba `waitForResponse(mis_cupones)`, navegaba a `/ofertas` y solo después leía el cuerpo. Una respuesta de la carga ANTERIOR que llega en ese intervalo satisface la espera; al navegar, su cuerpo deja de existir. Reproducido de forma determinista en un Chromium real con un origen ficticio (`colector-respuestas-navegador.test.mjs`): el patrón anterior devuelve la respuesta de la carga 1 en lugar de la 2, y leer ese cuerpo quedó colgado ~90 s y terminó en «Page crashed» (en la suite, Codex vio «No resource with given identifier found»).
- **Corrección:** `cuerpoDeLaCarga(page, coincide)` (en `tests/e2e/colector-respuestas.mjs`): se arma antes de navegar, solo acepta peticiones emitidas después de que el marco principal se comprometió con el documento nuevo (`framenavigated`) y empieza a leer el cuerpo en el mismo evento `response`. Si el cuerpo no está disponible o no llega respuesta, falla con un error saneado (no se silencia). Aplicado a los tres lectores de `mis_cupones` de `phase2-flows.spec.mjs` (incluido `readCoupon`). Las aserciones CANJEADO tras vender y DISPONIBLE tras anular no cambian. Sin sleeps, reintentos, `first()` nuevos ni fallos esperados nuevos.
- **Pruebas del arnés (no funcionales, sin sesión):** dobles en memoria 3 casos nuevos (`colector-respuestas.test.mjs`, 7 en total) y Chromium real 4 casos (`colector-respuestas-navegador.test.mjs`), ejecutados 3 veces seguidas sin fallos.
- **Límites:** AMPLIACIÓN CANJE (sesiones reales) no se ejecutó en esta sesión: falta `QA_TEST_PASSWORD`.

## Preparación de QA-005
- Comprobado el 2026-10-05 (hora de Lima): las cuatro promociones TEST antiguas siguen **activas y vigentes** (inicio vacío, vencen hoy):
  - `618854d9-8f7d-4f39-9878-15804da4f543` — TEST PW mus0eq08-m2w9o Promoción
  - `ccaf389e-114f-4e21-855b-1dbf9f409a38` — TEST PW muvlrok5-mgra3 Promoción
  - `5c2de485-4e3c-41b5-bd1c-36b14afd898f` — TEST PW muvowz00-qrnjd Promoción
  - `bb4e5e0c-8c7c-4386-a3e6-fb04232bdb95` — TEST PW muvqg7ly-buh4v Promoción Q005 muvqm83r43u
- **No se desactivaron**: el flujo normal de administración exige iniciar sesión y `QA_TEST_PASSWORD` no estaba disponible. Preparado `tests/e2e/qa-005-promociones-antiguas.mjs` (lista cerrada por ID y título; sin `--aplicar` solo informa; con `--aplicar` usa la interfaz de ADMINISTRADOR y comprueba que solo esas cuatro cambiaron). A partir del 2026-10-06 (Lima) dejan de estar vigentes por sí solas.
- El cierre global (`global-teardown.mjs`) además verifica, también cuando un caso falla, que no queda activa ninguna promoción de la corrida (título con su prefijo único).
- No se reabre el defecto SQL histórico de QA-005.
