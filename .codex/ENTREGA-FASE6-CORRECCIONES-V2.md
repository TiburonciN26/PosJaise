# Entrega Fase 6 · correcciones V2 (respuesta a REVISION-FASE6-SESIONES-LARGAS-V2.md)

Fecha: 2026-10-11. Base HEAD `6929c619`, rama `feat/cloudflare-pages`. Todo local, sin commit, push, migraciones ni cambios de hosting. Fase 7 no iniciada. Cierres F6-02/F6-03/F6-04 intactos.

## Qué se corrigió

| Hallazgo | Corrección | Prueba |
| --- | --- | --- |
| **F6-01b** un éxito ajeno libera trabajo no confirmado | Se **elimina** el aviso genérico (`lib/eventosToast.js` borrado; `ToastContext.jsx` vuelve a `HEAD`). La confirmación es explícita y nombra formulario + intento: `lib/formulariosProtegidos.js`. Al enviar, `PestanasCacheadas` solo marca el formulario «enviado» con un número de intento; **no libera nada**. La pantalla que guarda toma `const envio = envioDe(evento.currentTarget)` (sincrónico, antes del `await`) y llama `confirmarGuardado(envio)` solo cuando su guardado salió bien. Seguir editando tras enviar vuelve el formulario a «editado» y la respuesta del intento anterior ya no lo suelta. Un formulario **sin** confirmación cableada se conserva hasta salir del DOM (retención, nunca pérdida). Cableadas las 6 pantallas con formulario que sigue en pantalla tras guardar: Puntos Web, Fidelización Web, Referidos Web, Contacto Web, Libro de Reclamaciones Web (proveedor) y Recompensas Web (config). Los formularios de diálogos se sueltan al cerrarse el diálogo | `F6-01b` (2 casos nuevos, apps reales, PATCH simulado): (a) en los modos error / validación rechazada / en vuelo de Puntos Web, un **éxito real ajeno** (guardar Fidelización Web, toast real) deja Puntos Web montada tras 8 rutas con el borrador 77, mientras Fidelización —que sí confirmó— se suelta; (b) Puntos Web enviado y en vuelo + edición posterior (88) + Referidos Web confirmado + llega el éxito del intento 1: Puntos Web sigue protegida con 88 y Referidos se suelta |
| **F6-05** formularios cancelados retenidos hasta un recorte | El registro ya no usa un `Map` con el `<form>` como clave: `WeakMap` para el estado y `Set<WeakRef>` por ruta, podado en cada edición y en cada evaluación de protección. Un formulario desmontado puede recolectarse aunque la caché nunca llegue a recortarse; sin timers ni sondeos | `F6-05`: 3 de calentamiento + 20 «Nueva promoción → escribir → Cancelar» en una sola pantalla (≤ 6 montadas), GC doble antes de medir: nodos **1.443 → 1.443**, oyentes 246 → 246. **Control negativo**: reteniendo los formularios con un `Set` fuerte el mismo caso falla (nodos 1.761 → 3.881, oyentes 276 → 476), es decir, la prueba detecta la retención que reportó Codex (≈ +2.100 nodos) |

## Resultados (build de producción, Supabase local)

- `verificar-fase6.cjs`: **20/20** (`evidencia-fase6/verificacion-v3.json`; 17 anteriores + 3 nuevos).
- `verificar-fase5.cjs` regresión: **32/32** sobre el build (`regresion-fase5-v3.json`) + los 3 casos F5-01 en servidor de desarrollo con StrictMode (`regresion-fase5-v3-dev.json`), 0 fallos. (Los demás casos de Fase 5 cuentan lecturas y no son válidos con StrictMode; solo se ejecutan sobre el build.)
- `medir-fase6.cjs` 3 ciclos × 27 rutas + regreso a Ventas (`despues-v3.json`, 0 errores de página): pantallas 6; nodos 2.600 → 2.856 → 2.856 (ciclos 1-3); heap 7,79 → 8,98 → 9,09 MB; reposo 0 rAF/s y 0,2–1 temporizadores/s. Sin fuga demostrada (el ciclo 1 es calentamiento). La medición recorre rutas; las cancelaciones repetidas las cubre `F6-05` con GC.
- Lint de los archivos tocados: sin errores ni advertencias nuevas (`ToastContext` ya no se modifica, así que desaparece incluso su advertencia de la fase).
- Filas de prueba en la base: 0. Los valores reales de `config_puntos`, `config_fidelizacion` y `config_referidos` no cambiaron (los PATCH de las pruebas estaban interceptados).

## Rollback

Dos parches con `git apply -R --check` correcto, sin aplicar: `parche-fase6-exclusivos.patch` (**26** archivos; `ToastContext` sale, entran `PuntosWeb` y `ContactoWeb`) y `parche-fase6-mixtos.patch` (8 archivos mixtos Fase 5/6; Referidos, Fidelización y Recompensas Web ahora también incluyen la confirmación). Archivos nuevos a borrar: `src/lib/{estadoVista,bucleAnimacion,formulariosProtegidos}.js`, `src/hooks/usePreferenciasMovimiento.js`, `scripts/{medir-fase6,verificar-fase6}.cjs`, y la sección §49 de `implementacionesWed.md`. Procedimiento: `evidencia-fase6/rollback-archivos-mixtos.md`. No se ejecutó el rollback ni se compiló el árbol revertido.

## Límites (sin cambios salvo los marcados)

- **Cambio:** ya no hay liberación por «cualquier éxito»; el costo es que un guardado correcto cuyo flujo **no** llame `confirmarGuardado` mantiene protegida su pantalla hasta que el formulario salga del DOM (retención, no pérdida). Pantallas con formulario persistente no cableadas quedan así por diseño seguro.
- La comprobación del número de intento solo se distingue de la del estado «editado» en la secuencia enviar → seguir editando → reenviar → llega la respuesta antigua; esa secuencia exacta no tiene caso automatizado propio (el control negativo cubre la retención de F6-05, no el número de intento).
- Estado local que no sea filtro/scroll (p. ej. «ver más», página de una lista) se reinicia al desalojar; el tope 6 no está validado con usuarios reales; las cifras son de laboratorio; F6-03 solo tiene prueba operativa en Dashboard; cambio de rol probado solo admin → cajera.
- Tras un envío en vuelo cuyo `await` termina después de que la persona sale de la ruta, la pantalla sigue protegida hasta que llegue la confirmación o el formulario salga del DOM.

Fase 6 lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario.
