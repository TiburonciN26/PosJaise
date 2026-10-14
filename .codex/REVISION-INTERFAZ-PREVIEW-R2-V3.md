# Revisión V3: cierre local de las guardas del verificador

Fecha: 10 de octubre de 2026, America/Lima. Codex actúa como QA de solo lectura.

## Veredicto

**IP-R1, IP-R2, IP-R1b e IP-R2b quedan cerrados en la revisión local del verificador.** Repetí las 41 regresiones: cero fallos. No encontré un nuevo bloqueo en las correcciones revisadas.

Se puede avanzar a preparar la repetición real después de resolver el fixture residual con autorización del usuario. La versión corregida todavía no tiene un recorrido completo contra Pages/R2 reales. No se aprueba por este informe la Fase 3 completa, el cambio de producción o el retiro de GitHub Pages.

## Comprobaciones de Codex

- Leídas la librería `scripts/lib/guardas-interfaz-r2.cjs`, sus regresiones, el verificador y las notas del runbook §14/changelog.
- Ejecutado `node scripts/verificar-guardas-interfaz-r2.cjs`: **41/41**. Las pruebas usan dobles en memoria y, para las redirecciones, dos servidores HTTP locales efímeros con datos ficticios. No hubo peticiones a Supabase o Cloudflare.
- `node --check` pasa para los tres scripts.
- Lint de los tres scripts con el linter real del repo (`oxlint`): salida 0, sin diagnósticos.
- `npm run lint` global: salida 1, **2 errores y 54 advertencias**. Los errores siguen en `tests/e2e/fixtures.mjs`, reglas de hooks, líneas 11 y 27. Parte de las advertencias procede de evidencia antigua de `.codex` que el linter también escanea. Por tanto «lint limpio» describe los scripts de esta entrega, no todo el proyecto.
- HEAD inspeccionado: `ba07a32a78bcbad12f594e9fc842b49640d42b61`; no se ejecutó commit, push ni fetch.

No ejecuté el recorrido real del verificador: escribe datos remotos. No borré la fila residual, cambié credenciales o recursos externos, ni instalé dependencias. La prueba global de lint es de diagnóstico, sin `--fix`.

## Correcciones aceptadas

**IP-R1b, redirecciones.** `crearFetchSeguro` impone `{ ...opciones, redirect: 'error' }`: el llamador no puede habilitarlas. Se rechaza el 307 local con cero peticiones al segundo origen, incluido un intento de override con `redirect: 'follow'` y el GET usado por el preflight. La inspección confirma que la misma guarda se aplica a los `fetch` del verificador.

**IP-R2b, limpieza.** `limpiarFilaPropia` intenta borrar la fila, consulta nuevamente su existencia y conserva los objetos mientras la fila exista o el resultado sea desconocido. Solo tras ausencia confirmada elimina sus grupos. Los escenarios de rechazo 403/500, 204 sin efecto, respuesta perdida con/sin commit, lectura caída y fallo del Worker pasan. Los resultados y pendientes reflejan lo confirmado; el verificador utiliza esta función en su cleanup.

**Inventario.** La lectura rechaza un cursor no vacío en vez de tratar la primera página como inventario completo. Es una parada segura para este verificador; no equivale a implementar paginación.

**Evidencia por corrida.** Los errores a mitad del recorrido se capturan y se registra `errorCorrida`. Se genera un JSON separado bajo `interfaz-preview/corridas/`, con la marca esperada, identificador, resultados, bloqueos y limpieza. `resultados.json` conserva el 21/21 histórico. Esto evita atribuir ese recorrido antiguo al script corregido.

Precisión no bloqueante: fallos anteriores al `try` del recorrido (configuración/preflight, login por API, snapshot inicial o arranque del navegador) todavía terminan en el `catch` exterior y no llegan al JSON de corrida. El mecanismo cubre las interrupciones durante el recorrido, no literalmente toda posible ejecución. No produjo escrituras previas por ese motivo en las pruebas revisadas.

## Pendiente real y siguiente paso

La fila residual conocida es `5bb670df-db45-4c70-a6aa-40b856fbf8a6`, «QA fase 3 (borrar)», en el Supabase **de staging**. Sus URLs locales hacen que la guarda bloquee el listado de Galería. No debe relajarse esa guarda para terminar la prueba.

Mi recomendación mantiene la eliminación **solo de esa fila ficticia**, por Claude y con autorización explícita del usuario, conservando «Foto de prueba (Inicio)». Antes de eliminarla se debe confirmar el proyecto de staging, ID y contenido; no ampliar el borrado por título o prefijo. Este informe no ejecuta ni otorga la autorización.

Tras esa decisión: repetir el recorrido real completo, aportar el JSON nuevo (sin atribuirle el 21/21 anterior), evidencias y verificación de limpieza; revisión de Codex; validación del commit exacto en checkout limpio; push autorizado exclusivamente a `feat/cloudflare-pages`. La marca esperada deberá corresponder al deployment concreto probado.

La rotación de contraseña está anotada por Claude sin valores. Codex no probó la contraseña antigua/nueva ni realizó esa rotación; no hace falta compartirlas para revisar esta entrega.

Continúan fuera de esta aceptación local: fotos reales del catálogo, Firefox/Safari/móvil físico, carga/concurrencia, CDN y cabeceras del dominio de medios, purga, operación destructiva del recolector, migración inversa y validación final del negocio. El hosting del negocio conserva su estado anterior.

## Evidencia y alcance de escritura

Evidencia nueva en `.codex/evidencia-interfaz-preview-r2-v3/`: `regresiones-41.txt` y `lint-global.txt`.

Se crearon únicamente este informe y copias de su evidencia bajo la autorización persistente del usuario para guardarlas en `.codex`. No se modificó la aplicación, configuración, Git, datos, objetos, usuarios ni credenciales.
