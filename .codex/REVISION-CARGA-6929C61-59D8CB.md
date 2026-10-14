# Revisión del ensayo de carga 59d8cb sobre 6929c619

Fecha local: 10 de octubre de 2026 (America/Lima); evidencia UTC del 11 de octubre. Claude ejecutó la carga y sus escrituras. Codex auditó la evidencia y realizó lecturas posteriores; no repitió la carga ni ejecutó el recolector.

## Veredicto

**Aceptada la evidencia de 20/20 casos del ensayo acotado de staging sobre build-id 6929c619.** Los límites planificados se respetan en el informe, la retirada B queda acreditada en MIA para las copias calientes de ambas variantes y el estado actual es consistente con la limpieza informada. La auditoría independiente pasa 29/29 controles.

Esta aceptación valida esta corrida, su evidencia y su alcance. No es una prueba de capacidad de producción, una segunda carga presenciada por Codex, una medición de CPU/cuota ni una acreditación global de retirada en todos los POP.

Informe original: [carga-59d8cb.json](C:/WedJaiseReact/.codex/evidencia-carga-6929c61/carga-59d8cb.json). completa=true, estadoFinalConfirmado=true, error=null, parada=null, erroresServidor=0, resumen 20 casos y 0 fallos. El resultado es compatible con código de salida 0 según el CLI; el JSON no registra ese código explícitamente.

## Alcance efectivo

El ensayo creó dos grupos propios de fotos-galeria, A y B, con cuatro PUT 201 y claves m/g. La precondición y el inventario inicial declaran cero claves y ninguna coincidencia de los prefijos previstos. Se revisaron los cuatro nombres completos contra los UUID del informe.

Además de las cuatro subidas hubo dos borrados de grupos: A como parte del ensayo de retirada y B durante la limpieza. La frase cuatro PUT como todo lo escrito debe entenderse como cuatro subidas; hubo también esos DELETE. El código no escribe filas en Supabase: solo autentica una cuenta QA existente, sube/borra medios y lee inventarios y /medios.

La carga es HTTP con fetch de Node; Chromium se usa únicamente para fabricar los dos WebP ficticios de 64/128 px mediante canvas. No son diez usuarios navegando en Chromium ni una carga con imágenes reales de catálogo.

El núcleo ejecuta dos lecturas frías y 300 calientes, repartidas en nueve muestras. El máximo informado de diez simultáneas es coherente con sus diez trabajadores máximos. No se conservan timestamps de inicio/fin por solicitud que permitan reconstruir la concurrencia desde una traza independiente.

## Métricas revisadas

| Concurrencia | Lecturas calientes | p50 ms | p95 ms | p99 ms | Máximo ms | HIT/MISS | POP observados |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 30 | 301 | 332 | 337 | 337 | 30/0 | MIA |
| 5 | 90 | 302 | 323 | 1357 | 1357 | 89/1 | MIA, LIM |
| 10 | 180 | 300 | 323 | 341 | 470 | 180/0 | MIA |

Las primeras dos lecturas son MISS 200 en MIA: m=399 ms y g=362 ms. Los conteos por muestra suman los valores por nivel, los HIT/MISS suman sus n, todos los resúmenes registran cero errores y los máximos de nivel coinciden con los máximos de sus muestras. La copia del resumen dentro del caso de carga es idéntica al bloque carga del informe.

**Límite de auditabilidad de percentiles:** el informe guarda porNivel, porMuestra y las dos lecturas frías, pero no las 302 observaciones individuales. No es posible recalcular los percentiles completos a partir de esos agregados. Codex corroboró coherencia aritmética, no rehizo p50/p95/p99 desde una traza cruda. El núcleo usa el percentil de rango más próximo (ceil), por lo que con 90 lecturas p99 coincide con el máximo registrado.

El pico de 1357 ms en nivel 5 queda como observación sin causa demostrada. Un solo MISS y dos POP en el mismo resumen no prueban que esa petición concreta sea la del pico, ni que el cambio de POP lo cause. Conservar observaciones individuales y tipo/POP por lectura en un futuro ensayo permitiría analizarlo. No hace falta repetir esta corrida solo para obtener ese dato.

El tope de 450 corresponde a las lecturas del núcleo de carga, no a todas las peticiones del ensayo. Hay lecturas adicionales de referencia por HEAD, calentamiento, retirada, control, inventarios y preflight. El informe y el código señalan esta distinción; 302 no equivale al consumo total de solicitudes de Pages/Workers/R2.

## Retirada y control

Codex volvió a evaluar el objeto retirada con la función real de veredicto por POP:

- m y g tienen HIT previo, POP MIA y ETags iguales a sus referencias iniciales.
- Después del DELETE de A hay exactamente seis observaciones: GET, HEAD y condicional por cada variante.
- Las seis devuelven 404 no-store, nosniff y noindex desde MIA; los dos HEAD tienen cuerpo vacío.
- La reevaluación devuelve acreditada y seis veredictos ok. No se trata de un 404 desde un POP frío distinto.
- El código comprueba que el contenido del calentamiento coincida con el subido y aplica If-None-Match con el ETag de referencia. El JSON conserva el veredicto y esas referencias, pero no una traza HTTP cruda completa de cabeceras/payloads.

El control B registra 200 y el código compara sus bytes con el fixture. **Ese control lee solo B/m**, no B/g; la afirmación de borrado selectivo se acepta en ese alcance, sin extenderla a una comprobación pública individual de ambas variantes de B.

El ensayo no espera el TTL de 315 s entre el borrado y las comprobaciones de B. No conserva tiempos por paso para establecer una garantía temporal máxima en milisegundos; acredita el contrato observado en MIA dentro del flujo secuencial.

## Limpieza y corroboración independiente

La limpieza declara confirmada=true, igualAlInicial=true, errores=[] y pendientes=[]; registra un DELETE 200 de limpieza, coherente con B porque A ya se eliminó. La señal final exige también ausencia de grupos en conflicto y todos los casos correctos.

La auditoría independiente comprobó:

- Identidad exacta, veinte casos, precondiciones, cuatro subidas y cuatro claves propias.
- Correspondencia de conteos, muestras, HIT/MISS, máximos, límites, ausencia de parada y resumen duplicado.
- Veredicto de retirada por POP, ETags, seis respuestas y control B.
- Limpieza registrada y ausencia de pendientes.
- Alias actual con 6929c619 y sw.js de hash 2eb8003dc69f00c9e40cb8e576dd01427b4589138474cf5596558ae57bf1b897, igual al deployment c5effd38 revisado.
- Inventario actual estricto de fotos-galeria: 200, lista vacía y sin cursor. No quedan claves de A ni de B.
- Las cuatro URLs propias A/m, A/g, B/m y B/g responden actualmente 404 no-store, nosniff y noindex.
- Operaciones de Codex: solo GET y un login QA existente al Supabase de staging; ninguna subida, borrado, escritura de fila o cambio de configuración.

Los cuatro 404 posteriores no son una nueva prueba de copia caliente: solo corroboran el estado actual. La evidencia de retirada caliente pertenece a la ejecución de Claude auditada. Codex no presenció el snapshot inicial ni la carga y no inspeccionó todas las tablas de la BD para demostrar ausencia de cualquier escritura; la ausencia de escrituras de filas se sustenta en el alcance del código y la evidencia aportada.

## Estado y próximos pasos

HEAD leído: 6929c619e88a91434cb16ee6a8d2de90de94c091. main local: 0dc629e430ed07eeaccec273d31de93e9717d9bf. No hay cambios de archivos versionados. No hubo commit, push o mutaciones remotas por Codex.

El ensayo de carga acotado queda cerrado en staging con las observaciones anteriores. El siguiente ensayo concreto es el harness del recolector ya revisado localmente: dos grupos ficticios propios (cuatro PUT) y una fila ficticia que referencia uno, con su reloj simulado exclusivo, borrado selectivo y limpieza por IDs propios. **Debe recibir su autorización humana separada antes de ejecutarse.** No incluye el recolector habitual, programación periódica, objetos ajenos ni producción.

Siguen pendientes CPU y cuota de B, fotos reales, otros navegadores y móvil, cierre de accesos alternativos r2.dev/deployments antiguos, migración inversa general y criterios de producción. No se tomaron métricas del panel antes/después en esta corrida; los agregados de 24 h no deben atribuirse retrospectivamente solo a ella.

Guardar este veredicto y agrupar la documentación en el siguiente cambio útil; evitar un push exclusivamente para archivar. La aprobación no cierra la Fase 3 completa ni autoriza producción, main o GitHub Pages.

Evidencia nueva: .codex/evidencia-revision-carga-6929c61-59d8cb. El informe original y las fuentes se conservaron con hashes; el auditor se guarda como texto. No se modificó la implementación ni la evidencia de Claude.
