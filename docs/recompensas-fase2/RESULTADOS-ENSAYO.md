# Fase 2 — resultados del ensayo en instancia desechable

**Alcance:** solo la instancia desechable `JaiseEnsayo`. **No se modificó** Supabase Local QA (ver «Estado de QA»), no se tocó producción y no se registró ninguna versión en el `schema_migrations` de QA. La transición histórica **no se ejecutó en QA**.
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

Esto **no** se hizo en QA (no autorizado). El procedimiento queda ensayado y reversible (borrar las 13 filas por `version`, o restaurar la copia).

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
**Pendiente:** la vía de interfaz (Playwright contra una app y Auth/REST del ensayo) está preparada en destinos y guarda pero **no se ejecutó**: este lote probó solo capa SQL. Faltaría un Vite de ensayo con su propio `.env.local`, una configuración de Playwright propia y parametrizar las constantes anteriores sin debilitar las de QA.

## Estado de QA al terminar

88 tablas con conteo y huella iguales a las del inicio; `schema_migrations` sigue en 124 filas (13 sin registrar); ninguna función ni tabla de apertura creada; configuración sin cambios. Producción: no consultada.

## Pendientes y limitaciones

- Nada de esto autoriza actuar sobre QA ni producción: registrar las 13 versiones, ejecutar la apertura y convertir el borrador en migración requieren autorización separada.
- La copia es casi toda de pruebas; las cifras reales de producción no se conocen y habría que repetir dry-run y conciliación sobre su copia.
- Falta decidir/confirmar con el propietario: la regla de sellos negativos (se conservan tal cual; la clienta debe «repagar» con nuevos sellos), el texto para clientas en espera y el momento de activar el programa (la apertura exige Recompensas apagado y se activa después con el mismo corte).
- No se ejecutó la suite completa ni se repitió la capa SQL de QA (cambios solo documentales y de pruebas de ensayo).
- Exposición económica del saldo inicial y del catálogo: sigue pendiente.
- La instancia desechable sigue levantada para revisión. Se destruye con `supabase stop --no-backup --workdir C:\JaiseQA-Ensayo` (elimina contenedores y volúmenes del ensayo; los respaldos en `C:\JaiseQA-Backups` no se tocan). Para repetir el ensayo hace falta `/tmp/qa.dump` dentro del contenedor (se vuelve a copiar desde `C:\JaiseQA-Backups`).
