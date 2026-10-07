# Revisión previa: cupones existentes, 5 productos con costo cero y protecciones de servicios

Estado: **preparación; nada se modificó en producción ni se confirmó ningún costo.** Datos de producción solo en lectura (nombres de productos y servicios, precios, agregados de cupones; sin datos personales). Pruebas en la instancia desechable con la forma de estos datos (`RESULTADO-ENSAYO.md` §6).

## 1. Por qué importa aunque Recompensas esté apagado

Las migraciones 14–16 añaden protecciones que se evalúan **en `confirmar_venta` y en el pedido web aunque `recompensas_config.activo = false`**: un cupón se aplica solo si `subtotal − descuento ≥ protección total` (productos: costo + transporte + otros; servicios: materiales + % protegido del precio + otros; **sin configuración: se conserva el respaldo del 50 % por partida**), y un producto de costo desconocido bloquea el cupón. Las ventas sin cupón y el descuento manual **no cambian**.

## 2. Cupones existentes (3)

| Cupón | Estado | Efecto tras la actualización (ensayo) |
|---|---|---|
| `FIDELIZACION` 20 % | DISPONIBLE | Funciona en Caja: producto de S/15 × 2 → total S/24; servicio de S/350 → S/280. **Hoy falla en Caja** (QA-019). |
| `REFERIDO_BIENVENIDA` S/10 | DISPONIBLE | Funciona: producto S/15 × 2 → total S/20; servicio de S/28 → S/18; **servicio de S/10 → rechazado** («supera el límite del servicio … hasta el 50 % del precio»). **Hoy falla en Caja** (QA-019). |
| `REFERIDO_RECOMPENSA` S/5 | ANULADO | Sin cambio. |

Los cupones existentes quedan **sin vencimiento** (`vigente_hasta` NULL, «legítimo»). Ninguno cambia de estado ni de valor con la actualización (la huella de las columnas comparadas de `cupones` —id, cliente, código, origen, valor, estado, tipo— no cambió; alcance en `RESULTADO-ENSAYO.md` §3).

## 3. Los 5 productos con costo 0 (producción, solo lectura)

Mientras su costo no esté **confirmado** (`costo_confirmado`) o sea > 0, **cualquier cupón queda bloqueado en compras que los incluyan** (mensaje neutro a la clienta: «por ahora no se puede aplicar»; al personal: «falta registrar el costo de compra de …»). No se bloquea la venta sin cupón ni el descuento manual.

| Producto | Precio | Costo hoy | Stock | Activo | Id |
|---|---|---|---|---|---|
| Pulsera 3 mariposas | S/25 | 0,00 | 1 | sí | `244de7dc-ed09-495d-bef9-e19480eeef64` |
| Pulsera  Estrellita y lunitas | S/15 | 0,00 | 8 | sí | `2efd6362-765d-4e6c-a591-44b6435e3284` |
| Tobillera | S/20 | 0,00 | 2 | sí | `928f44e6-93dd-4f59-a180-016c8f3702dd` |
| AR-O1 | S/10 | 0,00 | 1 | sí | `98139e36-1417-4ae8-8005-0187d4f45494` |
| Arete  roseta flor  unico | S/15 | 0,00 | 1 | sí | `cfb6ca35-0543-48d7-93e5-c1141f95b5c9` |

**Revisión propuesta (una por una, por el propietario; sin confirmación en bloque):** para cada fila decidir entre (a) registrar el costo real de compra (> 0) en Inventario, o (b) si el costo cero es real (p. ej. regalo o fabricación propia), confirmarlo explícitamente en Web → Recompensas Web → «Protección de productos» (marca `costo_confirmado`), opcionalmente con transporte/otros. Quien no decida **mantiene el bloqueo del cupón**, que es el comportamiento seguro. Esta revisión se hace **después** de aplicar las migraciones (la pantalla y la tabla `productos_proteccion` no existen hoy) y no requiere SQL manual.

Consulta de solo lectura para verificar el estado (administrador, tras la actualización):

```sql
select p.nombre, p.precio, p.costo, coalesce(pp.costo_confirmado, false) as confirmado,
       coalesce(pp.transporte, 0) as transporte, coalesce(pp.otros, 0) as otros
from public.productos p left join public.productos_proteccion pp on pp.producto_id = p.id
where p.costo = 0 or p.costo is null order by p.nombre;
```

## 4. Servicios: ninguno tiene protección configurada (`servicios_proteccion` no existe hoy)

Todos usan el **respaldo del 50 %**: un cupón descuenta como máximo la mitad del precio de la partida. Efecto práctico con los cupones actuales (S/10 de bienvenida):

* **No admiten el cupón de S/10** (10 > 50 % del precio): los **9 servicios de S/10 y S/15** — `acripie`, `Depilación de boso`, `Depilacion de cejas con navaja`, `Flor 3D`, `Reconstrucción de uñas` (S/10); `Depilación  de rostro con navaja`, `Depilación de cejas cera`, `Maquillaje niña`, `Preparacion de uñas` (S/15).
* Desde S/20 sí (`Retiro de soff gel`, `Visaguismo de cejas` S/20 admiten hasta S/10).
* El cupón del 20 % cabe en todos (20 % < 50 %).
* En un **carrito mixto** el descuento se reparte entre partidas y se evalúa la regla global (ensayo D: producto S/15 + servicio S/10 con cupón S/10 → permitido, total S/15).

Los 33 servicios de producción (precio): 10 ×5, 15 ×4, 20 ×2, 25 ×4 (1 inactivo), 35 ×2, 40, 50 ×2, 55, 60 ×4, 65 ×2, 75, 80, 200, 250, 350 ×2. **Solo 4 tienen un porcentaje de asistente asignado** (Porcentajes): para los demás la atención no se puede completar hoy (regla existente, sin relación con esta actualización).

**Revisión propuesta:** el propietario decide, servicio por servicio, si el respaldo del 50 % es suficiente o si configura el «% protegido de asistente», materiales y otros en Recompensas Web → «Protección de servicios» (la interfaz marca «Pendiente de actualizar» las filas sin porcentaje). Es una **estimación**: no cambia comisiones guardadas, Porcentajes ni pagos a asistentes.

## 5. Antes y después de publicar

| Momento | Qué verificar (sin tocar datos) |
|---|---|
| Antes | Lista de los 5 productos y los 33 servicios (esta hoja); decidir si algún cupón activo debe convertirse o mantenerse; avisar a Caja de que un cupón puede rechazarse por protección |
| Justo después del backend | Probar el rechazo/aceptación de un cupón con un producto de costo conocido y con uno de los 5 (no se consume: la vista previa del pedido es de solo lectura) |
| Después del frontend | Revisar en Recompensas Web las dos pestañas de protección; confirmar o registrar costos uno por uno |
