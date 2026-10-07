# Respaldo real de producción — instrucciones para PowerShell (autorización A)

**Solo lectura en producción.** Estos pasos no escriben en la base ni en Storage, no restauran, no aplican migraciones y no tocan Recompensas. Usted ejecuta todo en su terminal; las credenciales las escribe ahí y **nunca** se pegan en el chat. Cualquier fallo **detiene** el proceso (el mensaje empieza por `DETENIDO`); en ese caso no siga y avíseme **solo con el mensaje de error** (sin contraseñas ni claves).

Destino único: `C:\JaiseBackups\Produccion` (una sola copia; no se borra nada sin su autorización). Cada intento crea su propia subcarpeta `corrida_<fecha UTC>`; ninguna se elimina.

## Qué necesita tener a mano

1. **Docker Desktop abierto.** Las herramientas (`pg_dump`, `psql`, `pg_restore` 17.6, la misma versión que producción) corren en un contenedor desechable, así que no instala nada.
2. En el panel de Supabase → su proyecto → botón **Connect** → **Session pooler**: copie **Host**, **Puerto 5432** y **Usuario** (`postgres.cmkelllerzjqjbsqsylc`). **Use el pooler en modo sesión (5432); el modo transacción (6543) no sirve.** La base es `postgres`.
3. La **contraseña de la base de datos** (Configuración → Database; si no la recuerda, puede restablecerla allí — eso cambia la clave de la base, avise antes si no está seguro).
4. La clave **`service_role`** (Configuración → API Keys), solo para el paso 4 (Storage). Se pide oculta y no se guarda.

## Pasos (en una ventana de PowerShell normal)

```powershell
cd C:\WedJaiseReact\docs\lanzamiento\respaldo-real
# Si PowerShell bloquea los scripts, solo en ESTA ventana:
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

| Paso | Comando | Qué hace |
|---|---|---|
| 0 | `.\00-iniciar-sesion.ps1` | Pide host, puerto, usuario y contraseña (oculta). Quedan solo en esta ventana |
| 1 | `.\01-preflight.ps1` | Docker, imagen 17.6, carpeta privada (solo su usuario, fuera del repo y de OneDrive), conexión, permisos de lectura sobre los 4 esquemas, conteos, y `pg_dump --schema-only` de prueba (código 0) |
| 2 | `.\02-respaldo-base.ps1` | `pg_dump` completo (propietarios y privilegios incluidos), código de salida, tamaño, SHA-256, `pg_restore --list` (**no restaura**), conteos de ACL/OWNER |
| 3 | `.\03-respaldo-roles.ps1` | Roles globales con `pg_dumpall --roles-only --no-role-passwords`. Si Supabase lo rechaza se **detiene**; entonces ejecute `.\03b-roles-consulta.ps1` (alternativa de solo lectura aprobada) |
| 4 | `.\04-respaldo-storage.ps1` | Pide la clave `service_role` (oculta), lista y descarga los objetos de los 9 buckets a una carpeta aparte, y cuadra **cantidad y bytes por bucket** con lo que dice la base. SHA-256 de cada archivo |
| 5 | `.\05-definiciones-y-huella.ps1` | Guarda las definiciones previas de las 14 funciones, políticas y CHECK que reemplazarán las migraciones, y la huella previa de 17 tablas (conteo + md5) |
| 6 | `.\06-verificar-y-manifiesto.ps1` | Vuelve a leer y recalcular todos los SHA-256, escribe `manifiesto.json` / `manifiesto.md`, marca los archivos como solo lectura, borra la contraseña de la sesión y crea `metadatos-para-compartir.txt` |

Ejecute los pasos **en orden**, uno por uno, y mire que cada uno termine con `COMPLETO`. Si un paso falla, no ejecute el siguiente; puede repetir el mismo paso (el 4 conserva con otro nombre —nunca borra— una descarga parcial). Para empezar de cero con una corrida nueva, vuelva a ejecutar el paso 1.

## Qué me comparte al terminar

**Solo** el contenido de `metadatos-para-compartir.txt` (está en la carpeta de la corrida). Contiene versiones, códigos de salida, tamaños, conteos, SHA-256 y los 17 conteos+md5 de la huella. **No** contiene host, usuario, contraseñas, claves, rutas de objetos ni valores de filas. Ningún otro archivo de la carpeta se comparte.

## Qué NO hace ni autoriza

No restaura (B sigue pendiente), no aplica migraciones, no publica, no hace merge, no abre ni activa Recompensas, no escribe en producción, no sincroniza ni copia el respaldo a otro lugar, no cifra por su cuenta (usted decidió una sola copia local sin cifrado obligatorio).

## Notas

* La carpeta `C:\JaiseBackups\Produccion` queda accesible solo a su usuario de Windows (`icacls`). Eso es una restricción de acceso, **no cifrado**: el contenido (clientas, ventas, hashes de contraseñas de Auth, comprobantes de pago) sigue en claro en el disco. Considere activar BitLocker en ese disco cuando pueda.
* Mientras dure la sesión, la contraseña vive en la variable `PGPASSWORD` de esa ventana; el paso 6 la elimina. Cierre la ventana al terminar.
* Los scripts se ensayaron de punta a punta contra la instancia **ficticia** del ensayo (no contra producción) y ese ensayo encontró y corrigió tres errores antes de entregarlos (consulta de secuencias, listado recursivo de Storage en buckets vacíos y arreglos JSON en Windows PowerShell 5.1). Lo que **no** se pudo comprobar sin conectarse a producción: la conexión real por el pooler, los permisos reales de `postgres` y si `pg_dumpall` está permitido allí.
