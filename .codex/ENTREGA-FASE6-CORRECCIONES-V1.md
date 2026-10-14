# Entrega Fase 6 — correcciones de la revisión V1 (F6-01 … F6-04)

Fecha: 2026-10-11. Base `6929c619`, solo local, sin commit/push/migraciones/hosting. Fase 7 no iniciada. Responde a `REVISION-FASE6-SESIONES-LARGAS-V1.md`.

| Hallazgo | Corrección | Regresión (`scripts/verificar-fase6.cjs`) |
| --- | --- | --- |
| F6-01 protección de formularios | Ya no se suelta por el mero `submit`. Cada `<form>` editado se sigue por separado y protege mientras esté en el DOM y su guardado no se haya **confirmado** (el aviso de éxito del proyecto, `mostrarToast(…, 'exito')`, tras enviarlo; evento de módulo en `lib/eventosToast.js`). Error, validación rechazada o guardado en vuelo NO lo sueltan; un diálogo cancelado (formulario fuera del DOM) deja de proteger; enviar uno no suelta a otro de la misma pantalla | Puntos Web real con PATCH simulado: error 500, validación (VIP ≤ Premium, sin petición) y respuesta en vuelo → tras 8 rutas sigue montada con 77; guardado confirmado → se desaloja; Promociones: Nueva promoción → escribir → Cancelar → se desaloja; coexistencia Puntos Web + borrador de Recompensas |
| F6-02 estado de vista de otra identidad | `fijarIdentidadVista(cuenta:rol)` se llama en el render de `PestanasCacheadas`, ANTES de renderizar las pantallas: el almacén se vacía en ese momento (el vaciado en cleanup llegaba tarde) | Cambio **directo** de cuenta (admin → otra admin) y de rol (admin → cajera) con Ventas montada y sin sesión nula (se sustituye la sesión guardada y se dispara el chequeo de visibilidad de Supabase): el filtro nace vacío, solo Ventas montada, la cajera no monta Dashboard; control: misma identidad conserva. **Control negativo:** con `fijarIdentidadVista` comentado el caso FALLA («QA anterior») |
| F6-03 rango personalizado | `personalizado` (desde/hasta) pasa a `useEstadoVista` en Dashboard, Historial, MiPanel, Estadísticas y Auditoría | Dashboard real: mes anterior elegido, desalojo real y regreso: misma etiqueta y **misma consulta** `resumen_dashboard` (desde/hasta). Las otras cuatro pantallas comparten el mismo cambio de una línea; solo Dashboard tiene prueba operativa |
| F6-04 contador de TarjetaPuntos | El conteo/barra usa `crearBucle` (solo con la tarjeta en pantalla y pestaña visible; pausado CONTINÚA hasta el final al volver) y, con movimiento reducido (desde el montaje o activado durante el conteo), salta al valor final y desmonta el bucle | Fuera de pantalla: el número no cambia y al volver termina en el valor final; pestaña oculta simulada: igual; movimiento reducido activado a mitad: salta al final y 0 rAF/s |

Documentación: comentario inicial de `PaginaActivaContext` corregido (caché LRU con pantallas protegidas); rollback reconstruido (abajo).

## Verificación
`verificar-fase6.cjs` **17/17** (11 + 6) con build de producción; regresión de Fase 5 **34/34** (build + servidor de desarrollo, ya cerrados); recorrido de estabilidad repetido (3 ciclos, 27 rutas + Ventas, `despues-v2.json`): 6 pantallas, 2.856 nodos, heap 8,98 → 9,08 MB entre ciclos 2 y 3, ≈2 temporizadores/s, 0 rAF/s en reposo, sin errores. Lint de los archivos nuevos/modificados de la fase: solo la advertencia previa de `ToastContext` (react-refresh); por eso la señal de éxito se movió a `lib/eventosToast.js` y no suma una nueva. No se pudo cubrir el cambio de rol con la pantalla montada más allá de admin → cajera. 0 filas de prueba en la base.

## Límites (sin cambios + precisiones)
- Una confirmación de éxito (`mostrarToast(…, 'exito')`) de cualquier origen, ocurrida después de enviar un formulario, lo suelta; un guardado cuyo único aviso no sea ese toast quedaría protegido hasta que el formulario salga del DOM (retención, no pérdida).
- El mes/rango de las otras cuatro pantallas con `personalizado` no tiene prueba operativa propia.
- Persisten los límites de la entrega original (estado local que no sea filtro/scroll se reinicia al desalojar, tope 6 no validado con usuarios, cifras de laboratorio).

## Rollback exclusivo (reconstruido)
`evidencia-fase6/rollback-archivos-mixtos.md`: `parche-fase6-exclusivos.patch` (25 archivos) y `parche-fase6-mixtos.patch` (diff exacto estado-Fase-5 → actual de 8 archivos; `useRevelarAntes` recuperado solo desde `HEAD`), ambos con `git apply -R --check` correcto, más archivos nuevos a borrar y la §49.

Fase 6 lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario.
