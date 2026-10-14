# Verificación de Fase 3 · tercera revisión de Codex

Fecha: 9 de octubre de 2026, America/Lima. Evidencia guardada en UTC.

**Veredicto: Fase 3 NO APROBADA todavía. Queda un bloqueo P1 en F3-07: el reintento con ID duplicado y lectura de reconciliación inaccesible elimina fotos ya referenciadas.** Se reconocen las correcciones de retención, exclusión de doble guardado y coste del parser, así como los avances del recolector. No se solicita rehacer esas partes.

No se modificaron fuentes, configuración, dependencias, datos remotos ni Git. No se activó R2 ni se publicaron recursos. La fila residual de staging permanece intacta. Se generan únicamente este informe y su evidencia en .codex según la autorización del usuario.

## Verificación independiente

| Prueba | Resultado |
|---|---|
| Unitarias, fixtures WebP Chromium y fuentes en memoria | 54/54 |
| Worker con Wrangler local y R2 simulado | 33/33 |
| Capa de medios en navegador | 24/24 |
| Modales reales, REST en memoria y Worker local | 36/36 |
| Total de las cuatro suites entregadas | **147/147** |
| Build Vite con staging/R2 simulado, salida externa | Pasa |
| Rollback: git apply -R --check | Pasa; no aplicado |
| Regresión propia: INSERT confirmado, respuesta perdida, GET inaccesible y reintento 23505 | **Falla en Producto y Galería** |
| Aislamiento de esa regresión; errores de página | Pasa: ninguna petición de datos no simulada, cero pageerror |

Las suites se ejecutaron desde copias externas con adaptación únicamente de rutas, puertos, lanzadores de binarios instalados, caché y limpieza. Las pruebas originales no se alteraron. No se instalaron dependencias. Las tablas y Storage se simularon/bloquearon; staging solo se empleó para login QA y autorización de lectura del Worker.

Lint completo: 2 errores y 54 advertencias. Diez advertencias pertenecen a copias de diagnóstico que Codex guardó en .codex/evidencia-fase3-codex-v2 en la revisión anterior, y no a los cambios de Claude. Al ejecutar el mismo lint con la opción temporal --ignore-pattern .codex/** queda la línea base: **2 errores y 44 advertencias**. Los errores son fixtures.mjs:11 y :27, sin cambios en ese archivo. No se cambió la configuración de lint. La evidencia de código de esta revisión se guarda con extensión .txt para no añadir más archivos ejecutables al recorrido del linter.

Árbol revisado: feat/cloudflare-pages; HEAD 940510543f629df11ce80d558399c7ef32bebb68; main 0dc629e430ed07eeaccec273d31de93e9717d9bf. Fase 3 continúa sin commit. metadatos.json conserva hashes de las fuentes revisadas.

## Estado de F3-05 a F3-09

| Hallazgo | Estado tras la revisión |
|---|---|
| F3-05: referencias cambiantes y paginación | Reproducciones originales corregidas. Consulta puntual por candidato y paginación por llave verificadas. **La eliminación real sigue condicionada** a resolver/aceptar el modo operativo descrito abajo; no es una garantía atómica. |
| F3-06: parámetros de retención y flags | **Cerrado para los casos revisados.** Valores inválidos se rechazan antes de leer/borrar; --aplicar=false da error. Default 14 días; mínimo configurable 1 día, explícito en el código. |
| F3-07: resultado incierto de BD | **Abierto/P1.** Recuperación normal funciona, pero una reconciliación inaccesible durante el reintento 23505 sigue borrando archivos válidos. |
| F3-08: doble guardado de Servicio | **Cerrado para los casos revisados.** Guarda sincrónica por ref, botón bloqueado hasta terminar galería, envíos repetidos ignorados; una fila/una foto/un evento en el caso lento. |
| F3-09: parser cuadrático | **Cerrado a nivel de código y diagnóstico local.** Un recorrido con Set, salida temprana y máximo de 8 chunks. La CPU del Worker real no está medida. |

F3-01 y F3-02 conservan el cierre de sus casos originales. F3-03/F3-04 mantienen sus correcciones y las restricciones derivadas del guardado incierto y del recolector real.

### Comprobaciones propias adicionales de las correcciones

- NaN, -1, 0, Infinity y texto: rechazo con **cero lecturas y cero borrados**.
- --aplicar=false: rechazo explícito.
- B pasa a estar referenciada tras borrar A: consulta puntual detecta B y **no la borra**.
- Los casos de paginación por llave y control negativo por offset pasan en la suite unitaria repetida.
- Payloads anteriores de 1.000/4.000/8.000 chunks (8.044/32.044/64.044 bytes): rechazo temprano; medianas locales de nueve repeticiones **0,013/0,004/0,007 ms**. Son tiempos de la función en Node 24.14.1, no CPU de Cloudflare. Las variaciones pequeñas no indican crecimiento con el tamaño; la estructura del algoritmo elimina el filtro anidado.

## F3-07 · Una lectura inaccesible en el reintento hace borrar fotos confirmadas

**P1 / alta. Mantener como bloqueo de activación del flujo R2.**

Fuentes:

- [galeriaFotos.js](C:/WedJaiseReact/src/lib/galeriaFotos.js:81): tras 23505, filaCoincide se reduce a un booleano con === true; si la lectura devuelve null, guardada queda false y el 409 se considera rechazo confirmado para limpiar en :90–91.
- [ModalGaleriaWeb.jsx](C:/WedJaiseReact/src/components/ModalGaleriaWeb.jsx:202): mismo patrón de reconciliación y limpieza en :211–221.
- [resultadoBd.js](C:/WedJaiseReact/src/lib/resultadoBd.js:19): clasifica el 409 de la petición actual como rechazo confirmado. Eso no prueba que una petición anterior con respuesta perdida no haya confirmado la fila.

### Reproducción desde los modales reales

Se ejecutó con la interfaz de Chromium, el Worker local y R2 simulado. El simulador REST es el de Claude; se combinan sus fallos ya soportados, sin escribir en Supabase.

1. Abrir Producto en modo Web y elegir una foto de galería, o abrir una Galería nueva y elegir antes/después.
2. Configurar la siguiente respuesta POST como perdida **después de commit**.
3. Interrumpir las lecturas GET de esa tabla, incluida la lectura de reconciliación.
4. Pulsar Guardar. La fila existe en el simulador, las fotos se conservan y aparece el mensaje incierto: este primer paso funciona.
5. Pulsar Guardar otra vez sin recuperar los GET. El POST reutiliza el ID y responde **409 / 23505** porque la fila del primer intento ya existe. La lectura vuelve a fallar.
6. El código borra las fotos y deja la fila confirmada apuntando a objetos ausentes.
7. Restaurar las lecturas y reintentar. Producto llega a emitir éxito manteniendo la foto ausente; Galería queda sin recuperar la fila original, cuyas dos fotos ya se borraron.

Resultados observados:

| Modal | Tras primer intento | Tras segundo intento, lectura aún inaccesible | Tras recuperar GET y reintentar |
|---|---|---|---|
| Producto, galería adicional | 1 fila, foto presente, 0 éxitos, mensaje incierto | **1 fila, foto ausente**, 0 éxitos | 1 fila, foto ausente, **1 evento de éxito** |
| Galería antes/después | 1 fila, ambas fotos presentes, 0 éxitos | **1 fila, ambas fotos ausentes**, 0 éxitos | La fila original continúa con ambas fotos ausentes; 0 éxitos |

No se atribuye una pérdida de datos al Supabase real: todo lo escribible estaba simulado. Se demuestra la decisión incorrecta de cleanup del frontend en una secuencia válida de respuestas y errores de red.

### Causa y corrección recomendada para Claude

La recuperación necesita mantener tres estados: confirmado, descartado y **desconocido**. Un GET fallido devuelve null, pero la condición === true colapsa ese desconocido a false. Después se decide limpiar basándose en el resultado de la última petición, sin considerar el commit posible de la operación anterior.

Un 23505 confirma que el INSERT actual fue rechazado porque ya hay una fila; **no confirma que las fotos de esa fila sean huérfanas**. Con la lectura inaccesible no se puede concluir que sea seguro borrarlas.

- Mantener explícito el resultado triestado de la reconciliación y el historial pendiente de la operación.
- Con 23505 y reconciliación desconocida, conservar fotos, ID y referencia; informar incertidumbre y permitir un reintento de reconciliación seguro.
- No borrar ni olvidar las subidas basándose solo en un 4xx posterior a una operación cuyo resultado anterior continúa incierto.
- Contar éxito únicamente tras confirmar la fila y sus referencias válidas. Si ya se eliminaron los objetos por un fallo previo, no anunciar éxito sin recuperar/corregir el estado.
- Revisar la misma regla de cleanup en los guardados de foto principal. No es necesario cambiar el esquema o activar recursos externos para reproducir y corregir esta decisión.

### Aceptación de la corrección

Convertir la secuencia anterior en regresión para Producto, Servicio (usa la misma función compartida) y Galería:

1. POST con commit + respuesta perdida + GET inaccesible conserva los archivos.
2. Reintento con 23505 + GET todavía inaccesible también conserva archivos e identidad. Puede repetirse varias veces sin borrados ni duplicados.
3. Cuando GET vuelve, queda una sola fila, mismas referencias, todas las variantes existentes y un único resultado de éxito.
4. El caso sin commit conserva una vía de reintento válida; un rechazo explícito sin operación previa incierta mantiene su cleanup seguro.
5. Las 147 comprobaciones existentes siguen pasando.

Esta regresión cubre la promesa de «si sigue sin saberse, queda pendiente y el reintento no rompe referencias». Las pruebas entregadas comprueban pérdida de respuesta con una lectura de reconciliación disponible; no mantienen el GET inaccesible hasta el conflicto del reintento.

## Condiciones que siguen abiertas y no son nuevas correcciones de esta ronda

### Recolector

La consulta por candidato reduce la carrera original; no cierra el intervalo entre consulta y DELETE. La entrega reconoce ese límite y el recolector no se programa ni se usa de forma destructiva. Se acepta el avance y su modo informativo; **esta revisión no autoriza eliminación real ni certifica una garantía atómica**.

Antes de habilitarlo, decidir y validar un procedimiento que impida ediciones concurrentes o una coordinación del servidor/cuarentena. La recomendación «ejecutarlo sin ediciones» necesita una precondición operativa verificable cuando se vaya a usar. La retención se calcula desde la fecha de subida del objeto: no demuestra por sí sola que hayan transcurrido 14 días desde su última referencia. Mantener la política de 14 días publicada; un mínimo técnico configurable de 1 día no cambia esa política por sí solo.

### Infraestructura y retorno

Siguen pendientes R2 real, dominio, CORS desde Pages, HIT/MISS de caché, CPU, Firefox/Safari/móvil y fotos representativas de catálogo. La prueba local no certifica ninguno de estos resultados.

La purga de caché y la migración inversa siguen sin decidir/implementar. No escribir referencias R2 en el negocio mientras el retorno al hosting anterior no pueda leerlas o se valide su conversión a Supabase. No se retira GitHub Pages en esta revisión.

La fila QA residual id 5bb670df-db45-4c70-a6aa-40b856fbf8a6 se conserva. No se solicitó autorización nueva para borrarla ni se ejecutó el recolector destructivo contra un servicio real.

## Evidencia

Carpeta: C:/WedJaiseReact/.codex/evidencia-fase3-codex-v3/.

- suites-repetidas.json y logs de las cuatro suites: **147 comprobaciones repetidas**.
- pruebas-unitarias.json, pruebas-navegador.json, pruebas-modales.json: resultados detallados.
- reconciliacion-inaccesible.json: primer intento, conflicto con GET fallido y tercer intento para ambos modales; aislamiento y ausencia de errores de página.
- diagnosticar-reconciliacion.cjs.txt: reproducción con el simulador original y modales reales; se guardó como texto documental, sin modificar el producto.
- regresiones-independientes.json y su script .mjs.txt: retención, flag, referencia cambiante y parser, sin red.
- build.log, lint.log, lint-sin-evidencia.log, metadatos.json: build, diferenciación del lint y hashes de código revisado.
- preparar-suites.cjs.txt y repetir-suites.cjs.txt: adaptaciones de ejecución de QA. Las rutas de trabajo son externas al proyecto y específicas de esta máquina; ajustar rutas en un directorio de pruebas, no en las fuentes del producto.

**Siguiente paso concreto:** corregir únicamente la reconciliación pendiente de F3-07 y añadir la regresión combinada. Repetir esa prueba y las suites pertinentes. Las correcciones ya verificadas conservan su aceptación; R2 real permanece como una validación posterior y separada.
