# Recompensas Fase 2 — migraciones, desfase de `schema_migrations` y transición ×5

Estado: **solo Supabase Local TEST**. Nada de esto se aplicó a producción ni la autoriza.

## Migraciones de esta fase

| Archivo | Qué hace |
|---|---|
| `20261003000001_recompensas_fase2_nucleo.sql` | Libros de monedas/sellos, configuración, protección por servicio, catálogo y canjes, `confirmar_venta`/`anular_venta` con recompensas, canje atómico. **Ya aplicada en Local; no se reescribe.** |
| `20261003000002_recompensas_fase2_correcciones.sql` | QA-033 (restaura el rechazo de roles ≠ ADMINISTRADOR/CAJERA), QA-041 (reparto de centavos por mayor resto) y la regla «sin protección ⇒ cupón hasta el 50 %». |
| `20261003000003_recompensas_simulacion_transicion.sql` | Funciones de **solo lectura** para simular la transición ×5. No escribe nada. |

### Instalación limpia

Aplicar en orden de nombre (como hace `supabase db reset` / `migration up`): …`20261002000008` → `…03000001` → `…03000002` → `…03000003`.
`0002` redefine con `create or replace` las funciones de `0001`, por lo que el estado final es el mismo que el de Local tras aplicar ambas.
**No se verificó un reset completo desde cero**: el CLI de Supabase no está instalado en esta máquina y no se ejecutó `db reset` a propósito (borraría los datos de QA). Pendiente de comprobar cuando el CLI esté disponible, en una copia desechable.

### Desfase con `supabase_migrations.schema_migrations` (Local)

Las migraciones se aplicaron con `psql` dentro del contenedor (`docker exec -i supabase_db_WedJaiseReact psql …`), sin pasar por el CLI. Comparando archivos contra la tabla (solo lectura) están **sin registrar** 11 versiones (10 al momento de la primera comparación; la 11.ª es `20261003000003`, aplicada después), todas con su efecto ya presente en la base:

```
20261002000001 … 20261002000008   (8 correcciones QA anteriores a esta fase)
20261003000001, 20261003000002    (esta fase)
20261003000003                    (simulación)
```

Reconciliación segura (no ejecutada):

1. **No** correr `db reset` ni `migration up` a ciegas: reaplicaría SQL que ya está vigente.
2. Verificar de forma independiente que el efecto de cada versión existe (p. ej. `pg_get_functiondef` de `confirmar_venta` contiene `Solo el administrador o la cajera pueden registrar ventas`; existen las tablas `recompensas_*`).
3. Registrar sin ejecutar: `supabase migration repair --status applied <versión>` (CLI), o insertar la fila en `supabase_migrations.schema_migrations` con su `version` y `name`.
4. Repetir la comparación archivos↔tabla; debe quedar vacía.

Producción: el estado de su historial no se consultó en esta tarea.

## Decisiones de negocio incorporadas

* Servicio **sin** protección configurada: el cupón (monto, porcentaje o premio de servicio) puede descontar **hasta el 50 %** del precio efectivo, truncado a centavos. **Con** protección: descuento máximo = `max(precio efectivo − protección total, 0)`, sin límite del 50 %. «Ausente» ≠ «configurada en cero».
* Si una partida excede su límite se rechaza el cupón entero, sin consumirlo ni escrituras parciales. No se compensa con otra partida.
* El descuento manual del POS **no cambió**: respeta el piso solo si el servicio tiene protección configurada.
* Un cupón ya vencido no se reactiva al anular su venta; el vencimiento original nunca se modifica.
* Texto para la clienta (pendiente de mostrar en la UI): «En servicios sin protección configurada, los cupones pueden descontar hasta el 50 % del precio. En los servicios con protección, el descuento debe respetar el importe mínimo protegido.»

## Simulación de la transición ×5 (solo lectura)

`recompensas_simular_transicion()` (una fila por clienta) y `recompensas_simular_transicion_resumen()` (reconciliación). Solo ADMINISTRADOR.

Fórmula antigua reproducida (`mis_puntos` de `20261002000002`): `floor(visitas·ppv + gastado·pps) + puntos_bono`, con visitas = días de Lima con atenciones ACTIVO. Los productos nunca sumaron puntos y anular una venta nunca bajó los puntos.

Atribución auditable por clienta: `VISITA_DIA`, `ATENCION`, `BONO_MANUAL` y `REDONDEO` (≤ 0, global); suman exactamente los puntos antiguos.

Diseño de la apertura (aún **no** implementado como escritura):

* Apertura = puntos antiguos × 5 como saldo gastable **y** clasificación inicial; umbrales efectivos = umbrales de `config_puntos` × 5 (se conserva nivel y progreso).
* Sellos pendientes = visitas − 5 × recompensas reclamadas, **íntegros** aunque superen 20.
* Idempotencia: claves únicas `apertura:<cliente>` en ambos libros y un índice único por atención en `recompensas_apertura_aportes`.
* `confirmar_venta` ya omite el aporte de una atención presente en `recompensas_apertura_aportes` (solo ese servicio; productos y servicios nuevos de la misma venta sí acreditan, y el sello del día se evalúa aparte).

### Casos que NO se pueden atribuir y requieren decisión (no se inventaron ajustes)

1. **Clientas sin cuenta web vinculada con puntos antiguos.** La regla 1 solo permite acumular con cuenta vinculada; sus puntos antiguos no son visibles hoy para ellas. ¿Se conservan «en espera» hasta vincular, se descartan o se convierten igual?
2. **Ventas históricas con servicios anuladas después del corte.** Con la fórmula antigua anular nunca bajó los puntos (la atención sigue ACTIVO), así que no existe un «aporte de esa venta» que revertir. ¿Se mantiene así (sin reversión) o se quiere revertir el aporte de las atenciones cobradas por esa venta?
3. **Clientas con reclamadas > visitas/5** (sellos pendientes negativos): se reportan tal cual, sin truncar.
4. **Atenciones pendientes de cobro al corte**: ya cubiertas por el mapa de aportes (no se acreditan dos veces); cuántas hay se informa en el resumen.

### Resultado de la simulación en Local (incluye los fixtures «TEST F2» de las pruebas)

Reconciliación ×5, de aportes y de nivel: **correctas**. Clientas 955 (895 vinculadas); puntos antiguos vinculadas 1 678 → 8 390 monedas de apertura; niveles 871/10/14 (Básico/Premium/VIP); sellos heredados > 20 en 8 clientas; 976 atenciones pendientes de cobro en 272 clientas; 37 clientas sin cuenta web con puntos (89 puntos); 2 con reclamadas > visitas; 167 ventas históricas con servicios. **Exposición económica del saldo inicial y del catálogo: PENDIENTE** (el catálogo real no existe; no se afirma cobertura).

## Cómo ejecutar las pruebas de esta fase

Los archivos comparten la configuración global (`recompensas_config.activo`), por eso **deben ejecutarse en serie**:

```
node --test --test-concurrency=1 tests/e2e/recompensas-fase2.test.mjs tests/e2e/recompensas-fase2-qa033-qa041.test.mjs tests/e2e/recompensas-fase2-transicion.test.mjs
```

Nivel de evidencia: SQL contra el contenedor local con `request.jwt.claims` simulado; los casos de privilegios usan `set role authenticated`/`anon`. **No son E2E ni sesiones HTTP reales.** Los casos HTTP (`qa-033-ventas-roles.spec.mjs`, Playwright) requieren `QA_TEST_PASSWORD` en el proceso.
