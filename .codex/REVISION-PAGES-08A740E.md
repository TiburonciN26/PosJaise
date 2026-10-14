# Preview 08a740e: publicación verificada

10 de octubre de 2026, America/Lima. Codex, QA de solo lectura. No se guardó configuración, ejecutó purga, escribió datos o modificó Git. Solo informe/evidencia nuevos en `.codex` conforme a la instrucción persistente del usuario.

## Veredicto

**Confirmado y aprobado el estado publicado del alias con marca `08a740e9` y entrega Pages `/medios` intacta.** Sin hallazgos bloqueantes nuevos del commit/publicación. El ensayo 20/20 sigue atribuido a 7ee3c78e; no se le cambia la versión ni se repite su escritura.

## Commit y clon limpio

HEAD local `08a740e9ff39646161ea9c45ea2fe37866d5758f`; main local conserva `0dc629e430ed07eeaccec273d31de93e9717d9bf`. Árbol de archivos versionados limpio al leerlo; no hice fetch ni verificación de main remoto.

El commit contiene los 11 archivos declarados: los diez del paquete revisado y el changelog implementacionesWed.md. No introduce informes `.codex` ni `.env*`. El diff contra 7ee3c78 de src, Functions, cloudflare, public, Vite y package/lockfile está vacío: no hay cambios de runtime o configuración.

Leí clon-limpio-08a740e.json: corresponde al commit exacto, 889 candidatos, imagen de login incluida, 180 archivos en ambas salidas, cero diferencias de contenido y 11 diferencias solo de fin de línea. Es evidencia de Claude auditada; Codex no repitió npm ci/build ni instalación de dependencias.

## Cloudflare y artefacto público

El navegador integrado confirma **Preview**, rama feat/cloudflare-pages, commit 08a740e, estado **success**, duración **44 s**.

- Deployment: `2bb69dd0-9428-4293-b51e-0e5b4dba4f5d`.
- Inmutable: `https://2bb69dd0.pos-jaise.pages.dev`.
- Alias: `https://feat-cloudflare-pages.pos-jaise.pages.dev`.

Verificador independiente GET/HEAD, sin login ni escrituras: 140 scripts de entrada/precache 200, cero fallos HTTP y cero hallazgos de claves privilegiadas en el escaneo. No se imprimieron ni guardaron claves/bundles.

Config de medios por rol: proveedor R2, Worker aprobado de staging, publicUrl exacta del alias `/medios`, r2.dev como base extra reconocida. Solo ref de staging, sin negocio ni Supabase local. Se conservan rutas /ventas y /medios-extra de SPA, manifest en raíz, exclusión específica de medios y ausencia de 404.html precacheado.

GET/HEAD de /medios, /medios/, clave inexistente y destino inválido: 404 no-store/nosniff/noindex; HEAD sin cuerpo. HTML revalida con noindex; SW no-cache. La URL Pages de producción sigue dando 404 y la vista general del panel sigue mostrando producción automática pausada, sin deployment de producción. Esto no es una auditoría del sitio GitHub Pages del negocio.

SW SHA-256:

- Alias e inmutable nuevos: `37dccfddf7ed7e3b757d4399a054c37e4d925ebece4dd4a80a7294ff6f9ab165`.
- Anterior 7ee3c78e: `2a43dbc12adb80f8dcc8afef850c1c65f91691783e3b8c2aa878f8060650ce7e`.

Los hashes cambian con el build y el alias coincide con el inmutable nuevo. No se ejercitó una nueva transición PWA.

CSS público comparado entre B2 anterior y alias nuevo: mismo index-CvFTgvGX.css, 184.288 bytes y SHA-256 `df3bfcb68a0e416de64a14167cba07110b4c415aaf9221ac0355a218bc2cb9b7`. No se generaron cambios de estilo por esta documentación.

## Estado de las fotos del ensayo y siguiente estudio

GET de las dos URLs g ficticias del ensayo anterior, a `2026-10-10T22:14:35.492Z`: **404 no-store en Pages**, POP MIA, sin purgar. Los HIT observados en la revisión previa ya no persisten en estas lecturas. No se infiere de dos URLs un resultado global de todas las cachés de navegador/POP.

El siguiente frente puede ser el **estudio de solo lectura de purga y contrato de retirada**. Dejé un estudio preliminar separado en `.codex/ESTUDIO-PURGA-MEDIOS-PAGES.md`, distinguiendo Cache API, navegador, build cache y Workers Caching. No implementé ni ejecuté mecanismos de retirada.

Continúan pendientes purga/contrato, CPU/cuota, fotos reales, otros navegadores/móvil, carga, recolector y migración inversa general. Dominio propio sigue opcional futuro. Fase 3 completa y producción no están aprobadas.

## Evidencia

Nueva carpeta `.codex/evidencia-pages-08a740e-purga/`: verificacion-entrega-pages.json, css-comparado.json, fotos-ensayo-actual.json, diagnostico-cabeceras.json y copias `.txt` de los verificadores/diagnóstico, más deployment-08a740e.png. Plan, runbook, código e informes anteriores sin editar.
