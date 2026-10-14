# Revisión del ensayo del recolector 73159d sobre 6929c619

Fecha local: 10 de octubre de 2026 (America/Lima); evidencia UTC del 11 de octubre. Codex audita en solo lectura. Claude ejecutó las escrituras y borrados de la corrida original.

## Veredicto

**Aceptada la evidencia de 13/13 casos del ensayo acotado de staging sobre 6929c619.** La clasificación con ambos relojes, el borrado selectivo y las señales de estado final son coherentes con el código revisado. Codex corroboró de forma independiente 38 controles sin fallos, incluida la ausencia actual de la fila propia, de referencias a ambos grupos y de objetos pendientes.

No se repitió el recolector ni se presenció la ejecución. Esta aprobación es para este harness y sus UUID ficticios, no para el recolector habitual, su automatización, toda la base de datos o producción. No cierra la ventana entre consulta y DELETE.

Informe original: [recolector-73159d.json](C:/WedJaiseReact/.codex/evidencia-recolector-6929c61/recolector-73159d.json). completa=true, estadoFinalConfirmado=true, error=null, pendientes=[], diferenciasFilas=[] y resumen con 13 casos y 0 fallos. El resultado es compatible con salida 0 según el CLI del ensayo; el JSON no registra explícitamente el exit code.

## Identidad y alcance de escritura

- Alias aprobado de Pages Preview, build-id 6929c619 e idEjecucion 73159d.
- Grupo protegido: fotos-galeria/3381083f-991c-4016-bdf1-b14fbb3f2269.
- Grupo huérfano: fotos-galeria/a48176af-a42f-41e0-98fe-8bc76ade05e0.
- Fila propia: 08446e4f-305c-4ab8-9f76-6691f76090f4, título QA recolector 73159d (borrar).
- Cuatro PUT 201, dos variantes m/g por grupo, y un INSERT confirmado 201.
- La fila tiene activo=false, orden=9999 y ambas URLs de Pages correspondientes únicamente al protegido; esos seis campos completos se verifican en la relectura.
- El recolector elimina el huérfano. La limpieza elimina la fila propia por id y, una vez confirmada su ausencia, el grupo protegido. No requiere ni ejecuta un cambio de esquema, RLS, retención o programación.

El JSON no conserva el HTTP status del DELETE de la fila. La afirmación de que fue 200 pertenece al relato de Claude; no se confirma con ese JSON. La seguridad de la limpieza depende de la relectura de ausencia, no de interpretar un 2xx como prueba suficiente, y ese orden está presente en el código.

## Clasificación y reloj revisados

| Etapa | aplicar | Retención | Objetos propios | Grupos referenciados | Candidatos | Eliminados |
| --- | --- | --- | --- | --- | --- | --- |
| Lectura, reloj real | false | 14 días | 4 | 1 | 0 | 0 |
| Aplicar, reloj real | true | 14 días | 4 | 1 | 0 | 0 |
| Lectura, reloj simulado | false | 14 días | 4 | 1 | Solo H | 0 |
| Aplicar, reloj simulado | true | 14 días | 4 | 1 | Solo H | Solo H |

Las cuatro etapas registran errores=[], omitidos=[] y abortado=null. Sus bloques principales y los duplicados en casos coinciden exactamente. El huérfano declarado pesa 1434 bytes en conjunto y su fecha de subida es 2026-10-11T03:35:22.390Z. El informe termina unos 27,9 s después, coherente con un objeto reciente. No demuestra que hayan transcurrido quince días reales: el futuro es un parámetro local del harness.

Tras el borrado selectivo, las únicas claves propias reportadas son m.webp y g.webp del protegido. La aserción del código vuelve a comparar todos los campos de la fila con el cuerpo previsto; el caso guarda las claves, no una segunda copia completa de la fila.

## Limpieza revisada

En el finally del harness:

1. Se lee y, si existe, se intenta borrar únicamente la fila propia por id.
2. Una relectura debe confirmar que ya no existe; si queda o la lectura falla, se conservan los objetos.
3. Antes de cada DELETE de limpieza se consulta si el grupo tiene referencias, con la fuente estricta de las cinco tablas. Se conserva ante referencia o duda.
4. Se compara el conjunto final de claves con el inicial y el snapshot canónico de id, título, ambas URLs, orden y activo de galeria_web.

El resultado registra un DELETE 200 de objetos en limpieza, confirmada=true, igualAlInicial=true, errores=[] y pendientes=[], coherente con que el huérfano ya se había eliminado y solo quedaba el protegido. filasIguales=true y diferencias=[] hacen consistente el estado final registrado.

Los snapshots completos inicial y final no se guardan como bloques crudos en este JSON; se registra su igualdad y las diferencias. Codex revisó la lógica y corroboró las condiciones actuales, sin sustituir eso por un snapshot inicial presenciado de forma independiente.

## Comprobaciones independientes: 38/38

Se verificaron identidad, UUID distintos, precondiciones, cuatro subidas, cuerpo completo de fila, retención, clasificación, ausencia de errores, único candidato/eliminado y conservación selectiva. Se contrastaron los cuatro resúmenes del recolector con sus casos y la consistencia temporal de la evidencia.

En las lecturas posteriores de staging:

- El alias mantiene 6929c619 y el sw.js conserva el hash 2eb8003dc69f00c9e40cb8e576dd01427b4589138474cf5596558ae57bf1b897.
- productos, producto_fotos, servicios, servicio_fotos y galeria_web no contienen referencias a ninguno de los dos grupos propios. Se leyeron solo id y columnas relevantes, con count=exact y cardinalidad exigida.
- galeria_web conserva únicamente Foto de prueba (Inicio); la fila por id y título de la corrida no existe.
- El inventario actual de fotos-galeria responde 200 con lista vacía y sin cursor.
- Las cuatro URLs propias P/m, P/g, H/m y H/g responden ahora 404 no-store con nosniff.
- El auditor realizó únicamente GET y un login de una cuenta QA ya existente. No ejecutó aplicar, POST de filas, PUT ni DELETE.

Los 404 posteriores corroboran ausencia actual; no se presentan como una nueva prueba de revocación con copia caliente o identidad de POP. Esa evidencia de B permanece en la auditoría del ensayo de carga y otras pruebas anteriores.

## Precisión sobre las fuentes acotadas

La expresión no pudo ver ni tocar datos ajenos necesita acotarse. **El recolectar recibe solo los grupos propios y su eliminar rechaza grupos ajenos.** Las fuentes subyacentes sí leen referencias de las cinco tablas y listados de objetos antes de filtrar, y el snapshot de galeria_web incluye filas ajenas para detectar cambios. No es aislamiento de lectura de la BD o bucket.

La corrida no demuestra preservación de todos los objetos y filas ajenos en otros destinos; ese comportamiento acotado tiene regresiones locales anteriores y las diferencias finales del snapshot seleccionado. Aquí se acepta la preservación dentro del alcance comprobado, sin ampliar el permiso a ejecutar el recolector general.

## Pendientes y siguiente frente

El ensayo acotado del recolector queda cerrado para staging con estas observaciones. No se programa ni se ejecuta nuevamente como consecuencia de esta aprobación.

Antes de automatizar el recolector habitual sigue siendo necesario corregir su salida con process.exit(0) cuando el informe contiene errores o abortado, y verificar sus casos de fallo. La garantía fuerte ante referencias concurrentes requeriría un mecanismo de servidor/quarantena/bloqueo; este ensayo no lo implementa ni lo acredita.

El siguiente frente de solo lectura útil es registrar CPU y consumo/cuota de las Pages Functions/Workers y lecturas R2 con B activa. No atribuir agregados de 24 horas exclusivamente a esta corrida, porque no hubo captura aislada antes/después. Siguen pendientes muestras reales de catálogo, Firefox/Safari/móvil, cierre de r2.dev/deployments alternativos, migración inversa general y criterios del hosting de producción.

HEAD leído: 6929c619e88a91434cb16ee6a8d2de90de94c091. main local: 0dc629e430ed07eeaccec273d31de93e9717d9bf. Archivos versionados sin modificaciones. No hubo commit, push, cambios de Cloudflare o escrituras de datos por Codex.

La aprobación de los ensayos de interfaz, carga y recolector acotado sigue siendo de staging. La Fase 3 completa no está aprobada para producción. Agrupar la documentación en el siguiente cambio útil, evitando un push exclusivo para archivar este veredicto.

Evidencia nueva: .codex/evidencia-revision-recolector-6929c61-73159d. Incluye resultados independientes, estado actual seleccionado, copia del informe original y hashes de fuentes. Los informes y datos originales se conservaron intactos.
