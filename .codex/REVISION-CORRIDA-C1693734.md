# Corrida 3f2497: interfaz R2 sobre c1693734

Fecha: 10 de octubre de 2026, America/Lima. Codex: QA de solo lectura.

## Veredicto

**Acepto la evidencia de Claude de la corrida real `3f2497`: 22/22 sobre la marca `c1693734`.** La comprobación de interfaz del preview actual queda cubierta dentro del alcance declarado. No encontré un nuevo bloqueo en esta entrega.

No es el cierre de toda la Fase 3 ni aprobación para migrar el negocio, retirar GitHub Pages o escribir referencias R2 en producción. La prueba PWA entre builds y los demás criterios abiertos siguen pendientes.

## Revisión de la evidencia

El informe `docs/evidencia-rendimiento/fase-3/interfaz-preview/corridas/corrida-3f2497.json` identifica:

- Alias aprobado: `https://feat-cloudflare-pages.pos-jaise.pages.dev`.
- Marca exacta: `c1693734`, commit `c169373434ccc67c419710e8daca8e489dec85bc`.
- Ejecución `3f2497`, `completa: true`, 22 casos y todos con `ok: true`.
- Cero fallos, `error: null`, `limpieza: null` y ningún destino sensible bloqueado registrado.
- Estado final: snapshot de los campos de fotos/galerías igual y ninguna clave nueva o faltante del inventario.

Se ejercitaron Producto (alta, reemplazo de principal, retirada), Servicio (alta, portal cliente, retirada), Galería antes/después (alta, reemplazo de «antes» conservando «después», eliminación), respuesta 200 del archivo relativo antiguo e instrumentación de ADMIN y CLIENTE. No hubo operaciones de Supabase Storage ni errores de página registrados.

Codex auditó el informe y la captura; **no presenció ni repitió las escrituras reales**. El alcance del snapshot sigue siendo los campos seleccionados por el script, no todos los campos de las tablas. Las aserciones de reemplazo observan estado final; no prueban por sí solas su orden temporal.

La captura nueva de Galería muestra «Foto de prueba (Inicio)» y «QA R2 UI 3f2497 (borrar)» con las imágenes de referencia. Es coherente con esta corrida y no muestra credenciales. El escaneo del JSON no encontró formatos de secretos examinados; no es una garantía universal de ausencia de datos sensibles.

## Confirmación independiente posterior

Mediante lecturas del Supabase de staging con la cuenta QA existente y del inventario del Worker, confirmé:

- Producto y servicio QA con `foto_url: null`.
- Cero filas en sus galerías.
- Únicamente «Foto de prueba (Inicio)», ID `4ab5c994-9bb1-40bf-b5ff-186d45603781`, en `galeria_web`.
- Cero objetos en los tres inventarios, sin cursor de continuación.

No realicé DELETE, PUT ni operaciones de datos. Esta comprobación acredita el estado posterior; la igualdad con el snapshot inicial de esta ejecución es evidencia del verificador ejecutado por Claude.

## Git y recomendación para conservar la evidencia

HEAD local sigue en c169373; main local sigue en `0dc629e430ed07eeaccec273d31de93e9717d9bf`. No hubo fetch, commit o push de Codex.

La única modificación versionada actual es `interfaz-preview/galeria-alta.png` (36.534 → 36.616 bytes). La nueva corrida JSON y `clon-limpio-commit-nuevo.json` permanecen sin versionar, además de informes/capturas previos ya conocidos. No hay cambio nuevo de fuentes o configuración que justifique repetir las regresiones/lint en esta revisión.

**Recomiendo conservar ambas capturas y agrupar esta evidencia con el siguiente cambio revisado, sin un push adicional ahora solo por estos archivos.** No sustituir silenciosamente la captura de la corrida 652b14 por la de 3f2497, ni restaurar el archivo común perdiendo antes la captura nueva.

Claude puede guardar la nueva imagen con nombre/ruta que incluya `3f2497`, asociarla al JSON correspondiente y mantener la anterior como histórica. Restaurar después únicamente el archivo común versionado, si se desea, es una acción de Claude dentro de la autorización del usuario; Codex no lo ejecutó. Para futuras corridas, guardar las capturas por identificador evitaría volver a pisar evidencia histórica; esta recomendación no bloquea la aceptación actual.

El siguiente commit deberá seguir una lista explícita, sin `.codex/**`, `.env*` ni capturas antiguas ajenas al paquete, y validación del commit exacto desde checkout limpio. El push requiere autorización del usuario y sería solo a `feat/cloudflare-pages`.

Una evidencia identifica el build que probó. El commit que la archiva puede tener otra marca; no debe cambiarse retroactivamente el `buildId` del informe para simular que se ejecutó sobre esa nueva publicación. Confirmar la publicación efectiva cuando se agrupe el paquete y repetir pruebas según cambios y criterios pendientes, evitando encadenar despliegues únicamente para archivar resultados.

## Pendientes y archivos nuevos de QA

Siguen pendientes: reemplazo real de principal de Servicio, fotos reales del catálogo, Firefox/Safari/móvil físico, carga/concurrencia, PWA entre builds, CDN/`nosniff`, purga, operación destructiva del recolector y migración inversa.

Guardé en `.codex/evidencia-corrida-3f2497/` el informe de la corrida, la lectura independiente, un resumen con hashes y **copias separadas de ambas capturas**:

- `galeria-alta-652b14.png`: obtenida del blob de Git de c169373.
- `galeria-alta-3f2497.png`: copia de la imagen actual revisada.

Esto conserva las dos evidencias sin tocar el archivo versionado. Solo se creó este informe y sus copias de QA conforme a la instrucción persistente de guardarlas en `.codex`. Código, configuración, datos, objetos, credenciales y Git permanecieron sin cambios por Codex.
