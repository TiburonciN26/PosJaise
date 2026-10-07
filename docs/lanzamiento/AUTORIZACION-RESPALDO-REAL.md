# Alcance para autorizar: respaldo real de producción y entorno privado de recuperación

Estado: **solicitud; nada de esto se ha ejecutado ni se ejecutará sin tu autorización explícita.** Son **dos autorizaciones separadas** (A y B); la B no se concede implícitamente por la A. Procedimiento técnico y su ensayo con datos ficticios: `PROCEDIMIENTO-RESPALDO-PRODUCCION.md`, `RESULTADO-ENSAYO.md` §10.

## 0. Decisiones que necesito de ti antes de pedir la autorización

| # | Decisión | Propuesta |
|---|---|---|
| D1 | **Quién ejecuta** los comandos contra producción | **Tú, en tu propia terminal.** La cadena de conexión y la clave de servicio de Storage nunca pasan por el chat ni por mí. Yo preparo los comandos exactos y reviso solo **metadatos** (códigos de salida, tamaños, conteos, sha256) que me pegues |
| D2 | **Dónde se guarda** el respaldo (carpeta privada) | Una carpeta **fuera** del repositorio y **fuera** de OneDrive/Dropbox/Drive o cualquier carpeta sincronizada, en un volumen cifrado (BitLocker o contenedor VeraCrypt) — ruta a definir por ti |
| D3 | **Cifrado y segunda copia** | Archivo cifrado (`7z` con AES-256 o `age`) con clave larga que **no** se guarda junto al respaldo; segunda copia en un medio distinto (disco externo cifrado) |
| D4 | **Retención** | Hasta cerrar la observación posterior a la publicación (24–48 h) más el plazo que decidas; después borrado seguro (clave destruida + copias eliminadas) |
| D5 | **Máquina del entorno de recuperación (B)** | La misma PC de desarrollo **solo si** su disco está cifrado y no sincroniza esa carpeta; si no, una VM o un disco cifrado aparte. Aquí vive por primera vez un dato personal real fuera de Supabase: es la decisión de mayor riesgo |
| D6 | **Momento** | Con el negocio sin movimiento (sin Caja abierta ni pedidos web pendientes), justo antes de aplicar las migraciones |

## A. Autorización del respaldo real (solo lectura sobre producción)

**Qué se autoriza (y nada más):**

| Paso | Acción en producción | Escribe en producción |
|---|---|---|
| A1 | Consultas de **solo lectura**: versión del servidor, locale/proveedor de la base, extensiones, atributos de roles (sin contraseñas), `max(codigo)` de ventas, conteos de filas de las tablas de negocio, número de migraciones registradas, conteo y suma de tamaños de `storage.objects` | No |
| A2 | **Pre-vuelo**: `pg_dump --schema-only` (esquemas `public`, `auth`, `storage`, `supabase_migrations`) a un archivo temporal; debe terminar con código 0. Sin datos de filas | No |
| A3 | **Volcado completo**: `pg_dump --format=custom` de esos cuatro esquemas, **sin** `--no-owner` ni `--no-acl`, con `pg_dump` 17.x. Contiene datos reales (clientas, ventas, usuarios de Auth con hashes de contraseña) | No (toma un snapshot consistente; bloqueos de solo lectura) |
| A4 | **Roles:** `pg_dumpall --roles-only --no-role-passwords`, o la consulta equivalente de solo lectura si el servidor lo rechaza | No |
| A5 | **Storage, descarga separada:** listar y **descargar** los 41 objetos de los 9 buckets (≈ 3,6 MB; 2 buckets privados con comprobantes de pago) con la clave de servicio en tu terminal | No |
| A6 | **Definiciones previas** de lo que se reemplazará (`pg_get_functiondef` de las 14 funciones afectadas más `confirmar_pedido_productos`, políticas, CHECK y GRANT de esas funciones) y **huella previa** de negocio (17 tablas; alcance en `RESULTADO-ENSAYO.md` §3) | No |
| A7 | **Verificación local** del archivo: `pg_restore --list` (no restaura), sha256 de cada archivo, cuadre de conteos Storage vs `storage.objects`, manifiesto completado | No |
| A8 | Cifrado, segunda copia y registro de custodia (D2–D4) | No |

**Qué NO se autoriza en A:** restaurar el volcado en cualquier lugar (QA, ensayo, la PC, la nube), abrirlo con herramientas distintas de `pg_restore --list`, copiarlo al repositorio, a OneDrive, al chat, a Notion o al correo, ni leer su contenido; aplicar migraciones; cambios de datos, de privilegios o de Storage en producción; usar el respaldo como fuente de datos para pruebas.

**Efecto esperado en producción:** carga de lectura breve (base pequeña: 270 productos, 127 ventas, 69 clientes; unos MB). Una conexión adicional (el plan gratuito limita conexiones: se usa una sola, con el pooler en modo sesión si no hay IPv6). Sin tiempo de inactividad. Salida de red de unos pocos MB.

**Criterios para DETENERSE:** `pg_dump` o `pg_dumpall` con código distinto de cero (salvo la alternativa de solo lectura de A4 aprobada de antemano); `pg_restore --list` con error; conteos de Storage que no cuadren; sha256 que cambie al copiar; cualquier mensaje de permiso denegado sobre un esquema. En cualquiera: no se aplica ninguna migración y se me informa.

**Resultado de A:** respaldo cifrado en dos medios, manifiesto completado (fuera del repositorio), definiciones previas y huella previa. **No** prueba la recuperación: eso es B.

## B. Autorización del entorno privado de recuperación (después de A)

**Qué se autoriza:**

| Paso | Acción | Notas |
|---|---|---|
| B1 | Crear **`JaiseRecuperacion`**: un contenedor **solo de PostgreSQL 17.x** (imagen de Supabase para tener los mismos roles y extensiones), con puerto propio (p. ej. `57322`), escuchando solo en `127.0.0.1`, volumen en el disco cifrado de D5 | Sin Auth/SMTP, sin Storage de red, sin Realtime, sin Edge Functions, sin Studio, sin frontend: no puede enviar correos ni iniciar sesión |
| B2 | Preparar el destino como ensayé con datos ficticios: roles (con la clasificación de errores y la reparación de las 22 pertenencias), base nueva con el **mismo locale/proveedor ICU**, extensiones, entrada `public` omitida | Mismo script, con otra bandera de destino |
| B3 | **Restaurar** el volcado real **solo ahí**, con `pg_restore --exit-on-error` como superusuario del destino | Es el primer momento en que datos personales reales salen del respaldo |
| B4 | **Validar:** huella de propietarios, privilegios y datos igual a la del origen; conteos; muestra de Storage contra su sha256; **aplicar las 23 migraciones sobre la copia real** (ensayo con datos reales de verdad) leyendo solo resultados agregados | Nada de lo que se vea se copia fuera ni al chat; solo agregados |
| B5 | **Destruir** el entorno al cerrar la validación: contenedor, volumen y copias intermedias; registrar la destrucción | La clave y el respaldo cifrado siguen según D4 |

**Guardas del entorno:** marca `recuperacion_marker.destino = 'JaiseRecuperacion'`, contenedor/puerto fijos, y **las herramientas de QA y del ensayo la rechazan** (lista cerrada; no se añadirá). Las suites Playwright, Vite y el servidor del portal **no** se apuntan a ella. No se crean cuentas, no se ejecuta ninguna función de Recompensas, ni apertura ni activación.

**Qué NO se autoriza en B:** exponer el puerto fuera de `127.0.0.1`, conectar Auth/Storage/Realtime/frontend, copiar datos reales a QA o al ensayo, anonimizar para sacar datos del entorno (sería otra autorización), restaurar sobre producción, cambios en producción.

**Criterios para DETENERSE:** cualquier error de `pg_restore`; cualquier diferencia de huella; cualquier error inesperado al preparar roles; el entorno escucha en una interfaz distinta de `127.0.0.1`; la ruta del volumen resulta estar sincronizada.

**Resultado de B:** primera **validación real** de que el respaldo restaura con propietarios, privilegios y datos íntegros, y de que las 23 migraciones aplican sobre una copia de verdad. Es la condición para considerar la recuperación demostrada.

## C. Lo que sigue fuera de ambas autorizaciones

Aplicar las 23 migraciones en producción, el merge/publicación del frontend, los costos y protecciones, la apertura ×5 y la activación de Recompensas: cada uno requiere su propia autorización posterior (`PLAN-PUBLICACION.md` §7).

## D. Qué necesito que respondas

1. D1–D6 (o «usa las propuestas»).
2. ¿Autorizas **A** (sí/no)? ¿Y **B** (sí/no), o solo después de ver el resultado de A?
3. Si autorizas A: confirma que **tú** ejecutas los comandos en tu terminal y me pegas solo códigos de salida, tamaños, conteos y sha256.
