# Revisión Fase 6 · V2

Fecha: 2026-10-11, America/Lima. Base HEAD `6929c619`, rama `feat/cloudflare-pages`. Implementación local sin commit. Entrega revisada: `.codex/ENTREGA-FASE6-CORRECCIONES-V1.md`.

## Veredicto

**RECHAZADA para el cierre local de Fase 6.** F6-02, F6-03 y F6-04 quedan cerrados en las reproducciones revisadas. F6-01 mejoró en los casos aislados de error/validación/en vuelo y Cancelar, pero queda la variante **F6-01b** (éxito ajeno libera trabajo no confirmado). La nueva captura de formularios introduce además **F6-05**, retención creciente de formularios cancelados.

Son dos pendientes P2. No avanzar a Fase 7 ni publicar como aprobada.

| Hallazgo | Estado |
| --- | --- |
| F6-01, liberar al submit y protección falsa de Cancelar | Casos básicos corregidos; pendiente F6-01b |
| F6-02, filtros anteriores tras cuenta/rol nuevos | Cerrado |
| F6-03, mes de Dashboard perdido | Cerrado, prueba operativa de Dashboard y revisión del patrón de las otras cuatro pantallas |
| F6-04, contador fuera de vista/reducido | Cerrado, incluidas pausa y reanudación |
| F6-05, registro conserva formularios desmontados | Nuevo P2 |

La descripción «cualquier éxito de cualquier origen libera lo enviado» no es una limitación inocua de retención: se reprodujo pérdida de borradores y desalojo de un guardado todavía pendiente. No se acepta como excepción al objetivo de esta fase.

## Método y alcance

**21 escenarios independientes en Chromium**, sin errores de página ni del harness en las corridas finales:

- 9 de caché: caché/hooks/configuración reales, PuntosWeb/Dashboard/ModalPromocion reales; otras pantallas de relleno; Auth y Supabase simulados.
- 4 de TarjetaPuntos real para visibilidad y preferencia, más 2 de reanudación.
- 5 de confirmaciones con **ToastProvider real** y backend simulado: tres éxitos ajenos, guardado propio correcto y dos formularios enviados.
- 1 de retención del modal real: 20 cancelaciones, GC y referencias débiles de diagnóstico.

No son una repetición autenticada completa de las 27 pantallas ni de las suites de Claude. «Sin error del harness» tampoco significa cumplir el contrato: dos escenarios de fallo de contrato están documentados aquí.

Se auditaron los JSON de Claude: 17/17 de Fase 6 y 34/34 de Fase 5. No se ejecutaron sus scripts con siembra/limpieza SQL. Solo se usaron SELECTs reales de conteos de prefijos QA en Local, positivamente verificado en el puerto 54321 del proyecto. Clientes/promociones/cupones/reseñas con los prefijos examinados F5/F6 estaban en 0; no acredita igualdad de toda la base.

Los intentos de guardar los atiende un cliente Supabase ficticio dentro del navegador. No se enviaron updates ni se descargó/exportó información del negocio. Tampoco se crearon cuentas o filas por Codex.

## F6-01b · Un éxito de otro flujo no confirma este formulario

Prioridad **P2**. Archivos:

- `src/components/PestanasCacheadas.jsx:177–195`.
- `src/lib/eventosToast.js`.
- Emisión global en `src/context/ToastContext.jsx:21`.

`alEnviar` deja el formulario en estado `enviado`, incluso cuando la validación rechaza o el guardado termina con error. `notificarExito()` no incluye formulario, operación ni origen. El oyente borra **todos** los formularios en estado enviado, de todas las rutas, ante un éxito cualquiera.

### Reproducción real del formulario, datos simulados

| Caso PuntosWeb | Antes del éxito ajeno | Después del éxito ajeno y desalojo | Al volver |
| --- | --- | --- | --- |
| Guardado rechazado por el cliente simulado | Campo 77, toast real de error, ruta protegida | Ruta desalojada | Campo vuelve a 1 |
| Premium 99 / VIP 30, validación real rechazada | 0 updates, campo 77, ruta protegida | Ruta desalojada | Campo vuelve a 1 |
| Guardado sin resolver | 1 promesa todavía pendiente, campo 77, ruta protegida | Ruta desalojada **sin confirmación** | Campo vuelve a 1 |

Se emitió `mostrarToast('Exportación terminada (ficticia)', 'exito')` a través del **ToastProvider del proyecto**, mientras se estaba en otra ruta. No hubo exportación real. Es una reproducción controlada de un éxito ajeno legítimo: el código real de Historial, por ejemplo, anuncia una exportación con tipo exito en `Historial.jsx:645`, sin guardar ese formulario de PuntosWeb.

**Control positivo:** un update propio simulado confirma 77; el handler real de PuntosWeb muestra su éxito, la caché permite desalojar y la siguiente lectura del servidor simulado conserva 77. Eso prueba que se está usando la señal real y diferencia confirmación propia de aviso ajeno.

**Coexistencia:** dos formularios fixture A/B en una misma pantalla usan la protección y el ToastProvider reales. Se envían ambos; solo A confirma éxito. La caché desaloja la pantalla y el borrador de B desaparece, aunque B jamás confirmó su operación. El caso «uno enviado y otro solo editado» es distinto y no cubre este fallo.

### Corrección y criterios de aceptación

La confirmación debe identificar explícitamente el formulario y, cuando corresponda, el intento/operación confirmado. Un mensaje visual genérico no puede ser autoridad para descartar datos. No resolverlo por texto del toast, formulario enfocado o último formulario enviado: son ambiguos con operaciones concurrentes.

- Error, validación rechazada, en vuelo o resultado incierto conservan su trabajo hasta su confirmación o descarte explícito.
- Un éxito de exportación/copia o de otro formulario no cambia esa protección.
- A y B enviados: el éxito de A libera solo A; B sigue protegida.
- Si se edita después de enviar, una respuesta anterior no debe borrar el borrador nuevo.
- Mantener el caso de éxito propio y la cancelación explícita correctos.

Se necesitan regresiones de esas secuencias con la señal real. Cambiar el aviso por otro evento global sin identificador tampoco corrige la correlación.

## F6-05 · Los formularios cancelados se conservan fuertemente hasta un recorte

Prioridad **P2**. Archivo: `src/components/PestanasCacheadas.jsx:149–175` y `103–109`.

`formularios` es un Map por ruta que contiene otro Map con **HTMLFormElement como clave**. El borrado de claves desconectadas solo se hace dentro de `protegida()`. Pero `recortar()` solo llama a esa función si hay más de seis pantallas. Al editar y cancelar muchas veces en una misma pantalla, la caché sigue con una sola pantalla y nunca purga esas referencias.

### Reproducción sobre ModalPromocion real

Abrir Nueva promoción, escribir un título ficticio, Cancelar; repetir sin recorrer otras rutas. No se envía ni guarda nada. Se forzó GC dos veces en cada muestra.

| Cancelaciones | Formularios en el DOM | Claves de formulario desconectado todavía retenidas | Nodos CDP tras GC | Listeners CDP |
| --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 55 | 164 |
| 10 | 0 | 10 | 1.121 | 277 |
| 20 | 0 | 20 | 2.181 | 377 |

En las tres muestras solo `/promociones` está montada y el registro global de trabajo pendiente está vacío. Los objetos retenidos tienen estado `editado`, aunque sus formularios ya fueron cancelados y `isConnected=false`.

Después de visitar siete rutas y forzar recorte, `protegida()` finalmente purga las claves: 0 formularios retenidos, nodos CDP 61, listeners 178. Es una limpieza eventual, no liberación al cancelar.

La instrumentación usa un Proxy de construcción de Map y **WeakRef** para localizar los mapas, sin añadir referencias fuertes a mapas o formularios. Se cuentan solo claves HTMLFormElement con valores editado/enviado. La retención se debe al Map real de la caché, y al vaciarlo los objetos dejan de permanecer. No se atribuyen los números a usuarios de producción ni se mide el heap en MB en esta prueba.

Este escenario muestra retención creciente de DOM desconectado durante una sesión de cancelaciones, **no** una fuga general ilimitada de toda la app. Puede limpiarse al recortar/cambiar la identidad/desmontar el POS. Tampoco contradice el heap estable de los tres recorridos de Claude: esos recorridos fuerzan recortes y ejercitan precisamente la limpieza eventual.

### Corrección y aceptación

Liberar los registros de formularios desmontados/cancelados independientemente de que la caché supere seis pantallas. Evitar retener fuertemente DOM que ya no contiene trabajo. Puede usarse un registro con ciclo de vida o un mecanismo acotado de detección; no añadir sondeos/timers continuos por formulario como sustituto.

Regresión: muchas aperturas/ediciones/Cancelaciones en una sola ruta con ≤6 pantallas, sin necesidad de navegar; ningún formulario descartado acumulándose tras GC. Mantener protección de formularios conectados, diálogos abiertos y operaciones reales pendientes. Comparar también nodos/listeners y verificar que el diagnóstico no los retenga por sí mismo.

## Cierres de los otros hallazgos

- **F6-02:** con el almacén compartido correcto, A→B y ADMIN→CAJERA montados ahora nacen con filtro vacío y solo `/ventas` montada. Las pruebas de identidad usan contextos controlados, no RLS ni logins reales; complementan la evidencia de Claude. `fijarIdentidadVista` se ejecuta antes de que el árbol nuevo lea el almacén.
- **F6-03:** Dashboard conserva Septiembre tras ser efectivamente desalojado. Antes y después envía exactamente `2026-09-01T05:00:00Z`→`2026-10-01T05:00:00Z`. Las otras cuatro pantallas cambian el rango al mismo hook por revisión de código, sin cuatro recorridos operativos nuevos.
- **F6-04:** fuera del viewport y bajo la señal simulada de documento oculto, delta rAF y mutaciones del número = 0 después del establecimiento inicial. Cambiar a reducido durante el conteo deja inmediatamente 1,234 / 50 %, sin rAF nuevo. Al volver al viewport o a la señal visible, continúa y termina en 1,234 / 50 %. No se mide CPU real de una pestaña oculta ni FPS físico. El bucle puede tener un primer cuadro antes de que llegue IntersectionObserver; no continúa invisible en la ventana medida.
- **F6-01 básico:** sin éxito ajeno, los formularios con error/validación/en vuelo se conservan con 77; el modal cancelado se deja desalojar; ocho cancelaciones en rutas distintas ya no fuerzan nueve pantallas. Ese progreso se mantiene, pero no cierra F6-01b ni F6-05.

## Evidencia de estabilidad, lint y rollback

`despues-v2.json` de Claude tiene tres ciclos y sus números coinciden con la entrega: seis pantallas, 2.856 nodos y heap 8,98→9,08 MB entre ciclos 2–3, sin errores registrados. Son **muestras de Claude auditadas**, no una nueva medición de todo el POS por Codex. No certifican el escenario de cancelaciones aisladas que falla aquí.

Lint acotado a PestanasCacheadas, estadoVista, eventosToast, ToastContext y TarjetaPuntos: exit 0, sin errores; una advertencia only-export-components en ToastContext.

Checks inversos de ambos parches: correctos, sin aplicarlos. `git apply --stat` corrobora 25 archivos exclusivos y 8 mixtos. Los dos grupos tocan archivos distintos; la receta ahora contempla archivos nuevos y sección 49, preservando Fases 3/4/5. La precisión de rollback y el comentario de PaginaActivaContext de V1 quedan atendidos. No se certificó ejecutando el rollback ni un build del árbol revertido.

## Evidencia y validez de los diagnósticos

Carpeta nueva: `C:/WedJaiseReact/.codex/evidencia-revision-fase6-v2/`.

- `cache-diagnosticos.json`: 9 repeticiones básicas corregidas.
- `tarjeta-diagnosticos.json` y `tarjeta-reanudar.json`: 6 controles del contador.
- `confirmaciones-diagnosticos.json`: 5 controles con ToastProvider real, incluidos errores/validación/en vuelo, éxito propio y coexistencia.
- `formularios-retencion.json`: cancelaciones repetidas, referencias y GC.
- `estado-revision.json`: hashes/HEAD, auditoría de JSON/medidas, conteos Local y rollback/lint.
- Scripts externos copiados como `.txt`, sin ejecutables nuevos en el proyecto.

Vite añadió timestamps HMR al import de estadoVista. El primer replay de identidad del harness tenía un import sin ese timestamp y creaba un Map distinto, por lo que no era una reproducción válida del cierre. Se alineó el import al módulo exacto servido por Vite y solo la corrida final sustenta el veredicto. ToastProvider y sus consumidores también usan el mismo módulo servido; no un toast ficticio sin la señal del proyecto.

Se verificó Supabase Local (Kong de WedJaiseReact en 54321) antes de SELECTs de prefijos QA. No se hicieron mutaciones SQL, cambios de esquema, cuentas, Git, hosting ni dependencias por Codex. Los intentos de update de los escenarios son simulados, no escritos a la base.

## Siguiente entrega de Claude

Corregir F6-01b y F6-05 y agregar las regresiones exactas. Mantener los cierres F6-02/F6-03/F6-04. Repetir la estabilidad después de cambiar el ciclo de vida de formularios e incluir cancelaciones repetidas además de navegar las 27 rutas. No basta conservar el 17/17 actual, que no cubre ambos escenarios nuevos.

Entregar V3, evidencia nueva en `.codex` y rollback actualizado si cambian los archivos. Sin commit, push, migraciones, hosting ni Fase 7. Codex solo generó este informe y evidencia; no corrigió código.
