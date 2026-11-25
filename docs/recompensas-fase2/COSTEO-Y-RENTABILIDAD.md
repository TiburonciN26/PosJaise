# Costeo detallado, comisión real, tope de cupón parejo y rentabilidad de Recompensas

Estado: implementado **solo en Supabase Local** (migraciones `20261124000001` a `20261124000005`), a la espera de aprobación de la dueña. Producción **no** se tocó. Recompensas sigue apagado en producción.

Regla de interfaz: **todo se configura desde la pestaña Web → Recompensas**. No se agregó ni cambió nada en las pestañas del POS (Ventas, Inventario, Servicios…). Internamente el backend sí está conectado (`confirmar_venta` guarda el costo de cada línea).

## Por qué

El formulario antiguo pedía un único «% protegido de asistente» por servicio: una estimación. Pero cada asistente tiene un % distinto por servicio (`porcentajes`) y cada atención ya guarda su comisión real (`registro_servicios.porcentaje_aplicado` / `pago_asistente`). Y «materiales» / «otros» eran dos casillas genéricas.

La dueña necesita saber con precisión, a largo plazo, si gana o pierde dinero con cada servicio, producto y con el programa de puntos.

## Reglas de negocio confirmadas (2026-11-24)

1. A la asistente se le paga su comisión sobre el **precio real** del servicio; una promoción o un cupón del salón **no** la reduce. El descuento sale del margen del salón.
2. Los **materiales** de un servicio no se escriben sueltos: se eligen del **almacén** (si se usa en un servicio, existe en el salón). Lo que no es material (tarjeta/POS, otro costo directo, tiempo del local) se agrega aparte.
3. El **tope del cupón es parejo por servicio**: dos clientas con el mismo servicio tienen el mismo tope, sin importar quién las atendió. (Las monedas y los sellos tampoco dependen de la asistente: se calculan sobre lo gastado.)

## Migraciones

| Migración | Qué hace |
|---|---|
| `20261124000001_recompensas_proteccion_comision_real` | `recompensas_proteccion_servicio(servicio, precio, atención)` calcula la mano de obra con la comisión real. `confirmar_venta` y `recompensas_evaluar_cupon` le pasan la atención de cada línea (parche en el punto de llamada sobre la definición vigente). |
| `20261124000002_recompensas_costeo_detallado` | Tablas `servicios_costos_detalle` y `productos_costos_detalle` (solo admin), funciones `guardar_/quitar_costeo_servicio\|producto` (atómicas), `almacen_costos_sugeridos()`, y el **desglose** por categoría en la protección que cada venta guarda. |
| `20261124000003_recompensas_rentabilidad` | `recompensas_rentabilidad(desde, hasta)` (solo admin, solo lectura). |
| `20261124000004_costeo_envase_y_usos` | Columnas `costo_compra` y `rinde` en las líneas de servicio; la base calcula el costo por uso. |
| `20261124000005_recompensas_tope_cupon_parejo` | El piso del cupón deja de depender de quién atendió; el costo **real** de la venta se guarda aparte (`asistente_real`, `total_real`, `modo_real`) y la rentabilidad usa ese costo real. |

### Mano de obra: piso del cupón (parejo) y costo real (para la ganancia)

**Piso del cupón** (lo que limita el descuento; igual para toda clienta del servicio), en orden:

1. `COMISION_MAX` — el % más alto entre asistentes **activas** con % en ese servicio, sobre el precio (hacia arriba al centavo). Caso conservador: protege aunque atienda la que más cobra.
2. `PORCENTAJE` / 3. `IMPORTE_FIJO` — la estimación antigua (`asistente_pct`, `asistente`) solo si ninguna asistente tiene %. Esas columnas se conservan por compatibilidad y ya no se editan desde la interfaz.
4. El piso nunca baja de lo que realmente se paga: si quien atendió cobra más que ese máximo (por ejemplo, ya no figura entre las activas), se usa su comisión real.

**Costo real de la venta** (lo que mide el reporte de rentabilidad; se guarda en la foto de la venta):

- `COMISION_REAL` — precio de la atención × % vigente de esa asistente en ese servicio (el disparador de comisión recalcula con el % vigente al vender; si ya no hay %, el `pago_asistente` guardado).
- `DUENA` — atendió una cuenta ADMINISTRADOR (se queda con el 100 %, no es un pago en efectivo) → 0.
- Sin atención conocida: se usa el mismo valor del piso.

Sin fila en `servicios_proteccion` («sin configurar») no cambia nada: respaldo del 50 % (sin materiales no hay piso confiable).

### Receta de costos

Cada línea de servicio guarda lo que se **compró** (`costo_compra`) y para cuántos **usos** rinde (`rinde`, vacío = 1); la base calcula el costo por uso = `costo_compra ÷ rinde` (4 decimales) y la línea suma `cantidad × costo por uso`. Las líneas antiguas (sin `costo_compra`) se siguen leyendo con su `costo_unitario`.

Servicio (por vez): `INSUMO`, `DESCARTABLE`, `HERRAMIENTA` → «materiales» del piso (**se eligen del almacén**); `TARJETA_POS`, `OTRO` → «otros» del piso; `LOCAL` (tiempo/uso del local) → **informativo**, no limita cupones, solo se resta del margen real.
Producto (por unidad): `TRANSPORTE` → «transporte»; `EMPAQUE`, `TARJETA_POS`, `OTRO` → «otros». El costo de compra sigue saliendo de `productos.costo` (no se duplica).

Los totales se redondean **hacia arriba** al centavo. Guardar sin líneas es válido (decisión explícita: costo directo 0).

**Materiales solo del almacén.** El botón «Agregar línea» ya no existe en el costeo de servicios. Un material se agrega con un **buscador del almacén** (mismo estilo que el de Ventas: un solo cuadro; al escribir o enfocar aparece la lista filtrada; sin mayúsculas ni tildes; cada palabra escrita debe aparecer en el nombre; un material ya agregado no se duplica) y su nombre y unidad vienen del almacén. Lo que no es material se agrega con «Agregar otro costo (no es material)». Una línea de material antigua sin vincular avisa y no se puede guardar hasta elegir el material o quitarla (validación en la pantalla; la base sigue aceptando líneas antiguas).

### Foto del costo en cada venta

`confirmar_venta` guarda la protección por línea en `recompensas_venta_detalle.proteccion`: `modo`, `asistente`, `materiales`, `otros`, `total` (el piso del cupón), `modo_real`, `asistente_real`, `total_real` y `desglose` por categoría. Cambiar una receta después **no** reescribe el historial.

### Reporte de rentabilidad

Por periodo (Lima, máximo 800 días): ventas (bruto, descuentos, neto), margen directo **solo sobre líneas con costo conocido** (el resto se lista como «Sin costo»; nunca se inventa un cero), programa (monedas emitidas/revertidas/canjeadas/pendientes, sellos, descuento por premios), margen por servicio y por producto (top 25) y comparación de clientas con cuenta web («miembras») contra el resto: clientas, ventas por clienta, ticket y % que vuelven (2+ días). La comparación solo se afirma con **al menos 20 clientas en cada grupo**. El costo de un servicio vendido es `total_real` (las ventas antiguas sin esa clave usan `total`).

## Interfaz (pestaña Web → Recompensas)

- **Costeo de servicios**: receta por líneas (materiales con buscador del almacén y costo sugerido de la última compra; «otro costo» aparte), totales, una sola cifra de **cupón máximo para cualquier clienta**, y por cada asistente su %, comisión, costo directo y margen real (más la fila de la dueña), con aviso si una asistente deja pérdida.
- **Costeo de productos**: líneas por unidad, costo de compra de solo lectura, confirmación de costo 0.
- **Rentabilidad**: periodo + las tarjetas anteriores.
- Todo en filas desplegables con animación estándar (`docs/patrones/desplegable-animado.md`).

## Pruebas

- Autónomas (`npm test`): `costeo-recompensas` (cuentas, validaciones, buscador, tope parejo, periodos Lima, cobertura, cohortes), `costeo-ui-ssr` (los componentes reales renderizados con react-dom/server) y `retorno-premio`.
- Capa SQL (exigen rama `testing` y base solo con cuentas `@test.local`; **no se corrieron en esta sesión**): `recompensas-costeo.test.mjs` (nuevo, incluye el tope parejo) y ajustes en `recompensas-proteccion-global.test.mjs` / `recompensas-fase2-helpers.mjs`.
- Verificado a mano en Local con transacciones que se revierten: cada modo de mano de obra, cupón que pasa/rechaza en el límite exacto, que el cupón **no** baja `pago_asistente`, que el tope es el mismo con la asistente y con la dueña (45,01 rechazado para ambas, 45 aceptado), validaciones, reemplazo atómico, permisos (cajera sin acceso) y el reporte con una venta de costo conocido.
- Nota para correr las pruebas de pantalla en Windows: lanzar `node --test` desde un directorio con la letra de unidad en mayúscula (`C:\…`); con `c:\…` Node carga dos copias de React y fallan con «Cannot read properties of null (reading 'useState')».

## Pendiente / decisiones abiertas

- Retorno efectivo objetivo del catálogo y premios finales: a decidir con la dueña (las monedas no vencen).
- Antes de producción: aplicar las migraciones (y las pendientes anteriores), limpiar servicios de prueba y el bono de 10 puntos de una clienta, y revisar «Preparación de uñas» (2 asistentes al 100 %).
- Costear los servicios y productos reales (y registrar en el almacén todo lo que se usa en los servicios): hasta entonces el reporte mostrará «Sin costo».
