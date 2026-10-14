# Rollback · Fase 10A V3

La V3 solo cambia **herramientas de QA** de `scripts/fase10a/`, el borrador y el ensayo de deudas de `.codex/propuesta-f10a-05/`, y documentos. **No toca** el producto (`src/`), las migraciones, la configuración, los datos ni nada remoto. Los rollbacks anteriores siguen vigentes:
- el de la V2, en `evidencia-fase10a-v2/rollback/`;
- el de la V1, con las dos reglas CSS, en `evidencia-fase10a/rollback/`.

| Archivo | Cambio V3 | Versión anterior | Cómo revertir |
| --- | --- | --- | --- |
| `scripts/fase10a/lib/guardas-local-10a.cjs` | Proxy de guarda por contexto (F10A-01b) | `v2/guardas-local-10a.cjs` | Restaurar la copia |
| `scripts/fase10a/lib/evaluar-presupuestos.mjs` | Muestras válidas por métrica y errores de página (F10A-02b) | `v2/evaluar-presupuestos.mjs` | Restaurar la copia |
| `scripts/fase10a/medir-rendimiento-10a.mjs` | Manifiesto formato 3: cierre, `apps`, artefactos y fuentes (F10A-02b) | `v2/medir-rendimiento-10a.mjs` | Restaurar la copia |
| `scripts/fase10a/servir-como-pages.cjs` | Ruta real del índice del fallback (F10A-03b) y encabezado | `v2/servir-como-pages.cjs` | Restaurar la copia |
| `scripts/fase10a/presupuestos-rendimiento.json` | `muestras_min: 3` en tres grupos y la descripción; ningún límite | `v2/presupuestos-rendimiento.json` | Restaurar la copia |
| `scripts/fase10a/probar-herramientas-10a.mjs` | Regresiones V3 | `v2/probar-herramientas-10a.mjs` | Restaurar la copia |
| `scripts/fase10a/ensayar-compat-deudas.mjs` | 25 resultados esperados | `v2/ensayar-compat-deudas.mjs` | Restaurar la copia |
| `.codex/propuesta-f10a-05/compat-deudas-borrador.sql` | Borrador V3 (rechazo del cobro de `main` con abonos) | `v2/compat-deudas-borrador.sql` | Restaurar la copia |
| `.codex/propuesta-f10a-05/ensayo-compat-deudas.sql` | Casos S1d, S2a–S2c, S5b y S5c | `v2/ensayo-compat-deudas.sql` | Restaurar la copia |
| `scripts/fase10a/probar-deuda-main-ui.cjs` | Nuevo | — | Borrarlo |
| Documentos | Entrega V3; plan de staging (V3: §0.1 y criterio 6); pendientes (D11, D12, P19, P29 y P30); viñeta V3 de §56 de `implementacionesWed.md` | Sin copia previa: los cambios están descritos en la entrega V3 | Editar o restaurar |

Las nueve copias de `v2/` se tomaron **antes de editar**. Coinciden byte a byte con los SHA-256 de la V2: compárense `SHA256-v2-copias.txt` y `evidencia-fase10a-v2/rollback/SHA256-v2.txt`. `SHA256-v3.txt` registra los hashes de la V3.

**Efecto de revertir:**
- vuelven F10A-01b, F10A-02b y F10A-03b;
- el borrador vuelve a registrar el saldo inferido de una deuda con abonos.

Los casos V3 de `probar-herramientas-10a.mjs` fallarían sobre las copias, como muestra su reproducción del servidor V2.
