# Diseño de Nosotros · Equipo — portal cliente (web)

Propuesta y prototipo para rediseñar la sección **Equipo** de la pestaña **Nosotros** (`src/pages/cliente/NosotrosCliente.jsx`). Es un diseño: no se tocó `src`. Todos los nombres y textos del lienzo son **ficticios**.

Lienzo editable (Play + barra «Solo prototipo»): https://claude.ai/artifact/TTCW2jkiqzz9zQUz4jqAsk

## Archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `Main.dc.html` | Equipo en escritorio (fluido, 1440 px). **Referencia principal**; contiene la lógica de ejemplo (escenarios, filtro). |
| `Movil.dc.html` | Equipo en móvil (390 px); importa `Main.dc.html` (la adaptación está en los `@media (max-width: 760px)` de `Main`). |
| `canvas.json` | Índice del lienzo y notas. |

Los `.dc.html` **no se pegan tal cual en React**: son especificación de estructura, estilos y comportamiento. No abren solos en el navegador (falta `support.js`); usar el enlace del lienzo. La barra «Solo prototipo» y los datos de ejemplo no forman parte de la web.

## Alcance

Solo cambia la sub-sección **Equipo** (`SeccionEquipo` / `TarjetaEquipo`) y el encabezado que la precede. Todos los nombres, cargos y cifras del lienzo (incluida «Jaise Ramírez») son ficticios. **No cambian** Galería, Reseñas ni Contacto, la sub-navegación en píldora (`SUBSECCIONES`, mismo estilo y misma lógica de `seccionActiva`) ni `PieClienteWeb`. Hoy el texto «Conoce al salón por dentro.» + la píldora quedan arriba de todas las sub-secciones; en este diseño el hero (título + texto + fichas) es **propio de Equipo**, así que hay que decidir si va dentro de `SeccionEquipo` o se muestra solo cuando `seccionActiva === 'equipo'`.

## Estructura (de arriba abajo)

Inspirada en la referencia editorial que pasó el usuario (título grande, texto, retrato a la izquierda, fichas «etiqueta · valor» a la derecha, y debajo una sección separada por línea fina). El usuario ya editó el lienzo: **quitó** la barra «Solo prototipo» de la vista final, la píldora de sub-navegación, la línea «Nosotros · Equipo» sobre el título y el encabezado «EQUIPO» con contador y chips de filtro de la sección de perfiles. La web debe respetarlo (la píldora de sub-navegación de hoy se mantiene en la app tal como está; el diseño solo no la dibuja).

1. **Hero**
   - Título **Heavitas** «Nuestro equipo» en mayúsculas, blanco sólido, sin cursiva ni degradado, y párrafo corto.
   - Fila inferior en 2 columnas (300 px | resto, gap 56). **Izquierda: retrato de la dueña** (300×400) que **rota entre varias fotos** (ver «Carrusel»), con su nombre y cargo («Fundadora y directora», `--lw-gold`, mayúsculas) debajo. **Derecha: ficha de la dueña**, cada fila `etiqueta (130 px, gris) · valor`: **Especialidad**, **Experiencia**, **Atiende**, **Sobre ella** (bio), **Horario** (`horario_atencion()`, mismo formato que Contacto) y **Síguenos**.
   - **Síguenos**: píldoras con el **logotipo original de cada red** (Instagram con su degradado, Facebook en azul `#1877F2`, TikTok blanco con el desplazamiento cian/rojo), 16 px, más el nombre. Sirven los SVG del lienzo; solo se muestran las redes con URL en `datos_contacto()`.
   - **Sin botón «Reservar cita»** (el usuario pidió quitarlo; en el lienzo también se quitó del cierre).
2. **Equipo** (línea fina arriba): directamente la **grilla de perfiles** (sin encabezado ni chips).
   - Grilla: 3 columnas en escritorio (tweak «columnas» 2–4; hoy la web usa hasta 4), gap 36×24; en móvil 1 columna.
   - **Tarjeta** (`liquid-glass`, esquinas rectas como hoy): foto 4:5 con número `01…` arriba a la izquierda; debajo nombre (18 px, semibold), especialidad (11 px, mayúsculas, tracking `.14em`, `--lw-gold`) y bio (14 px, `text-white/60`). Zoom suave de la foto al pasar el cursor (`scale(1.04)`, 0,6 s; sin movimiento con `prefers-reduced-motion`).
   - **Móvil**: la tarjeta pasa a fila (foto 112 px a la izquierda con altura mínima 150, texto a la derecha); el hero se apila (foto 5:4 a todo el ancho) y las etiquetas de las fichas bajan a 96 px.
3. **Cierre** (línea fina arriba): «¿Lista para tu cita?» (Heavitas 28 px) + texto y solo el botón **Escríbenos por WhatsApp** (borde `--lw-gold`, igual que en Contacto; solo si hay teléfono cargado).

### Carrusel de fotos de la dueña

- Varias fotos apiladas en el mismo recuadro; cambia de foto **cada 4,5 s** con un **fundido cruzado suave** (`opacity` 1,8 s `ease-in-out`) y un acercamiento leve de la foto que entra (`scale` 1,05 → 1 en 7 s). Solo `opacity`/`transform`.
- Tres barras finas abajo (3 px, blanca la activa, 1,2 s de transición de color); clic en una salta a esa foto y reinicia el temporizador.
- Foto inactiva con `aria-hidden`. Limpiar el `setInterval` al desmontar. Con `prefers-reduced-motion` se mantiene solo el fundido (sin zoom). Con una sola foto, sin rotación ni barras; sin ninguna, el fallback actual (fondo negro + ícono `User`).
- **Datos**: hoy `equipo_para_web()` devuelve una sola `foto_url` por persona y no distingue a la dueña. Para esto hace falta (backend nuevo, con su migración local primero): marcar a la dueña (p. ej. `es_duena`) y permitir **varias fotos** (tabla/columna nueva con GRANT + RLS) y los campos de ficha (cargo, experiencia, «atiende»). Preguntar antes de crear la migración. El lienzo usa 3 placeholders.

## Estados

- **Con fotos / Sin fotos**: sin foto se mantiene el fallback actual (fondo negro + ícono `User` a baja opacidad). En el lienzo, «Con fotos» usa degradados como sustituto de fotos reales.
- **Sin perfiles**: tarjeta `liquid-glass` con ícono `User` y «Todavía no hay perfiles publicados.» (igual que hoy). El hero de la dueña se mantiene.
- **Cargando**: texto mono «Cargando...» (igual que hoy).

## Reglas visuales del repo que aplican

Estilo `.landing-web`: fondo `#0b0b0c`, `--lw-gold` (`#a9c6ec`), tarjetas `liquid-glass` con `rounded-none`, botones en píldora, Heavitas solo en títulos importantes. Sin `#3ECF6A` (el punto de «Abierto ahora» usa el verde ya existente en Contacto, `bg-green`, no el verde de CTA).

## Animación de entrada

Seguir `docs/patrones/animacion-entrada.md` (hooks `useEntornoAnimacion` + `useRevelarEnPantalla`, clases `.in-left`, `.in-up`, `.in-photo`). En el lienzo los retrasos son una propuesta: sub-navegación 100 ms → eyebrow 200 → título 300 → texto 450 → foto 300 (`.in-photo`) → fichas 500/580/660/740 → CTA 820. Las tarjetas de perfil entran con `.in-up`, retraso `(índice % 6) × 80 ms` (igual que hoy). Ojo: Nosotros no está cacheada (rutas del portal), así que cambiar de sub-sección y volver a Equipo remonta y es válido que la animación se repita.

## Datos

Todo sale de lo que ya existe, **sin cambios de backend**:

- `equipo_para_web()` → `nombres_completos`, `especialidad`, `bio`, `foto_url` (bucket `fotos-asistentes`, `urlPublicaFoto`) para la grilla.
- `datos_contacto()` → `instagram_url`, `facebook_url`, `tiktok_url`, `telefono`.
- `horario_atencion()` → días y bloques de horario (`formatearDias`, `formatearHora`).
- **No existe todavía** (ver «Carrusel»): perfil de la dueña con varias fotos y campos propios.

## Decisiones pendientes

1. Cómo se modela a la dueña (marca en `asistentes`, o perfil aparte) y de dónde salen sus varias fotos y datos de ficha (backend nuevo).
2. 3 o 4 columnas en escritorio.
3. Dónde vive el hero: dentro de `SeccionEquipo`, o el texto «Conoce al salón por dentro.» actual se mantiene para las 4 sub-secciones y solo cambian las fichas.
4. Si el botón «Reservar cita» vuelve en el cierre (hoy está quitado).
