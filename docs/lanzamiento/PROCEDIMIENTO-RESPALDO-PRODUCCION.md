# Procedimiento de respaldo y recuperación de producción (preparado, NO ejecutado)

Estado: **solo procedimiento. No se descargó ni se restauró ningún dato real** (ni base ni archivos). Nada de esto se ejecuta sin autorización explícita del propietario, justo antes de aplicar las migraciones (ver `PLAN-PUBLICACION.md` §2). Proyecto: `WedJaiseReact` (`cmkelllerzjqjbsqsylc`).

## 0. Principios

1. **El respaldo real es un dato personal sensible** (usuarios, correos, teléfonos, hashes de contraseña de Auth, comprobantes de pago). Vive **fuera del repositorio**, cifrado, con acceso mínimo, y **nunca** se restaura en QA (`54321`), en el ensayo (`56321`) ni en ningún entorno con interfaz o correo activos.
2. **Dos mundos separados:** (a) *ensayo* = datos **ficticios**, desechable, con guardas que rechazan cualquier otro destino; (b) *respaldo/recuperación* = datos **reales**, privado. Las herramientas del ensayo (`ensayo-destino.mjs`) no pueden apuntar al entorno de recuperación y viceversa.
3. Una credencial de base de datos **no se pega en el chat ni se guarda en el repositorio**; la cadena de conexión la teclea el propietario en su propia terminal (variable de entorno del proceso).
4. Un respaldo sin restauración probada no es una recuperación demostrada (ver §6).

## 1. Qué se respalda

| Elemento | Qué es | Cómo |
|---|---|---|
| **Base de datos completa** | esquemas `public`, `auth`, `storage` (metadatos), `supabase_migrations` y roles/ACL | (1) copia de Supabase (Database → Backups, y PITR si el plan lo da); (2) además `pg_dump -Fc` lógico con la cadena de conexión del propietario |
| **Archivos de Storage** | 9 buckets, 41 objetos, ≈ 3,6 MB al 2026-10-07 (2 privados: `comprobantes-citas-web`, `comprobantes-pedidos-web`; 7 públicos) | Listado por la API de Storage (con la clave de servicio **solo en la terminal del propietario**) y descarga objeto por objeto a una carpeta privada; lista con nombre, tamaño y sha256 |
| **Definiciones que se reemplazarán** | `pg_get_functiondef` de las 14 funciones afectadas más `confirmar_pedido_productos` (esta vez con sus privilegios), políticas `ventas_insert` y `movimientos_insert`, CHECK `ventas_metodo_pago_check`, GRANT de esas funciones, privilegios por omisión del rol `postgres` | consultas de **solo lectura** guardadas como texto (permiten reinstalar sin restaurar toda la base) |
| **Huella previa** | conteo + md5 de columnas de negocio de las 17 tablas (alcance y límites en `RESULTADO-ENSAYO.md` §3) y conteos de `auth.users`, `storage.objects` | consultas de solo lectura |

No se respaldan secretos del proyecto (claves de API, JWT secret) en este paquete: se custodian aparte en el gestor de credenciales del propietario.

## 2. Ejecución (cuando el propietario lo autorice)

Hora UTC y quién ejecuta se anotan en el manifiesto. Con el negocio sin movimiento (sin Caja abierta, sin pedidos web pendientes).

1. **Congelar el contexto:** anotar la hora UTC, `select max(codigo) from ventas`, número de migraciones registradas (59 en producción hoy, no se interpreta como 145) y estado de `recompensas_config` si existiera (no existe antes de la actualización).
2. **Copia de Supabase:** confirmar en el panel que existe una copia reciente (o crear una a pedido); anotar su identificador y fecha.
3. **`pg_dump` lógico:** desde la terminal del propietario, con la cadena de conexión en una variable de entorno del proceso (no en archivos ni en el historial):
   `pg_dump --format=custom --no-owner=false --file <carpeta-privada>/prod_<UTC>.dump "$CONEXION"` — el esquema `auth` y `storage` se incluyen; se anota el código de salida.
4. **Storage:** listar buckets y objetos, descargar a `<carpeta-privada>/storage_<UTC>/<bucket>/<ruta>`, y registrar para cada archivo: bucket, ruta, tamaño, sha256. Comparar **cantidad y suma de tamaños** con la consulta de `storage.objects` (41 objetos / ≈ 3,6 MB al 2026-10-07; si cambió, anotar el nuevo valor).
5. **Definiciones y huella previa:** guardar la salida de las consultas de solo lectura de §1 en `<carpeta-privada>/definiciones_<UTC>.sql` y `huella_<UTC>.json`.
6. **Hash y manifiesto:** calcular sha256 de cada archivo y completar el manifiesto de §3.
7. **Cerrar:** verificar el tamaño del dump (> 0), que `pg_restore --list` lo lee sin error (esto **no restaura**, solo lista el contenido) y que el manifiesto está completo. Si algo falla: **detenerse** y no aplicar migraciones.

## 3. Manifiesto del respaldo (plantilla; se completa al ejecutar, fuera del repositorio)

| Campo | Valor |
|---|---|
| Fecha y hora UTC del respaldo | |
| Persona que lo ejecutó / autorizó | |
| Identificador de la copia de Supabase (panel) | |
| Archivo del dump, tamaño, sha256 | |
| Resultado de `pg_restore --list` (n.º de entradas, error sí/no) | |
| Carpeta de Storage, n.º de objetos, suma de tamaños, archivo de sha256 | |
| Última venta (`codigo`) y n.º de ventas / citas / pedidos / clientes / usuarios | |
| Migraciones registradas (n.º y última versión) | |
| Definiciones previas (archivo y sha256) | |
| Huella previa (archivo y sha256) | |
| Dónde están las copias y quién tiene acceso | |
| Fecha límite de custodia y de borrado | |

El manifiesto **sin valores reales** (esta plantilla) sí puede estar en el repositorio; el manifiesto **completado** no (contiene totales del negocio y rutas privadas).

## 4. Custodia

* **Cifrado en reposo:** contenedor o disco cifrado (BitLocker/VeraCrypt o archivo `.7z`/`age` con clave larga). La clave **no** se guarda junto al respaldo.
* **Dos copias en medios distintos** (p. ej. disco local cifrado + unidad externa cifrada o almacenamiento privado cifrado). Ninguna en una carpeta sincronizada pública ni en el repositorio, ni en el chat/correo.
* **Acceso:** solo el propietario (y quien este designe por escrito). Registro de quién abre el respaldo y cuándo.
* **Integridad:** al copiar o mover, volver a calcular sha256 y comparar con el manifiesto.
* **Retención y borrado:** conservar hasta cerrar la observación posterior a la publicación (24–48 h, `PLAN-PUBLICACION.md` §5) y luego el plazo que decida el propietario; el borrado final es seguro (cifrado destruido + eliminación de las copias). Los datos personales no se conservan más de lo necesario.
* **Nunca:** adjuntarlo a issues, commits, Notion, correo o a una conversación con un asistente; abrirlo en una herramienta en línea.

## 5. Recuperación

| Situación | Camino |
|---|---|
| Falla solo el frontend | publicar de nuevo el anterior; la base queda actualizada (probado 14/14 con el frontend de `main`) |
| Una migración falla | detenerse; las anteriores ya están confirmadas (no hay transacción común); documentar estado parcial; corregir con una migración **nueva**; ver `PLAN-PUBLICACION.md` §6 |
| Hay que volver atrás el backend | (a) restaurar el respaldo (pierde lo posterior a su hora) o (b) reinstalar las definiciones previas guardadas y retirar lo nuevo con una migración correctiva (las tablas/columnas nuevas son aditivas) |
| Datos dañados | detener ventas; comparar con la huella previa; restaurar **en el entorno de recuperación** (nunca sobre producción directamente) para extraer solo lo necesario |

La restauración sobre producción es una acción de máximo riesgo: requiere autorización explícita, el entorno de recuperación ya validado y un plan de qué se pierde.

## 6. Entorno privado de recuperación (PROPUESTA, no creado)

Objetivo: poder **validar una restauración completa** y extraer datos sin exponer datos reales a QA, al ensayo ni a la red.

* **Nombre y aislamiento:** una instancia Supabase Local nueva llamada `JaiseRecuperacion`, con puertos propios (p. ej. API `57321`, DB `57322`, Studio desactivado), distinta de QA (`54321`/`5173`) y del ensayo (`56321`/`5273`/`5274`). Contenedores y volúmenes con prefijo propio.
* **Dónde:** en una máquina o disco **cifrado**, sin sincronización en la nube, con firewall que bloquea el acceso entrante (escucha solo en `127.0.0.1`). Idealmente una cuenta de usuario del sistema distinta o una máquina virtual sin carpeta compartida.
* **Servicios mínimos:** solo Postgres. **Sin** Auth con SMTP, **sin** Storage conectado a internet, **sin** Realtime, **sin** Edge Functions, **sin** frontend apuntando a ella. Así no hay envío de correos a clientas reales ni inicio de sesión posible.
* **Guardas propias (análogas a las del ensayo):** marca `recuperacion_marker.destino = 'JaiseRecuperacion'`, contenedor y puerto fijos; y **las herramientas del ensayo y de QA la rechazan** (la lista cerrada de `ensayo-destino.mjs` no la incluye; no se añadirá). Las suites Playwright no se ejecutan contra ella.
* **Qué se valida allí:** `pg_restore` sin errores (`--exit-on-error`), conteos y huella contra el manifiesto, `pg_restore --list` coherente, lectura de una muestra de Storage contra su sha256, y la **aplicación de las migraciones sobre la copia real** (ensayo con datos reales de verdad), solo en lectura de resultados agregados.
* **Anonimización (opcional, recomendada para un ensayo futuro):** si el propietario quiere un segundo ensayo con datos de forma real, se genera allí una versión anonimizada (nombres, teléfonos, correos, `auth.users`, comprobantes) y **solo esa** puede salir del entorno de recuperación hacia el ensayo.
* **Ciclo de vida:** se crea, se usa y se **destruye** (volúmenes cifrados incluidos) al cerrar la validación; el dump se conserva solo según §4.
* **Estado:** no existe. Su creación y la descarga del respaldo real requieren autorización aparte. Hasta entonces **la restauración completa del respaldo real no está validada**.

## 7. Límites de este documento

* No se ejecutó ninguna descarga ni restauración; los tamaños y conteos citados son los leídos en solo lectura el 2026-10-07.
* No se probó con el plan real de Supabase (¿incluye PITR? lo confirma el panel).
* La mecánica `pg_dump`/`pg_restore` solo se demostró con datos ficticios en el ensayo.
