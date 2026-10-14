# Preview 9bb1330: publicación y entrega Pages verificadas

10 de octubre de 2026, America/Lima. Codex, QA de solo lectura. No se cambiaron configuración, archivos de aplicación, datos, historial Git ni deployments. Solo informe/evidencia nuevos en `.codex`, conforme a la instrucción persistente del usuario.

## Veredicto

**Verificado y aprobado el estado publicado del preview `9bb13306`.** La entrega Pages `/medios` y el aislamiento de staging se conservan. Sin bloqueos nuevos para preparar el plan local de la ronda PWA. No se ejecutó ni autorizó por esta revisión un nuevo commit/push o prueba con escritura.

Las corridas aprobadas **27/27 y 23/23 siguen atribuidas a b36e7495**, no a 9bb13306. No las repetí porque este commit no modifica la aplicación, la Function o la configuración, y los scripts aprobados conservan sus hashes.

## Commit y validación declarada

HEAD local: `9bb133063270df2af2a52e2cfe4e260d5b8b518b`. Main local conserva `0dc629e430ed07eeaccec273d31de93e9717d9bf`; no hice fetch ni verifiqué un cambio remoto de main. Árbol de archivos versionados limpio en el momento de lectura.

El commit incluye los siete archivos declarados: cuatro scripts/helper, runbook, changelog e informe de clon limpio de b36e749. No introduce `.codex/` ni `.env*`. La configuración `.codex/config.toml` ya existente sigue versionada en el árbol; eso no equivale a incorporar los informes de QA en este commit.

La comparación Git contra b36e749 de `src`, `functions`, `cloudflare`, `public`, Vite, package y lockfile no muestra cambios. Hashes de guardas/UI/caché coinciden con la revisión CP-01 aprobada. No repetí sus tests o lint sin cambios nuevos.

Leí `clon-limpio-9bb1330.json`: corresponde al commit exacto, 880 candidatos, imagen de login incluida, 180 archivos en ambas salidas, cero diferencias de contenido y 11 diferencias solo de fin de línea. Es validación ejecutada por Claude y auditada aquí; Codex no repitió npm ci/build ni instalación de dependencias.

## Deployment confirmado en el navegador integrado

Cloudflare muestra **Preview**, rama `feat/cloudflare-pages`, commit `9bb1330`, estado **success**, duración **34 s**.

- UUID: `a68f02d7-3f45-43de-b494-f27d0c7a9d76`.
- URL inmutable: `https://a68f02d7.pos-jaise.pages.dev`.
- Alias: `https://feat-cloudflare-pages.pos-jaise.pages.dev`.
- Marca del HTML del alias: **`9bb13306`**.

Navegación y lectura del panel únicamente; no se pulsó Retry ni se guardó configuración. Captura de comprobación en la evidencia nueva. El identificador del deployment se obtuvo de los enlaces y detalle visibles, sin leer APIs privadas o estado oculto del dashboard.

## Comprobación pública independiente

Verificador externo, solo GET/HEAD, sin login, cookies ni escrituras. **140 scripts JS de entrada/precache responden 200**, sin fallos HTTP ni hallazgos de claves privilegiadas en el escaneo; no se imprimieron ni guardaron bundles o claves.

- Configuración de medios por rol: proveedor R2, Worker aprobado de staging, publicUrl exacta del alias con `/medios`, y r2.dev como base adicional reconocida.
- Solo backend staging `tqkdtojnhgykmcbvwdmz`; sin ref del negocio ni Supabase local en los artefactos escaneados.
- `/ventas` y `/medios-extra`: 200 HTML SPA. Manifest scope/start_url `/`.
- SW excluye `/medios` con el patrón específico de denylist y no precachea 404.html.
- GET/HEAD de `/medios`, `/medios/`, clave ficticia inexistente y destino inválido: 404 no-store/nosniff/noindex, HEAD sin cuerpo. No se usó un objeto nuevo para probar caché positiva.
- HTML revalida y conserva noindex; SW no-cache. La URL Pages de producción continúa respondiendo 404. Esto no es una nueva auditoría de las operaciones del negocio o de GitHub Pages.

Identidad de service worker, SHA-256:

- Alias nuevo e inmutable nuevo: `8018435f8d905900582e119857e3e5bae8e70ce62a74239aabd16d4d92bf9071`.
- Anterior b36e7495 con Pages, inmutable 4d23d410: `4c3d38c262bc6f00879681c535548bd45d0e8cf440d2206222df247be39bca42`.

El SW cambia y el alias coincide con el deployment nuevo. Esto confirma identidad/publicación, **no que la actualización PWA se haya ejercitado**.

Comparé también el CSS público de los dos artefactos: misma ruta `assets/index-CvFTgvGX.css`, **184.288 bytes**, SHA-256 idéntico `df3bfcb68a0e416de64a14167cba07110b4c415aaf9221ac0355a218bc2cb9b7`. La compilación de esta documentación no alteró ese CSS. No es una comparación byte a byte de todos los bundles entre commits; el build-id sí cambia.

## Preparación del plan PWA

El siguiente paso puede ser el **plan local de Claude**, sin publicaciones todavía. Debe especificar:

1. Versión inicial A: este artefacto Pages 9bb13306, alias/deployment/SW registrados. Preflight de marca y entrega efectiva antes de autenticar o publicar B; negativos abortan sin publicación.
2. Qué comprueba cada transición propuesta (p. ej. venta pendiente y caja vacía), qué documentación útil agrupa cada commit y qué autorización cubrirá commit/push/publicación. Dos commits adicionales no están autorizados por este veredicto.
3. Aviso de actualización, permanencia en A hasta aceptación, bloqueo con trabajo pendiente, sesión protegida real después de B y configuración Pages `/medios` en ambas versiones. Distinguir carrito operativo de clave localStorage ficticia.
4. Exclusión de medios del fallback del SW y rutas de medios intactas, errores HTTP/pageerror/requestfailed y aislamiento staging. Si el ensayo añade objetos/filas QA para comprobar imágenes, describirlo y solicitar su autorización específica; no asumirla por el permiso de las dos corridas ya realizadas.
5. Evidencia en carpeta nueva de `.codex`, identidades exactas A/B y estado final/limpieza; sin un push adicional solo para archivar la última ronda. Una prueba fallida conserva evidencia y pendientes.

No creé ni envié mensajes a Claude. El usuario puede pasarle este informe junto a la indicación de preparar el plan. Al recibirlo, Codex lo revisará como QA.

## Límites y evidencia

Se conservan los pendientes: PWA con Pages, rollback de URLs de Galería en filas ficticias, purga, CPU/cuota, fotos reales, Firefox/Safari/móvil, carga/concurrencia, recolector y migración inversa. La Fase 3 completa y producción permanecen sin aprobar. El dominio propio sigue opcional para una compra futura.

Evidencia nueva en `.codex/evidencia-pages-9bb1330/`: `verificacion-entrega-pages.json` (controles y hashes de assets), `css-comparado.json`, copias `.txt` de los verificadores y `deployment-correcto.png`. Informes anteriores, runbook y registro se conservaron sin editar.
