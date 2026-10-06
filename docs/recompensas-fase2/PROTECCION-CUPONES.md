# Protección económica de cupones (regla global del carrito)

Estado: implementado **solo en Supabase Local TEST** (migración `20261005000001_cupones_proteccion_global.sql`, aplicada en QA local con respaldo previo `qa4_20261005T183031Z.dump`). Recompensas sigue **apagado**, la apertura histórica **no** se ejecutó y producción **no** se tocó. Correcciones en **Re-test** para verificación independiente (no Verificado).

## Regla aprobada

Un cupón se aplica solo si **subtotal − descuento ≥ protección total**, con:

- subtotal = productos + servicios, **sin** el envío cobrado a la clienta;
- protección total = suma de las protecciones de todas las partidas y cantidades;
- además el cupón respeta alcance, compra mínima, nivel, vigencia, tope y las demás condiciones existentes.

Si no se cumple, el cupón se rechaza completo («Este cupón supera el descuento permitido para esta compra. Puedes utilizarlo en otra compra.»): sin recortes, sin consumirlo, sin escrituras parciales (la excepción revierte la transacción de `confirmar_venta`). Sustituye el piso individual de las partidas configuradas; una partida puede quedar bajo su protección individual si el carrito completo cubre la suma. Los **descuentos manuales no cambian** (conservan el piso por servicio configurado).

Ejemplo aprobado (subtotal S/100, servicios 25 + productos 15 = 40): cupón S/20 → cobro 80; S/60 → cobro 40; S/60,01 → rechazado.

## Servicios

`protección = materiales + precio efectivo de la atención × % protegido / 100 + otros`.

- «Porcentaje protegido de asistente (%)» (0–100, `servicios_proteccion.asistente_pct`) sustituye en la interfaz al importe fijo; solo ADMINISTRADOR (RLS + `CHECK`). Es una **estimación**: no consulta ni promedia comisiones reales, no cambia Porcentajes, la comisión guardada en la atención, los pagos a asistentes ni el 100 % del propietario ADMINISTRADOR.
- Se usa el precio realmente registrado en la atención (también si es variable).
- **Transición compatible**: la columna `asistente` (S/) se conserva. Una fila con `asistente_pct` nulo sigue usando su importe fijo y la interfaz la marca «Pendiente de actualizar»; nada se convierte automáticamente (S/20 no pasa a 20 %). No se recalculan ventas históricas.
- Redondeo: el importe por porcentaje se redondea **hacia arriba** al centavo (conservador; p. ej. S/33,33 al 45 % = 14,9985 → 15,00).
- Sin configuración: se conserva el respaldo del 50 % (distinto del cero explícito) como límite adicional por partida; para la suma global esa partida protege el importe que debe quedar cobrado (`precio − floor(precio×50)/100`, con centavos).

## Productos

`protección por unidad = productos.costo + transporte de abastecimiento + otros`, × cantidad.

- Tabla nueva `productos_proteccion` (solo ADMINISTRADOR): `transporte`, `otros`, `costo_confirmado`. **No hay segunda copia del costo**: se lee de `productos.costo`.
- `productos.costo` es `NOT NULL DEFAULT 0`: no distingue «cero explícito» de «desconocido». Regla: costo **conocido** si es > 0 o si el administrador lo confirmó (`costo_confirmado`). Costo desconocido ⇒ el cupón se bloquea («falta registrar el costo de compra de … Pide a un administrador que revise la protección del producto») y nunca se inventa un cero.
- No se suman reserva del 10 %, diezmo ni gastos generales. El transporte de abastecimiento es distinto del envío cobrado a la clienta.
- Limita cupones: las ventas sin cupón y los descuentos manuales no cambian.
- **Efecto inmediato en QA local**: 948 de 1.097 productos reales de QA tienen costo 0 sin confirmar, por lo que los cupones quedan bloqueados en compras que los incluyan hasta que el administrador revise o confirme (Web → Recompensas Web → Protección de productos). Es el comportamiento pedido.

## Interfaz (Web del POS, solo ADMINISTRADOR)

`Recompensas Web`: pestaña «Protección de servicios» (porcentaje, aviso de estimación, estado «Pendiente de actualizar») y nueva pestaña «Protección de productos» (búsqueda en servidor, costo registrado de solo lectura, transporte, otros, confirmación de costo cero). `ModalProducto` (Inventario, solo ADMIN) añade «Protección económica (Recompensas Web)» junto a «Editar en Web». No se añadieron campos a los formularios operativos. No se tocaron animaciones, efectos ni el diseño de monedas, cupones, sellos y niveles.

## Texto mostrado a la clienta

`REGLA_PROTECCION` (`src/pages/cliente/recompensas/lib.js`, antes `REGLA_SERVICIOS`): «Los cupones respetan un mínimo de cobro por compra: si el descuento dejara tu total por debajo de lo que el salón necesita para ofrecerla, el cupón se rechaza completo, no se consume y puedes usarlo en otra compra. En servicios sin mínimo configurado, además, un cupón no descuenta más del 50 % del precio.» Sin costos, materiales, transporte ni porcentajes de asistentes. Ver `COHERENCIA-PORTAL.md`.

## Backend y trazabilidad

- Validación **autoritativa en `confirmar_venta`**, que también usa `verificar_pago_pedido_web` (pedidos web). Caja solo recibe el rechazo, sin importes protegidos.
- `recompensas_venta_detalle.proteccion` guarda por partida la protección usada (modo `PORCENTAJE` / `IMPORTE_FIJO` / `RESPALDO_50` / `COSTO`, con sus importes); `recompensas_venta_proteccion` guarda por venta con cupón: subtotal, descuento, protección total y descuento máximo. Solo ADMINISTRADOR lee ambas. Las ventas históricas no se tocan.
- La protección estimada **no** es gasto real ni sustituye comisiones en Estadísticas/Dashboard.
- Intactos: roles de ventas y anulaciones, stock, doble cobro, un cupón por venta, reparto exacto de centavos, monedas sobre netos, reversión idempotente, sellos, referidos, cupones vencidos, códigos > 999.
- `proteccion_servicios_estado()` (lector para personal) usa la protección efectiva con el precio de catálogo.

## Pruebas (capa SQL, Supabase Local TEST)

`tests/e2e/recompensas-proteccion-global.test.mjs` (28 casos): producto S50/costo 20/extras 5 (25 sí, 25,01 no), carrito mixto del ejemplo, protección global con partida bajo su piso individual, alcances PRODUCTOS/SERVICIOS/TODO, monto fijo, porcentaje con tope, premio de servicio, 1 y varias unidades, precio variable, 0/45/100 %, entradas inválidas, configuración antigua/ausente/cero explícito, envío separado, rechazo sin cambios (huella de ventas, ítems, stock, cupón, atención, libros, detalle), anulación y segunda anulación, persistencia, permisos por rol (CAJERA/ASISTENTE/CLIENTA no leen ni escriben protección ni costo; funciones internas no ejecutables), pedido web y monedas por partida.

Expectativas existentes cambiadas por la regla aprobada (no se debilitó ninguna otra):

- `recompensas-fase2.test.mjs`: los dos mensajes `importe mínimo protegido` pasan a `supera el descuento permitido para esta compra` (mismo rechazo, mensaje de la regla global). El caso «ventas mixtas y varios servicios: se valida por partida» (S30 piso 10 + S12 piso 10, cupón S20) antes se rechazaba por el piso individual de la segunda partida; con la regla aprobada se **permite** (42 − 20 = 22 ≥ 20) y ahora se prueba el límite global (S22 sí, S22,01 no).
- `qa-041-reparto-http.spec.mjs`: el mismo cambio de mensaje (no ejecutado: requiere `QA_TEST_PASSWORD`).
- Fixture `nuevoProducto`: costo por omisión S1 (10 % del precio si el precio es menor a S10) y costo 0 confirmado explícitamente, para que los productos de S/1 o S/0,01 de QA-041 sigan probando el reparto y no queden bloqueados por «costo desconocido».

## Observaciones y límites

- (Resuelto en QA-054, ver abajo) el checkout y `confirmar_pedido_productos` ya validan el cupón con la misma lógica que la venta.
- El descuento manual sobre filas de servicio **ya actualizadas a porcentaje** usa la protección efectiva (porcentaje); sobre filas antiguas, el importe fijo como siempre.
- Pendiente (sin `QA_TEST_PASSWORD`): pruebas HTTP/UI con sesiones reales de la nueva pestaña, del botón del modal de producto y del rechazo visto desde Caja; y una suite completa de Playwright al cerrar el lote.

## QA-054 — el cupón se valida antes de pedir el pago (migración `20261005000002_cupones_validacion_pedido.sql`)

**Problema (Codex, con sesiones reales):** producto S/50, protección S/48 (costo 20 + transporte 3 + otros 25), cupón S/10: el checkout anunciaba S/40, `confirmar_pedido_productos` aceptaba el pedido y solo «Verificar pago» lo rechazaba. Reproducido también en rojo por `tests/e2e/qa-054-rojo.mjs` (SQL, en una transacción con ROLLBACK que instala las definiciones anteriores): `pedido_creado`, `total_anunciado_a_la_clienta = 40.00`, `verificar_pago = RECHAZADO`.

**Corrección:**
- Una sola función interna, `recompensas_evaluar_cupon(cupón, carrito)`, evalúa nivel, alcance, compra mínima, tipo, tope, límite del 50 % en servicios sin configurar, costo conocido y protección global. La usan `confirmar_venta` (POS y pedido verificado), `confirmar_pedido_productos` (valida dentro de su transacción: un cupón fuera de límite rechaza el pedido completo) y la vista previa. `recompensas_validar_cupon_pedido` resuelve el cupón de la clienta (disponible, vigente, suyo) y lo evalúa.
- `vista_previa_cupon_pedido(código, productos)`: **solo lectura** (`stable`; no consume el cupón, no reserva stock, no crea pedidos, no acredita). Devuelve únicamente `valido, motivo, subtotal, descuento`. Solo para sesión autenticada; solo cupones propios. El costo desconocido se muestra con un motivo neutro («por ahora no se puede aplicar»): la clienta no recibe costos, componentes, porcentajes ni datos de otras clientas.
- Checkout (`CarritoCliente.jsx`): el descuento ya no se calcula en el navegador. Al aplicar un cupón, o al cambiar productos o cantidades, se valida en el servidor; mientras valida, si se rechaza o si la consulta falla (o tarda más de 15 s) **no se muestra descuento, no se muestra un total pagable ni se puede confirmar**; el motivo se muestra con «Quitar»/«Cambiar» y «Reintentar». El panel de cupones ya no promete «Ahorras S/ X». Sin cambios de diseño, efectos ni animaciones.
- `verificar_pago_pedido_web` conserva la revalidación y, si entre el pedido y la verificación cambiaron precios, costos o protección, falla con **CONFLICTO** explícito (el pedido sigue pendiente; no se cambia el total en silencio ni se cobra ninguna diferencia). Además exige que el total vigente coincida con el que la clienta pagó.
- **Límite documentado:** el pedido congela solo lo que la clienta vio (subtotal, descuento, total); el servidor no «recuerda» los costos de ese momento. Si cambian después, no se intenta cobrar otro importe: el administrador ve el conflicto y decide (corregir la protección, recrear el pedido o reembolsar). La protección global no se debilita para hacer pasar un pedido.

**Pruebas (resultado en el informe de entrega):** `recompensas-pedido-cupon.test.mjs` (14 casos SQL; la identidad se simula con claims, NO es E2E), `ensayo-ui/qa-054-cupon-pedido.ensayo.spec.mjs` (8 casos HTTP/UI con inicio de sesión normal en la instancia desechable), `qa-054-rojo.mjs` (reproducción en rojo).

## QA-055 — fixtures con costo cero sin confirmar

`qa-033-ventas-roles.spec.mjs` creaba por la interfaz un producto de S/20 con costo 0 sin confirmar y la venta con cupón de `beforeAll` fallaba antes de probar permisos. Ahora registra un costo ficticio conocido (S/5). Revisados los demás fixtures de cupones creados por interfaz: `qa-autorizacion-ampliada.spec.mjs` (producto de S/20, costo 0 → S/5) y `qa-cobertura-adicional.spec.mjs` (`createPricedProduct`, costo 0 → 25 % del precio). `helpers.mjs createProduct` (precio S/1, costo 0) **no** se tocó: sus productos no se venden con cupón y el costo 0 se conserva para los casos de finanzas. No se confirmó nada en bloque ni se desactivó la validación; aserciones de permisos y negocio intactas. **No ejecutado** (sin `QA_TEST_PASSWORD`).
