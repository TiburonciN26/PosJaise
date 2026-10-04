# Separación POS / Web de Servicios y Productos — clasificación propuesta

Estado: **propuesta para aprobación; no se movió ningún campo ni se cambió ningún formulario.** Sale del código actual
(`ModalServicio.jsx`, `ModalProducto.jsx`, payloads de guardado). No cambia permisos ni reglas: la escritura de
`servicios`/`productos` sigue siendo la existente (ADMINISTRADOR; CAJERA/ASISTENTE no editan fichas).

Criterio: **operativo (POS)** = lo que el personal necesita para vender, agendar, cobrar y controlar stock; se queda en el
formulario POS, simple. **Web (editorial/configuración)** = lo que solo alimenta el portal de la clienta (textos largos, galerías,
destacados, recomendaciones); se edita desde el panel Web con «Editar en Web» (ADMIN).

## Servicios (`servicios`)

| Campo | Clase | Motivo |
|---|---|---|
| nombre, categoría, precio, duración (min), activo | **POS** | Citas, cobro, comisiones y estado de la ficha |
| precio variable + nota de precio | **POS** (decisión) | Cambia lo que se cobra/promete; si se prefiere solo-Web, `nota_precio` es editorial pero `precio_variable` es operativo |
| a domicilio + costo a domicilio | **POS** (decisión) | Afecta el cobro/reserva; revisar si el POS lo usa hoy |
| protección (materiales/asistente/otros) | **Web → Recompensas** | Ya existe «Editar en Web» (`/recompensas-web?tab=proteccion&servicio=…&desde=/servicios`) |
| descripción, «el resultado dura» | **Web** | Texto del portal |
| foto principal, galería Resultado/Antes/Después | **Web** | Solo portal |
| en tendencia, combo sugerido | **Web** | Recomendación/orden del portal |
| pasos, especificaciones, herramientas, materiales, cuidados antes/después | **Web** | Contenido editorial del detalle |

## Productos (`productos`)

| Campo | Clase | Motivo |
|---|---|---|
| código de barras, nombre, categoría, subcategoría, costo, precio, stock, proveedor, activo | **POS** | Venta, escáner, inventario y ganancia |
| precio antes de la oferta + oferta hasta | **POS** (decisión) | Cambia el precio visible; hoy lo consume el portal, confirmar si el POS lo usa |
| descripción, contenido, rinde, frecuencia de uso | **Web** | Texto del portal |
| foto principal, galería | **Web** | Solo portal |
| destacado, nuevo, en inicio, combo sugerido | **Web** | Orden/recomendación del portal |
| especificaciones, modo de uso, ideal para, tips, ingredientes, libre de | **Web** | Contenido editorial |

## Cómo se haría (sin implementarlo todavía)

1. Formularios POS: solo los campos **POS**. Conservan validaciones, borrador, foco y Esc actuales.
2. «Editar en Web» (solo ADMIN) abre el panel Web en la ficha concreta (por ID, como ya hace protección) con `desde=<ruta>`;
   «Volver» regresa a la pantalla y al modal de origen.
3. Pendiente por diseñar: **no hay hoy un panel Web para el contenido editorial de productos/servicios**; habría que construirlo
   (sin tocar el portal ni las animaciones). El borrador del modal POS no se guarda implícitamente al navegar: se advierte antes
   de salir con cambios sin guardar.
4. Pruebas dirigidas al implementarlo: ADMIN/CAJERA/ASISTENTE (qué ven y qué rechaza el backend), acceso directo por URL, retorno
   desde el modal, guardado y recarga, y regresión de las cuatro pantallas consumidoras del portal.

## Decisiones que necesito de ti

- Confirmar la clasificación, en especial las filas marcadas «decisión» (precio variable, a domicilio, oferta).
- ¿Un panel Web nuevo, o ampliar «Editar en Web» dentro de Recompensas Web?
