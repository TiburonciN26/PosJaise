# Pages publicado y Supabase staging configurado

Fecha: 9 de octubre de 2026.
Estado: desbloqueo de despliegue y configuración completado. Este documento entrega evidencias de la publicación; no sustituye la revisión integral del diff y todos los criterios de aceptación de la Fase 2.

## URLs verificadas

- Alias de la rama preview: https://preview.pos-jaise-preview.pages.dev
- Despliegue inmutable de preview: https://91c40d00.pos-jaise-preview.pages.dev
- ID de deployment preview: 91c40d00-3813-4aa6-8430-98b304269845.
- Proyecto: https://dash.cloudflare.com/af5ea2cb3f504970fe293b1923cd64d7/pages/view/pos-jaise-preview
- Alias principal del proyecto de pruebas: https://pos-jaise-preview.pages.dev
- Primer deployment: https://c80701b6.pos-jaise-preview.pages.dev, ID c80701b6-8152-44db-a65c-faa3112f4d2e.

Se publicaron dos deployments del MISMO artefacto de staging. El dashboard inicial no ofrecía selección de Preview mientras el proyecto no tenía ningún deployment: primero se publicó el artefacto en main, dentro del proyecto separado pos-jaise-preview. Después se eligió Preview y el nombre preview. Esto no cambia el dominio del negocio ni su Supabase de producción. Ambos deployments usan exclusivamente https://tqkdtojnhgykmcbvwdmz.supabase.co.

## Subida realizada

Se utilizó el navegador integrado con la sesión de Cloudflare del usuario, mediante Direct Upload. No se inició wrangler login, no se generó ni compartió token Cloudflare y no se recompiló el repositorio. El artefacto existente dist-preview se empaquetó en un ZIP fuera del proyecto, con index.html y _headers en raíz.

Revisión independiente previa al upload: 178 archivos / 4.713.271 bytes, base de manifest y scope /, sin 404.html, un único endpoint Supabase de staging. No se encontraron contraseñas/secretos locales revisados ni JWT con rol privilegiado en los archivos de texto del artefacto. La comprobación no es una auditoría exhaustiva de secretos de todo el repositorio. Cloudflare confirmó 178/178 archivos subidos en ambos casos. artefacto-verificado.json guarda hashes SHA-256 por archivo.

## Supabase Auth · cambios autorizados y guardados

Proyecto confirmado por la UI: pos-jaise-staging, ref tqkdtojnhgykmcbvwdmz.

Antes: Site URL http://localhost:3000; lista de redirects vacía.

Después:

- Site URL: https://pos-jaise-preview.pages.dev
- Redirect: https://pos-jaise-preview.pages.dev/**
- Redirect: https://*.pos-jaise-preview.pages.dev/**

El usuario confirmó expresamente guardar únicamente en staging. La UI mostró Successfully added 2 URLs y la Site URL guardada. El segundo patrón cubre el alias preview y los subdominios de despliegues de este proyecto. No se alteraron URLs de Auth de producción, MFA, RLS, usuarios, contraseñas ni esquema. No se enviaron correos de confirmación/recuperación: su entrega efectiva permanece pendiente; estas cuentas tienen dominios ficticios de QA.

## Verificaciones después de publicar

- Se ejecutó scripts/verificar-preview-staging.cjs contra el alias principal del proyecto y se guardó verificacion-online-root.json fuera del repositorio: 38 rutas, 0 problemas de contenido/HTTP registrados y 0 errores registrados por ese conductor. Login real por formulario: ADMIN y CAJERA → /ventas; CLIENTE → /inicio. Solo hubo tráfico Supabase a tqkdtojnhgykmcbvwdmz.supabase.co. El conductor es el aportado por Claude; sus resultados no equivalen a una auditoría exhaustiva de permisos.
- Conductor adicional de Codex verify-online-preview.cjs contra el alias de rama: tres logins, seis rutas con recarga, incluida CAJERA /auditoria → /ventas. Sin pageerror. Endpoints de otros Supabase bloqueados en ese conductor.
- Rutas públicas /inicio, /servicios y /productos responden 200; manifest e iconos responden correctamente. X-Robots-Tag noindex,nofollow observado.
- manifest start_url/scope = /. sw.js y manifest.webmanifest devuelven Cache-Control no-cache.
- La PWA controla la página después de recargar: controlador https://preview.pos-jaise-preview.pages.dev/sw.js.
- Asset con hash /assets/index-Nv1kEJHw.js: 200, Cache-Control public,max-age=31536000,immutable.
- HTML: Cloudflare redirige /index.html a /; la respuesta final devuelve public,max-age=0,must-revalidate. El conductor inicial exigía literalmente no-cache y marcó una aserción como fallida. Se conserva ese resultado en verificacion-online-preview.json. El valor observado exige revalidación al estar vencido y no permite servir contenido stale; se registra como diferencia respecto a la cabecera literal anunciada por Claude, sin bloqueo de publicación ni funcionalidad. No se parcheó la fuente para silenciarlo. pwa-headers.json recoge la comprobación complementaria. Revisar esta diferencia al cerrar formalmente los criterios de caché de Fase 2.
- Navegador integrado: /productos muestra los seis productos ficticios, sin sesión de QA persistida en el navegador del usuario.

No se midió rendimiento comparativo frente a GitHub Pages, no se probó hardware móvil físico ni se verificó online un cambio de versión PWA entre dos bundles diferentes: los dos deployments usan el mismo artefacto. No se realizaron ventas, canjes, cargas de comprobantes ni pagos. Las Edge Functions de pago siguen sin desplegar en staging conforme a la entrega de Claude; no considerar este preview una validación de cobros.

## Evidencias en esta carpeta

- artefacto-verificado.json; dist-preview-upload.zip.
- verificacion-online-root.json; verificacion-online-preview.json; pwa-headers.json.
- verify-online-preview.cjs (conductor externo, sin secretos incrustados).
- pages-preview-publicado.jpg; supabase-staging-configurado.jpg; preview-web-publicada.jpg.

Las cuentas QA existentes se utilizaron para login de lectura y se mantienen para las siguientes comprobaciones. Codex no creó nuevas cuentas en staging ni rotó/borró las entregadas por Claude. La limpieza o rotación de estas cuentas sigue a cargo de su responsable. No se modificaron archivos del repositorio, .env, migraciones, GitHub Pages, R2 ni el dominio del negocio.

## Mensaje para Claude Code

> Codex completó la subida por el dashboard: proyecto pos-jaise-preview, rama preview, URL https://preview.pos-jaise-preview.pages.dev y deployment https://91c40d00.pos-jaise-preview.pages.dev. No hace falta wrangler login para esta publicación. También guardó en pos-jaise-staging (tqkdtojnhgykmcbvwdmz), con confirmación del usuario, Site URL https://pos-jaise-preview.pages.dev y Redirect URLs https://pos-jaise-preview.pages.dev/** y https://*.pos-jaise-preview.pages.dev/**. Se verificaron tres logins, 38 rutas en el alias principal y comprobaciones adicionales en preview, más headers y control PWA. Registra la evidencia y completa únicamente la entrega de la Fase 2 para revisión formal; no inicies la Fase 3 ni publiques sobre producción. Mantén explícitas las limitaciones de pagos, correos QA y prueba de actualización PWA online. No borres ni rotes cuentas o deployments sin autorización.
