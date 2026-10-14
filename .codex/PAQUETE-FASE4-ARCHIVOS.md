# Paquete de Fase 4 — lista explícita de archivos (NO commiteado)

Fecha: 2026-10-11. Base HEAD `6929c619`. Solo informativo para una futura decisión del usuario; no se ha hecho commit ni push.

## Fase 4 (catálogos escalables)

Modificados (8, cubiertos por `.codex/evidencia-fase4/parche-fase4.patch`; reversión: `git apply -R`):
`implementacionesWed.md` (solo §47), `src/components/BarraCatalogo.jsx`, `BarraTuCarritoFlotante.jsx`, `BarraTuCitaFlotante.jsx`, `TarjetaProductoCliente.jsx`, `TarjetaServicioCliente.jsx`, `src/pages/cliente/ProductosCliente.jsx`, `ServiciosCliente.jsx`.

Nuevos:
- `src/lib/catalogoPublico.js`, `src/hooks/useCatalogoPublico.js`, `src/hooks/usePreciosSeleccion.js`, `src/components/PaginadorCatalogo.jsx`
- `supabase/migrations/20261011000001_catalogo_publico_vitrina.sql` (4 RPC; aplicada solo en local)
- Scripts de QA: `scripts/verificar-catalogo-publico.mjs`, `verificar-catalogos-interfaz.cjs`, `verificar-catalogos-fotos-sesion.cjs`, `verificar-barras-seleccion.cjs`, `verificar-categorias-completas.mjs`, `medir-catalogos-fase4.cjs`, `escenario-catalogo-qa.mjs`
- Evidencia/informes: `.codex/evidencia-fase4/`, `.codex/*FASE4*.md`

## NO son de Fase 4 (rondas anteriores, Fase 3 — commit separado)

`scripts/lib/huerfanos-medios.mjs`, `scripts/medios-huerfanos.mjs` (modificados), `scripts/verificar-cli-huerfanos.mjs`, `scripts/verificar-ml03-bundle.cjs` (nuevos), `docs/evidencia-rendimiento/fase-3/clon-limpio-*.json` y capturas de `fase-1/` sin seguimiento, y los demás informes de `.codex/`.

## Antes de cualquier publicación
Commit exacto validado en checkout limpio; migración de las 4 RPC preparada por separado para STAGING (no el Supabase del negocio); producción solo con confirmación explícita.
