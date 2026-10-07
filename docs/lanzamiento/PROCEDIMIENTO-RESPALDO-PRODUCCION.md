# Procedimiento de respaldo y recuperación de producción (preparado y ensayado con datos ficticios; NO ejecutado en producción)

Estado: **procedimiento comprobado de punta a punta solo con datos ficticios** en la instancia desechable (`tests/e2e/ensayo-respaldo-procedimiento.mjs`, resultado en `RESULTADO-ENSAYO.md` §10). **No se descargó ni se restauró ningún dato real**, no se conectó a producción para respaldar y no existe todavía el entorno de recuperación. Nada de esto se ejecuta sin autorización explícita del propietario, justo antes de aplicar las migraciones (`PLAN-PUBLICACION.md` §2). Proyecto: `WedJaiseReact` (`cmkelllerzjqjbsqsylc`), **plan gratuito, PostgreSQL 17.6** (consulta de solo lectura).

## 0. Principios

1. **El respaldo real es un dato personal sensible** (usuarios, correos, teléfonos, hashes de contraseña de Auth, comprobantes de pago). Vive **fuera del repositorio**, cifrado, con acceso mínimo, y **nunca** se restaura en QA (`54321`), en el ensayo (`56321`) ni en ningún entorno con interfaz o correo activos.
2. **Dos mundos separados:** (a) *ensayo* = datos **ficticios**, desechable, con guardas; (b) *respaldo/recuperación* = datos **reales**, privado. Las herramientas del ensayo no pueden apuntar al entorno de recuperación y viceversa.
3. La cadena de conexión **no se pega en el chat ni se guarda en el repositorio**: el propietario la pone en una variable de entorno de su propia terminal.
4. **Plan gratuito: no hay copias automáticas del panel que sirvan de base del procedimiento.** El respaldo es **manual y propio**: (1) volcado de la base con `pg_dump`, (2) descarga **separada** de los archivos de Storage, (3) definición de roles. El procedimiento no exige ni cita una copia del panel; si el propietario cuenta con una, es un extra.
5. Un respaldo sin restauración probada no es una recuperación demostrada (§6).

## 1. Qué se respalda (tres paquetes independientes)

| Paquete | Qué contiene | Qué **no** contiene |
|---|---|---|
| **A. Base de datos** (`pg_dump`) | esquemas `public`, `auth`, `storage` (solo metadatos de objetos) y `supabase_migrations`: tablas, datos, funciones, políticas, triggers, **propietarios y privilegios** (GRANT/REVOKE, ACL de columnas, privilegios por omisión de esos esquemas) | **roles y sus contraseñas, pertenencias entre roles, ajustes por rol (`ALTER ROLE … SET`)**; extensiones y esquemas de la plataforma (`extensions`, `vault`, `graphql`, `realtime`…); ajustes de la base (collation/locale, `ALTER DATABASE … SET`); los **archivos** de Storage |
| **B. Storage** (archivos) | los 41 objetos de los 9 buckets (≈ 3,6 MB al 2026-10-07; 2 buckets privados con comprobantes de pago) | — (la base solo guarda sus metadatos) |
| **C. Roles y entorno** | atributos de los roles, pertenencias y ajustes por rol, versión del servidor, extensiones y locale | contraseñas de roles (gestionadas por la plataforma) |

Además se guardan: **definiciones previas** de lo que se reemplazará (14 funciones, `confirmar_pedido_productos` con sus privilegios, políticas `ventas_insert`/`movimientos_insert`, CHECK `ventas_metodo_pago_check`, privilegios de esas funciones) y la **huella previa** (conteo + md5 de columnas de negocio de 17 tablas; alcance en `RESULTADO-ENSAYO.md` §3). No se respaldan secretos del proyecto (JWT secret, claves de API): se custodian aparte.

## 2. Comando de exportación (verificado) y versión

**Versión.** El servidor de producción es PostgreSQL **17.6**. `pg_dump` debe ser de la **misma versión mayor o más nueva** (17.x); uno más viejo se niega a volcar. En el ensayo se usó `pg_dump (PostgreSQL) 17.11` contra un servidor 17.11; la regla vale igual para 17.6 (el script del ensayo aborta si el mayor no coincide). Se comprueba siempre con `pg_dump --version` antes de empezar y se anota en el manifiesto.

**Comando exacto (probado en el ensayo):**

```
pg_dump --format=custom --schema=public --schema=auth --schema=storage --schema=supabase_migrations \
        --file=<carpeta-privada>/prod_<UTC>.dump --dbname="$CONEXION"
```

* **Sin `--no-owner` ni `--no-acl`** (y sin la opción inexistente `--no-owner=false` que figuraba antes). Por omisión `pg_dump` **conserva propietarios y privilegios**: el archivo trae 230 entradas `ACL` y 230 sentencias `OWNER TO` en el ensayo. Contraste medido: restaurar el mismo archivo **con** `--no-owner --no-acl` pierde propietarios y privilegios (cambian 6 de las 9 huellas de esquemas, relaciones, ACL de columnas, funciones, tipos y privilegios por omisión). No se usan en la restauración tampoco.
* **Conexión:** el usuario es `postgres` (**no** es superusuario en Supabase, y es miembro de `pg_read_all_data`); el ensayo exportó con un `postgres` no superusuario, como se hará en producción. La conexión directa (puerto 5432 del host de la base) requiere IPv6; si la red del propietario no lo tiene, usar el **pooler en modo sesión** (puerto 5432 del host del pooler, usuario `postgres.<ref>`). **El modo transacción (puerto 6543) no sirve para `pg_dump`.**
* **No verificado contra producción real** (no se conectó): permisos reales sobre los esquemas, tiempos y el aviso de objetos propiedad de roles de plataforma. Por eso el primer paso con autorización es un **pre-vuelo de solo lectura**: `pg_dump --schema-only` a un archivo temporal para confirmar que el comando termina con código 0 antes de volcar datos (§4 paso 3).

## 3. Roles globales: qué son, de qué depende el respaldo y cómo se prepara el destino

`pg_dump` **no guarda roles** (los roles son globales del clúster, no de la base). El archivo `.dump` solo **hace referencia** a ellos: cada objeto lleva `OWNER TO <rol>` y cada privilegio `GRANT … TO <rol>`. Medido en el ensayo: restaurar el archivo en un clúster vacío sin los roles produjo **455 errores «role … does not exist»** (el primero, `supabase_admin`).

**Dependencias de este respaldo (roles de producción, solo metadatos, sin contraseñas):**

| Rol | Papel | Lo necesita el archivo como… |
|---|---|---|
| `postgres` | propietario de `public` y `supabase_migrations`; miembro de `anon`, `authenticated`, `authenticator`, `service_role`, `supabase_privileged_role`, `pg_read_all_data`… | propietario y otorgante |
| `supabase_admin` (superusuario) | propietario de `auth`, `storage` y de funciones de plataforma | propietario |
| `supabase_auth_admin`, `supabase_storage_admin` | propietarios de tablas de `auth` / `storage` | propietarios |
| `anon`, `authenticated`, `service_role` | roles de la API (privilegios de `public`, `storage`) | **beneficiarios de GRANT** (y miembros de `authenticator`) |
| `dashboard_user` | panel | beneficiario de GRANT en `auth`/`storage` |
| `authenticator` | conexión de PostgREST (hereda `anon`/`authenticated`/`service_role`) | pertenencias |

Los **ajustes por rol** no viajan en el volcado: p. ej. `anon` (`statement_timeout=3s`), `authenticated` (8 s), `authenticator` (`session_preload_libraries`, 8 s) y `postgres` (`search_path`). Las **contraseñas** de los roles de login tampoco (las gestiona la plataforma).

**Cómo se captura:** `pg_dumpall --roles-only --no-role-passwords` (en el ensayo: 16 `CREATE ROLE`, pertenencias y 32 líneas `ALTER ROLE`; sin contraseñas). En Supabase alojado `pg_dumpall` puede negarse sin superusuario: alternativa de **solo lectura** equivalente (ya ejecutada para este documento, sin datos personales): consulta a `pg_roles` + `pg_auth_members` con los atributos, pertenencias y `rolconfig`, guardada como texto en el paquete C.

**Cómo se prepara el destino de recuperación (antes de restaurar):**

1. Servidor **PostgreSQL 17.x** (≥ 17.6). Preferible la imagen de Supabase Local, que ya crea los roles estándar.
2. **Roles:** si el destino no los tiene, crearlos con el `roles.sql` del paquete C (o, en Supabase Local, comprobar que existen y que sus atributos coinciden con la tabla); no se importan contraseñas reales: el destino usa las suyas.
3. **Base nueva** `CREATE DATABASE … TEMPLATE template0` con el **mismo encoding y proveedor de collation que el origen**. Hallazgo del ensayo: el origen usa **ICU `en-US`** y un clúster nuevo usa `libc`; con distinto proveedor los datos son los mismos pero el **orden** de las cadenas cambia (la huella de `storage.migrations` difería hasta crear la base con `LOCALE_PROVIDER icu ICU_LOCALE 'en-US'`).
4. **Extensiones** en los mismos esquemas: `pgcrypto` y `uuid-ossp` en `extensions`; `supabase_vault` en `vault` (si el destino es Supabase; en un clúster vacío no está disponible y el archivo no la requiere). En producción hay además `pg_stat_statements`, que no hace falta para los datos.
5. **Esquema `public`:** la base nueva ya trae `public` con sus privilegios por omisión; el volcado también emite `CREATE SCHEMA public`, así que se **omite esa entrada** con `pg_restore --use-list` (lista de `pg_restore --list` con la línea `SCHEMA - public` comentada). Si en cambio se borra `public` antes de restaurar, se pierde la concesión por omisión a `PUBLIC` y la huella de esquemas difiere (medido).

**Restauración (probada):**

```
pg_restore --exit-on-error --use-list=<lista_sin_public.txt> --dbname=<destino> --username=<superusuario-del-destino> <archivo.dump>
```

como **superusuario del destino** (necesario para asignar propietarios), con `--exit-on-error`. Resultado en el ensayo: **código 0 y cero diferencias** en propietarios, privilegios, políticas, triggers, funciones y datos, tanto en una base con los roles ya creados como en un clúster vacío al que se le aplicó antes `roles.sql` (al aplicar `roles.sql` hubo 24 errores, p. ej. por roles que ya existían como `postgres`; no impidieron la restauración ni alteraron las huellas).

## 4. Ejecución (cuando el propietario lo autorice)

Hora UTC y quién ejecuta se anotan en el manifiesto. Con el negocio sin movimiento (sin Caja abierta, sin pedidos web pendientes).

1. **Congelar el contexto:** hora UTC, `select max(codigo) from ventas`, versión del servidor, versión de `pg_dump`, migraciones registradas (59 en producción hoy, no se interpreta como 145) y locale/proveedor de la base (`select datcollate, datctype, datlocprovider, datlocale from pg_database where datname = current_database()`).
2. **Roles y entorno (paquete C):** `pg_dumpall --roles-only --no-role-passwords` si el servidor lo permite; si no, la consulta de solo lectura de §3. Guardar también la lista de extensiones con sus versiones y esquemas.
3. **Pre-vuelo del volcado:** `pg_dump --schema-only` (mismas opciones de esquema) a un archivo temporal; debe terminar con código 0. Si falla (permisos, conexión), **detenerse** y resolverlo antes de seguir.
4. **Volcado completo (paquete A)** con el comando de §2. Anotar el código de salida, el tamaño y el sha256.
5. **Lectura del archivo (no restaura):** `pg_restore --list <archivo>`: debe terminar sin error y mostrar cabecera (`Dumped from database version`, `Dumped by pg_dump version`, número de entradas), entradas `ACL` y `TABLE DATA`; `pg_restore --schema-only -f - <archivo> | grep -c "OWNER TO"` > 0.
6. **Storage (paquete B), descarga separada:** listar buckets y objetos por la API de Storage (con la clave de servicio **solo en la terminal del propietario**), descargar cada objeto a `<carpeta-privada>/storage_<UTC>/<bucket>/<ruta>` y registrar bucket, ruta, tamaño y sha256. Comparar **cantidad y suma de tamaños** con `storage.objects` (41 objetos / ≈ 3,6 MB al 2026-10-07; si cambió, anotar el nuevo valor). Los 2 buckets privados contienen comprobantes de pago.
7. **Definiciones previas y huella previa:** consultas de solo lectura guardadas como texto/JSON.
8. **Hash y manifiesto:** sha256 de cada archivo y manifiesto (§5). Si algo falla: **detenerse**, no aplicar migraciones.

## 5. Manifiesto del respaldo (plantilla; se completa al ejecutar, fuera del repositorio)

| Campo | Valor |
|---|---|
| Fecha y hora UTC; quién ejecutó / autorizó | |
| Versión del servidor; versión de `pg_dump` y su ruta | |
| Comando exacto usado (sin la cadena de conexión) | |
| Dump: archivo, tamaño, sha256, código de salida | |
| `pg_restore --list`: n.º de entradas, n.º de `ACL`, n.º de `OWNER TO`, error sí/no | |
| Roles: archivo (`roles.sql` o consulta), sha256, n.º de roles | |
| Locale/proveedor de la base; extensiones y esquemas | |
| Storage: carpeta, n.º de objetos, suma de tamaños, archivo de sha256 | |
| Última venta (`codigo`) y n.º de ventas / citas / pedidos / clientes / usuarios | |
| Migraciones registradas (n.º y última versión) | |
| Definiciones previas y huella previa (archivo y sha256) | |
| Copias: dónde, quién accede, fecha límite de custodia y de borrado | |

La plantilla (sin valores) puede estar en el repositorio; el manifiesto **completado** no.

## 6. Custodia

* **Cifrado en reposo** (BitLocker/VeraCrypt, o archivo `.7z`/`age` con clave larga). La clave **no** se guarda junto al respaldo.
* **Dos copias en medios distintos**, ninguna en carpeta sincronizada pública, repositorio, chat, correo o Notion.
* **Acceso:** solo el propietario (o quien designe por escrito); registro de quién abre el respaldo y cuándo.
* **Integridad:** al copiar o mover, recalcular sha256 y comparar con el manifiesto.
* **Retención y borrado:** hasta cerrar la observación posterior a la publicación (24–48 h) y el plazo que decida el propietario; borrado seguro al final (clave destruida + copias eliminadas).

## 7. Recuperación

| Situación | Camino |
|---|---|
| Falla solo el frontend | publicar de nuevo el anterior; la base queda actualizada (probado 14/14 con el frontend de `main`) |
| Una migración falla | detenerse; las anteriores ya están confirmadas (no hay transacción común); documentar estado parcial; corregir con una migración **nueva** |
| Hay que volver atrás el backend | (a) restaurar el respaldo (pierde lo posterior a su hora) o (b) reinstalar las definiciones previas y retirar lo nuevo con una migración correctiva (lo nuevo es aditivo) |
| Datos dañados | detener ventas; comparar con la huella previa; restaurar **en el entorno de recuperación** para extraer solo lo necesario |

Restaurar sobre producción es la acción de mayor riesgo: exige autorización explícita, un entorno de recuperación ya validado y saber qué se pierde. **Auth:** un volcado de `auth` restaura `auth.users` con hashes, pero la plataforma gestiona sus propios roles y secretos; restaurar sobre un proyecto vivo puede dejar sesiones y claves incoherentes, así que se evalúa caso por caso.

## 8. Entorno privado de recuperación (PROPUESTA, no creado)

Objetivo: **validar una restauración completa** y extraer datos sin exponer datos reales a QA, al ensayo ni a la red.

* **Nombre y aislamiento:** instancia nueva `JaiseRecuperacion`, con puertos propios (p. ej. API `57321`, DB `57322`, Studio desactivado), distinta de QA (`54321`/`5173`) y del ensayo (`56321`/`5273`/`5274`); contenedores y volúmenes con prefijo propio.
* **Dónde:** disco o máquina **cifrados**, sin sincronización en la nube, escuchando solo en `127.0.0.1`, con firewall; idealmente una cuenta del sistema aparte o una VM sin carpeta compartida.
* **Servicios mínimos:** solo Postgres 17.x. **Sin** Auth con SMTP, **sin** Storage conectado a internet, **sin** Realtime, **sin** Edge Functions, **sin** frontend: no se envían correos a clientas reales ni se puede iniciar sesión.
* **Preparación del destino:** exactamente §3 (roles, base nueva con el mismo locale/proveedor, extensiones, `public` omitido de la lista).
* **Guardas propias:** marca `recuperacion_marker.destino = 'JaiseRecuperacion'`, contenedor y puerto fijos; las herramientas del ensayo y de QA la **rechazan** (no está en su lista cerrada y no se añadirá). Las suites Playwright no se ejecutan contra ella.
* **Qué se valida allí:** `pg_restore --exit-on-error` sin errores; huella de propietarios/privilegios/datos igual a la del origen (la misma consulta del script del ensayo); lectura de una muestra de Storage contra su sha256; y la **aplicación de las 23 migraciones sobre la copia real**, mirando solo resultados agregados.
* **Anonimización (opcional, para un ensayo futuro):** si se quiere otro ensayo con datos de forma real, se genera allí una versión anonimizada (nombres, teléfonos, correos, `auth.users`, comprobantes) y **solo esa** puede salir hacia el ensayo.
* **Ciclo de vida:** se crea, se usa y se **destruye** (volúmenes cifrados incluidos) al cerrar la validación.
* **Estado:** no existe; crearlo y descargar el respaldo real requieren autorización aparte. Hasta entonces **la restauración completa del respaldo real no está validada**.

## 9. Límites

* Ensayado solo con datos ficticios (124 migraciones + 23 aplicadas; ~855 KB de dump, 1 219 entradas) y con `pg_dump` 17.11; producción es 17.6.
* No se probó la conexión real (IPv6/pooler), los permisos reales de `postgres` en producción ni `pg_dumpall --roles-only` allí.
* No se probó la descarga de Storage (solo se describe); la mecánica de archivos se ensayó en el ensayo con el sistema de archivos de `storage-api`, no con la API de producción.
* Extensiones: `supabase_vault` y la compatibilidad de `auth`/`storage` con un destino que no sea Supabase no se probaron más allá del clúster vacío (que restauró sin errores los cuatro esquemas).
