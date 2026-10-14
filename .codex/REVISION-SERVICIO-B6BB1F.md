# Servicio: reemplazo de principal y revisión del paquete

Fecha: 10 de octubre de 2026, America/Lima. Codex: QA de solo lectura.

## Veredicto

**El recorrido real de Claude acredita el reemplazo de la principal de Servicio en el build `e2293968` dentro de las condiciones del verificador.** El JSON registra 23 casos, todos OK, corrida completa, sin error, bloqueos o limpieza de emergencia. La comprobación independiente posterior confirma staging limpio.

**Antes del commit del paquete recomiendo corregir IP-S1, una aserción P2 que no prueba la afirmación «galería intacta».** Es un falso positivo posible del test, no un defecto observado en la aplicación. No reabre F3-07 ni las guardas ya cerradas.

## Cambios revisados y validación

- Diff del verificador: únicamente el nuevo bloque de 11 líneas de reemplazo en Servicio.
- `node --check scripts/verificar-interfaz-r2-preview.cjs`: pasa.
- `oxlint` del script: salida 0, sin diagnósticos.
- Las guardas/librería no cambian; no repetí las 41 regresiones ya aceptadas. Su repetición sin fallos es la informada por Claude.
- Leídos el informe `corrida-b6bb1f.json`, el §17 del runbook y el diff exacto.
- Capturas nuevas de Producto y Galería inspeccionadas; la segunda muestra `QA R2 UI b6bb1f (borrar)`. No muestran credenciales. Las capturas comunes versionadas no aparecen modificadas en el estado actual.
- HEAD sigue en `e2293968fdc3e502bf362b4a891cd691fea839fc`; main local sigue en `0dc629e430ed07eeaccec273d31de93e9717d9bf`. No hubo cambios de Git por Codex.

Codex auditó la evidencia; no ejecutó el recorrido real que escribe fotos y filas. Su reproducción adicional utiliza únicamente filas e inventarios ficticios en memoria.

## IP-S1 — P2: comparar la galería anterior y posterior, no solo su tamaño

Archivo: `scripts/verificar-interfaz-r2-preview.cjs`, bloque `3b2` de reemplazo de principal de Servicio, aproximadamente líneas 260–270.

La condición nueva comprueba correctamente que la principal nueva tiene referencia R2, es diferente de la anterior, existe su grupo y ya no existe el grupo anterior. Pero para la galería solo exige `galS.length === 1` y un total de dos grupos en el inventario. Sobrescribe `galS` con la relectura sin conservar/comparar su estado previo.

Un reemplazo de la foto de galería por otra, o un cambio de etiqueta/orden, conserva esas cantidades y hace pasar el caso aunque la galería haya cambiado. La comparación final de toda la corrida no detecta ese cambio intermedio porque después se quitan las fotos y se vuelve al snapshot inicial vacío.

**Reproducción independiente:** ejecuté el predicado original extraído del script, sin red ni persistencia, con tres estados. La galería idéntica pasa, como corresponde. También pasan una galería con otra referencia de foto y una galería con otra etiqueta/orden, aunque `G.iguales(antes, después)` devuelve false. Principal nueva presente y anterior ausente en los tres escenarios. Ver `repro-galeria.json`.

Corrección recomendada para Claude:

1. Conservar una copia de la galería justo antes del reemplazo de principal.
2. Tras guardar, comparar todas las filas seleccionadas (`id`, `foto_url`, `etiqueta`, `orden`) con esa copia, usando el helper de igualdad existente o equivalente.
3. Comprobar que los objetos referenciados por la galería anterior continúan presentes; si se afirma conservación de ambas variantes, comparar sus claves completas `m`/`g` en el inventario, no únicamente el número de grupos.
4. Añadir negativos en memoria: cambio de referencia, cambio de ID/etiqueta/orden y desaparición de un objeto de galería deben fallar; una galería realmente idéntica debe pasar.

Puede hacerse esta corrección y revisión antes de agrupar el commit. La evidencia actual permite cerrar la ejecución del reemplazo de principal, pero no afirmar con esta aserción que la galería se preservó íntegramente. Para afirmar eso sobre una corrida real futura, repetir con la condición corregida y mantener el informe anterior como histórico.

## Estado posterior confirmado en solo lectura

Consulta con la cuenta QA existente, exclusivamente a staging y al inventario del Worker:

- Producto y servicio QA con `foto_url: null`.
- Cero filas en sus galerías.
- Solo «Foto de prueba (Inicio)», ID `4ab5c994…`, en `galeria_web`.
- Cero objetos en los tres inventarios, sin cursor de continuación.

No hubo escrituras, borrados, rotación de contraseñas o cambios de recursos por Codex. La igualdad con el snapshot inicial de la corrida sigue siendo evidencia de Claude, limitada a los campos de fotos/galerías seleccionados.

## Lista candidata y documentación

Seis archivos actuales para el paquete descrito:

1. `scripts/verificar-interfaz-r2-preview.cjs` (modificado).
2. `docs/evidencia-rendimiento/fase-3/R2-REAL-RUNBOOK.md` (modificado; incluye vacio, corrección de 24 pasos y §17).
3. `docs/evidencia-rendimiento/fase-3/interfaz-preview/corridas/corrida-b6bb1f.json`.
4. `docs/evidencia-rendimiento/fase-3/interfaz-preview/galeria-alta-b6bb1f.png`.
5. `docs/evidencia-rendimiento/fase-3/interfaz-preview/producto-antes-de-guardar-b6bb1f.png`.
6. `docs/evidencia-rendimiento/fase-3/pwa-entre-builds-vacio.json`.

Lista/hash en `lista-candidata.json`. El escaneo de adiciones de textos modificados y de los JSON nuevos no encontró valores sensibles locales ni formatos de secretos examinados. Las imágenes fueron revisadas visualmente; no es una garantía universal. Si se añaden negativos o una nueva corrida, actualizar la lista explícita.

Mantener fuera `.codex/**`, `.env*` y las capturas antiguas no versionadas de Fase 1. Tras cerrar IP-S1: revisar la selección final, validar el commit exacto en checkout limpio y push solo a `feat/cloudflare-pages` con autorización del usuario. La corrida actual siempre identifica e2293968, no la marca que genere un futuro commit.

PWA `venta`/`vacio` conserva su aceptación. Siguen pendientes fotos reales del catálogo, Firefox/Safari/móvil, carga/concurrencia, CDN/`nosniff`, purga, recolector destructivo y migración inversa. No se aprueba todavía toda la Fase 3 ni producción.

## Evidencia de Codex

Nueva carpeta `.codex/evidencia-servicio-b6bb1f/`: reproducción en memoria (JSON y código como texto), estado actual de medios, lista candidata, copia de la corrida y dos capturas por identificador. Solo se creó este informe y las copias QA conforme a la instrucción persistente de guardarlos en `.codex`. No se modificó código, configuración, datos, objetos, credenciales o Git.
