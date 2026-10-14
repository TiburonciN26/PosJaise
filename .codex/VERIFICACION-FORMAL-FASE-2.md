# Revisión formal de Fase 2 · Codex

Fecha: 9 de octubre de 2026.
Proyecto: C:\WedJaiseReact.

**Veredicto: APROBADA CON OBSERVACIONES para el preview de staging.** La adaptación de base/routing y el despliegue de pruebas funcionan dentro del alcance observado. Esta aceptación permite conservar el preview como entorno QA; no autoriza publicar el POS real, retirar GitHub Pages, eliminar recursos, rotar cuentas ni iniciar automáticamente R2.

**Objetivo vigente del usuario:** crear Cloudflare Pages conectado al repositorio PRIVADO de GitHub y conservar su Supabase actual para reemplazar GitHub Pages. Ese objetivo todavía está pendiente: pos-jaise-preview usa Direct Upload y datos ficticios. El siguiente paso es una Fase 2B de integración Git y preparación del hosting definitivo, conservando los recursos existentes y separando preparación de cambio público.

## Evidencia contrastada

- Se revisaron vite.config.js, cloudflare/_headers, los scripts de compilación/subida leídos durante la publicación, la entrega formal del README, el registro .codex y preview-staging-online.json.
- Los 178 archivos actuales de dist-preview coinciden por SHA-256 con el artefacto que Codex verificó y publicó. comparacion-entrega-formal.json registra cero cambios y cero archivos ausentes.
- Comprobación HTTP actual, independiente y de solo lectura: index.html (redirige a /), sw.js, manifest.webmanifest y assets/index-Nv1kEJHw.js responden 200 y sus cuerpos coinciden exactamente con los archivos locales. comprobacion-formal-online.json incluye hashes comparados, destinos y headers observados.
- El informe online adicional de Claude registra 38 rutas, tres logins reales y ningún problema/error registrado. Corresponde al alias preview y usa únicamente tqkdtojnhgykmcbvwdmz.supabase.co.
- Se conserva la evidencia anterior ejecutada por Codex: 38 rutas en el alias principal del proyecto; tres logins y seis rutas con recarga en el alias preview; CAJERA /auditoria redirige a /ventas; sin pageerror; backend distinto de staging bloqueado en el conductor adicional. No se repitieron nuevamente estos recorridos completos al confirmar que el artefacto no cambió.
- La PWA controla la página después de recargar, y sus iconos/manifest/base raíz se comprobaron durante la publicación. La configuración de Auth se guardó solo en pos-jaise-staging con confirmación expresa del usuario, y sus capturas documentan los valores.

El conductor de Claude comprueba contenido, errores y rutas; no es una prueba completa de todas las acciones ni de la seguridad RLS. La aprobación no convierte el reporte de 38 rutas en validación de cobros, compra, stock, canjes o permisos de todas las tablas.

## Evaluación del código de hosting

El cambio de vite.config.js conserva /PosJaise/ como base por defecto del build y / en desarrollo. VITE_BASE_PATH=/ permite publicar en raíz; BASE_URL continúa guiando BrowserRouter, manifest e iconos. La exclusión de 404.html del precache y su retirada por el script de build son consistentes con el fallback SPA de Pages. El artefacto publicado no contiene 404.html.

Se mantiene registerType: prompt y no se agregó runtime cache de Supabase. El script de preview incluye salvaguardas contra el endpoint local y el ref de producción, y contra claves privilegiadas. La inspección del artefacto tampoco encontró las contraseñas/secretos locales revisados ni JWT privilegiados. Esta comprobación de archivos de texto no sustituye una auditoría exhaustiva de secretos.

Las variables VITE_* se fijan al compilar. En Direct Upload, cambiarlas después en el dashboard no altera el JavaScript subido. Para la próxima integración Git, el build en Cloudflare sí necesitará sus variables de entorno correspondientes y la versión de código publicada en GitHub: los cambios locales sin confirmar no aparecerán automáticamente en un build remoto.

## Observaciones y condiciones

### O1 · Actualización PWA online pendiente

Se verificó control tras recarga y el aviso en la simulación local aportada por Claude. Los dos deployments online tienen el mismo bundle, por lo que no prueban recepción y activación de una versión distinta. Antes de pasar al hosting del negocio, comprobar dos versiones en preview: sesión/pestaña ya abierta, aviso, actualización, recursos sin 404 y conservación de las operaciones/borradores que deban mantenerse. No forzar actualización silenciosa para hacer pasar la prueba.

### O2 · Caché HTML: diferencia registrada, sin bloqueo actual

Se observan estos valores reales:

| Recurso | Cache-Control |
| --- | --- |
| HTML / | public, max-age=0, must-revalidate |
| sw.js | no-cache |
| manifest.webmanifest | no-cache |
| JS con hash | public, max-age=31536000, immutable |

No se exige republicar este preview solo para cambiar la cadena del header. Sin embargo, «siempre revalida» y «equivalencia exacta» son formulaciones demasiado absolutas: no-cache exige validación antes de reutilizar la respuesta; must-revalidate exige validación una vez caducada, y max-age=0 establece su frescura. En este escenario la política observada no autoriza reutilizar contenido caducado sin validar. Mantener esta precisión y comprobar el comportamiento al preparar el hosting definitivo. [RFC 9111, Cache-Control](https://www.rfc-editor.org/rfc/rfc9111.html#section-5.2.2).

Si se quiere exigir explícitamente no-cache en todo el HTML de la SPA, una regla solo para / tampoco cubre necesariamente rutas profundas. Diseñar la cobertura de documentos sin quitar el caché inmutable de assets; verificar /, /ventas, /productos, sw.js y assets tras aplicar cualquier cambio futuro.

### O3 · Rollback de código demasiado amplio

La recomendación de revertir archivos completos o conjuntos como scripts/build-*.mjs no está suficientemente aislada para este árbol con muchos cambios previos. No consta un commit exclusivo de Fase 2 que se pueda revertir como unidad. Documentar un diff o commit específico que preserve los cambios anteriores, e identificar exactamente qué archivos nuevos pertenecen a esta fase. No usar git reset, git clean ni restauración completa de package.json/vite.config.js como rollback genérico.

Pausar/eliminar staging o borrar deployments son alternativas con consecuencias distintas, no pasos automáticos del rollback. Mantenerlos disponibles para QA y pedir autorización específica antes de cualquier limpieza. Codex no ejecutó estas acciones.

### O4 · Documentación y registro desactualizados

El README todavía comienza diciendo que Pages no está creado y que no existe nada publicado; esas frases describen un estado histórico que contradice el resultado vigente. Rotularlo como histórico y colocar el estado actual al principio.

La copia del registro en .codex mantiene Fase 1 «En verificación», aunque Codex ya la aprobó. Claude debe reflejar la aprobación y enlazar VERIFICACION-FASE-1.md, además de este veredicto de Fase 2. Codex mantiene el repositorio de solo lectura y no corrige sus archivos.

### O5 · Funciones excluidas y transición de origen

Pagos/callbacks, entrega de correos reales, comparación de rendimiento con GitHub Pages, móvil físico y CSP no están validados por esta entrega. No son prueba de fallos nuevos ni razón para afirmar que el preview no funciona; sí son límites de cualquier aprobación del despliegue real. Antes del cambio público comprobar las integraciones que usa el negocio, especialmente enlaces de acceso y pagos, en sus ambientes apropiados.

La sesión, storage y service worker pertenecen al origen: el nuevo dominio no recupera automáticamente carrito/borradores locales del anterior. «Pérdida» no significa que Codex haya borrado el almacenamiento viejo: sigue en el origen anterior, salvo acciones posteriores del usuario. Preparar la transición preservando datos recuperables y sin cambiar reglas comerciales.

Las cuentas QA existentes no se rotaron ni borraron. Su gestión sigue pendiente de indicación expresa; no se copian credenciales en este informe.

## Fase 2B · Preparar Pages conectado al repo privado

Este paso refleja la aclaración del usuario; no se ejecutó en esta revisión.

1. Identificar el repositorio privado TiburonciN26/PosJaise, la rama y el commit que contienen los cambios aprobados. Claude prepara los cambios de código/Git conforme a las instrucciones del usuario; Codex revisa. No asumir que el estado local ya está en GitHub.
2. Crear un proyecto Pages con integración Git nativa. Direct Upload no se convierte a esa modalidad; conservar pos-jaise-preview como QA. Elegir el nombre definitivo con el usuario para evitar otro proyecto temporal innecesario. [Direct Upload: limitación de cambio a Git](https://developers.cloudflare.com/pages/get-started/direct-upload/).
3. Conectar únicamente el repo necesario y revisar los permisos solicitados por Cloudflare/GitHub. Configurar npm run build:cloudflare, salida dist, versión Node compatible y variables del entorno elegido. Los secretos de servidor no deben ser VITE_*.
4. Verificar un build de la versión exacta del repositorio y rutas profundas/sesión/PWA. Para producción, conservar el Supabase existente del negocio; no migrar ni copiar sus datos al staging. Los previews QA existentes siguen separados.
5. Completar actualización PWA entre versiones, integraciones afectadas y transición de origen antes de autorizar el cambio público. Mantener GitHub Pages para reversión durante el periodo acordado.

No se inicia la Fase 3 (R2) como consecuencia automática de esta aprobación. El usuario indicó que desea primero resolver el hosting conectado al repo. La optimización de medios queda como trabajo posterior del plan, según su prioridad vigente.

## Archivos de evidencia

En esta carpeta: comparacion-entrega-formal.json, comprobacion-formal-online.json, artefacto-verificado.json, verificacion-online-root.json, verificacion-online-preview.json, pwa-headers.json y capturas de publicación/Auth. En el repositorio: docs/evidencia-rendimiento/fase-2/preview-staging-online.json y la entrega formal del README. El resultado con la aserción literal no-cache fallida se conserva; esta revisión explica la diferencia y no la oculta.

## Mensaje para Claude Code

> Codex revisó la entrega formal y aprobó con observaciones el preview de Fase 2. El artefacto de 178 archivos coincide y los recursos esenciales online conservan sus hashes. Registra este veredicto y la aprobación previa de Fase 1; actualiza el estado inicial histórico del README y documenta un rollback de código que no borre cambios previos. Mantén pendientes la actualización PWA entre dos versiones online y las limitaciones declaradas. No inicies R2 ni cambies/borras recursos existentes. El objetivo aclarado por el usuario es Cloudflare Pages conectado al repo privado y conservar su Supabase del negocio: prepara la Fase 2B descrita aquí para su revisión antes de ejecutar el cambio público.
