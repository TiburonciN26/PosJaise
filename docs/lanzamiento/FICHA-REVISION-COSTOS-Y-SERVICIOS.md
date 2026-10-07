# Ficha de revisión: 5 productos con costo cero y protecciones de servicios

Estado: **ficha para que el propietario la complete. No contiene costos inventados; todo campo en blanco es una decisión pendiente.** Nada se confirmó en bloque ni se modificó en producción. Origen de los datos: consulta **de solo lectura** a producción (nombre, precio, stock, id; sin datos personales) del 2026-10-08.

## Reglas de uso

1. **Un producto o servicio a la vez.** Cada decisión se registra con su evidencia (factura, boleta del proveedor, receta de materiales). Sin evidencia, la decisión es **C: mantener el bloqueo**, que es el comportamiento seguro.
2. **Nunca «confirmar todos»**. La interfaz no tiene (ni se debe crear) una acción en bloque; esta ficha tampoco la admite.
3. **No se escribe SQL en producción.** Los cambios se hacen con la propia aplicación **después** de publicar la actualización (la pantalla y las tablas `productos_proteccion` y `servicios_proteccion` no existen hoy), con la cuenta de ADMINISTRADOR. En el ensayo se comprobó el efecto con datos ficticios.
4. **Qué significa cada decisión (productos):**
   * **A. Registrar el costo real** (> 0) en Inventario (pestaña de edición del producto): el producto deja de bloquear cupones.
   * **B. Confirmar que el costo cero es real** (regalo, fabricación propia sin costo de compra) en Web → Recompensas Web → «Protección de productos» (marca `costo_confirmado`, con transporte y otros si corresponden). Requiere una razón escrita.
   * **C. Mantener el bloqueo**: ningún cupón se aplica a compras que incluyan el producto; la venta sin cupón y el descuento manual no cambian.
5. **Efecto de la protección en cupones:** un cupón se acepta solo si `subtotal − descuento ≥ protección total` (productos: costo + transporte + otros; servicios: materiales + % protegido del precio + otros; sin configuración de servicio rige el respaldo del 50 % por partida). Ver `REVISION-CUPONES-PROTECCION.md`.

## 1. Productos con costo 0 (5)

Para cada producto: completar **solo** los campos que el propietario conozca. «Evidencia» = documento que respalda el costo (no se adjunta aquí).

### 1.1 Pulsera 3 mariposas

| Dato (producción, solo lectura) | Valor |
|---|---|
| Id | `244de7dc-ed09-495d-bef9-e19480eeef64` |
| Precio de venta | S/25 |
| Costo registrado hoy | 0,00 |
| Stock | 1 |
| Activo | sí |

| A completar por el propietario | |
|---|---|
| Costo real de compra (S/) | |
| Transporte por unidad (S/) | |
| Otros costos por unidad (S/) | |
| Evidencia (proveedor, documento, fecha) | |
| Decisión (A registrar / B confirmar cero real / C mantener bloqueo) | |
| Motivo si es B | |
| Fecha y quién decide | |
| Verificación posterior (cupón de prueba aceptado/rechazado como se espera) | |

### 1.2 Pulsera Estrellita y lunitas

| Dato (producción, solo lectura) | Valor |
|---|---|
| Id | `2efd6362-765d-4e6c-a591-44b6435e3284` |
| Precio de venta | S/15 |
| Costo registrado hoy | 0,00 |
| Stock | 8 |
| Activo | sí |

| A completar por el propietario | |
|---|---|
| Costo real de compra (S/) | |
| Transporte por unidad (S/) | |
| Otros costos por unidad (S/) | |
| Evidencia (proveedor, documento, fecha) | |
| Decisión (A registrar / B confirmar cero real / C mantener bloqueo) | |
| Motivo si es B | |
| Fecha y quién decide | |
| Verificación posterior (cupón de prueba aceptado/rechazado como se espera) | |

### 1.3 Tobillera

| Dato (producción, solo lectura) | Valor |
|---|---|
| Id | `928f44e6-93dd-4f59-a180-016c8f3702dd` |
| Precio de venta | S/20 |
| Costo registrado hoy | 0,00 |
| Stock | 2 |
| Activo | sí |

| A completar por el propietario | |
|---|---|
| Costo real de compra (S/) | |
| Transporte por unidad (S/) | |
| Otros costos por unidad (S/) | |
| Evidencia (proveedor, documento, fecha) | |
| Decisión (A registrar / B confirmar cero real / C mantener bloqueo) | |
| Motivo si es B | |
| Fecha y quién decide | |
| Verificación posterior (cupón de prueba aceptado/rechazado como se espera) | |

### 1.4 AR-O1

| Dato (producción, solo lectura) | Valor |
|---|---|
| Id | `98139e36-1417-4ae8-8005-0187d4f45494` |
| Precio de venta | S/10 |
| Costo registrado hoy | 0,00 |
| Stock | 1 |
| Activo | sí |

| A completar por el propietario | |
|---|---|
| Costo real de compra (S/) | |
| Transporte por unidad (S/) | |
| Otros costos por unidad (S/) | |
| Evidencia (proveedor, documento, fecha) | |
| Decisión (A registrar / B confirmar cero real / C mantener bloqueo) | |
| Motivo si es B | |
| Fecha y quién decide | |
| Verificación posterior (cupón de prueba aceptado/rechazado como se espera) | |

### 1.5 Arete roseta flor unico

| Dato (producción, solo lectura) | Valor |
|---|---|
| Id | `cfb6ca35-0543-48d7-93e5-c1141f95b5c9` |
| Precio de venta | S/15 |
| Costo registrado hoy | 0,00 |
| Stock | 1 |
| Activo | sí |

| A completar por el propietario | |
|---|---|
| Costo real de compra (S/) | |
| Transporte por unidad (S/) | |
| Otros costos por unidad (S/) | |
| Evidencia (proveedor, documento, fecha) | |
| Decisión (A registrar / B confirmar cero real / C mantener bloqueo) | |
| Motivo si es B | |
| Fecha y quién decide | |
| Verificación posterior (cupón de prueba aceptado/rechazado como se espera) | |

Consulta de **solo lectura** para ver el estado, ya publicada la actualización (ADMINISTRADOR):

```sql
select p.nombre, p.precio, p.costo, coalesce(pp.costo_confirmado, false) as confirmado,
       coalesce(pp.transporte, 0) as transporte, coalesce(pp.otros, 0) as otros
from public.productos p left join public.productos_proteccion pp on pp.producto_id = p.id
where p.id in ('244de7dc-ed09-495d-bef9-e19480eeef64','2efd6362-765d-4e6c-a591-44b6435e3284','928f44e6-93dd-4f59-a180-016c8f3702dd',
               '98139e36-1417-4ae8-8005-0187d4f45494','cfb6ca35-0543-48d7-93e5-c1141f95b5c9')
order by p.nombre;
```

## 2. Protecciones de servicios (33)

Hoy **ningún servicio tiene protección configurada**: todos usan el **respaldo del 50 %** (un cupón descuenta como máximo la mitad del precio de la partida). Solo 4 servicios tienen un porcentaje de asistente asignado en Porcentajes (columna «% asist.»; es una regla preexistente sin relación con esta actualización: sin porcentaje la atención no se puede completar).

**Qué decide el propietario por servicio:** si el respaldo del 50 % es suficiente (**dejarlo**) o si se configura la protección propia (materiales S/, «% protegido de asistente», otros S/) en Recompensas Web → «Protección de servicios». Es una **estimación**: no cambia comisiones guardadas, Porcentajes ni pagos a asistentes. Los datos de materiales y porcentajes **no se inventan**: se dejan en blanco hasta que se conozcan.

Columna «Cupón S/10»: efecto con el respaldo del 50 % (un cupón de S/10 solo cabe si el precio es ≥ S/20).

| # | Servicio | Precio S/ | % asist. asignado | Activo | Cupón S/10 con el respaldo 50 % | Materiales S/ | % protegido asistente | Otros S/ | Decisión (dejar 50 % / configurar) | Fecha y quién |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | acripie | 10 | no | sí | rechazado | | | | | |
| 2 | Depilación de boso | 10 | sí | sí | rechazado | | | | | |
| 3 | Depilacion de cejas con navaja | 10 | no | sí | rechazado | | | | | |
| 4 | Flor 3D | 10 | no | sí | rechazado | | | | | |
| 5 | Reconstrucción de uñas | 10 | no | sí | rechazado | | | | | |
| 6 | Depilación de rostro con navaja | 15 | sí | sí | rechazado | | | | | |
| 7 | Depilación de cejas cera | 15 | no | sí | rechazado | | | | | |
| 8 | Maquillaje niña | 15 | no | sí | rechazado | | | | | |
| 9 | Preparacion de uñas | 15 | no | sí | rechazado | | | | | |
| 10 | Retiro de soff gel | 20 | no | sí | permitido | | | | | |
| 11 | Visaguismo de cejas | 20 | no | sí | permitido | | | | | |
| 12 | Pigmentación con hena | 25 | no | sí | permitido | | | | | |
| 13 | serPrueba | 25 | no | sí | permitido | | | | | |
| 14 | ServicioPruebaa (inactivo) | 25 | sí | no | permitido | | | | | |
| 15 | Visagismo con cera | 25 | no | sí | permitido | | | | | |
| 16 | Depilacion de rostro Indú | 35 | no | sí | permitido | | | | | |
| 17 | Laminado de cejas con Navaja | 35 | no | sí | permitido | | | | | |
| 18 | Laminado de cejas con Cera | 40 | no | sí | permitido | | | | | |
| 19 | Manicure gel | 50 | sí | sí | permitido | | | | | |
| 20 | Pedicure tradicional | 50 | no | sí | permitido | | | | | |
| 21 | Mantenimiento Gel | 55 | no | sí | permitido | | | | | |
| 22 | Pedicure Gel | 60 | no | sí | permitido | | | | | |
| 23 | Podologia | 60 | no | sí | permitido | | | | | |
| 24 | Rubber gel | 60 | no | sí | permitido | | | | | |
| 25 | Uñas Acrilicas #1-#3 | 60 | no | sí | permitido | | | | | |
| 26 | uñas builder gel | 65 | no | sí | permitido | | | | | |
| 27 | Uñas Soff Gel | 65 | no | sí | permitido | | | | | |
| 28 | uñas acrilicas ojo de gato | 75 | no | sí | permitido | | | | | |
| 29 | Liffting Koreano | 80 | no | sí | permitido | | | | | |
| 30 | Neutralización de labios | 200 | no | sí | permitido | | | | | |
| 31 | Powder Brown (S/250) | 250 | no | sí | permitido | | | | | |
| 32 | Micro lips Neutralización | 350 | no | sí | permitido | | | | | |
| 33 | Powder Brown (S/350) | 350 | no | sí | permitido | | | | | |

Notas: «serPrueba» y «ServicioPruebaa» parecen datos de prueba del propio negocio; decidir si se desactivan o eliminan es una tarea del propietario, **no** de esta actualización. Hay dos servicios llamados «Powder Brown» (S/250 y S/350); se distinguen aquí por precio.

## 3. Cómo verificar cada decisión (sin tocar datos reales)

1. Tras guardar una decisión en la pantalla, anotar la hora y el valor mostrado.
2. Probar el efecto con la **vista previa de cupón del pedido web** (solo lectura, no consume el cupón) o con un carrito sin confirmar, con una cuenta de prueba; no se crean ventas reales para esto.
3. Si el resultado no es el esperado (p. ej. el producto sigue bloqueando tras registrar el costo), **detenerse** y no seguir con los demás.

## 4. Lo que esta ficha NO hace

* No asigna costos, no confirma ceros, no activa nada ni modifica datos de producción.
* No decide por el propietario ni propone cifras.
