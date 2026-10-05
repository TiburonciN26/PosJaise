# Texto preparado para Notion — QA-056, QA-057, QA-058, QA-059 y preparación de QA-005 (NO escrito en Notion)

El conector de Notion no estaba disponible en esta sesión: las fichas **no se actualizaron**. Pegar lo siguiente y pasar a **Re-test** (nunca Verificado). QA-054 y QA-055 siguen Verificado y no se reabren. Commit: el del mensaje «QA-056…QA-059» en `testing`.

Historial que se conserva (corrida anterior de Codex): 206 aprobados, 3 fallos del arnés, 1 omisión conocida, 4 casos no ejecutados; QA-057 reproducido fuera de esos 214 casos.

## QA-057 — Estado: Re-test (prioridad)
- **Archivos:** `supabase/migrations/20261005000003_pedido_cantidades_total_anunciado.sql`, `src/pages/cliente/CarritoCliente.jsx`, `tests/e2e/ensayo-ui/qa-057-carrito-carrera.ensayo.spec.mjs`, `tests/e2e/ensayo-ui/carrito.mjs`, `tests/e2e/ensayo-preparar-cupon.mjs`, `tests/e2e/recompensas-pedido-cupon.test.mjs`, `tests/e2e/recompensas-fase2-helpers.mjs`.
- **Interfaz:** la validación se identifica por productos + cantidades + precios (firma); una respuesta de otra firma (vieja o tardía) se descarta. Con guardados del carrito en curso no se valida, no hay importe pagable y el CTA está bloqueado. Los PATCH van en cola y se comprueba su resultado (cantidad devuelta); si fallan se muestra «No pudimos guardar el cambio de cantidad…», se recarga lo guardado y solo eso se revalida. La vista previa recibe las cantidades vistas y se rechaza si no coinciden con las guardadas o si el subtotal difiere.
- **Servidor:** `confirmar_pedido_productos` recibe `p_cantidades` y `p_total_esperado` (la interfaz siempre los envía) y rechaza sin pedido ni escrituras parciales si lo guardado o el total recalculado (precios, descuento y protección del servidor) no son los anunciados: «Tu carrito cambió mientras confirmabas…» / «El total cambió: ahora es S/ X y no S/ Y…». Nunca corrige el importe en silencio. Opcionales para otros llamadores (nulos = sin comprobación).
- **Rojo (código anterior, ensayo):** carrera de Codex → la UI anunciaba «(S/ 90.00)» con el PATCH retenido; cambio de precio → el servidor aceptaba un total distinto del anunciado; PATCH fallido → sin recuperación. 3 fallos.
- **Verde:** ensayo con sesiones reales `qa-057` 5/5 (carrera con ambas respuestas retenidas, cambios rápidos, PATCH fallido, respuesta tardía, cambio de precio) dos veces seguidas, más `qa-054` 8/8; SQL (claims simulados, no E2E) 5 casos nuevos; capa Node completa 229/229.
- **Límites:** HTTP/UI solo en la instancia desechable; la suite de QA no se ejecutó (sin `QA_TEST_PASSWORD`).

## QA-056 — Estado: Re-test
- **Archivo:** `playwright.qa.config.mjs` (`testIgnore` de `ensayo-ui/**`, `*.ensayo.spec.mjs`, `*.ensayo.mjs`).
- **Inventarios:** `--list` QA → 214 casos en 31 archivos, ninguno de ensayo, sin pedir ENSAYO_PASSWORD (para listar se definió `QA_TEST_PASSWORD` con un valor ficticio solo en el proceso: `fixtures/accounts.mjs` exige la variable al importar; no se inició sesión). `--list` ensayo → 29 casos en 6 archivos (5273/56321). Ningún caso eliminado ni guarda debilitada.

## QA-058 — Estado: Re-test
- **Archivos:** `tests/e2e/colector-respuestas.mjs` (nuevo), `tests/e2e/colector-respuestas.test.mjs` (nuevo, 4 casos en memoria ante navegación), `tests/e2e/phase2-flows.spec.mjs` (usa el colector y lo retira con `detener()` antes de adjuntar).
- Los cuerpos no disponibles se registran saneados (`{ ok:false, motivo }`), sin promesas rechazadas sin manejar; aserciones de comisión pendiente intactas.
- **Límites:** el escenario funcional de `phase2-flows` no se ejecutó (sin `QA_TEST_PASSWORD`).

## QA-059 — Estado: Re-test
- **Archivo:** `tests/e2e/qa-recompensas-fase2-portal.spec.mjs` (solo la expectativa del aviso: texto neutral aprobado, `role=status`, singular «1 sello»). Saldo, premio deshabilitado y demás comprobaciones intactas; QA-052 no se reabre.
- **Límites:** el archivo completo (y sus 4 casos seriales) no se ejecutó (sin `QA_TEST_PASSWORD`).

## Preparación de QA-005 (sin ticket nuevo)
- **Archivos:** `tests/e2e/known-issues.spec.mjs`, `tests/e2e/global-teardown.mjs` (nuevo), `playwright.qa.config.mjs` (`globalTeardown`).
- La consulta de «antecesoras» ya solo cuenta promociones **vigentes** (`vigente_hasta >= hoy`), como la política `promociones_select_web`.
- La promoción propia del caso se desactiva en `finally` por su ID (limpieza garantizada y comprobada con `expect.soft`). El cierre global desactiva solo la promoción de la preparación de ESA corrida (título exacto y único).
- **Límite:** promociones TEST de corridas anteriores del mismo día que sigan activas no se tocan (son ajenas a la corrida); si existen, el caso falla en su precondición con su lista, como error de preparación. No ejecutado (sin `QA_TEST_PASSWORD`).
