# Supabase de staging para el preview (pendiente de autorización)

Objetivo: un backend HTTPS accesible desde cualquier dispositivo, con esquema idéntico al de producción y **solo datos y cuentas ficticios**. Hoy la organización tiene `WedJaiseReact` (producción, `cmkelllerzjqjbsqsylc`) y `esmeraldas-salon` (otro proyecto, INACTIVO); ninguno se usa para el preview.

## Qué requiere autorización del usuario (no ejecutado)
1. Crear un proyecto nuevo `pos-jaise-staging` en la organización (puede tener costo según el plan; el usuario lo confirma en el dashboard o al autorizar la creación por MCP).
2. Aplicar las 153 migraciones de `supabase/migrations/` (fuente de verdad), en orden, con `supabase link --project-ref <ref-staging>` + `supabase db push` (contraseña de la base: guardada solo localmente por el usuario/CLI, nunca en el chat ni en el repo). Si falla alguna migración: se corrige en local primero (regla del repo), nunca se depura en producción.
3. Cargar datos ficticios: `supabase/seed.sql` (productos de ejemplo) + cuentas QA creadas en staging (admin/cajera/cliente ficticios, contraseñas aleatorias guardadas localmente).
4. Edge Functions `crear-cargo`/`webhook-pasarela`: NO desplegar en staging por ahora (pagos con tarjeta fuera del alcance del preview; Culqi bloqueado por llaves). El carrito con tarjeta mostrará error controlado.
5. Auth → URL configuration: Site URL y Redirect URLs = `https://pos-jaise-preview.pages.dev` (y `https://*.pos-jaise-preview.pages.dev` si se usan despliegues por rama). Confirmar correo desactivado o SMTP de pruebas; sin proveedores externos.
6. Realtime/Storage: crear los buckets que use la app (`lib/imagenes.js`) vacíos y con las mismas políticas que las migraciones definan.

## Después de tener el staging (lo que sí queda automatizado)
```
# .env.staging.local (ignorado por git; lo crea el usuario con SUS valores)
VITE_SUPABASE_URL=https://<ref-staging>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon/publishable de staging>
node scripts/build-preview-staging.mjs            # compila con base raíz y verifica el artefacto
node scripts/build-preview-staging.mjs --deploy   # sube dist-preview a pos-jaise-preview (rama preview) con tu sesión de wrangler
```
El script rechaza URLs locales, no-HTTPS o del proyecto de producción, claves `service_role`, y verifica que el bundle solo contenga la URL de staging.

## Rollback
- Pages: en el dashboard, borrar el deployment (o el proyecto `pos-jaise-preview`); no hay dominio ni DNS asociados.
- Supabase staging: pausar o eliminar el proyecto `pos-jaise-staging`; producción y GitHub Pages no se tocan.

## Estado (2026-10-09, autorizado por el usuario)
- **Creado:** proyecto `pos-jaise-staging`, ref `tqkdtojnhgykmcbvwdmz`, región sa-east-1, org «Esmeraldas Salon y Spa» (plan free). URL: `https://tqkdtojnhgykmcbvwdmz.supabase.co`. Vacío (sin esquema, sin datos).
- `.env.staging.local` ya tiene URL + anon key (pública).
- **Falta una acción del usuario (secreto, solo local):** el MCP no puede aplicar 153 migraciones (857 KB) de forma razonable ni conoce la contraseña de la BD. En el dashboard del proyecto → Settings → Database: «Reset database password», copiar la *Session pooler connection string* y pegarla en `.env.staging.local` como `STAGING_DB_URL=…` (línea comentada de ejemplo). Luego: `node scripts/aplicar-migraciones-staging.mjs --dry-run` y después sin `--dry-run`; el seed ficticio lo carga Claude por MCP.

## Actualización: staging aprovisionado (2026-10-09)
- 153 migraciones aplicadas con `scripts/aplicar-migraciones-staging.mjs` (dry-run previo limpio): `supabase_migrations.schema_migrations` = 153, 54 tablas en `public`, 0 sin RLS, 110 funciones, 9 buckets de Storage (vacíos).
- Datos ficticios: `supabase/seed.sql` (6 productos, 3 servicios) + 3 cuentas QA desechables (`qa-admin|qa-cajera|qa-cliente@staging.test`) con contraseñas aleatorias solo en `.env.staging.local`. Se crearon por SQL porque `signUp` choca con el límite de correos de confirmación (429). Las contraseñas se generaron y aplicaron en esta sesión: **rotarlas o borrar las cuentas** (`delete from auth.users where email like 'qa-%@staging.test'`) al terminar las pruebas.
- Edge Functions: NO desplegadas en staging (pagos con tarjeta fuera del preview).
- **Pendiente manual (no hay API en el MCP):** Dashboard staging → Authentication → URL Configuration: Site URL `https://pos-jaise-preview.pages.dev`; Redirect URLs `https://pos-jaise-preview.pages.dev/**` y `https://*.pos-jaise-preview.pages.dev/**`. El login por contraseña funciona sin esto; solo afecta enlaces de correo (confirmación/recuperación).
- Verificación del artefacto (`dist-preview`, base raíz, servido local) contra staging: `scripts/verificar-preview-staging.cjs` → `preview-staging.json`: login real por formulario (ADMIN→/ventas, CAJERA→/ventas, CLIENTE→/inicio), 38 rutas por URL directa + recarga, 0 problemas, 0 errores; todo el tráfico a Supabase fue solo al host de staging (nada a local ni a producción).
