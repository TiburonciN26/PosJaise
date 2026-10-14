# Revisión del commit c169373 y del alias publicado

Fecha: 10 de octubre de 2026, America/Lima. Codex: QA de solo lectura.

## Veredicto

**Commit y artefacto público de Preview verificados. El alias ya sirve la marca correcta `c1693734`. No encontré un nuevo bloqueo en esta publicación.** Se mantiene la aceptación del recorrido 22/22 de Claude sobre el build anterior, con la distinción de versiones y cobertura.

Esta revisión no aprueba el hosting definitivo del negocio, el retiro de GitHub Pages ni el cierre completo de la Fase 3. La prueba interactiva de actualización PWA entre bundles sigue pendiente.

## Commit y checkout limpio

- Commit inspeccionado: `c169373434ccc67c419710e8daca8e489dec85bc`.
- Diff frente a `ba07a32`: **11 archivos**, los documentos, tres scripts y evidencia revisados en V4.
- No cambia `src/`, `public/`, `vite.config.js`, `package.json`, lockfile, `cloudflare/` ni `.github/`.
- No incluye `.codex/`, `.env*` ni las capturas antiguas no versionadas de Fase 1.
- HEAD local está en c169373; main local permanece en `0dc629e430ed07eeaccec273d31de93e9717d9bf`. Codex no hizo fetch, commit, push o cambios de Git. El alcance del push a una sola rama es el informado por Claude; estas comprobaciones de Git usan las referencias locales.

Leí `clon-limpio-commit-nuevo.json`: identifica el commit exacto c169373, 857 candidatos, imagen del login incluida y 179 archivos de salida; registra cero diferencias de contenido y 11 diferencias solo de fin de línea. Es **evidencia de Claude**, no una repetición independiente de `npm ci`/build por Codex. El archivo versionado `clon-limpio-commit.json` sigue describiendo ba07a32; no se presenta como validación del nuevo commit.

## Verificación independiente de la publicación

Origen: `https://feat-cloudflare-pages.pos-jaise.pages.dev`.

Mediante GET públicos, sin login o escrituras, consulté HTML, service worker, manifest, la ruta directa `/ventas` y **140 entradas de scripts** del precache/HTML, equivalentes a **139 scripts únicos**. Resultado:

| Comprobación | Resultado |
|---|---|
| Marca de HTML | `c1693734` |
| Scripts consultados | Todos HTTP 200 |
| Proveedor compilado de medios | R2 |
| Worker de staging y URL pública r2.dev | Presentes |
| Supabase de staging | Presente |
| Ref del backend del negocio | Ausente |
| Supabase local `127.0.0.1:54321` | Ausente |
| Escaneo de claves privilegiadas/JWT incorrectos | Sin hallazgos examinados |
| `/ventas` por URL directa | HTTP 200 |
| Manifest start_url/scope | `/` |
| `404.html` en precache | Ausente |
| `https://pos-jaise.pages.dev/` | HTTP 404, como antes |

Cabeceras: HTML `public, max-age=0, must-revalidate`, SW `no-cache`, `X-Robots-Tag: noindex`. No se imprimieron claves. Estas lecturas acreditan qué sirve el alias; no consulté el dashboard de Cloudflare en esta revisión ni registré un UUID/duración/versión de Node del deployment nuevo.

## Comparación con el artefacto anterior

Referencia anterior: `https://9d206972.pos-jaise.pages.dev` (ba07a32 reconstruido con R2).

Aunque el commit solo agrega documentos/scripts, **los bytes del bundle no son idénticos** al artefacto anterior:

- CSS anterior: 184.252 bytes; actual: 184.288 bytes. Diferencia exacta de 36 bytes: `.row-1{grid-row:1}` y `.row-2{grid-row:2}`. Al retirar esos dos bloques, el texto CSS completo vuelve a ser idéntico.
- Los nombres de esas clases están ahora en el informe `clon-limpio-commit.json` versionado. Es consistente con el escaneo de clases de Tailwind ya identificado durante las revisiones. No se cambió el CSS fuente ni se reporta un fallo funcional por esas utilidades adicionales.
- De 139 módulos JS, 64 tienen el mismo nombre base/contenido SHA-256; los otros 75 son textualmente idénticos tras normalizar únicamente sufijos de ocho caracteres de archivos `.js`/`.css` referenciados. No faltan módulos. Esto explica los cambios de nombres/hashes del empaquetado; no equivale a una prueba semántica universal.
- El HTML no es idéntico tras reemplazar solo la marca, pues también referencia nombres nuevos de assets.
- SW anterior SHA-256: `cb550bd02f31857e574daef26361b4b19f8f4f1db693c2908388c6d77bc417f5`.
- SW actual SHA-256: `9553c66912c37def55bfebc6c1805b52755ab7ff39b56515648ac7e559b0e923`.

Por tanto se trata de una publicación distinta y no debe etiquetarse como la misma corrida 652b14. No se repitió el recorrido que escribe fotos/datos, ni el aviso y actualización PWA. El cambio de artefactos y la comparación anterior permiten acotar la publicación sin ampliar pruebas destructivas.

## Qué queda y siguiente paso

La marca esperada para nuevas pruebas de este alias es **`c1693734`**. Para ejecutar el verificador de interfaz, Claude debe usar esa marca exacta y guardar una corrida nueva; si el alias cambia otra vez, verificar primero la publicación efectiva.

La revisión de la publicación queda completa. Siguen los pendientes ya declarados: actualización PWA entre builds, fotos reales del catálogo, Firefox/Safari/móvil físico, carga/concurrencia, CDN y `nosniff`, purga, recolector destructivo y migración inversa; reemplazo real de principal de Servicio no ejercitado. La aceptación parcial de staging no autoriza escrituras R2 en el negocio ni retirar GitHub Pages.

No repetí las 41 regresiones ni lint: el commit contiene los scripts ya aceptados en V3 y esta revisión se centró en el commit exacto, el informe nuevo y el artefacto servido. Los dos errores globales conocidos de fixtures siguen como límite previo; no se declaró un lint global limpio.

No hubo cambios de datos o credenciales en esta revisión. El rollback propuesto `git revert c169373` requiere ejecución por Claude con autorización, y genera otra publicación; Codex no lo ejecutó. Por tratarse de un commit de evidencia/scripts/documentación, no hay aquí una reversión de datos nueva que probar.

## Evidencia

En `.codex/evidencia-pages-c169373/` se guardan:

- `verificacion-alias-final.json`: HTTP, hashes y escaneo del alias.
- `comparacion-artefactos.json`: comparación inicial con la publicación anterior.
- `comparacion-css-confirmada.json`: diferencia íntegra del CSS.
- `comparacion-js-confirmada.json`: comparación de 139 módulos.
- Copias de los tres diagnósticos como `.txt`.

Únicamente se creó este informe y sus evidencias conforme a la instrucción de guardarlos en `.codex`. No se modificó código/configuración, datos, recursos externos, Git ni archivos existentes del proyecto.
