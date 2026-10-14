# Revisión de lectura mixta V3 y harness del recolector

Fecha local: 10 de octubre de 2026 (America/Lima). QA de solo lectura; Claude implementa las correcciones. Los timestamps UTC de la evidencia corresponden al 11 de octubre.

## Veredicto

**No aprobar todavía la ejecución real del harness del recolector.** Hay tres fallos reproducidos (RG-01, RG-02 y RG-03). La validación de salida también conserva un caso residual de ML-01 (ML-01b).

**ML-02 y ML-03 aceptadas en el alcance local revisado.** El paquete v2 prueba el mecanismo de servidor + frontend, pero está construido desde ec2a3b6, que no incluye ML-03. No es el artefacto final de rollback. Generar y verificar el paquete desde el futuro commit exacto que incluya ML-03 sigue pendiente.

La Fase 3 no queda aprobada ni se autoriza producción, commit, push, carga, ejecución del recolector o cierre de r2.dev con este informe.

## Comprobaciones ejecutadas

| Comprobación | Resultado |
| --- | --- |
| Salida segura, fs en memoria | 8/8 |
| Harness del recolector, en memoria | 13/13 |
| URLs y cableado real de la aplicación | 16/16 |
| Paquete v2 desde una copia aislada | 6/6 |
| Lectura mixta, Vite SSR con red bloqueada | 7/7 |
| Diagnósticos independientes adicionales | 6 entradas: dos del flujo, una del adaptador y tres rutas Windows |
| oxlint de lo revisado | Sin diagnósticos |
| Sintaxis del constructor y CLI del recolector | Correcta |

Las 50 aserciones de las suites pasan, pero no cubren las reproducciones nuevas. No se repitieron carga, guardas, retirada o entrega sin cambios relevantes para esta revisión. No se construyó otro artefacto ni se ejecutó npm ci. Las copias diagnósticas se crearon fuera del proyecto; no hubo red, autenticación real, datos remotos, instalación ni borrados reales. La prueba del adaptador usa el SDK instalado y respuestas HTTP ficticias.

## RG-01 — P2: la limpieza rompe la referencia tardía que el recolector conservó

Ubicación: [ensayo-recolector.mjs](C:/WedJaiseReact/scripts/lib/ensayo-recolector.mjs:125), limpieza de los prefijos en líneas 125–126.

Reproducción con el flujo exportado real y el doble de la suite existente: aparece una fila ajena que referencia el grupo huérfano justo antes de borrarlo. El recolector puntual detecta la referencia y lo omite. El finally elimina la fila ficticia original y pasa igualmente ambos prefijos propios a limpiarObjetoPropio, sin consultar si ahora tienen otras referencias. Borra m y g del grupo que acaba de conservar. La fila tardía sigue existiendo y su foto ya no existe. Que completa=false no evita la pérdida.

La prueba actual de referencia tardía pasa porque exige la omisión y el fallo de la corrida, pero no verifica que la limpieza conserve la foto usada por la fila tardía.

**Corrección requerida:** después de confirmar la ausencia de la fila propia, comprobar las referencias actuales de cada grupo en todas las tablas relevantes justo antes de su DELETE de limpieza. Con referencia presente o lectura incierta, conservar el grupo y registrar el pendiente. No borrar ni modificar la fila ajena. Limitar por UUID propio es necesario, pero no suficiente si ese UUID ya está en uso. Mantener documentada la ventana residual entre consulta y DELETE.

**Regresión:** añadir la referencia tardía a H y también a P; exigir que la fila ajena y sus dos variantes permanezcan después del finally. Probar consulta caída y que una referencia añadida tras limpiar el primer grupo protege el segundo.

Evidencia: evidencia-mixta-recolector-v3/diagnostico-recolector.json, primera reproducción. recolectorOmitio=1, filaSigueExistiendo=true, fotoGExiste=false.

## RG-02 — P2: se confirma un snapshot de filas comparando solamente sus IDs

Ubicación: [ensayo-recolector.mjs](C:/WedJaiseReact/scripts/lib/ensayo-recolector.mjs:131), comparación final. La afirmación de fila propia intacta en línea 97 también solo comprueba el id.

Reproducción: durante el ensayo cambia el título de una fila inicial ajena, sin cambiar su id. Al final su título difiere del snapshot, pero el harness devuelve completa=true y estadoFinalConfirmado=true. La comparación map(f => f.id) pierde URLs y metadata.

**Corrección requerida:** comparar snapshots completos de los campos seleccionados, con orden canónico por id y claves estables; verificar también los campos de la fila propia al afirmar que está intacta. Informar diferencias concurrentes sin restaurar ni sobrescribir los datos ajenos.

**Regresión:** mismo id y distinto título, antes_url, despues_url, activo u orden deben impedir confirmar el estado inicial. Un cambio únicamente en el orden de las filas debe seguir pasando.

Evidencia: evidencia-mixta-recolector-v3/diagnostico-recolector.json, segunda reproducción. título inicial y final distintos, completa=true y estadoFinalConfirmado=true.

## RG-03 — P2: el adaptador real interpreta un conteo ausente como ausencia de referencias

Ubicación: [medios-huerfanos.mjs](C:/WedJaiseReact/scripts/medios-huerfanos.mjs:81), estaReferenciado en líneas 78–85. El nuevo CLI importa y usa esta implementación existente; no es un problema exclusivo del doble del harness.

Reproducción sin red: el crearFuentes real usa el SDK real con un fetch ficticio. El login devuelve una sesión ficticia. Las cinco consultas HEAD devuelven 200 sin Content-Range. El SDK obtiene count=null sin error. count > 0 no se cumple y estaReferenciado devuelve false. Al conectar ese adaptador al recolectar real, se borra un candidato en memoria en lugar de abortar por lectura incierta. La prueba ejecuta diez HEAD ficticios: cinco para la consulta directa y cinco para el recolector.

No se afirma que el servidor real haya respondido así ni que se hayan perdido datos reales. El fallo es que una respuesta incompleta no se rechaza antes de autorizar el borrado.

**Corrección requerida:** exigir un conteo válido, entero y no negativo en cada respuesta puntual; count=null, ausente, no finito o inválido debe lanzar y conservar los objetos. Solo el cero confirmado puede apoyar el resultado false. Aplicar esa fuente estricta también a la limpieza de RG-01.

**Regresión:** probar el adaptador real con respuestas sin Content-Range, malformadas y con conteo cero/positivo; las incompletas deben abortar sin DELETE. No basta un doble que siempre devuelve booleanos.

Evidencia: evidencia-mixta-recolector-v3/diagnostico-adaptador-y-rutas.json, countAusente: resultadoConsulta=false, un borrado simulado y abortado=null.

## ML-01b — P2: la raíz del proyecto se puede aceptar con distinta capitalización en Windows

Ubicación: [salida-segura.mjs](C:/WedJaiseReact/scripts/lib/salida-segura.mjs:19). El constructor elimina los hijos propios cuando reemplazo=true en [construir-lectura-mixta.mjs](C:/WedJaiseReact/scripts/construir-lectura-mixta.mjs:67).

La prohibición usa ruta === base, mientras path.relative de Windows trata la misma ruta con distintas mayúsculas como idéntica. Las dos pruebas de pertenencia excluyen el resultado vacío y tampoco detectan esa igualdad.

Con raiz=C:/WedJaiseReact y un fs ficticio que informa carpeta existente y marca propia, la ruta exacta se rechaza, pero c:/wedjaisereact y C:/WEDJAISEREACT se aceptan con reemplazo=true. Son la misma raíz en este equipo. El constructor podría entonces borrar dist, servidor y el manifiesto en el proyecto.

**Condición y límite:** requiere --reemplazar y una marca propia en esa ubicación; no se demostró que esa marca exista en la raíz actual ni se ejecutó el constructor. No se borra toda la raíz con el código nuevo. Los casos originales de ruta exacta, ancestros y carpetas protegidas sí se corrigen.

**Corrección requerida:** comprobar identidad de rutas según la semántica del sistema de archivos antes de aceptar la salida o leer la marca; la prohibición de raíz debe prevalecer incluso con marca propia. En Windows, una comprobación de identidad con relative(base,ruta)==='' cubre esta reproducción. Añadir las variantes de capitalización a la regresión con --reemplazar y marca propia.

Evidencia: evidencia-mixta-recolector-v3/diagnostico-adaptador-y-rutas.json, tres entradas de rutas, sin borrados reales.

## Lo aceptado y lo pendiente del artefacto mixto

- ML-02: el paquete v2 tiene las dos Functions y entrega.js del mismo commit, sus tres hashes coinciden exactamente, los imports cargan desde una copia aislada y B funciona después de MISS, HIT y borrado ficticio, incluyendo GET, HEAD y condicional. dist tiene 180 archivos y _routes.json limita las Functions a /medios y /medios/*.
- ML-03: el módulo puro y el resolver real de la aplicación reescriben URLs propias antiguas de r2.dev a Pages conservando destino, UUID y variante. Las ajenas, Storage legítimo, relativas y base actual pasan los controles correspondientes.
- El paquete v2 declara ec2a3b64b4fe7ad96e29d43bf9aef61ea2aa1c04. Los cambios ML-03 siguen sin commit. No atribuirles comportamiento al frontend antiguo empaquetado. Después del futuro commit, regenerar el conjunto frontend + servidor y probar explícitamente resolverUrlGaleria sobre una URL antigua en esa versión exacta.
- Reescribir las lecturas de la aplicación no deshabilita el acceso público directo de r2.dev ni corrige Functions antiguas de URLs inmutables. Ese cierre y su rollback compatible siguen siendo un cambio externo aparte.
- Precisión editorial sin bloqueo: el comentario inicial de urlsMedios.js aún dice que resolverUrlGaleria devuelve URLs http(s) tal cual; actualizarlo para reflejar ML-03.

## Siguiente paso para Claude

Corregir ML-01b y RG-01/RG-02/RG-03 con regresiones independientes, conservar las correcciones ML-02 y ML-03 y devolver el paquete local para revisión. No ejecutar el ensayo real del recolector antes de cerrar estos bloqueos. La carga conserva su revisión local anterior; su ejecución real requiere la autorización acotada correspondiente.

HEAD leído: ec2a3b64b4fe7ad96e29d43bf9aef61ea2aa1c04. main local leído: 0dc629e430ed07eeaccec273d31de93e9717d9bf. No se consultaron ni cambiaron ramas remotas, el panel, el despliegue, variables, binding, Supabase, R2, r2.dev o GitHub Pages en esta revisión.

Los hashes de las fuentes revisadas y los resultados están en evidencia-mixta-recolector-v3/validacion-local.json. Los diagnósticos están guardados como .txt para lectura, no como herramientas ejecutables del proyecto. No se corrigió ningún archivo de implementación.
