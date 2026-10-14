# Revisión de implementación local: medios por Pages Functions

Fecha: 10 de octubre de 2026, America/Lima. Codex: QA de solo lectura.

## Veredicto

**NO APROBADA aún para commit/publicación/configuración del Preview: queda un bloqueo P2, PFM-01.** La arquitectura y el diseño v2 siguen aceptados. La implementación cubre la mayoría de los contratos y repetí **86/86 casos**, pero la lectura del cuerpo de R2 queda fuera del manejo de errores. Debe corregirlo Claude y entregar su regresión antes de aprobar el paquete.

No cambié código, configuración, variables, bindings, datos ni Git. Los informes y diagnósticos nuevos se guardan en `.codex` bajo la autorización persistente del usuario.

## PFM-01 — P2: una lectura fallida del cuerpo de R2 se propaga sin respuesta controlada

Archivo: `cloudflare/medios-pages/entrega.js:86`. El `try/catch` de líneas 78–82 cubre `env.MEDIOS.get`, pero no el posterior `await objeto.arrayBuffer()`.

Reproducción local, sin red: un doble de R2 devuelve correctamente el objeto y su ETag; su `arrayBuffer()` rechaza con un error ficticio. Con GET, `manejarMedios` rechaza la promesa en vez de devolver el 503 no-store con nosniff/noindex. Con HEAD sucede igual: consume innecesariamente el cuerpo y su fallo aborta la respuesta.

| Secuencia simulada | Resultado actual |
| --- | --- |
| `get()` rechaza | 503 controlado, cubierto por la suite existente |
| `get()` resuelve y `arrayBuffer()` rechaza, GET | Promesa rechazada, sin Response controlada |
| `get()` resuelve y `arrayBuffer()` rechaza, HEAD | Promesa rechazada, sin Response controlada |

La suite de 30 casos solo simula que falle `get`; no cubre la segunda etapa. El resultado contradice el contrato de errores de lectura R2 del diseño y la afirmación de cabeceras propias en todas las respuestas. No desplegué esta reproducción: el fallo independiente confirmado es el rechazo de la promesa, no un código HTTP específico observado en Cloudflare.

**Corrección recomendada:** proteger también la obtención de los bytes que se necesitan para GET, devolver el 503 establecido sin detalles internos y no cachear el fallo. Evitar la lectura del cuerpo cuando la respuesta HEAD solo requiere metadatos.

**Regresiones necesarias:** GET con metadatos correctos pero fallo de lectura → 503, no-store, nosniff/noindex y cero escrituras en caché; recuperación posterior → 200; HEAD con metadatos disponibles no consume el cuerpo ni llena la caché, y un fallo de la lectura de metadatos tiene una respuesta controlada. Mantener las pruebas HEAD→GET y GET→HEAD. No esconder un fallo de bytes bajo un 404.

## Observaciones adicionales, sin nuevos bloqueos

- **HEAD y rendimiento:** en el diagnóstico sano, un HEAD sin caché leyó **131.072 bytes** del doble R2 para devolver **0 bytes**. No medí tiempo/CPU de Cloudflare. R2 tiene `head` para obtener únicamente metadatos; es una opción para evitar el trabajo innecesario. Mantener los ETag y el contrato de respuesta. [API R2](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#bucket-method-definitions).
- **HEAD de error:** las invocaciones directas devuelven Response con 13 bytes para 404/503. Recomiendo que la Function construya también esos HEAD sin cuerpo. No atribuyo a esto bytes enviados en red: el servidor puede suprimirlos y no se reejecutó Pages dev para este caso.
- **Comprobación del SW en el build:** `swSalida.includes('medios')` solo demuestra que aparece esa palabra, no que la denylist existe. El cambio actual de Vite sí establece la expresión correcta. Para sostener la afirmación de que el build falla si se pierde la exclusión, añadir un control negativo o validar la propiedad/patrón generado, no cualquier coincidencia que pueda provenir de un nombre de asset.
- **Configuración futura de transición:** no basta cambiar `VITE_MEDIOS_PUBLIC_URL`. El código necesita además `VITE_MEDIOS_BASES_RECONOCIDAS` con las bases de staging aprobadas para seguir reconociendo Galería antigua. El binding de Preview sigue pendiente. No configuré ninguna de esas variables.
- **Rollback local:** el texto del runbook que propone `git checkout` de archivos completos no es un rollback aislado del paquete en un árbol con otros cambios. Mantener una lista de cambios propia o un parche comprobado antes de dar instrucciones de restauración. Eliminar también solo los archivos nuevos propios, incluidos helper y pruebas, según esa lista. No ejecuté ninguna restauración.

## Qué comprobé y qué pasa

Leí los diez archivos de implementación/pruebas/build que forman el núcleo del paquete, los diffs y runbook §19, y el diseño actualizado. No hay AGENTS.md adicionales bajo las carpetas revisadas.

| Comprobación repetida por Codex | Resultado |
| --- | --- |
| `node cloudflare/medios-pages/test/probar-entrega.mjs` | 30 casos, 0 fallos |
| `node scripts/verificar-urls-medios.mjs` | 14 casos, 0 fallos; Vite SSR con configuración y claves ficticias, sin peticiones a Supabase |
| `node scripts/verificar-guardas-interfaz-r2.cjs` | 42 casos, 0 fallos; dobles y servidores HTTP locales efímeros |
| oxlint dirigido a los diez archivos | Exit 0, sin diagnósticos |
| Diagnósticos independientes | Fallo de cuerpo reproducido en GET/HEAD, lectura completa en HEAD y observaciones de Response de error |

El cliente reconoce URLs válidas de ambas bases cuando se declaran en la lista; rechaza los hosts engañosos y conserva el prefijo público legítimo de Storage. `resolverUrlGaleria` mantiene su comportamiento de lectura. `convertirBaseUrl` transforma solo URLs válidas de la base de origen. No se da por ejecutado el rollback sobre filas reales.

Las pruebas existentes confirman TTL de 300 segundos en respuesta y copia simulada, expiración, HIT sin nueva lectura R2, Range ignorado, ETag/304 en MISS/HIT, rechazo de rutas/métodos, binding ausente y fallo de Cache API. Los envoltorios cubren `/medios` y el catch-all. El build declara ambas rutas y la denylist se añade únicamente cuando la base es `/`.

## Límites y evidencia

Los builds, la corrida de 24 casos y `wrangler pages dev` descritos por Claude **no se repitieron en esta revisión**. No ejecuté scripts que sobrescriben resultados del proyecto, instalaciones, npm ci ni pruebas con escrituras remotas. La aprobación permanece detenida por PFM-01; ampliar pruebas de despliegue antes de corregirlo no resolvería el bloqueo.

Todavía no se midieron Cache API real, CPU/cuota, recorrido 23/23 con base Pages, PWA sobre esa ruta, rollback sobre filas ficticias de staging, fotos reales, otros navegadores ni carga. Son los límites conocidos; no se añaden como nuevos defectos de esta entrega.

Evidencia: `.codex/evidencia-implementacion-medios-pages/diagnosticos-medios-pages.json` y reproducción `diagnosticos-medios-pages.txt`. El JSON incluye los resultados y SHA-256 de los diez archivos revisados. La reproducción importa el código real y usa únicamente datos ficticios en memoria; su versión de diagnóstico escribe su propio resultado fuera del repositorio con protección contra sobrescritura.

Tras corregir PFM-01, repetir las regresiones nuevas y las suites afectadas, y presentar el paquete para revisión. No es necesario repetir ahora las pruebas históricas remotas de la aplicación ni publicar un build para demostrar esta corrección local.
