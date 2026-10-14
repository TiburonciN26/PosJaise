# Fase 5 — lista explícita de archivos (separada de Fases 3 y 4)

Estado: **aprobada con observaciones SOLO para implementación y QA local** (`VERIFICACION-FASE5-LISTAS-ADMIN-V3.md`). Sin commit/push; migración sin aplicar fuera de Local. Base `6929c619`.

## Modificados solo por Fase 5 (13) — en `evidencia-fase5/parche-fase5-modificados.patch`
`src/App.jsx`, `src/components/CampoColapsable.jsx`, `src/context/AuthContext.jsx`, `src/context/EstadoNegocioContext.jsx`, `src/pages/{FidelizacionWeb,PedidosWeb,Promociones,RecompensasWeb,ReferidosWeb,ResenasWeb}.jsx`, `src/pages/cliente/{InicioCliente,RecompensasCliente}.jsx`, `src/pages/cliente/recompensas/useRecursosRecompensas.js`.

## Nuevos de Fase 5
`src/hooks/{useListaPaginada,useCuponesAdmin,useLectura}.js`, `src/lib/listasAdmin.js`, `src/components/{PaginadorLista,FiltroEstadoContadores}.jsx`, `supabase/migrations/20261011000002_vistas_listas_admin.sql`, `scripts/{medir-fase5,verificar-fase5}.cjs`, informes y evidencia `.codex/*FASE5*`, `.codex/evidencia-fase5/`.

## Mixto
`implementacionesWed.md`: la §47 es de Fase 4 y la §48 de Fase 5 (texto en `evidencia-fase5/seccion-48-implementacionesWed.md`); al publicar, separar por secciones.

## No son de Fase 5
Fase 4: ver `PAQUETE-FASE4-ARCHIVOS.md` (incluye `20261011000001_catalogo_publico_vitrina.sql`, catálogos, barras, `useCatalogoPublico`, etc.). Fase 3: CLI del recolector y sus pruebas.

## Antes de publicar (si el usuario lo autoriza)
- La migración `20261011000002` va a staging **junto** con la `…001` de Fase 4; sin ella, Reseñas, Referidos y Fidelización fallan con «Reintentar». ACL ya alineada: `normalizar_busqueda` solo `authenticated` (revocado también a `anon`; comprobado 401 sin sesión). Rollback: `drop view` de ambas vistas y luego `drop function public.normalizar_busqueda(text)`.
- Límites Unicode documentados: 8 mayúsculas recientes distintas entre Postgres y Node, diacríticos fuera del BMP no contemplados, `btrim()` vs `.trim()` no probados con espacios Unicode.
- Validar el commit exacto en un checkout limpio antes de cualquier push.
