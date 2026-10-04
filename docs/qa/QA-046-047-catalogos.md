# QA-046 / QA-047 — catálogos truncados en `max_rows`

Solo Supabase Local TEST. Producción no se tocó ni se aplica nada allí.

## Causa

PostgREST corta cada respuesta en `max_rows = 1000`. Varias pantallas descargaban la tabla completa sin paginar y
filtraban en el navegador, así que con más de 1000 filas las posteriores (por nombre) eran invisibles: el buscador
no las encontraba y, en los selectores, hasta se ofrecía crearlas de nuevo.

## QA-046 — servicios

| Pantalla | Antes | Ahora |
|---|---|---|
| Servicios (`pages/Servicios.jsx`) | descarga completa + filtro/orden local | búsqueda, orden y paginación (50 + «Cargar más») en el servidor, orden determinista (columna + `id`); categorías por lectura completa de una columna |
| Nueva cita (`ModalCita`) | descarga completa | `useBusquedaServicios` (20 resultados, debounce, descarte de respuestas viejas, estados buscando/error/listo) |
| Registrar atención (`ModalRegistroAtencion`) | descarga completa | igual; en edición `SelectorServicioBuscable` recupera la ficha guardada por ID |
| Nueva deuda (`ModalDeuda`) | servicios + productos completos | sugerencias de concepto (servicios y productos activos) buscadas en el servidor |
| Combo de la ficha (`ModalServicio`) | `<select>` con todos | `SelectorServicioBuscable` (conserva la selección por ID) |
| Porcentajes, Recompensas Web (protección), portal (Servicios, Inicio), reprogramar cita | descarga completa | lectura completa **por bloques** (`leerPaginado`), porque necesitan todo el conjunto; un fallo parcial lanza error |

Funciones: `src/lib/buscarServicios.js`, `src/lib/leerPaginado.js`, `src/hooks/useBusquedaServicios.js`.

## QA-047 — productos en Caja

`pages/Ventas.jsx` ya no descarga `productos_vista`:

- búsqueda por nombre en el servidor (`buscarProductosVenta`, solo activos, 20 resultados);
- código de barras (Enter y escáner de cámara) por **consulta exacta** (`productoPorCodigo`); si dos productos activos
  compartieran código no se elige ninguno (el índice único lo impide hoy);
- el stock del carrito se pide **por ID** (`productosPorIds`) al entrar y cuando cambia el carrito; el servidor sigue
  siendo quien rechaza con «Stock insuficiente» (`confirmar_venta`);
- estados distinguibles: «Buscando…», «No hay productos que coincidan.» (ausencia real) y «No se pudo buscar productos»
  con Reintentar (error).

`ModalEscanerCodigoBarras` recibe `buscarPorCodigo` en vez de la lista de productos.

## Pruebas

- Datos/SQL (`node --test --test-concurrency=1 tests/e2e/*.test.mjs`): `qa-046-servicios-catalogo.test.mjs` (12) y
  `qa-047-productos-caja.test.mjs` (11). Caracterizan el defecto con la consulta anterior (exactamente 1000 filas, sin el
  objetivo) y comprueban la corrección, ADMIN y CAJERA, última unidad y concurrencia (SQL con claims simulados: **no** es
  una sesión HTTP real).
- Interfaz (requieren `QA_TEST_PASSWORD` solo en el proceso): `qa-046-servicios.spec.mjs`, `qa-047-caja.spec.mjs`.

## Límites conocidos

- «*» en un texto de búsqueda lo toma PostgREST como comodín (alias de «%»): solo amplía resultados.
- `PedidosWeb`, `Historial` y otras pantallas que filtran en el navegador una lista descargada no se revisaron en este lote.
- La edición de una atención sigue cargando la primera página de clientes (más la clienta guardada).
