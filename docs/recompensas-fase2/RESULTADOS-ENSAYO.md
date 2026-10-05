# Fase 2 — resultados del ensayo en instancia desechable

**Alcance:** el ensayo se hizo en la instancia desechable `JaiseEnsayo`. En Supabase Local QA se hizo **una sola escritura, autorizada el 2026-10-05: registrar en `schema_migrations` las 13 versiones ya aplicadas** (sección «Registro en QA»); nada más cambió en QA. No se ejecutó la apertura ni se activó Recompensas, no se borraron los 17 aportes y no se tocó producción.
La evidencia cruda (volcados, huellas, diferencias) está en `C:\JaiseQA-Backups` (fuera del repositorio, bajo custodia del propietario). No contiene credenciales en este documento; los volcados incluyen cuentas ficticias `@test.local` y hashes de roles locales, por eso no se suben.

## Corte de la copia

| | |
|---|---|
| UTC | `2026-10-05T04:32:53Z` (instante en que arrancó el volcado) |
| Hora de Perú (UTC−5) | `2026-10-04 23:32:53` |
| Volcado | `qa_20261005T043253Z.dump` (+ esquema y roles; huellas SHA-256 en `SHA256-20261005T043253Z.txt`) |
| Congelación de ventas de QA | **Ninguna** (QA siguió disponible). Tras el ensayo se comprobó que QA no cambió (ver «Estado de QA») |

El corte del ensayo de transición es ese mismo instante: la última atención de la copia es anterior (04:06:46 UTC), y toda actividad creada después en el ensayo cuenta como posterior al corte.

## Entorno del ensayo

| | QA | Ensayo |
|---|---|---|
| Proyecto / contenedores / volúmenes | `WedJaiseReact` | `JaiseEnsayo` (propios) |
| API / BD / Studio | 54321 / 54322 / 54323 | 56321 / 56322 / 56323 |
| PostgreSQL | 17.6 (imagen 17.6.1.171) | 17.11 (imagen 17.11.0.002) |
| realtime / storage-api / postgrest | v2.135.3 / v1.77.0 / v16.3 | v2.140.3 / v1.79.28 / v16.4 |

Supabase CLI 2.119.0 instalado en `C:\JaiseQA-Tools` (fuera del proyecto; huella SHA-256 verificada contra `checksums.txt` de la versión). Directorio de trabajo del ensayo: `C:\JaiseQA-Ensayo` (copia de `supabase/migrations`, `seed.sql` y `config.toml` con otro `project_id` y puertos). No se instaló nada en el proyecto ni se editó `.env`.

## 1. Instalación limpia

`supabase start` aplicó **137 de 137 migraciones sin errores** y la semilla; el registro quedó en 137 filas.

**Comparación del esquema final contra QA** (`pg_dump --schema-only`): `public`, `auth` y `supabase_migrations` **idénticos**. Las únicas diferencias están en esquemas administrados por la plataforma (`realtime`, `storage`); su causa es la versión de las imágenes (arriba), no las migraciones del proyecto:

| Diferencia | Causa |
|---|---|
| `realtime.list_changes_sync` y `realtime.settled_changes` existen solo en el ensayo | migraciones internas de realtime más nuevas (QA en `20260827…`, ensayo en `20260928…`) |
| `realtime.messages_2026_10_02` y `_03` existen solo en QA; GRANT de `realtime.messages*` distintos | particiones por fecha y privilegios por defecto de la versión de realtime |
| `storage.buckets`, `storage.buckets_analytics` y `storage.objects`: en QA `GRANT ALL` a `anon`/`authenticated` (incluye TRUNCATE, REFERENCES, TRIGGER); en el ensayo solo SELECT/INSERT/UPDATE/DELETE | privilegios por defecto de una versión anterior de storage-api al crear QA |

Observación de seguridad (no es defecto de las migraciones del proyecto): QA es **más permisivo** que una instalación nueva en esas tres tablas de `storage`, coherente con el pendiente ya conocido «privilegios por defecto TRUNCATE/REFERENCES/TRIGGER de `anon` y `authenticated`». Producción no se consultó.
Diferencia completa: `evidencia/diff_esquema_limpio_vs_qa.txt` (341 líneas, todas en `realtime`/`storage` salvo el token aleatorio de `pg_dump`).

**Pendiente de esta sección:** no se fijaron las imágenes del ensayo a las versiones exactas de QA (el CLI trae las suyas); si se quiere fidelidad total de plataforma, hay que fijarlas en `supabase/.temp` del directorio del ensayo.

## 2. Restauración de la copia

`pg_restore` del volcado en una base separada de la instancia desechable: **0 errores**. Verificación: para **88 tablas** de `public`, `auth`, `storage` y `supabase_migrations`, conteo y huella MD5 del contenido (filas ordenadas) **idénticos** a los de QA viva; y el esquema de la copia coincide con el de QA.

Primer intento (honesto): se restauró con `--no-owner`, lo que dejó la tabla `schema_migrations` con otro propietario y el registro posterior falló por permisos. No era un problema del plan sino de esa restauración; se rehízo conservando propietarios (que además es más fiel) y todas las verificaciones se repitieron sobre esa segunda restauración.
Límite: el volcado de base de datos **no incluye los archivos físicos de Storage**, solo sus filas de metadatos.

## 3. Reconciliación de `schema_migrations` (solo en la copia)

Versiones pendientes **recalculadas sobre el estado capturado**: 137 archivos, 124 registradas, **13 pendientes** (`20261002000001…08`, `20261003000001…04`, `20261004000001`); ninguna registrada sin archivo.

- Antes: `supabase db push --dry-run` listaba esas 13 como pendientes, es decir, **las reaplicaría**.
- Efecto de cada versión: verificado por equivalencia del esquema (copia = QA = instalación limpia en `public`).
- Registro con el CLI (`migration repair --status applied`, URL fijada a la copia).
- Después: `db push --dry-run` → «Local database is up to date»; historial = archivos (137).
- **No reaplicó nada:** contadores de tuplas de la copia (reiniciados antes): solo `supabase_migrations.schema_migrations` con 13 inserciones y ninguna otra tabla con inserciones, actualizaciones o borrados; huellas de las 88 tablas iguales salvo `schema_migrations`; esquema antes/después sin diferencias.

En QA este mismo registro se hizo después, con autorización expresa (sección «Registro en QA»). Es reversible: borrar las 13 filas por `version`, o restaurar el respaldo.

## 4. Transición histórica ×5 (decisiones A y B)

Borrador: [`transicion/apertura-borrador.sql`](transicion/apertura-borrador.sql) — **fuera de `supabase/migrations/` a propósito**; no está aplicado en QA (verificado: 0 funciones de apertura, `recompensas_apertura_espera` no existe). Ensayo: `tests/e2e/recompensas-transicion.ensayo.mjs`, **15/15** casos, sobre una restauración nueva (`ensayo-preparar-transicion.mjs`), con el corte exacto de la copia.

**Totales recalculados sobre el estado capturado** (las cifras 955 clientas / 8 390 monedas son **referencia histórica** y ya no son vigentes; la copia es casi toda de pruebas):

| Medida | Estado capturado | Con 8 fixtures del ensayo |
|---|---|---|
| Clientas / vinculadas / sin cuenta | 2 652 / 2 382 / 270 | 2 660 / 2 388 / 272 |
| Puntos antiguos (vinculadas) → monedas de apertura | 8 148 → 40 740 | 8 219 → 41 095 |
| Niveles (Básico / Premium / VIP) | 2 202 / 82 / 98 | 2 207 / 82 / 99 |
| Sellos heredados > 20 · reclamadas > visitas (negativos) | 56 · 14 | 57 · 15 |
| Sin cuenta web con puntos (puntos congelados) | 162 (420) | 163 (428) |
| Atenciones pendientes de cobro | 3 788 | 3 818 |

| Verificación | Resultado |
|---|---|
| Dry-run | informa y no escribe (huellas iguales); detecta 17 aportes preexistentes de fixtures `TEST F2` y **bloquea** |
| Ejecución con bloqueo | rechazada sin escribir nada; se retiraron solo esos 17 aportes **en la copia desechable** |
| Conciliación (sobre lo escrito) | monedas escritas = 5 × puntos antiguos (41 095); aportes escritos = puntos esperados (8 647, incluye las 272 en espera); 272 filas de espera |
| Por clienta frente a la simulación independiente | 0 diferencias en monedas, clasificación, sellos y nivel (2 388 clientas); aportes por clienta suman exacto sus puntos |
| Sellos heredados y negativos | clienta de 25 visitas → +25 (> 20, VIP, 250 monedas); 3 visitas con 2 reclamadas → −7 conservado tal cual; redondeo −0,6665 y bono 7 atribuidos |
| Decisión A | sin cuenta: saldo congelado, sin saldo gastable; actividad posterior sin cuenta no acredita; al vincular se habilita **una vez** (40 monedas, 3 sellos); desvincular/revincular y otra cuenta: 1 sola apertura; la función de habilitación no es invocable por `authenticated` |
| Atenciones pendientes | el servicio anterior al corte no se acredita otra vez (`incluida_en_apertura`); el producto de la misma venta sí (+10) |
| Decisión B | anular 2 ventas históricas (una creada y una real de la copia sin movimientos nuevos): apertura intacta y sin movimientos; venta nueva: se revierte **una vez** (repetir la anulación no revierte de nuevo) |
| Idempotencia | segunda ejecución: 0 por procesar y **ninguna tabla cambió** (incluida la configuración); otro corte se rechaza; 0 claves repetidas; máximo 1 apertura por clienta |
| Permisos | solo ADMINISTRADOR; CAJERA, ASISTENTE y `anon` rechazados; funciones internas sin acceso para `authenticated` |
| Reversión con actividad | con ventas, movimientos o canjes posteriores **se rechaza** (y no borra nada); sin actividad, se revierte y la reapertura reproduce exactamente el saldo |
| Recuperación | restaurar la copia previa a la apertura en otra base deja 9 tablas clave con conteo y huella **idénticos**; 0 aperturas |

Defectos encontrados y corregidos en el borrador durante el ensayo (se conserva el historial):
1. La segunda ejecución actualizaba `recompensas_config.actualizado_en` aunque no hubiera nada que hacer → ahora solo escribe si el corte cambia.
2. Mi primera selección de «venta histórica real» tomó una venta con movimientos de pruebas anteriores; anularla revirtió solo esos aportes nuevos y no la apertura (comportamiento correcto de B); la prueba ahora elige una venta sin movimientos.
3. Dos fallos de preparación del ensayo (reejecutar sobre una base ya consumida; comparar niveles incluyendo fixtures antiguos): errores del arnés, no del borrador.

## Arnés: destinos fijos de QA y la vía separada

La suite actual tiene destinos **fijos** de QA y no basta cambiar un puerto:

| Destino | Dónde está |
|---|---|
| `http://localhost:5173` (app) y `http://127.0.0.1:54321` (Supabase) | `local-safety.mjs`, `playwright.qa.config.mjs`, `global-setup.mjs`, `recompensas-fase2-helpers.mjs` (verificación), `qa-recompensas-037-040`, `qa-recompensas-fase2-portal`, `performance-*` |
| `baseURL: 'http://localhost:5173'` repetido | `expanded-crud`, `known-issues`, `qa-catalogo-web`, `phase2-helpers`, `global-setup` |
| Contenedor SQL `supabase_db_WedJaiseReact` | `recompensas-fase2-helpers.mjs` (todas las pruebas `node:test`) |
| Contenedor Kong `supabase_kong_WedJaiseReact` y su clave de servicio | `local-safety.mjs` (`localServiceKey`) |
| Claves anónima/servicio, URL Auth/REST | las inyecta el Vite de QA (`.env.local`); el `.env` del proyecto apunta a producción y **no se usa ni se lee** |
| `fixtures/runtime.json` | compartido entre ejecuciones |

Vía separada (`tests/e2e/ensayo-destino.mjs`, 6 pruebas en `ensayo-destino.ensayo.mjs`): no modifica ninguna guarda existente y solo puede escribir en la instancia desechable. Exige: contenedor fijo del ensayo (no tomado del entorno), etiqueta `JaiseEnsayo` y puerto 56322 confirmados con Docker, marca `ensayo_marker.destino` en la base y base dentro de una lista cerrada. Rechaza el contenedor, puertos y orígenes de QA, y orígenes de red fuera del ensayo; QA no lleva la marca. Los archivos `*.ensayo.mjs` **no** coinciden con `*.test.mjs`, así que la regresión de QA no los ejecuta por accidente.
**Vía de interfaz y HTTP:** ejecutada en el segundo lote (secciones «HTTP e interfaz con sesiones reales», «Concurrencia» y «Storage»), con `playwright.ensayo.config.mjs`, un Vite de ensayo en el puerto 5273 y claves y URL solo en el entorno del proceso. El `.env` del proyecto apunta a producción y no se usa ni se lee.

## Registro en QA de las 13 versiones (autorizado el 2026-10-05)

Lo único que se escribió en QA. Procedimiento y evidencia (`C:/JaiseQA-Backups/evidencia/qa-registro/`):

| Paso | Resultado |
|---|---|
| Verificación previa | 137 archivos, 124 registradas, **13 faltan** (las mismas que en la copia); ninguna registrada sin archivo; migraciones del repo idénticas a las usadas por el CLI |
| Efecto presente | esquema de QA = esquema de la instalación limpia en `public` y `auth` (sección 1); `confirmar_venta` contiene la guarda de roles |
| Respaldo nuevo | volcado `qa2_20261005T051243Z.dump` (+ esquema, huellas SHA-256) **y copia de los 380 archivos de Storage de QA** (solo lectura; las 380 huellas coinciden con las de QA) |
| Antes del registro | `db push --dry-run` en QA: listaba las 13 como pendientes (**las habría reaplicado**) |
| Registro | `migration repair --status applied` con la URL de QA fijada al puerto 54322; sin reaplicar SQL |
| Después | `db push --dry-run`: «up to date»; registro = 137 filas = archivos |
| Solo cambió el registro | huellas de 88 tablas: la **única** distinta es `schema_migrations` (124 → 137 filas); contadores de tuplas: el único cambio es `schema_migrations` con +13 inserciones y 0 actualizaciones/borrados en cualquier otra tabla; esquema antes/después sin diferencias |

Notas honestas: entre mi captura de la sesión anterior y la de esta hubo cambios en tablas de `auth` (inicios de sesión de cuentas de prueba, no hechos por mí); las tablas de negocio no cambiaron y la línea base «antes» es la captura inmediatamente previa al registro. Mi primer cálculo de contadores salió mal por un error de columnas al pegar los archivos y lo rehice bien; el resultado de arriba es el correcto.

## HTTP e interfaz con sesiones reales (instancia desechable)

**Misma base en todas las capas.** Los servicios de la instancia (GoTrue y PostgREST) sirven siempre la base `postgres`; las pruebas SQL del ensayo de transición habían usado la base `transicion`, que **ningún servicio sirve**. Para que HTTP e interfaz probaran la misma base donde se ejecutó la apertura, la base preparada (copia de QA + borrador v2 + apertura) se intercambia a `postgres` (`ensayo-preparar-http.mjs`), y se verifica antes de cada prueba:

- la configuración de los contenedores de Auth y REST nombra la base `postgres` (solo se lee el nombre; nunca una clave ni una URL completa);
- la app (Vite 5273) sirve `http://127.0.0.1:56321` y no referencia ningún proyecto remoto;
- un **canario** (cuenta y ficha con un identificador único) existe en Auth (se inicia sesión con él), en REST (lo lee el ADMIN), en SQL de `postgres` y en pantalla, y **no existe** en `transicion`;
- toda la red del navegador queda restringida al ensayo; lo único bloqueado son los tipos de letra de Google Fonts.

La apertura se ejecutó aquí en **modo definitivo** (`recompensas_ejecutar_apertura(null, true, true)`: corte tomado dentro del bloqueo, posterior al del ensayo, y activación en la misma transacción).

**18 casos aprobados** (`playwright.ensayo.config.mjs`, 38 s; sesiones reales de ADMINISTRADOR, CAJERA, ASISTENTE y varias CLIENTE; la contraseña de estas cuentas ficticias del ensayo solo existió en el entorno del proceso):

| Qué se comprueba | Cómo |
|---|---|
| Saldos, clasificación, nivel y sellos | por HTTP (RPC) y en pantalla, contra SQL: 250 monedas/VIP/**25 sellos** (> 20, íntegros); 30 monedas/BÁSICO/**−7 sellos**; los sellos negativos no generan «sellos actuales» negativos ni premios; movimientos con «Saldo inicial convertido a monedas» |
| Interfaz | tarjeta, sellos, cupones y movimientos sin NaN/undefined; los −7 se muestran sin romper la pantalla |
| Vinculación posterior | por la función real (`vincular_o_crear_cliente_web`) y por la pantalla («¿Es tu registro?» → «Sí, es mi registro»): 40 monedas y 3 sellos habilitados **una sola vez**; el reintento no abre de nuevo y otra cuenta es rechazada |
| Cupones y canje | canje (con reintento idempotente) → cupón en `mis_cupones` y en pantalla → venta con cupón → anulación: el cupón vuelve a DISPONIBLE y el saldo regresa; la apertura queda intacta |
| Venta y anulación | por HTTP y **por la pantalla de Caja** (CAJERA vende a la clienta con apertura: +10 monedas; anulación desde Historial: vuelve a 250); atención pendiente: el servicio anterior a la apertura no acredita otra vez; anular una venta anterior a la apertura no descuenta nada |
| Restricciones de apertura y reversión | `ejecutar`, `reversible` y `revertir`: **CLIENTE** (cuatro cuentas, una sin ficha), **ASISTENTE** y **CAJERA** rechazadas («Solo el administrador…»); sin sesión rechazada por permisos; las funciones internas no las alcanza ni el ADMIN por HTTP; el ADMIN consulta, pero con el programa activo ni revierte ni vuelve a ejecutar. RLS/GRANT: la CLIENTE no lee las tablas de apertura; nadie escribe los libros ni `activo/corte` por REST; **huella de los libros idéntica antes y después de todos los intentos** |
| Aislamiento | cada CLIENTE solo ve sus movimientos, sellos y cupones |
| Pantallas de personal | la CLIENTE es redirigida desde `/ventas`, `/clientes`, `/porcentajes` e `/inventario` |

Hallazgos y límites:
- **Texto de la interfaz (no se tocó):** el aviso de sellos negativos dice «Se descontó un sello por una venta anulada», pero el −7 de esa clienta viene de la apertura (reclamadas > visitas), no de una anulación. Es una decisión de texto pendiente; no se modificó la interfaz.
- PostgREST corta las listas a 1 000 filas (`max_rows`); la lista de reversibilidad devuelve 1 000 de más de 2 000 aperturas.
- No existe una pantalla de administración de la apertura (es solo SQL/RPC), así que las restricciones de apertura y reversión se prueban por HTTP; en pantalla se prueba que la CLIENTE no llega a las pantallas de personal.
- Un solo navegador (Chromium) y una sola pasada limpia de las 18; no se probó teléfono físico ni lector de pantalla. No se tocó ningún diseño, efecto ni animación de monedas, cupones o niveles: solo se observó la interfaz existente.

## Concurrencia: reversión de apertura frente a venta, canje, activación y otra ejecución

Un rechazo comprobado en secuencia no demuestra seguridad concurrente. `recompensas-concurrencia.ensayo.mjs` lanza **sesiones simultáneas reales** (un `psql` por sesión) y fuerza el entrelazado con un disparador de pausa (solo en la base de ensayo) que detiene una venta o un canje justo antes de escribir en el libro. Invariante: ninguna clienta puede quedar con actividad que dependía de su apertura y **sin** apertura.

| Carrera | Borrador v1 (`e850a36`) | Borrador v2 |
|---|---|---|
| S1 reversión vs **venta** en vuelo (programa activo) | **FALLA**: la reversión borra la apertura y la venta queda sin ella | rechazada («Recompensas está activo»); la venta termina; saldo 15 + 10 |
| S1b reversión vs **canje** en vuelo | **FALLA** igual | rechazada; el canje termina; 60 − 25 |
| S2 reversión en curso vs **activación** | **FALLA**: la activación no espera (95 ms) y entra en medio | la activación espera a la reversión (1 921 ms) y entonces activa |
| S4 **dos reversiones** simultáneas de la misma clienta | **FALLA**: las dos «tienen éxito» (la segunda borra 0 filas) | exactamente una; la otra «La clienta no tiene apertura» |
| S3 apertura **definitiva** + atención nueva + venta en vuelo + segunda ejecución | no existe en v1 | pasa (abajo) |

Cambios de la v2: la reversión exige el programa **apagado**, bloquea la fila de la clienta y toma la configuración `FOR SHARE`; la apertura bloquea la configuración `FOR UPDATE`; modo definitivo con bloqueo de tablas y activación atómica.

**S3 en v2** (apertura 4 839 ms; venta en vuelo 3 116 ms; atención tardía esperó 1 124 ms): la apertura espera a la venta en vuelo y retiene el bloqueo 2 s; la venta termina bien y su atención queda **dentro** de la apertura sin doble cómputo (15 monedas, 0 movimientos `VENTA`); una atención que llega con el bloqueo tomado espera al COMMIT y queda **posterior al corte** y fuera del mapa; una atención anterior que entró mientras la apertura aún esperaba queda dentro; la segunda ejecución simultánea se rechaza; 0 claves repetidas; la atención tardía, cobrada después, acredita normalmente (+5).

**Defecto real encontrado en mi propio borrador v2:** la primera versión del modo definitivo bloqueaba `clientes`, `registro_servicios` y `ventas` en ese orden; una venta en vuelo (que toma primero `ventas`) y la apertura se bloquearon mutuamente y **Postgres canceló la venta** (`deadlock detected`). Se corrigió tomando los bloqueos en el mismo orden que la venta (`ventas`, `registro_servicios`, `clientes`) y se repitió. La salida del fallo está conservada en `evidencia/concurrencia_v2_deadlock_salida.txt`.
Otro error mío, sin consecuencia en el borrador: en la prueba, una subconsulta con `id` sin calificar daba siempre «no está en el mapa»; la corregí (y con ello una aserción anterior que pasaba por la razón equivocada).

Límites: las carreras son entrelazados forzados y repetibles, no una prueba exhaustiva ni de carga; no se probaron muchas ventas simultáneas con la apertura ni cortes de conexión a mitad de la transacción.

## Storage con archivos ficticios

El respaldo de la base solo contiene **metadatos** (`storage.objects`); los archivos viven aparte. Evidencia con datos reales: la copia de QA restaurada trae 380 filas de metadatos y **0 archivos**, y la descarga de uno de esos objetos falla.
`storage.ensayo.spec.mjs` (4 casos, sesiones reales, archivos ficticios: un PNG, un PDF y 200 KB aleatorios):
- Subida por CLIENTE (comprobantes y avatar) y ADMIN (galería, QR): 200; descarga por el dueño y por el ADMIN con la **misma huella SHA-256**; buckets públicos sin sesión; tamaño y tipo en `storage.objects` coinciden.
- Permisos: descarga privada ajena y sin sesión rechazadas; CLIENTE→galería, CAJERA→galería, ASISTENTE→QR, otra CLIENTE→carpeta ajena y sin sesión→comprobantes, todos rechazados y sin dejar objetos.
- **Respaldo base+archivos:** copia de `/mnt/stub` → borrado de los archivos (los metadatos quedan y la descarga falla) → restauración de la copia → los archivos vuelven con la misma huella.
- **Copia de Storage de QA:** restaurada en el ensayo, los 380 archivos quedan presentes y una muestra de 12 se descarga con la huella del manifiesto (aunque la versión de storage-api del ensayo es más nueva).

Error mío, ya corregido: restauré una vez dentro de `/mnt/stub/stub/` (ruta duplicada) y la descarga dio 500.
Límites: no hay límites de tamaño/tipo en los buckets (no existen); no se probaron enlaces firmados ni su expiración; el respaldo de archivos de **producción** no se evaluó.

## Los 17 aportes de QA y la ventana de la transición

- Identificadores, procedencia y tratamiento propuesto (sin borrarlos): [`APORTES-PREEXISTENTES-QA.md`](APORTES-PREEXISTENTES-QA.md).
- Cómo evitar actividad entre el corte, la apertura y la activación (corte nuevo, bloqueo, activación atómica, qué no cubre): [`transicion/PROCEDIMIENTO-VENTANA.md`](transicion/PROCEDIMIENTO-VENTANA.md).

## Estado de QA al terminar

Tras el registro, **88 tablas con conteo y huella iguales** a las de justo después del registro (verificado de nuevo al terminar el segundo lote); `schema_migrations`: 137 filas; ninguna función ni tabla de apertura; Recompensas apagado (`activo = false`); 0 movimientos `APERTURA`. **Tercer lote (autorizado):** se retiraron los 17 aportes TEST (solo cambió `recompensas_apertura_aportes`: 17 → 0; ver `APORTES-PREEXISTENTES-QA.md`). Producción: no consultada.

## Total del ensayo y pendientes

Aprobados en la pasada limpia final: 6 (guarda) + 15 (transición) + 5 (concurrencia v2) + 18 (HTTP, interfaz y Storage con sesiones reales) = **44**. Además, la v1 con las mismas invariantes de concurrencia: 4 fallan (evidencia del defecto). **No** se repitió la suite de QA ni su capa SQL (no hubo cambios de aplicación).

- Sigue **sin autorizar**: ejecutar la apertura en QA, activar Recompensas, borrar los 17 aportes, convertir el borrador en migración y cualquier cosa en producción. Fase 2 **no** está completa.
- La copia es casi toda de pruebas; las cifras reales de producción no se conocen: hay que repetir dry-run y conciliación sobre su copia.
- Decisiones pendientes: texto para clientas en espera y momento de activar. (El texto de sellos negativos se resolvió como QA-052 y los 17 aportes se retiraron: ver abajo.)
- Revisión económica del saldo inicial y del catálogo: pendiente.
- Pendiente de código: fijar las imágenes del ensayo a las versiones de QA. (El caso de `recompensas-fase2.test.mjs` ya limpia su aporte.)
- La instancia desechable sigue levantada. Se destruye con `supabase stop --no-backup --workdir C:/JaiseQA-Ensayo`; los respaldos en `C:/JaiseQA-Backups` no se tocan.

## QA-052 — aviso neutral de sellos negativos (tercer lote)

**Problema:** el aviso decía «Se descontó un sello por una venta anulada» para cualquier saldo negativo, aunque el −7 de una clienta viniera de la apertura (reclamadas > visitas), no de una anulación.
**Corrección** (`src/pages/cliente/recompensas/SeccionSellosReal.jsx`, solo el texto del aviso): «Tienes {cantidad} sellos por recuperar. Cada día con una venta de servicios válida recuperas un sello, hasta volver a 0. Después puedes seguir acumulando. Los premios que ya reclamaste se conservan.», con el **valor absoluto** del saldo y singular/plural («1 sello»). No se tocaron fórmulas, límites, estilos, efectos ni animaciones; el contador («-7 sellos») y el resto de textos quedan igual. El historial de sellos sigue describiendo cada movimiento por su tipo: la fila de una anulación dice «Se descontó un sello por una venta anulada», que es correcto para ese movimiento.
**Pruebas** (`ensayo-ui/sellos-negativos.ensayo.spec.mjs`, instancia desechable, sesiones reales):
1. negativo de la **apertura** (−7): aviso en plural, sin mencionar ventas anuladas;
2. negativo de una **anulación** llevado por el camino real (4 sellos de apertura +1 venta con servicio −5 canje de sellos −1 anulación = **−1**): aviso en singular («1 sello por recuperar»);
3. control: sin saldo negativo no aparece el aviso.
Primero **en rojo** contra el texto antiguo (los casos 1 y 2 fallan) y luego **en verde**: pasa el conjunto completo del ensayo (21 casos Playwright), y `npm run build` y el lint pasan. Evidencia en `C:/JaiseQA-Backups/evidencia/qa-aportes/` (`qa052_rojo.txt`, `qa052_verde_*`).
Límites: probado en la instancia desechable, no en QA ni con la suite completa de QA (sin contraseña de QA); un solo navegador.
