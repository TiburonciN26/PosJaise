# Verificación y cierre local de Fase 4 — V4

Fecha: 2026-10-11, America/Lima. Base HEAD 6929c619. Implementación local sin commit/push; identidad de fuentes en verificacion.json. Responde a ENTREGA-FASE4-CORRECCIONES-V3.md.

## Veredicto

**FASE 4 APROBADA CON OBSERVACIONES, para la implementación y QA LOCAL. F4-06b cerrado.** No quedan hallazgos bloqueantes abiertos de las revisiones V1–V3 en este alcance. Se mantienen las aceptaciones previas de ventana acotada, deduplicación, recuperación de precios, procedencia de snapshots y caducidad.

Esta aprobación no autoriza publicación, commit/push, migración remota ni cambio de hosting. No acredita todavía el funcionamiento en producción o staging del nuevo frontend y sus cuatro RPC. Fase 5 no iniciada por Codex.

## Qué corrigió Claude y cómo se verificó

leerCategoriasCompletas exige Number.isSafeInteger(count) y count ≥ 0 en cada tramo; fija el total con la primera respuesta y rechaza un cambio posterior. Ya no infiere el total de data.length. La cardinalidad final debe ser exactamente la declarada.

Eso cierra la causa de F4-06b: una respuesta sin conteo no puede convertir un prefijo de 500/1.000 en una colección supuestamente completa. Los errores se propagan a la vitrina y a su botón Reintentar.

| Verificación independiente de esta ronda | Resultado |
| --- | --- |
| verificar-categorias-completas.mjs, SDK real/fetch simulado | **31/31** |
| verificar-catalogo-publico.mjs, Supabase Local, solo lectura | **27/27** |
| Reproducciones independientes del SDK, sin modificar su harness de casos | **7 resultados esperados** |
| Navegador sobre ambas páginas reales, API simulada | **6 resultados esperados** |
| Lint de helper y suite modificados | Sin diagnósticos |
| git apply -R --check del rollback | Correcto, sin aplicar |

El entorno local de datos conserva los 3.245 productos y 3.325 servicios activos observados en las rondas anteriores. Son la réplica, no los aproximadamente 300 productos del negocio indicados por el usuario. Codex solo realizó lecturas.

## Reproducciones de F4-06b cerradas

El mismo harness del SDK de V3, ahora importando el helper corregido, da:

- Conteo válido: 1.001 categorías en tres solicitudes.
- Conteo ausente en primer tramo: rechaza inmediatamente.
- Conteo ausente en segundo tramo: rechaza, sin entregar 1.000 como resultado completo.
- Total desconocido `*`: rechaza el NaN obtenido por el SDK.
- Total malformado `xyz`: rechaza.
- Total negativo `-1`: rechaza.
- Tramo vacío antes del total: rechaza la colección incompleta.

Comparación con conteos-estrictos.json de V3: los cinco casos que antes devolvían indebidamente 500/1.000 ahora lanzan error. No se restauró ni modificó código del proyecto para repetir esa comparación. La suite de 31 también cubre conteo cambiante, colección vacía con cero y recuperación posterior sana.

## Navegador: error y recuperación

Chromium, páginas y componentes reales servidos por Vite en http://localhost:5173. Selección y REST simulados por interceptación; service workers bloqueados; todos los objetos de prueba ficticios.

| Página | Escenario | Resultado |
| --- | --- | --- |
| Productos | Conteo válido, 1.001 | Selector completo; Categoria 1000; 101 ventanas |
| Servicios | Conteo válido, 1.001 | Selector completo; Categoria 1000; 101 ventanas |
| Productos | Conteo ausente en tramo inicial | Error con Reintentar; cero tarjetas y sin selector parcial. Reintento sano: 1.001 y 101 ventanas |
| Productos | Conteo ausente en segundo tramo | Mismo error seguro y recuperación completa |
| Servicios | Conteo ausente en tramo inicial | Mismo error seguro y recuperación completa |
| Servicios | Conteo ausente en segundo tramo | Mismo error seguro y recuperación completa |

Sin pageerror ni mutaciones de BD. Las cuatro recuperaciones tienen aserciones de ausencia de tarjetas/selector durante el error, cardinalidad de 1.001 después y desaparición de la alerta. Los otros dos controles sanos quedaron registrados como observaciones.

## Observaciones que no reabren la corrección

1. La aprobación funcional integra las revisiones anteriores; no es una ejecución de todas las suites en cada ronda. No repetí barras, fotos/sesión, siembra de categorías ni rendimiento porque los cambios son el guardado del conteo y sus dobles. Las cifras de búsqueda permanecen atribuidas a los builds/árboles y muestras anteriores; no son una medición nueva de este cierre.
2. Continúa pendiente la prueba de interfaz de cambio real de cuenta. Los precios usan primera observación del objeto/snapshot, no un reloj del servidor; las filas visibles no caducan por la política declarada. Se aceptaron los ciclos de precio reproducidos, no una garantía global de coherencia bajo cualquier edición concurrente.
3. La paginación y su completitud se verificaron sobre datos estables. Una cardinalidad idéntica no equivale a una transacción/snapshot único entre peticiones; no se afirma equivalencia frente a todas las mutaciones concurrentes del catálogo.
4. Las tareas iniciales de montaje de 250–410 ms señaladas previamente siguen como observación de rendimiento; la búsqueda rápida no las elimina. Las mediciones son laboratorio Vite/CPU 4× con red local, no INP/LCP de producción.
5. El supuesto de ≤ 10 categorías del negocio es una condición, no un conteo auditado. El escenario 300 productos/100 servicios es sintético; no se consultó producción para verificar esas cifras.
6. La comprobación real de RPC fue con anon. No certifica toda combinación de roles ni la compatibilidad del backend real. Las cuatro funciones requieren instalación en el entorno donde se publique este frontend; Codex no aplicó ni aplicará migraciones.
7. El parche inverso pasa --check sin tocar el CLI del recolector. Su validez queda ligada al árbol revisado; tras otros cambios debe comprobarse de nuevo. La lista de nuevos incluye verificar-categorias-completas.mjs según la entrega actual.

## Evidencia nueva

.codex/evidencia-revision-fase4-v4/:

- verificacion.json: alcances, resultados y hashes.
- conteos-estrictos.json: comparación funcional contra los casos de V3.
- interfaz-conteo.json: controles sanos y cuatro recuperaciones en navegador.
- Fuentes de diagnósticos externas como .txt, sin añadir ejecutables al proyecto.

Informes de referencia conservados: REVISION-FASE4-CATALOGOS-V1.md, V2.md y V3.md. No se sobrescriben sus evidencias ni se trasladan sus resultados al presente sin identificar la ronda.

## Próximo paso para Claude y el usuario

Registrar el cierre local en el registro de fases. Preparar una lista explícita de los archivos de Fase 4 y separar los cambios del CLI y scripts de rondas anteriores; esta revisión no aprueba un paquete de publicación aún no presentado.

Si el usuario autoriza posteriormente commit/push, validar el commit exacto en checkout limpio antes del push. Para probarlo en Pages Preview, preparar por separado la migración de sus RPC al backend de staging y validar frontend + esquema en ese entorno, con las autorizaciones externas correspondientes. No apuntar el preview al Supabase del negocio.

Producción, main, GitHub Pages y los pendientes de producción de Fase 3 siguen bajo sus condiciones anteriores. El paso a Fase 5 necesita la indicación del usuario según la guía.
