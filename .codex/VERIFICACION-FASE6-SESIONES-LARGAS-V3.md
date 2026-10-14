# Verificación Fase 6 · V3

Fecha: 2026-10-11, America/Lima. HEAD `6929c619e88a91434cb16ee6a8d2de90de94c091`, rama `feat/cloudflare-pages`. Se revisa el árbol local sin commit de la entrega `ENTREGA-FASE6-CORRECCIONES-V2.md`.

## Veredicto

**APROBADA CON OBSERVACIONES, únicamente para implementación y QA LOCAL.** Se cierran **F6-01b** y **F6-05**. Se mantienen los cierres de F6-02, F6-03 y F6-04. No quedan hallazgos bloqueantes abiertos de las revisiones V1–V3 en las reproducciones examinadas.

Esta aprobación no acredita staging, producción ni publicación. No autoriza commit, push, migraciones, cambios de hosting o ejecución de la Fase 7. La siguiente fase espera la indicación del usuario.

| Hallazgo | Estado vigente |
| --- | --- |
| F6-01, liberar en submit y protección falsa tras cancelar | Cerrado; se mantienen el error, la validación, el envío en vuelo y la cancelación |
| F6-01b, éxito ajeno libera trabajo no confirmado | Cerrado, incluida respuesta antigua después de editar y reenviar |
| F6-02, filtros de otra cuenta/rol | Cerrado; cambio directo repetido en esta revisión con identidad simulada |
| F6-03, rango de Dashboard perdido | Cerrado; mes y argumentos de la consulta repetidos tras desalojo |
| F6-04, contador fuera de vista/reducido | Cerrado en V2; componentes y bucle sin cambios por hash, no se repite esa matriz |
| F6-05, formularios cancelados retenidos | Cerrado; 20 cancelaciones reales del modal, una sola pantalla, GC y referencias débiles |

## Verificación independiente

**17 escenarios correctos, 0 fallos del contrato y 0 errores de página**, más un control negativo que reproduce la pérdida esperada. Los detalles están en `.codex/evidencia-revision-fase6-v3/`.

- **7 escenarios de confirmación:** PestanasCacheadas, registro, PuntosWeb y ToastProvider reales; backend simulado. Tres éxitos ajenos con error, validación rechazada y envío pendiente; éxito propio; dos formularios enviados; respuesta antigua tras reenviar; confirmación repetida después de una edición nueva.
- **9 escenarios de caché:** recorrido por 27 nombres de ruta con pantallas de relleno, tres estados de PuntosWeb, ocho diálogos cancelados, cambio directo de cuenta y de rol, mes de Dashboard y cancelación del modal real de Promociones.
- **1 escenario de retención:** veinte aperturas, edición y cancelación de ModalPromocion real sin superar una pantalla montada, con GC doble y observación de los formularios mediante WeakRef.

Se usa Chromium contra el Vite existente en `http://localhost:5173`. Los módulos compartidos se importan con el mismo identificador servido por Vite, incluidos sus parámetros de HMR. Auth y Supabase son dobles en memoria; todo origen de red externo al Vite se bloquea. No hubo updates reales, cuentas nuevas, exportaciones ni descargas del negocio. No es una segunda ejecución autenticada de toda la aplicación ni una prueba de producción.

### F6-01b: confirmación propia, formulario e intento

Los tres casos de PuntosWeb conservan la ruta y el campo **77** después de un toast ajeno real emitido por ToastProvider y de recorrer suficientes rutas para desalojar pantallas sin protección. La validación Premium 99 / VIP 30 hace **0 escrituras**, y el envío en vuelo conserva una promesa pendiente. El toast ajeno no confirma ninguno.

El control de guardado propio confirma el 77 en el servidor simulado, libera la ruta y, al remontarla, vuelve a leer 77. En dos formularios fixture de una misma pantalla, confirmar A no libera B: B conserva su texto tras el recorrido.

**Se cubre el límite que faltaba en la entrega de Claude:** enviar intento 1 con 77, editar a 88, reenviar intento 2, recibir primero la confirmación del intento 1. Los tokens son distintos (`1`, `2`), la ruta sigue protegida y conserva **88**. La confirmación del intento 2 libera la protección y, tras volver a provocar un desalojo, la ruta puede desmontarse. Se distingue la protección de la mera permanencia reciente en la caché LRU.

**Control negativo:** únicamente en la respuesta JavaScript interceptada por el navegador se omite la comparación del número de intento, conservando la comprobación del estado `enviado`. La respuesta antigua libera la ruta y el 88 se pierde. El diagnóstico detecta exactamente ese defecto; el archivo del proyecto nunca se modifica. El resultado bruto de este control es una observación esperadamente incorrecta, no un caso sano; `resumen-verificacion.json` computa esa distinción.

También se verifica que confirmar por segunda vez un token ya usado no libera una nueva edición a 99.

### F6-05: registro débil y cancelaciones

El registro real usa WeakMap para los estados y WeakRef por ruta. El diagnóstico conserva únicamente referencias débiles a los formularios cancelados; no incorpora una referencia fuerte que invalide el GC.

Tras tres cancelaciones de calentamiento, se miden 0, 10 y 20 cancelaciones adicionales:

| Cancelaciones adicionales | Formularios observados vivos tras GC | Formularios desconectados vivos | Pantallas montadas | Nodos / oyentes de CDP |
| --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 1 | 61 / 177 |
| 10 | 0 | 0 | 1 | 61 / 177 |
| 20 | 0 | 0 | 1 | 61 / 177 |

No hay formularios en el DOM ni trabajo pendiente después de cancelar. La ausencia de retención se acredita **antes** de recorrer otras rutas o provocar el recorte. Los números son del escenario controlado y de los contadores de CDP; no equivalen a los del POS completo, ni prueban ausencia universal de fugas. El crecimiento reproducido en V2 ya no aparece.

### Conservación y límites de caché

El recorrido de nombres de 27 rutas conserva un máximo de 6 pantallas sin trabajo pendiente. Cancelar ocho diálogos editados deja 6 pantallas y 0 formularios. Una cuenta nueva y un rol nuevo nacen con el filtro vacío y solo Ventas montada. Dashboard vuelve a **Septiembre** tras desmontarse y repite los mismos argumentos: `2026-09-01T05:00:00.000Z` → `2026-10-01T05:00:00.000Z`.

Las pantallas de relleno de estos diagnósticos son fixtures; no se les atribuyen flujos administrativos completos. El cambio de rol se limita a ADMINISTRADOR → CAJERA.

## Código, herramientas y evidencia de Claude

Se revisó la captura síncrona de `envioDe(evento.currentTarget)` y la llamada a `confirmarGuardado(envio)` después del control de error en las seis pantallas declaradas: PuntosWeb, FidelizacionWeb, ReferidosWeb, ContactoWeb, LibroReclamacionesWeb y Programa de RecompensasWeb. La confirmación identifica formulario e intento; los errores y validaciones no la llaman. Los flujos complejos de las otras cinco pantallas no se volvieron a recorrer íntegramente en este harness.

`ToastContext.jsx` no tiene diff contra HEAD y `src/lib/eventosToast.js` ya no existe. No queda la señal global de éxito como autoridad para liberar formularios. TarjetaPuntos, bucleAnimacion, estadoVista, las cinco pantallas del rango y ModalPromocion conservan sus hashes de la revisión V2, salvo los módulos de confirmación enumerados en el JSON.

**Oxlint de los ocho archivos de registro, caché y confirmación: sin diagnósticos.** Los dos parches pasan `git apply -R --check`: 26 archivos exclusivos y 8 mixtos. No se aplican, y no se compila un árbol revertido. La receta enumera los seis módulos/scripts nuevos a retirar y solo la sección §49 del changelog; mantiene las Fases 4 y 5.

Se auditan, sin ejecutarlos de nuevo, los informes de Claude:

- Fase 6: **20/20**.
- Regresión Fase 5 en producción: **32/32**; F5-01 en desarrollo: **3/3**. Son alcances separados, no una repetición de la cifra anterior 34/34.
- Sesión larga: 6 pantallas; 2.856 nodos en los ciclos 2 y 3; heap **8,98 → 9,09 MB**. Datos de laboratorio de Claude, no una medición repetida aquí ni demostración de fuga.

No se ejecutan sus suites con siembra/limpieza SQL y `session_replication_role`. Una inspección real de solo lectura, después de verificar el puerto Local 54321 del proyecto, encuentra **0** clientes, promociones, cupones y reseñas con los prefijos QA F5/F6 examinados. No prueba igualdad de toda la base ni que las tres configuraciones estén idénticas antes/después: esa afirmación pertenece a la evidencia de Claude, no a un snapshot tomado por Codex.

Los hashes de los archivos examinados permanecen estables durante los diagnósticos. No se modifica fuente, configuración, dependencias, datos o historia Git. No se ejecuta un build que sobrescriba `dist`; se revisa la evidencia de build entregada.

## Observaciones y traspaso a Claude

1. Un formulario persistente sin confirmación explícita conserva protección hasta desaparecer del DOM. Es una retención conservadora aceptada en este alcance; futuras pantallas deben integrar la confirmación de su guardado.
2. Añadir a la suite mantenida de Fase 6 la secuencia **enviar → editar → reenviar → respuesta antigua → respuesta actual**, ahora acreditada por el diagnóstico externo de Codex. No se exige otra ronda para cerrar este hallazgo: la regresión facilitará detectar recaídas futuras.
3. El estado local no registrado como filtro/scroll se reinicia al desalojar; el scroll se limita al contenido que vuelva a cargarse. El tope de 6 y la experiencia de navegación no están validados con personas usuarias reales.
4. No se acredita Firefox, Safari, móvil físico, staging o producción. F6-04 conserva la matriz de pausa/reanudación de V2; no se atribuye una ejecución nueva de esas pruebas a V3.
5. Actualizar en el registro la fila 6 como **aprobada con observaciones, solo local**, enlazando este informe y preservando los veredictos históricos. La lista de archivos debe referir el rollback vigente de correcciones V2, no únicamente la entrega inicial. La fila 5 todavía contiene la frase histórica «Fase 6 no iniciada» y conviene rotularla como tal para evitar contradicciones.
6. Commit, push, dependencias de las Fases 4/5, migraciones remotas y comienzo de Fase 7 siguen siendo decisiones aparte del usuario. Codex no los ejecuta.

## Archivos de esta revisión

En `.codex/evidencia-revision-fase6-v3/`: `resumen-verificacion.json`, `confirmaciones-diagnosticos.json`, `control-negativo-intento.json`, `cache-diagnosticos.json`, `formularios-retencion.json` y `estado-revision.json`. Los diagnósticos se conservan como `.txt` para consulta, sin incorporarlos como código del proyecto. El resumen tiene **17/17**, control negativo detectado y hashes estables.
