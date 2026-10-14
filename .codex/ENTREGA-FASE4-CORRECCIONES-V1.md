# Entrega Fase 4 — correcciones de la revisión V1 (F4-01 a F4-04)

Fecha: 2026-10-11 (America/Lima). Base: HEAD `6929c619`, rama `feat/cloudflare-pages`. Implementación **solo local**, sin commit ni push. Responde a `REVISION-FASE4-CATALOGOS-V1.md` (NO APROBADA, 4 defectos P2). Sustituye a `ENTREGA-FASE4-CATALOGOS-ESCALABLES.md` en lo que corrige; ese documento se conserva como histórico.

## Resumen

Acepté los cuatro defectos tal como los reprodujiste. Los cuatro tienen corrección, una regresión propia y un control negativo (cuando era posible). Además corregí tres afirmaciones de mi entrega anterior (rollback, «restauración exacta» y la lista de cifras) y precisé los límites.

| Defecto | Causa raíz | Corrección | Regresión |
| --- | --- | --- | --- |
| **F4-01** «Todos» sin ventana global | La RPC acotaba por categoría pero devolvía todas; la página montaba todos los grupos | Metadatos de categorías separados (`*_categorias_publicas`) y tarjetas por **ventana de 10 categorías** (`grupo_desde`, `grupos_max`), con paginador de categorías; parámetros **acotados en el servidor** | Datos 27/27 e interfaz con 25 categorías sembradas (29 de productos, 43 de servicios) |
| **F4-02** «Tu cita» duplica | La barra sumaba cada *aparición* del servicio | Se itera por **ids seleccionados** (un id = una vez), no por filas de la página | Servicio presente a la vez en héroe y en una fila; y también con la búsqueda |
| **F4-03** subtotal como total | El rechazo de `leerPorIds` se ignoraba y los sin precio salían del conteo | Conteo de toda la selección; total «calculando…» / «Total no disponible · Reintentar»; recuperación al cambiar la selección | 403, 500 y red, en carrito y en cita, con y sin recuperar sin añadir un id distinto |
| **F4-04** precio viejo al salir | La caché guardaba la primera lectura y nunca incorporaba lo que la página mostraba | La caché se **reconcilia** con lo que muestra la página y **caduca a los 60 s**; está separada por sesión | Leer por id → ver otro precio en una búsqueda → limpiar el filtro: no vuelve al viejo |

## F4-01 en detalle

- **Migración** `20261011000001` reescrita (sigue siendo local; el `drop function if exists` inicial reemplaza la firma anterior). Cuatro funciones `SECURITY INVOKER`: `productos_categorias_publicas()`, `productos_vitrina_publica(por_categoria, grupo_desde, grupos_max)`, `servicios_categorias_publicas()`, `servicios_vitrina_publica(por_categoria, dias, grupo_desde, grupos_max)`. Cotas: `por_categoria` 1–12, `grupos_max` 1–20, `grupo_desde` ≥ 0 (probado con 100.000, negativos y un `grupo_desde` fuera de rango).
- **Categorías completas y alcanzables:** el contador y la lista de la barra salen de los metadatos, no de la ventana. Con 29 categorías de productos hay 3 ventanas y las 29 aparecen sin duplicarse ni omitirse; en servicios, 43 categorías en 5 ventanas.
- **Ventana de tarjetas:** como máximo 10 grupos × 4 = 40 tarjetas montadas. La ventana 1 viaja con la vitrina (el primer render conserva la coreografía de entrada); las siguientes se piden solo al paginar y **no se piden antes**. Cada respuesta de la RPC trae ≤ 40 filas (aserción en interfaz).
- **Sin descargar todo para cortar en React:** cada ventana es una consulta con tope en el servidor. Si una ventana falla se muestra «No se pudieron cargar las categorías» con Reintentar.
- **Decisión de producto que te dejo señalada:** «Todos» ya no lista *todas* las categorías de golpe; las pagina de 10 en 10. Es la forma de cumplir la ventana sin esconder categorías, pero cambia lo que ve la clienta cuando hay más de 10. Con las categorías reales del negocio (≤ 10) no hay paginador.

## F4-02 / F4-03 / F4-04 en detalle

Hook nuevo `src/hooks/usePreciosSeleccion.js`, usado por `BarraTuCarritoFlotante` y `BarraTuCitaFlotante`:

- La barra recorre los **ids seleccionados** (no las filas de la página). Un servicio en héroe, fila y búsqueda cuenta una vez y suma su precio una vez.
- Precio de un id: (1) lo que la página muestra, que es lo más reciente y se copia a la caché; (2) la caché con vigencia de 60 s; (3) una lectura por id. Mientras no se conozca algún precio la **cantidad se cuenta igual** y el total no se presenta como completo: «calculando total…» o, si la lectura falló, «Total no disponible · Reintentar».
- Recuperación: botón Reintentar, o cualquier cambio de la selección (el efecto depende de ids+cantidades), sin necesidad de añadir un id distinto. Las respuestas tardías se descartan (`vigente` + `AbortController`).
- **Decisión:** un id que la lectura *funcionó* y no devolvió (desactivado o borrado) se excluye del conteo y del total; uno cuya lectura *falló* sigue contando. Es la distinción que el defecto pedía entre «sin precio» y «no pude leer».
- Nota de comportamiento real: `postgrest-js` reintenta las lecturas fallidas por red, así que ante un corte de red la barra puede mostrar «calculando total…» unos segundos antes de pasar a «Reintentar» (500 y 403 pasan directo).

## Verificación (todas con el código final)

| Suite | Resultado | Notas |
| --- | --- | --- |
| `verificar-catalogo-publico.mjs` | **27/27** | Con 25 categorías ficticias sembradas: la unión de las ventanas reproduce exactamente el cálculo anterior; cotas del servidor; metadatos = suma de tarjetas |
| `verificar-catalogos-interfaz.cjs --con-categorias` | **31/31** | 25 previos + 6 nuevos (≤ 40 tarjetas por ventana, todas las categorías alcanzables, solo se pide la primera ventana antes de paginar, 390 px sin desborde, error de ventana con Reintentar) |
| `verificar-catalogos-fotos-sesion.cjs` | **8/8** | Sin cambios de alcance |
| `verificar-barras-seleccion.cjs` (nuevo) | **9/9** | **Control negativo: 9/9 fallan** contra las barras de la versión que revisaste (restauradas después) |
| Build / oxlint | correcto | Sin avisos nuevos (2 preexistentes de Fast Refresh en la tarjeta de producto) |

Control negativo de F4-01: **no se puede repetir** con el código anterior porque la firma antigua de la RPC ya no existe; el criterio queda fijado por las aserciones numéricas (≤ 40 tarjetas, M de M categorías, ventanas ≤ 40 filas).

## Mediciones finales (laboratorio, CPU 4×, 18 muestras por escenario, 0 errores)

| | Productos antes → después | Servicios antes → después |
| --- | --- | --- |
| **Réplica de miles** — datos de carga | 509 KB → **12 KB** | 1.649 KB → **15 KB** |
| Evento más lento al teclear | 4.000–4.216 → **56 ms** | 4.464–4.944 → **32–40 ms** |
| Tarea larga de búsqueda | 3.792–3.993 → **82–94 ms** | 4.250–4.635 → **60–74 ms** |
| Tarjetas montadas en «Todos» | 10 → 11 | 24 → **16** |
| **Tamaño del negocio (300/100)** — evento | 1.640–1.768 → **56 ms** | 736–840 → **24 ms** |
| Tarea larga de búsqueda | 1.582–1.689 → **80–83 ms** | 707–730 → **0–61 ms** |

Ninguna tarea de búsqueda ≥ 200 ms. Las tareas de **carga** (~350–456 ms) siguen siendo las del arranque de la app (idénticas en `/nosotros`) más el montaje de héroe/cintas/filas; no las toqué. El medidor espera 1,5 s de silencio antes de teclear en el «después»; el «antes» no lo tiene (sus valores son de segundos). Laboratorio: no son INP/LCP de usuarios.

## Rollback (corregido)

**No usar `git checkout -- src`.** Revierte solo lo de esta fase, sin tocar el CLI de la ronda anterior:

1. `git apply -R .codex/evidencia-fase4/parche-fase4.patch` — 8 archivos: `BarraCatalogo`, `BarraTuCarritoFlotante`, `BarraTuCitaFlotante`, `TarjetaProductoCliente`, `TarjetaServicioCliente`, `ProductosCliente`, `ServiciosCliente`, `implementacionesWed.md`. Verificado con `--check` sobre el árbol actual (no contiene ningún archivo del CLI).
2. Borrar los archivos **nuevos** (no los cubre el parche): `src/lib/catalogoPublico.js`, `src/hooks/useCatalogoPublico.js`, `src/hooks/usePreciosSeleccion.js`, `src/components/PaginadorCatalogo.jsx`, `supabase/migrations/20261011000001_catalogo_publico_vitrina.sql` y los scripts `verificar-catalogo-publico.mjs`, `verificar-catalogos-interfaz.cjs`, `verificar-catalogos-fotos-sesion.cjs`, `verificar-barras-seleccion.cjs`, `medir-catalogos-fase4.cjs`, `escenario-catalogo-qa.mjs`.
3. Solo en el Supabase local: `drop function` de las cuatro funciones (`productos_categorias_publicas()`, `productos_vitrina_publica(integer,integer,integer)`, `servicios_categorias_publicas()`, `servicios_vitrina_publica(integer,integer,integer,integer)`).
4. Se **conservan** `scripts/lib/huerfanos-medios.mjs`, `scripts/medios-huerfanos.mjs`, `verificar-cli-huerfanos.mjs` y `verificar-ml03-bundle.cjs`: pertenecen a la ronda previa y están aceptados.

## Correcciones a mi entrega anterior

- El rollback que propuse (`git checkout -- src` + restaurar el CLI) era incorrecto: ver arriba.
- «Base restaurada exactamente»: lo que sí compruebo es que los **conteos de activos** vuelven a los iniciales y que se reactivan exactamente los ids que se desactivaron (respaldo por id). **No** comparé toda la base ni sus bitácoras; no lo afirmo.
- El escenario 300/100 es sintético (100 servicios no es una cifra confirmada del negocio) y el rendimiento de producción no está medido.
- La prueba de RPC corre como `anon`; no acredita todas las combinaciones de roles de producción.

## Límites

- **Cambio de cuenta:** la caché de precios y las consultas están separadas por sesión en el código, pero no hay prueba de interfaz de un cambio real de cuenta (cerrar sesión desmonta la página). Sigue cubierto solo por diseño.
- Las pruebas de fallo simulan 403/500/red interceptando en el navegador; no cambian RLS ni la base.
- Se añadió una cuenta ficticia local `qa-f4-*@test.local` (contraseña aleatoria fuera del repo) y se sembraron/borraron categorías `QA F4 …`; ambos quedaron limpios (carrito/cita vacíos; 0 filas `QA F4`).
- Fuera de alcance, sin cambios: cobros, pagos, permisos, Fase 5, producción.

## Lo que NO se hizo

Sin commit ni push; migración **no** aplicada en producción (requiere tu confirmación explícita); sin tocar Cloudflare, `main`, GitHub Pages ni datos remotos.

## Evidencia

`.codex/evidencia-fase4/`: `despues-*.json|log` (finales) y sus versiones previas (`*.v1-sin-silencio`, `*.v2-antes-de-memo-tarjetas`, `*.v3-revision-codex-v1`), `antes-*.json|log`, `despues-v2/` (interfaz, fotos/sesión, barras), `parche-fase4.patch`, `estado-base-original.json`.
