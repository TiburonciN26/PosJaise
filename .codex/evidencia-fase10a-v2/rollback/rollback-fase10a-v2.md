# Rollback · Fase 10A V2

La V2 solo cambia **herramientas de QA** de `scripts/fase10a/` y documentos. No toca el producto (`src/`), las migraciones, la configuración (`.oxlintrc.json`), los datos ni nada remoto. El rollback de la V1, que incluye las dos reglas CSS, sigue en `evidencia-fase10a/rollback/`.

| Cambio | Archivo | Versión anterior | Cómo revertir |
| --- | --- | --- | --- |
| Preflight y guardas de login (F10A-01), mediana exacta, resúmenes sin redondeo, salida con `completo` | `scripts/fase10a/medir-vitales-10a.cjs` | `v1/medir-vitales-10a.cjs` | Restaurar la copia |
| Preflight y guardas (F10A-01), asistente creada antes de su turno, `exitCode` | `scripts/fase10a/verificar-roles-rutas.cjs` | `v1/verificar-roles-rutas.cjs` | Restaurar la copia |
| Manifiesto de ejecución, completitud y alcance parcial (F10A-02); `exitCode` en lugar de `process.exit()` | `scripts/fase10a/medir-rendimiento-10a.mjs` | `v1/medir-rendimiento-10a.mjs` | Restaurar la copia |
| Pertenencia por componentes y ruta real (F10A-03) | `scripts/fase10a/servir-como-pages.cjs` | `v1/servir-como-pages.cjs` | Restaurar la copia |
| Listas de resultados esperados (sin cambiar límites) | `scripts/fase10a/presupuestos-rendimiento.json` | `v1/presupuestos-rendimiento.json` | Restaurar la copia |
| Dos comprobaciones nuevas en la batería | `scripts/fase10a/bateria-10a.mjs` | `v1/bateria-10a.mjs` | Restaurar la copia |
| Herramientas nuevas | `scripts/fase10a/lib/` (3 archivos), `probar-herramientas-10a.mjs`, `ensayar-compat-deudas.mjs` | — | Borrarlas (las copias V1 no las importan) |
| Propuesta F10A-05 (borrador, **no es migración**) | `.codex/propuesta-f10a-05/` | — | Borrar la carpeta |
| Documentos | `ENTREGA-FASE10A-CORRECCIONES-V2.md`, el plan de staging (V2), los pendientes, la nota de cabecera y la fila de lint de la entrega V1, la fila 10A del registro y §56 de `implementacionesWed.md` | Sin copia previa: los cambios están descritos en la entrega V2 §1.1 y §7 | Editar o restaurar |

## Cómo se obtuvo cada copia de `v1/`

- `bateria-10a.mjs` y `medir-rendimiento-10a.mjs` se **copiaron antes de editarlos**.
- Las otras cuatro se reconstruyeron **invirtiendo exactamente** las ediciones de la V2. `medir-vitales-10a.cjs`, que se reescribió entero, se reconstruyó desde el listado completo de la V1.

Las seis copias coinciden **byte a byte** con los SHA-256 de la V1. Esos SHA-256 están en `evidencia-fase10a/rollback/SHA256-10a.txt` y coinciden con los que registró Codex en `evidencia-revision-fase10a-v1/hashes-iniciales.json`. `SHA256-v2.txt` registra los hashes de la V2 y de las copias.

## Efecto de revertir

Vuelven los cinco defectos de la revisión:
- login sin validar el backend efectivo;
- evaluador que aprueba sin mediciones;
- servidor con escape por prefijo;
- CLS redondeado;
- mediana de un número par de muestras.

`probar-herramientas-10a.mjs` dejaría de existir. Sobre las copias V1, sus casos fallarían, como demuestra su caso de reproducción del servidor V1.
