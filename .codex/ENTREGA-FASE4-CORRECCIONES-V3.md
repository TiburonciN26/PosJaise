# Entrega Fase 4 — corrección de la revisión V3 (F4-06b)

Fecha: 2026-10-11. Local, sin commit ni push. Responde a `REVISION-FASE4-CATALOGOS-V3.md`. Solo F4-06b; se conserva todo lo aceptado.

## F4-06b · conteo ausente o inválido aceptaba una lista parcial

**Causa:** `leerCategoriasCompletas` usaba `data.length` como total cuando faltaba el conteo y podía reemplazar un total ya confirmado.

**Corrección (`src/lib/catalogoPublico.js`):** el conteo exacto es obligatorio en **cada** tramo: entero seguro y ≥ 0 (rechaza ausente, `*`, `NaN`, negativo) y debe coincidir con el del primer tramo (si cambia, error). Nunca se sustituye por `data.length`. Se lanza si no se alcanza el total (`filas.length !== total`). Como la vitrina depende de esta lectura, falla entera y la página muestra el error con Reintentar.

## Verificación

| Suite | Resultado |
| --- | --- |
| `verificar-categorias-completas.mjs` | **31/31** (SDK real + fetch simulado, sin BD). Nuevos: sin Content-Range en el 1.º tramo, sin conteo en el 2.º, total `*`, `xyz`, `-1`, total que cambia entre tramos (cada uno en ambas funciones), colección vacía con conteo 0 (sano), vitrina de Productos y Servicios falla con conteo ausente, y reintento sano posterior devuelve las 1.001 |
| `verificar-catalogo-publico.mjs` | **27/27** (los dos dobles de prueba de la vitrina ahora devuelven conteo, como el servidor real) |
| `verificar-catalogos-interfaz.cjs --con-categorias` | **31/31** (PostgREST real, 25 categorías sembradas y borradas) |
| Build / oxlint | correcto |

No repetí barras ni fotos/sesión ni rendimiento: no se tocó su código. Control negativo: los casos de conteo inválido son exactamente las reproducciones de Codex, que con el código anterior devolvían 500/1.000 sin error.

## Rollback / límites
Sin cambios respecto a V2 (`parche-fase4.patch` regenerado, `--check` OK; archivos nuevos ya listados incluyen `verificar-categorias-completas.mjs`). Estado: conteos de activos intactos (3.245 / 3.325), 0 filas `QA F4`. Sin producción, sin commit/push, Fase 5 sin iniciar. Evidencia: `.codex/evidencia-fase4/despues-v4/`.
