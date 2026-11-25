# Diseño de «Mis sellos» — tarjeta de fidelización de 12 sellos (portal cliente)

Propuesta y prototipo del rediseño de la tarjeta que se ve en **Recompensas → Mis sellos**. Es un diseño: nada de lo que muestra existe todavía en el backend (ver «Backend que falta»). Los datos del lienzo (nombre «Camila Torres», códigos de cupón, escenarios) son ficticios.

Lienzo editable (con botón Play y barra «Solo prototipo»): https://claude.ai/artifact/Q7cAx3Bip7FHnKfrpsZ7Zf

## Archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `Main.dc.html` | Mis sellos en escritorio (página fluida, 1440 px). **Referencia principal**: contiene la tarjeta, la lista de descuentos, las reglas y toda la lógica de ejemplo. |
| `Movil.dc.html` | Mis sellos en móvil (390 px); importa `Main.dc.html`. |
| `canvas.json` | Índice del lienzo; sus `notes` resumen cómo probarlo y los estados del sello. |

Los `.dc.html` son el formato del editor de diseño: **no se pegan tal cual en React**; se usan como especificación de estructura, estilos y comportamiento. No abren solos en el navegador (falta `support.js`); para verlos, usar el enlace del lienzo. La barra «Solo prototipo» y los datos de ejemplo **no** forman parte de la web.

## Qué cambia respecto a hoy

Hoy `SeccionSellosReal.jsx` muestra 5 círculos de 44 px (`Stamp`) dentro de una tarjeta `liquid-glass`. El rediseño la reemplaza por **una tarjeta 3D de 12 sellos** con la misma familia visual y las mismas animaciones que `TarjetaPuntos.jsx`.

## La tarjeta

- **12 sellos, 4 por fila, 3 filas.** El 4.º de cada fila es un sello de **meta** con un descuento: fila 1 = **10 %** (sello 4), fila 2 = **15 %** (sello 8), fila 3 = **20 %** (sello 12). El **3.º de cada fila** (sellos 3, 7 y 11) es un **regalo misterioso** con ruleta, del mismo tamaño que un sello común (ver más abajo).
- **Datos esenciales en la cara**: marca JAISE, insignia «Tarjeta de sellos», contador grande «N / 12» (con barra y marcas en las metas 4 y 8), texto de la **siguiente meta** («Te faltan 3 sellos para tu 10 % de descuento» / «Tienes 1 descuento listo para reclamar» / «Tarjeta completa…») y nombre de la clienta.
- **Dorso** (al girar): cómo se gana un sello, leyenda de las tres metas y cómo reclamar.
- **Paleta**: la de la tarjeta de puntos. Cada fila usa un metal de `NIVELES_PUNTOS`: **Plata** (fila 1, 10 %), **Oro** (fila 2, 15 %), **Diamante** (fila 3, 20 %), con sus mismas variables (`--tp-g`, `--tp-ink`, `--tp-glow`). El **fondo** de la tarjeta es **ónix** por defecto. En Tweaks se puede probar otro acabado: **Diamante verde** (GREEN DIAMOND) o **Rubí élite** (RUBY) de `public/diseñosPropios/Niveles de Tarjeta Rewards.html`, plata o diamante. Los **sellos conservan siempre sus metales**. Todos los textos de la tarjeta son **blanco puro** (`#ffffff`), sin opacidad ni grises.
- Un sello **ganado** se pinta con el metal de su fila; uno **vacío** es un hueco punteado numerado; entre sellos hay un conector que se «llena» de metal al ganar el siguiente.

## Estados del sello de meta (4, 8, 12)

| Estado | Cómo se ve | Interacción |
|---|---|---|
| **Bloqueado** | Disco punteado con candado y el porcentaje atenuado; etiqueta «SELLO N». | Ninguna (botón deshabilitado). |
| **Disponible** | Disco metálico de su fila que **late**, con ondas que se expanden, destello diagonal y glow; etiqueta «RECLAMAR». | Tocar el sello reclama el cupón. |
| **Reclamado** | **Otro estado y otro color**: disco oscuro con aro de metal que **gira**, porcentaje en degradado metálico, insignia de check y etiqueta «CUPÓN ACTIVO». | Ninguna. El cupón queda en Mis cupones. |

Al reclamar: el disco «sella» (rebote + flash), salen 8 chispas, aparece el check y un aviso (toast) «Cupón del 10 % generado · CÓDIGO». Al ganar un sello nuevo: se estampa con rebote, giro y una onda de metal.

## Regalo misterioso (sellos 3, 7 y 11) — recompensa secundaria con ruleta

- **El sello**: mismo tamaño que un sello común (no crece). Icono de regalo y aro del metal de su fila. Estados: **Bloqueado** (punteado, «REGALO»), **Listo** (disco metálico que late con ondas, «ABRIR») y **Abierto** (disco oscuro con aro que gira y el premio ganado escrito dentro, «ABIERTO»). Al abrirlo salen chispas.
- **La ruleta**: al tocar el sello listo, un panel cubre la tarjeta con una ruleta de 8 casillas en el metal de la fila (plata, oro, diamante), puntero con «tic» mientras gira, giro de ~5 s con frenado suave y casilla ganadora resaltada. Botón «Girar»; al terminar, premio, cómo se entrega y «Listo». Cierra con la X (no mientras gira). El regalo se considera **abierto en cuanto sale un premio**, aunque cierren el panel.
- **Siempre se gana algo**: no hay casillas vacías. Una casilla **«Otra vez»** (10 % de peso) no gasta el regalo: se puede girar de nuevo.
- **El premio lo decide el servidor antes de animar**; la ruleta solo lo revela (en el lienzo se simula con pesos por casilla). Los premios y sus pesos **son de ejemplo y los configurará la admin** (fuera de este prototipo).

**Los premios son físicos y de servicio, no solo digitales** (la dueña no entregará solo puntos). Tipos: **Descuento**, **Producto** y **Servicio**. Todos de ejemplo; sin puntos.

| Fila | Casillas de ejemplo (peso) |
|---|---|
| 1 · Plata | Cupón S/ 3 (20), Mini shampoo de muestra (25), Otra vez (10), Mascarilla en sobre (15), Cupón S/ 5 (5), Secado gratis (10), 5 % extra (10), Aceite capilar de regalo (5) |
| 2 · Oro | Cupón S/ 5, Shampoo tamaño viaje, Otra vez, Mascarilla de tratamiento, Cupón S/ 10, Tratamiento express, 10 % extra, Aceite capilar de regalo (mismos pesos) |
| 3 · Diamante | Cupón S/ 10, Shampoo y acondicionador, Otra vez, Kit de tratamiento para casa, Cupón S/ 20, Corte o peinado gratis, 15 % extra, Producto a elegir (mismos pesos) |

### Premio ganado = ficha con foto + cupón

Al salir un premio, la ruleta da paso a una **ficha del premio**: etiqueta de tipo (Descuento / Producto / Servicio), **foto** (en el lienzo, un recuadro marcado «Foto del producto/servicio»; en un descuento se muestra el valor grande), **nombre**, **«Para qué sirve»**, detalles (3 como máximo) y debajo el **cupón** con su código (`REG-P7K2`…) y cómo retirarlo. Los textos de producto con `[… A DEFINIR]` son marcadores que la dueña completa.

**Todo premio se guarda como cupón** (en Mis cupones). Cómo se retira:
1. La clienta pasa por caja y muestra el cupón. En la lista «Regalos misteriosos», la fila del regalo abierto dice **«Por retirar»** y tiene **«Mostrar en caja»**, que despliega (animado) el código en grande y las instrucciones.
2. Caja entrega el producto/servicio y **marca el cupón como usado**. En el lienzo hay un botón **«Solo prototipo: caja lo marca como usado»** que lo simula; entonces la fila pasa a **«Usado»** («Entregado en caja») y el sello de la tarjeta muestra «USADO».
3. Estados del sello abierto: «RETIRAR» (por retirar) → «USADO».

> **Dilema para quien implemente (no resuelto en este diseño)**: quien viene solo por el premio físico no compra nada ni se atiende, y hoy en Ventas **no se puede usar un cupón sin agregar algo al carrito**. Hay que definir cómo marca caja el cupón como usado: por ejemplo una acción «Entregar premio» en el POS que consuma el cupón sin venta, o una venta de S/ 0 con el producto como línea. El prototipo solo muestra el flujo de la clienta.

- Debajo de la tarjeta hay un bloque **«Regalos misteriosos»** (uno por fila) con su estado y el botón «Abrir regalo»: es la vía accesible sin tocar la tarjeta 3D y lleva a la tarjeta al abrir.
- Para la web: Esc cierra el panel (`useCerrarConEscape()`), y respetar `prefers-reduced-motion` (en el lienzo el giro es instantáneo con movimiento reducido).

## Animaciones y efectos heredados de la tarjeta de puntos

Flotación idle continua; arrastrar para girar 360° en 3D (vuelve al reposo al soltar; con «Ver dorso» se queda de espaldas); brillo `glare` que sigue la rotación; destello `sheen` que barre la tarjeta (5,7 s); «pop» de brillo al cambiar los sellos; contador y barra que se llenan al entrar; entrada de la tarjeta; sellos que se estampan en cascada al abrir la pestaña. **`prefers-reduced-motion`**: sin flotación, destello, latido ni ondas; solo cambian los colores.

En la web **no se reescriben**: la tarjeta debe construirse sobre el mismo patrón que `TarjetaPuntos.jsx` (lienzo de diseño fijo escalado al contenedor + bucle `crearBucle` con `prefers-reduced-motion`), con las capas `.tp-glare` / `.tp-sheen`, y las variables `--tp-*` de `NIVELES_PUNTOS` para los metales. El lienzo aproxima con `cqw` y keyframes CSS; no copiar esas medidas.

## Debajo de la tarjeta

- Pista «Arrastra para girar 360°» + botón **Ver dorso / Ver frente** (alternativa accesible al gesto).
- Bloque **«Descuentos de tu tarjeta»**: tres filas (una por meta) con disco del metal de su fila, título, detalle y estado: `Reclamar` (botón borde azul `--lw-gold`, **no** verde: `#3ECF6A` queda reservado a «Confirmar canje»), chip «Reclamado» o «Bloqueado». Es también la vía accesible para reclamar sin tocar la tarjeta 3D.
- Si la tarjeta está completa y reclamada: botón **«Empezar una tarjeta nueva»**.
- **«Cómo se ganan los sellos»**: desplegable animado (cabecera pintada en azul al abrir, flecha rellena 12×12 con `rotate-180`), con las reglas actuales de sellos más la de las metas.

## Convenciones del proyecto aplicadas

Títulos con Heavitas en blanco sólido; logo con Kunaroh; texto Inter; esquinas rectas/estilo `.landing-web`; `--lw-gold` `#a9c6ec`; confirmación vía toast (no banner que empuje); desplegable animado; sin UI en el POS.

## Backend que falta (nada de esto existe)

Hoy el servidor da **1 sello por día con servicios**, **premio cada 5 sellos**, **tope 20** (`mi_fidelizacion` / `saldo.sellos_max` / `sellos_por_premio`, canje vía `ConfirmarCanje`). Este diseño exige, antes de implementarlo:

- Metas **por posición** (sellos 4, 8 y 12) en vez de «cada N sellos»; tarjeta de **12**; qué pasa al llegar a 12 (se reinicia la tarjeta o se sigue acumulando).
- Catálogo de **tres premios por tarjeta** con su porcentaje y reclamo **idempotente** (un cupón por meta y por tarjeta; ya reclamado = no repetible).
- Cupones de **porcentaje** con las condiciones que se definan (ver decisiones).
- Todo objeto nuevo necesita GRANT explícito además de RLS; el reclamo va por una RPC `security definer` que valide los sellos del servidor (no los que declare el cliente). Local primero; producción solo con confirmación explícita.

## Decisiones de negocio pendientes

1. ¿Los descuentos son **10 / 15 / 20 %** definitivos? ¿Con **tope en soles** (hoy el cupón de fidelización es «20 % máx. S/5»)?
2. ¿A qué se aplican (servicio elegible / cualquiera) y con qué **compra mínima**?
3. **Vigencia** del cupón al reclamarlo (en otras pantallas se propuso 60 días) y si son **combinables** con otros cupones.
4. ¿Se reclaman **todos** los de una tarjeta o solo uno por tarjeta?
5. Al llegar al sello 12 y reclamar: ¿**tarjeta nueva automática** o botón manual (el lienzo muestra el botón)?
6. ¿Qué pasa con los **sellos acumulados hoy** (saldos heredados de hasta 20, premios de 5 sellos ya reclamados)? Migración o convivencia.
7. ¿Una **anulación** que baja los sellos por debajo de una meta ya reclamada? (el lienzo conserva el cupón reclamado, igual que la regla actual de premios).
8. ¿Se agrega un estado **«usado/vencido»** del cupón en la tarjeta, además de «reclamado»?
9. **Regalo misterioso**: lista real de premios por fila (cupones fijos, productos, servicios, % extra), sus **pesos/probabilidades**, **fotos y detalles** de cada producto o servicio, stock y vigencia de lo ganado.
10. ¿La casilla «Otra vez» se queda (10 %) y con qué tope de giros gratis seguidos?
11. **Canje en caja de un premio sin compra** (el dilema descrito arriba): ¿acción «Entregar premio» en el POS, venta de S/ 0 u otra? ¿Quién puede marcarlo (cajera/admin) y queda registro en el historial?
12. Backend: tabla de premios por fila con peso y stock, y una RPC `security definer` que elija el premio al azar **en el servidor**, lo registre una sola vez por regalo y devuelva el resultado (idempotente). GRANT explícito además de RLS; local primero.
