# Patrón: animación de entrada de una pestaña (Web de clientes)

Estándar para toda la Web de clientes (`.landing-web`), nacido en
`ServiciosCliente.jsx` (rediseño de `docs/diseno-servicios/`). Cuando se
le pida lo mismo a otra pestaña (Carrito es la próxima candidata
mencionada), este documento + los dos hooks de abajo son el punto de
partida — no hay que re-derivar el mecanismo, solo la tabla de retrasos
propia de esa pestaña.

## Qué es

La pestaña no aparece de golpe: cada bloque llega a su lugar con un
retraso distinto (como si se armara). Solo anima `opacity`, `transform`
y `filter` — nunca layout.

## Piezas

1. **CSS global** (`src/index.css`, bajo `.landing-web`): 4 clases +
   keyframes ya definidas y listas para reusar en cualquier pestaña —
   **no crear otras nuevas** salvo que el diseño pida un movimiento
   distinto:
   - `.in-left` — entra desde la izquierda, con blur. 0.9s.
   - `.in-right` — entra desde la derecha, con blur. 0.9s.
   - `.in-up` — entra desde abajo, sin blur. 0.8s.
   - `.in-photo` — entra desde la derecha con zoom y blur más fuerte
     (pensada para fotos grandes). 1.3s.

   Todas con `cubic-bezier(.2,.7,.2,1)` y `animation-fill-mode: both`, y
   ya tienen su bloque `prefers-reduced-motion: reduce` (`animation: none`).
   El retraso de cada elemento NO va en la clase — se pone por elemento,
   vía `style={{ animationDelay: '...ms' }}` calculado en JS.

2. **`src/hooks/useEntornoAnimacion.js`** — `useEntornoAnimacion(breakpointPx = 1024)`
   devuelve `{ reducirMovimiento, esDesktop }`, resueltos UNA sola vez al
   montar (`matchMedia`, sin listener de resize — solo importa el estado
   al cargar). Con eso se elige, en el propio componente, una tabla de
   retrasos para escritorio y otra para móvil (ver el ejemplo de
   `ServiciosCliente.jsx`: `ENTRADA_FIJA`/`ENTRADA_FILA`).

3. **`src/hooks/useRevelarEnPantalla.js`** — para listas de bloques
   repetidos (filas de categoría en Servicios; en Carrito podrían ser,
   por ejemplo, los ítems del carrito o las secciones de cupones). Cada
   `clave` se clasifica una sola vez, para toda la vida de la instancia
   del componente:
   - Si su nodo ya está dentro de lo visible del contenedor con scroll
     al momento de clasificar → modo `'carga'` (usa la tabla de
     retrasos "de página": típicamente `base + índice·paso`).
   - Si no → se observa con `IntersectionObserver` y se clasifica
     `'entrada'` recién cuando aparece en pantalla (retrasos contados
     desde ahí, sin el término de "página" — típicamente empezando en
     `0ms`).
   - Una vez clasificada, después de darle tiempo de sobra a que la
     animación termine, la clave queda **agotada**: el componente debe
     dejar de aplicarle cualquier clase de animación a partir de ahí,
     aunque el bloque se desmonte y remonte más adelante (ej. el
     usuario cambia de categoría/filtro y vuelve) — repetir la clase en
     un nodo de DOM nuevo la haría jugarse de cero, que es exactamente
     lo que hay que evitar.

   Devuelve `{ contenedorRef, refFila, estadoFila }`:
   - `contenedorRef` va en el contenedor con `overflow-y-auto` de la
     pestaña (el `root` del `IntersectionObserver`).
   - `refFila(clave)` va en el `ref` de cada bloque repetido.
   - `estadoFila(clave)` devuelve `null` (sin clasificar todavía —
     renderizar con `opacity: 0` para no parpadear) o
     `{ modo: 'carga' | 'entrada', agotada }`.

## Cómo armar la tabla de retrasos de una pestaña nueva

1. Sacar del diseño aprobado (Design/lienzo o especificación) la lista
   de bloques fijos (los que se ven siempre, sin importar filtros) con
   su clase (`in-left`/`in-right`/`in-up`/`in-photo`) y su retraso en
   escritorio y en móvil — aplicarlos directo, sin `useRevelarEnPantalla`
   (nunca se desmontan solos, así que no hay riesgo de repetición).
2. Para listas repetidas con animación escalonada (como las filas de
   categoría), usar `useRevelarEnPantalla` con `activo` atado a que esa
   vista esté realmente montada (ej. `agrupado` en Servicios — una vista
   filtrada/sin agrupar normalmente NO lleva animación de entrada,
   confirmarlo con el diseño antes de aplicar el patrón ahí también).
3. `agotarEnMs` (el margen para marcar una clave "agotada"): una cifra
   holgada por encima del peor caso real (retraso máximo + duración de
   la animación más larga que uses) — no hace falta que sea exacta.

## Reglas que no cambian de pestaña a pestaña

- La animación corre solo al MONTAR el componente de la pestaña. Nunca
  se repite por cambiar de filtro/categoría/tab interno, ni por cambios
  de estado que no remonten el bloque.
- Con `prefers-reduced-motion: reduce`: nada de esto se aplica, todo
  visible desde el inicio (en el componente, esto es simplemente no
  agregar ninguna clase/estilo de animación cuando `reducirMovimiento`
  es `true` — la propia regla CSS ya neutraliza la animación si algo
  se te escapa, pero no hay que depender solo de eso para las claves de
  `opacity: 0` puestas a mano mientras un bloque está "pendiente").
- Referencia completa de valores (para Servicios): `docs/diseno-servicios/README.md`,
  sección "Animación de entrada", y `Main.dc.html`/`Movil.dc.html`
  (bloque `<helmet><style>` + constante `ENTRADA` en la lógica).
