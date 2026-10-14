# Estudio preliminar de purga y contrato de retirada de medios

10 de octubre de 2026, America/Lima. Solo lectura de código, documentación primaria y URLs públicas. Sin purgas, endpoint nuevo, token, instalación, cambio de caché, deploy o escritura de datos. El dominio propio sigue siendo opcional para el futuro.

## Conclusión para este proyecto

**No se debe presentar un cache.delete local ni la limpieza del build cache como una purga global de las fotos de Pages.** No identifiqué en las fuentes consultadas un mecanismo público validado para que esta cuenta purgue globalmente el `caches.default` del proyecto en `*.pages.dev`. Eso es una conclusión limitada de documentación/arquitectura, no una prueba de imposibilidad absoluta ni una llamada de API rechazada.

Se puede continuar entregando R2 por Pages sin comprar dominio. Antes de implementar, hay que elegir un contrato: retención temporal aceptada o rechazo de futuras entregas después del borrado. La segunda opción se puede estudiar mediante validación de existencia en R2, sin equipararla a borrar todas las copias físicas de caché.

## Qué caché usa el código actual

Las Functions llaman `manejarMedios` con Cache API. La clave es GET de origin+pathname, sin query; Cache API se consulta **antes** de R2. En un HIT se entrega el cuerpo y el ETag sin comprobar que el objeto siga existiendo en el bucket. La copia edge y la respuesta al navegador llevan public,max-age=300. No hay endpoint de invalidación ni tags de purga en esa lógica.

La Cache API funciona en Pages Functions sobre pages.dev, pero su contenido y cache.delete son locales al centro de datos. La retirada en un POP no certifica otros POP ni el navegador. [Cloudflare Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/).

La función no precachea las fotos: VitePWA precachea el shell y no configura runtimeCaching; la navegación de /medios se excluye del fallback. No se propone borrar el service worker completo para retirar una foto.

## Mecanismos comprobados en documentación

| Mecanismo | Alcance | Consecuencia para el diseño actual |
| --- | --- | --- |
| Expirar TTL | Cada caché tiene su propia frescura | Conserva performance, pero no es retirada inmediata ni una purga ejecutada |
| cache.delete dentro de la Function | POP de esa ejecución | Puede ser auxiliar local; no cumple una promesa global |
| API de purga CDN | Una zona y sus recursos autorizados | Exige asociar la clave a una zona gestionada y validar compatibilidad; no usar un zone_id de otro dominio para pages.dev |
| purge_build_cache de Pages | Artefactos reutilizados al compilar | No elimina respuestas de fotos ya servidas |
| ctx.cache.purge de Workers Caching | El otro mecanismo de caché de un Worker | No purga las entradas actuales de caches.default |

La API estándar de purga utiliza `/zones/{zone_id}/purge_cache` y permiso Cache Purge. Un success:true confirma aceptación, no que una entrada concreta existiera o desapareciera. [API de purga](https://developers.cloudflare.com/api/resources/cache/methods/purge/).

Cloudflare documenta purgas globales de Cache API mediante las opciones de zona, con limitaciones de claves personalizadas. La clave del proyecto es canónica, no una clave `cf.cacheKey`, pero contiene el origen: alias e inmutable son claves distintas. Un futuro dominio gestionado debe considerar todos los orígenes que sigan sirviendo medios; no garantiza por sí solo retirar los alias pages.dev. [Cache API y purgas](https://developers.cloudflare.com/workers/reference/how-the-cache-works/#purge-assets-stored-with-the-cache-api).

El endpoint de Pages elimina **build artifacts**, no el contenido de Cache API. El botón/call de ese nombre no resuelve este pendiente. [Pages build cache](https://developers.cloudflare.com/api/resources/pages/subresources/projects/methods/purge_build_cache/).

La documentación actual también ofrece Workers Caching y `ctx.cache.purge`. Explica expresamente que es independiente de Cache API y que las operaciones de uno no afectan al otro. No añadir esa llamada al código actual suponiendo que invalida caches.default. Adoptar otra arquitectura/cache sería un diseño y aprobación distintos. [Limitaciones y separación](https://developers.cloudflare.com/workers/cache/limitations/#cache-api-cachesdefault).

## Navegador: no fijar aún una garantía universal de cinco minutos

Según HTTP, max-age y Age determinan la frescura; no-cache exige validar antes de reutilizar, y no-store impide almacenamiento de la respuesta nueva. Cambiar el edge no controla una copia que el navegador reutiliza sin contactar con el servidor. [MDN Cache-Control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control).

**Hecho de código y doble local:** `responder()` reconstruye headers con max-age=300 y no conserva Age/Date de la respuesta almacenada. El diagnóstico con una copia de Age=299 retorna HIT 200, Age/Date ausentes y el mismo max-age=300. No se ejecutó Cloudflare ni navegador en ese doble.

**Inferencia a validar:** un HIT cerca de expirar en edge podría dar nueva frescura al navegador. Por ejemplo ilustrativo, una copia edge casi de 300 s podría permitir otros 300 s en una respuesta reconstruida si no se transmite su edad correctamente. No se midió una ventana real de 600 s; no se propone ese número como garantía. La prueba de TTL de 315 s en Node solo observa peticiones que sí llegan al servidor.

Hay otra capa en la transición: el Worker guarda metadata R2 con `public,max-age=31536000,immutable`. Pages lo sustituye por su TTL corto, pero una respuesta directa r2.dev conserva la política larga. Las URLs de respaldo/rollback no comparten automáticamente el contrato de Pages; no prometer retirada rápida de todas las copias usando un solo TTL. Esta observación procede del código y los resultados previos de r2.dev, no de una subida nueva.

Las imágenes ya descargadas o visibles en una página abierta tampoco desaparecen por una purga del servidor. El contrato debe distinguir ocultar referencias en la web, bloquear futuras entregas y retirar cachés compartidas; no prometer borrar lo que ya está en el cliente.

## Alternativas sin comprar dominio ahora

### Contrato de retirada temporal

Mantener fotos con URLs únicas, eliminar referencias y objeto por el flujo seguro y aceptar una ventana de caché. Separar explícitamente TTL edge y política de navegador, en vez de suponer que ambos equivalen a cinco minutos desde el DELETE. Podría diseñarse copia edge corta y respuesta cliente revalidable para acotar futuras reutilizaciones; no se modificaron headers aquí. Debe contemplar URLs antiguas y respuestas ya almacenadas.

Esta es la alternativa menos invasiva si el negocio acepta retención temporal. El periodo exacto y la política del navegador son una decisión pendiente; no se cierran por este estudio.

### Revocación de entrega mediante comprobación R2

Diseño candidato: comprobar existencia con binding R2 antes de servir HIT y antes de devolver 304. Si ya no existe, responder 404 no-store; si la comprobación falla, no usar el cuerpo antiguo como si la retirada estuviera validada. Política de navegador que exija volver al servidor en futuras reutilizaciones. Comparar también ETag si se permite reutilizar claves. No usar una lista de revocaciones con propagación no validada para prometer inmediatez.

R2 documenta consistencia fuerte tras borrar, también en lecturas/listado, y sus bindings acceden al bucket sin pasar por caché HTTP. [Consistencia R2](https://developers.cloudflare.com/r2/reference/consistency/). Por ello es un candidato para validar la retirada sin zona/dominio propio, **no una implementación probada ni una purga física global**.

Habría una lectura de metadatos adicional por petición; medir CPU, latencia y número de operaciones antes de escogerlo. Definir la garantía para peticiones posteriores al DELETE confirmado, contemplar las que estaban en vuelo y evitar repoblar/servir una foto retirada por carreras. No cubre las descargas directas de otro origen como r2.dev ni copias ya frescas en el cliente sin nuevas políticas/transición.

## Recomendación de siguiente trabajo para Claude

Preparar un diseño local del **contrato de retirada**, sin implementar/desplegar aún:

1. Definir qué evento inicia la retirada y qué URLs/orígenes están cubiertos, incluido el respaldo r2.dev.
2. Presentar la opción temporal y la opción de revocación R2, con TTL/política cliente diferenciados y el efecto sobre rendimiento/lecturas.
3. Si propone endpoint local de cache.delete, describir su POP y autenticarlo/restringirlo; no exponer purgas por GET ni llamarlo global.
4. Pruebas locales: caché caliente + borrado, condicional 304 tras borrar, HEAD, error de metadatos, dos POP simulados, petición en vuelo y navegador con caché caliente (Age/Date/304/frescura). La prueba real con objetos deberá autorizarse aparte.
5. No usar purge_everything, nueva migración de hosting, token amplio o compra de dominio como pasos rutinarios de este estudio. Un dominio futuro habilita opciones de zona que también requieren diseñar/verificar su ámbito; no fuerza cambiar el objetivo actual de Pages.

No se implementó ninguna alternativa, se creó recurso ni se contactó a soporte. No se aprueba todavía un contrato de producción o retirada inmediata.

## Observaciones actuales y evidencia

Nuevo preview 08a740e9 aprobado en `.codex/REVISION-PAGES-08A740E.md`. Los GET de las dos fotos g del ensayo borrado ya dan 404 no-store en Pages, POP MIA, a `2026-10-10T22:14:35.492Z`, sin ejecutar purga. Es una observación de esas URLs en ese POP, no un barrido mundial.

Evidencia en `.codex/evidencia-pages-08a740e-purga/`: diagnóstico-cabeceras.json (doble local), fotos-ensayo-actual.json (GET reales), publicación/CSS y captura del deployment. Se guarda también el código de los diagnósticos en `.txt`. No se editó el código, plan, runbook ni informes anteriores; no se ejecutó un token/purga/API de mutación.
