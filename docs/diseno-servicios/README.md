# Diseño de Servicios y Detalle del servicio — portal cliente (web)

Diseño aprobado para:

- rediseñar `src/pages/cliente/ServiciosCliente.jsx` (pestaña **Servicios**), y
- crear una pestaña nueva **Detalle del servicio** (hoy no existe; se abre desde las tarjetas de Servicios).

Lienzo original (interactivo, con botón Play): https://claude.ai/artifact/GKx2pPqcAkf3E5f5TgHQ1V — Página 1 = Servicios, Página 2 = Detalle.

## Archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `Main.dc.html` | Servicios en escritorio (1440 px). **Referencia principal de Servicios.** |
| `Movil.dc.html` | Servicios en móvil (390 px). |
| `DetalleServicio.dc.html` | Detalle del servicio en escritorio (1440 px). **Referencia principal del Detalle.** |
| `DetalleMovil.dc.html` | Detalle del servicio en móvil (390 px). |
| `canvas.json` | Índice del lienzo; sus `notes` resumen el orden de cada pantalla y lo que falta en backend. |

Los `.dc.html` son el formato del editor de diseño: HTML con `{{holes}}`, `<sc-if>`, `<sc-for>` y la lógica en el bloque `class Component extends DCLogic` al final (datos de ejemplo + cálculos). **No se pegan tal cual en React**: se usan como especificación de estructura, estilos (inline y en `<helmet><style>`) y comportamiento. No abren solos en el navegador (falta el runtime `support.js`); para verlos, usar el enlace del lienzo. Las imágenes y fuentes apuntan a `/_blob/...` del lienzo; en la app se usan las fotos reales del bucket `fotos-servicios` y las fuentes de `src/assets/fonts/`.

## Reglas de estilo (ya definidas por el usuario)

- Estilo de la web del cliente: `.landing-web`, `--lw-gold` (= azul metálico `#a9c6ec`), fondo `#0b0b0c`, rosa `--lw-rose` solo en el puntito de las etiquetas.
- Tipografías: **Heavitas** para títulos importantes (título del hero, nombre de categoría, nombre del servicio en el detalle, títulos de sección) en **blanco sólido** y mayúsculas; el resto con la fuente actual (Inter).
- Bloques: fondo `#111113`, borde `1px #1f1f22`, radio `10px`, `box-shadow: inset 0 1px 1px rgba(255,255,255,.06)`.
- Tarjeta de servicio: foto cuadrada radio **10px**, etiquetas de subcategoría con radio **5px** abajo a la izquierda, botón circular blanco con flecha **↗** abajo a la derecha. Sin corazón ni "Agregar" en la tarjeta.
- Botón principal: azul metálico con texto negro y círculo negro con ícono a la derecha. El verde `#3ECF6A` **no** se usa aquí (solo CTAs finales tipo Confirmar pedido); en el detalle solo aparece como puntito de estado ("4 disponibles").
- Flecha de desplegables (si se usa alguno): `ArrowBigDown`. Confirmaciones con `useToast()`. Esc cierra modales.

## Pestaña Servicios (Página 1)

Orden de arriba a abajo:

1. **Hero "Tendencias y lo más pedido"** (3–5 servicios).
   - Izquierda: texto fijo "Tendencias y lo más pedido", y un bloque que **cambia junto con la foto**: etiqueta (**En tendencia** / **Lo más pedido**), nombre del servicio (Heavitas), descripción específica de ese servicio y "desde S/ X · N min".
   - El cambio de texto no es brusco: el que sale se desvanece hacia arriba y el que entra sube desde abajo pasando de borroso a nítido, escalonado (etiqueta → título → descripción). Los textos se apilan en la misma celda de grid para que los botones no salten.
   - Botones fijos: **Reservar cita** y **Ver detalles** (→ Detalle del servicio que se está mostrando).
   - Línea fija: "Catálogo / N servicios · desde S/ X · Lun–Sáb 9:00–20:00".
   - Derecha: foto que cambia **cada 5 s con fundido** (no carrusel continuo), barras de progreso arriba (clic = ir a esa foto y reiniciar el conteo), abajo "01 / 03" y precio. En móvil la foto va arriba y el texto debajo.
2. **Barra de filtros** (sticky en la app): chips de categoría (Todos + una por categoría), buscador y conteo. Sin "Favoritos" (va en el detalle).
3. **Catálogo**:
   - En **Todos** (sin búsqueda): **una fila por categoría** con su nombre (Heavitas), "N servicios" y **Ver todo (N) →**; muestra solo los **4 primeros**. En móvil la fila se desliza de lado y termina con una tarjeta "Ver los N →".
   - Al elegir una categoría (chip o Ver todo): grilla completa de esa categoría + **← Todas las categorías**.
   - Al buscar: resultados en una sola grilla, sin agrupar.
   - Grilla: 4 columnas en escritorio, 2 en móvil. Tocar la tarjeta o la flecha abre el Detalle.
   - Servicio sin foto: degradado con los colores de su categoría (variado por id), no un ícono gris.
4. **Cómo reservar**: 3 pasos en bloques.
5. **"¿No encuentras tu servicio?"** (solo estético por ahora): título Heavitas + "¿En qué podemos ayudarte hoy?…", a la derecha "Lun–Sáb 9:00–20:00", y 3 tarjetas: **WhatsApp**, **Contacto y ubicación**, **Preguntas frecuentes** ("Muy pronto", borde punteado; la pestaña de FAQ se hará después).
6. **Barra flotante "Tu cita"** (N servicios · S/ total · Reservar → Citas) cuando hay servicios agregados.

### Animación de entrada (al cargar o refrescar la pestaña)

La página no aparece de golpe: cada bloque llega a su lugar con tiempos distintos, como si se armara. Valores exactos en `Main.dc.html` / `Movil.dc.html` (clases `.in-left`, `.in-right`, `.in-up`, `.in-photo` en `<helmet><style>` y la constante `ENTRADA` en la lógica).

Keyframes (todas con `cubic-bezier(.2,.7,.2,1)` y `animation-fill-mode: both`):

| Clase | Desde | Duración |
|---|---|---|
| `.in-left` | `opacity 0`, `translateX(-40px)`, `blur(8px)` | 0.9s |
| `.in-right` | `opacity 0`, `translateX(40px)`, `blur(8px)` | 0.9s |
| `.in-up` | `opacity 0`, `translateY(32px)` (sin blur) | 0.8s |
| `.in-photo` | `opacity 0`, `translateX(48px) scale(1.03)`, `blur(14px)` | 1.3s |

Todas terminan en `opacity 1`, sin desplazamiento y sin blur.

Orden y retrasos (`animation-delay`):

| Elemento | Clase | Escritorio | Móvil |
|---|---|---|---|
| "Tendencias y lo más pedido" | `.in-left` | 150 ms | 350 ms |
| Foto del hero (contenedor) | `.in-photo` | 200 ms | 100 ms (va arriba, aparece primero) |
| Bloque etiqueta + título + descripción (el contenedor grid; sus hijos conservan su transición del carrusel) | `.in-left` | 300 ms | 480 ms |
| Botones Reservar cita / Ver detalles | `.in-left` | 500 ms | 650 ms |
| Línea "Catálogo / N servicios…" | `.in-left` | 650 ms | 780 ms |
| Barra de categorías (sticky) | `.in-up` | 800 ms | 900 ms |
| Encabezado de la fila `gi` (nombre + Ver todo) | `.in-left` | 1000 + gi·220 ms | 1050 + gi·220 ms |
| Tarjeta `k` de la fila `gi` | escritorio: k 0–1 `.in-left`, k 2–3 `.in-right` · móvil: todas `.in-right` | encabezado + 120 + k·90 ms | igual |
| Tarjeta final "Ver los N" (solo móvil) | `.in-right` | — | encabezado + 120 + 4·90 ms |

Reglas para la app:
- Las filas de categoría que quedan **debajo del primer pantallazo** no se animan al cargar: se animan cuando entran en pantalla (IntersectionObserver, una sola vez). En ese caso el retraso de la fila se cuenta desde que entra (encabezado 0 ms, tarjetas 120 + k·90 ms), no desde la carga.
- La animación corre solo al montar la pestaña (cargar o refrescar). **No** se repite al cambiar de categoría, al buscar ni cuando cambia la foto del hero. En la vista de una categoría o de búsqueda, las tarjetas no llevan animación de entrada.
- Con `prefers-reduced-motion: reduce`: sin animación, todo visible desde el inicio.
- No debe haber saltos de layout: la animación solo usa `opacity`, `transform` y `filter`.

Cambios frente a la versión actual: sale la tarjeta iridiscente con inclinación 3D (queda un zoom suave de la foto en hover); corazón, "Agregar" y compartir por WhatsApp salen de la tarjeta y pasan al Detalle; sale el filtro Favoritos; móvil pasa de 3 a 2 columnas.

## Pestaña Detalle del servicio (Página 2)

Orden de arriba a abajo (móvil: mismo orden en una columna):

1. **Ruta** "Servicios / Categoría / Servicio" + **← Volver a servicios**.
2. **Galería grande** (escritorio: miniaturas a la izquierda + foto de 820 px de alto; móvil: foto a todo el ancho con volver/compartir/favorito encima). Carrusel **cada 5 s** con fundido y barras de progreso; miniaturas con etiqueta (**Resultado / Antes / Después**), flechas y contador. Tocar miniatura, flecha o barra reinicia el conteo.
3. **Tarjeta de información** (derecha en escritorio):
   - Categoría · subcategoría, nombre (Heavitas), **desde S/ X** + "El precio final depende del largo y grosor del cabello".
   - Descripción.
   - 4 datos clave: **Duración**, **Cupos esta semana** (equivale al "stock" de un producto; punto verde), **A domicilio** (equivale al "envío"; "Solo en el local" en gris, o "Gratis en [ZONA]" en verde si aplica), **El resultado dura**.
   - **Agregar a mi cita** (principal; al tocarlo pasa a "Agregado a tu cita ✓" con fondo transparente), **Reservar ahora**, favorito (corazón) y compartir.
   - Enlace "¿Dudas sobre este servicio? Escríbenos por WhatsApp".
   - 3 íconos de línea simples, sin bordes: **medalla con estrella** "+28 puntos / Ganas 28 puntos", **estrella** "4.9 · 32 reseñas / Ver reseñas →" (lleva a la sección de reseñas), **sello con check** "Suma sello / de fidelidad". Variante sugerida si no suma: mismo ícono en gris + "No suma sello".
   - Móvil: barra inferior fija con precio + Agregar a mi cita.
4. **Adelanto y pago** (franja de 3 datos):
   - **Adelanto obligatorio para separar tu cita**: mínimo [S/ X] o el total; por Yape, Plin o transferencia; se descuenta del total.
   - **Cambios o cancelación hasta [24 h] antes**; después el adelanto no se devuelve.
   - **El saldo lo pagas en el local**: efectivo, Yape, Plin, transferencia o **tarjeta de crédito/débito solo en físico** (aún no hay pasarela).
5. **Cómo es el servicio**: barra de duración dividida por pasos (anchos proporcionales a los minutos; la suma = duración) + 4 columnas con paso, minutos y explicación.
6. **Cuidados antes y después**: dos bloques ("Antes de tu cita" / "Después de tu cita") con 4 indicaciones cada uno.
7. **Especificaciones técnicas · Herramientas usadas · Materiales usados** (3 bloques; marcas como [MARCA]).
8. **Reseñas** ("Lo que dicen nuestras clientas", `id="resenas"`): promedio grande + estrellas + distribución 5→1, botones **Escribir una reseña** (azul) y **Ver las N reseñas**, nota "Solo pueden reseñar las clientas que ya se hicieron este servicio" (confirmar la regla), y 3 reseñas con inicial, nombre, fecha, estrellas y "Clienta verificada" (en móvil, deslizables).
9. **Se suele reservar junto con**: combo (servicio + otro), total juntos y duración, botón **Agregar los dos a mi cita** (la barra "Tu cita" pasa a 2 servicios).
10. **También te puede interesar**: 4 servicios de la misma categoría con la tarjeta de Servicios + "Ver todo".
11. Barra flotante "Tu cita" (escritorio) igual que en Servicios.

## Pendiente de decidir

- Orden de los servicios dentro de cada fila de categoría: campo manual (`servicios.orden`) o los más pedidos primero.
- Regla de puntos por servicio (el mockup asume 1 punto por cada S/ 10; hay `config_puntos` en `88_puntos.sql`).
- Quién puede reseñar (¿solo quien tuvo una cita de ese servicio?).
- Monto mínimo del adelanto y plazo de cancelación reales.
- Datos de ejemplo a reemplazar: [S/ X], [24 h], [ZONA], [DIRECCIÓN], [TELÉFONO], [MARCA], número de WhatsApp, reseñas y textos de cuidados.

## Backend que falta (Supabase) — preguntar antes de cada migración

Servicios:
- `servicios.descripcion` (text), editable en `ModalServicio.jsx` del POS.
- `servicios.en_tendencia` (boolean, manual desde el POS) + texto corto para el hero (o reutilizar `descripcion`).
- "Lo más pedido": calcular con las citas de los últimos 30 días; sin columna nueva.
- Orden: `servicios.orden` (int) si se elige orden manual.

Detalle:
- `servicio_fotos` (varias fotos por servicio, con etiqueta Resultado/Antes/Después y orden). Hoy solo existe `servicios.foto_url`.
- `servicios`: `a_domicilio` (bool) + `costo_domicilio`, `duracion_resultado`, `precio_variable` (bool) + nota de precio.
- Pasos del servicio (nombre, minutos, explicación), especificaciones, herramientas, materiales y cuidados antes/después: `jsonb` en `servicios` o tablas `servicio_pasos` / `servicio_materiales`.
- Cupos de la semana: calcular con el horario de atención (`74_horario_atencion.sql`) y las citas; no es un stock guardado.
- Combo sugerido: `servicios.combo_con` (id) o calcular el par más reservado junto.
- Adelanto mínimo y plazo de cancelación configurables por el negocio (ya existe adelanto/abono en citas, `82_citas_adelanto.sql`).
- **Reseñas por servicio**: hoy `resenas` (`86_resenas.sql`) es una reseña por clienta, sin servicio. Para el promedio y la lista del detalle hace falta `servicio_id` (y, si se decide, validar que tuvo una cita de ese servicio).
- Favoritos ya existe (`favoritos_servicios`, `68_servicios_favoritos.sql`).
- Recordar: toda tabla/columna nueva necesita GRANT explícito además de RLS.
