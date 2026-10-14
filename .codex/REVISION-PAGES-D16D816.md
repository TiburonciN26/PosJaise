# Verificación del preview d16d816

Fecha: 10 de octubre de 2026. Codex, QA de solo lectura.

**Resultado: despliegue y artefacto público confirmados. Sin bloqueos en las comprobaciones de publicación realizadas.** No equivale a aceptar los ensayos reales de caché/interfaz del cambio ni la Fase 3 completa.

## Identidad corroborada

- Commit: `d16d816f4d64cde80c230092126ed8204c6ce0e9`.
- Rama: `feat/cloudflare-pages`.
- Deployment: `2d701280-e72e-45da-9833-39bc25b5debe`.
- URL inmutable: https://2d701280.pos-jaise.pages.dev
- Alias: https://feat-cloudflare-pages.pos-jaise.pages.dev
- Marca HTML: `d16d816f`.
- Panel de Cloudflare: **success**, duración **54 s**.
- SHA-256 del `sw.js` público: `41175d82c3da80bafa992061d13dfba23ea5a429887af884e15cbbf4e9cd4174`, idéntico en alias e inmutable y distinto del anterior `08a740e9`.

## Comprobaciones de Codex

Se inspeccionaron con GET/HEAD públicos HTML, service worker, manifest, rutas y **140 archivos JavaScript**. Se corroboraron proveedor R2, Worker de staging, URL pública Pages `/medios`, base anterior de `r2.dev` reconocida y Supabase de staging. No se detectaron el ref del negocio, Supabase local ni los tipos de clave privilegiada prohibidos por el escáner existente. Ningún archivo solicitado falló.

`/ventas` y `/medios-extra` sirven la SPA; el manifest conserva scope/start_url raíz. El service worker excluye `/medios` y no incluye `404.html`. Ocho solicitudes GET/HEAD de `/medios`, `/medios/`, una clave ficticia sin objeto y un destino inválido devolvieron 404 con `no-store`, `nosniff` y `noindex`; los HEAD no tuvieron cuerpo.

HTML: `public, max-age=0, must-revalidate`; service worker: `no-cache`; HTML con `noindex`. Estas cabeceras del HTML no son prueba de las respuestas positivas de medios.

Se leyó el commit local: contiene exactamente los cinco archivos aprobados y la constante `REVOCAR_CON_R2=false`. `main` local sigue en `0dc629e430ed07eeaccec273d31de93e9717d9bf`; no se hizo fetch ni nueva consulta de su ref remoto. El panel indica despliegues automáticos de producción pausados y ninguna publicación de producción; `https://pos-jaise.pages.dev/` respondió 404. No se revisó GitHub Pages en esta ejecución.

## Clon limpio y límites

Se leyó el informe de Claude `clon-limpio-d16d816.json`: identifica el commit exacto, 180 archivos de salida, 0 diferencias de contenido y 11 solo de fin de línea. Es evidencia de Claude; Codex no repitió instalación ni build.

No se subieron fotos ni se escribieron filas. Por tanto, **no se comprobó todavía el `max-age=0, must-revalidate` de un 200/304 de foto existente, MISS→HIT, expiración, estado final de limpieza ni recorrido 23/23 sobre este build**. Un 404 tampoco prueba por sí solo que el binding esté configurado correctamente. El cambio local y el commit fueron aprobados técnicamente en las revisiones anteriores; esta revisión confirma su publicación, no reemplaza los ensayos de funcionamiento con objetos.

Las evidencias 27/27 de caché y 23/23 de interfaz conservan su atribución a `b36e7495`. No se reasignan a `d16d816f`.

## Siguiente paso

Preparar la repetición de los dos verificadores adaptados con `--build-id=d16d816f`, entrega Pages y salidas nuevas en `.codex`. Antes de ejecutarlos, el usuario debe autorizar expresamente las escrituras ficticias en R2/Supabase de staging y su limpieza acotada. La autorización de commit/push no cubría estas escrituras. Mantener B desactivada; no cambiar variables, binding, producción ni GitHub Pages.

Codex no hizo mutaciones externas, login QA, escrituras de datos, commit o push. Solo guardó este informe y evidencia nuevos, conforme a la instrucción permanente del usuario. El primer intento de lectura pública en el sandbox falló por DNS; la lectura aprobada fuera del sandbox terminó con exit 0. No hubo rechazo de revisión automática.

Evidencia: `evidencia-pages-d16d816/verificacion-entrega-pages.json`, `dashboard.txt` y reproducción como `verificar-publicacion.txt` (solo GET/HEAD, sin credenciales).
