# Entrega Fase 6 — sesiones largas y animación

Fecha: 2026-10-11. Base `6929c619`, rama `feat/cloudflare-pages`. **Solo local, sin commit/push/migraciones/hosting.** Fase 7 no iniciada. Se conservan las Fases 4 y 5 aprobadas (regresión de la Fase 5 abajo).

## Alcance completado
| Requisito | Resultado |
| --- | --- |
| Limitar pantallas montadas con política explícita | `MAX_PANTALLAS_MONTADAS = 6`, LRU; protegidas (diálogo abierto, `<form>` editado sin enviar, borradores declarados con `useProtegerPantalla`) no se desmontan (tope blando) |
| Conservar carrito, operaciones pendientes, borradores, filtros y scroll | Carrito/venta (`CarritoProvider`, por encima) y avisos de trabajo pendiente intactos; filtros y búsquedas en `useEstadoVista` (38 estados, 20 pantallas + cupones); scroll por pantalla; borradores por protección |
| Pausar animaciones, temporizadores y placeholders ocultos | Causa hallada con trazas: `useTextoEscritura` (≈75–85 `setTimeout`/s con 27 pantallas). Ahora pausa con pantalla oculta, pestaña oculta o movimiento reducido |
| TarjetaPuntos y FondoNivel | `crearBucle` (solo en pantalla y pestaña visible), capas en caché, `transform` en vez de `left`/gradiente por cuadro, movimiento reducido sin flotación/conteo (arrastre y vuelta al reposo funcionan y el bucle duerme), niveles y arrastre intactos |
| Máscara de Inicio | El `requestAnimationFrame` se detiene al converger y despierta con el puntero; también se pausa con la pestaña oculta |
| Invalidar contenido protegido al cambiar cuenta o rol | `key` por cuenta+rol en `PestanasCacheadas` desmonta todas las pantallas y vacía `useEstadoVista` y el scroll |

## Medición antes/después (mismo estado base, build de producción local, réplica de pruebas, 27 rutas + regreso a Ventas, 3 ciclos)
Tabla completa en `evidencia-fase6/tabla-antes-despues.md` (`antes.json`, `despues.json` con series por ruta).

| | Antes | Después |
| --- | --- | --- |
| Pantallas montadas | 27 | 6 |
| Nodos del DOM (ciclos 2 y 3) | 26.392 / 26.392 | 2.856 / 2.856 |
| Máx. nodos en un ciclo | 26.483 | 13.016 |
| Heap JS tras GC (ciclos 2 → 3) | 24,6 → 25,05 MB | 8,97 → 9,08 MB |
| Reposo en Ventas, temporizadores/s | 74 → 84 | 2,2 → 2,5 |
| Reposo, tiempo de tarea ms/s | 12,7–13,8 | 2,0–2,7 |
| Tiempo del recorrido (ciclos 2–3) | 39,6 s / 42,9 s | 40,6 s / 41,0 s (sin diferencia material) |

**Estabilización, no fuga:** el ciclo 1 es de calentamiento (descarga de chunks y datos que llegan después de la medición). Entre los ciclos 2 y 3 los nodos no crecen (±0) y el heap varía +0,45 MB (+1,8 %) antes y +0,11 MB (+1,2 %) después: no se demuestra ninguna fuga ni se afirma una. Sin errores de página.

## Pruebas
- `scripts/verificar-fase6.cjs`: **11/11** (`verificacion-final.json`): tope de 6 en las 27 rutas con regreso a Ventas; carrito, búsqueda y scroll tras desmontar (y scroll exacto con la pantalla montada); protección por diálogo y por formulario editado y recorte al liberarse; invalidación al cambiar de administradora; pausa de placeholders ocultos / pestaña oculta / movimiento reducido; máscara de Inicio dormida-despierta-dormida; TarjetaPuntos y FondoNivel en movimiento normal (flotan, se pausan fuera de pantalla y con la pestaña oculta) y reducido (quietas, arrastre funciona y duerme).
- Regresión de Fase 5: `verificar-fase5.cjs` **34/34** sobre este build (`regresion-fase5.json`). La Fase 4 no se tocó (catálogos del portal sin cambios).
- Un fallo propio hallado por las pruebas y corregido: `useCuponesAdmin` sin `useState` importado (oxlint no marca variables no definidas; lo detectó la medición y se revisó el resto de archivos tocados).
- Limpieza: 0 filas «QA F6/F5» en la base.

## Límites
- Un desmontaje reinicia el estado local que no sea filtro/scroll (listas con «ver más», página de una lista paginada); el scroll se restaura hasta donde llegue el contenido recargado (se probó 400 px tras desmontar y 600 px montada).
- Una pantalla con campos fuera de `<form>` y sin diálogo ni declaración no queda protegida; se cubrieron los formularios y borradores conocidos (Puntos, Referidos, Fidelización, Contacto, Recompensas Web, diálogos).
- El tope 6 es una decisión de ingeniería; no se midió con usuarios reales. Cifras de laboratorio (preview local, sin CPU 4×), no INP/LCP.
- El portal de la clienta no usa esta caché (sus páginas se desmontan al navegar).
- Solo cuentas locales; no se probó cajera/asistente con sesión real.

## Archivos y rollback
Lista: `.codex/PAQUETE-FASE6-ARCHIVOS.md`. Parche de los 24 archivos exclusivos de Fase 6: `evidencia-fase6/parche-fase6-exclusivos.patch` (`git apply -R --check` correcto, no aplicado). Archivos que mezclan Fases 5 y 6 y archivos nuevos: `evidencia-fase6/rollback-archivos-mixtos.md`. Sin migraciones ni cambios de datos.

Fase 6 lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario.
