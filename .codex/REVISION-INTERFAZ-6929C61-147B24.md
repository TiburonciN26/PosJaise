# Revisión de la corrida de interfaz 147b24 sobre 6929c619

Fecha local: 10 de octubre de 2026 (America/Lima); evidencia UTC del 11 de octubre. Codex actúa como auditor de solo lectura. Claude ejecutó el recorrido con escritura.

## Veredicto

**Aceptada la evidencia de interfaz 23/23 sobre build-id 6929c619, entrega pages, exclusivamente en staging.** El informe no registra fallos ni error de recorrido y muestra igualdad final del snapshot y de claves. Codex corroboró de forma independiente su identidad, la configuración publicada y el estado actual compatible con la limpieza mediante 18 controles, todos correctos.

No se repitieron las acciones de los modales ni se presenció la corrida. La aceptación combina la evidencia aportada, la revisión de las aserciones del verificador y lecturas posteriores independientes; no equivale a una segunda ejecución 23/23 ni a una traza completa de red independiente.

## Evidencia auditada

- [Informe original](C:/WedJaiseReact/.codex/evidencia-interfaz-6929c61/corridas/corrida-147b24.json): idEjecucion 147b24, build-id 6929c619, entrega pages, completa=true, error=null, total=23, fallos=0, bloqueadas=[], limpieza=null.
- Tres capturas inspeccionadas: [Producto antes de guardar](C:/WedJaiseReact/.codex/evidencia-interfaz-6929c61/producto-antes-de-guardar.png), [detalle de Servicio del cliente](C:/WedJaiseReact/.codex/evidencia-interfaz-6929c61/cliente-detalle-servicio.png) y [alta de Galería](C:/WedJaiseReact/.codex/evidencia-interfaz-6929c61/galeria-alta.png). Son coherentes con los fixtures y la fila QA R2 UI 147b24 (borrar); muestran imágenes presentes, pero no demuestran por sí solas origen de red ni limpieza final.
- [Verificador](C:/WedJaiseReact/scripts/verificar-interfaz-r2-preview.cjs:114) y [guardas](C:/WedJaiseReact/scripts/lib/guardas-interfaz-r2.cjs): preflight antes de autenticar, restricciones de destinos en ADMIN y CLIENTE, fetch propio con origen cerrado y redirect:error, snapshot y comparación de claves. No se modificaron.

## Qué acepta este resultado

Producto y Servicio: foto principal y galería, reemplazo y retirada por los modales reales. Galería antes/después: alta, reemplazo de antes, conservación de la URL después y eliminación. Portal cliente: foto principal m/g en listado y g de la galería en detalle, con naturalWidth positivo. Compatibilidad: la referencia relativa histórica de /public responde 200.

La evidencia de Producto incluye cuatro respuestas image/webp con nosniff, public, max-age=0, must-revalidate y X-Medios-Cache=MISS. La lectura del cliente se filtra por el prefijo /medios del alias. En el reemplazo de Servicio las filas de galería coinciden en id, foto_url, etiqueta y orden; la aserción galeriaConservada exige también las variantes m/g en el inventario real leído durante la prueba.

El informe registra solo el host de staging para Supabase, ninguna solicitud bloqueada, ninguna escritura por Supabase Storage y ningún pageerror en los observadores de ADMIN y CLIENTE. El código confirma que ambos contextos tienen el bloqueo y la observación correspondientes. Esto no es un bloqueo universal de todo tercero: las guardas del navegador restringen las familias sensibles previstas; los fetch propios sí tienen una lista cerrada.

## Comprobaciones independientes de Codex: 18/18

1. Identidad de informe, 23 casos todos correctos y resultado completo.
2. Sin bloqueos ni limpieza de emergencia registrados.
3. IgualSnapshot=true y ausencia de claves nuevas/faltantes en el caso final.
4. Igualdad exacta de la galería de Servicio antes/después incluida en el JSON.
5. Alias actual con marca 6929c619.
6. sw.js con el SHA-256 2eb8003dc69f00c9e40cb8e576dd01427b4589138474cf5596558ae57bf1b897, igual al deployment c5effd38 revisado.
7. Configuración efectiva del bundle por rol: proveedor r2, Worker aprobado de staging, publicUrl exacta del alias /medios y la base anterior r2.dev como reconocida.
8–9. Producto y Servicio QA con foto_url=null.
10–11. Galerías de los dos fixtures sin filas.
12. galeria_web contiene únicamente la fila histórica Foto de prueba (Inicio); no queda la marca 147b24.
13–15. Inventarios estrictos de fotos-productos, fotos-servicios y fotos-galeria vacíos, sin cursor.
16–17. m y g de una referencia propia eliminada responden ahora 404 no-store, nosniff y noindex.
18. El auditor solo efectuó GET y un login con la cuenta QA existente en el Supabase de staging; no hizo POST/PATCH/DELETE de filas, objetos o configuración.

Las lecturas REST solicitan count=exact y rechazan respuestas parciales. El script valida el alias, Supabase exacto, clave pública y dominio QA antes de autenticar; no imprime ni guarda contraseñas o tokens. La evidencia independiente guarda rutas y resultados seleccionados, sin cabeceras de autenticación.

## Alcance de la igualdad y de la limpieza

El verificador compara con G.iguales los campos realmente seleccionados del snapshot: id y foto_url de los dos fixtures; id, foto_url, etiqueta y orden de sus galerías; id, título y ambas URLs de galeria_web. La diferencia del inventario compara claves completas, no cantidades. No acredita igualdad de toda la base de datos, todas las columnas de las fichas, stock, pagos o ventas.

El informe original no conserva ambos snapshots crudos completos; conserva el resultado de esa comparación y datos de pasos concretos. Las lecturas posteriores independientes corroboran las condiciones finales, pero no reemplazan un snapshot inicial presenciado por Codex. No hubo limpieza de emergencia: limpieza=null es coherente con el caso final correcto. Los resultados de la corrida son compatibles con salida 0 según la lógica del script; el JSON no registra explícitamente el código de salida del proceso.

HEAD leído: 6929c619e88a91434cb16ee6a8d2de90de94c091. main local leído: 0dc629e430ed07eeaccec273d31de93e9717d9bf. Los archivos versionados siguen sin cambios. No se consultaron ni modificaron ramas remotas durante esta auditoría.

## Precisiones sin bloqueo

**Caché y B:** corregir la explicación de que un HIT público puede seguir entregándose durante el TTL. Eso describe la retención de A. Con B activa, la copia interna puede seguir almacenada hasta su TTL, pero la Function consulta R2 antes de una respuesta desde caché o condicional y debe impedir nuevas entregas después del borrado confirmado. El verificador de interfaz conserva un comentario histórico de A en sus líneas 33–35. La aserción por inventario es válida para esta prueba de interfaz, pero no acredita la retirada inmediata B.

Los dos 404 posteriores vistos por Codex ocurren después de la corrida y no conservan un HIT previo ni una identidad de POP: no se promueven a prueba de revocación inmediata. Esa prueba corresponde al verificador de caché con contrato=b.

**ML-03:** esta corrida prueba fotos nuevas en /medios y una referencia histórica relativa de /public. No contiene una fila antigua con URL r2.dev, por lo que no demuestra la reescritura de ML-03 en el bundle servido. La aprobación local de ML-03 sigue en su revisión correspondiente; la validación del paquete mixto compilado permanece como un trabajo separado.

## Siguiente paso

Claude puede registrar este veredicto sin un push exclusivo para archivarlo. Carga y recolector siguen requiriendo autorizaciones separadas de ejecución en staging; este informe no las otorga. Revisar el paquete de lectura mixta v3 y validar ML-03 en el bundle compilado también continúa pendiente.

Esta aceptación no cierra la Fase 3 completa ni autoriza producción, main, GitHub Pages, cambios de variables o binding, cierre de r2.dev, migración inversa o uso destructivo del recolector habitual. No se midieron CPU, cuota, carga o concurrencia. Chromium y fotos de referencia siguen siendo el alcance de esta corrida.

Informe nuevo: .codex/REVISION-INTERFAZ-6929C61-147B24.md. Evidencia independiente: .codex/evidencia-revision-interfaz-6929c61-147b24. La evidencia original permanece intacta; sus hashes y los del código revisado están registrados.
