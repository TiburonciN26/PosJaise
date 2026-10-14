# Auditoría de las corridas de caché e interfaz sobre d16d816f

Fecha: 10 de octubre de 2026. Codex, QA de solo lectura.

**Veredicto: aprobadas las evidencias 27/27 de caché y 23/23 de interfaz para la entrega Pages en staging sobre `d16d816f`. Sin hallazgos bloqueantes en este alcance.** No es aprobación de producción ni cierre de la Fase 3 completa.

## Identidades auditadas

- Commit: `d16d816f4d64cde80c230092126ed8204c6ce0e9`.
- Build: `d16d816f`; alias: https://feat-cloudflare-pages.pos-jaise.pages.dev
- Deployment corroborado en la revisión de publicación: `2d701280-e72e-45da-9833-39bc25b5debe`.
- SHA-256 del SW leído de nuevo: `41175d82c3da80bafa992061d13dfba23ea5a429887af884e15cbbf4e9cd4174`, igual al de ese deployment.
- Backend de staging: `tqkdtojnhgykmcbvwdmz`; proveedor R2 y URL pública Pages `/medios` corroborados por preflight antes del login QA.

| Evidencia de Claude | SHA-256 |
|---|---|
| `.codex/evidencia-cache-d16d816/cache-e9af38.json` | `163c0e1f7b57102a9a60ee9d5b78debab4bf8b2cc7a4c05328ae343e991269f4` |
| `.codex/evidencia-interfaz-d16d816/corridas/corrida-56f5e8.json` | `184afe5c08bc3bb8dde31db858a59c8b2408836ad0b630ce6ef6b47815b88aaf` |

Se comprobaron también los hashes de los dos verificadores y de sus guardas, iguales a las fuentes aprobadas. No se modificaron estas herramientas para conseguir un resultado favorable.

## Qué acepta la revisión

**Caché:** 27 casos realmente presentes en el JSON, todos `ok`, sin error, corrida completa y estado final confirmado. HEAD, GET MISS, GET HIT y 304 registran exactamente `public, max-age=0, must-revalidate`, ETag coincidente y cabeceras de seguridad. La aserción de bytes del script aprobado compara contenido completo, no solo longitud. El primer GET fue MISS; el HIT apareció al primer intento. Tras el DELETE, el inventario confirmó ausencia pero la URL todavía devolvió HIT 200, compatible con A. La lectura posterior al plazo de 300 s más margen registró 404 `no-store` en MIA, el mismo POP del HIT. La variante g también pasó su aserción de 404. Limpieza sin pendientes/errores e inventario final igual al inicial.

Las medidas registradas son del cliente: HEAD 147 ms, GET MISS 412 ms y GET HIT 249 ms. No son CPU del Worker/Function ni una comparación estadística de rendimiento.

**Interfaz:** 23 casos realmente presentes, todos correctos, recorrido completo, sin error, peticiones bloqueadas ni limpieza de emergencia. Se registran altas, reemplazos y retiradas de Producto/Servicio/Galería, lectura y decodificación en el portal cliente, compatibilidad con la fila antigua, ausencia de operaciones de Supabase Storage y estado final con snapshot igual y sin claves nuevas/faltantes. Las cuatro variantes de Producto muestran la política nueva. Las filas de galería de Servicio antes/después del reemplazo coinciden en id, referencia, etiqueta y orden; la aserción aprobada verifica también las variantes m/g en el inventario.

Se inspeccionaron dos capturas de Claude: alta de Galería con la marca `56f5e8` y detalle del Servicio en el portal cliente. Son evidencia visual de esa ejecución, no un recorrido interactivo repetido por Codex ni una auditoría completa de UI.

## Contraste independiente del estado actual

El diagnóstico de Codex terminó con **21 comprobaciones, 0 fallos, exit 0**. Combina controles de los informes/fuentes con nuevas lecturas protegidas y públicas; no son 21 escenarios de interfaz repetidos.

- Producto QA `432a6610-67e5-4a7c-a979-eb891cc9263c`: `foto_url=null`, galería vacía.
- Servicio QA `6265a7d1-80b3-4b72-9b34-7f6eca3d7873`: `foto_url=null`, galería vacía.
- Galería web: únicamente la fila antigua `4ab5c994-9bb1-40bf-b5ff-186d45603781`, «Foto de prueba (Inicio)»; ninguna fila de esta ejecución.
- Inventario estricto del Worker: **0 claves** en fotos-productos, fotos-servicios y fotos-galeria, sin cursor de paginación pendiente.
- Objeto del ensayo de caché `fotos-galeria/931dd645-a4b1-4a24-b3a4-d7502e88b4fe`: m y g responden actualmente 404 `no-store`, `nosniff`, `noindex`, desde MIA.

Las lecturas REST exigieron cardinalidad exacta (`count=exact`); respuestas parciales se rechazaban. Se usó una única autenticación con la cuenta QA ficticia existente y después solo GET, restringidos al alias, Worker de staging y Supabase de staging. El diagnóstico bloquea PUT/PATCH/DELETE y cualquier POST que no sea el login exacto. No se leyó ni imprimió la cadena de conexión de la BD, contraseñas o tokens.

## Distinción de evidencia y límites

Claude ejecutó los 50 casos originales; Codex auditó sus informes y contrastó el estado actual. **Codex no presenció las subidas, borrados ni clics de esas corridas y no los repitió.** El estado actual concuerda con la limpieza informada, pero no demuestra por sí solo la secuencia temporal de todas las operaciones.

Se acepta la política HTTP observada y la retención/expiración descrita en una ejecución y un POP. No se establece una garantía de retirada global ni una ventana efectiva completa del navegador. A continúa permitiendo HIT tras el DELETE; B sigue desactivada. No se midieron `head()` internamente, CPU, cuota, otros POP, Firefox/Safari/móvil, carga o concurrencia ni fotos reales del catálogo. El acceso público de `r2.dev` y la decisión de la clienta siguen pendientes antes de producción, junto con el recolector y la migración inversa general.

No se requiere otro push solo para archivar esta auditoría. Un siguiente frente acotado puede ser leer CPU y cuota en el panel, sin cambiar configuración. Cualquier nuevo ensayo con escritura conserva su requisito de autorización y evidencia propia.

Codex no cambió código, configuración, datos, Git, Cloudflare ni cuentas QA. Se guardan solo el informe y la evidencia nuevos en `.codex`. Reproducción conservada como texto en `evidencia-revision-cache-ui-d16d816/verificar-evidencia.txt`; resultado en `revision-evidencia.json`.
