# Vitales de laboratorio · build 10A frente a `main` (lo publicado hoy)

Mismo método y servidor (`scripts/fase10a/servir-como-pages.cjs`: cabeceras de `_headers`, Brotli, 304), CPU 4×, red 150 ms / 1,6 Mbps, SW bloqueado, mediana de 3 muestras. Cada celda: **10A / main**. LCP «primero» = primer candidato LCP (primer pintado grande). Interacción = mayor Event Timing al escribir en el buscador (referencia de INP, no INP de campo). En `main` el portal exige sesión: sin sesión muestra el login, así que la comparación del portal es la de **clienta**; y su Inicio con clienta se quedó en «Cargando…» (201 nodos), por lo que esa fila no es comparable.

| Escenario | LCP frío (ms) | LCP caliente (ms) | LCP primero (ms) | CLS | TBT (ms) | Interacción (ms) | Nota |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Productos (clienta) | 5044 / 6172 | 4408 / 5584 | 1600 / 1484 | 0 / 0 | 219 / 95 | 80 / 544 | comparable |
| Ficha de producto (clienta) | 4848 / 4600 | 4348 / 4152 | 1604 / 1508 | 0 / 0 | 20 / 19 | — / — | comparable |
| POS · Ventas (admin) | 2252 / 2192 | 1820 / 1784 | 1600 / 1500 | 0 / 0 | 312 / 47 | 32 / 32 | comparable |
| POS · Pedidos Web (admin) | 3168 / 6276 | 2780 / 6028 | 1596 / 1532 | 0 / 0 | 143 / 654 | 48 / 408 | comparable |
| Inicio (clienta) | 3644 / 1516 | 3132 / 1308 | 1588 / 1516 | 0.3 / 0 | 354 / 2 | — / — | **no comparable**: en main no terminó de cargar |

Solo en 10A (en `main` un visitante no tiene portal):

| Escenario | LCP frío | LCP caliente | LCP primero | CLS | TBT | Interacción |
| --- | --- | --- | --- | --- | --- | --- |
| portal-inicio | 3272 | 2796 | 1616 | 0.1 | 293 | — |
| portal-productos | 4508 | 3984 | 1636 | 0 | 175 | 72 |
| portal-detalle-producto | 4380 | 3936 | 1644 | 0 | 17 | — |

Elemento LCP final (10A): Inicio → imagen del héroe (`hero-*-640.webp`); Productos y ficha → `H1` del héroe/ficha, que aparece tras llegar los datos y su animación de entrada (el carrusel del héroe puede volver a actualizarlo); Ventas/Pedidos Web → texto de la lista.
