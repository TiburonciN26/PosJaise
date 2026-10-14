# Revisión de interfaz R2 en Pages Preview y publicación propuesta

Fecha: 10 de octubre de 2026, America/Lima. Rol: QA independiente, solo lectura.

## Veredicto

**La evidencia de Claude del recorrido real (21/21) es aceptada dentro de la cobertura descrita abajo. El script nuevo requiere dos correcciones P2 antes de aprobarlo para reutilización y para incluirlo en la entrega propuesta.** Esto no reabre F3-07 ni demuestra un fallo nuevo del código de la aplicación. Son fallos en las salvaguardas del verificador.

Una publicación solo de documentos y evidencia puede separarse del script, corrigiendo las precisiones documentales. Si se incluye el script, corregir IP-R1 e IP-R2, aportar sus regresiones sin red y revisar la versión corregida antes del push. La autorización para publicar corresponde al usuario; Codex no ejecutó commit ni push.

La Fase 3 completa continúa pendiente de sus criterios de producción: fotos reales del catálogo, otros navegadores/dispositivos, dominio/CDN y cabeceras, purga, operación del recolector y migración inversa. GitHub Pages no se retira por esta aprobación parcial.

## Alcance y comprobaciones

- HEAD revisado: `ba07a32a78bcbad12f594e9fc842b49640d42b61`, rama `feat/cloudflare-pages`. `main` local sigue en `0dc629e430ed07eeaccec273d31de93e9717d9bf`. No hubo fetch ni cambios de Git.
- Preview probado por Claude: `https://feat-cloudflare-pages.pos-jaise.pages.dev`; deployment reconstruido `9d206972-de27-410d-8be4-daf8743c2fc4`, marca `ba07a32a`.
- Leídos el script íntegro, resultados JSON, informe de clon limpio y las adiciones de los dos documentos; inspeccionadas las tres capturas.
- `node --check scripts/verificar-interfaz-r2-preview.cjs` pasa. No se ejecutó ese script: escribe datos en staging y borra objetos.
- Codex consultó en solo lectura las fotos de los dos registros, sus galerías, las filas de `galeria_web` y los tres inventarios del Worker. Se usó una cuenta QA existente; no se crearon usuarios, filas, fotos ni recursos.
- Dos reproducciones independientes en memoria ejecutan código original del verificador con red y persistencia sustituidas. No enviaron peticiones ni borraron datos reales.
- Ocho candidatos de publicación revisados. El escaneo de las adiciones de documentos y de los textos nuevos no encontró valores sensibles del archivo local de staging ni formatos literales de secretos examinados. Las capturas no muestran credenciales. Esto no sustituye la revisión del commit final ni garantiza ausencia de cualquier clase de dato sensible.

No se repitieron build ni suites de la aplicación: esta entrega no cambia aplicación, dependencias o configuración. El futuro commit debe validarse desde un checkout limpio del commit exacto, como propone Claude; el informe de clon limpio actual corresponde a `ba07a32`, no a un commit futuro.

## Evidencia funcional aceptada y límites

El JSON aportado registra 21 casos, todos `ok`, en Chromium y con fotos de referencia. Codex auditó esas evidencias; no presenció ni repitió las escrituras del recorrido.

| Flujo | Cobertura acreditada por la entrega |
|---|---|
| Producto QA | Principal y galería nuevas, reemplazo de principal, retirada de ambas; referencias R2, cuatro PUT y respuestas públicas WebP. |
| Servicio QA | Principal y galería nuevas, lectura por cliente y retirada de ambas. **No hay paso de reemplazo de principal de Servicio en esta corrida real.** |
| Portal cliente | Las imágenes del listado y del detalle se decodifican; tarjeta `m`, portada y detalle `g`. |
| Galería antes/después | Alta, reemplazo de «antes» y eliminación. |
| Compatibilidad antigua | La URL relativa a un archivo de `/public` responde 200. No valida fotos antiguas de Supabase Storage ni una decodificación independiente de ese archivo. |

La lectura independiente posterior confirma **el estado actual de medios**: producto y servicio con `foto_url = null`, cero filas en sus galerías y cero objetos devueltos por cada inventario. `galeria_web` conserva dos filas: «Foto de prueba (Inicio)» y la residual «QA fase 3 (borrar)» (`5bb670df…`). La residual no se tocó.

No existe snapshot previo de todos los campos, por lo que no se acredita igualdad completa de los registros frente a su estado original. El script compara cantidades de grupos, no igualdad de claves. Además, el aislamiento de peticiones se observa solo en la página ADMIN, no en el contexto CLIENTE. La afirmación «todo el tráfico» debe acotarse o instrumentarse en todos los contextos.

Las aserciones de reemplazo revisan el estado final; por sí solas no prueban el orden temporal «borrado solo después del guardado». La de Galería tampoco compara explícitamente la URL de «después» con su valor anterior. Ajustar el texto al alcance observado o fortalecer esas aserciones, sin declarar nuevas pruebas realizadas.

## IP-R1 — P2: validar destinos y artefacto antes de autenticar o modificar

Archivo: `scripts/verificar-interfaz-r2-preview.cjs`, líneas 17, 35, 77, 88–106 y 191–194.

`--alias` acepta cualquier URL. La comprobación de Supabase usa `includes(ref)`; permite una URL ajena con ese texto en el query. El login por API ocurre antes de revisar el artefacto. La marca esperada está fija en `ba07a32a`, y una marca diferente solo añade un resultado fallido: no detiene el login por formulario ni las escrituras posteriores. Tras un commit documental real cambiará esa marca.

El listener de peticiones solo registra tráfico incorrecto después de iniciarlo. No lo bloquea y no está instalado para CLIENTE. Un alias accidentalmente ajeno puede recibir las credenciales introducidas en su formulario, y un entorno equivocado puede recibir tráfico antes del fallo final.

**Reproducción sin red:** `preflight-sin-red.json` muestra que un alias ajeno no aborta antes de intentar el login QA. Con Supabase `https://destino-ajeno.example/?ref=tqkdtojnhgykmcbvwdmz`, el script también intenta autenticar contra ese host. `fetch` fue interceptado: cero solicitudes reales.

Corrección recomendada para Claude:

1. Antes de autenticar, validar URL exacta de staging, origen HTTPS aprobado, cuentas QA ficticias y clasificación de la clave pública.
2. Recibir la marca esperada de la ejecución, comprobar el artefacto y abortar ante una discrepancia. La comparación no puede limitarse a `caso(false)`.
3. Bloquear destinos no autorizados antes de salir, incluyendo otro Supabase, Supabase local y pasarelas; aplicar la protección y captura a todos los contextos y a las solicitudes del propio script.
4. Regresiones sin red: alias ajeno, URL con ref en query, cuenta ajena, artefacto incorrecto y tráfico prohibido del contexto CLIENTE deben abortar sin login ni operaciones de escritura.

## IP-R2 — P2: comprobar el estado inicial y limitar la limpieza a lo propio

Archivo: `scripts/verificar-interfaz-r2-preview.cjs`, líneas 22–24, 133–181, 235–256 y 275–285.

El script reutiliza producto y servicio existentes suponiendo que no tienen fotos, pero no verifica esa precondición antes de sustituirlas. Si una ejecución posterior encuentra fotos legítimas de otra prueba, podría reemplazarlas y borrarlas, terminando con `null` en lugar de restaurar el estado inicial.

Galería usa el título fijo `QA R2 UI (borrar)` para localizar filas. La limpieza de emergencia elimina **todas** las filas con ese título, incluidas las preexistentes. El comentario «Solo se retoca lo que ESTA prueba creó» no es cierto con ese filtro. También puede seleccionar la fila equivocada durante la edición/eliminación normal.

**Reproducción sin red:** se ejecutó el bloque original del `finally` con una fila previa y otra propia, ambas con ese título. Intentó DELETE para ambas (`limpieza-sin-red.json`, `borraFilaAjena: true`). REST/BD estaban sustituidos por memoria; ningún DELETE real.

Corrección recomendada para Claude:

1. Verificar y registrar la precondición segura de los fixtures antes de escribir; si producto/servicio tienen fotos o galerías ajenas, abortar sin modificarlos, o utilizar registros desechables propios.
2. Crear una marca única por ejecución y registrar los IDs exactos de filas y claves/grupos que crea. Editar y limpiar únicamente esos IDs; no borrar por un título compartido.
3. Verificar igualdad del inventario o ausencia de las claves propias, no solo su cardinalidad. Ante lecturas fallidas, no asumir una lista vacía ni iniciar limpieza destructiva.
4. En un error intermedio, informar y reconciliar únicamente los recursos propios; no ampliar la limpieza a otras filas ni a toda la cuenta.
5. Regresiones sin red: fotos previas, una fila antigua con el mismo título, cambios concurrentes de inventario y lectura fallida. La fila anterior y sus objetos deben conservarse.

## Precisiones documentales antes de publicar

- Rotular como histórico el §11 del runbook que aún dice «sin variables VITE_MEDIOS_* todavía», y las notas equivalentes del changelog. El §12 ya refleja el estado posterior correcto.
- Sustituir «cada registro devuelto a su estado original» por la comprobación realmente realizada sobre campos de foto y galerías, salvo que se aporte un snapshot previo comparable.
- Acotar «alta, reemplazo y quitar en Producto, Servicio y Galería»: el reemplazo real se ejercitó en Producto y Galería, no en Servicio.
- Si se menciona `testing`, diferenciar referencia local y remota: `testing` local está en `0dc629e`; `origin/testing` está en `ce21b89` según las referencias locales inspeccionadas, sin fetch.

## Lista propuesta y siguiente revisión

Los ocho candidatos actuales son los dos documentos modificados (`R2-REAL-RUNBOOK.md`, `implementacionesWed.md`), el informe `clon-limpio-commit.json`, el script nuevo y los cuatro archivos de `interfaz-preview/` (resultados + tres PNG). Lista, pesos y hashes en `publicacion-candidata.json`.

Excluir `.codex/**`, `.env*` y las tres capturas antiguas no versionadas de la Fase 1. Evitar `git add .`. Si se corrige el script o se agregan regresiones, la lista cambiará y debe revisarse explícitamente.

Después de las correcciones: revisión de diff y regresiones aisladas, validación del commit exacto en checkout limpio, push autorizado solo a `feat/cloudflare-pages` y comprobación del nuevo deployment. No exige cambiar `main`, el backend del negocio ni retirar GitHub Pages. El rebuild documental cambia la marca/versionado; no equivale al deployment ya probado ni cierra por sí mismo la prueba PWA pendiente.

## Evidencia independiente guardada

En `.codex/evidencia-interfaz-preview-r2/`:

- `estado-actual-lectura.json`: estado posterior de medios consultado por Codex.
- `preflight-sin-red.json` y `preflight-sin-red.txt`: dos reproducciones aisladas de IP-R1.
- `limpieza-sin-red.json` y `limpieza-sin-red.txt`: reproducción aislada de IP-R2.
- `publicacion-candidata.json`: ocho candidatos, hashes y escaneo sin valores sensibles.

No se modificaron fuentes/configuración, datos, objetos, usuarios, recursos externos o Git. Se creó únicamente este informe y su evidencia bajo la autorización persistente del usuario para guardar las revisiones en `.codex`.
