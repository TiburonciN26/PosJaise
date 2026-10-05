# Separación POS / Web de Servicios y Productos — clasificación propuesta



Estado: **clasificación aprobada con decisiones (2026-10-04) e IMPLEMENTADA en Local; pendiente de re-test independiente.** Ver «Implementación» al final. Sale del código actual

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

## Decisiones aprobadas

- **Servicios** — POS: nombre, categoría, precio real, duración, activo. Web: precio variable y nota, disponibilidad y costo a domicilio, descripción,
  «el resultado dura», foto, galería, tendencia, combo y contenido editorial.
- **Productos** — POS: código, nombre, categoría, subcategoría, costo, precio real, stock, proveedor (y activo/stock mínimo). Web: precio anterior y fecha de
  oferta, descripción, contenido, rinde, frecuencia, foto, galería, combo, destacados y contenido editorial.
- El precio real es compartido. La fecha de oferta sigue siendo informativa (sin vencimiento automático). La protección económica queda en Recompensas Web;
  su campo «Materiales (S/)» se llama ahora «Materiales protegidos (S/)» para no confundirlo con el contenido editorial «Materiales usados».

## Implementación

- `src/lib/catalogoCampos.js`: listas de columnas y constructores de payload de cada interfaz (una sola fuente; probados).
- `ModalServicio` / `ModalProducto` con `modo='pos' | 'web'`: cada modo muestra y guarda SOLO sus columnas (el UPDATE no menciona las del otro).
  Alta desde POS: solo columnas POS (el contenido Web queda con los valores por defecto de la base). Las fotos y la galería solo se tocan en modo Web.
- `src/pages/CatalogoWeb.jsx`, ruta `/catalogo-web` (Web → Catálogo Web, pestañas Productos / Servicios, solo ADMINISTRADOR): lista con búsqueda y
  paginación en el servidor; «Contenido Web» abre el modo Web; `?tab=…&id=<ficha>&desde=<ruta>` abre la ficha por ID con «← Volver a …».
- «Editar en Web» (solo ADMINISTRADOR, ficha existente) en Inventario y Servicios. Servicios conserva además «Protección económica (Recompensas Web)».
- Como las pestañas del POS siguen montadas, el borrador del modal POS, los filtros y la posición se conservan al volver; nada se guarda ni se descarta
  en silencio. Si se pide otra ficha con un modal abierto en Catálogo Web, se avisa y se elige («Seguir con la abierta» o «Abrir la solicitada (descarta…)»).
- `SelectorProductoBuscable` reemplaza el `<select>` de combo de productos (que solo veía la página cargada).
- Permisos sin cambios: escritura de fichas solo ADMINISTRADOR (RLS), ruta `/catalogo-web` solo ADMINISTRADOR.

## Pruebas

- `catalogo-pos-web.test.mjs` (9, datos/SQL con claims simulados): columnas disjuntas y completas; constructores; alta solo POS; guardado alternado POS/Web
  sin pérdida (servicio y producto); la fecha de oferta no cambia el precio; CAJERA y ASISTENTE no escriben; CLIENTE lee el contenido Web; tamaños grandes.
- `qa-catalogo-web.spec.mjs` (7, interfaz; **no ejecutado**: faltaba `QA_TEST_PASSWORD`).
- `qa-025-029` (QA-028): la validación de «precio antes» con texto parcial se movió al formulario Web (`qa-catalogo-web`); el resto no cambia.
- `qa-046-servicios`: el caso del combo se mueve a Catálogo Web.

## Límites

- No se probó en navegador la apariencia de los formularios ni el aviso de «otra ficha con cambios pendientes» (código sin ejercitar).
- El contenido Web no se valida más allá de lo que ya validaba (costo a domicilio, precio anterior).

## QA-049 (borrador pendiente al pedir otra ficha)

Defecto del re-test de Codex (fec5e60): con el modal Web de A abierto (cambios sin guardar), al pedir B por «Editar en Web» la decisión
«Seguir / Abrir la solicitada» era un aviso de página que quedaba DETRÁS del overlay del modal (inalcanzable por ratón y teclado).
Corrección acotada a `CatalogoWeb.jsx`: la decisión es un diálogo propio (`DialogoConflictoBorrador`, z-40 sobre el modal z-30) con foco inicial
en «Seguir con la ficha abierta», Escape = conservar, y «Abrir la solicitada (descarta los cambios sin guardar)». Conservar no abre B ni guarda A y
deja la URL describiendo a A (pestaña e ID); descartar abre exactamente B por ID. No se tocaron hooks compartidos.
Casos: `qa-catalogo-web.spec.mjs` (7 de QA-049, **sin ejecutar** por falta de `QA_TEST_PASSWORD`; el defecto se reproduce por inspección del código y
por la evidencia de Codex, no por una corrida mía antes de la corrección). Los dos pasos del arnés que pulsaban «Volver» con el modal Web abierto ahora
cierran antes el modal (Cancelar en el caso de producto, Escape en el de servicio) y esperan su desaparición.

### QA-049 — segunda ronda (Escape y foco), re-test de Codex sobre 480fe5a

- **Escape (defecto real):** `useCerrarConEscape` registraba la capa en la pila en un efecto que dependía de la identidad de `onCerrar`. Como
  `CatalogoWeb` pasa funciones nuevas en cada render, cada render volvía a registrar el modal Web AL TOPE de la pila (los hijos se re-registran en
  el orden del JSX: la decisión primero, el modal después). Un Escape cerraba entonces el modal (`cerrarModal` también borra la decisión) y se perdía
  el borrador; el z-index no ordena los listeners. **Corrección:** el hook se registra una sola vez por apertura (depende solo de `activo`) y lee
  `onCerrar` por ref (siempre la versión más reciente). Efecto sobre sus 46 consumidores: ninguno cambia de contrato; las capas apiladas pasan a
  responder en el orden real de apertura, que era la intención declarada del hook.
- **Foco:** `useModalA11y` devuelve el foco al elemento que lo tenía al abrir la decisión; en este flujo ese elemento está en una pestaña POS oculta,
  así que el foco caía en `body` y el siguiente Tab salía del formulario hacia «Contenido Web» del fondo. **Corrección:** al cerrarse la decisión,
  `CatalogoWeb` lleva el foco al primer control del modal que sigue abierto (si el foco no está ya dentro).
- **Arnés:** el ID pedido se elige por tipo de B (antes `B.productId ?? B.serviceId` tomaba el `productId` heredado del fixture global); los buscadores
  del POS se acotan al visible (con las pestañas montadas hay dos «Buscar producto...»).
- **Pruebas añadidas:** foco estable (esperando a que la decisión se cierre y luego Tab/Shift+Tab), Escape de dos capas (primero la decisión, luego el
  modal) y Escape con producto A → servicio B. **Sin ejecutar** en la sesión en que se escribieron (sin `QA_TEST_PASSWORD`).

### QA-049 — tercera ronda (capas ocultas), re-test de Codex sobre 24b7cfa

- **Defecto persistente:** el segundo Escape cerraba el modal POS de B, que quedaba montado pero OCULTO (su pestaña está en `display:none` porque
  `PestanasCacheadas` mantiene las pestañas visitadas), y hacía falta un tercer Escape para cerrar el modal Web visible. Un diálogo de una pestaña
  oculta seguía en la pila de Escape (y en la trampa de foco): el orden de apertura no basta cuando una ruta se oculta.
- **Corrección:** `PaginaActivaContext` (nuevo): `PestanasCacheadas` envuelve cada página con su visibilidad real; `useCerrarConEscape` y `useModalA11y`
  tratan un diálogo de una página oculta como inactivo (sin Escape, sin trampa de foco, sin bloqueo de scroll) y lo reactivan al volver a ser visible.
  No se desmonta nada ni se descarta ningún borrador. Fuera de `PestanasCacheadas` el valor por defecto es «visible» (sin cambio para el portal, etc.).
- **Intermitencia del primer Escape (producto → servicio):** causa **no demostrada** (no la reproduje). Como endurecimiento del único candidato
  plausible que pude razonar, la capa de Escape se registra con `useLayoutEffect` (listener listo en el mismo commit en que aparece el diálogo). No se
  afirma que sea la causa.
- **Pruebas añadidas:** `qa-catalogo-web.spec.mjs` (2): el modal POS oculto de B (producto y servicio) no recibe el Escape del diálogo visible, cada
  Escape cierra una sola capa visible y el borrador POS de B sobrevive al retorno. El caso de segundo Escape ya existente (línea 362) es el que falló.
  **Sin ejecutar** en esta sesión (sin `QA_TEST_PASSWORD`), por lo que «falla antes / pasa después» sigue pendiente de la corrida.

