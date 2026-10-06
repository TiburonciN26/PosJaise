# Recompensas Fase 2 — migraciones, desfase de `schema_migrations` y transición ×5

Estado: **solo Supabase Local TEST**. Nada de esto se aplicó a producción ni la autoriza.

> **Actualización 2026-10-05 (tercer lote).** Este documento conserva el análisis original; lo que sigue **ya no es el estado actual** y se marca abajo con «(histórico)»: la instalación limpia se verificó en la instancia desechable (137/137), las 13 versiones se registraron en `schema_migrations` de QA con autorización (141 con `20261005000004`), el borrador v2 de la apertura se ensayó en la desechable (no está aplicado en QA ni producción) y la regla de protección de servicios fue sustituida por la regla global del carrito (`PROTECCION-CUPONES.md`). *Hechos comprobados:* lo anterior. *Implementación pendiente:* ninguna de este documento. *Ejecución no autorizada:* la apertura, activar Recompensas y producción.

## Migraciones de esta fase

| Archivo | Qué hace |
|---|---|
| `20261003000001_recompensas_fase2_nucleo.sql` | Libros de monedas/sellos, configuración, protección por servicio, catálogo y canjes, `confirmar_venta`/`anular_venta` con recompensas, canje atómico. **Ya aplicada en Local; no se reescribe.** |
| `20261003000002_recompensas_fase2_correcciones.sql` | QA-033 (restaura el rechazo de roles ≠ ADMINISTRADOR/CAJERA), QA-041 (reparto de centavos por mayor resto) y la regla «sin protección ⇒ cupón hasta el 50 %». |
| `20261003000003_recompensas_simulacion_transicion.sql` | Funciones de **solo lectura** para simular la transición ×5. No escribe nada. |
| `20261004000001_ventas_codigo_mas_de_999.sql` | **QA-045.** `confirmar_venta()` generaba el código con `lpad(n, 3, '0')`, que trunca desde la venta 1000 (`VEN100` ya existía) y hacía fallar TODA venta nueva. Solo cambia la generación del código (idéntica hasta 999). **Defecto latente: cualquier base real fallará al llegar a la venta 1000.** Solo Local; producción pendiente de autorización. |
| `20261003000004_recompensas_lectores_portal.sql` | `mis_puntos()` y `mi_fidelizacion()` coherentes con el libro cuando el programa está activo (idénticos a antes si está apagado); `mis_cupones()` con condiciones y vigencia; `catalogo_recompensas_publico()` (QA-037, exposición mínima). |
| `20261005000001_cupones_proteccion_global.sql` | Regla global del carrito (subtotal − descuento ≥ protección total), porcentaje protegido de asistente y protección de productos. Ver `PROTECCION-CUPONES.md`. |
| `20261005000002_cupones_validacion_pedido.sql` | QA-054: `recompensas_evaluar_cupon` compartida, vista previa de solo lectura y revalidación en el pedido y la verificación del pago. |
| `20261005000003_pedido_cantidades_total_anunciado.sql` | QA-057: el pedido debe coincidir con las cantidades y el total anunciados. |
| `20261005000004_recompensas_reglas_publicas.sql` | Lectura mínima y pública de las reglas vigentes (`recompensas_reglas_publicas()`: tasas, umbrales y sellos; todo nulo con el programa apagado). Ver `COHERENCIA-PORTAL.md`. **Solo Local; producción pendiente de autorización.** |

### Instalación limpia

Aplicar en orden de nombre (como hace `supabase db reset` / `migration up`): …`20261002000008` → `…03000001` → `…03000002` → `…03000003`.
`0002` redefine con `create or replace` las funciones de `0001`, por lo que el estado final es el mismo que el de Local tras aplicar ambas.
**(histórico) No se verificó un reset completo desde cero** cuando se escribió esto: el CLI no estaba instalado. **Ya verificado el 2026-10-05:** el CLI (2.119.0, fuera del proyecto) aplicó 137/137 migraciones y la semilla en la instancia desechable; `public` y `auth` quedaron idénticos a QA (ver `RESULTADOS-ENSAYO.md`).

### Desfase con `supabase_migrations.schema_migrations` (Local)

Las migraciones se aplicaron con `psql` dentro del contenedor (`docker exec -i supabase_db_WedJaiseReact psql …`), sin pasar por el CLI. Comparando archivos contra la tabla (solo lectura) están **sin registrar** 13 versiones (10 en la primera comparación; `20261003000003` y `20261003000004` se aplicaron después), todas con su efecto ya presente en la base:

```
20261002000001 … 20261002000008   (8 correcciones QA anteriores a esta fase)
20261003000001, 20261003000002    (esta fase)
20261003000003, 20261003000004    (simulación y lectores del portal)
20261004000001                    (QA-045, código de venta)
```

Reconciliación segura **(histórico: ejecutada en QA el 2026-10-05 con autorización; las 13 versiones quedaron registradas)**:

1. **No** correr `db reset` ni `migration up` a ciegas: reaplicaría SQL que ya está vigente.
2. Verificar de forma independiente que el efecto de cada versión existe (p. ej. `pg_get_functiondef` de `confirmar_venta` contiene `Solo el administrador o la cajera pueden registrar ventas`; existen las tablas `recompensas_*`).
3. Registrar sin ejecutar: `supabase migration repair --status applied <versión>` (CLI), o insertar la fila en `supabase_migrations.schema_migrations` con su `version` y `name`.
4. Repetir la comparación archivos↔tabla; debe quedar vacía.

Producción: el estado de su historial no se consultó en esta tarea.

## Decisiones de negocio incorporadas

* **(histórico; ver la regla global)** Servicio **sin** protección configurada: el cupón puede descontar **hasta el 50 %** del precio efectivo, truncado a centavos (este respaldo del 50 % se conserva como límite adicional por partida). **Con** protección, el piso individual por partida fue sustituido por la regla global: subtotal − descuento ≥ protección total de todo el carrito. «Ausente» ≠ «configurada en cero».
* Si una partida excede su límite se rechaza el cupón entero, sin consumirlo ni escrituras parciales. No se compensa con otra partida.
* El descuento manual del POS **no cambió**: respeta el piso solo si el servicio tiene protección configurada.
* Un cupón ya vencido no se reactiva al anular su venta; el vencimiento original nunca se modifica.
* **(histórico, sustituido)** Texto para la clienta previo: «En servicios sin protección configurada, los cupones pueden descontar hasta el 50 % del precio. En los servicios con protección, el descuento debe respetar el importe mínimo protegido.» La regla vigente es la **global del carrito** (`PROTECCION-CUPONES.md`) y el texto mostrado a la clienta (`REGLA_PROTECCION`) ya no habla de «importe mínimo protegido» por servicio ni revela cifras internas.

## Simulación de la transición ×5 (solo lectura)

`recompensas_simular_transicion()` (una fila por clienta) y `recompensas_simular_transicion_resumen()` (reconciliación). Solo ADMINISTRADOR.

Fórmula antigua reproducida (`mis_puntos` de `20261002000002`): `floor(visitas·ppv + gastado·pps) + puntos_bono`, con visitas = días de Lima con atenciones ACTIVO. Los productos nunca sumaron puntos y anular una venta nunca bajó los puntos.

Atribución auditable por clienta: `VISITA_DIA`, `ATENCION`, `BONO_MANUAL` y `REDONDEO` (≤ 0, global); suman exactamente los puntos antiguos.

Diseño de la apertura (**implementado solo como borrador v2 fuera de `supabase/migrations/` y ensayado en la instancia desechable; no aplicado en QA ni producción; ejecución no autorizada**):

* Apertura = puntos antiguos × 5 como saldo gastable **y** clasificación inicial; umbrales efectivos = umbrales de `config_puntos` × 5 (se conserva nivel y progreso).
* Sellos pendientes = visitas − 5 × recompensas reclamadas, **íntegros** aunque superen 20.
* Idempotencia: claves únicas `apertura:<cliente>` en ambos libros y un índice único por atención en `recompensas_apertura_aportes`.
* `confirmar_venta` ya omite el aporte de una atención presente en `recompensas_apertura_aportes` (solo ese servicio; productos y servicios nuevos de la misma venta sí acreditan, y el sello del día se evalúa aparte).

### Decisiones A y B (aprobadas por el dueño)

* **A.** Clientas sin cuenta web con puntos históricos: se conservan **en espera** con un saldo congelado al corte; al vincular la cuenta a la misma ficha se habilita **una sola vez** ×5 (saldo disponible y clasificación inicial separados). No se descartan, no se recalculan con actividad posterior ni se acreditan las compras hechas sin cuenta; sin doble apertura por reintento, desvinculación/revinculación u otra cuenta. **Implementado solo en el borrador v2 ensayado en la desechable** (la transición no se ejecuta).
* **B.** Anular una venta histórica (anterior al corte) sin aporte atribuible en el libro nuevo **no** descuenta apertura. Solo se revierten los aportes nuevos realmente acreditados, una vez. Ya es el comportamiento de `anular_venta` (revierte únicamente movimientos `VENTA` de esa venta).

### Casos que NO se pueden atribuir (histórico; ver A y B arriba)

1. **Clientas sin cuenta web vinculada con puntos antiguos.** La regla 1 solo permite acumular con cuenta vinculada; sus puntos antiguos no son visibles hoy para ellas. ¿Se conservan «en espera» hasta vincular, se descartan o se convierten igual?
2. **Ventas históricas con servicios anuladas después del corte.** Con la fórmula antigua anular nunca bajó los puntos (la atención sigue ACTIVO), así que no existe un «aporte de esa venta» que revertir. ¿Se mantiene así (sin reversión) o se quiere revertir el aporte de las atenciones cobradas por esa venta?
3. **Clientas con reclamadas > visitas/5** (sellos pendientes negativos): se reportan tal cual, sin truncar.
4. **Atenciones pendientes de cobro al corte**: ya cubiertas por el mapa de aportes (no se acreditan dos veces); cuántas hay se informa en el resumen.

### Resultado de la simulación en Local (**referencia histórica, ya no vigente**: los totales se recalculan sobre la copia que se use; ver `RESULTADOS-ENSAYO.md`; incluye los fixtures «TEST F2» de las pruebas)

Reconciliación ×5, de aportes y de nivel: **correctas**. Clientas 955 (895 vinculadas); puntos antiguos vinculadas 1 678 → 8 390 monedas de apertura; niveles 871/10/14 (Básico/Premium/VIP); sellos heredados > 20 en 8 clientas; 976 atenciones pendientes de cobro en 272 clientas; 37 clientas sin cuenta web con puntos (89 puntos); 2 con reclamadas > visitas; 167 ventas históricas con servicios. **Exposición económica del saldo inicial y del catálogo: PENDIENTE** (el catálogo real no existe; no se afirma cobertura).

## Cómo ejecutar las pruebas de esta fase

Los archivos comparten la configuración global (`recompensas_config.activo`), por eso **deben ejecutarse en serie**:

```
node --test --test-concurrency=1 tests/e2e/recompensas-fase2.test.mjs tests/e2e/recompensas-fase2-qa033-qa041.test.mjs tests/e2e/recompensas-fase2-transicion.test.mjs
```

Todos los archivos `*.test.mjs` (22 en total, 272 casos aprobados el 2026-10-05) se ejecutan con `node --test --test-concurrency=1 tests/e2e/*.test.mjs`. Nivel de evidencia: SQL contra el contenedor local con `request.jwt.claims` simulado; los casos de privilegios usan `set role authenticated`/`anon`. **No son E2E ni sesiones HTTP reales.** Los casos HTTP (`qa-033-ventas-roles.spec.mjs`, Playwright) requieren `QA_TEST_PASSWORD` en el proceso.
