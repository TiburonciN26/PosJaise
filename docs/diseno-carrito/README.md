# Diseño del carrito — portal cliente (web)

Diseño aprobado para rediseñar `src/pages/cliente/CarritoCliente.jsx`.
Lienzo original (interactivo, con botón Play): https://claude.ai/artifact/UpWRTKTwGtn3X8fK9EE26p

## Archivos de esta carpeta

| Archivo | Qué es |
|---|---|
| `Main.dc.html` | Carrito en escritorio (1440 px). **Referencia principal.** |
| `Movil.dc.html` | Carrito en móvil (390 px). |
| `Cupones.dc.html` / `MovilCupones.dc.html` | Las mismas pantallas con el panel "Tus cupones" abierto (solo importan a las de arriba). |
| `canvas.json` | Índice del lienzo; sus `notes` resumen lo que ya existe, lo nuevo y lo que falta en backend. |

Los `.dc.html` son el formato del editor de diseño: HTML con `{{holes}}`, `<sc-if>`, `<sc-for>` y la lógica en el bloque `class Component extends DCLogic` al final (datos de ejemplo + cálculos). **No se pegan tal cual en React**: se usan como especificación de estructura, estilos (inline y en `<helmet><style>`) y comportamiento. No abren solos en el navegador (falta el runtime `support.js`); para verlos, usar el enlace del lienzo.

## Reglas de estilo (ya definidas por el usuario)

- Estilo de la web del cliente: `.landing-web`, `--lw-gold` (= azul metálico `#a9c6ec`), fondo `#0b0b0c`.
- Tipografías: **Kunaroh** solo logo/Inicio; **Heavitas** títulos importantes ("Tu carrito", "Tus cupones") en **blanco sólido**, sin cursivas ni dos colores; el resto con la fuente actual.
- Bloques: fondo `#111113`, borde `1px #1f1f22`, radio `10px`, `box-shadow: inset 0 1px 1px rgba(255,255,255,.06)`.
- Botón "Confirmar pedido": **#3ECF6A** con texto negro 18px — color exclusivo de pocos botones de cierre.
- Cupones: reutilizar `TarjetaCupon.jsx` + clases `.cupon-*` de `index.css` (Bronce/Plata/Oro con sus efectos). "Ahorras / Usar cupón / Cambiar / Quitar" van **debajo** de la tarjeta, alineados a la derecha, no dentro.
- Direcciones: tarjeta igual a `DireccionesCliente.jsx`, **sin** lápiz ni basurero en el carrito.
- Campos obligatorios con asterisco rojo; Esc cierra el panel de cupones; confirmaciones con `useToast()`.

## Estructura (escritorio)

Título "TU CARRITO" arriba a todo el ancho, luego 2 columnas:

- **Izquierda (688 px):**
  1. Dirección de entrega — solo con Delivery; muestra la predeterminada; "Cambiar" despliega las demás con radio; "Agregar" lleva a Mis direcciones.
  2. Comprobante — Boleta / Factura; con Factura: RUC (11 dígitos) y Razón social obligatorios.
  3. Productos — checkbox, foto con etiqueta "Stock: N" abajo y "−20%" arriba si hay descuento, nombre + presentación, cantidad, precio anterior tachado + precio; agotados al final, opacos, con cápsula "Producto no disponible" y sin poder marcarse.
  4. "Seguir comprando".
- **Derecha:** Resumen del pedido
  - Barra de puntos (Básico → Premium) + "Mis puntos".
  - Entrega: Recojo en tienda / Delivery → **Día** y **Hora** (obligatorios) → Zona (solo Delivery).
  - Cupón: fila "Agregar cupón · N disponibles" + sugerencia del mejor cupón; si hay uno aplicado, se muestra con `TarjetaCupon`.
  - Subtotal (a precio normal), Delivery · zona, **Descuento en productos**, Cupón, **Total** con el total sin descuentos tachado a la izquierda.
  - Método de pago (sin contenedor propio): Yape / Plin / Transferencia / Efectivo; panel con QR + instrucción con el total; "Subir captura" (miniatura + Quitar).
  - Botón "Confirmar pedido" + aviso de lo que falta.
  - Debajo del bloque: enlace WhatsApp "¿Dudas con tu pedido? Escríbenos" y 3 garantías.
- **Panel "Tus cupones"** (lateral en escritorio, hoja inferior en móvil): código manual, disponibles con "Mejor opción" y ahorro en este pedido, usados.

**"Confirmar pedido" solo se activa si:** hay productos marcados + día y hora elegidos + (si es Factura) RUC y razón social + (si no es Efectivo) captura del pago subida.

## Pendiente de decidir

- En escritorio se quitó el bloque **Servicios para reservar**; en `Movil.dc.html` todavía aparece. Confirmar con el usuario si va o no.
- "Efectivo · contra entrega" no pide captura: confirmar si se mantiene.
- Datos de ejemplo a reemplazar: QR, [NÚMERO], [TITULAR], [BANCO], [N° DE CUENTA], [NOMBRE DE LA CLIENTA], días/horas, número de WhatsApp. Las políticas de las garantías vienen de una referencia: confirmarlas.

## Backend que falta (Supabase) — preguntar antes de cada migración

- Cupones en pedidos web: hoy no se validan (ver `95_cupones_referido.sql`). Agregar `p_codigo_cupon` a `confirmar_pedido_productos()`, columnas `cupon_id` y `descuento_monto` en `pedidos_web`, marcar CANJEADO al confirmar y revertir si se anula (como `96_anular_venta_revierte_cupon.sql`). Reglas: 1 cupón por pedido, % sobre el subtotal de productos, monto fijo ≤ subtotal, no descuenta delivery.
- Descuento por producto: `productos` solo tiene `precio`; falta un precio anterior (ej. `precio_antes`) editable en Inventario.
- Pago: guardar método y la imagen del comprobante (Storage) en `pedidos_web`, verla en Pedidos Web del POS; número Yape/Plin y cuenta configurables (ya existe `cuenta_transferencia`, `52_cuenta_transferencia_negocio.sql`).
- Día y hora: guardar fecha y franja en `pedidos_web`; opciones desde el horario de atención (`74_horario_atencion.sql`).
- Comprobante: guardar tipo (BOLETA/FACTURA), `ruc` y `razon_social` en `pedidos_web`.
- Recordar: toda tabla/columna nueva necesita GRANT explícito además de RLS.
