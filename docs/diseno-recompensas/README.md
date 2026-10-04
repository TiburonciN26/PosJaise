# Diseño de Recompensas (Club Jaise) — portal cliente (web)

Propuesta y prototipo para la nueva pestaña **Recompensas**. Es un diseño: nada de lo que muestra existe todavía en el backend (ver "Backend que falta"). Todos los datos del lienzo son ficticios.

Lienzo editable (con botón Play y barra de escenarios): https://claude.ai/artifact/RsTFDgXJwQBGNBKL9mmnSv

## Archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `Main.dc.html` | Recompensas en escritorio (fluido, 1440 px). **Referencia principal.** Contiene toda la lógica de ejemplo (escenarios, canje simulado). |
| `Movil.dc.html` | Recompensas en móvil (390 px); importa `Main.dc.html`. |
| `canvas.json` | Índice del lienzo; sus `notes` resumen ubicación, cómo probar y decisiones pendientes. |

Los `.dc.html` son el formato del editor de diseño: **no se pegan tal cual en React**; se usan como especificación de estructura, estilos y comportamiento. No abren solos en el navegador (falta `support.js`); para verlos, usar el enlace del lienzo. Los escenarios (barra "Solo prototipo" arriba) y los datos de ejemplo **no** forman parte de la web.

## Cambios que pidió el usuario sobre la primera versión

1. **Mi tarjeta** muestra la **tarjeta del chanchito actual** (`TarjetaPuntos.jsx`, la 3D metálica por nivel), no una tarjeta de nivel nueva.
2. **Canjear puntos** y **Mis cupones** reutilizan el diseño de la pantalla actual **Cupones y ofertas** (`OfertasCliente.jsx` + `TarjetaCupon.jsx`), adaptado a todos los campos nuevos.
3. **Mis sellos** reutiliza el diseño de la pantalla actual **Fidelización** (`FidelizacionCliente.jsx`), adaptado.
4. **Quitar "Fidelización" y "Cupones y ofertas" del menú del perfil del cliente** (`MenuUsuarioCliente.jsx`).
5. El usuario ya editó el lienzo: **quitó** la barra de menú de referencia, el bloque "Resumen personal" de arriba y el panel de ejemplo "canjear no baja tu nivel". La web debe respetar eso: Recompensas abre directo en las pestañas internas, sin ese resumen.

## Ubicación y navegación

- Nueva pestaña **Recompensas** (`/recompensas`) en `seccionesCliente` (`src/config/navegacionCliente.js`), **justo después de Productos**. Agregar su título/ícono y su entrada en `src/config/paginasCliente.js`.
- El ícono del chanchito del header (`BotonChanchito` en `PortalCliente.jsx`, hoy `to="/mis-puntos"`) pasa a llevar a `/recompensas` (sección **Mi tarjeta**). Ajustar la lógica de `estaEnPuntos` (el chanchito hace `navigate(-1)` cuando ya estás ahí) a la nueva ruta.
- `/mis-puntos`, `/fidelizacion` y `/ofertas` no deben quedar como pantallas duplicadas: dejarlas como `<Navigate replace>` a `/recompensas` (y a la sección correspondiente) para no romper enlaces viejos. Sitios que enlazan a ellas y hay que actualizar: `CitasCliente.jsx` (líneas ~619, ~645 y el texto ~1217 que dice "desde Fidelización"), `CarritoCliente.jsx` (~614), `InicioCliente.jsx` (~568), `navegacionCliente.js` (`titulosSubpaginasCliente`), `paginasCliente.js` (líneas 84-89), el comentario de `useCuponesNuevos.js`.
- Secciones internas (subpestañas, estado en la URL o en `useState`, a decidir): **Mi tarjeta · Canjear puntos · Mis sellos · Mis cupones · Movimientos · Cómo funciona**.
- Sin sesión: se puede explorar **Canjear puntos** y **Cómo funciona**; el resto muestra una puerta "Inicia sesión". Nunca mostrar datos de otra clienta.

## Menú del perfil

En `src/components/MenuUsuarioCliente.jsx`, quitar de `OPCIONES` las entradas `Fidelización` (`/fidelizacion`) y `Cupones y ofertas` (`/ofertas`) y limpiar los imports de iconos que queden sin usar (`Wallet`, `Ticket` si ya no se usan). Las **ofertas generales del salón** (`promociones`) hoy solo se ven en `/ofertas`: el lienzo las pasa al final de **Mis cupones** como bloque "Ofertas del salón" (misma tarjeta que ya existe) para no perder esa información. Confirmar con el usuario si prefiere otro lugar.

## Regla general: componentes idénticos al original (efectos, animaciones y tamaños)

El lienzo es **estático** en las tarjetas con efectos: solo aproxima su forma y color. En la web **no se reescriben ni se aproximan**: se reutilizan los componentes y las clases CSS existentes, con exactamente las mismas animaciones, tamaños, proporciones y efectos que tienen hoy. No simplificar ni quitar ningún efecto "por ser una lista" o "por ser más chica".

**Tarjeta de puntos (`TarjetaPuntos.jsx` + `.tp-*` en `index.css`)** — idéntica a la de "Mis puntos":
- Lienzo fijo de 1160×800 escalado al ancho del contenedor (`ResizeObserver`), tarjeta de 1000×630, radio 44 px, perspectiva 2200 px. En el lienzo se dibuja con `cqw` solo como aproximación; no copiar esas medidas.
- Movimiento: flotación idle continua, arrastrar para girar en 3D (física de seguimiento y retorno), brillo `.tp-glare` y destello `.tp-sheen` que siguen la rotación, y texto "ARRASTRA PARA GIRAR 360°" (`.tp-pista`, se oculta al primer arrastre). Los valores de la referencia (`SENS`, `FOLLOW`, `RETURN`, amplitudes de flotación) no se tocan.
- Entrada: conteo animado del número de puntos (2,6 s, ease-out cúbico), barra de progreso que se llena igual, y "pop" de brillo (`tp-pop`) al montar o cuando cambian los puntos o el nivel.
- Paleta por nivel (variables `--tp-*`): Básico plata, Premium azul hielo (con capa iridiscente `.tp-iri`), VIP dorado. Respetar `prefers-reduced-motion`.
- Único cambio de contenido aceptado: etiqueta "PUNTOS DISPONIBLES" y barra/siguiente nivel según clasificación (ver Mi tarjeta). Cualquier cambio de texto va por props, no copiando el componente.

**Tarjetas de cupón (`TarjetaCupon.jsx` + `.cupon-*` en `index.css`)** — idénticas a las de Referidos / Cupones y ofertas:
- Bronce (plano, sin efectos), Plata (borde degradado, reflejo y destello `cupon-sheen` en bucle de 7 s) y Oro (`cupon-oro`: borde y glow pulsante `cupon-glow` 4,5 s, destello `cupon-sheen`, texto degradado animado `cupon-texto-oro` / `cupon-brillo-texto`, y chispas titilantes `cupon-chispa` / `cupon-titilar` fuera del `overflow:hidden`).
- Etiqueta "Nuevo" (`.cupon-etiqueta-nueva`, vía `useCuponesNuevos`), acordeón con `ArrowBigDown` y `CampoColapsable`.
- Se usa en **Mis cupones** (componente `TarjetaCupon` con sus datos) y, para las filas de **Canjear puntos**, la misma envoltura de tarjeta/animación por nivel (Bronce/Plata/Oro según el valor de la recompensa) con otro contenido; extraer la envoltura visual para no duplicar CSS. En el lienzo Plata/Oro no tienen animación; en la web sí.
- El detalle desplegado queda como caja interior con margen de ~10 px y borde fino propio (no al ras de los bordes del cupón), tanto en Mis cupones como en Canjear puntos.

**Tarjetas "Beneficios por nivel" (Mi tarjeta)** — deben heredar los **efectos y animaciones de su propio nivel**:
- Cada una de las tres (Básico, Premium, VIP) se pinta con la paleta y el acabado metálico de la tarjeta de puntos de ese nivel (mismas variables `--tp-g`, `--tp-ink`, `--tp-glow`, `--tp-inkhi`), incluidos brillo/reflejo y **destello que se desplaza (`.tp-sheen`)** y glare, con el mismo movimiento que en la tarjeta de puntos. Ejemplo: si la clienta es VIP, la tarjeta VIP de beneficios muestra el dorado con su destello y movimiento; la de Premium muestra el azul hielo con su capa iridiscente; la de Básico, su plata.
- Todas las tarjetas del grupo llevan su efecto de nivel; la del nivel de la clienta, además, va levantada (~16 px) con más brillo y la etiqueta "TU NIVEL". Reutilizar las mismas clases/variables `.tp-*` (extraer lo necesario a un componente compartido, p. ej. `FondoNivel`) en vez de copiar los degradados, para que cualquier ajuste futuro de la tarjeta de puntos se refleje aquí.
- Las tres van centradas horizontalmente, al mismo nivel, ancho máximo 340 px; en móvil se apilan. Respetar `prefers-reduced-motion` (sin movimiento, solo el color).

## Diseño por sección

Reglas visuales de siempre: estilo `.landing-web`, `--lw-gold` (azul metálico `#a9c6ec`), fondo `#0b0b0c`, tarjetas `liquid-glass` con `rounded-none` (esquinas rectas), Heavitas solo en el título "Recompensas", confirmaciones con `useToast()`, Esc cierra modales (`useCerrarConEscape`), asterisco rojo en obligatorios, flecha de acordeón `ArrowBigDown` con `rotate-180`, `#3ECF6A` solo para "Confirmar canje".

### Mi tarjeta
- Arriba a la izquierda, el componente **`TarjetaPuntos`** existente tal cual (arrastrar para girar 360°, mismas variables por nivel). Cambios de contenido: la etiqueta `PUNTOS ACUMULADOS` pasa a **`PUNTOS DISPONIBLES`** y muestra el saldo canjeable; la barra y `siguienteEtiqueta` ("FALTAN N PTS · PREMIUM" / "NIVEL MÁXIMO") siguen el progreso de **clasificación**, no el saldo.
- Debajo, bloque `liquid-glass` con `Info` (igual que `MisPuntosCliente.jsx`): texto de "te faltan N puntos de clasificación…" + **"Usar tus puntos no hace bajar tu nivel."**
- Nota: en el lienzo el usuario **quitó** a la derecha de la tarjeta los bloques "Beneficios de tu nivel", "Vigencia y renovación", "Qué significa cada número" y "Avance hacia tu próximo punto"; no se implementan por ahora (la información de disponibles/clasificación/bonos y de vigencia queda en "Cómo funciona" y en las decisiones pendientes).
- Debajo de la tarjeta (**centrada**): **Progreso de clasificación** (barra 0 → umbral VIP con marcas Básico/Premium/VIP) y **Beneficios por nivel**: tres tarjetas centradas y al mismo nivel (Básico, Premium, VIP) con nombre, puntos de clasificación requeridos, descripción, botón y "Qué incluye" con checks; la del nivel de la clienta va levantada y con la etiqueta "TU NIVEL", y todas con los efectos de su nivel (ver regla general).

### Canjear puntos (diseño de "Ofertas del salón")
- **Mismo diseño que las tarjetas de cupón** (Bronce/Plata/Oro con sus efectos, ver regla general), en **2 columnas** de ancho máximo 420 px, centradas, para que no se estiren. Fila acordeón: ícono, nombre y "etiqueta · nivel de color" a la izquierda, precio en puntos y estado a la derecha, `ArrowBigDown`. Al desplegar (caja interior con margen y borde fino): descripción, Beneficio, Compra mínima, Aplica en, Nivel, Disponibilidad, Vigencia, Combinación, Uso, mensaje del estado y botón de borde dorado `Obtener cupón`. Etiqueta "Recompensa inicial acordada" o "Ejemplo editable · pendiente de aprobación".
- Buscador y filtros por categoría (fijo, %, productos, regalos, servicios, exclusivas) arriba.
- Estados: Disponible · Puntos insuficientes ("te faltan N") · Nivel insuficiente (cómo desbloquearlo) · Agotado · Fuera de vigencia · Próximamente · Cargando · Error con Reintentar · Sin resultados · Canje bloqueado por saldo negativo · Sin sesión. Las condiciones se pueden consultar siempre.
- Recompensa acordada: **Cupón de S/5 en servicios seleccionados**, 50 puntos, compra mínima S/60 en servicios elegibles, uso en una compra posterior, 1 por compra, no acumulable, solo servicios seleccionados. Las demás son ejemplos o "Próximamente", con importes pendientes de aprobación.
- **Confirmar canje** (modal): recompensa, puntos a descontar, saldo actual y posterior, condiciones y vencimiento, Cancelar / Confirmar (verde). Al confirmar: bloquear doble clic y mostrar progreso. Éxito: saldo actualizado, cupón creado con código y condiciones, "Ver mis cupones", y aclarar "canjear obtiene un cupón; usarlo aplica el beneficio en una compra posterior". Errores (condiciones cambiaron, saldo insuficiente, premio agotado): decir explícitamente que **no se descontaron puntos ni se creó cupón**.

### Mis sellos (diseño de Fidelización)
- Tarjeta `liquid-glass` centrada `max-w-sm`: texto "Cada 5 visitas…" con la recompensa en dorado, 5 círculos de 44 px con el ícono **`Stamp`** (el mismo sello de la pestaña Citas; lleno = fondo `--lw-gold` con ícono oscuro; vacío = borde punteado), **fecha de la visita bajo cada sello**, "N de 5 visitas" / "¡Tarjeta completa!", "X visitas completadas en total", y cuánto falta.
- Si hay tarjeta completa: bloque con `Gift` "Tienes 1 recompensa disponible" y botón `Generar cupón` (sin gastar puntos; un solo cupón por tarjeta completa, el botón no se puede repetir).
- "Ver historial de visitas" (acordeón con `ArrowBigDown`, `CampoColapsable`) y estado vacío "Agenda tu primera cita…".
- Aparte: reglas de sellos (1 por día en hora de Perú, solo citas reservadas en la web y completadas, no cuentan canceladas/no atendidas ni productos) e **historial de tarjetas completadas**.
- La recompensa de las tarjetas nuevas ("20 % en un servicio elegible, máx. S/5") es **propuesta**; los cupones viejos conservan sus condiciones originales (hoy 20 %, sin ese tope).

### Mis cupones (diseño de `TarjetaCupon`)
- Mismo componente, en **2 columnas** (máx. 420 px por columna, centradas): fila acordeón con ícono `Ticket`, código en mono con tracking ancho, "origen · nivel (Bronce/Plata/Oro)", valor a la derecha y "Muéstralo en caja / Ya canjeado / Anulado"; el nivel de color sale de `nivelCupon()`. Al desplegar, además de fechas: beneficio, compra mínima, aplica en, condiciones, vence, estado y botón **Mostrar en caja** (modal con el código grande).
- Origen: Puntos, Sellos, Referido o Promoción. Estados: disponible, utilizado, **vencido y anulado (nuevos, marcados "en diseño")**. Filtro por estado.
- Debajo: **Ofertas del salón** (tarjetas de `OfertasCliente`), vigencia de 60 días para cupones nuevos como propuesta pendiente.

### Movimientos
Lista con fecha, operación, motivo, puntos ganados/gastados/ajustados y saldo posterior; filtros por tipo (Todos/Ganados/Gastados/Ajustes) y período (30 días/90 días/12 meses/Todo). Al anular una venta se revierten sus puntos; si usó cupón, se rehabilita y **no** se devuelven además los puntos del canje. Saldo negativo: mostrar el ajuste en rojo, bloquear canjes hasta compensar, y aclarar que no es deuda de dinero.

### Cómo funciona
4 pasos (compras → puntos y sellos → canje por cupón → uso del cupón), tasas **propuestas** (**5 puntos por cada S/20 en servicios; 5 por cada S/40 en productos**), condiciones (cuenta vinculada, importe pagado después de descuentos, servicios completados y cobrados, productos con venta confirmada, sin puntos por envío/recargos/gratis/anulados, nunca doble por la misma operación, sin puntos extra por visita) y explicación de anulaciones.

## Datos que ya existen vs. los que faltan

**Ya existen** (se pueden conectar en una primera etapa solo de frontend): `mis_puntos()` (saldo/nivel/umbrales), `mi_fidelizacion()` y `mi_historial_fidelizacion()` (sellos, visitas, recompensas), `generar_cupon_fidelizacion()`, `mis_cupones()`, tabla `promociones`.

**No existen todavía** (nada de esto se implementó; preguntar antes de cada migración, aplicar primero en local y pedir confirmación antes de producción):
- Separar **puntos disponibles** de **puntos de clasificación**; bonos identificados que no clasifican.
- Tasas 5/S/20 y 5/S/40 con acumulación de fracciones, idempotencia por operación y reversión por anulación (incluye saldo negativo que bloquea canjes).
- **Catálogo de recompensas** (precio en puntos, nivel requerido, stock, vigencia, compra mínima, servicios/productos elegibles, restricciones) y **RPC de canje** atómica que valide saldo, stock, nivel y vigencia, descuente puntos y cree el cupón sin duplicar.
- Tipos de cupón de importe fijo con compra mínima y elegibles; estados `VENCIDO`/`ANULADO`; vigencia (60 días propuesta).
- Todo objeto nuevo necesita GRANT explícito además de RLS; las funciones que hacen agregados o validan lo que el cliente no puede declarar van como `security definer`.

Sugerencia de fases: (1) solo frontend — pestaña, rutas, menú, y las secciones Mi tarjeta, Mis sellos y Mis cupones con los datos que ya existen; (2) backend del catálogo, canje y movimientos, con su QA local.

## Decisiones de negocio pendientes

1. Umbrales de clasificación (ejemplo 50 Premium / 150 VIP).
2. Clasificación por actividad de los últimos 12 meses y conservación 12 meses desde el ascenso.
3. Precios en puntos y premios exclusivos (revisión económica).
4. Lista de servicios/productos elegibles y márgenes.
5. Recompensa de las nuevas tarjetas de sellos (20 %, máx. S/5).
6. Vigencia de 60 días para cupones nuevos.
7. ¿Los bonos cuentan para clasificación? (propuesta: no).
8. Mantener nombres Básico / Premium / VIP.
9. Dónde viven las "Ofertas del salón" al retirar "Cupones y ofertas" del menú (el lienzo las pone al final de Mis cupones).
