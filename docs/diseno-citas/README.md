# Diseño de Citas: portal cliente (web)

Diseño aprobado para rediseñar `src/pages/cliente/CitasCliente.jsx` (pestaña **Citas** del portal cliente).

Lienzo original, interactivo con botón Play: https://claude.ai/artifact/GZRVqGSQY7cm3gbukPjZBx

Va de la mano con la pestaña nueva **Carrito de servicios** (`/citas/carrito`), especificada sin lienzo en `docs/diseno-carrito-servicios/README.md`. Se pueden implementar por separado, pero el botón de carrito de esta pestaña apunta allí.

## Archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `Main.dc.html` | Citas en escritorio (1440 px). **Referencia principal.** |
| `Movil.dc.html` | Citas en móvil (390 px). |
| `canvas.json` | Índice del lienzo. Sus `notes` resumen qué se mantiene, qué es nuevo y qué falta implementar. |

Los `.dc.html` son el formato del editor de diseño:
- Son HTML con `{{holes}}`, `<sc-if>`, `<sc-for>`, y la lógica va en el bloque `class Component extends DCLogic` al final (datos de ejemplo + cálculos).
- **No se pegan tal cual en React.** Se usan como especificación de estructura, estilos (inline y en `<helmet><style>`) y comportamiento.
- No abren solos en el navegador (falta el runtime `support.js`); para verlos, usar el enlace del lienzo.
- Las fuentes apuntan a `/_blob/...` del lienzo; en la app se usan las de `src/assets/fonts/`.
- El lienzo **no dibuja el header**: la pestaña usa el header normal del portal (`PortalCliente.jsx`).

## Reglas de estilo (ya definidas por el usuario)

- **Paleta:** estilo de la web del cliente: `.landing-web`, `--lw-gold` (= azul metálico `#a9c6ec`), fondo `#0b0b0c`.
- **Tipografías:** **Heavitas** en blanco sólido y mayúsculas para títulos (MIS CITAS, títulos de bloque, día de la próxima cita). El resto con la fuente actual.
- **Bloques:** fondo `#111113`, borde `1px #1f1f22`, radio `10px`, `box-shadow: inset 0 1px 1px rgba(255,255,255,.06)`.
- **Botón principal «Agendar cita»:** azul metálico, texto negro, círculo negro con `+` a la derecha (igual que en Servicios).
- **Botones secundarios:** píldora con borde `#2e2e33`. «Cancelar» con texto rojo.
- **El verde `#3ECF6A` no se usa como botón aquí.** Solo aparece como punto «Completada» en la línea de pasos del bloque «Cómo ganas…» y en el chip «¿Dudas con tu cita?» (WhatsApp).
- **Convenciones del repo:** caret `ArrowBigDown` con `rotate-180` (Historial), `useToast()` para confirmaciones, Esc cierra el diálogo de cancelar (`useCerrarConEscape`), toques ≥ 44 px en móvil.

### Estados de cita (chips)

| Estado | Estilo |
|---|---|
| Pendiente | borde **punteado** azul metálico, texto azul |
| Confirmada | azul metálico **relleno**, texto negro |
| Completada | verde suave (`rgba(62,207,106,.14)` / `#7fe0a0`) |
| Cancelada | gris |
| No asistió | rojo suave |

Antes Pendiente y Confirmada se veían casi iguales.

### Chips de puntos y sellos

- `+N pts`: borde azul metálico, ícono `Sparkles`.
- `+1 sello`: borde gris, ícono `Stamp`.
- «Sello ya contado ese día»: borde punteado, apagado.

## Estructura (escritorio)

De arriba a abajo:

1. **Encabezado:**
   - Izquierda: «MIS CITAS» (Heavitas 32) + «Revisa tus reservas, reprograma o agenda una nueva.»
   - Derecha: **botón circular de carrito de servicios** (`ShoppingCart`, 48 px, con contador de `serviciosCarrito.size`; sin contador si está vacío) → `/citas/carrito`. Luego el botón **«Agendar cita»**.
   - El mini-carrito (`MiniCarritoServiciosCitas`) **ya no vive en Citas**.
2. **«Tu próxima cita»** (bloque destacado a todo el ancho, borde azul tenue y brillo radial arriba a la izquierda), en 3 columnas:
   - **Columna 1:**
     - Etiqueta «TU PRÓXIMA CITA».
     - Chip de cuenta regresiva: «Hoy» / «Mañana» / «En N días».
     - Día de la semana (Heavitas), fecha larga y hora en mono azul metálico.
   - **Columna 2:**
     - Servicios, cada uno con «S/ precio · N min».
     - Fila con asistente, duración total, chip de estado, `+N pts` y `+1 sello` o «Sello ya contado ese día».
     - Abajo: «Dejaste S/ X de adelanto · total» (si `adelanto > 0`) o «Total estimado», y el total.
   - **Columna 3:**
     - Botones en grilla 2×2: Reprogramar, Cancelar, Cómo llegar, WhatsApp.
     - Debajo: «Puedes reprogramar o cancelar hasta 3 horas antes.»
   - **Sin citas vigentes:** «No tienes citas agendadas» + «Ver servicios» + «Agendar cita».
3. **Tres columnas** (`400px | 1fr | 340px`):
   - **Calendario:** **idéntico al actual** (no se toca). Barra de mes con flechas y «Hoy», grilla lunes–domingo de 42 días, día elegido relleno azul metálico, hoy con borde, puntito en días con citas. Debajo: «Toca un día para ver solo las citas de esa fecha.»
   - **Próximas citas:**
     - **Siempre visibles**, sin tener que tocar un día. Muestran todas las citas vigentes (PENDIENTE/CONFIRMADA y futuras), agrupadas por fecha («Sáb 3 oct · En 5 días»). La próxima lleva borde azul.
     - Cada tarjeta muestra: hora, servicios, estado, asistente («Por asignar» si no hay), duración, total, y una fila de chips (`+N pts`, sello).
     - Si se puede modificar: Reprogramar / Cancelar. Si está completada: Calificar / Volver a reservar.
     - **Al tocar un día** del calendario, el título cambia a «Citas del lun 28 sep» y la lista muestra **todas** las citas de ese día, de cualquier estado. Aparece el chip **«Ver todas las próximas ✕»**, que quita el filtro. Tocar el mismo día otra vez también lo quita. Al entrar a la pestaña **no hay día seleccionado**.
     - **Vacío:** «No tienes citas próximas.» / «No tienes citas este día.»
   - **Columna derecha:**
     - **Puntos** (título «PUNTOS» en escritorio **y** móvil; **sin** la línea «+N pts por ganar con tus próximas citas». Decisión del usuario):
       - Chip de nivel, total de puntos grande, barra hacia el siguiente nivel, «N pts para VIP».
       - **«Ver mis puntos →»** justo debajo de esa parte.
       - Separador y **Sellos de fidelidad**: 5 círculos (llenos los actuales), «3 de 5 · 2 para tu 20%», texto «Se suma 1 sello por día que te atiendes, aunque tengas varias citas ese mismo día.»
       - **«Ver mi fidelización →»** al final de la parte de sellos.
     - **«Antes de tu cita»:**
       - Reprograma o cancela hasta 3 h antes.
       - Horario Lun–Sáb 9:00–20:00.
       - Dirección.
       - Botón «¿Dudas con tu cita?» (WhatsApp).
4. **«Historial»** (bloque plegable a todo el ancho, abierto por defecto):
   - Cabecera: «HISTORIAL · N citas pasadas» + caret `ArrowBigDown`.
   - Filas en grilla con: fecha + hora, servicios + asistente, estado (+ `+N pts` y `+1 sello` si está completada), total, y acciones.
   - Acciones: «Calificar» (solo completadas sin reseña; si ya tiene, texto «Calificada») y «Volver a reservar».
5. **«Cómo ganas puntos y sellos»** (bloque a todo el ancho, al final). **No es de preguntas y respuestas**; una pestaña de FAQ se hará a futuro. Subtítulo: «Así funciona tu tarjeta de fidelización en Jaise.» Tiene 3 columnas con ícono:
   - **Puntos:**
     - 1 punto por cada día que te atiendes.
     - 1 punto por cada S/ 20 en servicios.
     - Niveles: Básico desde 0 · Premium desde 10 · VIP desde 30.
   - **Sellos:**
     - 1 sello por día, aunque ese día tengas varias citas a distintas horas.
     - Al juntar 5 sellos **puedes** generar un cupón de 20% desde Fidelización y usarlo al pagar en caja.
     - Cada 5 sellos se llena una tarjeta y empieza otra; los cupones aún no generados te siguen esperando.
     - **«Muy pronto: una nueva sección de Recompensas** donde podrás canjear tus puntos y sellos por cupones de todo tipo, o directamente por servicios y productos», con chip «Próximamente». La pestaña Recompensas es futura y el nombre es provisional.
   - **Cuándo se suman:** línea vertical de pasos: Pendiente («Aún no suma») → Confirmada («El salón aceptó tu cita. Aún no suma») → **Completada** (punto verde con check: «Te atendimos y se registró en caja: aquí se suman tus puntos y tu sello»). **Confirmar una cita no suma nada; solo completarla.**
   - **Pie** (recuadro punteado): «No suman las citas canceladas, las citas a las que no asististe ni las compras de productos. Si un servicio se anula en caja, se descuentan sus puntos y su sello.»
6. **Diálogo «¿Cancelar esta cita?»:** «Mar 29 sep, 10:30 a. m. — Pedicure Gel. Esta acción no se puede deshacer.» + «Volver» / «Sí, cancelar» (rojo). Es el mismo flujo que hoy (`cancelar_mi_cita_web`).

## Móvil (390 px)

Una columna, en este orden:

1. «MIS CITAS» + botón carrito (44 px) + «Agendar».
2. Tu próxima cita: fecha arriba, hora a la derecha, servicios, chips, total, botones 2×2 de 44 px.
3. Próximas citas.
4. Calendario.
5. Historial: cada fila como tarjeta apilada.
6. Bloque «PUNTOS» (igual que escritorio, sin la línea «+N pts por ganar»).
7. Antes de tu cita.
8. Cómo ganas puntos y sellos: las 3 columnas apiladas con separadores.

## Reglas de puntos y sellos (lógica)

Coinciden con el backend actual (`78_fidelizacion_web.sql`, `88_puntos.sql`, `89_puntos_bono.sql`, `97_cupones_fidelizacion.sql`). **No hace falta migración.**

- **Solo suman los servicios completados:** filas `registro_servicios` con `estado = 'ACTIVO'`. Que el admin confirme una cita no suma nada.
- **1 sello y 1 «punto por visita» por DÍA:** `mi_fidelizacion()` y `mis_puntos()` usan `count(distinct fecha)`. En la UI:
  - Solo la **primera cita no cancelada/no «no asistió» de cada día** muestra «+1 sello» y suma `puntos_por_visita`.
  - Las demás de ese día muestran «Sello ya contado ese día» y solo suman `total × puntos_por_sol_gastado`.
  - Ver `idsConSello()` en la lógica del `.dc.html`. En el lienzo, el 3 oct tiene dos citas (4 p. m. y 6 p. m.) para mostrarlo.
- **Puntos estimados por cita:** `floor((sello ? puntos_por_visita : 0) + total × puntos_por_sol_gastado)`. Es un **estimado** (se muestra antes de que ocurra).
- **Números del bloque «Cómo ganas…»:** se arman con `config_puntos`, **no se escriben fijos**. El negocio los cambia en «Puntos Web» del POS:
  - `puntos_por_visita`.
  - «cada S/ X» = `1 / puntos_por_sol_gastado`.
  - `umbral_premium`, `umbral_vip`.
  - `config_puntos` ya tiene `grant select` a `authenticated`.
- **Sellos para el cupón:** 5 (constante `visitas_por_recompensa` que devuelve `mi_fidelizacion()`).

## Animación de entrada

Se usa el patrón estándar: `docs/patrones/animacion-entrada.md`, `useEntornoAnimacion`, clases `.in-left/.in-right/.in-up` ya en `index.css`. El calendario entra entero; no se animan los días uno por uno.

| Bloque | Escritorio | Móvil |
|---|---|---|
| Encabezado | `in-left` 100 ms | `in-left` 100 ms |
| Tu próxima cita | `in-up` 250 ms | `in-up` 250 ms |
| Calendario | `in-left` 450 ms | `in-left` 700 ms |
| Próximas citas (título) | `in-up` 600 ms | `in-up` 550 ms |
| Grupos de fecha | `in-right` 700 + i·110 ms | igual |
| Columna derecha (PUNTOS, antes de tu cita) | `in-right` 750 ms | PUNTOS `in-up` 900 ms, antes 950 ms |
| Historial | `in-up` 950 ms | `in-up` 850 ms |
| Cómo ganas puntos y sellos | `in-up` 1050 ms | `in-up` 1050 ms |

Nota de `CLAUDE.md`: las rutas del portal cliente **no se cachean**, así que volver a Citas remonta y repite la animación. Es correcto.

## Qué se toca en el código

- **`src/pages/cliente/CitasCliente.jsx`:** rediseño completo según lo de arriba.
  - Conservar `irAFecha()` (salta al mes/día tras agendar o reprogramar), el diálogo de cancelar y los modales Agendar/Reprogramar.
  - Estado nuevo: `diaSeleccionado` empieza en `null` (antes era hoy) y significa «filtro».
- **Consultas:**
  - **Próximas citas:** consulta **aparte**, no limitada al mes visible: `fecha_hora >= now()`, `estado in ('PENDIENTE','CONFIRMADA')`, ordenada. La consulta por mes queda para los puntitos del calendario y el filtro por día.
  - Sumar `adelanto` al select (`82_citas_adelanto.sql`, informativo).
  - `mis_puntos()` (total, nivel, umbrales), `mi_fidelizacion()` (sellos), `config_puntos` (fórmula y textos), `datos_contacto()` (dirección, WhatsApp, cómo llegar).
  - **Calificar:** `resenas_servicio` es por servicio (unique cliente + servicio). Mostrar «Calificar» si algún servicio de la cita completada no tiene reseña de la clienta; el flujo de reseña ya existe (`guardar_mi_resena_servicio()`).
- **Volver a reservar:** agrega los servicios de esa cita al carrito de servicios (`CarritoClienteContext`) y navega a `/citas/carrito`. Mientras esa pestaña no exista, abrir `ModalAgendarCitaCliente` con `serviciosIniciales`.
- **Botón carrito** → `/citas/carrito` (ver `docs/diseno-carrito-servicios/README.md`). Mientras no exista, puede quedar oculto o llevar a Servicios.
- **`MiniCarritoServiciosCitas.jsx`:** deja de usarse en Citas.
- **Regla de 3 h:** hoy está fija en `puedeModificar()`. `estado_negocio.cancelacion_plazo_horas` ya existe (`115_estado_negocio_adelanto.sql`): conviene usarlo para el texto y el botón, en sintonía con lo que validan `cancelar_mi_cita_web` / `reprogramar_mi_cita_web`.

## Pendiente de decidir

- **Datos de ejemplo a reemplazar:** citas, asistente, precios, puntos (18, Premium → VIP 30), sellos (3 de 5), `[DIRECCIÓN DEL LOCAL]`, horario (sale de `horario_atencion()`).
- **Nombre definitivo** de la futura pestaña «Recompensas».
