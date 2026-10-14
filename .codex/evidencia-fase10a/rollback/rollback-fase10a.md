# Rollback · Fase 10A

La 10A es sobre todo de verificación. Cambios que tocan el producto: **dos reglas CSS**. Cambios de configuración: **una excepción de lint**. Cambios en herramientas de QA: **dos verificaciones corregidas (Fases 4 y 6)** y **scripts nuevos**. No hay migraciones, ni datos de negocio, ni nada remoto.

| Cambio | Archivo | Versión anterior | Cómo revertir |
| --- | --- | --- | --- |
| Destello del cupón rojo con `transform` en vez de `left` (CLS en Inicio) | `src/index.css` (`@keyframes cupon-sheen`) | `antes/src_index.css` | Restaurar el archivo o devolver el bloque anterior (`left: -45%` → `left: 130%`) |
| `.shiny-text` sin animación con `prefers-reduced-motion: reduce` | `src/index.css` | `antes/src_index.css` (incluye los dos cambios) | Quitar el `@media` añadido tras `.shiny-text.disabled` |
| *(Probado y revertido)* Ventana de restauración del scroll 3 s → 10 s | `src/components/PestanasCacheadas.jsx` | `antes/src_components_PestanasCacheadas.jsx` | **Nada que revertir:** el cambio no corrigió el fallo intermitente y se deshizo; el archivo actual es idéntico a esta copia |
| `react/rules-of-hooks` desactivada solo en `tests/e2e/**/*.mjs` (el `use` de Playwright no es el hook de React) | `.oxlintrc.json` | `antes/oxlintrc.json` | Restaurar el archivo: vuelven los 2 errores de lint |
| Verificación de fotos y sesión de la Fase 4: espera el cambio real de página, hace clic en la tarjeta leída (por `href`), vacía el carrito/cita de la cuenta ficticia antes y después y espera a que la barra termine de calcular el total | `scripts/verificar-catalogos-fotos-sesion.cjs` | `antes/scripts_verificar-catalogos-fotos-sesion.cjs` | Restaurar el archivo. Sin la corrección vuelve la carrera (falla según los datos) y la dependencia del estado previo de la cuenta. |
| Verificación de la Fase 6: espera la petición del remontaje antes de `quieto` al volver a Inventario (carrera) | `scripts/verificar-fase6.cjs` | `antes/scripts_verificar-fase6.cjs` (copiado antes de editar) | Restaurar el archivo: vuelve el fallo intermitente del scroll |
| Comentario de seguridad de la migración de medios (O1 de la Fase 9; sin SQL ejecutable) | `supabase/migrations/20261012000003_migracion_medios_cambio_con_plazo.sql` | `antes/migracion_20261012000003.sql` (SHA-256 `f5dd6bb0…`, idéntico al de V2.1) | Restaurar el archivo |
| Herramientas nuevas | `scripts/fase10a/` (`bateria-10a.mjs`, `verificar-roles-rutas.cjs`, `medir-rendimiento-10a.mjs`, `medir-vitales-10a.cjs`, `presupuestos-rendimiento.json`, `servir-como-pages.cjs`) | — | Borrar la carpeta |
| Documentos | `.codex/ENTREGA-FASE10A-REGRESION-INTEGRADA.md`, `PLAN-VALIDACION-STAGING-FASE10.md`, `PENDIENTES-CONSOLIDADOS-FASE10A.md`, `CIERRE-FASE9-OBSERVACIONES.md`, `.codex/evidencia-fase10a/`; fila 9 y 10A del registro; §55 corregida y §56 de `implementacionesWed.md` | — | Borrar o restaurar |

## Cómo se obtuvo cada versión anterior

Cada archivo de `antes/` se obtuvo **invirtiendo exactamente** las ediciones de la 10A sobre el archivo actual:
- **Migración**: la reconstrucción coincide byte a byte con el hash registrado en `evidencia-fase9-v2.1/rollback/SHA256-v2.1.txt`, el que verificó Codex.
- **`src/index.css`** y **`.oxlintrc.json`**: este se copió antes de editarlo y la CSS se reconstruyó invirtiendo los dos bloques; ambos quedan con el contenido previo a la 10A.
- **`scripts/verificar-catalogos-fotos-sesion.cjs`**: es un archivo sin versionar de la Fase 4 y no tiene un hash previo registrado. Su reconstrucción no puede compararse con una referencia independiente.

`SHA256-10a.txt` registra los hashes actuales y los de `antes/`.

## Efecto de revertir

- **CSS**: con la promoción visible, Inicio vuelve a acumular CLS (0,2–0,4 en laboratorio) por el destello animado con `left`. Con movimiento reducido vuelve una animación infinita.
- **Lint**: vuelven los 2 errores.
- **Verificación**: vuelve a fallar de forma intermitente.

Las cifras de antes y después están en `evidencia-fase10a/rendimiento/` y `cupon-sheen/`.
