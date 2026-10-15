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

## Activación pendiente

La implementación y el SQL están preparados en el repositorio. No se han aplicado
estos cambios a las bases Supabase existentes ni se ha publicado la web.

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

## Permisos y guardado

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
ficticios, prueba RLS, conflictos y atomicidad y elimina su contenedor al terminar.
No conecta con Supabase Local ni con producción. Las otras pruebas usan dobles
sin red y no escriben ni borran objetos reales.

Se verificó además en navegador local el panel a 360/1280 px con base y R2
simulados y compresión real, los reintentos, la respuesta perdida, conflictos,
pausa, movimiento reducido y respaldo por error de imágenes. La activación real
requiere el paso SQL y el despliegue indicados arriba.
