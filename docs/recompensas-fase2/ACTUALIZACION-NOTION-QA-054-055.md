# Texto preparado para Notion — QA-054 y QA-055 (NO escrito en Notion)

El conector de Notion no estaba disponible en esta sesión: las fichas **no se actualizaron**. Pegar lo siguiente y pasar **Estado = Re-test** (nunca Verificado) cuando se pueda. Commit: ver `git log` (mensaje «QA-054/QA-055…»).

## QA-054 — Estado: Re-test
- **Archivos:** `supabase/migrations/20261005000002_cupones_validacion_pedido.sql`, `src/pages/cliente/CarritoCliente.jsx`, `tests/e2e/recompensas-pedido-cupon.test.mjs`, `tests/e2e/ensayo-ui/qa-054-cupon-pedido.ensayo.spec.mjs`, `tests/e2e/ensayo-preparar-cupon.mjs`, `tests/e2e/qa-054-rojo.mjs`, `docs/recompensas-fase2/PROTECCION-CUPONES.md`.
- **Reproducción (rojo):** `node tests/e2e/qa-054-rojo.mjs` → con las definiciones anteriores el pedido se crea con total anunciado S/40 y «Verificar pago» lo rechaza.
- **Corrección:** evaluación única del cupón (`recompensas_evaluar_cupon`) compartida por confirmar_venta, confirmar_pedido_productos y la vista previa de solo lectura `vista_previa_cupon_pedido`; el checkout valida en el servidor y no muestra descuento ni total pagable mientras valida / si se rechaza / si falla; verificar_pago_pedido_web conserva la revalidación y declara CONFLICTO si cambian precios, costos o protección.
- **Resultados:** SQL `recompensas-pedido-cupon.test.mjs` 14/14; HTTP/UI con sesiones reales en la instancia desechable 8/8; todas las pruebas Node del repo 220/220.
- **Límites:** HTTP/UI ejecutados solo en la instancia desechable (no en la suite de QA: sin `QA_TEST_PASSWORD`); la suite completa de Playwright no se ejecutó; el rojo por interfaz se demostró con la reproducción de Codex y con el rojo SQL, no con una ejecución UI contra el código anterior.

## QA-055 — Estado: Re-test
- **Archivos:** `tests/e2e/qa-033-ventas-roles.spec.mjs` (costo S/5), `tests/e2e/qa-autorizacion-ampliada.spec.mjs` (costo S/5), `tests/e2e/qa-cobertura-adicional.spec.mjs` (25 % del precio).
- **Cambio:** solo los datos propios de cada ejecución; sin confirmar costos en bloque ni desactivar la validación; aserciones intactas. `helpers.mjs createProduct` no se tocó (costo 0 conservado para finanzas; no se vende con cupón).
- **Límites:** no ejecutado (requiere `QA_TEST_PASSWORD`); QA-033, QA-041 y regresiones relacionadas pendientes de ejecución con la contraseña.
