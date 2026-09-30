# Diseño de Productos y Detalle del producto — portal cliente (web)

Diseño aprobado para:

- rediseñar `src/pages/cliente/ProductosCliente.jsx` (pestaña **Productos**), y
- crear una pestaña nueva **Detalle del producto**, que hoy no existe. Se abre desde las tarjetas, las cápsulas "Ver detalles" y el botón del inicio. Ruta sugerida: `productos/:id`, igual que `servicios/:id` → `DetalleServicioCliente.jsx`.

Lienzo original (interactivo, con botón Play): https://claude.ai/artifact/6m3TQ9jBReyRocvfPxeP95. La Página 1 es Productos y la Página 2 es el Detalle. En Play, los "Ver detalles" de la Página 1 abren el Detalle.

## Archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `Main.dc.html` | Productos en escritorio (1440 px). **Referencia principal de Productos.** |
| `Movil.dc.html` | Productos en móvil (390 px). |
| `DetalleProducto.dc.html` | Detalle del producto en escritorio (1440 px). **Referencia principal del Detalle.** |
| `DetalleMovil.dc.html` | Detalle del producto en móvil (390 px). |
| `canvas.json` | Índice del lienzo. Sus `notes` resumen el orden de cada pantalla y lo que falta en el backend. |

Los `.dc.html` están en el formato del editor de diseño: HTML con `{{holes}}`, `<sc-if>`, `<sc-for>` y la lógica en el bloque `class Component extends DCLogic` al final (datos de ejemplo y cálculos). **No se pegan tal cual en React.** Sirven como especificación de estructura, estilos (inline y en `<helmet><style>`) y comportamiento. No abren solos en el navegador porque falta el runtime `support.js`; para verlos, usar el enlace del lienzo.

En el lienzo, las fotos son **degradados con siluetas de frasco/pote** (constante `FORMA`) porque no había fotos de productos. En la app van las fotos reales del bucket `fotos-productos` (`urlPublicaFoto`). Un producto sin foto usa el degradado por categoría, igual que en Servicios (`degradadoServicio` en `lib/serviciosVisual.js`; en el lienzo, `gradFor`). Heavitas sale de `src/assets/fonts/`.

## Reglas de estilo (ya definidas por el usuario)

- Estilo de la web del cliente: `.landing-web`, `--lw-gold` (azul metálico `#a9c6ec`), fondo `#0b0b0c`. El rosa `--lw-rose` (`#ff85a1`) solo va en el puntito de las etiquetas.
- **Heavitas** en blanco sólido y mayúsculas para títulos importantes: nombre del producto, "Ofertas", "Destacados", nombres de categoría y títulos de sección. El resto va en la fuente actual.
- Bloques: fondo `#111113`, borde `1px #1f1f22`, radio `10px`, `box-shadow: inset 0 1px 1px rgba(255,255,255,.06)`.
- **Botón principal:** azul metálico, texto negro y círculo negro con ícono a la derecha.
  - El verde `#3ECF6A` **no** se usa como botón aquí. Solo aparece como punto de estado de stock.
- **Tarjeta del catálogo:** es **la misma que la de servicio** (`TarjetaServicioCliente.jsx`): foto cuadrada con radio 10, etiqueta de subcategoría (radio 5) abajo a la izquierda y botón blanco circular **↗** abajo a la derecha. Para productos se agregan:
  - la etiqueta "−20%" con puntito rosa arriba a la izquierda si está en oferta;
  - el precio anterior tachado;
  - una línea de stock ("En stock" / "Últimas N unidades" / "Agotado").
  - Si está agotado, la foto va atenuada (`opacity .45`) y lleva la etiqueta "Agotado".
- **Qué sale de la tarjeta:** corazón, compartir, selector de cantidad y "Agregar" pasan al Detalle.
- **Qué deja de usarse:** la tarjeta iridiscente con inclinación 3D (`.iri-*`) ya no se usa en Productos.
- Esc cierra modales (`useCerrarConEscape`). Confirmaciones con `useToast()`. Flechas de desplegables con `ArrowBigDown`.

## Pestaña Productos (Página 1)

Orden de arriba a abajo:

### 0. Inicio: novedades y lo más vendido

Tiene el **mismo efecto que el hero de Servicios**; ver `docs/diseno-servicios/README.md`.

**Columna izquierda:**
- Texto fijo arriba: "Novedades y lo más vendido".
- Bloque que **cambia con la foto**:
  - cápsula **blanca** con ícono de brillo: "En oferta −X%" (se calcula con `precio_antes`), "Lo más vendido" o "Nuevo";
  - nombre del producto (Heavitas 60 px; en móvil 34);
  - descripción;
  - precio con el anterior tachado y la subcategoría.
- El texto que sale se desvanece hacia arriba. El que entra sube desde abajo, pasa de borroso a nítido y llega escalonado: cápsula a 250 ms, título a 350 ms, descripción a 480 ms. Los textos se apilan en la misma celda de grid para que los botones no salten.
- Botones fijos: **Agregar al carrito** (azul, agrega 1 unidad del producto que se está mostrando) y **Ver detalles** (abre su Detalle).
- Abajo: "Catálogo / N productos · Recojo en el local · Envío a [ZONA]".

**Columna derecha:**
- Foto grande (420 px de alto, radio 16) con barras de progreso arriba y "01 / 05" + precio abajo.
- Debajo, **3 fotos chicas** (180 px) con los **3 productos que siguen**.
- **Cada 5 s cambian las 4 fotos** con fundido: la grande pasa al siguiente y las chicas avanzan con ella.
- Tocar una foto chica o una barra pone ese producto en grande y reinicia el conteo. Las chicas hacen un zoom suave en hover.

**En móvil:** las fotos van arriba (grande de 300 px y 3 chicas de 108 px) y el texto debajo.

Si hay 4 productos o menos, igual rotan, pero las chicas pueden repetir productos.

**Pendiente de decidir (lo ve el usuario):** quién elige los productos del inicio. Puede ser a mano desde el POS o que salgan solos los más vendidos.

### 1. Ofertas y destacados: dos cintas en movimiento

Arriba va la frase "Los mismos productos que usamos en el salón, para que tu resultado dure en casa."

**Las dos filas:**
- **Fila 1, Ofertas** (productos con `precio_antes` y stock > 0): título a la **izquierda**, la cinta se mueve **hacia la derecha**. Etiqueta "Oferta −X%".
- **Fila 2, Destacados** (productos destacados con stock > 0): título a la **derecha**, la cinta se mueve **hacia la izquierda**. Etiqueta "Destacado".
- Junto a cada título va el conteo ("7 productos").

**Tarjeta de la cinta:**
- Escritorio: foto vertical de **296×390** con radio 14 y separación 24; se ven unas 4½.
- Móvil: **200×264** con separación 12.
- Encima de la foto: etiqueta arriba a la izquierda, nombre y precio (con el anterior tachado) abajo.

**Movimiento continuo:**
- La lista se repite hasta tener al menos 10 tarjetas (`MIN_CINTA`) y luego se duplica.
- La pista se desplaza exactamente el 50% en bucle (`@keyframes mqIzq`/`mqDer`), así el bucle no da saltos.
- Por eso cada tarjeta usa `margin-right` y **no** `gap`.
- Velocidad: **36 px/s** en escritorio y **28 px/s** en móvil. La duración se calcula como `tarjetas × (ancho + separación) / velocidad`.
- Los bordes laterales se desvanecen con `mask-image`.

**Hover:**
- Al pasar el mouse por una foto, **solo esa fila se detiene** (`animation-play-state: paused` vía `:has(.pc:hover)`).
- La foto crece (`scale(1.06)`) y se oscurece un poco.
- Aparece al centro la **cápsula blanca "Ver detalles ↗"**, que abre el Detalle.
- Al salir, la fila sigue moviéndose.
- Con teclado pasa lo mismo al enfocar.
- En móvil, tocar la foto la enfoca: se detiene y muestra la cápsula.

**Indicador de posición** debajo de cada fila: `‹ — — — — ›`.
- Hay una rayita por producto distinto, de 18 px con 5 px de separación, en `#3a3a3f`.
- Una **rayita blanca** avanza un paso por cada tarjeta que pasa (`steps(n)`), en el mismo sentido que su fila, y **se detiene junto con la fila**.
- Las flechas corren la fila y su rayita **una tarjeta hacia el lado de la flecha**: › hacia la derecha, ‹ hacia la izquierda.
- En el lienzo esto se simula cambiando `animation-delay`, así que salta. **En la app debe deslizarse:** llevar el desplazamiento con `requestAnimationFrame` (un offset en px) y calcular la rayita activa con la posición real de la fila.

Con `prefers-reduced-motion: reduce` las cintas quedan quietas y se recorren con las flechas.

### 2. Barra de filtros (sticky)

Igual que en Servicios: chips de categoría (Todos + una por categoría), buscador "Buscar producto…" y conteo.

### 3. Catálogo

Es **idéntico a las categorías de Servicios**:
- **En "Todos"** (sin búsqueda): una fila por categoría con su nombre en Heavitas, "N productos" y **Ver todo (N) →**. Muestra los **4 primeros**. En móvil la fila se desliza de lado y termina en una tarjeta "Ver los N →".
- **Al elegir una categoría** (con el chip o con Ver todo): grilla completa de esa categoría y **← Todas las categorías**.
- **Al buscar:** una sola grilla, sin agrupar.
- **Grilla:** 4 columnas en escritorio y **2 en móvil** (antes eran 3). Tocar la tarjeta o la flecha abre el Detalle.

### 4. Cómo comprar

3 pasos en bloques:
1. Elige tus productos.
2. Confirma tu pedido: cupón, Yape/Plin/transferencia y comprobante.
3. Recoge o recibe.

### 5. ¿No encuentras tu producto?

Por ahora es solo estético. Lleva el título en Heavitas, el horario a la derecha y 3 tarjetas: **WhatsApp**, **Contacto y ubicación** y **Preguntas frecuentes** ("Muy pronto").

### 6. Barra flotante "Tu carrito"

"N productos en tu carrito · S/ total · Ver carrito →". Va portaleada dentro de `.landing-web`, igual que `BarraTuCitaFlotante.jsx`.

### Animación de entrada

Usa el patrón estándar: `useEntornoAnimacion` + `useRevelarEnPantalla`, ver `docs/patrones/animacion-entrada.md`. Las clases `.in-left` / `.in-right` / `.in-up` / `.in-photo` son las mismas de Servicios.

| Elemento | Clase | Escritorio | Móvil |
|---|---|---|---|
| "Novedades y lo más vendido" | `.in-left` | 150 ms | 350 ms |
| Fotos del inicio | `.in-photo` | 200 ms | 100 ms |
| Bloque de texto que rota | `.in-left` | 300 ms | 480 ms |
| Botones del inicio | `.in-left` | 500 ms | 650 ms |
| Línea "Catálogo / …" | `.in-left` | 650 ms | 780 ms |
| Frase de ofertas | `.in-left` | 800 ms | 900 ms |
| Fila Ofertas | `.in-left` | 900 ms | 1000 ms |
| Fila Destacados | `.in-right` | 1100 ms | 1150 ms |
| Barra de filtros | `.in-up` | 1300 ms | 1400 ms |
| Filas de categoría | igual que Servicios (`ENTRADA`) | desde 1500 ms | desde 1600 ms |

Las filas de categoría que quedan bajo el primer pantallazo se animan al entrar en pantalla. La animación no se repite al filtrar ni al buscar.

## Pestaña Detalle del producto (Página 2)

Tiene la misma estructura que el Detalle del servicio, cambiada a datos de producto. El orden de arriba a abajo es el mismo en móvil, en una sola columna.

### 1. Ruta

"Productos / Categoría / Producto" y **← Volver a productos**.

### 2. Galería

- **Escritorio:** miniaturas a la izquierda y foto de 760 px de alto.
- **Móvil:** foto a todo el ancho (460 px) con volver / compartir / favorito encima, y miniaturas de 64 px debajo.
- Etiquetas de las fotos: **Frente / Textura / En uso / Detrás**.
- Carrusel **cada 5 s** con fundido y barras de progreso, flechas y contador. Tocar una miniatura, una flecha o una barra reinicia el conteo.
- Etiqueta "Oferta −X%" si aplica.

### 3. Información (columna derecha en escritorio)

**Encabezado:**
- Categoría · subcategoría y nombre en Heavitas.
- **Precio**, precio anterior tachado, "Ahorras S/ X" y "Precio de oferta hasta el [DD/MM]".
- Descripción.

**Presentación:** chips (250 ml / 500 ml). Cada una tiene su precio, precio anterior, stock y rendimiento, y al elegirla cambian precio, stock y datos.

**4 datos clave:**
- **Stock:** punto verde; **ámbar** (`#e0a64a`) si quedan 5 o menos; gris si está agotado.
- **Contenido.**
- **Entrega:** "Recojo gratis en el local / o envío a [ZONA] · [S/ X]".
- **Rinde.**

**Cantidad `− 1 +` + "Agregar al carrito · S/ total"** (precio × cantidad):
- **Se mantiene el comportamiento actual de `ProductosCliente.jsx`:**
  - el tope es `stock_actual − cantidadEnCarrito`;
  - la cantidad elegida se recorta sola si baja el disponible;
  - al agregar vuelve a 1;
  - se usan `agregarProducto(id, cantidad)` y los mensajes de "Solo se agregaron N".
- Tras agregar, el botón dice "Agregado al carrito ✓" durante unos 2 s y además sale el `useToast()`.
- Si ya está todo el stock en el carrito: botón desactivado, "Ya tienes todo el stock". Si el producto está agotado: "Agotado".
- Debajo va una nota: "Ya tienes N de 250 ml en tu carrito · quedan M para agregar", o el texto de pago si no tiene ninguno.

**Otros botones:** **Comprar ahora** (agrega y va a Carrito), **favorito** (`favoritos_productos`, ya existe) y **compartir por WhatsApp** (el texto actual de `compartir()`).

**Enlace:** "¿Dudas sobre este producto? Escríbenos por WhatsApp".

**3 íconos de línea:**
- **+N puntos** "con esta compra". El lienzo asume 1 punto por cada S/ 10; confirmar con `config_puntos`.
- **4.8 · 24 reseñas / Ver reseñas →**, que lleva a `#resenas`.
- **Lo usamos en el salón.** Reemplaza al sello de fidelidad de servicios.

**Móvil:** barra inferior fija con precio (y tachado) + "Agregar · S/ X".

### 4. Pago · entrega · cambios

Franja de 3 datos:
- **Pagas al confirmar tu pedido:** Yape, Plin o transferencia, comprobante y cupones.
- **Recojo gratis o envío a [ZONA]:** aviso en Notificaciones, costo y plazo del envío.
- **Cambios hasta [7 días] después:** solo con el producto sellado.

### 5. Cómo se usa

4 pasos numerados (Lava, Aplica, Deja actuar, Enjuaga) + "Frecuencia: 1 vez por semana".

### 6. ¿Es para ti?

Dos bloques con 4 puntos cada uno: **Ideal para** y **Tips y precauciones**.

### 7. Especificaciones · Ingredientes clave · Libre de

- **Especificaciones:** Marca, Contenido, Tipo de cabello, Aroma, Vence, Registro sanitario.
- **Ingredientes clave:** nombre + para qué sirve.
- **Libre de:** sulfatos, parabenos, etc.

### 8. Reseñas

`id="resenas"`. Muestra el promedio, las estrellas, la distribución 5→1, **Escribir una reseña**, **Ver las N reseñas** y 3 reseñas con la etiqueta "Compra verificada". En móvil las reseñas se deslizan de lado.

Regla: "Solo pueden reseñar las clientas que compraron este producto."

### 9. Se suele comprar junto con

Combo del producto + otro (en el ejemplo, protector térmico), con el total juntos y **Agregar los dos al carrito**. Al agregar, el botón cambia a "Agregados al carrito ✓".

### 10. También te puede interesar

4 productos de la misma categoría con la tarjeta del catálogo y "Ver todo (N)".

### 11. Barra flotante "Tu carrito"

En escritorio, igual que en Productos.

## Pendiente de decidir

- Productos del inicio: elegidos a mano o los más vendidos.
- Cómo se marca "Destacado" y "Nuevo": ¿a mano en el POS, o "Nuevo" según la fecha de alta?
- Regla de puntos por producto.
- Quién puede reseñar (¿solo quien tiene un `pedidos_web` entregado con ese producto?).
- Datos de ejemplo a reemplazar: [ZONA], [S/ X], [1–2 días], [7 días], [DD/MM], [MARCA], [MM/AAAA], [N.º DIGESA], [DIRECCIÓN], [TELÉFONO], descripciones, ingredientes, pasos de uso y reseñas.

## Backend que falta (Supabase): preguntar antes de cada migración

> **Ojo:** `productos` da `SELECT` **por columna** (para ocultar `costo`). Cada columna nueva necesita `grant select (col) on productos to authenticated`; si no, la primera consulta que la pida responde 403 **entera**. Ver `CLAUDE.md`.

**Productos (Página 1):**
- `productos.destacado` (boolean, manual desde el POS, editable en `ModalProducto.jsx`).
- Ofertas: **ya existe** `precio_antes` (`104_precio_antes_productos.sql`).
- `productos.subcategoria` (text) para la etiqueta de la tarjeta, o reutilizar otra columna.
- Inicio: `productos.en_inicio` (boolean) + texto corto, o calcular "lo más vendido" con los pedidos de los últimos 30 días usando una función `security definer`, como `servicios_mas_pedidos()`.

**Detalle (Página 2):**
- `productos.descripcion`, `contenido`, `rinde`, `marca`, `aroma`, `tipo_cabello`, `vence`, `registro_sanitario`.
- Uso y cuidados: `modo_uso` (jsonb con pasos), `frecuencia`, `ideal_para` (text[]), `tips` (text[]).
- `ingredientes` (jsonb: nombre + para qué sirve) y `libre_de` (text[]).
- **`producto_fotos`**: varias fotos por producto, con etiqueta Frente/Textura/En uso/Detrás y orden. Hoy solo existe `productos.foto_url`. Seguir el patrón de `lib/imagenes.js`.
- **Presentaciones:** tabla `producto_variantes` (etiqueta, precio, precio_antes, stock_actual), o seguir con un producto por tamaño. Afecta al carrito y a `pedidos_web`, así que decidirlo antes.
- `productos.oferta_hasta` (date) para "Precio de oferta hasta el…".
- **Reseñas por producto:** hoy `resenas` es una reseña por clienta. Hace falta `producto_id` y validar que lo compró con una función `security definer`, como `guardar_mi_resena_servicio()`.
- Combo sugerido: `productos.combo_con` (id) o calcular el par más comprado junto en `pedidos_web`.
- Favoritos **ya existe** (`favoritos_productos`, `84_productos_favoritos.sql`).
- Recordar: toda tabla nueva necesita un GRANT explícito además de RLS.
