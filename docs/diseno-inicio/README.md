# Diseño del Inicio — portal cliente (web)

Diseño aprobado para rediseñar `src/pages/cliente/InicioCliente.jsx` (pestaña **Inicio**, lo primero que ve la clienta).
Lienzo original (interactivo, con botón Play): https://claude.ai/artifact/1VYQ89nBzJVc48NpUY5M1x

## Archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `Main.dc.html` | Inicio en escritorio (1440 px). **Referencia principal.** |
| `Movil.dc.html` | Inicio en móvil (390 px). |
| `canvas.json` | Índice del lienzo; sus `notes` resumen el orden, los cambios vs. lo actual, el backend que falta y la animación de "Resultados reales". |

Los `.dc.html` son el formato del editor de diseño: HTML con `{{holes}}`, `<sc-if>`, `<sc-for>` y la lógica en el bloque `class Component extends DCLogic` al final (datos de ejemplo + cálculos). **No se pegan tal cual en React**: se usan como especificación de estructura, estilos (inline y en `<helmet><style>`) y comportamiento. No abren solos en el navegador (falta el runtime `support.js`); para verlos, usar el enlace del lienzo. Imágenes y fuentes apuntan a `/_blob/...` del lienzo; en la app se usan `public/inicio-web/*` y `src/assets/fonts/`.

Todo lo que aparece **[entre corchetes]** es un dato real que sale de la base de datos o que el negocio todavía no cargó. **No inventar** reseñas, fotos, promociones ni números: si el dato no existe, la sección (o la línea) no se muestra.

## Reglas de estilo (ya definidas por el usuario)

### Cupones compartidos — 2026-10-16

El diseño de papel de Inicio ahora se comparte con las tarjetas de cupones
del portal y POS mediante `EnvolturaCupon.jsx`. Las cinco paletas proceden
de `public/diseñosPropios/rediseñoCupon.html`: Especial, Plata, Oro,
Diamante y Verde. Conserva el brillo del importe, muescas, desplegable,
estados reales y acciones de cada pantalla. Sin estrellitas ni cambios
de permisos/canje/backend. Detalles en `implementacionesWed.md`.

### Fotos del hero — actualización 2026-10-15

En `public/inicio-web` quedan únicamente los cuatro WebP entregados por el usuario:

| Tema | Antes | Después |
|---|---|---|
| Oscuro | `hero-antes-oscuro.webp` | `hero-despues-oscuro.webp` |
| Claro | `hero-antes-claro.webp` | `hero-despues-claro.webp` |

Todos tienen **3024×1698 px** y se sirven directamente, sin `srcset`, `sizes`,
conversión ni compresión adicional. Se corrigió solo el nombre `osucuro` a
`oscuro`. La comparación SHA-256 confirmó que los cuatro contenidos siguen
intactos. Pesos originales: antes claro 432420 bytes, antes oscuro 495490,
después claro 500278 y después oscuro 479236 (todos por debajo de 500 KiB;
el después claro supera por 278 bytes los 500 kB decimales).

Se retiraron las 19 imágenes antiguas y el script
`scripts/generar-hero-responsivo.mjs`: ya no deben regenerarse variantes. Para
otra campaña, sustituir estos cuatro archivos por los nuevos WebP preparados,
conservar los nombres y actualizar los atributos width/height si cambian las
dimensiones. Después publicar la web siguiendo su proceso habitual.

`resolverUrlGaleria` conserva compatibilidad con las rutas relativas antiguas
usadas por la fila de ejemplo de la migración 98: las traduce al WebP actual.
No se editan migraciones aplicadas ni filas de Supabase. Las herramientas que
leían archivos locales usan los nombres actuales; los casos de rutas históricas
conservan la entrada anterior y verifican su traducción. No se ejecutaron las
herramientas que suben datos a R2 o staging.

Comprobación local: dos descargas por tema, 3024×1698 en móvil DPR2 y PC, cambio
de tema y revelado antes/después. Se conservan los fetchPriority high/low y el
encuadre/layout del hero. La carga móvil aumenta respecto a las variantes
pequeñas anteriores: cada par original pesa aproximadamente 0.93–0.97 MB.

- Estilo de la web del cliente: `.landing-web`, `--lw-gold` (= azul metálico `#a9c6ec`), fondo `#0b0b0c`; rosa `--lw-rose` (`#ff85a1`) solo en el puntito de las etiquetas.
- Tipografías: **Kunaroh** en el logo y el título del hero ("Belleza que transforma", ya existe como `.lw-titulo-kunaroh`); **Heavitas** en títulos de sección, en **blanco sólido** y mayúsculas; el resto con la fuente actual.
- Bloques: fondo `#111113`, borde `1px #1f1f22`, radio `10px`, `box-shadow: inset 0 1px 1px rgba(255,255,255,.06)`.
- Botón principal: azul metálico con texto negro (el hero conserva su `.lw-cta-hero` actual). El verde `#3ECF6A` **no** se usa en el Inicio.
- Tarjeta de servicio: la misma de Servicios (`TarjetaServicioCliente.jsx`), no la iridiscente.
- Confirmaciones con `useToast()`. Flechas de desplegables `ArrowBigDown`. Esc cierra modales.
- Entrada de la página ("se arma sola"): seguir `docs/patrones/animacion-entrada.md` con `useEntornoAnimacion` / `useRevelarEnPantalla`; clases y retrasos en `<helmet><style>` y en los `animation-delay` inline de los `.dc.html`.

## Orden de la pestaña (arriba → abajo)

Actualización visual 2026-10-15: el hero ya no muestra el horario, se retira
completa la tarjeta de saludo en móvil y PC, y las estrellas y el texto de
reseñas se alinean arriba del puntaje (`items-start`). Se eliminan de Inicio
las lecturas de próxima cita y puntos que solo alimentaban esa tarjeta;
la agenda, recompensas y el carrito conservan sus propias pantallas.
El horario sigue disponible en Visítanos y en el footer.

1. **Hero** — se conserva la foto y el efecto antes/después **que ya existe** (`useRevelarAntes`: círculo bajo el cursor, hint "Pasa el cursor. Mira su antes."; en celular solo la foto "después", como hoy). **No reemplazarlo.** Lo nuevo:
   - Etiqueta arriba del título: "Uñas · Pestañas · Cejas · Micropigmentación" (móvil: "… · Micro").
   - Bajo el título: "Tu salón de belleza en Av. Argentina. Reserva en línea en un minuto y paga el saldo en el local."
   - Dos botones: **Reserva tu cita** (→ `/citas`) y **Ver servicios** (→ `/servicios`, borde).
   - Sin línea de horario debajo de los botones; el horario se mantiene en Visítanos y en el footer.
   - Se quita la migaja "Inicio" bajo el menú y la banda negra vacía que hoy queda bajo el hero.
2. **Tira personal retirada** — ya no se muestra el saludo, la próxima cita ni el saldo en una tarjeta de Inicio, con o sin sesión.
3. **Promoción activa** — justo bajo el hero; **solo si hay una promoción activa y vigente** (`promociones.activo` y `vigente_desde ≤ hoy ≤ vigente_hasta`; si hay varias, la que vence antes). Actualizado al recibo rojo aprobado en `public/diseñosPropios/rediseñoCupon.html`: `CuponPromocionInicio` presenta los datos reales, contraído por defecto y centrado con ancho máximo 440 px. La cabecera muestra valor (% o S/), título, vigencia si existe y cápsula de estado; al abrir aparecen descripción, fecha y botón. Papel rosa mate, muescas, textura y brillo solo en el número; textos contraídos negros excepto número y cápsula.
   - Botón **Reclamar cupón** → crea el cupón en *Mis cupones* de la clienta (backend abajo) + `useToast()`.
   - Estado reclamado (también si ya lo había reclamado antes): cápsula «✓ Reclamado» y botón «Guardado en Mis cupones», ambos en verde `#3ECF6A` con texto negro. El botón de acción previo es negro con texto blanco; la confirmación solo depende de la respuesta real o del cupón leído, nunca de un temporizador visual.
   - El papel permanece entero al reclamar: sin rotura ni inclinación. Se conserva la apertura suave y se respeta movimiento reducido. En móvil, padding con las variables secundarias globales, excepto el propio botón. El diseño es compartido por todas las tarjetas de cupones del portal y POS.
   - Se conservan sesión, callback/RPC, carga y errores existentes. El componente se reinicia por cuenta y campaña. `vigente_hasta` de promoción es una fecha de calendario y se formatea sin restar un día por la zona horaria. Sin SQL nuevo, R2 ni despliegue.
4. **Lo más pedido** — 4 servicios de `servicios_mas_pedidos()` con foto (o degradado por categoría si no tiene), etiqueta "#N más pedido", categoría, precio "desde", flecha ↗; abre el detalle del servicio. 4 columnas escritorio / 2 móvil. "Ver todos los servicios →".
5. **Resultados reales** — 3 trabajos del salón, cada uno con foto **antes | después** y su nombre (escritorio: "Reservar este servicio"). Animación por scroll: ver sección siguiente. Móvil: 3 filas apiladas (170 px de alto) para que el bloque entero quepa en pantalla. Si no hay fotos reales cargadas, la sección no se muestra.
6. **Lo que dicen nuestras clientas** — promedio grande + estrellas + "N reseñas" + "Ver todas las reseñas →" y 3 reseñas reales (comentario, nombre, servicio). Móvil: fila deslizable. Si hay menos de 3 reseñas, no se muestra.
7. **Sobre nosotros** — reemplaza las 3 secciones actuales (`SeccionSobreNosotros`, `SeccionVideoDestacado`, `SeccionFilosofia` y su video/fotos de stock): foto real del equipo o del local, "Cuidado y confianza en cada cita", un párrafo y 3 pasos (Te escuchamos / A tu medida / Con detalle) + "Conoce al equipo →" (→ Nosotros). `SeccionServicios` ("Qué hacemos") también sale.
8. **Visítanos** — dirección, horario, teléfono (`datos_contacto()` / `horario_atencion()`), **Escríbenos por WhatsApp** (`numeroWhatsapp`) y **Cómo llegar** (Google Maps con la dirección) + mapa.
9. **Pie** — `PieClienteWeb` (ya muestra redes solo si están cargadas).

Se **quitó** el bloque "Explora por categoría" (decisión del usuario, escritorio y móvil).

## Animación de "Resultados reales" (lo más delicado)

Orden de las 6 fotos: **antes 1 → después 1 → antes 2 → después 2 → antes 3 → después 3**.

**Cada foto cae como un meteorito** (valores exactos en `<helmet><style>` de `Main.dc.html`: `.foto.espera`, `.foto.cae`, `@keyframes caer / destello / onda / sacudirA / sacudirB`):

- Antes de su turno: `opacity: 0`, pero **ocupa su espacio** (nada se mueve al aparecer).
- `caer` 0.75 s: parte en `scale(2.6)`, `opacity .12`, `blur(8px)`; **acelera** hacia su lugar (`cubic-bezier(.6,0,1,.4)`) hasta el 70 %, choca, se aplasta a `scale(.95)` (78 %), rebota a `1.015` (89 %) y se asienta.
- En el impacto (delay 0.52 s): destello blanco `opacity .35 → 0` (0.45 s), onda expansiva `2px #a9c6ec` que se abre 28 px y se desvanece (0.6 s), y **la fila se sacude** ~5 px 0.32 s (`sacA`/`sacB` se alternan por foto para que la animación se reinicie).
- `prefers-reduced-motion`: todo visible, sin animación y sin fijar la página.

**Comportamiento actualizado el 2026-10-15: inicio por scroll, continuación automática:**

1. **Foto 1** arranca sola cuando la tarjeta "antes 1" se ve **completa**. Se mide el contenedor de esa foto para que su transformación de caída no altere el disparador.
2. Cuando esa **primera tarjeta llega o cruza el centro** de la ventana, las demás fotos comienzan a caer solas. En móvil se mide la primera pareja, no el centro de toda la grilla apilada.
3. Entre comienzos de fotos del **mismo par hay 0.5 s**; entre el después de un par y el antes del siguiente hay **1 s**. El ritmo se repite para todos: 1→2 (0.5 s), 2→3 (1 s), 3→4 (0.5 s), 4→5 (1 s), 5→6 (0.5 s). Se respeta el tiempo transcurrido desde la primera caída y no se necesitan más gestos. Los efectos CSS conservan su duración, por lo que antes/después pueden solaparse durante la caída.
4. **El scroll permanece libre siempre**: sin fijar la página, sin interceptar rueda/touch/teclado y sin `preventDefault`. Si se salta el bloque entero con un scroll rápido, se revelan todas sin dejar una cola pendiente fuera de pantalla.
5. La secuencia se pausa al ocultar la pestaña y continúa al volver. Sus temporizadores y su `requestAnimationFrame` se cancelan al desmontar o cambiar la configuración.
6. Terminada, subir, bajar o volver a pasar no la repite en ese montaje. Volver a entrar a Inicio empieza una nueva secuencia, sin `sessionStorage`.
7. Los puntitos de avance se conservan sin el texto "Mostrando resultados" en ningún tamaño. Un `role="status"` con nombre accesible expresa cuántas fotos se han mostrado. Con menos de tres parejas o movimiento reducido, todas las fotos se muestran directamente.

Implementado en `src/hooks/useSecuenciaScroll.js`; los efectos CSS existentes se conservan.

Verificado localmente en navegador con StrictMode y carga diferida: avance
automático 1→6 y ritmo, móvil/PC, scroll libre, sin repetición en el mismo montaje,
pausa por visibilidad, limpieza de timers al desmontar, paso rápido sobre el
bloque y respaldo estático con una/dos parejas o movimiento reducido. Las pruebas
usan el hook y CSS reales con contenido ficticio, sin Supabase ni R2.

## Datos reales encontrados (2026-09-28)

- Más pedidos: Pedicure Gel (S/ 60), Micro lips Neutralización (S/ 350), Rubber gel (S/ 60), Depilación de rostro con navaja (S/ 15) — el negocio es sobre todo uñas, micropigmentación y depilación; la foto del hero es de cabello (stock), conviene cambiarla por un trabajo real.
- Ningún servicio tiene `foto_url` (por eso el degradado por categoría).
- Contacto: dirección guardada como "Av. Argentina H_ 12" (el diseño muestra "H-12": confirmar), teléfono 917160188, Instagram/Facebook/TikTok vacíos.
- Categorías duplicadas o de prueba: "Micropigmentacion" / "Micropigmentación", "catPrueba", servicio "serPrueba".

## Backend que falta (Supabase) — preguntar antes de cada migración

- **Reclamar cupón de una promoción** (siguiente número libre, hoy `127_…`):
  - `cupones.promocion_id uuid references promociones(id)` + índice único `(cliente_id, promocion_id)` → un cupón por clienta por promoción.
  - Nuevo origen `'PROMOCION'` en `cupones_origen_check` (hoy: `REFERIDO_BIENVENIDA`, `REFERIDO_RECOMPENSA`, `FIDELIZACION`; ver `97_cupones_fidelizacion.sql`).
  - `reclamar_cupon_promocion(p_promocion_id uuid)` **security definer** (`set search_path = public, pg_temp`, `grant execute … to authenticated`, `revoke … from public`): valida que la promoción esté activa y vigente, copia `valor` y `tipo_descuento`, genera `codigo`, estado disponible; si ya existe, devuelve el existente (idempotente).
  - Para el estado "Guardado": que el Inicio sepa si la clienta ya lo reclamó (la misma función en modo consulta, o un select de sus propios cupones por `promocion_id` — revisar RLS **y** GRANT de columna nueva).
  - Debe aparecer en *Mis cupones* (`src/lib/cupones.js`, `TarjetaCupon.jsx`, `OfertasCliente.jsx`) y poder usarse en Carrito/Ventas como los demás.
- **Galería antes/después**: de dónde salen las 3 parejas (¿reusar `98_galeria_web.sql` / `GaleriaWeb.jsx` con etiqueta antes/después y par?). Hasta tenerlas, la sección se oculta.
- Recordar: toda tabla/columna nueva necesita **GRANT explícito** además de RLS.
