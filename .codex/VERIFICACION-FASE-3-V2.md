# Verificación de Fase 3 · segunda revisión de Codex

Fecha: 9 de octubre de 2026, America/Lima (evidencia UTC del 10 de octubre).

**Veredicto: REQUIERE CORRECCIONES. No aprobar todavía la Fase 3 para desplegar y activar el flujo R2.** Las correcciones resuelven los casos originales de validación, subida repetida y errores explícitos de BD. Se reprodujeron cinco hallazgos adicionales: eliminación con referencias cambiantes, retención inválida, respuesta de BD perdida, doble guardado de Servicio y validación WebP con coste cuadrático.

La Fase 2B y el cierre de O1 conservan su aprobación. Esta revisión no altera producción, GitHub Pages, Cloudflare, Supabase ni Git. No se borró la fila residual de staging. Solo se crean este informe y su evidencia, conforme a la autorización del usuario de guardar informes en .codex. Claude implementa las correcciones.

## Resultado de la verificación independiente

| Comprobación | Resultado |
|---|---|
| Unitarias actuales, R2/BD en memoria y fixtures Chromium | 40/40 |
| Worker local, autorización de QA staging, R2 simulado | 33/33 |
| Capa de medios en navegador, REST/Storage simulados | 24/24 |
| Modales reales Producto/Servicio/Galería con simulador REST | 21/21 |
| Total de la suite entregada repetida por Codex | **118/118** |
| Build Vite con R2 y staging, salida fuera del repo | Pasa |
| Lint | 2 errores y 44 advertencias; errores en fixtures.mjs:11 y :27, línea base |
| Parche de rollback, git apply -R --check | Pasa; no aplicado |
| Prueba adicional UI Servicio con subida retenida | Reproduce doble guardado; aislamiento y ausencia de pageerror pasan |
| Casos adicionales de BD, recolector y parser | Reproducen los hallazgos de abajo |

Se usaron las dependencias ya instaladas. Las suites se copiaron a un directorio externo: solo se adaptaron rutas, puertos, lanzadores de binarios, caché de Vite y limpieza para que no escribieran en el proyecto. Los casos de las suites originales se mantuvieron. El primer intento de la suite de medios se detuvo por spawn npx ENOENT en Windows; tras sustituir el lanzador en la copia externa por el binario instalado, los 24 casos pasaron. Esto fue un problema del diagnóstico, no un defecto del producto.

Las tablas de los recorridos de navegador se responden en memoria; las llamadas no simuladas a REST/Storage se bloquean. Staging se usa únicamente para login QA y autorización del Worker. Ningún borrado de los diagnósticos salió a una BD o bucket reales. Los servidores temporales terminaron; no quedaron escuchas en los puertos de estas pruebas.

Árbol revisado: feat/cloudflare-pages, HEAD 940510543f629df11ce80d558399c7ef32bebb68, cambios de Fase 3 sin confirmar. main sigue en 0dc629e430ed07eeaccec273d31de93e9717d9bf. Los hashes de las fuentes revisadas constan en metadatos.json.

## Estado de los hallazgos de la primera revisión

- **F3-01 cerrado para el alcance estructural solicitado.** El archivo de 30 bytes sin imagen se rechaza. WebP opaco, alfa y lossless reales se aceptan y decodifican en Chromium. El límite declarado —no decodificar entropía/píxeles en el Worker— sigue vigente. No se exige añadir un decodificador ilimitado. Aparece un problema nuevo de coste del parser, F3-09.
- **F3-02 cerrado para los casos probados.** Mismos bytes y usuario se recuperan con 200 sin reescribir; contenido o usuario distinto mantienen 409. Los casos de respuesta perdida de ambas variantes y ausencia de borrado tras 409 pasan.
- **F3-03 corregido para los errores explícitos y casos originales.** Se inspeccionan errores y cero filas; la galería informa éxito parcial y limpia la primera foto si falla la segunda. Queda abierto el resultado incierto de BD (F3-07) y el doble guardado de Servicio (F3-08).
- **F3-04 parcial.** Diario y recolector ya existen, y los casos normales pasan. El recolector todavía no cumple la promesa de nunca borrar referencias vigentes y respetar la retención ante parámetros inválidos: F3-05 y F3-06. No programarlo ni ejecutar su modo destructivo hasta corregirlos.

## F3-05 · El recolector puede borrar una foto referenciada durante el lote

**P1 / alta.** Fuentes: scripts/lib/huerfanos-medios.mjs:86 y scripts/medios-huerfanos.mjs:69.

Hay dos defectos relacionados:

1. Se hace una segunda lectura de referencias una sola vez antes del bucle completo, no antes de cada candidato. Reproducción en memoria con dos grupos de 30 días: después de borrar A se guarda una referencia a B. El bucle igualmente elimina B, aunque la fuente de BD ya lo considera referenciado. Resultado: dos lecturas totales, dos eliminaciones, cero omisiones; B tiene referencedAtDeletion=true.
2. La lectura paginada por offset no garantiza una lista completa bajo cambios concurrentes. Se probaron 2.000 filas ordenadas: después de leer las primeras 1.000, se quita la primera fila y se agrega otra al final, manteniendo el total. La segunda página salta una fila que continúa viva. El resultado contiene 2.000 referencias y el conteo coincide, pero falta la referencia de la fila 1.001. La salvaguarda no lanza error. Esto afecta también una relectura final si hay actividad durante ella.

**Corrección recomendada:** diseñar lectura consistente o una condición operativa verificable de exclusión de escrituras; evitar la paginación offset inestable. Revisar cada candidato cerca del borrado y coordinar publicación/reutilización con limpieza mediante cuarentena, bloqueo o comprobación del lado del servidor. Releer por candidato reduce el primer intervalo, pero por sí solo no elimina la carrera entre consulta y DELETE. No anunciar la garantía «nunca referenciado» basándose únicamente en count y una instantánea del lote.

**Aceptación:** el escenario A→referenciar B no borra B; una mutación entre páginas no puede declarar huérfana una referencia viva; fallo o incertidumbre de lectura aborta antes de borrar. Si se adopta ejecución con escrituras detenidas, documentar y hacer cumplir esa precondición. Default informativo se conserva.

## F3-06 · Retención inválida habilita borrados de archivos recientes

**P1 / alta.** Fuentes: scripts/medios-huerfanos.mjs:117–118 y scripts/lib/huerfanos-medios.mjs:32.

La CLI convierte retencion-dias con Number sin validar; clasificar compara edades contra ese resultado. Con NaN, la comparación de «reciente» es falsa. Con -1 también. En ambos casos, una imagen de solo un día pasa a candidato y se elimina en el modo aplicar simulado. Con el control de 14 días no se elimina.

Además, por revisión estática, Boolean(argumentos.aplicar) convierte la cadena «false» en true: --aplicar=false activa el modo destructivo. La presencia literal de la opción puede ser una convención, pero los valores contradictorios deben rechazarse para evitar borrados accidentales.

**Corrección:** validar parámetros antes de autenticar o procesar candidatos, y también en la función reutilizable. Exigir retención finita y válida según la política aprobada; no aceptar NaN, vacío, negativo u opciones contradictorias. Usar flags booleanos explícitos. Mantener 14 días como política publicada, o documentar cualquier reducción autorizada.

**Aceptación:** entradas inválidas abortan sin invocar eliminar; --aplicar=false no borra; sin --aplicar solo informa; parámetros válidos mantienen protección de recientes y fechas desconocidas.

## F3-07 · Respuesta perdida de BD elimina una foto que sí quedó referenciada

**P1 / alta.** Fuente reproducida: src/lib/galeriaFotos.js:61–69. Revisar también el cleanup de errorGuardado en ModalProducto, ModalServicio y ModalGaleriaWeb.

Reproducción con la función original y dependencias en memoria: insert guarda row-1 y su foto_url, pero devuelve error de transporte («Failed to fetch») porque la respuesta no llega. El cliente interpreta que la fila no existe y elimina la foto. La fila confirmada queda apuntando a un archivo borrado. Al reintentar el mismo formulario, se sube otro UUID y se inserta row-2: quedan dos filas para la misma foto, la primera rota.

No es el caso de rechazo explícito 42501 de la suite: un error de transporte no prueba que la transacción se haya revertido. Tampoco lo resuelve la idempotencia del PUT al Worker; el fallo ocurre después, al guardar la referencia en BD. [Contrato de insert de Supabase](https://supabase.com/docs/reference/javascript/insert).

**Corrección:** identificar la operación/fila antes de enviarla y reconciliar el estado ante resultado incierto; reutilizar esa identidad en el reintento. Conservar la imagen mientras no se determine si está referenciada, registrar la operación pendiente y no encolarla para borrado incondicional. Separar rechazo confirmado de resultado de transporte ambiguo. Revisar altas y reemplazos de foto principal y galería con el mismo criterio.

**Aceptación:** pérdida de respuesta después del commit de insert/update produce una sola fila operativa, ninguna referencia rota y reintento seguro. Pérdida de respuesta después de delete se reconcilia sin bloqueo permanente. Un rechazo explícito sigue permitiendo limpiar solo lo confirmado como no referenciado.

## F3-08 · Servicio permite un segundo guardado mientras aún sube la galería

**P2 / media.** Fuente: src/components/ModalServicio.jsx:349; sincronización de galería empieza en :372.

setGuardando(false) se ejecuta después del guardado principal, antes de await sincronizarGaleria. Se comprobó en Chromium con el modal real y una foto nueva, reteniendo temporalmente los PUT al Worker local. Durante la espera, el botón estaba habilitado y todavía había cero filas de galería. Un segundo clic inició otra subida. Al liberar la red quedaron **dos filas, dos UUID y dos eventos onGuardado**.

La suite de 21 casos no introduce esta espera concurrente. ModalProducto mantiene el estado de guardado hasta terminar la sincronización; Servicio debe tener la misma protección.

**Corrección:** mantener la exclusión de guardados durante toda la operación y liberarla al completar o fallar el conjunto. Añadir una guarda de entrada que impida dos envíos concurrentes, incluidos envíos por teclado, sin cambiar las reglas del negocio.

**Aceptación:** con galería lenta, botón bloqueado y segundo submit ignorado; una foto, una fila y un evento de éxito. Tras error parcial se habilita para reintentar únicamente lo pendiente.

## F3-09 · Validación WebP tiene coste cuadrático dentro del límite de tamaño

**P2 / media, rendimiento.** Fuente: cloudflare/medios-worker/src/validar-imagen.js:110.

El filtro exterior de chunks ejecuta otro filtro sobre todos los chunks para cada fragmento de metadatos. No hay límite del número de chunks ni salida temprana al detectar el primer duplicado.

Prueba local de la función original, Node 24.14.1, tres repeticiones por entrada, mediana:

| Chunks EXIF repetidos | Tamaño total | Tiempo del parser |
|---|---|---|
| 1.000 | 8.044 bytes | 13,7 ms |
| 4.000 | 32.044 bytes | 207,9 ms |
| 8.000 | 64.044 bytes | 510,8 ms |

Todos terminan rechazados como chunk-repetido, pero después del trabajo costoso. Son archivos malformados construidos para la prueba; no fotos de catálogo. Se encuentran bajo los topes de tamaño. El endpoint requiere admin: no se afirma ataque público sin autenticar. **Estos valores no son mediciones de CPU de Cloudflare ni prueban un exceso concreto allí**; sí demuestran crecimiento cuadrático evitable en el código que deberá operar con presupuesto reducido.

El README afirma que la validación recorre «unos pocos chunks»; esa condición no está impuesta.

**Corrección:** controlar tipos/repeticiones en una pasada con contador/Set y salida temprana, e imponer límites estructurales coherentes con los WebP que genera el cliente. Mantener aceptación de los fixtures válidos y rechazo de truncados.

**Aceptación:** el payload de 64 KiB se rechaza sin coste cuadrático; medición repetida de crecimiento y luego CPU del Worker real cuando exista. Corregir la afirmación de coste en documentación.

## Límites y siguientes pasos

1. Claude debe corregir F3-05 a F3-09 y añadir los casos de aceptación. Volver a verificar esos casos y la suite existente antes de desplegar/activar R2.
2. Se conserva lo ya aprobado: validación estructural de los casos originales, PUT idempotente y manejo de errores explícitos. No reimplementar funciones ni cambiar el alcance sin necesidad.
3. R2 real, dominio, CORS desde Pages, caché/HIT-MISS y CPU siguen sin verificar. Los tests locales no sustituyen esa prueba.
4. Firefox, Safari/iOS, móvil físico y fotos representativas del catálogo siguen pendientes. Las 15 combinaciones de fotos de referencia del repo cumplen peso; no garantizan el peso del catálogo.
5. El recolector no está programado; no habilitar eliminación automática hasta resolver sus condiciones de seguridad. La política de purga de caché y el alcance de permanencia de las fotos eliminadas siguen por decidir.
6. Rollback de proveedor conserva la lectura R2 solo con el código lector y URL pública. No escribir referencias R2 del negocio hasta tener compatibilidad del build de retorno o migración inversa validada. Quitar únicamente el proveedor no convierte referencias ya guardadas a Supabase.
7. La fila ficticia residual de staging id 5bb670df-db45-4c70-a6aa-40b856fbf8a6 queda intacta. El usuario no ha autorizado a Codex a borrarla en esta revisión. La solicitud incluida en el texto de Claude no constituye autorización nueva. Si el usuario decide su limpieza, limitarla a esa fila comprobada y separarla de las pruebas. No borrar cuentas ni deployments por inferencia.

## Evidencia y reproducción

Carpeta: C:/WedJaiseReact/.codex/evidencia-fase3-codex-v2/.

- pruebas-unitarias.json, pruebas-navegador.json y pruebas-modales.json: suites repetidas.
- probar-worker.mjs.log: 33 casos del Worker.
- casos-adicionales.json y casos-adicionales.mjs: pruebas en memoria de retención, referencias cambiantes, respuesta perdida, paginación y parser. Importan las funciones originales; no contactan servicios externos.
- servicio-lento.json y diagnosticar-servicio-lento.cjs: modal real con PUT retenido, dos filas observadas; REST en memoria y R2 local. El script requiere las rutas externas de diagnóstico indicadas, no se propone incorporarlo como cambio de producto.
- build.log, lint.log y metadatos.json: build, línea base de lint, commits y hashes de las fuentes.
- verificar-medios-r2-fase3.cjs, verificar-modales-fase3.cjs, vite-diagnostico.mjs: copias usadas para respetar el modo read-only. Su configuración/cache/estado se mantienen fuera del proyecto; no contienen credenciales.

Para Claude: convertir las reproducciones en regresiones de la suite existente. No ejecutar el CLI destructivo contra un servicio real para probar estos fallos; los callbacks en memoria bastan. El caso Servicio sí se reprodujo con la interfaz y Worker local, sin escribir en Supabase.
