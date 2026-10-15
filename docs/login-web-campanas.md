# Fotos de campaña del login

## Uso

El administrador entra en **Web → Login Web** (`/login-web`). Puede preparar hasta
ocho fotos JPG, PNG o WebP, reemplazarlas, nombrarlas, reordenarlas y activar o
desactivar cada una. La vista previa usa la misma presentación que el login y
permite revisar ambos temas. **Guardar cambios** publica el borrador completo;
recargar descarta los cambios pendientes. Los visitantes ven la configuración al
volver a abrir el login.

Las fotos nuevas se convierten a WebP (lado máximo 1600 px, hasta 512 KiB) y se
suben mediante el Worker R2 existente al destino editorial `fotos-galeria`. No
se modifica `galeria_web` ni se mezclan sus filas con las del login. Los archivos
en R2 tienen UUID propio y las dos variantes habituales `m` y `g`.

## Activación

La implementación y el SQL están preparados en el repositorio. El usuario informó
el 2026-10-15 que publicó la web y aplicó la migración en Supabase Cloud. Los
procedimientos de abajo sirven también para preparar otros entornos.

1. Revisar y aplicar `supabase/migrations/20261015150644_login_web_fotos.sql`
   en el entorno que se vaya a activar, siguiendo el procedimiento de despliegue
   del proyecto. Crea únicamente `login_web_fotos`, sus permisos y
   `guardar_login_web_fotos(jsonb,jsonb)`; utiliza el `es_admin()` existente.
2. Publicar la aplicación con su configuración R2 existente
   (`VITE_MEDIOS_PROVEEDOR=r2`, API y URL pública configuradas). Esta función no
   necesita cambiar ni publicar de nuevo el Worker ni crear otro bucket.
3. Como administrador, abrir Web → Login Web, guardar una campaña y comprobar
   en una ventana sin sesión que el login muestra solo las imágenes activas y
   respeta el tema elegido en la web.

Si la tabla todavía no existe, el panel muestra un error de carga y bloquea la
edición hasta poder leerla. El login público continúa con las tres fotos incluidas
en el proyecto. También usa ese respaldo si no hay fotos activas o ninguna foto
de campaña se puede cargar. Una lectura lenta no bloquea el formulario de acceso.

## Corrección 2026-10-15: DELETE requires a WHERE clause

El guardado fallaba en Supabase Cloud porque la definición original de
`guardar_login_web_fotos` ejecutaba `DELETE FROM public.login_web_fotos` sin
`WHERE`. El PostgreSQL desechable usado en las pruebas originales no tenía cargado
`safeupdate`, por lo que esas pruebas no detectaron el bloqueo de producción.

Se corrigió **el mismo archivo**
`supabase/migrations/20261015150644_login_web_fotos.sql`, por petición del usuario:

- El DELETE de la función usa `WHERE orden BETWEEN 0 AND 7`. El CHECK de la tabla
  restringe todas las filas a ese rango; se conserva el reemplazo atómico de la
  campaña y no se desactiva `safeupdate`.
- `CREATE TABLE IF NOT EXISTS`, recreación de las cinco políticas conocidas y
  `CREATE OR REPLACE FUNCTION` permiten ejecutar el archivo completo de nuevo
  sobre la versión original, dentro de una transacción y conservando las filas.
- Permanecen la validación de administrador, RLS, `SECURITY INVOKER`, los permisos
  y la comparación de la versión base para evitar sobrescrituras concurrentes.

**Para una base donde ya se ejecutó la versión original:** abrir una consulta
nueva en SQL Editor de ese proyecto Supabase, pegar el contenido completo del
archivo corregido y ejecutarlo. No ejecutar un DELETE aislado ni el fixture de
pruebas. Después, volver al panel y reintentar Guardar cambios. Esta corrección
SQL no necesita otro despliegue de Cloudflare.

**Nota para Claude Code y despliegues por CLI:** modificar un archivo ya aplicado
no hace que `supabase db push` vuelva a ejecutarlo. Esta reparación se entrega
para reaplicación manual en SQL Editor. Si se utiliza un proceso que aplica solo
migraciones pendientes, registrar una migración correctiva nueva siguiendo ese
proceso; no borrar ni falsificar el historial para forzar la repetición.

La corrección queda preparada localmente; no se ha ejecutado contra Supabase Cloud.

## Permisos y guardado

Corrección visual 2026-10-15: se retiró la foto de ejemplo usada como fondo fijo
en `.lgn-fotos` y la variable `--lgn-foto` de las dos vistas. Durante la transición
de opacidad entre fotos de campaña se transparentaba ese fondo y aparecía una
tercera imagen. El fondo ahora utiliza el color del tema; `FotosLogin` mantiene
las imágenes de respaldo únicamente cuando no hay fotos de campaña disponibles.
Aplica al login público y a la vista previa, en ambos temas y tamaños de pantalla.
Este cambio visual requiere publicar la web; no requiere cambios en Supabase.

- `anon` y los clientes autenticados solo leen filas activas. Solo un
  administrador activo puede leer las desactivadas y escribir configuración.
- La publicación se ejecuta en una transacción, con función `SECURITY INVOKER`,
  políticas RLS y permisos explícitos. Una configuración inválida no borra la
  publicación anterior.
- Se compara el borrador original con la configuración actual bajo un bloqueo de
  transacción. Si otra sesión la cambió, se rechaza la sobrescritura y se conserva
  el borrador local para revisión.
- Las subidas confirmadas se reutilizan al reintentar. Si la respuesta del
  guardado se pierde, se relee la tabla para confirmar el resultado. Ante duda no
  se borran los archivos.
- Quitar una foto del borrador la retira de la campaña al guardar. Su archivo no
  se elimina inmediatamente: el recolector existente mantiene la retención y
  consulta también `login_web_fotos`, incluidas las fotos desactivadas. Aplicar la
  migración antes de ejecutar ese recolector; si la tabla no se puede leer, el
  recolector aborta por seguridad.

## Verificación reproducible

```powershell
node scripts/probar-login-web-sql.cjs
node scripts/verificar-fuentes-huerfanos.mjs
node scripts/verificar-cli-huerfanos.mjs
node scripts/verificar-urls-medios.mjs
```

La prueba SQL necesita Docker y la imagen local
`public.ecr.aws/supabase/postgres:17.11.0.002`. Arranca su propio PostgreSQL sin
red, puertos ni volúmenes, carga las funciones reales de roles con usuarios
ficticios, carga la biblioteca real `safeupdate`, comprueba que bloquea el DELETE
sin filtro, reaplica la corrección sobre una campaña existente, prueba RLS,
conflictos y atomicidad y elimina su contenedor al terminar.
No conecta con Supabase Local ni con producción. Las otras pruebas usan dobles
sin red y no escriben ni borran objetos reales.

Se verificó además en navegador local el panel a 360/1280 px con base y R2
simulados y compresión real, los reintentos, la respuesta perdida, conflictos,
pausa, movimiento reducido y respaldo por error de imágenes. La validación del
guardado contra el entorno publicado corresponde realizarla después de reaplicar
el SQL corregido.
