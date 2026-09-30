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

- Estilo de la web del cliente: `.landing-web`, `--lw-gold` (= azul metálico `#a9c6ec`), fondo `#0b0b0c`; rosa `--lw-rose` (`#ff85a1`) solo en el puntito de las etiquetas.
- Tipografías: **Kunaroh** en el logo y el título del hero ("Belleza que transforma", ya existe como `.lw-titulo-kunaroh`); **Heavitas** en títulos de sección, en **blanco sólido** y mayúsculas; el resto con la fuente actual.
- Bloques: fondo `#111113`, borde `1px #1f1f22`, radio `10px`, `box-shadow: inset 0 1px 1px rgba(255,255,255,.06)`.
- Botón principal: azul metálico con texto negro (el hero conserva su `.lw-cta-hero` actual). El verde `#3ECF6A` **no** se usa en el Inicio.
- Tarjeta de servicio: la misma de Servicios (`TarjetaServicioCliente.jsx`), no la iridiscente.
- Confirmaciones con `useToast()`. Flechas de desplegables `ArrowBigDown`. Esc cierra modales.
- Entrada de la página ("se arma sola"): seguir `docs/patrones/animacion-entrada.md` con `useEntornoAnimacion` / `useRevelarEnPantalla`; clases y retrasos en `<helmet><style>` y en los `animation-delay` inline de los `.dc.html`.

## Orden de la pestaña (arriba → abajo)

1. **Hero** — se conserva la foto y el efecto antes/después **que ya existe** (`useRevelarAntes`: círculo bajo el cursor, hint "Pasa el cursor. Mira su antes."; en celular solo la foto "después", como hoy). **No reemplazarlo.** Lo nuevo:
   - Etiqueta arriba del título: "Uñas · Pestañas · Cejas · Micropigmentación" (móvil: "… · Micro").
   - Bajo el título: "Tu salón de belleza en Av. Argentina. Reserva en línea en un minuto y paga el saldo en el local."
   - Dos botones: **Reserva tu cita** (→ `/citas`) y **Ver servicios** (→ `/servicios`, borde).
   - Línea de confianza con borde superior: ★ promedio · N reseñas (de `resenas_publicas()`), horario (`horario_atencion()`, con los dos bloques) y "Abierto ahora" (`EstadoNegocioContext`). Cada dato se oculta si no existe.
   - Se quita la migaja "Inicio" bajo el menú y la banda negra vacía que hoy queda bajo el hero.
2. **Tira personal** — "Hola, [nombre]" + próxima cita pendiente (fecha · hora · servicio) con **Ver cita**, o "No tienes citas pendientes. ¿Agendamos la próxima?" con **Reservar**; a la derecha los puntos (`mis_puntos()`). Staff en "modo cliente" también la ve.
3. **Promoción activa** — justo bajo la tira; **solo si hay una promoción activa y vigente** (`promociones.activo` y `vigente_desde ≤ hoy ≤ vigente_hasta`; si hay varias, la que vence antes). Cupón: `valor` grande (% o S/ según `tipo_descuento`) a la izquierda con separador punteado, "Promoción activa · hasta [vigente_hasta]", `titulo`, `descripcion`, "Un uso por clienta".
   - Botón **Reclamar cupón** → crea el cupón en *Mis cupones* de la clienta (backend abajo) + `useToast()`.
   - Estado reclamado (también si ya lo había reclamado antes): chip "✓ Guardado en Mis cupones" + enlaces **Ver mis cupones** y **Reservar y usarlo →**.
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

**Comportamiento con el scroll (en el lienzo no se puede fijar la página; en la app sí):**

1. **Foto 1** arranca sola cuando la tarjeta "antes 1" se ve **completa** en pantalla (`IntersectionObserver`, threshold 1). La página sigue scrolleando normal.
2. Cuando la **fila entera queda centrada** en la pantalla, la página se **fija** ahí (se bloquea el scroll de la página: `wheel`/`touchmove` con `preventDefault`, listeners `{ passive: false }`; no usar `overflow: hidden` en `body`, que hace saltar el layout).
3. Con la página fijada, **cada gesto nuevo** de scroll hacia abajo dispara **una** foto. Gesto nuevo = rueda/trackpad tras una pausa > 220 ms sin eventos (así la inercia del trackpad no dispara varias); en celular, un `touchstart` nuevo. Un gesto que llega mientras una foto anima **se consume y no hace nada**: hay que volver a scrollear. Una foto que empezó **nunca se corta**. La siguiente se puede disparar a los 0.9 s.
4. Al terminar la foto 6 se **libera** el scroll y la página sigue normal.
5. Scroll hacia **arriba** mientras está fijada: se libera la página sin animar (no queda atrapada).
6. Terminada, **queda fija**: subir, bajar o volver a pasar no repite nada mientras se siga en el Inicio. **Decidido por el usuario: se repite cada vez que la clienta entra al Inicio** (nuevo montaje de la ruta); **no** guardar en `sessionStorage`.
7. Mientras está fijada, bajo el título (a la derecha en escritorio, debajo de la grilla en móvil) se ven 6 puntitos de avance (azul = ya cayó) y "Sigue deslizando", con `aria-live="polite"`.

Recomendado: sacar esto a un hook propio (p. ej. `src/hooks/useSecuenciaScroll.js`) y documentarlo en `docs/patrones/` si se va a reusar.

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
