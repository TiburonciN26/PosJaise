# Fase 2 — plan del siguiente lote

> **Actualización 2026-10-05 (segundo lote):** autorizado y hecho en QA únicamente el registro de las 13 versiones en `schema_migrations`. En la instancia desechable se añadieron HTTP, interfaz y Storage con sesiones reales, concurrencia (la v1 del borrador falló y la v2 corrige), los 17 aportes de QA documentados (`APORTES-PREEXISTENTES-QA.md`) y el procedimiento de la ventana (`transicion/PROCEDIMIENTO-VENTANA.md`). Siguen sin autorizar: ejecutar la apertura en QA, activar Recompensas, borrar los 17 aportes y producción.
>
> **Actualización 2026-10-05:** el ensayo en instancia desechable ya se hizo; resultados separados (instalación, restauración, reconciliación, transición) en [`RESULTADOS-ENSAYO.md`](RESULTADOS-ENSAYO.md). Siguen **sin ejecutarse en QA** el registro de las 13 versiones y la apertura, y producción sigue fuera. Cambios respecto del plan original: las cifras de 955 clientas y 8 390 monedas son **referencia histórica** (los totales y las versiones pendientes se recalculan sobre el estado capturado); el corte es la hora exacta de la copia (`2026-10-05T04:32:53Z`, `2026-10-04 23:32:53` en Perú) y las ventas de QA **no** se congelan.

Estado: **ensayado solo en la instancia desechable**; sin ejecución en QA ni producción.
La suite verde (213/214 en `testing` 02a9f17) **no declara terminada la Fase 2**: cubre la interfaz y las reglas ya
implementadas, no las brechas de abajo (ver `tests/e2e/COBERTURA.md`, «Brechas de Fase 2»).

Alcance del lote: tres frentes que dependen unos de otros.

1. Ensayo de **instalación limpia** en una instancia desechable.
2. **Reconciliación segura de `schema_migrations`** (13 versiones aplicadas sin registrar).
3. **Transición histórica ×5** con las decisiones A y B aprobadas.

Orden: 1 → 2 → 3. El frente 3 solo se ensaya sobre una copia, nunca sobre la base QA viva.

## Vocabulario: simulación frente a ejecución

| Nivel | Qué hace | Escribe | Dónde |
|---|---|---|---|
| **Simulación** | Funciones de solo lectura (`recompensas_simular_transicion*`) y comparaciones archivos↔tabla | Nada | Base QA Local |
| **Ensayo** | Ejecución real de la conversión o del `db reset` | Sí | **Solo** instancia desechable restaurada de una copia |
| **Ejecución** | La conversión sobre la base que importa | Sí | No pertenece a este lote; requiere autorización separada |

Un resultado de simulación nunca se informa como «ejecutado». Un ensayo aprobado no autoriza producción.

## Precondiciones comunes

- Rama `testing` limpia o con el trabajo ajeno identificado y preservado (hoy hay cambios sin confirmar de otro frente: `AGENTS.md`, `implementacionesWed.md`, Nosotros).
- Supabase CLI y Docker disponibles en la máquina (el CLI **no** estaba instalado cuando se escribió `MIGRACIONES-Y-TRANSICION.md`; verificarlo primero, sin instalar dependencias del proyecto).
- Instancia desechable con **puertos y nombre de proyecto distintos** de la QA (otro `project_id`/`--workdir`), de modo que `db reset` no pueda alcanzar la base QA. Comprobación previa obligatoria: la URL y el puerto efectivos de cada comando.
- Autorización explícita del propietario para cada paso de ensayo; las decisiones A/B ya están aprobadas pero **no implementadas**.
- `QA_TEST_PASSWORD` solo en el entorno del proceso; ninguna contraseña ni salida cruda en commits.

## Frente 1 — Ensayo de instalación limpia (instancia desechable)

**Objetivo:** demostrar que migraciones + `seed.sql` reconstruyen el esquema equivalente al de la base QA.

Pasos propuestos:

1. Crear la instancia desechable separada (puertos propios). Confirmar que no comparte volumen ni contenedor con QA.
2. Aplicar en orden de nombre todas las migraciones de `supabase/migrations/` (`supabase db reset` **solo dentro de esa instancia**).
3. Comparar contra la base QA, solo lectura en ambas: lista de tablas, columnas, funciones (`pg_get_functiondef` hasheado), políticas (`pg_policies`), privilegios por columna (`information_schema.column_privileges`) y GRANT de tablas. Las diferencias se clasifican: esperadas (datos), de esquema (defecto).
4. Ejecutar la capa `node --test` y una selección de Playwright contra la instancia desechable (pasar la URL por configuración, no editar `.env`).
5. Registrar el resultado y destruir la instancia.

**Verificación de totales:** número de migraciones aplicadas = número de archivos; conteo de objetos por tipo igual en ambas bases; hashes de funciones críticas (`confirmar_venta`, `anular_venta`, canje, `mis_puntos`) iguales.

**Reversibilidad:** total. La instancia se elimina; la base QA no se toca. Riesgo a vigilar: que un comando apunte a QA por error (mitigación: puerto y `project_id` distintos y verificación previa de la URL).

**Criterio de salida:** esquema equivalente, o lista cerrada de diferencias con su causa. Si falla, se corrige la migración en una nueva versión, no reescribiendo las ya aplicadas.

## Frente 2 — Reconciliación segura de `schema_migrations`

**Estado:** 13 versiones sin registrar en Local (`20261002000001…08`, `20261003000001…04`, `20261004000001`), con su efecto ya presente.

**Precondiciones:** frente 1 aprobado (así se sabe que los archivos reproducen el efecto) y copia de la base QA hecha antes de tocar la tabla.

**Copia y recuperación:**

1. Volcado completo de la base QA (`pg_dump` desde el contenedor, a una ruta fuera del repositorio) y volcado aparte de `supabase_migrations.schema_migrations`.
2. Comprobar que la copia se restaura en la instancia desechable (ensayo de recuperación, antes de necesitarla).

**Pasos:**

1. Para cada versión, verificar de forma independiente que su efecto existe (por ejemplo el texto «Solo el administrador o la cajera pueden registrar ventas» en `confirmar_venta`; tablas `recompensas_*`; índice de QA-045). Una versión sin efecto verificable **no se registra**.
2. Primero **ensayar** el registro en la instancia desechable restaurada de la copia.
3. Registrar en QA solo con la autorización del propietario: `supabase migration repair --status applied <versión>` o inserción de `version` y `name`. Una versión por vez, con lectura posterior.
4. Repetir la comparación archivos↔tabla: debe quedar vacía.

**Verificación de totales:** antes 13 sin registrar; después 0; el número de filas de `schema_migrations` aumenta exactamente en 13; ninguna otra tabla cambia (comparar conteos).

**Reversibilidad:** las filas insertadas se borran por `version`; la copia permite restaurar la tabla completa. Lo que **no** se debe hacer: `db reset` ni `migration up` a ciegas sobre QA (reaplicaría SQL vigente). Producción: su historial no se consultó; queda fuera de este lote.

## Frente 3 — Transición histórica ×5 (decisiones A y B)

**Estado:** decisiones A y B aprobadas; la apertura **no está implementada como escritura**. Solo existe la simulación de solo lectura.

Requisitos de diseño derivados de `MIGRACIONES-Y-TRANSICION.md` (a revisar antes de escribir código):

- Apertura = puntos antiguos × 5 como saldo gastable **y** clasificación inicial; umbrales × 5; sellos pendientes íntegros aunque superen 20.
- Idempotencia con claves únicas `apertura:<cliente>` en ambos libros e índice único por atención en `recompensas_apertura_aportes`; un reintento no duplica.
- (Cifras de referencia **histórica**, no vigentes; recalcular siempre sobre la copia que se vaya a usar.)
- **A:** clientas sin cuenta web: saldo congelado al corte, en espera; al vincular la cuenta a la misma ficha se habilita una sola vez. Sin doble apertura por reintento, desvinculación/revinculación u otra cuenta; no se acreditan compras hechas sin cuenta.
- **B:** anular una venta anterior al corte sin aporte atribuible no descuenta apertura; solo se revierten aportes nuevos realmente acreditados.

Etapas:

| Etapa | Nivel | Qué se entrega |
|---|---|---|
| 3.1 | Diseño | Migración de la escritura de apertura redactada y revisada (sin aplicar), con el texto de decisiones A/B |
| 3.2 | Simulación | Repetir `recompensas_simular_transicion_resumen()` sobre la copia y fijar las **cifras de referencia** (hoy: 955 clientas, 895 vinculadas, 1 678 → 8 390 monedas, 976 atenciones pendientes, 37 sin cuenta con 89 puntos) |
| 3.3 | Ensayo | Aplicar la apertura en la instancia desechable restaurada de la copia; verificar totales; ensayar la segunda ejecución (debe ser un no-op) |
| 3.4 | Ejecución | **Fuera de este lote.** Requiere autorización propia y ventana acordada |

**Verificación de totales (etapa 3.3):**

- Σ saldos de apertura = 5 × Σ puntos antiguos de las vinculadas (reconciliación exacta, sin tolerancia).
- Cada clienta: atribución `VISITA_DIA + ATENCION + BONO_MANUAL + REDONDEO` = puntos antiguos.
- Nivel inicial por clienta igual al de la simulación; distribución 871/10/14 como referencia.
- Sellos heredados > 20 en 8 clientas conservados íntegros; 2 clientas con reclamadas > visitas reportadas sin truncar.
- Clientas en espera: saldo congelado, sin movimiento en el libro gastable hasta vincularse.
- Segunda ejecución: 0 filas nuevas en ambos libros.

**Copia y recuperación:** volcado previo de las tablas que la apertura toca (libros de monedas y sellos, `recompensas_apertura_aportes`, configuración) y prueba de restauración en la desechable. En la ejecución real (etapa 3.4) la copia debe existir y haberse restaurado con éxito antes.

**Reversibilidad:** el ensayo es descartable (se destruye la instancia). Para la ejecución real, la reversión debe diseñarse **antes**: movimientos de apertura identificables por la clave `apertura:<cliente>`, de modo que un borrado dirigido más la restauración del volcado dejen el estado previo. Esa reversión se ensaya en la desechable en la etapa 3.3.

## Lo que este lote no incluye (brechas que siguen abiertas)

Elegibilidad específica de premios, auditoría del catálogo, textos antiguos de «puntos», revisión económica del catálogo (exposición del saldo inicial y del catálogo), y la aplicación a producción de QA-045 y de cualquier migración. Se tratan como lotes separados.

## Decisiones que necesito del propietario antes de empezar

1. ¿Se instala el Supabase CLI en esta máquina para el ensayo (sin tocar dependencias del proyecto)? Sin el CLI el frente 1 se haría con `psql` en contenedores, con menos fidelidad al flujo real.
2. ¿Dónde se guardan los volcados (ruta fuera del repositorio) y quién los custodia?
3. Autorización para crear y destruir la instancia desechable, y para el registro en `schema_migrations` de la QA (frente 2, paso 3) una vez ensayado.
4. Fecha de corte de la transición y si las ventas posteriores al corte durante el ensayo deben congelarse.

## Qué cuenta como «lote terminado»

Frente 1 con esquema equivalente o diferencias cerradas; frente 2 con la comparación vacía y la copia restaurable; frente 3 con la apertura ensayada, totales conciliados y la segunda ejecución sin cambios. Solo entonces se puede hablar de pasar a ejecución, y Fase 2 sigue abierta mientras haya brechas del listado anterior.
