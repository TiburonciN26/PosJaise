# Plan de validación en staging · Fase 10

Fecha: 2026-10-12; **V2 del 2026-10-13** tras la revisión V1 de Codex (§0.1 nuevo y precisiones en §2, §4, §5, §7 y §8); **V3 del mismo día** tras la revisión V2 (§0.1: contrato del importe, D11-A/B/C y regresión en staging; criterio 6). Estado: **solo plan**. En la Fase 10A no se ejecutó nada en staging ni en producción: ni migraciones, ni despliegues, ni escrituras. Cada bloque de este plan requiere **autorización explícita del usuario con su alcance** y se detiene para la revisión de Codex antes del siguiente. Producción no forma parte de este plan: es la 10B, con su propia autorización.

Recursos de staging que ya existen (Fases 2–3):
- proyecto Supabase `pos-jaise-staging` (ref `tqkdtojnhgykmcbvwdmz`, datos ficticios);
- Cloudflare Pages Preview `feat-cloudflare-pages.pos-jaise.pages.dev`;
- Worker y bucket R2 de staging, y la entrega `/medios` con revocación B;
- cuentas QA ficticias en `.env.staging.local`, fuera de git y nunca en chats.

## 0. Por qué hace falta staging antes de 10B

La 10A aprobó un árbol **local**, sin commit, que depende de piezas que staging aún no tiene:

| Pieza | Dónde está hoy | Riesgo si falta |
| --- | --- | --- |
| Migraciones `20261011000001` (RPC de vitrina), `20261011000002` (vistas de listas), `20261012000001` (RLS evaluada una vez), `20261012000002` (índices), `20261012000003` (cambio con plazo de medios) | Solo en Supabase Local | El frontend nuevo llama a las RPC y vistas de 4 y 5: **sin ellas los catálogos y las listas fallan**. |
| `20261010000001` (pagos parciales de deudas) | En el commit `e167600` de esta rama; no consta aplicada en staging | La pantalla Deudas nueva lee `deuda_pagos`. |
| Código de las Fases 4–9 | Árbol local sin commit | El Preview actual (`6929c619`) no lo tiene. |

**Compatibilidad hacia atrás, revisada en el código:** las seis migraciones son **aditivas** para el frontend de `main` (GitHub Pages).
- `main` no llama a las RPC de vitrina: `git grep` sobre `main` no encuentra referencias, y el `drop function if exists` de `20261011000001` solo afecta a una firma local anterior.
- Las vistas, los índices y las funciones de medios son nuevos.
- `20261012000001` reescribe políticas con el mismo resultado, demostrado en la Fase 7 con fotos por rol idénticas.
- `20261010000001` crea `deuda_pagos` y rellena un pago por cada deuda ya COBRADA.

Por tanto pueden aplicarse **antes** del frontend nuevo, **salvo `20261010000001`, que no debe aplicarse sola**: ver §0.1.

### 0.1 Contrato de convivencia de deudas (F10A-05, revisión V1 de Codex)

**El riesgo no es solo «cobrada sin fecha».** Tras `20261010000001`, el estado de una deuda se deriva de sus pagos (`recalcular_estado_deuda`). Pero el frontend de `main` y sus PWA instaladas siguen haciendo dos cosas:
- escribir `estado` directamente (`Deudas.jsx::alternarCobrada`);
- editar `monto` sin recalcular (`ModalDeuda.jsx`).

Mientras convivan, esto produce cuatro fallos:

1. **Cobro desde `main`:** la deuda queda COBRADA **sin pagos**.
2. **Nota en la UI nueva sobre esa deuda:** guardar **solo una nota**, sin tocar el monto, llama a `recalcular_estado_deuda`, que suma 0 y **la reabre como PENDIENTE por el importe completo**, con los botones de cobro. Puede volver a cobrarse.
3. **Reapertura desde `main` de una deuda con pagos** (los del relleno, o abonos hechos en la UI nueva): queda PENDIENTE con saldo 0, y la UI nueva muestra «Pago parcial» y botones de cobro.
4. **Monto editado en `main`** sobre una deuda con pagos: el estado deja de corresponder a los pagos.

Codex reprodujo 1 y 2 con la UI compilada y un backend simulado, y comprobó el 3 alimentando la respuesta que produciría `main`. En la V2, 1–3 se reproducen además **en SQL real de Local**, dentro de una transacción revertida (casos `antes-A1` y `antes-A2` del ensayo). **No hay deudas dañadas** en Local ni evidencia de daño remoto: es un riesgo previo a cualquier convivencia de versiones.

**Mecanismo propuesto (decisión D11 del usuario):** compatibilidad **en la base**, no en el calendario.

Es una migración nueva que se aplica **en el mismo lote** que `20261010000001`, de modo que no exista ningún instante con `deuda_pagos` y sin compatibilidad. Borrador: [`propuesta-f10a-05/compat-deudas-borrador.sql`](propuesta-f10a-05/compat-deudas-borrador.sql). **No es una migración ni se aplicó en ningún entorno.**

Mantiene el invariante «COBRADA ⇔ pagos ≥ monto» para **cualquier escritor**, incluidas las PWA antiguas:

**Contrato del importe (V3, F10A-05b de Codex).** `main` no lee `deuda_pagos`: su tarjeta, su total de pendientes y su botón «Cobrado» trabajan siempre con `monto`. Su cobro envía solo `estado` y `cobrado_en`, sin importe (comprobado en su build compilado, `probar-deuda-main-ui.cjs`). Por tanto, un cobro desde `main` solo es inequívoco cuando lo que ve la operadora **es** el saldo, es decir, cuando la deuda **no tiene pagos**. La V2 aceptaba también el cobro con abonos y registraba el saldo **inferido**. Con un abono de S/30 sobre S/100, `main` mostraba S/100 y el ledger recibía S/70 sin que nadie lo viera. La V3 lo rechaza.

| Escritura | Qué hace la base (borrador V3) |
| --- | --- |
| Cobro desde `main` de una deuda **sin pagos** | Lo acepta y registra **un pago por el monto completo**, el mismo importe que muestra `main`. Lo fecha con el `cobrado_en` de `main` en hora de Lima, con nota y autora. |
| Cobro desde `main` de una deuda **con pagos que no la cubren** (abonos de la UI nueva, o deuda pagada cuyo monto se aumentó) | **Lo rechaza** sin registrar nada: el ledger queda igual. `main` muestra «No se pudo actualizar la deuda.» y la tarjeta sigue «Pendiente». El cobro se hace en la UI nueva, que muestra el saldo. |
| Reapertura desde `main` de una deuda pagada | **La rechaza** con un error explícito y **no borra pagos**. La reapertura se hace en la UI nueva anulando el pago. |
| Edición de monto, nota o fecha (cualquier UI) | Recalcula el estado con los pagos, como la RPC. |
| RPC de la UI nueva (registrar, anular, recalcular) | Sin cambios: su recálculo es coherente con los pagos y se acepta. |

**Lo que la base no puede corregir.** Mientras `main` siga abierta, en una deuda con abonos sigue **mostrando el monto original**, y su total de pendientes no descuenta abonos. La base impide que ese importe llegue al ledger, pero no impide que alguien lo lea. Una operadora podría cobrar en efectivo S/100 antes de pulsar «Cobrado» y recibir el error. Por eso D11 ya no se plantea como «mecanismo o pausa», sino así:

- **D11-A, recomendada: mecanismo V3 más regla operativa.** El mecanismo es la red de seguridad de la base para cualquier escritor, incluidas las PWA antiguas. La regla operativa, mientras convivan, es: **«las deudas con abonos se cobran y se consultan solo en la versión nueva»**. Si `main` rechaza un cobro, la operadora pasa a la versión nueva. El riesgo residual es solo de lectura: el importe que `main` muestra en deudas con abonos.
- **D11-B: mecanismo V3 más pausa operativa de Deudas en `main`.** Elimina también ese riesgo de lectura, a cambio de depender de que nadie abra Deudas en `main` ni en una PWA antigua. Conviene si la convivencia será larga o si no se puede instruir a todo el personal.
- **D11-C: solo pausa, sin mecanismo.** No se recomienda: si alguien usa `main`, vuelven los fallos 1–4.

La UI nueva nunca escribe `estado` directamente: solo las RPC. Por eso un cambio de `estado` incoherente con los pagos identifica al frontend anterior sin depender de versiones ni de cabeceras.

**Cierre verificable:** el lote termina con un **relleno dirigido** y una **comprobación del invariante** que lo aborta si queda alguna deuda incoherente.
- El relleno solo afecta a las COBRADAS cuyos pagos no cubren el monto, y por el saldo exacto. Es **idempotente**: repetido inserta 0.
- Mientras convivan, la conciliación es la misma consulta de incoherentes. Debe dar 0 antes y después de cada ensayo, y al retirar `main`.

**Ensayo en Local** (`scripts/fase10a/ensayar-compat-deudas.mjs`): una transacción revertida, como la administradora QA con RLS real. Cubre:
- los dos sentidos;
- abonos parciales;
- edición de monto en ambos sentidos;
- el flujo normal de la UI nueva;
- el relleno.

Comprueba también que Local queda idéntico: conteos, firma de deudas, triggers y funciones. Resultado V2: 22/22. **V3: 26/26**, con los casos nuevos S1d (sin abonos, importe visible = pago registrado), S2a–S2c (abono, rechazo sin tocar el ledger y cobro del saldo en la UI nueva) y S5b–S5c (monto aumentado sobre una deuda pagada). La reacción de `main` a ese rechazo se comprueba en su build compilado: muestra S/100 y no el saldo, envía solo `estado`, avisa del error y deja la deuda «Pendiente». Ver la entrega V3.

**Pausa operativa (D11-B o D11-C):** pausa de Deudas en `main` durante toda la convivencia.
- Debe abarcar **cobrar, reabrir, editar y borrar**, no solo cobrar.
- Debe alcanzar también a las PWA ya instaladas, que no se actualizan solas.
- Exige una **condición de cierre verificable**: la consulta de incoherentes en 0 tras retirar `main` y las PWA antiguas, y la conciliación dirigida antes de reabrir la operación.

Depende de la disciplina del personal y de que ninguna PWA antigua quede abierta; por eso no se recomienda como única barrera (D11-C).

**Regresión en staging, si se autoriza el lote:**
1. Hacer un abono en la UI nueva.
2. Leer esa deuda en `main`.
3. Intentar cobrarla desde `main`, verificando el importe visible, lo que llega al ledger y el aviso.

Repetir con una deuda pagada cuyo monto se aumenta. La consulta de incoherentes debe dar 0.

**Precisión sobre volver a ejecutar SQL de `20261010000001`:**
- **El archivo completo** no duplica pagos: `create table public.deuda_pagos` (sin `if not exists`) falla antes del `insert`, y la transacción se revierte.
- **El bloque de relleno aislado** (`insert … select … where estado = 'COBRADA'`) sí los **duplica**: un pago más por cada COBRADA, aunque ya lo tenga. El ensayo lo muestra en el caso R2.

Nunca debe re-ejecutarse aislado. La conciliación se hace solo con el relleno dirigido.

## 1. Inventario de staging (solo lectura)

1. `supabase migration list` contra staging (la URL de base de datos vive en `.env.staging.local`), con `scripts/aplicar-migraciones-staging.mjs --dry-run`. Registrar qué migraciones faltan.
2. Esquema efectivo de las funciones y vistas que usa el frontend nuevo, y ACL de las funciones de medios.
3. Build desplegado en el Preview (marca del bundle), variables `VITE_MEDIOS_*` y configuración del Worker.
4. Deudas: consulta de incoherentes (§0.1) y triggers presentes en `deudas`. Galería: filas QA restantes, para afirmar el estado actual (§8).

## 2. Migraciones en staging (escritura; autorización 1)

En orden, una por una, con `scripts/aplicar-migraciones-staging.mjs` (rechaza producción y Local). Tras cada una:
- **`20261010000001` + compatibilidad de deudas, en el mismo lote** (§0.1; solo si D11 elige el mecanismo):
  - Deudas con abonos (crear, pagar parcial, anular) con la cuenta QA administradora.
  - Los casos del ensayo en ambos sentidos, con deudas `TEST QA` propias, simulando las escrituras de `main` con sus mismas sentencias.
  - Consulta de incoherentes en 0 antes y después. Con la pausa operativa en lugar del mecanismo: su condición de cierre.
- **`20261011000001`**: `verificar-catalogo-publico.mjs` adaptado a staging (hoy se niega a cualquier origen distinto de Local: hay que darle un modo staging explícito con su host aprobado, igual que las guardas por función de la Fase 9).
- **`20261011000002`**: listas de Reseñas y Cupones con la cuenta administradora; una clienta no las lee.
- **`20261012000001`**: matriz de lectura por rol de la Fase 7 en modo solo lectura. `verificar-fase7.cjs` aplica migraciones dentro de un ROLLBACK y no sirve tal cual para una base ya migrada. Se adapta para comparar una **fotografía del propio staging antes y después** de la migración, con sus cuentas QA y sus datos aprobados. La réplica Local sirve como referencia de la lógica y de los metadatos (políticas, funciones), **no** como referencia de igualdad de ids o filas de una base distinta.
- **`20261012000002`**: planes con EXPLAIN para las tres consultas medidas.
- **`20261012000003`**:
  - ACL (O1 de la Fase 9): **decidir antes** si se revoca EXECUTE a `service_role`.
  - Protocolo de la barrera con fixtures propios: `probar-plazo-pg.mjs` exige Local; se adapta a staging por la API autenticada en vez de `psql`.

**Reversión:**
- `evidencia-fase7/rollback-fase7.sql`;
- `drop view`/`drop function` documentados en la cabecera de cada migración;
- `evidencia-fase9-v2.1/rollback/rollback-migracion.sql`.

Ninguna borra datos de negocio, salvo revertir `20261010000001`, que eliminaría `deuda_pagos`: no revertir con abonos reales.

## 3. Frontend nuevo en el Preview (despliegue; autorización 2)

El Preview se compila desde la rama de Git, que hoy está en `6929c619`, sin las Fases 4–9. Hay dos caminos, y los dos los decide el usuario:
- **(a)** Commit y push de la rama: autorización de commit/push. El Preview se recompila solo.
- **(b)** Direct Upload con `scripts/build-preview-staging.mjs --deploy` desde el árbol local, sin push. Es un despliegue remoto: requiere autorización.

En ambos casos el build valida backend y clave de staging antes de compilar (`entornos-supabase.mjs`).

## 4. Validación funcional en el Preview (lecturas y escrituras QA en staging; autorización 3)

| Área | Herramienta | Adaptación necesaria |
| --- | --- | --- |
| Login, rutas directas, recarga y cierre de sesión | `verificar-preview-staging.cjs` (ya existe para staging) | ninguna |
| Matriz de roles × 46 rutas + menú + salida | `fase10a/verificar-roles-rutas.cjs` | Sus guardas (V2, `lib/guardas-local-10a.cjs`) admiten **solo** Local: app loopback, backend efectivo del bundle exactamente `127.0.0.1:54321` y cuentas `qa-…@test.local` existentes en Local. Para staging hace falta un **modo staging propio**, con su alias y su Supabase aprobados exactos y su autorización, **sin relajar** la guarda de Local; además, una **cuenta ASISTENTE QA** preexistente (no hay asistente en `.env.staging.local`; crearla es una escritura en Auth de staging). |
| POS (venta con producto QA, anulación), portal (carrito, cita, recompensas) | Suite Playwright de 214 casos (`tests/e2e`) | Está atada a la rama `testing` y a Local por diseño: no se apunta a staging. En staging se usan los verificadores de arriba y los flujos manuales guiados de §6. Si se ejecuta en Local (D10), debe validar el **candidato nuevo exacto**: un worktree autorizado con este árbol y las guardas intactas. Cambiar a una rama antigua no valida el candidato, y no se debilita la protección para obtener un verde. |
| Fotos nuevas por R2 (modales reales) y lectura mixta | `verificar-interfaz-r2-preview.cjs`, `verificar-ml03-bundle.cjs` | ninguna (ya son de staging) |
| Actualización PWA A→B con trabajo pendiente | `verificar-actualizacion-pwa-online.cjs` con dos despliegues del Preview | Los dos despliegues entran en la autorización 2. |
| Protocolo de migración de medios con fixtures | `scripts/migracion-medios/` con `--permitir-supabase/-worker/-lectura` de staging | Además: **O2**, desfase de reloj (el reloj del equipo adelantado y atrasado ±20 s frente al servidor); **O3**, timeouts de la barrera con red colgada simulada. |
| Retirada B de medios en el Preview | `verificar-retirada-b.cjs` (sin red) + `verificar-medios-pages-cache.cjs --contrato=b` | ninguna |

## 5. Rendimiento en el Preview (solo lectura)

`fase10a/medir-vitales-10a.cjs` con `--app=<alias>`. Hoy sus guardas solo admiten Local; para el Preview hace falta un modo staging propio con el alias y la API aprobados exactos, sin relajar la guarda de Local. Se toman tres muestras frías y tres calientes desde la red real y el CDN, para compararlas con las de laboratorio de la 10A. Lighthouse, si el usuario autoriza instalarlo como dependencia de desarrollo o lo corre Codex con sus herramientas, frío y caliente sobre los mismos escenarios.

## 6. Comprobaciones manuales guiadas (con el usuario)

- **Móvil físico** (Android/iOS): instalar la PWA, sesión de caja, escáner (Node de Pages y `@zxing`, observación viva de la Fase 2), aviso de actualización.
- **Firefox y Safari:** portal, carrito y POS (pendiente desde la Fase 3).
- **Pagos:** Culqi sigue bloqueado por las llaves con error 401 (cuenta sin validar). Sin cobros reales. Cuando se active, sandbox y conciliación, sin reintentos de cargo a ciegas.
- **Correos de Auth:** confirmación de registro contra la Site URL y las Redirect URLs del origen elegido (O3 de la Fase 9).

## 7. Criterios para pasar a 10B

1. Migraciones aplicadas en staging, cada una con su verificación verde y su reversión ensayada en al menos una (la de índices o la de vistas).
2. Frontend nuevo en el Preview con verificadores funcionales verdes, matriz de roles 100 %, PWA A→B sin pérdida de venta y medios con R2 y lectura mixta.
3. Protocolo de medios ensayado en staging (incluidos O2 y O3) y decisión sobre la ACL de `service_role`.
4. Vitales del Preview sin regresiones frente a la 10A; Lighthouse si se decide.
5. Decisiones del usuario cerradas: origen (dominio propio o pages.dev), periodo de reversión, perfiles y QR, comunicación, ventana de cambio y tratamiento de PWA antiguas (O1 y O2 del plan público).
6. Convivencia de deudas resuelta (D11): mecanismo V3 aplicado y ensayado en staging en ambos sentidos con abonos parciales, incluida la regresión del importe de §0.1 (lo visible en `main`, lo que llega al ledger y el rechazo con abonos), más la regla operativa (D11-A) o la pausa (D11-B) con su condición de cierre cumplida. Consulta de incoherentes en 0.

## 8. Limpieza y datos

Cada verificador limpia sus fixtures (prefijos `QA`/`TEST`). Las cuentas QA de staging no se borran sin decisión del usuario (pendiente de la Fase 2).

La fila residual de galería de staging (`5bb670df…`) **ya se retiró** en la Fase 3, con autorización del usuario. Su borrado y la relectura están documentados en `implementacionesWed.md` («Cierre local de las guardas y recorrido real completo», 2026-10-10) y en `REVISION-INTERFAZ-PREVIEW-R2-V4.md`. Para afirmar el estado remoto **actual** hace falta un inventario de solo lectura en §1.
