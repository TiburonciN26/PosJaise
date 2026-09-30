# Carrito de servicios: portal cliente (web)

Especificación para crear una pestaña **nueva**: el carrito de servicios, en `/citas/carrito`.
No tiene lienzo. Es una **copia adaptada del carrito de productos** (`src/pages/cliente/CarritoCliente.jsx` + `docs/diseno-carrito/`) y se implementa directo en código.

Reemplaza al mini-carrito que hoy vive dentro de Citas (`MiniCarritoServiciosCitas.jsx`) y, para este flujo, al modal `ModalAgendarCitaCliente.jsx`. Ese modal es una sola columna con casillas para marcar servicios y al usuario le parece poco intuitivo para la web.

Diseño de la pestaña Citas que la acompaña: lienzo https://claude.ai/artifact/GZRVqGSQY7cm3gbukPjZBx (se guardará en `docs/diseno-citas/`).

## Regla principal: es una COPIA del carrito de productos

No se diseña desde cero. Se **duplica `CarritoCliente.jsx`** y se conserva lo mismo que en productos:
- el mismo layout (título arriba, 2 columnas, resumen sticky a la derecha, una columna en móvil);
- los mismos bloques, clases, espaciados y componentes;
- el mismo flujo de pago con captura;
- la misma barra de puntos;
- el mismo aviso de «lo que falta» y el mismo botón verde final.

Solo se cambia lo que es propio de un servicio:

| Carrito de productos | Carrito de servicios |
|---|---|
| Productos con cantidad y stock | Servicios con duración (sin cantidad ni stock) |
| Dirección de entrega + Recojo/Delivery + zona | **Asistente** (se quita todo lo de entrega) |
| Día y hora de entrega/recojo | **Día y hora de la cita** (`horarios_disponibles_cita`) |
| Comprobante Boleta/Factura | Se quita (se emite en el local) |
| Subtotal, delivery, descuentos, total | Servicios, **duración total**, total, **adelanto ahora / saldo en el local** |
| Pago del total con captura | Pago del **adelanto** con captura (mismos métodos y panel QR) |
| «Confirmar pedido» → `confirmar_pedido_productos` | «Confirmar reserva» → `agendar_cita_web` |
| Barra de puntos/nivel (los productos no suman puntos) | La misma barra + «Ganarás +N pts · +1 sello» de esta cita (1 sello por día) |

## Por qué una pestaña aparte

Un servicio no se "compra", se reserva. La reserva necesita elegir **asistente, día, hora y método de pago del adelanto**, y ver un **resumen**. Eso no cabe en un bloque lateral ni en un modal de una columna. El carrito de productos ya resolvió este mismo problema (día/hora, pago con captura, resumen), así que se copia su estructura.

## Cómo se llega

| Desde | Qué hace |
|---|---|
| **Citas**: botón circular con ícono de carrito (`ShoppingCart`, lucide) **a la izquierda** de «Agendar cita», con contador de servicios | Navega a `/citas/carrito` |
| **Servicios / Detalle del servicio**: «Agregar» | Sigue agregando a `carrito_servicios`; el toast puede ofrecer «Ver carrito» → `/citas/carrito` |
| `BarraTuCitaFlotante.jsx` («Tu cita · N servicios · Reservar») | Cambiar el destino a `/citas/carrito` (hoy va a Citas) |
| Historial de Citas: «Volver a reservar» | Agrega los servicios de esa cita al carrito y navega a `/citas/carrito` |

- **Ruta:** agregar `<Route path="citas/carrito" …>` en `App.jsx`, dentro del árbol del portal cliente (no cacheado).
- **Título:** sumar `'/citas/carrito': 'Carrito de servicios'` en `src/config/navegacionCliente.js`, para el breadcrumb/título igual que `/carrito`.
- **Decisión pendiente:** si el botón «Agendar cita» de Citas también debe ir aquí en lugar de abrir el modal. Si el carrito está vacío, la página ofrece «Agregar servicios».

## Estilo

Es el mismo que el carrito de productos (ver `docs/diseno-carrito/README.md`, «Reglas de estilo»):

- Wrapper `.landing-web`, `--lw-gold` = azul metálico `#a9c6ec`, fondo `#0b0b0c`.
- Bloques `#111113`, borde `1px #1f1f22`, radio `10px`, `inset 0 1px 1px rgba(255,255,255,.06)`.
- Heavitas en blanco sólido para títulos («CARRITO DE SERVICIOS», títulos de bloque).
- «Confirmar reserva» en **#3ECF6A** con texto negro: es un CTA final, del mismo tipo que «Confirmar pedido».
- Reutilizar tal cual: clases `lw-pago-opcion`, `CampoSubirArchivo.jsx`, `procesarImagen()` de `lib/imagenes.js`, `useToast()`, `<Etiqueta obligatorio>`, `ArrowBigDown` para desplegables.
- Entrada animada con el patrón `docs/patrones/animacion-entrada.md` (`useEntornoAnimacion`, clases `.in-left/.in-right/.in-up`).

## Estructura (escritorio)

Arriba, a todo el ancho: título **CARRITO DE SERVICIOS**, a la derecha «N servicios · X min». Debajo, 2 columnas como el carrito de productos (izquierda ~688 px, derecha el resumen, sticky).

### Columna izquierda

1. **Servicios**: una fila por servicio del carrito:
   - Foto cuadrada radio 10px (bucket `fotos-servicios`; sin foto, el degradado de su categoría de `lib/serviciosVisual.js`, igual que `TarjetaServicioCliente`).
   - Nombre, categoría, «N min».
   - Precio y chip de puntos `+N pts` (ver Puntos abajo).
   - Checkbox para incluirlo o no en esta reserva (igual que en productos). Por defecto todos marcados.
   - Basurero para quitarlo del carrito (`quitarServicio`).
   - Al pie, enlace «Agregar más servicios» → `/servicios`.
2. **Asistente**: tarjetas con nombre de cada asistente de `asistentes_para_citas()`. Es obligatorio (`<Etiqueta obligatorio>`). Opcional a futuro: «Cualquiera disponible», que hoy no existe en el backend porque `horarios_disponibles_cita` pide un asistente.
3. **Día y hora** (obligatorios):
   - **Día:** fila horizontal de chips con los próximos 14 días. Deshabilitados los días cerrados según `horario_atencion()` y los días en que la tienda esté cerrada.
   - **Hora:** al elegir asistente y día, se llama `horarios_disponibles_cita(p_asistente_id, p_fecha, p_duracion_min)` con la duración total de los servicios **marcados**. Muestra los horarios como grilla de chips agrupados en **Mañana / Tarde**.
   - Si no hay horarios: «No hay horarios libres este día con esta asistente. Prueba otro día u otra asistente.»
   - Cambiar servicios, asistente o día limpia la hora elegida, igual que hace hoy el modal.
4. **Nota para el salón** (opcional): textarea, se envía como `p_nota`.

### Columna derecha: «Resumen de tu reserva»

- **Cuándo:** «Mar 29 sep · 10:30 a. m. – 12:00 p. m.». La hora de fin = inicio + duración total.
- **Con:** nombre de la asistente.
- **Servicios marcados:** lista corta nombre + precio, luego **Duración total** y **Total**.
- **Puntos:** «Ganarás +N pts con esta cita», con barra de nivel igual a la del carrito de productos (`mis_puntos()`).
- **Cupón:** decidir si aplica a servicios. `confirmar_venta()` ya canjea cupones y entiende líneas SERVICIO, pero la cita todavía no guarda cupón. Si no se decide, no mostrar este bloque en la primera versión.
- **Adelanto:**
  - Monto a pagar ahora = `estado_negocio.adelanto_minimo`; si es null, preguntar la regla al usuario.
  - Mostrar «Adelanto ahora S/ X · Saldo en el local S/ Y».
  - Decidir si la clienta puede elegir pagar el total.
- **Método de pago:** Yape / Plin / Transferencia, copiado del carrito de productos:
  - Panel con QR, número y titular de `estado_negocio` (`yape_*`, `plin_*`, `cuenta_transferencia`).
  - «Subir captura» con miniatura y «Quitar».
  - Sin «Efectivo», igual que en pedidos web: el pago se valida antes.
- **«Confirmar reserva»** (verde #3ECF6A). Solo se activa con: ≥1 servicio marcado + asistente + día + hora + captura del adelanto. Debajo, un aviso de lo que falta, igual que en productos.
- Debajo del bloque:
  - WhatsApp «¿Dudas con tu reserva?» (`datos_contacto()`).
  - Políticas: «Reprograma o cancela hasta N horas antes». N = `estado_negocio.cancelacion_plazo_horas`; hoy el código usa 3 fijo en `CitasCliente.jsx`, así que conviene unificarlo con ese campo.

### Después de confirmar

1. Toast «Cita reservada».
2. `vaciarServiciosReservados(ids)`: quita del carrito solo los servicios reservados; los desmarcados se quedan.
3. Navega a `/citas`, que muestra la cita nueva en «Tu próxima cita» / «Próximas citas».

### Estados vacíos

- **Carrito vacío:** ícono, «Todavía no agregaste servicios», botón «Ver servicios» → `/servicios`. Sin resumen.
- **Todos desmarcados:** el resumen muestra «Marca al menos un servicio» y el botón queda deshabilitado.

## Móvil (390 px)

Una sola columna, en este orden: Servicios → Asistente → Día y hora → Nota → Resumen → Método de pago.

Barra inferior fija con «Total S/ X · +N pts» y «Confirmar reserva». Debe ir portaleada a `.landing-web`, **no** a `document.body`: ver la nota de `overflow-hidden` en `CLAUDE.md` y `BarraTuCitaFlotante.jsx`.

Los chips de día se deslizan de lado. Los de hora van en grilla de 3 columnas. Todo toque ≥ 44 px.

## Puntos y sellos (también en Citas)

**Regla del negocio: 1 sello de fidelización por DÍA.** Aunque la clienta tenga varias citas el mismo día a distintas horas, en su perfil sube **un solo sello**. El backend ya lo cumple: `mi_fidelizacion()` y `mis_puntos()` cuentan `count(distinct fecha)` sobre `registro_servicios`. No hace falta migración; la UI solo tiene que mostrarlo igual.

- **Sello por cita:**
  - Solo la **primera cita no cancelada de cada día** muestra el chip «+1 sello».
  - Las demás de ese mismo día muestran «Sello ya contado ese día» (chip apagado, borde punteado).
  - Esto incluye citas que la clienta **ya tiene agendadas** ese día. Por ejemplo, si reserva a las 6 p. m. y ya tenía otra cita a las 4 p. m. del mismo día, esta pestaña debe decir «Sello ya contado ese día» en el resumen.
- **Puntos por cita:** `floor((suma sello ? puntos_por_visita : 0) + total × puntos_por_sol_gastado)`, leyendo `config_puntos` (hoy 1 y 0.05). El punto «por visita» también es uno por día, igual que el sello.
- **En el resumen de esta pestaña:** «Ganarás +N pts · +1 sello», o «+N pts · sello ya contado ese día».
- `config_puntos` ya tiene `grant select` a `authenticated`, así que se puede leer directo.

## Qué se toca en el código

- **Nuevo:** `src/pages/cliente/CarritoServiciosCliente.jsx`. Partir de `CarritoCliente.jsx`: quitar dirección, delivery, zonas, comprobante boleta/factura y cantidades; sumar asistente y horarios. La lógica de horarios se toma de `ModalAgendarCitaCliente.jsx`, líneas ~60–120.
- **`CitasCliente.jsx`:**
  - Quitar `MiniCarritoServiciosCitas`.
  - Botón carrito con contador (`serviciosCarrito.size` de `useCarritoCliente()`) a la izquierda de «Agendar cita».
  - El resto del rediseño de Citas va por su propio README.
- **`MiniCarritoServiciosCitas.jsx`:** queda sin uso y se borra.
- **`BarraTuCitaFlotante.jsx`:** cambiar el destino a `/citas/carrito`.
- **`App.jsx` y `navegacionCliente.js`:** ruta y título.

## Backend que falta (Supabase): preguntar antes de cada migración

Hoy `agendar_cita_web(p_asistente_id, p_fecha_hora, p_servicio_ids, p_nota)` (`75_citas_web.sql`) no recibe pago.

1. **Columnas en `citas`**, siguiendo el patrón de `100_pedidos_web_pago.sql`:
   - `metodo_pago`
   - `comprobante_url` (captura en Storage, mismo flujo de `lib/imagenes.js`: subir al confirmar, borrar si falla)
   - `pago_verificado`, `pago_verificado_en`, `pago_verificado_por`
2. **`citas.adelanto`** ya existe (`82_citas_adelanto.sql`, informativo): se llenaría con el monto declarado.
3. **Nueva versión de `agendar_cita_web`** con `p_metodo_pago`, `p_comprobante_url`, `p_adelanto`:
   - Validar en el servidor que `p_adelanto >= adelanto_minimo`.
   - La cita entra como PENDIENTE hasta que el staff verifique el pago.
4. **POS, Citas:** mostrar el comprobante y un botón «Verificar pago», como en Pedidos Web.
5. **Recordar:** toda columna o tabla nueva necesita GRANT explícito además de RLS (`citas` da permisos a nivel de tabla; confirmarlo en `information_schema.column_privileges` antes de asumirlo).

## Decisiones abiertas para el usuario

1. ¿«Agendar cita» (Citas) también abre esta página en vez del modal?
2. ¿Adelanto obligatorio siempre, cuánto si `adelanto_minimo` es null, y se permite pagar el total?
3. ¿Los cupones aplican a servicios en la web?
4. ¿Se agrega «Cualquier asistente disponible»? Requiere cambiar `horarios_disponibles_cita`.
