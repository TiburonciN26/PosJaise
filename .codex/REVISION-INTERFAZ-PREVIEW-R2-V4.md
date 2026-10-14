# Revisión V4: recorrido real completo y preparación del paquete

Fecha: 10 de octubre de 2026, America/Lima. Codex: QA de solo lectura.

## Veredicto

**Acepto la evidencia del recorrido real de Claude: 22/22, dentro de su cobertura. Puede preparar el paquete y la validación del commit exacto.** No encontré un nuevo bloqueo en esta entrega.

La aceptación corresponde a la integración de interfaz en el preview de staging. No aprueba el paso del negocio a Cloudflare, el retiro de GitHub Pages ni todos los criterios abiertos de la Fase 3. El commit/push corresponde a Claude y requiere la autorización del usuario; Codex no realizó ninguna operación de Git.

## Evidencia revisada

- `docs/evidencia-rendimiento/fase-3/interfaz-preview/corridas/corrida-652b14.json`: `completa: true`, `error: null`, `limpieza: null`, cero bloqueos, 22 casos y cero fallos. Todos los casos tienen `ok: true`.
- Alias canónico `https://feat-cloudflare-pages.pos-jaise.pages.dev`, marca `ba07a32a`, ejecución `652b14`. El informe se separa del `resultados.json` de la versión anterior.
- Tres capturas: Producto antes de guardar, alta en Galería y detalle de Servicio del cliente. La de Galería muestra el título de esta ejecución `QA R2 UI 652b14 (borrar)` junto a «Foto de prueba (Inicio)». No muestran credenciales.
- Leídos el §15 del runbook, el changelog y la integración de comparación final del verificador.
- HEAD local sigue en `ba07a32a78bcbad12f594e9fc842b49640d42b61`; `main` local sigue en `0dc629e430ed07eeaccec273d31de93e9717d9bf`. Sin fetch ni cambios de Git.

Codex auditó la evidencia de Claude; **no presenció ni repitió las escrituras del recorrido**. Las 41 regresiones y el cierre local de las guardas se mantienen conforme a V3; no se repitieron porque esta revisión trata la nueva evidencia real y las notas de entrega.

## Cobertura aceptada

Producto: foto principal y galería nuevas, reemplazo de principal y retirada. Servicio: principal y galería nuevas, consulta en portal cliente, retirada. Galería antes/después: alta, reemplazo de «antes» conservando exactamente la URL de «después», eliminación. Compatibilidad: respuesta 200 de la URL relativa antigua. ADMIN y CLIENTE: observación de destinos sensibles, cero bloqueos registrados, cero escrituras a Supabase Storage y cero errores de página.

El caso final registra igualdad del snapshot de los campos de fotos/galerías que consulta el script y ninguna clave nueva o faltante en el inventario. **No es una comparación de todos los campos de las tablas.** Tampoco las aserciones de estado final acreditan por sí solas el orden temporal de borrados frente a guardados.

No se ejercitó el reemplazo de principal de Servicio en esta corrida real. Chromium y fotos de referencia del repositorio siguen siendo el alcance, sin carga/concurrencia, fotos reales del catálogo, Firefox/Safari/móvil físico ni prueba nueva de actualización PWA entre bundles.

## Confirmación independiente posterior, solo lectura

Consulté staging con la cuenta QA existente, las galerías y los tres inventarios del Worker. Resultado:

- Producto y servicio QA con `foto_url: null`.
- Cero filas en sus galerías.
- `galeria_web` contiene únicamente `4ab5c994-9bb1-40bf-b5ff-186d45603781`, «Foto de prueba (Inicio)».
- La residual `5bb670df…` ya no aparece.
- Cero objetos devueltos por cada inventario de fotos-productos, fotos-servicios y fotos-galeria; sin cursor de continuación.

Esta lectura acredita el estado actual. La igualdad durante la corrida con su snapshot inicial procede del verificador ejecutado por Claude. No eliminé filas ni objetos y no comprobé credenciales de BD antiguas o nuevas.

## Paquete propuesto y publicación

Lista actual revisada: **11 archivos**:

1. `docs/evidencia-rendimiento/fase-3/R2-REAL-RUNBOOK.md`.
2. `implementacionesWed.md`.
3. `docs/evidencia-rendimiento/fase-3/clon-limpio-commit.json`.
4. `scripts/verificar-interfaz-r2-preview.cjs`.
5. `scripts/lib/guardas-interfaz-r2.cjs`.
6. `scripts/verificar-guardas-interfaz-r2.cjs`.
7. `interfaz-preview/resultados.json` (histórico).
8. `interfaz-preview/corridas/corrida-652b14.json` (nuevo).
9. `interfaz-preview/producto-antes-de-guardar.png`.
10. `interfaz-preview/galeria-alta.png`.
11. `interfaz-preview/cliente-detalle-servicio.png`.

Los cuatro últimos grupos de rutas abreviadas pertenecen a `docs/evidencia-rendimiento/fase-3/`. Pesos y SHA-256 de cada candidato en `publicacion-candidata.json`. El escaneo de adiciones documentales y textos nuevos no encontró valores sensibles de staging, cadenas de conexión/contraseñas derivadas o formatos de secretos examinados; no se imprimieron valores. No es una garantía universal y debe repetirse sobre la selección final si cambia.

Excluir `.codex/**`, `.env*` y las tres capturas antiguas no versionadas de Fase 1. No usar `git add .`. El informe de clon limpio incluido aún describe `ba07a32`, no un commit futuro.

Siguiente secuencia recomendada:

1. Claude prepara la lista y el diff exactos, manteniendo la separación entre evidencia histórica y corrida nueva.
2. Con autorización para crear el commit, validar ese commit desde checkout limpio con las variables de preview/staging/R2. No tomar como referencia el árbol con archivos `.codex` no versionados que Tailwind puede escanear.
3. Push autorizado únicamente a `feat/cloudflare-pages`.
4. Confirmar el nuevo deployment, su marca exacta y aislamiento de staging. Probar contra esa marca; `ba07a32a` deja de ser la expectativa válida para el nuevo commit.

El rebuild nuevo no queda cubierto automáticamente por este 22/22 ni por una prueba antigua de actualización PWA. El lint global conserva sus dos errores conocidos de fixtures; el lint de los tres scripts fue limpio en V3. CDN/`nosniff`, purga, recolector destructivo, migración inversa y validación del negocio siguen pendientes antes de producción.

## Evidencia y cambios de Codex

Se guarda `.codex/evidencia-interfaz-preview-r2-v4/estado-actual-lectura.json` y `publicacion-candidata.json`. Este informe y su evidencia son los únicos archivos creados por Codex, según la autorización persistente de guardarlos en `.codex`. No se modificó código, configuración, datos, objetos, credenciales, recursos externos ni Git.
