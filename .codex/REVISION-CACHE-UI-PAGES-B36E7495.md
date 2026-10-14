# Revisión de las pruebas reales de caché e interfaz Pages

Fecha: 10 de octubre de 2026, America/Lima. Codex, QA. Evidencia ejecutada por Claude; revisión de archivos/capturas y comprobaciones independientes de lectura realizadas por Codex. No repetí las subidas, reemplazos, borrados, recorrido UI ni prueba de TTL. No cambié código/configuración, no escribí datos, ni hice commit/push.

## Veredicto

**Aprobadas las dos evidencias para el alcance de staging revisado:** caché real **27/27** y recorrido de interfaz **23/23**, entrega Pages `/medios`, marca `b36e7495`. Sin nuevos hallazgos bloqueantes. Se mantienen los cierres locales de IP-P1 y CP-01.

Esta aprobación cierra la comprobación de entrega HTTP/caché y los flujos de fotos de esta ejecución de staging. **No es la aprobación de la Fase 3 completa ni del cambio del negocio a producción.** Siguen pendientes los puntos enumerados al final.

## Evidencia auditada y fuentes

- `.codex/evidencia-ejecucion-cache-ui/cache/cache-52d575.json`, ejecución `52d575`, fecha registrada `2026-10-10T19:34:14.695Z`.
- `.codex/evidencia-ejecucion-cache-ui/ui/corridas/corrida-20df1b.json`, ejecución `20df1b`, fecha registrada `2026-10-10T20:33:15.581Z`.
- Tres capturas: Producto antes de guardar, detalle de Servicio del cliente y Galería alta. La captura de Galería muestra la marca propia `QA R2 UI 20df1b (borrar)` junto a la fila antigua conservada; no se confunde con otras ejecuciones.
- Scripts de caché/UI y helper de guardas: sus hashes coinciden exactamente con los de la revisión CP-01 V2. No repetí las 47 guardas ni lint porque las fuentes revisadas no cambiaron. El runbook añadió el relato de las ejecuciones.

Los JSON tienen 27 y 23 casos efectivamente registrados, todos con `ok=true`; los totales y ausencia de errores son coherentes. La caché registra estado final confirmado, limpieza sin pendientes y sin errores. UI registra snapshot igual, cero claves nuevas/faltantes, sin limpieza de emergencia, sin peticiones bloqueadas ni errores de página.

El JSON de UI no conserva el snapshot íntegro ni toda la traza de red; registra el resultado de la comparación implementada. Por eso la auditoría verifica el código de esa comparación y añade lecturas actuales, sin presentar una segunda reproducción de la corrida.

## Caché real: alcance aceptado

El informe registra ambas subidas 201, exactamente dos claves nuevas, tamaños ficticios 646/788 bytes y comparación completa de bytes en MISS/HIT según el script aprobado. HEAD tiene `image/webp`, ETag citado y `public, max-age=300`; primer y segundo HEAD informan MISS. GET m pasa de MISS a HIT en un intento, con iguales bytes/ETag/cabeceras; g también se compara por contenido completo.

Condicional coincidente y `*` retornan 304, ETag distinto retorna 200; Range retorna cuerpo completo sin Content-Range; POST retorna 405 y las rutas inválidas no caen en la SPA. `/medios-extra` conserva el HTML SPA.

Después del DELETE 200, el inventario registra cero claves y la lectura pública registra **200 HIT retenido**, conforme al TTL aceptado. Luego m registra 404 no-store/nosniff/noindex y g también 404. El POP de HIT y lectura final es **MIA**, con Ray ids registrados. Esto es evidencia consistente con la expiración observada en ese POP, no prueba global de todos los centros de datos ni instrumentación de una entrada individual.

La espera programada por el script es TTL de 300 s más margen de 15 s desde el borrado. El JSON no contiene timestamps separados de cada solicitud o una medida del intervalo de espera: la cifra de 315 s describe esa espera programada, no una medición independiente del tiempo exacto de expiración. No bloquea la comprobación funcional revisada.

Los tiempos 149/382/242 ms son observaciones únicas de HEAD/fetch MISS/fetch HIT. `medir` mide hasta que resuelve fetch; la lectura completa del cuerpo se hace después. No representan CPU del Worker, tiempo completo de decodificación/pintado ni una comparación estadística de hosting. No se infiere un porcentaje general de mejora.

## Interfaz: alcance aceptado

Producto: alta de principal/galería, cuatro PUT al Worker, cuatro variantes 200 WebP con nosniff/max-age=300/X-Medios-Cache, reemplazo y quitado. Servicio: alta, listado cliente con m y g decodificadas, detalle con g, reemplazo de principal y quitado. La conservación de su galería compara id/foto_url/etiqueta/orden y presencia de las variantes mediante la guarda IP-S1; los valores antes/después registrados son idénticos.

Galería: alta con dos URLs Pages, reemplazo de antes conservando después, eliminación de fila/objetos, y conservación de la fila antigua `/public`. Los casos de reemplazo comprueban el estado final, no instrumentan el orden temporal entre UPDATE y DELETE. Las capturas corroboran fotos visibles, no una aprobación completa del diseño o responsive.

El aislamiento registra solo el host Supabase de staging, cero destinos sensibles bloqueados, cero escrituras en Supabase Storage y cero errores de página en ADMIN/CLIENTE. La guarda de navegación permite terceros fuera de las familias sensibles; no se transforma este resultado en una afirmación de lista universal cerrada de todos los dominios.

## Comprobaciones independientes de Codex

**16 controles, cero fallos**, ejecutados a `2026-10-10T20:36:39.028Z`:

- Totales/resultados y estado final de ambos JSON, coherencia de galería de Servicio y hashes de las fuentes aprobadas.
- Preflight público actual: marca `b36e7495`, entrega Pages por rol, módulo `assets/index-DGsWTpdi.js`. SW SHA-256 `4c3d38c262bc6f00879681c535548bd45d0e8cf440d2206222df247be39bca42`, idéntico al deployment configurado `4d23d410`. No se usó la mera marca para identificar la entrega.
- Lecturas protegidas actuales: Producto `432a6610-67e5-4a7c-a979-eb891cc9263c` y Servicio `6265a7d1-80b3-4b72-9b34-7f6eca3d7873` con foto_url null, cero galerías en ambos.
- Galería web: única fila antigua `4ab5c994-9bb1-40bf-b5ff-186d45603781`, “Foto de prueba (Inicio)”; sin fila propia `20df1b`.
- Inventario estricto de los tres destinos: **cero claves**, sin cursor ni error. No se asume que una lectura fallida sea inventario vacío.
- Objeto ficticio de caché `fotos-galeria/971ad3c2-4f9c-45cd-88f6-266eae152368`: ambas variantes responden ahora 404 no-store/nosniff/noindex, POP MIA.

Para las lecturas protegidas se inició una sesión QA existente de staging; esa fue la única petición POST, exclusivamente a Auth. Luego se usaron GET de REST/inventario/archivos públicos con orígenes aprobados y redirects rechazados. No se creó/modificó/borró ninguna fila, usuario u objeto. Los valores de claves y contraseña se mantuvieron en memoria y no se imprimieron ni guardaron en la evidencia. No se utilizó la cadena de BD.

Esta comprobación actual corrobora que no quedaron residuos en los fixtures/inventario, pero no afirma que Codex haya presenciado o repetido los 50 casos originales de Claude. No se inspeccionó de nuevo el panel de Production ni se verificó un cambio remoto de main: HEAD/main locales conservan `b36e7495c013b3cff8f167655de051a899ce77cf` / `0dc629e430ed07eeaccec273d31de93e9717d9bf`.

## Siguiente paquete y límites

El paquete local revisado consta de cuatro scripts/helper (guardas, sus regresiones, UI y caché) más el runbook. Puede prepararse para un commit explícito en `feat/cloudflare-pages` con autorización del usuario y validación del commit exacto desde checkout limpio. La aprobación QA no autoriza por sí misma commit/push; Codex sigue en rol de revisión. Conservar los informes en `.codex` según la instrucción del usuario, excluir `.env*`/secretos y no añadir indiscriminadamente el árbol.

Un push reconstruye el alias: registrar el deployment, nueva marca/SW y configuración efectivos. Estas corridas siguen identificando el artefacto probado, no el futuro build. La ronda PWA con `/medios` requiere plan y autorización aparte de commits/publicaciones. Evitar crear nuevos commits solo para perseguir la marca de cada informe.

Pendientes conservados: PWA con Pages, ensayo de rollback de URLs de Galería en filas ficticias, purga/retirada de caché, CPU y cuota, fotos reales de catálogo, Firefox/Safari/móvil, carga y concurrencia, operación destructiva/programación del recolector y migración inversa. Fotos de referencia y una única observación de POP no satisfacen esos criterios. Dominio propio continúa opcional para el futuro, no se exige para usar la entrega de staging por Pages.

## Informe nuevo y evidencia

Nuevo diagnóstico en `.codex/evidencia-revision-cache-ui-real/`: `revision-evidencia.json` (16 controles, hashes y lecturas actuales) y `verificar-evidencia.txt` (copia del diagnóstico externo). Los resultados originales se conservan en su carpeta y no se sobrescribieron. No se editaron informes anteriores, runbook ni registro.
