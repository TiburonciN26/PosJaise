# Cierre de observaciones de la Fase 7 (respuesta a VERIFICACION-FASE7-SQL-V2.md)

Fecha: 2026-10-12. Solo Supabase Local. Sin commit, push, migraciones remotas, producción ni cambios de hosting. Fase 8 no iniciada. **Estado de la Fase 7: aprobada con observaciones, SOLO para implementación y QA Local** (Codex, V2). No se modificaron las migraciones, el rollback ni `src/`.

## O1 · Mediana de cuatro valores — corregida

`med()` de `scripts/costo-indices-fase7.cjs` devolvía la mediana superior; ahora promedia los dos valores centrales si la cardinalidad es par. Recalculado **en memoria con las mismas ocho muestras, sin repetir el INSERT**: `evidencia-fase7/v2/costo-indices-v2-mediana-corregida.json` (el JSON original `costo-indices-v2.json` se conserva).

| Condición | Valores ordenados (ms) | Mediana habitual | Informada antes (superior) |
| --- | --- | ---: | ---: |
| Sin índices | 352, 409, 472, 512 | **440,5** | 472 |
| Con índices | 590, 623, 698, 925 | **660,5** | 698 |

Cambio de medianas: **+49,94 %**. La **media de los cuatro porcentajes pareados (+62,1 %)** es otro estadístico y sigue correcta; los cuatro pares tienen el mismo signo (+47,9 % a +80,7 %). Donde `ENTREGA-FASE7-CORRECCIONES-V2.md` dice «medianas 472 → 698 ms», léase 440,5 → 660,5 ms. Se rotula como **resultado observado de laboratorio** (4 pares, triggers/FK desactivados, tablas en caché, volumen sintético), no como cota.

## O2 · Estado físico de Local — causa identificada y corregida

Codex midió índices de 7,4 / 5,7 / 31,3 MB (44,3 MB) frente a los 40 / 32 / 237 kB de V1. **Causa:** `medir-fase7`, `verificar-fase7` y `costo-indices-fase7` sembraban el volumen sintético con los índices reales ya presentes; aunque la transacción termina en ROLLBACK, la extensión de páginas de un índice no se deshace, y el índice queda inflado (sin filas de más: los conteos eran correctos). No es corrupción.

- **Scripts corregidos:** la línea base / el `DROP` de los índices va ahora **antes** de la siembra (dentro de la transacción). Comprobado: tras `REINDEX`, una corrida ampliada con siembra deja los índices en **40.960 / 32.768 / 237.568 bytes**, sin crecimiento.
- **Local:** reconstruí con `REINDEX` los tres índices propios `idx_f7_*` (válidos y listos, misma definición). Tamaños actuales: 40.960 / 32.768 / 237.568 bytes (total 311.296), idénticos a V1. No se tocó ninguna otra relación; no se ejecutó VACUUM.
- **Precisión:** `base_intacta` del ensayo de costo compara **conteos de seis tablas, número de índices y marcas de prueba**; no tamaños físicos, ni la definición completa de la base, ni la identidad de todas las filas. Los 2,4 / 2,9 / 8,7 MB de la entrega son tamaños de índices construidos en el escenario sintético, no los de la réplica actual (40 / 32 / 232 kB). Las mediciones del medidor y del verificador de V2 se hicieron con el orden antiguo (siembra con índices presentes); no afecta a sus resultados (planes y contenido), pero el estado físico de Local cambió durante ellas y se restituyó ahora.
- Antes de nuevas comparaciones de rendimiento/espacio conviene registrar los tamaños de los tres índices (consulta a `pg_relation_size`); la línea base compacta es la de arriba.

## O3 · Alcance de la guarda de línea base — acotado

La guarda (`lineaBase` en `scripts/lib/consultas-fase7.cjs`) usa `pedidos_web_select` como política centinela y el prefijo `idx_f7_`; **no compara las doce expresiones originales**. No debe describirse como comprobación completa de las doce políticas: esa garantía la dan el `rollback-fase7.sql` literal y el verificador de metadatos (política a política, 12/12 solo envoltorio, reversión idéntica). Antes de reutilizarla con otros estados de esquema, habría que comparar las doce expresiones; no se ha ampliado en este cierre.

## Registro y límites

Registro de fases (fila 7) y changelog (§50) actualizados con el estado «aprobada con observaciones, solo Local» enlazando `VERIFICACION-FASE7-SQL-V2.md`; `REVISION-FASE7-SQL-V1.md`, `ENTREGA-FASE7-SQL.md` y `ENTREGA-FASE7-CORRECCIONES-V2.md` se conservan como históricos. Siguen vigentes los límites: laboratorio en Local (3.245 productos de la réplica ≠ catálogo real de ~300; escenario ampliado sintético), búsquedas `ilike '%x%'` lineales, otras tablas con políticas no medidas ni modificadas, sin navegador/staging/producción nuevos. Commit/push, migraciones remotas (Fases 4, 5 y 7) y la Fase 8 requieren tu decisión explícita.
