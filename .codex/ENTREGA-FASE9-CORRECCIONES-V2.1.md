# Entrega Fase 9 V2.1 · Corrección F9-03b (cambio todavía en vuelo)

Fecha: **2026-10-12**, America/Lima. Rama `feat/cloudflare-pages`, HEAD `6929c619`, árbol local sin commit. Responde a [REVISION-FASE9-MEDIOS-V2.md](REVISION-FASE9-MEDIOS-V2.md), que pidió corregir **solo F9-03b**; F9-01, F9-02, F9-04, F9-05 y F9-06 quedaron cerrados y se conservan con sus pruebas.

Sin commit, sin push, sin cambios remotos y sin Fase 10. Sí se aplicó una **migración nueva en Supabase Local** (`supabase migration up --local`). No se aplicó en staging ni en producción: hacerlo exige tu confirmación explícita y la revisión de Codex (ver §4 y el rollback).

## 1. Defecto y por qué hacía falta el servidor

En V2, si una lectura todavía veía el valor anterior después de un fallo incierto, la operación se daba por «no aplicada» y se borraba del diario. Pero el UPDATE podía seguir **en vuelo** (en un proxy, en el pool o esperando un bloqueo) y confirmarse después. Como la reversión deja la fila justo en el valor anterior, el UPDATE condicional (`columna = valor anterior`) no lo impedía.

Desde el cliente no hay evidencia posible: ninguna lectura prueba el futuro, y las tablas no tienen una columna de versión que sirva de barrera (lo comprobé en Local). Por eso la corrección es una coordinación mínima en el servidor.

## 2. Corrección

**Migración** [`20261012000003_migracion_medios_cambio_con_plazo.sql`](../supabase/migrations/20261012000003_migracion_medios_cambio_con_plazo.sql): tres funciones de uso exclusivo de la herramienta, que la app no llama.

Las tres son `SECURITY INVOKER`, así que aplican la RLS y los GRANTs de quien llama. Las dos que escriben (`cambiar` y `barrera`) exigen además `es_admin()` y la lista cerrada de 6 tabla/columna; el helper de la lista no lo exige porque no lee ni escribe datos. *(Corregido tras la revisión V2.1, O1:)* tienen EXECUTE `authenticated`, `service_role` (heredado de los privilegios por defecto de Supabase; la migración no lo revoca) y el propietario `postgres`; `anon` y `PUBLIC` no.

- **`migracion_medios_cambiar(tabla, columna, fila, de, a, vence)`:** `UPDATE … WHERE id = fila AND col = de AND clock_timestamp() < vence`. El plazo va **dentro del WHERE**.
- **`migracion_medios_barrera(tabla, columna, fila, vence)`:**
  - Antes del plazo, por el reloj del servidor, responde `esperar` con los ms que faltan.
  - Después reescribe la columna con su **mismo valor** y devuelve el valor de la fila. Desde ese momento ningún cambio con ese plazo puede confirmarse.
  - Si un cambio ya escribió pero no ha confirmado, la barrera espera su commit y lo ve.
  - Si un cambio esperaba un bloqueo, ve una versión nueva de la fila, vuelve a evaluar el plazo y no aplica.
  - Si un cambio llega más tarde, encuentra el plazo vencido.
- **`migracion_medios_columna_permitida(tabla, columna)`:** la lista cerrada.

**CLI** ([medios-migracion.mjs](../scripts/migracion-medios/medios-migracion.mjs)):
- Cada operación guarda `vence` en el diario antes de enviarse (`--plazo-ms`, 30 s por defecto).
- Solo leer el valor **de destino** cierra una operación sin barrera. Una lectura del valor anterior **nunca** la cierra.
- Para lo demás, la reconciliación espera el plazo (hasta `--espera-max-ms`, 120 s por defecto) y pasa por la barrera.
- Sin evidencia, la operación sigue abierta con su id, no se envían cambios nuevos y el comando sale con código 3. Esto cubre tres casos: plazo todavía abierto, barrera caída y operación V2 sin plazo.
- La CLI ya no tiene `UPDATE` directo.

**Diseño** ([DISENO-MIGRACION-MEDIOS-FASE9.md](DISENO-MIGRACION-MEDIOS-FASE9.md) §5–§8): retiré el «límite que se mantiene» de V2, porque era exactamente el defecto, y lo sustituí por el protocolo real.

Añadí también dos cosas:
- la precisión de Codex sobre `refsComprobadas`: cuenta lecturas, y los conflictos no tienen valor esperado;
- la migración como requisito de la infraestructura de producción (§7.1).

## 3. Regresiones y resultados

| Prueba | Resultado |
| --- | --- |
| `probar-cli.mjs` (CLI y harness reales, backend ficticio con la semántica de las funciones) | **18/18**. Son los 14 de V2, con F9-03 adaptado al plazo, más 4 de F9-03b. |
| `probar-plazo-pg.mjs` (**Postgres 17 real de Local**, sesiones concurrentes, fixture propio que se elimina) | **7/7** |
| `probar-lib.mjs` | **17/17**, con la garantía estática V2.1: cero `UPDATE` directos en la CLI, un solo punto de cambio con plazo, el plazo dentro del WHERE, la barrera que reescribe el mismo valor, la migración sin `delete`/`truncate`/`drop`, `SECURITY INVOKER` y sin EXECUTE para `anon`/`public`. |
| `simular-fase9.mjs` (Local + Worker + app; `actualizar`/`revertir` por la función real) | **18/18** |
| `npx oxlint scripts/migracion-medios` | sin diagnósticos |

**F9-03b en `probar-cli.mjs`:**
1. **La secuencia de Codex.**
   - `actualizar` recibe un 503 con el cambio en vuelo, y la lectura ve el original: código 3 y operación `incierta`.
   - `revertir` se lanza **antes** del commit. Espera el plazo, pasa por la barrera y termina **después** de `vence`.
   - El cambio en vuelo se libera **después** de la respuesta de la reversión y ya no puede aplicar (`vencida`). La foto queda en su original y una segunda reversión sigue completa.
2. **Commit temporizado a los 1.200 ms** (como en el diagnóstico de Codex), con un plazo de 3 s. La barrera ve el valor nuevo y la reversión lo revierte. Solo hay dos cambios en total: ninguno duplicado.
3. **Sin evidencia suficiente** (plazo abierto con `--espera-max-ms=0`, barrera caída u operación V2 sin plazo): código 3, `completo:false`, el mismo id y ningún cambio nuevo. Con la barrera sana, se cierra y la reversión queda completa con la fila original.
4. **Control:** si el commit concluye antes de reconciliar, la reversión es normal, sin barrera ni cambios duplicados.

También siguen en verde: el 503 sin commit (ahora se cierra por la barrera), la edición ajena (conflicto tras la barrera), el 403, la RLS, el corte tras el commit y la interrupción tras el commit.

**En Postgres real (`probar-plazo-pg.mjs`):**
- `hecho`, `sin-cambio` y `vencida`; la barrera responde `esperar` antes del plazo y `cerrada` después.
- **Cambio ejecutado antes del plazo y confirmado después:** la barrera esperó ~1,3 s y devolvió el valor nuevo.
- **Cambio bloqueado por una transacción que reescribe la fila:** al desbloquearse responde `sin-cambio`.
- **Cambio bloqueado por un `FOR UPDATE` sin reescritura:** aplica tarde. Esto confirma que el plazo solo no basta, pero la barrera, encolada detrás, devuelve el valor real.
- **Permisos:** una clienta recibe 42501, una columna fuera de la lista da error y `anon` no tiene EXECUTE.

**Estado de Local:**
- huella de medios preexistentes `93b565019ca98416a7dca946b1ee89ad` y 441 objetos, sin cambios;
- `auditoria` +29 (25.965 → 25.994): +8 de la prueba de Postgres y +21 de la simulación, sin borrar.

Evidencia en `.codex/evidencia-fase9-v2.1/`: `pruebas-plazo-pg.json`, `pruebas-cli.json`, `pruebas-lib.json`, `simulacion-local.{json,log}`, verificaciones, manifiestos y `rollback/`.

## 4. Alcance que pide la revisión antes de cualquier ambiente remoto

- **Qué se añade al servidor:** 3 funciones. No hay tablas, columnas, triggers ni datos nuevos, y los GRANTs se limitan a ellas. La barrera reescribe una columna con su mismo valor y la auditoría no registra nada, porque solo anota campos que cambian.
- **Dónde está aplicada:** solo en Local. Antes de un ensayo en staging o en producción hacen falta tu confirmación explícita y la revisión de Codex. Se aplicaría el mismo SQL del archivo.
- **Reversión:** `rollback-migracion.sql` (`drop function`). Antes de aplicarla no debe quedar ninguna operación abierta en los manifiestos.
- **Límites:**
  - El plazo y la barrera usan el reloj del servidor de base de datos. El cliente solo decide cuánto espera.
  - Un plazo corto puede dejar `vencida` un cambio lento. Es un resultado definitivo y se reintenta en otra ejecución.
  - Las operaciones abiertas por V2, sin plazo, solo pueden resolverse a mano. Solo existieron en pruebas locales.
  - El backend ficticio de `probar-cli.mjs` reproduce la semántica, pero no la demuestra. La demostración es `probar-plazo-pg.mjs` en Postgres real; no se probó contra la PostgREST/proxy de producción.

## 5. Rollback

En `.codex/evidencia-fase9-v2.1/rollback/`:
- copias V2, que coinciden con los hashes verificados por Codex;
- `parche-v2-a-v2.1.patch`, que al aplicarse a la inversa sobre una copia reprodujo V2 byte a byte;
- `rollback-migracion.sql`;
- `rollback-fase9-v2.1.md`, con los pasos para Local, incluido el historial de migraciones.

Volver a V2 reabre F9-03b.

## 6. Archivos

- **Nuevos:**
  - `supabase/migrations/20261012000003_migracion_medios_cambio_con_plazo.sql`
  - `scripts/migracion-medios/probar-plazo-pg.mjs`
  - este documento
  - `.codex/evidencia-fase9-v2.1/`
- **Modificados:**
  - `scripts/migracion-medios/medios-migracion.mjs`, `lib.mjs`, `probar-lib.mjs` y `probar-cli.mjs`
  - `.codex/DISENO-MIGRACION-MEDIOS-FASE9.md` y `FASES-RENDIMIENTO-CLOUDFLARE.md` (fila 9)
  - `implementacionesWed.md` (§55)
  - una nota de cabecera en `ENTREGA-FASE9-CORRECCIONES-V2.md`
- **Sin cambios:** `src/`, `simular-fase9.mjs`, `trabajo-seguro.mjs`, `inventario.sql` y el plan público.

Fase 9 V2.1 lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario.
