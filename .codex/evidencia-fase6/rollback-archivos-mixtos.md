# Rollback de Fase 6 (V3 de la entrega; ToastContext ya no se modifica): procedimiento completo y verificable

Orden: (1) revertir los 26 archivos exclusivos de Fase 6, (2) revertir los 8 archivos que mezclan Fases 5 y 6, (3) borrar los archivos nuevos. No usar `git checkout -- src` ni restauraciones globales: el árbol contiene Fases 3, 4 y 5 sin commit.

1. `git apply -R .codex/evidencia-fase6/parche-fase6-exclusivos.patch` (26 archivos: PestanasCacheadas, PaginaActivaContext, useCerrarConEscape, PuntosWeb, ContactoWeb, useTextoEscritura, TarjetaPuntos, FondoNivel, index.css y las 17 pantallas con `useEstadoVista` + `personalizado`). Comprobado con `git apply -R --check`.
2. `git apply -R .codex/evidencia-fase6/parche-fase6-mixtos.patch`. Es un diff EXACTO «estado de Fase 5 → estado actual» de PedidosWeb, Promociones, ResenasWeb, useCuponesAdmin, ReferidosWeb, FidelizacionWeb, RecompensasWeb e InicioCliente, construido invirtiendo solo las ediciones de Fase 6 (para `useRevelarAntes` se recuperó **únicamente esa función** del `HEAD`, conservando las consultas de Inicio de la Fase 5). Comprobado con `git apply -R --check` (el estado reconstruido de cada archivo está en `scratchpad`, no en el repositorio). Aplicarlo ANTES o DESPUÉS del paso 1 es indiferente: tocan archivos distintos.
3. Borrar: `src/lib/{estadoVista,bucleAnimacion,formulariosProtegidos}.js`, `src/hooks/usePreferenciasMovimiento.js`, `scripts/{medir-fase6,verificar-fase6}.cjs`.
4. `implementacionesWed.md`: quitar solo la sección «## 49» (las §47 y §48 son de las Fases 4 y 5).
Sin migraciones ni datos que revertir (las cuentas `qa-f5-*` / `qa-f6-*` son locales y de prueba).
