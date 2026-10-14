# Rollback · Fase 9 V2 (correcciones F9-01…F9-06)

Solo herramientas locales y documentos: no hay migraciones SQL, ni cambios en `src/`, ni recursos remotos. Volver a V1 no toca datos.

## Contenido

- `v1/`: copias exactas de V1 (hashes en `SHA256-v1.txt`, iguales a los de `evidencia-revision-fase9-v1/hashes-paquete.json` para los cinco scripts que revisó Codex). Incluye los documentos de `.codex` y `implementacionesWed.md` previos a V2.
- `SHA256-v2.txt`: hashes de los archivos V2.
- `parche-v1-a-v2.patch`: diff de los archivos **modificados** (lib, CLI, harness, pruebas unitarias, diseño y plan público).

## Volver a V1

1. Desde la raíz del repositorio: `git apply -R .codex/evidencia-fase9-v2/rollback/parche-v1-a-v2.patch`. Ensayado sobre una copia: los seis archivos quedan **idénticos byte a byte** a `v1/`.
2. Borrar los archivos **nuevos** de V2: `scripts/migracion-medios/trabajo-seguro.mjs`, `scripts/migracion-medios/probar-cli.mjs` y `scripts/migracion-medios/pruebas/`.
3. Documentos: borrar `.codex/ENTREGA-FASE9-CORRECCIONES-V2.md` y `.codex/evidencia-fase9-v2/`; restaurar `implementacionesWed.md` y `.codex/FASES-RENDIMIENTO-CLOUDFLARE.md` desde `v1/` (o quitar a mano la sección §54 y devolver la fila 9) y `ENTREGA-FASE9-MEDIOS-Y-CAMBIO-PUBLICO.md` desde `v1/` (V2 solo le añadió una nota de cabecera).
4. Comprobar con `sha256sum` contra `SHA256-v1.txt`.

## Compatibilidad de manifiestos

V2 usa manifiestos versión 2 (identidad completa del Supabase, Worker y lectura fijados) y **rechaza** los de versión 1; V1 no conoce los campos nuevos (`api`, `lectura`, `operacion`). Ninguno de los dos se usó fuera de Local: no hay manifiestos reales que convertir. Volver a V1 implica volver a planificar.

## Fuera del repositorio

- `%TEMP%\sim-f9-v2` (simulación V2) y `%TEMP%\sim-f9-pruebas-cli` (pruebas de la CLI): carpetas propias con marca; se pueden borrar enteras a mano.
- Local: la corrida V2 dejó **21 filas** en `auditoria` (25.944 → 25.965), como las corridas V1. Valores de medios preexistentes (huella `93b565019ca98416a7dca946b1ee89ad`) y 441 objetos de Storage: idénticos al inicio.
