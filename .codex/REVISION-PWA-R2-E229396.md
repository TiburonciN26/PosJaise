# Revisión PWA entre builds de Preview con R2

Fecha: 10 de octubre de 2026, America/Lima. Codex: QA de solo lectura.

## Veredicto

**Acepto las dos rondas PWA de Claude para `venta` y `vacio` en Chromium, sobre el preview de staging con R2.** Se puede registrar como validada la actualización PWA entre estos builds dentro de ese alcance y dejar de señalarla como un pendiente genérico sin comprobar.

No se encontraron nuevos bloqueos en esta entrega. Se conservan las aprobaciones previas de la interfaz y las guardas. Esto no cierra toda la Fase 3, no aprueba producción ni el retiro de GitHub Pages.

## Evidencia auditada

Leí ambos informes íntegros, el verificador `scripts/verificar-actualizacion-pwa-online.cjs`, los commits y el §16 del runbook.

| Estado | A → B | Pasos realmente registrados | Resultado |
|---|---|---:|---|
| venta | `c1693734` → `31787852` | **24** | Todos OK |
| vacio | `31787852` → `e2293968` | **19** | Todos OK |

Total: **43 pasos sin fallos**. La cifra «23 pasos» de la entrega/runbook de `venta` es una inconsistencia documental no bloqueante: el JSON contiene 24. Corregirla cuando se agrupe la siguiente documentación, sin otro despliegue únicamente para eso.

En ambas rondas los informes registran preflight de staging/cuenta QA, marca A exacta, SW controlador y sesión real validada mediante usuario propio y su fila en `usuarios`. Tras la publicación aparece el aviso y el documento sigue en A; después del botón Actualizar la marca es exactamente B y la sesión ADMIN continúa validada.

`venta` acredita carrito con producto sin cobrar, Actualizar deshabilitado con explicación, intento de pulsar sin perder el carrito y habilitación al quitar el trabajo pendiente. **No acredita que un carrito se restaure después de la recarga:** lo vacía antes de actualizar, conforme al diseño de bloqueo.

`vacio` acredita Actualizar habilitado desde el aviso, sin mensaje de bloqueo, y llegada a B con sesión. En ambos informes hay cero peticiones bloqueadas, cero errores de página y solo el host de Supabase de staging (31 peticiones en venta, 29 en vacio).

Precisión sobre los errores de red: el verificador comprueba HTTP >=400 del **mismo origen** y registra `requestfailed` exceptuando abortadas/bloqueadas. La lista de peticiones bloqueadas se revisa por separado y está vacía. No es una captura universal de todas las respuestas de todos los servicios externos.

La clave conservada de localStorage es ficticia. No prueba formularios/borradores operativos. El script recorre carrito en memoria, sin confirmar ventas o pagos; los informes no son un registro exhaustivo de operaciones SQL. La declaración de ausencia de escrituras de negocio corresponde al recorrido ejecutado por Claude y a ese alcance.

**Distinción de evidencia:** Codex auditó las transiciones reportadas, pero no las presenció ni volvió a publicar otra B para repetirlas. La ejecución de un verificador con `--publicar-cmd` podría modificar Git; no se ejecutó en esta revisión.

## Git y cambios publicados

- `31787852bf910978560009ffed337a4cb9ee5b64`: tres archivos de evidencia, corrida 3f2497, su captura con nombre propio y clon limpio de c169373.
- `e2293968fdc3e502bf362b4a891cd691fea839fc`: runbook y evidencia de la ronda venta.
- Diff total frente a c169373: cinco archivos de documentos/evidencia. Sin cambios en aplicación, scripts, `public/`, dependencias, configuración de Vite/Cloudflare o workflows.
- HEAD y la referencia local `origin/feat/cloudflare-pages` están en e229396; main local sigue en `0dc629e430ed07eeaccec273d31de93e9717d9bf`.
- La nota final de `vacio` del runbook está modificada sin commit; `pwa-entre-builds-vacio.json` es nuevo sin versionar. Codex no hizo fetch, commit, push o cambios de Git.

## Confirmación independiente del artefacto actual

Mediante GET públicos sin autenticación ni escrituras comprobé `https://feat-cloudflare-pages.pos-jaise.pages.dev`:

- Marca **`e2293968`**.
- 140 entradas de scripts consultadas, todas HTTP 200.
- Proveedor R2, Worker de staging y URL r2.dev presentes.
- Supabase de staging presente; ref del negocio y Supabase local ausentes.
- Sin hallazgos de claves privilegiadas/JWT incorrectos en los formatos examinados; no se imprimieron claves.
- `/ventas` por URL directa responde 200; manifest con scope/start_url `/`; sin `404.html` en precache.
- HTML `public, max-age=0, must-revalidate`, SW `no-cache`, robots `noindex`.
- `https://pos-jaise.pages.dev/` sigue respondiendo 404 como en las revisiones previas.

Esta ejecución propia comprueba la publicación final. No es una repetición de las transiciones A→B ni del recorrido 22/22 con escrituras. No se consultó el panel ni se obtuvo el UUID del deployment nuevo en esta revisión.

## Alcance restante y recomendación

`ventana`, `atras` y `dos-dialogos` no se reejercitaron en esta serie. Su cobertura previa conserva su alcance documentado; no presentar estos dos informes como una repetición de todos los escenarios. El informe formal anterior de O1 acredita `atras` online y conserva pruebas locales adicionales; no se amplía esa evidencia aquí.

Siguen pendientes: reemplazo real de principal de Servicio, fotos reales de catálogo, Firefox/Safari/móvil físico, carga/concurrencia, CDN/`nosniff`, purga, recolector destructivo, migración inversa y criterios de producción del negocio.

**Recomiendo agrupar la evidencia `vacio` y la nota/corrección del runbook con el siguiente commit revisado, sin un push adicional ahora solo para archivarlas.** Cada informe conserva las marcas que probó; el commit que lo archiva puede tener otra marca. La aceptación de la prueba no requiere fabricar continuamente un nuevo build solo para publicar su resultado.

El rollback propuesto `git revert e229396 3178785` afectaría evidencia/documentos y generaría otra publicación. Requiere ejecución por Claude con autorización; Codex no lo ejecutó ni verificó su aplicación. No hay una modificación de datos nueva de esta entrega que Codex deba revertir.

## Evidencia y acciones de Codex

En `.codex/evidencia-pwa-e229396/`: copias de ambos informes, `resumen-rondas.json` con hashes y recuentos, `verificacion-alias-final.json` y el diagnóstico público como texto. El escaneo de los JSON no encontró formatos de secretos examinados; no es garantía universal.

Solo se creó este informe y su evidencia según la instrucción persistente de guardarlos en `.codex`. No se cambió código, configuración, credenciales, datos, objetos reales, recursos externos o Git. No se repitieron build, lint o regresiones por los commits exclusivamente documentales.
