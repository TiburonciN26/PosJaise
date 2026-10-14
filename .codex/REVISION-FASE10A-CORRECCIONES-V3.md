# Revisión Fase 10A · correcciones V3

Fecha: 2026-10-13, America/Lima. Codex, exclusivamente QA/auditor. Rama `feat/cloudflare-pages`, HEAD `6929c619e88a91434cb16ee6a8d2de90de94c091`.

**Veredicto: APROBADA CON OBSERVACIONES, solo para las correcciones y QA LOCAL de la V3.** F10A-01b, F10A-02b y F10A-03b quedan cerrados en las reproducciones revisadas. F10A-05b queda atendido en el contrato y borrador local propuesto, sujeto a D11. No encontré nuevos hallazgos bloqueantes en este paquete.

**La Fase 10A global sigue pendiente de sus presupuestos y decisiones D11/D12.** Este veredicto no acredita producción, instalación del borrador, cambio de hosting ni 10B. No contiene autorización de commit, push o migraciones remotas: esas decisiones pertenecen al usuario.

## 1. Qué hice y qué archivos escribí

Solo leí el proyecto, ejecuté las regresiones específicas existentes y guardé un informe/evidencias nuevos. **No edité `src/`, herramientas, configuración, migraciones, registro de fases, changelog ni archivos existentes de evidencia.** No creé una implementación ni parché el código. No instalé dependencias ni ejecuté SQL mutante o DDL.

Se registraron hashes de **1.941 archivos existentes protegidos** al inicio y al cierre: **0 cambios de contenido** antes de guardar este informe. La comparación incluye código, scripts, migraciones, configuración y documentos/registros existentes. Git y HEAD también conservaron su estado. Las nuevas entradas de Git que introduce esta entrega son únicamente:

- `.codex/REVISION-FASE10A-CORRECCIONES-V3.md`
- `.codex/evidencia-revision-fase10a-v3/`

En particular, `FASES-RENDIMIENTO-CLOUDFLARE.md` empezó y terminó con SHA-256 `CE0B3E9B2C1475DA779BE295516BBFCC5366133E5048CE7DB7E5145A4711A396`; su fecha de modificación ya era 10:41:22 al comenzar. No lo corregí ni reescribí. CSS y `InicioCliente.jsx` también quedaron idénticos durante esta QA. No atribuyo la autoría de cambios anteriores basándome en su timestamp.

Prueba de conservación: [conservacion-antes-de-informe.json](C:/WedJaiseReact/.codex/evidencia-revision-fase10a-v3/conservacion-antes-de-informe.json), con la fotografía inicial completa en `hashes-protegidos-iniciales.json`.

## 2. Comprobaciones y límites de independencia

| Comprobación | Resultado y alcance |
| --- | --- |
| Suite existente `probar-herramientas-10a.mjs`, repetida por Codex con el build local servido | **60/60, código 0**. Incluye los negativos específicos y sus controles positivos. |
| Redirecciones en ejecución, CLI originales, cadenas, recurso, navegación, CONNECT ajeno y destino externo simulado | 0 peticiones al señuelo en los casos incluidos; las claves son inventadas y no se envían contraseñas QA reales a las apps falsas. |
| Proxy y emulación CDP | Control con latencia 600 ms pasa, con tiempo cercano al impuesto. Es un control de conservación de la latencia, no una nueva medición completa de rendimiento. |
| Muestras incompletas, errores de página, huellas finales/artefactos ausentes, cambio de fuentes y fixtures de la revisión V2 | Los negativos quedan INCOMPLETA con código no cero; el control sano cumple. |
| Fallback fuera de la raíz tras sustituirla por junction | Las rutas directas y SPA quedan 403; el defecto vuelve a reproducirse en la copia V2. |
| SHA-256 del paquete V3 y sus copias declaradas | **20/20 coinciden**. No se aplicó rollback. |
| Roles a través del proxy | Evidencia de Claude **19/19**, cinco perfiles × 46 rutas, coherente con sus casos y guardas. No la repetí de nuevo. |
| Borrador de deudas | Revisé código y evidencia: **25 casos + estado final = 26/26** informados por Claude. No ejecuté ese SQL. |
| UI de `main` ante deuda con abono y rechazo de PATCH | Evidencia de Claude coherente: muestra S/100, no S/70; envía estado/fecha sin importe; muestra error y conserva la tarjeta pendiente tras el rechazo simulado. No se escribió una deuda real en esa prueba. |
| Estado de Local, relectura independiente | 59 deudas, 8 pagos, suma 79, firma `98734d8454b3fdac9007e277449705c2`; 0 triggers y funciones de compatibilidad, 0 deudas del ensayo y 0 asistentes temporales. Coincide con el estado informado. |

No repetí la batería global, las mediciones de vitales ni pruebas de otros frentes. No atribuyo 60/60 a una validación completa del negocio: son los casos específicos de las herramientas. Las pruebas, informes y registros anteriores se conservaron.

No ejecuté `ensayar-compat-deudas.mjs`, porque crea funciones/triggers y hace DML, aunque termine en ROLLBACK. [AGENTS.md](C:/WedJaiseReact/AGENTS.md) limita mi función a QA de solo lectura y prohíbe alterar el esquema. La revisión del borrador se apoya en fuente, resultados del autor y relectura independiente. No constituye otra ejecución del Postgres real.

Levanté un servidor propio en un puerto libre y cerré únicamente ese proceso al terminar. **No inicié, detuve ni modifiqué el servidor 5173 del usuario.** Los fixtures de la suite se crean en su temporal QA; no modifican las fuentes del proyecto.

Evidencia nueva: [evidencia-revision-fase10a-v3](C:/WedJaiseReact/.codex/evidencia-revision-fase10a-v3).

## 3. Cierre de los hallazgos

### F10A-01b · cerrado para el alcance probado

El proxy de cada contexto valida el destino antes de conectar y no sigue redirecciones en nombre del navegador. El siguiente salto vuelve a pasar por la guarda. La reproducción que antes recibía una clave inventada ahora deja cero peticiones al señuelo; conserva los positivos de redirección dentro de la app y de latencia CDP.

Se mantienen el preflight de backend/cuentas, el bloqueo de service workers, la sonda de Node del login y las guardas de HTTP/WebSocket. El control positivo de roles del autor usa el mismo proxy, sin violaciones. No encontré un nuevo bloqueo en esos cambios.

Observación: añadir un proxy cambia la trayectoria de conexión. El control de 600 ms acredita que sigue actuando el throttling; no demuestra que todos los tiempos fríos/calientes o las conexiones sean idénticos a V2. Las futuras mediciones deben rotular el método V3 y usarlo de forma uniforme en ambos lados de la comparación.

### F10A-02b · cerrado para el alcance probado

Las cifras se obtienen de muestras válidas, con mínimo exigido y sin errores de página. Se exige cierre de ejecución y las huellas inicial/final de las apps del alcance. La huella de fuentes cubre el caso de Vite dev que conserva el HTML mientras cambia `src/`.

Los fixtures negativos de la revisión V2 y las 14 regresiones nuevas se rechazan correctamente. Los límites numéricos permanecen intactos. El formato histórico V2 se acepta solo en el alcance documentado de un grupo; no acredita una huella de fuentes que el archivo antiguo no contenía.

Observación: la huella de fuentes registra el conjunto declarado (`src/`, HTML, Vite config y lockfile). No equivale por sí sola a todos los posibles inputs de un build ni prueba que un `dist` conservado se compiló desde ese estado. Hay que conservar el candidato/artefacto exacto y no editar durante las mediciones.

### F10A-03b · cerrado

El archivo de fallback pasa por `archivoDentro`, con validación de pertenencia y ruta real. En la reproducción de sustitución de raíz, la SPA ya no sirve el índice ajeno, incluso con el índice propio previamente cacheado. Los controles de assets, HEAD, `_headers` y fallback normal siguen pasando.

### F10A-05b · atendido en el borrador y contrato LOCAL; D11 pendiente

El borrador rechaza un cambio heredado a COBRADA cuando hay pagos mayores que cero pero inferiores al monto. La UI nueva sigue pudiendo cobrar el saldo: su recálculo llega a COBRADA con los pagos que ya cubren la deuda. Sin pagos previos, el cobro heredado registra el importe completo visible.

La evidencia S2 y S5 cubre el rechazo de un cobro antiguo con abonos y con monto aumentado, y el cobro correcto posterior en la versión nueva. La reacción simulada de `main` al error está descrita sin afirmar un cobro real. El mecanismo no está instalado en Local ni en remoto.

La limitación visual permanece explícita: `main` muestra el monto original y sus totales ignoran abonos. Por tanto, cerrar el defecto del borrador no autoriza a utilizar libremente la pantalla antigua ni garantiza el comportamiento humano al cobrar.

**Recomendación para D11:** la opción B —mecanismo más dejar de operar Deudas en `main` durante la convivencia— da una regla operativa más simple. La opción A necesita que todas las operadoras distingan y consulten las deudas con abonos exclusivamente en la versión nueva; el rechazo puede aparecer después de que una persona haya entendido el importe antiguo. El usuario debe elegir el alcance. Codex no activa ni cambia ninguna de esas opciones.

Antes de cualquier instalación real siguen necesarios el lote atómico, ensayo remoto autorizado, recuperación, reglas operativas y comunicación. No convierto los ensayos seriales locales en una garantía de producción o de concurrencia.

## 4. Presupuestos y registro de fases

Los **18 presupuestos incumplidos siguen abiertos**. La evidencia V2 conserva NO CUMPLE y no se reasigna al estado actual de Inicio/CSS. No se hicieron mediciones nuevas en esta QA.

- D12 puede autorizar a Claude a corregir en Local el espacio reservado de Inicio y probar CLS. No acepto una excepción permanente para el desplazamiento visible de ~0,33.
- Las posibles excepciones LCP deben identificar escenarios comparables, alcance, criterio y actuación si la evidencia de campo incumple. Siguen siendo decisión del usuario, con revisión de la justificación.
- Persisten los límites de navegador/dispositivo, las intermitencias anteriores y la validación remota/operativa. No se aprueba 10B por cerrar las herramientas.

**Inconsistencia del registro confirmada en lectura:** las filas 8, 9 y 10A/10B de [FASES-RENDIMIENTO-CLOUDFLARE.md](C:/WedJaiseReact/.codex/FASES-RENDIMIENTO-CLOUDFLARE.md:214) dicen Pendiente con columnas vacías. Esto no refleja los veredictos locales conservados de las Fases 8 y 9 ni las revisiones 10A. El responsable de ese documento debe contrastarlo con los informes originales y separar el estado local del de staging/producción. **No lo edité ni cambié ninguna fila.**

Fuentes de referencia: [cierre de Fase 8](C:/WedJaiseReact/.codex/CIERRE-FASE8-OBSERVACIONES.md), [revisión Fase 9 V2.1](C:/WedJaiseReact/.codex/REVISION-FASE9-MEDIOS-V2.1.md), [revisión 10A V2](C:/WedJaiseReact/.codex/REVISION-FASE10A-CORRECCIONES-V2.md) y este informe V3. No puedo identificar quién reescribió el registro usando únicamente su fecha de modificación.

## 5. Siguiente paso

Las correcciones V3 pueden registrarse por Claude como aceptadas con estas observaciones, preservando los alcances. La fase completa necesita resolver D11/D12 y su validación pendiente; no hace falta otra batería global solo para archivar este veredicto. Cualquier cambio posterior en el producto debe tener su QA propia y una identidad de artefacto clara.

Codex entrega únicamente este informe y la evidencia. No hay código que haya implementado o corregido, ni migraciones, configuración o registros de fases modificados por esta revisión.
