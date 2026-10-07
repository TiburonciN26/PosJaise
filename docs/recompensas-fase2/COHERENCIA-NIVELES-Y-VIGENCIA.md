# Niveles canónicos de premios y cupones, y vigencia de uso de los cupones especiales (QA-064, QA-075, QA-062, QA-063, QA-076)

Estado: implementado y probado **solo en Supabase Local TEST** (QA local, migraciones `20261007000001` y `20261007000002`). Recompensas sigue **apagado** (`activo = false`, restaurado y comprobado), la apertura **no** se ejecutó y producción **no** se tocó. Los tickets pasan a **Re-test** para la verificación independiente de Codex; nada se marca «Verificado» ni se declara terminada la Fase 2.

Se probó el estado actual: HEAD `d99df1e` **más** los cambios de diseño aprobados que siguen sin confirmar (no se revirtieron ni se incluyeron en los commits de este lote; ver «Archivos» al final).

## QA-064 — un solo nivel de negocio para catálogo, permiso y cupón

### Causa

Había tres criterios independientes: el **color del premio** salía de su costo en monedas (`nivelColorRecompensa(precio)`: ≥ 200 Diamante, ≥ 100 Oro), el **color del cupón** del valor del descuento (`nivelCupon(valor)`: ≥ 20 Diamante, ≥ 10 Oro) y el **permiso de canje** de `recompensas_catalogo.nivel_minimo`. Por eso una clienta Plata podía canjear un premio «mostrado como Diamante» (costo alto, mínimo BASICO) y un premio «mostrado como Plata» (costo bajo, mínimo VIP… o descuento chico) emitía un cupón Diamante.

El **backend ya autorizaba bien**: `_recompensas_emitir_canje` compara `nivel_minimo` con el nivel de la clienta y `recompensas_evaluar_cupon` vuelve a hacerlo al usar el cupón. El defecto era solo de **presentación**: lo que se mostraba no coincidía con lo que se permitía. No se cambió el backend de canje, ni costos, beneficios, fórmulas ni umbrales, y no se inventó ningún umbral nuevo.

### Regla (la aprobada)

| Nivel de negocio (`nivel_minimo`) | Se muestra | Quién lo canjea |
|---|---|---|
| BASICO | Plata | todas |
| PREMIUM | Oro | Premium y VIP |
| VIP | Diamante | solo VIP |
| promociones por fechas (`origen = PROMOCION`) | Especial (rojo) | todas, durante la campaña; fuera de la escala |

El **mismo `nivel_minimo`** viaja del catálogo (`mi_catalogo_recompensas`, `catalogo_recompensas_publico`) al cupón emitido (se congela en `cupones.nivel_minimo` al canjear) y a su lectura (`mis_cupones`). Un descuento de precio por nivel (`costo_premium` / `costo_vip`) cambia lo que **cuesta**, nunca el nivel del premio ni del cupón.

### Cambio (solo interfaz)

- `src/lib/cupones.js`: se eliminó la escala por valor (`nivelCupon`, `UMBRALES_*`) y `estiloNivelCupon`; ahora `estiloNivelDeNegocio(nivel_minimo)` (BASICO→Plata, PREMIUM→Oro, VIP→Diamante; desconocido→Plata, igual que el permiso) y `nivelDeCupon(cupon)` (PROMOCION→Especial; el resto, por `nivel_minimo`).
- `src/pages/cliente/recompensas/SeccionCanje.jsx`: la fila usa el nivel del premio (`ORDEN_NIVEL[r.nivelMin]`).
- `src/pages/cliente/recompensas/datos.js`: se eliminó `nivelColorRecompensa` (por costo).
- Paletas, layouts, animaciones y efectos de tarjetas y cupones **no se tocaron** (el diseño aprobado sigue intacto).

**Decisión que conviene confirmar:** los cupones de bienvenida, referido y fidelización no tienen nivel propio (`nivel_minimo` = BASICO por defecto), así que ahora se ven **Plata** aunque su valor sea alto (antes se coloreaban por valor). No se añadió ninguna restricción de uso a esos cupones ni a los ya emitidos: solo cambia el color.

## QA-075 — las fechas de campaña limitan también el USO

El propietario confirmó que las fechas de una campaña limitan el reclamo **y** el uso.

### Qué pasaba (comprobado)

`reclamar_cupon_promocion()` rechazaba reclamar fuera de fechas, pero el cupón emitido nacía con `vigente_hasta = null` y nunca vencía. Todas las rutas de uso ya exigen `vigente_hasta is null or vigente_hasta > now()` y responden «Este cupón ya venció» (`recompensas_validar_cupon_pedido` → vista previa y pedido; `confirmar_venta`/Caja; `verificar_pago_pedido_web`), pero con `null` no había nada que vencer.

### Cambio (migraciones `20261007000001` y `20261007000002`)

- La **emisión** congela el vencimiento de la campaña: `vigente_hasta` = **inicio del día siguiente** a `promociones.vigente_hasta`, hora de **America/Lima** (`(fecha + 1)::timestamp at time zone 'America/Lima'`). Como la comparación es estricta (`> now()`), el cupón sirve **todo el último día** (hasta las 23:59:59.999999) y deja de servir a las 00:00 del día siguiente; no vence al empezar el último día. Campaña sin fecha final → el cupón no vence, como antes.
- La **validación no se tocó**: sigue siendo una sola, compartida por Caja, vista previa, pedido y verificación de pago, y bloquea el cupón vencido **antes** de anunciar un importe pagable.
- **Hallazgo adicional (QA-075, doble clic):** con 6 reclamos simultáneos de la misma clienta, los perdedores recibían `duplicate key value violates unique constraint "cupones_cliente_promocion_unq"` en vez de su cupón (no se duplicaba nada, pero la respuesta no era idempotente). La segunda migración usa `ON CONFLICT … DO NOTHING` sobre ese índice: quien pierde la carrera devuelve el cupón ya emitido, con su vencimiento original, y la notificación se crea una sola vez.
- Se conservan: idempotencia por clienta y promoción, cupón único, protección económica, stock y anulaciones. **Anular una venta no reactiva un cupón vencido** (`anular_venta` ya exigía `vigente_hasta is null or vigente_hasta > now()`; ahora hay una prueba que lo demuestra).

### Cupones PROMOCION ya emitidos sin vencimiento — tratamiento propuesto (NO ejecutado)

No se actualizó ningún cupón antiguo ni producción. Cifras de **Local TEST** (solo para dimensionar; no son de producción):

| Cupones PROMOCION ligados a una promoción, sin vencimiento | Cantidad |
|---|---|
| Total / disponibles | 66 / 66 |
| …de promociones **con** fecha final | 63 |
| …de campañas **ya terminadas** (siguen DISPONIBLES y utilizables) | 60 |
| …de promociones sin fecha final (no se tocarían) | 3 |

Además hay cupones PROMOCION sin promoción asociada (fixtures de QA insertados directamente); no entran en este tratamiento.

Propuesta, para decidir y autorizar aparte:

1. **Primero solo lectura en producción** (con autorización): contar cupones `origen = 'PROMOCION'`, `estado = 'DISPONIBLE'`, `vigente_hasta is null`, con `promocion_id` de una promoción con `vigente_hasta` no nulo; separar los de campañas ya terminadas y los de campañas vigentes. Revisar si alguno está ligado a un pedido web pendiente de verificar (venció la campaña entre el pedido y el pago).
2. **Backfill acotado**, una sola sentencia, solo `DISPONIBLE` y con `promocion_id`: `vigente_hasta := ((p.vigente_hasta + 1)::timestamp at time zone 'America/Lima')`, el mismo valor que daría la emisión nueva. Los `CANJEADO`/`ANULADO` no se tocan.
3. **Decisión de negocio previa:** ¿los cupones de campañas ya terminadas pasan a vencidos de inmediato (coherente con la regla confirmada, pero la clienta que reclamó a tiempo y no lo usó lo pierde)? Alternativa: respetar a quienes reclamaron y darles un plazo de gracia explícito. Hay que comunicarlo, porque «Mis cupones» los mostrará como vencidos.
4. Ensayar antes en la instancia desechable restaurada de una copia; respaldo verificado antes (ver QA-076); verificación posterior de conteos; sin tocar las promociones.

Reversión del backfill: el valor anterior era `null`; basta guardar la lista de `id` afectados antes de ejecutar.

## QA-062 y QA-063 — arnés

**QA-062** (`qa-recompensas-037-040.spec.mjs`, «Efectos y animaciones de Recompensas intactos»): buscaba `.cupon-oro`, `.cupon-plata`, `.cupon-texto-oro` y la animación `cupon-glow`, que el diseño aprobado reemplazó por el acabado metálico. Se adaptaron las anclas **sin cambiar el diseño** (`tests/e2e/niveles-visuales-helpers.mjs`):

| Antes | Ahora |
|---|---|
| `.cupon-oro` con `cupon-glow` | tarjeta Oro `.cupon-n-oro` con resplandor metálico (`box-shadow` ≠ none) y destello |
| `.cupon-plata::after` con `cupon-sheen` | `.cupon-n-plata::after` con `cupon-sheen` (también Oro y Diamante) |
| chispas del Oro (≥ 3) | chispas de **Diamante** (`.cupon-chispa-diamante`, ≥ 3, `cupon-titilar`); Plata y Oro no llevan |
| `.cupon-texto-oro` con `cupon-brillo-texto` | sin equivalente en Plata/Oro/Diamante (el texto es tinta metálica `.cupon-metal-texto`, con `text-shadow`); se comprueba la tinta |
| — | iridiscencia `.cupon-iri` solo en Diamante (capa de degradado extra) |

Cada fila se identifica por el nombre de su premio de ejemplo, con su nivel de negocio conocido (r1 Todos los niveles → Plata, r5 Desde Premium → Oro, r6 Desde VIP → Diamante), no por `first()`. Sin esperas fijas, reintentos, `force` ni fallos esperados. «Especial» (rubí) solo existe en cupones de promoción reclamados: queda en «Pendiente con sesión».

**QA-063** (`qa-recompensas-fase2-portal.spec.mjs`, «Canjear: condiciones, cancelar sin débito y doble clic con un único cupón»): esperaba «sin protección configurada». Ahora verifica el texto aprobado por partes (regla global de mínimo de cobro por compra, «el cupón se rechaza completo, no se consume y puedes usarlo en otra compra», y «En servicios sin mínimo configurado, además, un cupón no descuenta más del 50 % del precio») y que la frase antigua ya no aparezca. **Se conservan intactas** las comprobaciones de cancelación sin débito, doble clic, saldo (100 → 60) e idempotencia (un solo canje y un solo cupón). Una prueba sin sesión (`niveles-visuales.test.mjs`) ata cada fragmento a `REGLA_PROTECCION`, que es lo que el diálogo muestra.

## QA-076 — no migrar si el respaldo previo falla

Incidente: la migración `20261005000004` se aplicó sin respaldo previo porque el comando de copia falló (ruta de Windows mal convertida) y el siguiente se ejecutó de todos modos (ver `COHERENCIA-PORTAL.md`).

`tests/e2e/migrar-local-con-respaldo.mjs` encadena, **sin saltos**, y solo al final llama a `supabase migration up --local`:

1. destino verificado (contenedor de QA, solo cuentas `@test.local`) y archivo de destino inexistente;
2. `pg_dump -Fc` dentro del contenedor con código de salida 0;
3. `pg_restore --list` legible, con la tabla de migraciones, y SHA-256 del volcado;
4. `docker cp` con argumentos en arreglo (sin shell: la ruta de Windows llega intacta);
5. el archivo existe, pesa más que un mínimo, empieza con `PGDMP`, su SHA-256 coincide con el del contenedor y su fecha pertenece a **esta** ejecución (ni anterior —archivo viejo— ni posterior —respaldo tomado después de migrar—);
6. recién entonces, `migrar()`.

El respaldo lo toma la propia ejecución (no acepta uno existente), así que un volcado posterior no puede hacerse pasar por el previo. Pruebas con dobles (`migrar-local-con-respaldo.test.mjs`, 21 casos, sin Docker ni base): `pg_dump` falla, `docker cp` falla (el caso del incidente), «copia correcta» pero sin archivo, archivo vacío/truncado/sin firma, `pg_restore --list` falla o sin tabla de migraciones, huella ausente o distinta, destino no consultable o con cuentas reales, nombre ya existente, fecha anterior y posterior, etiqueta con ruta: en todos `migrar()` **no se invoca**. Se comprobó con una mutación que la prueba de `docker cp` falla si se quita el control. No se reaplicó ninguna migración para demostrarlo.

Uso real en este lote (las dos migraciones nuevas son las únicas que estaban pendientes): `qa7_pre_20261007_20261007T050933Z.dump` (5 947 375 bytes, SHA-256 `b7b13a26…e8339`) y `qa7_pre_20261007b_20261007T051220Z.dump` (5 963 484 bytes, SHA-256 `4f9011e5…9f03f69`), en `C:\JaiseQA-Backups` (fuera del repositorio). Procedimiento: `node tests/e2e/migrar-local-con-respaldo.mjs <etiqueta>`.

## Pruebas por capa (resultados del 2026-10-07)

| Capa | Archivo | Resultado |
|---|---|---|
| Lógica pura | `niveles-visuales.test.mjs` (QA-064 y texto de QA-063) | 8/8 |
| Componente real renderizado (SSR vía Vite; sin sesión ni base) | `tarjetas-cupon-niveles.test.mjs` | 5/5 |
| Arnés con dobles | `migrar-local-con-respaldo.test.mjs` (QA-076) | 21/21 |
| SQL en Local TEST (claims simulados, rol `authenticated`; **no** E2E) | `recompensas-niveles-vigencia.test.mjs` | 14/14: matriz 3×3 (9 combinaciones; el backend rechaza los niveles superiores sin descontar monedas ni emitir cupón), catálogo/motivo/`mis_cupones` con el mismo nivel y costos distintos por clienta, descuento de precio por nivel, canje que reduce monedas y conserva clasificación y nivel, campañas futura/vigente/vencida para los tres niveles, vencimiento exacto del último día en Perú, bloqueo tras vencer en vista previa/pedido/Caja, verificación de pago, anulación con cupón vencido y vigente, reintento y 6 reclamos simultáneos |
| Interfaz sin sesión (Chromium real contra Vite local, red restringida) | `qa-062-niveles-visuales-publico.mjs` | 3/3: niveles y efectos (destello, resplandor, iridiscencia, chispas), responsive 1280 y 390 sin desbordes. Con una mutación (PREMIUM→Plata) falla, así que no es vacía |
| Capa `node --test` completa, en serie | `tests/e2e/*.test.mjs` | **320/320** (272 anteriores + 48 nuevas), 0 fallos |
| Compilación y lint | `npm run build`; `npm run lint` | build correcto; `oxlint` sin hallazgos en los archivos nuevos ni en los tres de `src` tocados (el lint global conserva errores y advertencias preexistentes, p. ej. `tests/e2e/fixtures.mjs`, que no se tocó) |
| Suite Playwright con sesión | — | **No ejecutada** (ver abajo) |

Los datos son ficticios (`TEST F2`); las promociones creadas se desactivan al terminar (QA-005 exige que no queden activas) y la configuración del programa se restaura (comprobado: `activo = false`, tasas 5/20 y 5/40, umbrales 50/150, 5 sellos). Los premios y clientas `TEST F2` se conservan, como en el resto de la capa.

## Pendiente con sesión (`QA_TEST_PASSWORD` no estaba disponible)

No se ejecutó **ninguna** prueba con sesión real ni la suite completa de Playwright con preparación nueva y `retries=0`; no se sustituyó con SQL simulado. Se mantiene el resultado anterior: **14 aprobadas, 2 fallos del arnés (QA-062 y QA-063, ahora adaptados) y 9 sin ejecutar, de 25** (las dos especificaciones de Recompensas). La suite limpia de 213 aprobadas y 1 omisión pertenece a `58842f7` y **no** describe el estado actual. Lo que falta, a ejecutar por Codex o con la contraseña:

1. `qa-recompensas-037-040.spec.mjs` y `qa-recompensas-fase2-portal.spec.mjs` (los dos casos adaptados y los 9 que no llegaron a correr), y luego una única suite completa: `node node_modules/playwright/cli.js test --config=playwright.qa.config.mjs` con `retries=0`, seguida de `sanear-salidas.mjs` y `archive-run.mjs`, y la comprobación de que el programa y los parámetros quedaron restaurados.
2. Interfaz con sesión de QA-064: tres clientas (Plata, Oro, Diamante) viendo el catálogo real con premios de niveles y costos distintos (color = nivel del premio; botón deshabilitado con «Requiere nivel …» en los superiores), un canje real por UI y el color del cupón emitido en «Mis cupones».
3. Interfaz con sesión de QA-075: reclamar el cupón de una campaña por UI («Reclamar cupón» en Inicio, con doble clic), ver su vencimiento en «Mis cupones», el cupón rojo Especial y su estado «vencido» tras el último día (con el reloj real no se puede adelantar; se simuló moviendo `vigente_hasta` solo en la capa SQL).
4. El reloj: las pruebas de límite del último día verifican el valor exacto emitido y las desigualdades alrededor de 23:59:59 / 00:00 de Lima, pero no esperan al cambio de día real.

## Archivos

Confirmados (commits de este lote): `supabase/migrations/20261007000001_cupones_promocion_vencimiento.sql`, `…000002_reclamar_cupon_promocion_idempotente.sql`; `tests/e2e/migrar-local-con-respaldo.mjs` y `.test.mjs`; `tests/e2e/recompensas-niveles-vigencia.test.mjs`; `tests/e2e/niveles-visuales-helpers.mjs`, `niveles-visuales.test.mjs`, `tarjetas-cupon-niveles.test.mjs`, `qa-062-niveles-visuales-publico.mjs`; ediciones de `qa-recompensas-037-040.spec.mjs` y `qa-recompensas-fase2-portal.spec.mjs`; esta documentación.

**Sin confirmar a propósito** (mezclan mis cambios de QA-064 con los cambios de diseño aprobados que siguen pendientes, y no se pueden separar por bloques sin arrastrar el diseño): `src/lib/cupones.js`, `src/pages/cliente/recompensas/datos.js` y `src/pages/cliente/recompensas/SeccionCanje.jsx` (este último solo tiene mis cambios, pero depende de `cupones.js`). Quedan en el árbol de trabajo, que es lo que se probó. Las pruebas de QA-062/064 y las expectativas del spec apuntan al diseño vigente, así que **pasan únicamente con el diseño aprobado y estos tres archivos presentes**; sobre `d99df1e` a secas no pasarían.
