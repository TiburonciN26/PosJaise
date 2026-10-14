# Rollback · Fase 9 V2.1 (corrección F9-03b)

V2.1 añade una **migración SQL** (solo aplicada en Supabase **Local**) y cambia herramientas locales y documentos. No cambia `src/`, ni datos de negocio, ni nada remoto.

## Contenido

- `v2/`: copias exactas de V2 de los archivos modificados (`SHA256-v2.txt`). Los cinco archivos de código y el diseño se reconstruyeron aplicando `evidencia-fase9-v2/rollback/parche-v1-a-v2.patch` a las copias V1 y, en el caso de `probar-cli.mjs`, a partir del contenido escrito en V2. Los seis coinciden con los hashes de `evidencia-fase9-v2/rollback/SHA256-v2.txt`, los mismos que verificó Codex. `implementacionesWed.md` y `FASES-RENDIMIENTO-CLOUDFLARE.md` se copiaron antes de editarlos.
- `SHA256-v2.1.txt`: hashes de V2.1, incluida la migración.
- `parche-v2-a-v2.1.patch`: diff de `lib.mjs`, `medios-migracion.mjs`, `probar-lib.mjs`, `probar-cli.mjs` y el diseño. Su aplicación inversa sobre una copia reprodujo V2 **byte a byte**.
- `rollback-migracion.sql`: elimina las tres funciones de la migración. No toca tablas ni datos.

## Volver a V2

1. **Manifiestos:** no dejar operaciones abiertas con plazo. V2 no conoce la barrera y volvería a cerrarlas con una lectura, que es el defecto F9-03b. Volver a V2 **reabre F9-03b**: las copias son evidencia de reversión, no una recomendación de operar con esa versión.
2. **Código y diseño:** desde la raíz, `git -c core.autocrlf=false apply -R .codex/evidencia-fase9-v2.1/rollback/parche-v2-a-v2.1.patch`. Después, borrar `scripts/migracion-medios/probar-plazo-pg.mjs`.
3. **Base Local:** ejecutar `rollback-migracion.sql` con `docker exec -i supabase_db_WedJaiseReact psql -U postgres -d postgres` y retirar la migración del historial local con `delete from supabase_migrations.schema_migrations where version = '20261012000003';`. Por último, borrar `supabase/migrations/20261012000003_migracion_medios_cambio_con_plazo.sql`. Si solo se borra el archivo, `supabase db reset` dejaría de crear las funciones, pero la base Local actual las conservaría.
4. **Documentos:** borrar `.codex/ENTREGA-FASE9-CORRECCIONES-V2.1.md` y `.codex/evidencia-fase9-v2.1/`. Restaurar desde `v2/` `implementacionesWed.md` y `FASES-RENDIMIENTO-CLOUDFLARE.md`, que conservan sus finales de línea CRLF. Quitar la nota de cabecera V2.1 de `ENTREGA-FASE9-CORRECCIONES-V2.md`.
5. Comprobar con `sha256sum` contra `SHA256-v2.txt`.

## Remoto

Nada que revertir: la migración **no** se aplicó en staging ni en producción. Aplicarla allí exige confirmación explícita del usuario y la revisión de Codex. Su reversión remota sería el mismo `rollback-migracion.sql`.

## Restos en Local

- `auditoria` recibió +8 filas de `probar-plazo-pg.mjs`: el alta, los cambios y la baja de su producto fixture `QA-F9B-…`.
- Recibió además +21 de la simulación V2.1: de 25.965 a 25.994 en total.
- No se borraron. La huella de medios preexistentes y los 441 objetos de Storage quedan como al inicio.
