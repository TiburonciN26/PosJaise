# Entrega Fase 4 — correcciones de la revisión V2 (F4-04b, F4-05, F4-06)

Fecha: 2026-10-11 (America/Lima). Base: HEAD `6929c619`, rama `feat/cloudflare-pages`. Implementación **solo local**, sin commit ni push. Responde a `REVISION-FASE4-CATALOGOS-V2.md` (NO APROBADA: F4-04b, F4-05, F4-06). Se conserva todo lo que aceptaste (F4-01 ventana de tarjetas, F4-02, F4-03, rollback).

## Resumen

| Defecto | Causa raíz | Corrección | Regresión |
| --- | --- | --- | --- |
| **F4-04b** la vitrina antigua pisa el precio confirmado | Toda fila de `conocidos` se trataba como «la más reciente» y se copiaba a la caché con la hora de copia | **Procedencia por lectura:** cada fila (el objeto/snapshot) conserva la hora en que se vio por primera vez (`WeakMap`); el precio se resuelve por esa hora, no por la de render/copia. Una fila antigua no pisa una lectura posterior | Barras: carrito y cita, elemento que sigue en la vitrina a S/ 20, la búsqueda lo confirma a S/ 25, al limpiar sigue S/ 25 (el precio de la vitrina y el de las cintas se reescriben igual) |
| **F4-05** precio vencido + renovación fallida = «total vigente» | `precioDe` ignoraba la vigencia; solo el efecto la miraba | La vigencia se aplica **al resolver el total**: un dato de caché vencido es «desconocido» (`undefined`) hasta renovarlo. Mientras se renueva: «calculando total…»; si falla: «Total no disponible · Reintentar», con la cantidad conservada. Una fila de la página no caduca mientras se muestra | Barras: caché caliente → reloj +61 s → cambio de página → 403 / 500 / red → Reintentar; carrito y cita (6 casos) |
| **F4-06** metadatos de categorías cortados en 1.000 | Una sola RPC; PostgREST aplica `max_rows` también a funciones que devuelven filas | `leerCategoriasCompletas`: tramos de 500 con `range()` + conteo exacto, en el orden estable de la función. Si un tramo falla o el total no se alcanza, **lanza** (la vitrina muestra el error con Reintentar en vez de una lista truncada) | `verificar-categorias-completas.mjs` (nuevo): SDK real + `fetch` simulado que respeta `offset/limit` y corta en 1.000: 0, 5, 999, 1.000, 1.001 y 2.500 categorías, en ambas tablas |

## Detalle de las decisiones

**F4-04b / F4-05 (`src/hooks/usePreciosSeleccion.js`).**
- Cada fila entregada por la página se estampa una vez, por identidad de objeto, con `Date.now()` de la primera vez que se vio. No es la hora real de la respuesta, pero conserva el **orden** entre fuentes (la vitrina se vio antes que el resultado de la búsqueda), que es lo que importa; no se vuelve a estampar al repintar. Si una lectura trae otra fila nueva de la misma id, es un objeto nuevo con hora posterior.
- Resolución de un id: gana el más reciente entre «fila de la página» y «caché». Si gana la caché y está vencida (≥ 60 s) → desconocido y se vuelve a pedir; si gana una fila de la página → se usa sin caducar (es lo que la clienta ve en la tarjeta). La copia a la caché lleva la hora de la fila, no la de la copia, y no pisa una lectura más reciente.
- Render y efecto usan el mismo `resolver`; el efecto se ejecuta después, por lo que nunca habrá un dato «vencido» al renderizar y «vigente» al decidir la lectura (el caso inverso solo provoca una lectura de más).
- Observación honesta del repro: dentro de una página montada la selección solo cambia al navegar al detalle (desmonta la página y su caché); por eso la prueba de F4-05 provoca la renovación con un cambio de la página (búsqueda), que es el disparador real de volver a evaluar los faltantes, igual que cualquier cambio de `conocidos`.

**F4-06 (`src/lib/catalogoPublico.js`).**
- No se aumentó `max_rows` ni se descargaron tarjetas: solo los metadatos ligeros, en tramos de 500. El conteo exacto de la función decide cuándo parar; un tramo vacío o parcial antes de alcanzarlo es error.
- Con 25 o 400 categorías se hace una sola petición (igual que antes); con 1.001, tres.
- Verificado también contra el PostgREST **real** local: la suite de interfaz con 25 categorías sembradas sigue en 31/31, así que `range()` + `count: 'exact'` sobre la RPC funciona de verdad (no solo en el simulador).

## Verificación (todas con el código final)

| Suite | Resultado | Notas |
| --- | --- | --- |
| `verificar-barras-seleccion.cjs` | **17/17** (9 previos + 8 nuevos) | **Control negativo:** con el hook anterior (restaurado después) **fallan los 8 nuevos** y los 9 previos pasan |
| `verificar-categorias-completas.mjs` (nuevo) | **16/16** | Sin base de datos; el servidor simulado corta en 1.000 como PostgREST |
| `verificar-catalogo-publico.mjs` | **27/27** | Réplica local, solo lectura |
| `verificar-catalogos-interfaz.cjs --con-categorias` | **31/31** | Siembra y limpia 25 categorías `QA F4` (borradas al terminar) |
| `verificar-catalogos-fotos-sesion.cjs` | **8/8** | Vite temporal en :5181 con hosts `.invalid`; cerrado después |
| Build / oxlint | correcto | Sin diagnósticos en los archivos tocados |

No repetí las mediciones de rendimiento: el cambio de F4-06 añade 0 peticiones con ≤ 500 categorías y el de F4-04b/05 es cálculo de precios de la barra; la ruta de búsqueda no cambió.

## Rollback (actualizado)

Igual que en V1 (`git apply -R .codex/evidencia-fase4/parche-fase4.patch`, regenerado; `--check` OK, sin archivos del CLI). Archivos **nuevos** a borrar, ahora además de la lista de V1: `scripts/verificar-categorias-completas.mjs`. Las cuatro funciones SQL locales no cambiaron. Se conservan `scripts/lib/huerfanos-medios.mjs`, `scripts/medios-huerfanos.mjs`, `verificar-cli-huerfanos.mjs`, `verificar-ml03-bundle.cjs`.

## Límites

- El estampado por «primera vez visto» es una aproximación del orden de lectura, no la hora del servidor; se documenta en el hook.
- La prueba de F4-05 adelanta `Date.now` solo dentro del navegador; no cambia reloj de servidor, base ni RLS. Los fallos 403/500/red se simulan por interceptación.
- F4-06 se prueba con servidor simulado (no se sembraron 1.001 categorías en la base) más la comprobación real con 25 categorías y la lectura por tramos.
- Sigue sin prueba de interfaz de cambio real de cuenta (solo por diseño), y las cifras «≤ 10 categorías reales» del negocio **no están verificadas**: es una condición, no un conteo observado.
- La cuenta ficticia local `qa-f4-*@test.local` se conserva (carrito y cita vaciados al terminar); 0 filas `QA F4`; conteos de activos iguales a los iniciales (3.245 / 3.325).

## Lo que NO se hizo

Sin commit ni push; migración **no** aplicada en producción; sin tocar Cloudflare, `main`, GitHub Pages ni datos remotos; Fase 5 sin iniciar.

## Evidencia

`.codex/evidencia-fase4/despues-v3/` (barras, interfaz, fotos/sesión de esta ronda) y `parche-fase4.patch` regenerado.
