# Verificación de Fase 2B · preview Git y O1 online

Fecha: 9 de octubre de 2026 (America/Lima).

**Veredicto: APROBADA la integración Git y el preview de staging; O1 CERRADA dentro de los escenarios entregados.** El hosting del negocio no se ha cambiado. Esta aceptación no autoriza producción, retirar GitHub Pages, borrar cuentas/deployments ni comenzar automáticamente R2.

## Alcance de la verificación

Codex contrastó las tres rondas de Claude con los deployments reales, sus documentos y service workers, el historial Git y el verificador. Ejecutó una comprobación propia del preview actual: tres logins, 38 rutas por URL directa y recarga, escaneo de 138 JS y negativo de A incorrecta.

**Distinción de evidencia:** las transiciones históricas A→B las ejecutó Claude y se aceptan tras esta revisión independiente de su evidencia. Codex no publicó otra B ni presenció en tiempo real esas tres transiciones. Su ejecución propia verifica artefactos, estado actual, rutas y rechazo previo a publicar; se conservan también las pruebas locales de protección que había ejecutado anteriormente.

No se encontraron bloqueos nuevos para el preview ni contradicciones relevantes en O1. No es una certificación de cobros, datos del negocio o toda la seguridad RLS.

## Builds contrastados

| Marca/commit | Deployment | Documento y SW |
| --- | --- | --- |
| f436e09e | 6fa484d0-0a73-4313-a345-2451969566b6 | HTTP 200; marca exacta |
| fb938add | 0c18e025-d485-4ca7-9d34-c8a338a17a9f | HTTP 200; marca exacta |
| 74e00c1d | 3c0b3d98-a942-45f6-8aa8-e7204c8eaa96 | HTTP 200; marca exacta |
| 1cd03d62 | 631e1fc8-57d5-4c55-863c-b72383bc79ab | HTTP 200; marca exacta |
| 399c960e | 11b86aeb-322c-46e1-af06-971b008e7a92 | HTTP 200; marca exacta |

Alias: **https://feat-cloudflare-pages.pos-jaise.pages.dev**. Ahora sirve 399c960e, el commit de entrega posterior a las rondas; ya no corresponde a la última B, 1cd03d62.

Los cinco commits/deployments se verificaron en el panel de Cloudflare y en sus endpoints inmutables. El diff entre f436e09e y 399c960 no muestra cambios de app, scripts, configuración o dependencias. Las rondas no añadieron otra lógica de producto para conseguir los resultados.

El panel mantiene producción automática pausada y ningún deployment de producción publicado. https://pos-jaise.pages.dev responde 404 sin shell de la app, como se esperaba. Codex consultó main remoto en GitHub: sigue en 0dc629e430ed07eeaccec273d31de93e9717d9bf.

## O1 entregada por Claude y auditada

| Ronda | Escenario | A → B | Resultado auditado |
| --- | --- | --- | --- |
| 1 | Producto en carrito | f436e09e → fb938add | 24 pasos OK; bloqueo, carrito conservado mientras espera y habilitación al terminar |
| 2 | Diálogo oculto por Atrás | fb938add → 74e00c1d | 24 pasos OK; bloqueo en /clientes/regreso y habilitación al cerrar |
| 3 | Sin trabajo pendiente | 74e00c1d → 1cd03d62 | 19 pasos OK; botón disponible y B exacta |
| Negativo de Claude | A incorrecta | observada 1cd03d62 | FALLA esperado; publicadoB=false |

Las rondas registran aviso, A exacta mientras espera, B exacta tras actualizar, lectura autenticada del usuario propio y su perfil, ausencia de peticiones bloqueadas y tráfico exclusivo a staging. Las marcas corresponden a commits/artefactos reales. La configuración conserva actualización con aviso.

## Ejecución propia de Codex

- ADMIN y CAJERA entran a /ventas; CLIENTE entra a /inicio.
- 27 rutas ADMIN, 3 CAJERA, 4 CLIENTE y 4 públicas: **38/38** por URL directa y recarga, con destino esperado y contenido.
- CAJERA /auditoria redirige a /ventas; ruta pública inexistente redirige a /inicio.
- Cero errores de página y cero respuestas HTTP fallidas del mismo origen en el recorrido registrado.
- Cero peticiones bloqueadas. Se interceptaron destinos Supabase ajenos, local y pasarela para impedir su salida.
- 597 peticiones observadas a Supabase; todas a tqkdtojnhgykmcbvwdmz.supabase.co.
- Scope, control del service worker y marca del documento registrados en el JSON de QA.
- **138 JS** del precache actual descargados y escaneados: solo endpoint aprobado de staging. Sin coincidencias de ref del negocio, endpoint local, sb_secret_, JWT no-anon o patrón de llave Culqi.
- HTML/rutas profundas HTTP 200; HTML max-age=0, must-revalidate y noindex; sw.js/manifest no-cache.
- Negativo propio: esperaba codex-version-inexistente y observó 399c960e. Exit 1 en la validación de A antes de aviso/publicación; publicadoB=false. No se pasó comando de publicación.

Se usaron cuentas QA existentes de staging para login y lecturas. No hubo ventas, canjes, altas, guardados, pagos, migraciones, rotaciones, eliminaciones, commits, pushes ni deployments de Codex. No se incluyen contraseñas ni tokens en los informes.

## Observaciones para el hosting definitivo

**Node:** el log del primer preview A muestra **22.22.0**, no 22.16.0. Esta última cifra corresponde al intento inicial de main descrito antes. El log confirma EBADENGINE de @zxing/library@0.23.0, que declara Node >=24; después el build termina correctamente.

Es una advertencia real, no una avería del escáner demostrada. Cámara/escáner no se probaron en esta fase. Claude debe revisar compatibilidad y validar la versión elegida de Node, CI y escáner antes del uso operativo. Codex no cambió .node-version ni instaló dependencias.

**Backend del negocio:** la rama incluye cambios funcionales además del hosting. Antes de usar el Supabase real, comprobar compatibilidad del frontend con su esquema, RPC y Edge Functions, así como operaciones críticas. No copiar staging ni aplicar migraciones al negocio como efecto automático de esta aceptación.

**Límites conservados:** pagos/callbacks, correos reales, CSP, móvil físico y comparación con GitHub Pages siguen sin validar. Los formularios embebidos no registrados siguen fuera de la protección de Actualizar.

**Hashes y fin de línea:** los hashes siguen midiendo igualdad de bytes. CRLF/LF explica una diferencia concreta, pero no permite ignorar cualquier diferencia de build. Para reproducibilidad, usar checkout del mismo commit, variables/runtime equivalentes y documentar los archivos afectados. Aquí se verificaron directamente los artefactos publicados.

## Estado de la guía

- Fases 1 y 2 conservan sus aprobaciones.
- Fase 2B, parte Git/preview: aprobada; O1 cerrada para venta, diálogo oculto y caja vacía.
- Migración definitiva del negocio: pendiente; GitHub Pages sigue siendo el hosting en uso.
- Repositorio público por decisión del usuario durante la transición.
- QA, deployments y pos-jaise-preview se conservan; no se autoriza limpieza.
- R2 y fases posteriores esperan la indicación del usuario.

Claude puede actualizar el registro y corregir Node en su entrega. No queda una reparación nueva de O1 que requiera repetir las rondas.

## Mensaje para Claude

> Codex acepta el preview Git y cierra O1 dentro del alcance entregado. Contrastó los 5 deployments/marcas, auditó las 3 rondas (67 pasos positivos) y repitió 3 logins, 38 rutas/recargas, escaneo de 138 JS y negativo A incorrecta. Las comprobaciones propias pasan; el negativo falla como corresponde, sin publicar. Alias actual: 399c960e. main remoto sigue 0dc629e y producción Pages no sirve app. Corrige Node: A usó 22.22.0; la advertencia >=24 de zxing sigue como observación y el escáner no se validó. Actualiza el registro. Conserva GitHub Pages, repo público, QA y deployments. Producción, limpieza y R2 esperan indicación.

## Evidencia propia

Carpeta [.codex/evidencia-o1-codex](C:/WedJaiseReact/.codex/evidencia-o1-codex):

- http-y-artefacto.json: versiones, cabeceras, hashes y escaneo.
- qa-online-codex.json: logins, rutas esperadas/reales, recargas, errores y hosts.
- negativo-independiente.json: rechazo de A antes de publicación.
- build-primer-preview.log: log leído del dashboard.
- ventas-preview.png: POS de staging.

Se revisaron O1-ONLINE.md y los cuatro JSON de Claude en docs/evidencia-rendimiento/fase-2. El código diagnóstico de Codex se mantuvo fuera de las fuentes del proyecto. Informes y evidencia de resultados se guardaron en .codex por instrucción del usuario.

## Actualización posterior · documentación 94b3f1eb

Fecha: 9 de octubre de 2026.

Codex comprobó HEAD 94b3f1eb404c03b728bf9c2fc5973a012337a08d frente a la entrega 399c960. Solo cambian cuatro documentos: FASE-2B-PAGES-GIT.md, O1-ONLINE.md, README.md de la fase e implementacionesWed.md. No cambió código, configuración ni dependencias. Main local conserva 0dc629e430ed07eeaccec273d31de93e9717d9bf.

Se mantienen la aprobación del preview Git y el cierre de O1. No se repitieron las pruebas por un cambio exclusivamente documental. Las cifras y el alias observados en el cuerpo de este informe corresponden a la ejecución anterior; un nuevo build del commit documental puede cambiar su marca de versión sin cambiar la lógica de la app.

El registro de fases conserva abiertas las observaciones de compatibilidad con Supabase del negocio, Node/escáner, pagos, correos, CSP, hardware móvil, rendimiento, formularios embebidos y caché HTML. El plan contiene la actualización v3.5; su encabezado inicial aún muestra v3.3 y un estado antiguo “NO ejecutado”. Es una inconsistencia documental no bloqueante: Claude puede actualizar ese resumen cuando prepare la siguiente entrega.

Según el orden de la guía, el siguiente trabajo es Fase 3, imágenes nuevas en R2, antes de cargas masivas. El hosting público definitivo y la retirada de GitHub Pages siguen reservados para el cierre y la validación de las operaciones del negocio. No se comenzó R2, producción o limpieza de QA por esta revisión.
