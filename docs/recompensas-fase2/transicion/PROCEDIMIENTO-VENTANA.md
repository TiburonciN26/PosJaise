# Cómo evitar actividad entre el corte, la apertura y la activación

Estado: **procedimiento propuesto y ensayado solo en la instancia desechable** (resultados en `../RESULTADOS-ENSAYO.md`). No se ha ejecutado en QA ni en producción.

## El problema

La apertura convierte los puntos antiguos con una foto del negocio (el *corte*). Si entre el corte y la activación de Recompensas entra una atención, una venta, un ajuste de bono o una activación, la foto queda desfasada: puntos que se pierden, se cuentan dos veces o se acreditan con reglas que no corresponden.

## Regla: el corte del ensayo NO se reutiliza

El corte `2026-10-05T04:32:53Z` es solo el de la copia del ensayo. El modo definitivo de `recompensas_ejecutar_apertura` ni siquiera acepta un corte de fuera: se lo da el propio reloj de la base de datos, **dentro del bloqueo**. Un corte explícito solo sirve para dry-run y ensayos.

## Qué lo garantiza (borrador v2)

`select recompensas_ejecutar_apertura(null, true, true)` (corte nulo, ejecutar, activar), en **una sola transacción**:

1. Toma un bloqueo consultivo (una apertura a la vez).
2. Bloquea `ventas`, `registro_servicios` y `clientes` en modo *SHARE ROW EXCLUSIVE* (con `lock_timeout` de 15 s): otras sesiones **esperan** para escribir, no fallan. El orden es el mismo que usa una venta (primero `ventas`, luego `registro_servicios`); con el orden inverso el ensayo provocó un *deadlock* que Postgres resolvió cancelando una **venta**.
3. Con el bloqueo ya tomado, fija el corte con `clock_timestamp()`.
4. Bloquea la configuración (`FOR UPDATE`): nadie activa ni cambia el corte en paralelo.
5. Escribe la apertura, el mapa de aportes y las clientas en espera.
6. **Activa Recompensas en la misma transacción.** Al hacer `COMMIT` el programa ya está activo con ese corte: no existe un momento «apertura hecha, programa apagado» observable.

Qué se comprobó con sesiones simultáneas reales (ver S1–S4 en RESULTADOS-ENSAYO.md): una venta en vuelo antes del bloqueo se confirma y la apertura espera a que termine (su atención queda dentro de la apertura, sin doble cómputo); una atención que llega con el bloqueo tomado espera al COMMIT y queda posterior al corte; una segunda ejecución simultánea se rechaza y no duplica.

## Lo que el bloqueo NO cubre (y qué hacer)

| Riesgo | Mitigación |
|---|---|
| Una transacción que empezó antes del corte y confirma después (su `now()` es anterior al corte) | La apertura espera a toda escritura en vuelo en esas tablas antes de fijar el corte, así que ninguna puede quedar «a medio camino». |
| Un atraso de la atención: se registra después con fecha anterior al corte | No entra en la apertura; se acredita con las reglas nuevas al cobrarla (la regla es «acredita salvo que esté en el mapa»): no hay doble cómputo ni pérdida. Se informa como caso. |
| Cerrar el negocio (`estado_negocio`) para frenar ventas | **No sirve:** `confirmar_venta` y `guardar_cita_pos` no consultan el estado del negocio. No se debe confiar en ello. |
| Escrituras a otras tablas (citas, pedidos web) que luego crean atenciones | Crear la atención es una escritura en `registro_servicios` y queda bloqueada; el resto no afecta a la conversión. |
| Esperas largas si hay mucha actividad | El `lock_timeout` de 15 s hace fallar limpiamente la apertura (sin escribir nada); se reintenta. Conviene ejecutarla en un momento de poca actividad, no «cerrando» el negocio. |

## Pasos propuestos (cuando se autorice actuar en QA o producción)

1. Respaldo completo **nuevo** (base y archivos de Storage), restaurado con éxito en una instancia desechable.
2. Dry-run con un corte explícito de ensayo sobre la copia: totales, bloqueos, anomalías. Cifras de la copia que se vaya a usar, no las históricas.
3. Resolver los bloqueos (p. ej. los 17 aportes de QA, ver `../APORTES-PREEXISTENTES-QA.md`) con autorización aparte.
4. Verificar los umbrales de `recompensas_config` (= antiguos ×5) y `sellos_por_premio = 5`, y que Recompensas esté apagado.
5. Ejecutar `recompensas_ejecutar_apertura(null, true, true)` y guardar su informe (corte usado, totales, conciliación).
6. Verificación posterior: conciliación por clienta, segunda ejecución sin cambios, pruebas HTTP con sesiones reales.

## Recuperación

- Antes de activar (con el programa apagado): `recompensas_revertir_apertura(cliente)` por clienta, **solo** si no hay actividad posterior; si la hay, o si el programa ya está activo, se rechaza.
- Programa activo o con ventas/canjes posteriores: **restaurar el respaldo del paso 1**. No se borran aperturas a mano.
