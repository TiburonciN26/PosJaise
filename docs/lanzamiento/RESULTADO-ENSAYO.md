# Resultado del ensayo de lanzamiento (instancia desechable «JaiseEnsayo»)

Fecha: 2026-10-07. Solo la instancia desechable (API `127.0.0.1:56321`, base `56322`) y dos Vite del ensayo (`5273` frontend de `main`, `5274` frontend de `testing`). **QA Local (54321/5173/5174) no se tocó; producción solo se consultó en lectura (catálogo y agregados); no se aplicó SQL remoto.** Cuentas y datos ficticios; contraseña solo por entorno del proceso; ningún dato personal de producción.

## 1. Cómo se construyó el ensayo

1. `supabase db reset` en la instancia desechable con **solo las 124 migraciones ≤ 20261001** (equivalentes al esquema de producción; ver el manifiesto).
2. Privilegios de producción reproducidos (`ensayo-privilegios-produccion.sql`): privilegios por omisión del rol `postgres` (anon sin datos), ACL de cada tabla/vista/función, SELECT por columna en `productos`, `ventas.monto_pos_tarjeta numeric`.
3. **Comprobación de equivalencia con producción** (huella por categoría, ambos lados solo lectura): columnas, restricciones, políticas, índices, tablas, triggers, vistas, privilegios de tabla/columna/función **idénticos**; funciones: 70 de 72 idénticas y 2 con diferencias de comentarios (`anular_venta`, `confirmar_venta`).
4. Datos ficticios con la **forma** de producción (270 productos con 5 de costo 0, 33 servicios S/10–S/350, 69 clientes, 127 ventas hasta `VEN129`, 47 citas, 3 cupones, 1 promoción inactiva, config de producción). 5 cuentas Auth ficticias (ADMINISTRADOR, CAJERA, ASISTENTE, 2 clientas).
5. Respaldo previo (`pg_dump -Fc`, sha256 `c82eb0c1…`) fuera del repositorio (`C:\JaiseQA-Backups\lanzamiento\`).
6. Las 21 migraciones se aplicaron **una por una con el rol `postgres`** (el de `apply_migration` en producción).

Herramientas (en el repositorio, solo apuntan al ensayo y rechazan cualquier otro destino): `tests/e2e/ensayo-preparar-lanzamiento.mjs`, `ensayo-aplicar-migraciones.mjs`, `ensayo-lanzamiento-instantanea.mjs`, `ensayo-servir-front.mjs`, `ensayo-ui/lanzamiento*.ensayo.spec.mjs`, `playwright.lanzamiento.config.mjs`. Evidencia JSON (ignorada por Git): `tests/e2e/results-ensayo/` y copia en `C:\JaiseQA-Backups\lanzamiento\evidencia\`.

## 2. Aplicación de las migraciones

**21/21 aplicadas sin error** (≈ 110 ms cada una; `lanzamiento-aplicar.json`; **cada archivo se confirma por separado**, no hay una transacción común de las 21). El aplicador del ensayo ahora se detiene ante el primer error, **incluido** un fallo al registrar la versión en `schema_migrations` o que la versión no aparezca registrada tras el INSERT (prueba específica sin base de datos: `tests/e2e/ensayo-aplicar-migraciones.test.mjs`, 4 casos). Las corridas de este informe se hicieron con la versión anterior del aplicador, que no comprobaba ese INSERT, y **otra vez 21/21 tras restaurar el respaldo** (la re-aplicación es repetible). El primer intento falló con «permission denied for schema public» por la configuración del ensayo (la base restaurada pertenecía a `supabase_admin`, no a `postgres`), **no por una migración**; se corrigió el propietario de la base del ensayo y se repitió desde cero. Esquema resultante ≡ el de QA Local en funciones (100), políticas (134), restricciones (244), índices (108), tablas (51), triggers (20), vistas; única diferencia de columnas: `monto_pos_tarjeta` (deriva de producción, reproducida a propósito). Los **privilegios** de los objetos nuevos son los pedidos por las migraciones (p. ej. `recompensas_config`: `authenticated=r`, sin `anon`): con los privilegios por omisión de producción **ninguna tabla o función nueva queda inaccesible** para lo que usa el frontend.

## 3. Impacto en datos (con el programa apagado)

**Alcance exacto de la huella de datos** (`huellaNegocio()` en `tests/e2e/ensayo-ui/lanzamiento-ayuda.mjs`): para cada una de 17 tablas compara **conteo de filas + md5 de un subconjunto fijo de columnas** (las que existían antes de la actualización y se consideran de negocio), ordenadas por fila. Verifica que esas columnas no cambiaron. **No verifica** el contenido completo de las tablas: quedan fuera las demás columnas (p. ej. fechas de creación/actualización, notas, URL de fotos y las columnas añadidas por las migraciones), las tablas no listadas (p. ej. `movimientos`, reseñas, `auth.*`, `storage.*`) y cualquier objeto que no sea una tabla. Por eso «huella idéntica» significa «las columnas comparadas de esas 17 tablas no cambiaron», no «los datos son idénticos».

Resultado: huella (conteo + md5 de las columnas comparadas) de **17 tablas de negocio sin cambios antes y después** (productos 270, servicios 33, clientes 69, ventas 127, venta_items 127, citas 47, cita_servicios 47, registro_servicios 0, cupones 3, promociones 1, pedidos_web 0, config_puntos/referidos/fidelización, usuarios 3, asistentes 2, porcentajes 3). Lecturas del portal y de los paneles: mismos valores; solo cambian columnas **añadidas** (`mis_cupones` +10, `resumen_dashboard` +`envio_cobrado`). Tablas nuevas: todas vacías salvo `recompensas_config` (1 fila: `activo=false`, `corte=null`). La restauración del respaldo (de datos ficticios) devolvió una instantánea con la **misma huella** (mismo alcance) que la original.

## 4. Compatibilidad en cuatro momentos (suite `lanzamiento*.ensayo.spec.mjs`, sesiones reales por el login normal, `retries=0`)

La suite recorre, por UI, las pantallas de cada rol (ADMINISTRADOR, CAJERA, ASISTENTE: 25 rutas; CLIENTA: 15), vende y anula desde Caja, y por la API real (con la forma exacta de llamada del frontend de `main`) cupones en Caja, stock, roles, citas (guardado en 3 pasos + completar), pedido web con la firma de 13 parámetros + verificación de pago + anulación, finanzas y portal con el programa apagado.

| Escenario | Resultado | Notas |
|---|---|---|
| **main + backend actual** (línea base de producción) | 13 pasan, 1 omitida (`guardar_cita_pos` no existe) | humo limpio en los 4 roles; **defectos existentes de producción medidos** (§5) |
| **testing + backend actual** (orden equivocado) | 13 pasan, hallazgos registrados | ADMIN: `asistentes` 400 (columnas nuevas), `recompensas_catalogo/canjes/config` y `servicios_proteccion` 404; CLIENTA: 404 en `recompensas_reglas_publicas`, `resenas_inicio`, `mi_catalogo_recompensas`, `mi_saldo_recompensas`, `mis_movimientos_recompensas`, `mis_sellos_recompensas`. **CAJERA y ASISTENTE sin errores.** ⇒ el frontend nuevo **no** debe publicarse antes del backend |
| **main + backend actualizado** (bundle/PWA antiguo abierto) | **14/14** | humo limpio (0 http ≥ 400, 0 pageerror, 0 consola); venta y anulación por UI; cupones, pedido de 13 parámetros y verificación de pago funcionan |
| **testing + backend actualizado** | **14/14** | humo limpio (25 rutas × 3 roles + 15 de la clienta) |
| **testing + backend actualizado + correctivas de privilegios** | **14/14** + cupones **6/6** | tras `propuesta-correctivas-privilegios.sql` |
| Recuperación (respaldo previo restaurado, frontend de `main`) | humo y venta/anulación por UI **pasan**; el caso de cupón repite el defecto previo (esperado) | la huella de datos (alcance de §3) coincide con la original |

**Llamadas del frontend de main:** las 55 RPC que usa existen todas tras la actualización; solo difiere una firma (`confirmar_pedido_productos`, 13 → 15 parámetros con defaults), probada con la llamada antigua. El frontend nuevo usa 11 RPC más (`catalogo_recompensas_publico`, `guardar_cita_pos`, `mi_catalogo_recompensas`, `mi_cliente_id`, `mi_saldo_recompensas`, `mis_movimientos_recompensas`, `mis_sellos_recompensas`, `recompensas_establecer_activo`, `recompensas_reglas_publicas`, `resenas_inicio`, `vista_previa_cupon_pedido`).

## 5. Defectos que **hoy existen en producción** y corrige la actualización (medidos en el ensayo con la base equivalente)

1. **Un cupón en Caja falla:** «column reference "codigo" is ambiguous» (QA-019) — con los dos cupones DISPONIBLES de producción (bienvenida S/10 y fidelización 20 %).
2. **«Verificar pago» de un pedido web falla:** «violates check constraint ventas_metodo_pago_check» (QA-009: el pedido guarda `YAPE`, la venta exige `Yape`). Hoy no hay pedidos web activos en producción (2 cancelados); el primer pedido real no se podría verificar.
3. La ASISTENTE puede vender y agregar stock por la API (QA-033/035).

Después: cupones en Caja 200 (S/30 − S/10 = S/20; S/30 − 20 % = S/24), verificar pago 200 y anular conciliando el pedido (CANCELADO), asistente rechazada.

## 6. Cupones y protecciones (6/6; detalle en `REVISION-CUPONES-PROTECCION.md`)

Producto de costo 0 sin confirmar + cupón → **bloqueado** (mensaje neutro); el mismo producto sin cupón o con descuento manual → sin cambio. Servicio de S/10 + cupón de S/10 → rechazado (supera el 50 %); S/28 + S/10 → permitido; S/350 + 20 % → permitido. Los cupones vuelven a DISPONIBLE tras anular y no se creó ningún movimiento de monedas.

## 7. Hallazgos de privilegios (acción propuesta, ensayada en la desechable)

* `confirmar_pedido_productos` queda ejecutable por `anon`/`service_role` (la migración 16 lo concede; hoy solo `authenticated`): sin sesión llega a la función y recibe «Completa tu perfil antes de confirmar un pedido.», sin crear pedidos.
* `recompensas_establecer_activo` permite a un administrador encender el programa desde la interfaz (fija `corte = now()` sin apertura).
* Ambos se corrigen con `propuesta-correctivas-privilegios.sql` (retirar `anon/service_role` del primero; retirar `authenticated` del segundo hasta la apertura): tras aplicarla en el ensayo, **20/20 casos** (14 de compatibilidad + 6 de cupones, frontend nuevo) siguen pasando y el humo de ADMIN en `/recompensas-web` carga sin errores.

## 8. Qué NO se probó (límites)

* **No es producción:** datos ficticios con la forma de los reales; el volumen es el mismo orden de magnitud, no los mismos registros. Auth, Storage (buckets/objetos) y Realtime del ensayo no son los de producción; Storage no se modificó ni se probó la subida de comprobantes.
* **Pedido web con el bundle antiguo por la interfaz:** se probó con la llamada RPC exacta de 13 parámetros y la carga de todas las pantallas de la clienta con el frontend de `main`, no el checkout completo con clics.
* Frontend de `main` probado con selectores genéricos de Caja/Historial; no se ejecutó la suite QA completa contra el ensayo (la suite QA está fija a QA Local por sus guardas y la regresión completa 212/1/1 anterior sigue siendo la referencia, sin repetirla).
* Una sola instancia, un solo navegador (Chromium), sin dispositivos físicos, sin PWA instalada, sin carga concurrente real de clientes.
* `servicios_mas_pedidos` es inestable por empates (no es efecto de la actualización).
* Los **cambios de frontend** (merge a `main`, build y publicación) no se ejecutaron: solo se ensayó su comportamiento servido por Vite.
* La **activación, la apertura/conversión ×5** y el catálogo de premios quedan fuera.

## 9. Segunda ronda: 23 migraciones con el aplicador corregido, privilegios y bloqueo de la activación

Fecha: 2026-10-08. Misma instancia desechable (solo ella); producción solo en lectura (nombres y precios de servicios para la ficha). Partida: **restauración del respaldo previo** (`ensayo_PRE_…dump`, datos ficticios; 124 migraciones registradas, sin `recompensas_config`).

1. **Aplicación con el aplicador corregido:** `node tests/e2e/ensayo-aplicar-migraciones.mjs` → **23/23 aplicadas y registradas** (cada una comprobada en `schema_migrations`). La detención ante fallos se demuestra con `tests/e2e/ensayo-aplicar-migraciones.test.mjs` (4 casos, sin base de datos: fallo del INSERT, INSERT sin efecto, migración fallida y camino feliz). **Límite:** el fallo real de una migración sobre la base no se provocó a propósito en esta ronda; lo cubre la prueba con acciones inyectadas.
2. **Privilegios y bloqueo** (`lanzamiento-privilegios.ensayo.spec.mjs`, frontend de `testing`, **6/6**):
   * privilegios efectivos de `confirmar_pedido_productos` (15 parámetros): `anon` f, `authenticated` t, `service_role` f, `postgres` t, `PUBLIC` f;
   * pedido **con sesión** (llamada de 13 parámetros del frontend actual): 200 y pedido creado; **sin sesión**: 401 «permission denied for function confirmar_pedido_productos» y **0 pedidos creados**;
   * **ADMINISTRADOR no puede encender el programa:** por la función → 400 «Recompensas no se puede activar todavía: primero debe autorizarse y ejecutarse la apertura.»; por UPDATE directo → 403; marcar `apertura_ejecutada_en` por la API → 403; CAJERA → «Solo el administrador…»; la configuración queda `activo=false`, `corte=null`, `apertura_ejecutada_en=null`, y 0 movimientos/canjes/aportes;
   * **pantalla:** en Recompensas Web → Programa el ADMINISTRADOR ve «Apagado» y una nota que explica que la activación está bloqueada hasta que se autorice y ejecute la apertura; **no** aparece «Activar programa» ni «Apagar programa»; 0 respuestas ≥ 400 al cargar;
   * control positivo: con la apertura marcada (lo que hará la función de apertura) la activación funciona (204) y el estado se restaura a apagado.
3. **Compatibilidad con las 23 aplicadas** (suites `lanzamiento*.ensayo.spec.mjs`, 14 de compatibilidad + 6 de cupones por frontend): **frontend de `main` (bundle antiguo): 20/20**; frontend de `testing`: **20/20**. Estado del programa tras las suites: `activo=false`, `corte=null`, `apertura_ejecutada_en=null`, 0 movimientos.
4. **Datos existentes con las 23** (repetido en limpio para que ninguna suite intermedia contamine la comparación): restauración del respaldo previo → instantánea → 23/23 → instantánea. Huella (alcance de §3) de las 17 tablas **sin diferencias**; las 32 lecturas del portal y de los paneles (4 roles) devuelven los **mismos valores en sus columnas antiguas** y estado 200. Es el mismo alcance y los mismos límites que en la primera ronda: no es identidad completa del contenido.
5. **Qué no cambió respecto a la primera ronda:** los defectos existentes de producción (cupón en Caja, verificar pago, asistente que vende) se corrigen igual; la instancia queda en el estado posterior a las 23.

**Límites de esta ronda:** una sola instancia y un solo navegador; datos ficticios; la prueba de la pantalla cubre el estado «apertura no ejecutada» (el único alcanzable hoy); el estado «apertura ejecutada» en pantalla (botón «Activar programa» habilitado) solo se comprobó por la API, no por la interfaz; no se ejercitó la función de apertura real (sigue siendo un borrador fuera de `supabase/migrations/`). Las suites de QA de Recompensas que activan el programa necesitan la apertura marcada antes (se actualizó su ayudante `activar()`), y **no se ejecutaron en esta ronda** porque QA Local no recibe estas migraciones todavía.

## 10. Ensayo del procedimiento de respaldo y restauración (datos ficticios)

Fecha: 2026-10-08. Script repetible: `tests/e2e/ensayo-respaldo-procedimiento.mjs` (solo el contenedor del ensayo; archivos en `/tmp` del contenedor, borrados al terminar; evidencia en `tests/e2e/results-ensayo/respaldo-procedimiento.json`, ignorada por Git). Origen: la base del ensayo con las 23 migraciones y datos ficticios. Producción solo en lectura (versión, extensiones y atributos de roles, sin contraseñas ni datos personales).

| Paso | Resultado |
|---|---|
| Versiones | `pg_dump` 17.11 contra servidor 17.11 (producción: 17.6); el script exige el mismo mayor |
| Exportación | `pg_dump --format=custom` de `public`, `auth`, `storage`, `supabase_migrations` como **`postgres` (no superusuario)**: código 0, ≈ 855 KB, ≈ 0,3 s, sha256 registrado. **Sin** `--no-owner`/`--no-acl` |
| Lectura | `pg_restore --list`: 1 219 entradas, cabecera con versiones, **230 entradas ACL y 230 `OWNER TO`**, 448 GRANT/REVOKE |
| Roles | el `.dump` **no contiene roles**; `pg_dumpall --roles-only --no-role-passwords`: 16 `CREATE ROLE`, 22 pertenencias, 32 `ALTER ROLE`, **sin contraseñas** |
| Restauración A (destino con los roles) | `pg_restore --exit-on-error` como superusuario: código 0; **9 huellas iguales** (esquemas, relaciones, ACL de columnas, funciones, tipos, privilegios por omisión, políticas, triggers y datos: propietarios y privilegios incluidos) |
| Restauración B1 (clúster vacío **sin** roles) | **455 errores «role … does not exist»** (el primero `supabase_admin`): sin los roles el archivo no se restaura |
| Restauración B2 (clúster vacío con `roles.sql` y extensiones, base con el mismo encoding y proveedor de collation) | código 0; **9 huellas iguales** |
| Contraste `--no-owner --no-acl` | restaura sin error pero **difieren 6 huellas** (esquemas, relaciones, ACL de columnas, funciones, tipos, privilegios por omisión): se pierden propietarios y privilegios |

**Hallazgos que cambiaron el procedimiento:** (1) el comando anterior con `--no-owner=false` no existe; (2) `pg_dump -n public` emite `CREATE SCHEMA public`, que choca con el `public` de una base nueva: se omite esa entrada con `pg_restore --use-list` (borrar `public` antes hace perder la concesión por omisión a `PUBLIC`); (3) el origen usa collation **ICU `en-US`** y un clúster nuevo usa `libc`: con otro proveedor cambia el orden de las cadenas (una huella de `storage.migrations` difería) hasta crear la base con el mismo proveedor; (4) los privilegios por omisión de esquemas que no se respaldan (`extensions`, `graphql`, `realtime`…) no viajan: la huella los excluye a propósito; (5) el texto de las políticas (`auth.uid()`) depende del `search_path` de la sesión que lo lee: la huella usa un `search_path` neutro.

**Límites.** Datos ficticios y un volumen pequeño; no se conectó a producción (IPv6/pooler, permisos reales de `postgres`, `pg_dumpall --roles-only` en Supabase alojado y descarga de Storage quedan sin probar); el destino fue la misma imagen de Supabase, y el clúster vacío (PostgreSQL 17.11 sin `supabase_vault`) restauró los cuatro esquemas sin errores pero no equivale a un Supabase completo; la restauración del respaldo **real** sigue sin validarse (entorno de recuperación sin crear).

### 10.1 Corrección de la detección de fallos del script (2026-10-08)

Codex reprodujo en memoria que `ensayo-respaldo-procedimiento.mjs` terminaba sin error con una restauración en código 1, con datos distintos y con `pg_dumpall` fallido. Causa: el script guardaba los códigos de salida pero nunca decidía sobre ellos ni cambiaba su propio código de salida. Ahora:

* La decisión vive en `tests/e2e/ensayo-respaldo-nucleo.mjs` (`evaluarResultado`, `clasificarErroresRoles`, `ejecutarConLimpieza`, `codigoDeSalida`) y el script **termina con código 1** ante: código de salida inesperado en exportación, lectura, `pg_dumpall`, preparación del destino o restauraciones; cualquier diferencia de huella; un control negativo que no falla como se espera; cualquier error inesperado al preparar roles; pertenencias o atributos de roles distintos; o fallo de limpieza. Escribe `respaldo-procedimiento.json` también cuando falla (campos `fallos` y `error`).
* **Fallos deliberados frente a controles negativos:** son controles negativos (deben fallar, y si NO fallan el ensayo falla) la restauración **sin roles** (debe terminar con error y con «role … does not exist») y la restauración **con `--no-owner --no-acl`** (debe terminar bien y perder exactamente 6 categorías de huella). Cualquier otro código distinto de cero es un fallo inesperado.
* **Los 24 errores al preparar roles ya no se aceptan «porque la restauración funciona»:** cada error se asocia a la sentencia que lo causó y solo es esperado si coincide con una categoría justificada: 1 × `rol_preexistente` (`CREATE ROLE postgres`), 1 × `atributos_preexistente` (`ALTER ROLE postgres … NOSUPERUSER`: el superusuario inicial no puede dejar de serlo) y 22 × `membresia_con_otorgante` (`GRANT … GRANTED BY supabase_admin`: PostgreSQL 17 exige ADMIN OPTION al otorgante y el destino recién creado no lo tiene, así que **esas 22 pertenencias no quedaban aplicadas**; el ensayo anterior no lo había notado). Las 22 se re-aplican sin `GRANTED BY` y se verifica: pertenencias del destino = 22 = origen (0 distintas) y atributos de roles iguales salvo `postgres`. Un error fuera de esas categorías es un fallo.
* **Limpieza:** se intenta siempre (clúster vacío, bases de prueba, archivos) y se verifica que no queden residuos; si falla, el error **original** se conserva (se relanza el mismo objeto, con `limpiezaErrores` adjunto); si solo falla la limpieza, es un fallo.
* **Pruebas aisladas** (`tests/e2e/ensayo-respaldo-procedimiento.test.mjs`, `node --test`, sin Docker): **15/15** — camino exitoso; restauración en código 1; datos distintos; `pg_dumpall` fallido (y sin `CREATE ROLE`, con contraseñas, con roles dentro del `.dump`); exportación y lectura defectuosas; controles negativos que no fallan o fallan de otra forma; clasificación de errores de roles (esperados e inesperados, incluido un `CREATE ROLE` de un rol que no existía y un error con otro mensaje en la misma sentencia); errores sin clasificar, reparación incompleta y roles distintos; limpieza (error original conservado, todas las limpiezas intentadas, limpieza sola que falla); códigos de salida.
* **Repetición del ensayo ficticio de respaldo** (solo ése, sin la suite E2E): **código de salida 0**, 9 huellas iguales en las dos restauraciones, ambos controles negativos fallaron como se esperaba, 24 errores de roles = 1 + 1 + 22 clasificados y 0 inesperados, 22/22 pertenencias re-aplicadas e iguales a las del origen, sin residuos tras la limpieza.

**Límites de esta corrección.** Los escenarios de fallo se prueban sobre la lógica de decisión con resultados simulados; no se provocaron fallos reales de `pg_restore`/`pg_dumpall` dentro del contenedor (el cableado `process.exit` se verificó por el código 0 de la ejecución real, no por una ejecución real con fallo). Los datos y el servidor siguen siendo los del ensayo (17.11, ficticios); en producción los roles y sus permisos pueden dar otros errores, que el script, por diseño, trataría como inesperados.

### 10.2 Cierre de la brecha del control «sin roles» (2026-10-08)

Codex añadió `otros_errores = 1` (error de E/S) al resultado exitoso y `evaluarResultado()` seguía devolviendo `fallos = []`. Ahora el control negativo «sin roles» debe fallar **exclusivamente** por los errores de roles previstos: `otros_errores` debe existir, ser un entero y valer 0, y `ejemplos_otros` debe estar vacío; si falta, es inválido o es distinto de 0, el ensayo falla. Pruebas añadidas (17/17 en total): errores mezclados (roles + E/S, con y sin contador coherente) y verificación ausente o inválida (`undefined`, `null`, `'0'`, `NaN`, sección completa ausente). No se repitió la restauración ni la suite E2E por este ajuste (el script ya registraba `otros_errores` desde la corrección anterior; solo faltaba que el evaluador lo exigiera).
