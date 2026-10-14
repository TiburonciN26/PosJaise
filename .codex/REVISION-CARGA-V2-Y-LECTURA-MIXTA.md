# Revisión: correcciones de carga y build de lectura mixta

Fecha: 10 de octubre de 2026, America/Lima. Codex, QA de solo lectura. Commit de referencia: `ec2a3b64b4fe7ad96e29d43bf9aef61ea2aa1c04`.

## Veredictos separados

**Carga: EC-01 y EC-02 CERRADOS en las reproducciones locales revisadas. Ensayo de carga aceptado localmente para preparar una autorización de ejecución remota acotada.** No se ejecutó ni autoriza con este informe.

**Lectura mixta: comportamiento básico del cliente comprobado; constructor y paquete de rollback NO aceptados para ejecución/despliegue mientras se corrigen ML-01 y ML-02 y se resuelve el alcance de ML-03.** Estos problemas no invalidan las correcciones de carga.

## Validación ejecutada por Codex

- Suite de carga: **29/29**, exit 0.
- Guardas: **49/49**, exit 0; incluye separación de los modos pages/r2dev/mixta.
- Sintaxis del CLI de carga y `oxlint` de los ocho archivos revisados: sin diagnósticos.
- Suite de lectura mixta: **6/6**, repetida desde una copia externa con la misma lógica, root explícita del proyecto, caché Vite exterior y red interceptada. No se cambiaron las fuentes originales.
- **6 escenarios independientes del flujo de carga real**, con Worker/inventario simulados: todos correctos. Conservan un objeto ajeno inicial y cubren conflicto inicial A/B, primer PUT confirmado con respuesta perdida, 409 tardío en B/g tras B/m ya subido y ETag ausente en la carga.
- Constructor completo en VM con FS y child_process simulados: **3 destinos** alcanzan el borrado recursivo sin guardas, sin borrar un solo archivo real.
- Inspección directa del artefacto existente, comparación de configuración/SW/rutas y fuentes declaradas con Git, sin reconstrucción ni instalación.

Las marcas ISO de los JSON pueden indicar 11 oct. UTC; esta revisión se realizó el 10 oct. en America/Lima.

## Cierre de EC-01 y EC-02

El núcleo ya rechaza ETags de referencia ausentes antes de leer y exige respuesta con ETag presente e igual al esperado. `crearLeerUrl` conserva null cuando falta el header. Las regresiones prueban también ese adaptador real.

El flujo valida UUID distintos y prefijos ausentes en el inventario inicial antes de fabricar/subir. Sin intención de escribir no ejecuta DELETE. Registra intención antes de cada PUT, mantiene la recuperación del primer PUT guardado cuya respuesta se perdió y conserva los grupos con 409 como pendientes. La limpieza excluye grupos en conflicto y no elimina prefijos iniciales en los escenarios revisados.

El control independiente con 409 tardío en B/g conservó tanto B/m de la ejecución como B/g ajeno, limpió A y dejó el estado sin confirmar y el conflicto informado. El caso sano mantuvo la clave ajena inicial, realizó 302 lecturas con nueve resúmenes por muestra y devolvió el inventario al inicial.

`completa` ahora queda false ante cualquier caso fallido, no solo ante retirada/limpieza incompletas. Se conserva la aclaración de percentiles con errores incluidos y presupuesto del núcleo separado de los GET/HEAD auxiliares.

### Identidad de la carga revisada

| Archivo | SHA-256 |
|---|---|
| ensayo-carga.cjs | `4804883d1e16503420ef458e0d0d0fe9d1c7694522dafd6f0f9fa30fd6e6975f` |
| ensayo-carga-flujo.cjs | `559c7fae4c0af3f2df13c2b5b8b9c831f1d575a1a863d85d82a5f43c1f48d758` |
| ensayo-carga-medios.cjs | `f5e83ffa10ed5d7dca32762f12169f7a8db67718be7edb20b12b936342004339` |

## ML-01 — P1: el constructor borra una salida arbitraria sin proteger el proyecto

`scripts/construir-lectura-mixta.mjs` resuelve `--salida`, pero luego ejecuta `rmSync(SALIDA, { recursive: true, force: true })` sin rechazar la raíz del proyecto, `.codex` u otra carpeta existente ajena al artefacto.

En la VM segura, los argumentos `--salida=C:/WedJaiseReact`, `--salida=C:/WedJaiseReact/.codex` y la carpeta del artefacto existente llegaron a ese borrado. Se detuvo el diagnóstico en el primer rmSync; no hubo archivo eliminado, git archive real, npm ci ni build.

**Corrección requerida:** rechazar por defecto una salida existente; crear una carpeta nueva dedicada y resolver/validar su ruta antes de operaciones. Proteger raíces/ancestros del workspace y carpetas de fuente/configuración/evidencia. Si se permite reemplazar un artefacto, exigir una opción explícita y una identificación comprobable de carpeta propia, con ruta acotada; no usar force como validación. Preservar también comprobaciones antes de borrar el temporal propio. Añadir negativos de raíz, `.codex`, carpetas ajenas y salida existente. No probarlos con borrados reales.

El hecho de que la ejecución de Claude usara correctamente la carpeta de artefacto no elimina el riesgo del constructor reutilizable.

## ML-02 — P2: el paquete guardado no incluye el servidor que necesita B

La carpeta `.codex/artefacto-lectura-mixta/` contiene solo:

- `dist/` con 180 archivos.
- `manifiesto-lectura-mixta.json`.

**No contiene `functions/`, `cloudflare/medios-pages/entrega.js` ni `_worker.js`.** El constructor lista sus hashes, pero no copia esos módulos a la salida; al terminar, borra el clon temporal salvo `--conservar`.

El frontend y su configuración son correctos: proveedor supabase, lectura R2 por Pages, Worker configurado, base extra reconocida; SW con hash `fb19ee995ca5219bedfe6872c4aa8a38973d75180f4b5143897f097f748e371d`, exclusión de `/medios`, `_routes.json` versión 1/include exactos/exclude vacío, sin 404.html ni hallazgos del escáner de backend/clave prohibidos. Eso no sustituye el payload del servidor.

Los tres hashes de Function declarados coinciden con las fuentes del commit al considerar su representación CRLF. No se encontró un cambio de contenido; no confundir comparación de bytes con finales de línea. El problema es **ausencia de los archivos**, no que esos hashes identifiquen otro código.

**Corrección requerida:** empaquetar los módulos/entrypoints y sus dependencias del commit exacto, o el servidor compilado apropiado, y el manifiesto de todos los archivos necesarios. Validar que todos los imports se resuelvan dentro del paquete. Probar la restauración desde una copia aislada de ese paquete, sin apoyarse en el checkout actual ni en un temporal que se borra; conservar y verificar B, rutas y el binding necesario. No desplegar todavía.

Cloudflare documenta Functions en la raíz del proyecto, separadas de `dist`, o un `_worker.js` en modo avanzado; subir solo el frontend no acredita la Function acompañante. [Documentación oficial](https://developers.cloudflare.com/pages/functions/get-started/).

## ML-03 — P2 de alcance/transición: una URL antigua de Galería aún usa r2.dev

Con el cableado real de lectura mixta, `resolverUrlGaleria('https://pub-0000.r2.dev/fotos-galeria/<uuid>/g.webp')` devuelve **esa misma URL**, no Pages `/medios`. La suite prueba su reconocimiento para administrarla y borrarla; eso no demuestra que su lectura pase por B.

El comentario del constructor dice «r2.dev solo como base reconocida, no como entrega» y la entrega de Claude afirma lectura de URLs de Galería por Pages. Esa afirmación debe acotarse o hacerse cierta antes de aceptar el rollback con datos que todavía tengan tales URLs.

**Resolución requerida:** implementar y probar el desvío de lectura solo de URLs propias/aprobadas a Pages, conservando variante, o fijar una migración previa de esas filas con inventario y precondición verificable. Probar `resolverUrlGaleria` sobre URLs completas antiguas/nuevas y no alterar URLs ajenas/Supabase/relativas. Conservar reconocimiento para gestionar lo viejo no obliga a seguir entregándolo por r2.dev.

Si se elige la migración previa, la condición debe acompañar al artefacto y al plan de despliegue; no declararlo compatible con cualquier fila antigua antes de verificarla. Cerrar el acceso público del bucket es un cambio externo aparte, no una operación de este constructor. Tampoco se promete borrar copias ya descargadas.

## Borrado y subida del cliente: precisión de la prueba

La suite de seis casos comprueba el provider de nuevas subidas y la lectura R2 por la base Pages. Su caso de borrado R2 sin sesión solo genera un pendiente local: por sí solo no demuestra una llamada al Worker.

Codex añadió un control con sesión ficticia y fetch interceptado. El `eliminarFoto` real confirmó el borrado y emitió un DELETE al endpoint Worker configurado; no hubo petición externa. El borrado antiguo de Storage y el fallback de nuevas subidas también pasan con clientes simulados. No se afirman permisos/resultado reales de Cloudflare o Supabase a partir de esos dobles.

## Próximos pasos

1. Claude corrige el constructor/paquete/transición de Galería y añade regresiones, manteniéndolo local. Puede preparar el harness del recolector en paralelo, limitado a UUID propios, sin ejecutarlo destructivamente ni programarlo.
2. La carga ya puede presentarse para una autorización separada: dos grupos ficticios, cuatro PUT, carga acotada y limpieza de lo propio sobre el build B correcto. Revisar el estado vigente antes de ejecutarla y mantener salida nueva en `.codex`. Este informe no da esa autorización.
3. El rollback mixto se acepta únicamente tras comprobar el paquete completo y su contrato B. No cerrar `r2.dev` ni alterar variables/binding/producción por inferencia.

No se hizo commit, push, despliegue, npm ci, build, modificación de fuentes, cambio de configuración ni escritura en datos remotos. La inspección del artefacto existente fue de lectura. Los diagnósticos propios y la caché SSR se guardaron fuera del proyecto; solo se copian informe/evidencia nuevos a `.codex` por instrucción del usuario.

Evidencia en `evidencia-carga-mixta-v2/`: validación local, diagnóstico del flujo corregido, borrado de salida en VM, lectura SSR, inspección del artefacto y comparación de finales de línea. Las reproducciones se conservan como `.txt` para no introducir scripts ejecutables al proyecto.
