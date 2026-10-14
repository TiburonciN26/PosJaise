# Revisión Fase 4 — V3

Fecha: 2026-10-11, America/Lima. Base HEAD 6929c619, implementación local sin commit. Responde a ENTREGA-FASE4-CORRECCIONES-V2.md. Identidad de fuentes en verificacion.json.

## Veredicto

**NO APROBADA todavía: queda un único hallazgo bloqueante, F4-06b.** F4-04b y F4-05 quedan cerrados en las reproducciones revisadas. La lectura de categorías también resuelve correctamente 1.001 y 2.500 con conteo válido; aún acepta respuestas parciales como completas cuando ese conteo falta o es inválido.

No reabro las correcciones aceptadas de ventana de tarjetas, duplicación de servicios, primera lectura de precios y rollback. No hubo cambios de código, configuración, Git, migraciones ni datos por Codex. No se ejecutaron siembra ni limpiezas por SQL.

## Repetición independiente

- verificar-categorias-completas.mjs: **16/16**, SDK real con fetch simulado, sin BD. Tamaños 0, 5, 999, 1.000, 1.001 y 2.500, ambas funciones; errores de tramo y composición de vitrina.
- verificar-catalogo-publico.mjs: **27/27**, solo lecturas de Supabase Local en http://127.0.0.1:54321. La RPC real acepta range + conteo; permanecen 3.245 productos y 3.325 servicios activos, cuatro/dieciocho categorías.
- Once observaciones independientes de precios sobre páginas y componentes reales, con selección, REST y reloj simulados en Chromium: las reproducciones anteriores ahora dan el comportamiento requerido.
- Cuatro observaciones de categorías en navegador: dos sanas con 1.001 categorías y dos negativas sin conteo.
- Siete diagnósticos adicionales con SDK real y fetch simulado: completo y tramo vacío se comportan correctamente; cinco respuestas de conteo ausente/inválido se aceptan indebidamente.
- Lint de hook, helper y script nuevo: sin diagnósticos. Parche inverso: git apply -R --check correcto, sin aplicar.

Las observaciones diagnósticas registran resultados, no son una suite cuyo exit 0 signifique aprobación. La fuente de QA vive fuera del proyecto; en .codex se conserva como texto.

## F4-04b cerrado en su reproducción

Producto y Servicio categorizados y seleccionados: vitrina S/ 20 → búsqueda S/ 25 → limpiar → **S/ 25**. La fila antigua conserva su procedencia y no vuelve a imponerse. El caso fuera de vitrina también conserva 25. La deduplicación sigue mostrando un único servicio de S/ 10 cuando aparece en héroe y grupo/listado.

El WeakMap representa primera observación del objeto dentro de la instancia, no hora de servidor ni garantía universal de coherencia. Aceptación limitada al ciclo de snapshots probado; no se atribuye un reloj de lectura real a ese estampado.

## F4-05 cerrado en su reproducción

Caché de Producto a S/ 20; reloj del navegador +61 s; aumentar cantidad y fallar la renovación con 403 o 500: la barra conserva las dos unidades y muestra **Total no disponible · Reintentar**, sin S/ 40 como total vigente. En Servicio, vencer el seleccionado y agregar un conocido produce el mismo estado correcto. En los tres casos existe el botón Reintentar.

La primera lectura fallida sigue recuperándose: al cambiar cantidad, tres productos/S/ 50; en cita, Reintentar permite dos servicios/S/ 30. No se escribieron precios, carritos ni RLS reales.

La política de filas visibles que no caducan sigue siendo una decisión declarada de esta entrega. No se certifica un precio comercial definitivo por estas barras; la validación de operaciones del negocio pertenece al cierre de producción.

## F4-06: paginación sana aceptada, pendiente F4-06b

Con conteo exacto válido, la lectura completa devuelve 1.001 metadatos en tres solicitudes de hasta 500. En Producto y Servicio la barra ofrece **1.001 categorías**, llega a Categoria 1000 y calcula **101 ventanas**. El caso SDK de 2.500 también pasa.

Se completan únicamente metadatos, no todas las tarjetas. La ventana continúa limitada. El fallo de un tramo con error HTTP y un tramo vacío antes de llegar al total son rechazados correctamente.

## F4-06b · P2 · Conteo ausente o inválido permite aceptar una lista parcial

**Ubicación:** src/lib/catalogoPublico.js:118–119:

    if (typeof count === 'number') total = count
    else total = data.length

La longitud de un tramo no acredita el tamaño completo de la colección. Esta rama además reemplaza un total previamente confirmado si falta count en una respuesta posterior. La comprobación final no detecta esa pérdida porque compara con el nuevo total reducido. typeof number tampoco rechaza NaN ni un entero negativo.

**Reproducciones con SDK real, colección ficticia de 1.001 categorías:**

| Respuesta simulada | Resultado actual |
| --- | --- |
| Conteo válido en todos los tramos | 1.001, tres solicitudes: correcto |
| Sin Content-Range en el primer tramo | devuelve **500**, una solicitud, sin error |
| Primer tramo total 1.001; segundo sin conteo | devuelve **1.000**, dos solicitudes, sin error |
| Content-Range con total desconocido `*` | devuelve **500**, sin error |
| Total malformado `xyz` | devuelve **500**, sin error |
| Total negativo `-1` | devuelve **500**, sin error |
| Segundo tramo vacío manteniendo total 1.001 | lanza «Categorías incompletas: 500 de 1001»: correcto |

**Navegador, página real de Productos:** primer conteo omitido → selector con 500 y paginador de 50 ventanas; segundo conteo omitido → selector con 1.000 y paginador de 100 ventanas. En ambos, cero alertas y falta Categoria 1000. Esto es la lista parcial presentada como completa que el contrato pretende impedir.

**Corrección recomendada:** exigir conteo exacto entero, finito y no negativo en cada tramo; rechazar su ausencia/invalidez en vez de sustituirlo por data.length. No reemplazar un total conocido con un supuesto basado en el tramo. Verificar que la cardinalidad recibida sea compatible con el total; ante incertidumbre, la vitrina debe mostrar error con Reintentar.

**Regresiones necesarias:** conteo ausente/total `*` en primera y segunda respuesta; conteos malformados, NaN y negativos; error de vitrina y recuperación; controles sanos de colección vacía y 1.001 completas. Usar el SDK real con fetch simulado como en la suite existente. No hace falta sembrar datos ni modificar las funciones SQL para estos casos.

El escenario de 1.001 categorías es sintético de crecimiento; no describe el negocio, cuyo volumen de unos 300 productos fue indicado por el usuario.

## Evidencia y límites

.codex/evidencia-revision-fase4-v3/:

- diagnosticos-validos.json: once observaciones de precios y cuatro de categorías.
- conteos-estrictos.json: siete reproducciones con SDK real.
- verificacion.json: fuentes, hashes, alcances y resultados.
- Fuentes diagnósticas como .txt.

En la primera ejecución del harness de navegador, los headers simulados de categorías no exponían Content-Range por CORS. Esas cuatro observaciones de categorías fueron invalidadas y reemplazadas por una reejecución con Access-Control-Expose-Headers correcto. Los diagnósticos del SDK real corroboran el defecto sin depender de CORS. Las observaciones de precios no dependían de ese header.

No repetí las mediciones de rendimiento, la interfaz completa de la ronda anterior ni la suite que manipula una cuenta local por SQL: los cambios de esta entrega se concentran en resolver precios y completar metadatos. No reasigno las métricas anteriores a una nueva medición. Revisé el informe de barras 17/17 de Claude, pero no lo presento como ejecución propia ni repetí su mutación del código para el control negativo.

El cambio real de cuenta sigue sin prueba de interfaz. Los snapshots por objeto no equivalen a un versionado global de precios. Producción, hosting definitivo, pagos y todos los roles no quedan aprobados por este análisis local.

## Siguiente paso

Corregir únicamente F4-06b y añadir sus regresiones, conservando las comprobaciones ya aceptadas. El documento de entrega actual **ya incluye** verificar-categorias-completas.mjs en la lista de rollback; no hace falta reiterar esa omisión del mensaje. El parche de los ocho archivos no incluye el CLI anterior y pasa --check.

Después, nueva revisión acotada del conteo estricto. Sigue sin autorización de publicación o migración a producción, y Fase 5 no iniciada.
