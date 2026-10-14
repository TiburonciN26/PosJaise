# Fase 6 — lista explícita de archivos (separada de Fases 3, 4 y 5)

Estado: implementada y probada en LOCAL; pendiente de revisión de Codex. Sin commit/push. Base `6929c619`. No hay migraciones.

## Modificados por Fase 6 (con la caché y la animación; V3: + PuntosWeb, ContactoWeb, LibroReclamacionesWeb, FidelizacionWeb, ReferidosWeb, RecompensasWeb para la confirmación explícita; `ToastContext.jsx` YA NO se toca)
`src/components/PestanasCacheadas.jsx`, `src/context/PaginaActivaContext.jsx`, `src/hooks/useCerrarConEscape.js`, `src/hooks/useTextoEscritura.js`, `src/components/TarjetaPuntos.jsx`, `src/components/FondoNivel.jsx`, `src/index.css` (solo `.tp-glare` / `.tp-sheen`), `src/pages/cliente/InicioCliente.jsx` (solo `useRevelarAntes`; el resto del archivo es de la Fase 5), `src/hooks/useCuponesAdmin.js` (archivo de Fase 5, + `claveVista`), `src/pages/RecompensasWeb.jsx` (archivo de Fase 5, + protección del almacén).
Pantallas con `useEstadoVista` (solo cambia la línea de cada estado de vista): Ventas, Inventario, Historial, Servicios, Dashboard, MiPanel, Citas, Estadisticas, Auditoria, Clientes, Deudas, Porcentajes, Gastos, Asistentes, Mobiliario, CatalogoWeb, LibroReclamacionesWeb y, de la Fase 5, PedidosWeb, Promociones, ResenasWeb, ReferidosWeb y FidelizacionWeb (estas últimas vía `useCuponesAdmin`).
## Nuevos
`src/lib/estadoVista.js`, `src/lib/bucleAnimacion.js`, `src/lib/formulariosProtegidos.js`, `src/hooks/usePreferenciasMovimiento.js`, `scripts/{medir-fase6,verificar-fase6}.cjs`, informes y evidencia `.codex/*FASE6*`, `.codex/evidencia-fase6/`.
## Mixto
`implementacionesWed.md`: §47 (Fase 4), §48 (Fase 5), §49 (Fase 6).
## Antes de publicar
Las Fases 4 y 5 deben estar incluidas primero (hay archivos tocados por más de una fase: InicioCliente, RecompensasWeb, PedidosWeb, Promociones, ResenasWeb, ReferidosWeb, FidelizacionWeb, useCuponesAdmin). Rollback de Fase 6: ver `ENTREGA-FASE6-SESIONES-LARGAS.md`.
