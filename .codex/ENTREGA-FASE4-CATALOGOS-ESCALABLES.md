# Entrega Fase 4 — catálogos públicos escalables (Productos y Servicios)

Fecha: 2026-10-11 (America/Lima). Base de código: HEAD `6929c619`, rama `feat/cloudflare-pages`. Implementación **solo local**, sin commit ni push. Para la revisión de Codex (QA/auditor).

## Qué se hizo, en una línea

Los dos catálogos públicos dejaron de descargar el catálogo completo: la vista «Todos» sale de una vitrina acotada (una función SQL) y la categoría o la búsqueda piden **una página de 40 al servidor**. La búsqueda ahora alcanza todo el catálogo (antes se perdían las filas posteriores a la 1.000) y escribir ya no congela la página.

## Alcance cubierto (puntos 1–8 de `ALCANCE-FASE4-CATALOGOS-ESCALABLES.md`)

| # | Requisito | Cómo quedó |
| --- | --- | --- |
| 1 | Búsqueda, filtros y orden en servidor; páginas ≤ 40 | `leerPaginaCatalogo` (`range()` + conteo exacto + `ilike`); paginador que **reemplaza** la página, no acumula |
| 2 | Orden determinista con `id`; búsqueda sobre todo lo que permite RLS | `order(nombre).order(id)`; probado con la réplica de miles y 28 nombres repetidos |
| 3 | Categorías y contadores globales; héroe/ofertas/destacados acotados | Función SQL `*_vitrina_publica` (categorías + total + primeras 4). Héroe ≤ 5 (productos) / 3 (servicios); cintas ≤ 12 con el total real en el rótulo |
| 4 | Reinicio de página, respuestas obsoletas, estados diferenciados | `useCatalogoPublico`: `AbortController` + bandera `vigente`; estados cargando / vacío / **error con Reintentar** |
| 5 | Variante de foto, carga diferida, fallback | Tarjetas `m` (ya lo eran) + `decoding="async"` + **fallback al degradado si la foto falla**; héroe solo pide la activa y sus vecinas; miniaturas del héroe en `m` |
| 6 | Conservar reglas de stock, precios, carrito, detalle | Sin cambios de lógica comercial. Las barras flotantes resuelven por id lo que no esté en la página |
| 7 | No cambiar `leerServicios` ni helpers de lectura completa | Intactos; módulo nuevo `catalogoPublico.js` |
| 8 | RPC/esquema documentado y aparte | **Una migración** (2 funciones `SECURITY INVOKER`), ver abajo |

## Archivos

Modificados (9): `src/pages/cliente/ProductosCliente.jsx`, `src/pages/cliente/ServiciosCliente.jsx`, `src/components/BarraCatalogo.jsx` (el texto vive en la caja y avisa tras 250 ms), `BarraTuCarritoFlotante.jsx`, `BarraTuCitaFlotante.jsx`, `TarjetaProductoCliente.jsx`, `TarjetaServicioCliente.jsx` (+`memo`, fallback), y los dos archivos del CLI del recolector de la ronda anterior (sin relación con esta fase).

Nuevos: `src/lib/catalogoPublico.js`, `src/hooks/useCatalogoPublico.js`, `src/components/PaginadorCatalogo.jsx`, `supabase/migrations/20261011000001_catalogo_publico_vitrina.sql`, y scripts `verificar-catalogo-publico.mjs`, `verificar-catalogos-interfaz.cjs`, `verificar-catalogos-fotos-sesion.cjs`, `medir-catalogos-fase4.cjs`, `escenario-catalogo-qa.mjs`.

## Migración `20261011000001_catalogo_publico_vitrina.sql`

`productos_vitrina_publica(por_categoria)` y `servicios_vitrina_publica(por_categoria, dias)`. **Por qué hacen falta:** PostgREST no agrupa ni numera filas por categoría; sin ellas habría que descargar el catálogo o hacer una petición por categoría.

- `SECURITY INVOKER`: usan los permisos de quien llama, así que respetan RLS y los GRANT por columna. No se amplía RLS ni se exponen `costo`, `proveedor`, `stock_minimo`, `codigo_barras` (comprobado). `EXECUTE` solo para `anon` y `authenticated`, los roles que ya leen el catálogo.
- Orden idéntico al que calculaba el navegador (categorías por su primer nombre; dentro, nombre/id; en servicios, «más pedidos» primero). **Una diferencia deliberada:** con el mismo número de reservas el orden antes era arbitrario (dependía del plan de `servicios_mas_pedidos`); ahora los empatados comparten posición (`dense_rank`) y se ordenan por nombre e id.
- **Aplicada solo en el Supabase local.** Producción exige tu confirmación explícita (`CLAUDE.md`); no se aplicó ni se ha preparado para aplicar.

**Reversión:** `drop function public.productos_vitrina_publica(integer); drop function public.servicios_vitrina_publica(integer, integer);` y `git checkout -- src scripts/lib/huerfanos-medios.mjs scripts/medios-huerfanos.mjs` más borrar los archivos nuevos. Las funciones no las usa nadie más.

## Resultados (laboratorio, CPU 4×, Chromium, sesión anónima, 3 muestras por celda, 390/412/1440 px)

Rango del peor valor por viewport. «Antes» = HEAD sin tocar; «después» = código final. 18 muestras por tabla, 0 errores.

**Réplica de miles** (3.245 productos / 3.325 servicios activos)

| | Productos antes | Productos después | Servicios antes | Servicios después |
| --- | --- | --- | --- | --- |
| Datos del catálogo en la carga | 509 KB (truncado a 1.000 filas) | **12 KB** | 1.649 KB (10 peticiones) | **16 KB** (7) |
| Evento más lento al teclear | 4.000–4.216 ms | **40–56 ms** | 4.464–4.944 ms | **32–40 ms** |
| Tarea larga durante la búsqueda | 3.792–3.993 ms | **85–91 ms** | 4.250–4.635 ms | **64–69 ms** |
| ¿Encuentra un registro posterior a la fila 1.000? | **No** | Sí (39 resultados) | Sí | Sí |
| Nodos DOM al cargar | 2.209 | 1.402 | 947 | 947 |

**Tamaño del negocio** (300 productos / 100 servicios activos): evento más lento 1.640–1.768 → 40–56 ms (productos) y 736–840 → 32–40 ms (servicios); tarea larga de búsqueda 1.582–1.689 → 77–87 ms y 707–730 → 53–55 ms; datos 152 → 12 KB y 62 → 12 KB. (En este escenario el registro «ULTIMA UNIDAD» no está en el subconjunto activo, por eso «Tarjetas» es 0 antes y después.)

Criterios del alcance: ningún bloqueo ≥ 1 s ✔; evento ≤ 200 ms ✔ (máx. 56 ms); **ninguna tarea de búsqueda entre 200 y 999 ms** ✔ (máx. 91 ms).

## Verificación ejecutada

- `verificar-catalogo-publico.mjs` — **21/21**: piezas puras, constructores de consultas con cliente simulado y, contra la base local, la función SQL comparada con el algoritmo anterior del navegador (categorías, orden, totales, primeras tarjetas, héroe/cintas), recorrido completo de páginas sin duplicar ni omitir, búsqueda tras la fila 1.000, comodines `%`/`_` escapados, página fuera de rango (`PGRST103`), columnas privadas ausentes.
- `verificar-catalogos-interfaz.cjs` — **25/25**: ninguna consulta pide > 40 filas, búsqueda tras la fila 1.000, **respuesta vieja y lenta no pisa a la nueva**, limpiar la búsqueda, sin resultados, paginación (40 por página, el DOM no acumula, sin repetidos, primera/última/anterior), fallo de red con Reintentar y recuperación, fallo de la vitrina con Reintentar, ir al detalle y volver, sin desborde horizontal a 390/412/1440 (vista agrupada, lista y paginador), elegir categoría desde la barra.
- `verificar-catalogos-fotos-sesion.cjs` — **8/8**: tarjetas en variante `m` con referencias `r2:`, ruta antigua de Storage conservada, héroe sin pedir las 5 fotos grandes, carga diferida efectiva, la página 2 no pide imágenes antes de visitarla, una imagen 404 muestra el degradado, salir con una búsqueda en vuelo no deja errores, y —con una cuenta ficticia local— un producto de la **página 3** y un servicio de la **página 3** agregados aparecen en las barras «Tu carrito» / «Tu cita» con el precio correcto al volver.
- `npm run build` correcto; oxlint sin diagnósticos nuevos (quedan los 2 avisos preexistentes de `TarjetaProductoCliente`).
- Las suites previas (CLI del recolector 23/23, etc.) no se tocaron.

## Hallazgos y decisiones que conviene que revises

1. **Productos sin categoría no aparecen en «Todos»** (3.214 de 3.245 en la réplica): es el comportamiento anterior (solo forman fila las categorías con nombre) y se conservó; siguen alcanzables por búsqueda. Si el negocio tiene productos sin categoría, conviene decidir si merecen una fila «Sin categoría».
2. **El carrusel del héroe repinta la página cada 5 s.** Con 40 tarjetas en pantalla costaba ~245–290 ms por tick (CPU 4×); con `memo` en las tarjetas bajó a ~85 ms. No se rediseñó el carrusel.
3. **Carga:** la primera tarea larga (~356–368 ms) es el arranque de la app y aparece igual en `/nosotros`, que no es un catálogo. Los catálogos añaden tareas de montaje del héroe, cintas y filas (~250–410 ms a ~1–1,4 s, CPU 4×); es diseño previo y no depende de la búsqueda. En Productos la carga bajó de 566–692 a 415–436 ms; en Servicios no cambió.
4. **Cuenta:** `clave = usuario?.id` reinicia las consultas y descarta respuestas de la cuenta anterior, pero **no hay prueba de interfaz propia del cambio de cuenta** (cerrar sesión desmonta la página). Está cubierto solo por el diseño del hook.
5. **`BarraTuCarritoFlotante`/`BarraTuCitaFlotante`** ahora piden por id lo que falte. Efecto secundario bueno: el detalle de producto, que ya les pasaba una lista parcial, deja de subestimar el total.

## Limitaciones del método (cómo leer las cifras)

- Laboratorio con CPU 4×, red local, imágenes respondidas con PNG de 1×1: **no son INP/LCP reales** ni miden entrega por Pages.
- El medidor tuvo una corrección a mitad: al principio podía empezar a teclear mientras terminaban las tareas de montaje, lo que inflaba Servicios 412 px (~270 ms). Se añadió una espera de 1,5 s de silencio antes de buscar. Las corridas anteriores se conservan aparte (`*.v1-sin-silencio.json`, `*.v2-antes-de-memo-tarjetas.json`). **Las mediciones «antes» no llevan esa espera** (los valores de segundos la hacen irrelevante).
- La primera línea base se descartó y repitió desde cero: edité dos archivos mientras corría y el servidor de desarrollo habría servido código modificado. La medición válida se hizo con el árbol intacto (`git status` limpio de `src`).
- Las pruebas de fotos reescriben `foto_url` en el navegador (no escriben en la base) y usan una segunda instancia de la app con R2 apuntando a hosts `.invalid`.

## Estado del entorno local tras las pruebas

- Base local restaurada **exactamente** al estado inicial (3.245/3.245 productos, 3.340/3.325 servicios) tras cada escenario de 300; coincide con `estado-base-original.json`. Se desactivaron/reactivaron filas con los disparadores de auditoría suspendidos solo dentro de la transacción (sin ruido en la bitácora).
- Se creó **una cuenta ficticia local** `qa-f4-*@test.local` (solo Supabase local, contraseña aleatoria fuera del repo); su carrito y cita quedaron vacíos.
- Un traspié que corregí: mis primeras lecturas exploratorias fueron a la pila `JaiseEnsayo` (puertos 563xx) en vez de `WedJaiseReact` (54321). Solo lecturas, nada escrito; se rehicieron contra la base correcta antes de continuar.

## Lo que NO se hizo

Sin commit ni push; migración **no** aplicada a producción; sin tocar Cloudflare, Pages, `main`, GitHub Pages ni datos remotos; sin cambios en `leerServicios` ni en el resto de helpers de lectura completa; sin rediseño visual; sin Fase 5.

## Evidencia

`.codex/evidencia-fase4/`: `antes-*.json|log` y `despues-*.json|log` (muestras crudas y resumen), `despues/interfaz.json`, `despues/fotos-sesion.json`, `estado-base-original.json`, versiones intermedias del «después» y los respaldos de ids del escenario de 300.
