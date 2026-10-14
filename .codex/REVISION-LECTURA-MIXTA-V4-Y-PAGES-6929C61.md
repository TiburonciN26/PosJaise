# Revisión V4 de lectura mixta, recolector y Pages 6929c61

Fecha local: 10 de octubre de 2026 (America/Lima). Evidencia UTC: 11 de octubre. Revisión de Codex en modo QA de solo lectura. Incluye la corrección local pendiente y la publicación que Claude informó después de la interrupción.

## Veredicto

**RG-01, RG-02, RG-03 y ML-01b cerrados en las reproducciones revisadas.** No encontré nuevos bloqueos dentro de este alcance. El harness queda aceptado localmente para preparar su ensayo acotado de staging, con autorización de escrituras separada. Esto no acredita una corrida real ni aprueba el recolector habitual para automatización o producción.

**Publicación 6929c61 confirmada.** Cloudflare Pages terminó el preview con success y el alias sirve build-id 6929c619, manteniendo la entrega Pages y el backend de staging. Los informes reales de builds anteriores conservan sus propias marcas y no se reasignan.

El paquete mixto anterior permanece construido desde ec2a3b6. Hay que regenerarlo desde el commit exacto 6929c619e88a91434cb16ee6a8d2de90de94c091, que ya incluye ML-03, y verificarlo antes de considerarlo artefacto final de rollback. No hace falta otro commit para disponer de ML-03: ya está en este.

## Cierre de hallazgos

| Hallazgo | Evidencia de la corrección | Resultado |
| --- | --- | --- |
| RG-01, limpieza y referencia tardía | Consulta puntual antes de cada DELETE de limpieza. La reproducción anterior ahora conserva la fila tardía y la foto g; solo limpia el grupo sin referencia. Las regresiones cubren también protegido, referencia entre grupos y consulta caída. | Cerrado localmente |
| RG-02, snapshot de filas | Snapshot canónico de id, título, ambas URLs, orden y activo, y diferencias explícitas. La reproducción conserva el título ajeno modificado y devuelve completa=false y estadoFinalConfirmado=false. El orden de las filas no altera la igualdad. | Cerrado localmente |
| RG-03, conteo ausente | El adaptador real rechaza count no entero o negativo. Con SDK real y HEAD ficticio sin Content-Range lanza por count=null; recolectar aborta y no llama a eliminar. Conteos cero y positivos tienen controles sanos. | Cerrado localmente |
| ML-01b, mayúsculas Windows | Identidad con relative(base,ruta)===''. Las tres rutas exacta, minúscula y mayúscula se rechazan incluso con marca propia y reemplazo. | Cerrado localmente |

Código revisado: [limpieza puntual](C:/WedJaiseReact/scripts/lib/ensayo-recolector.mjs:148), [snapshot completo](C:/WedJaiseReact/scripts/lib/ensayo-recolector.mjs:167), [conteo estricto](C:/WedJaiseReact/scripts/medios-huerfanos.mjs:84) e [identidad de salida](C:/WedJaiseReact/scripts/lib/salida-segura.mjs:20).

La comprobación de la fila propia usa los mismos campos completos. El comentario editorial de URLs refleja ahora la reescritura de lectura de ML-03. Los cambios ajenos detectados se informan y no se restauran.

La ventana entre consulta y DELETE sigue existiendo; esta revisión no afirma que haya una transacción o bloqueo entre Supabase y R2. El flujo mantiene pendientes y estado no confirmado cuando debe conservar objetos.

## Pruebas ejecutadas

- Harness en memoria: 24/24.
- Adaptador real de Supabase con fetch ficticio: 9/9.
- Salida segura con filesystem ficticio: 9/9.
- URLs y cableado real de medios: 16/16.
- Lectura mixta con Vite SSR real: 7/7.
- Seis entradas diagnósticas independientes de la revisión anterior: las dos reproducciones de flujo, una de conteo y tres rutas Windows; todas verifican el comportamiento corregido.
- oxlint de los archivos revisados: sin diagnósticos. node --check del constructor y CLI del recolector: correctos.

Total de casos distintos de las suites: 65. El diagnóstico vuelve a ejecutar la suite de 24, pero no se suma dos veces. No repetí los controles negativos por mutación de Claude, ni carga 29, guardas 49 o entrega 48: no hubo nuevos cambios que justificaran repetirlos en esta revisión.

Los diagnósticos y las copias SSR se ejecutaron fuera del proyecto. El SDK recibió únicamente HTTP ficticio y credenciales ficticias; no se autenticó en Supabase real. No se ejecutaron el CLI de carga, el CLI del recolector ni el constructor del paquete, y no hubo npm ci, instalaciones ni borrados reales.

## Commit y validación de Claude

HEAD local y commit publicado en el panel: 6929c619e88a91434cb16ee6a8d2de90de94c091. main local: 0dc629e430ed07eeaccec273d31de93e9717d9bf. git diff --quiet de los archivos versionados devuelve 0 al cierre de la revisión.

El commit contiene los 21 archivos indicados. Se distinguen dos cambios funcionales:

- Frontend: resolverUrlGaleria reescribe las URLs propias antiguas a la base configurada, conservando destino, UUID y variante (ML-03).
- Herramienta del recolector: estaReferenciado ahora aborta ante conteos incompletos (RG-03); no es lógica del frontend ni modifica el esquema.

No incluye .codex ni .env. No se modificó functions/ ni la política B de entrega en este commit.

Leí el informe de Claude [clon-limpio-lectura-mixta.json](C:/WedJaiseReact/docs/evidencia-rendimiento/fase-3/clon-limpio-lectura-mixta.json): identifica este commit exacto, 908 candidatos, 180 archivos de salida, 0 diferencias de contenido y 11 diferencias solo de fin de línea. Es evidencia aportada por Claude; Codex no repitió npm ci ni ese build. El clon limpio descrito corresponde al build normal de Preview con proveedor r2, no acredita por sí solo un paquete final de lectura mixta.

## Verificación de Pages en vivo, solo lectura

Panel del deployment: [c5effd38](https://dash.cloudflare.com/af5ea2cb3f504970fe293b1923cd64d7/pages/view/pos-jaise/c5effd38-500b-4006-9d85-798296a879e5).

- Estado success, duración 42 s, rama feat/cloudflare-pages y commit 6929c61.
- Alias: [Preview](https://feat-cloudflare-pages.pos-jaise.pages.dev).
- Inmutable: [c5effd38.pos-jaise.pages.dev](https://c5effd38.pos-jaise.pages.dev).
- build-id servido: 6929c619.
- SHA-256 de sw.js, idéntico en alias e inmutable: 2eb8003dc69f00c9e40cb8e576dd01427b4589138474cf5596558ae57bf1b897. Difiere del anterior ec2a3b64 (d02e5c8e...). Eso demuestra identidad distinta; no constituye otra ronda PWA.
- 140 módulos JS públicos leídos con 200 y sin hallazgos del escáner de backend del negocio, localhost o claves privilegiadas. No se muestran claves ni bundles en el informe.
- Configuración de medios contrastada por rol con el parser de las guardas: proveedor r2; API del Worker de staging; publicUrl exacta del alias /medios; r2.dev de staging solo como base extra reconocida.
- GET y HEAD de /medios, /medios/, una ruta válida inexistente y un destino inválido: 404 no-store, nosniff y noindex; HEAD sin cuerpo.
- /ventas y /medios-extra mantienen la SPA. El manifest usa raíz, el precache no contiene 404.html y el service worker excluye /medios.
- HTML: public, max-age=0, must-revalidate y noindex. sw.js: no-cache.
- El panel sigue mostrando despliegues automáticos de producción pausados y ningún deployment de producción. La raíz pos-jaise.pages.dev respondió 404.

Un 404 de una foto inexistente no demuestra una retirada después de un HIT, ni confirma por sí mismo un binding. En esta revisión no se subieron fotos ni se cambió el binding, variables o recursos. Las lecturas públicas fueron GET/HEAD, sin cookies ni login de aplicación. El panel se consultó con la sesión ya existente.

## Siguiente trabajo para Claude

1. Regenerar el paquete de lectura mixta desde 6929c619, con frontend y servidor del mismo commit. Verificar hashes, Function B efectiva y resolverUrlGaleria con una URL antigua de r2.dev en esa versión exacta. Conservar el paquete ec2a3b6 como histórico, no reemplazar su atribución.
2. Preparar la repetición de interfaz 23/23 para build-id=6929c619 y entrega=pages. Es pertinente porque cambió el frontend. Ejecutarla solo con autorización de escrituras en staging y guardar informes nuevos en .codex.
3. Preparar los ensayos reales de carga y recolector según sus límites aprobados localmente; cada ejecución requiere autorización separada. La revisión local no equivale a permiso ni a resultado real.

No hacer un push solo para archivar este informe. No tocar main, producción, GitHub Pages o r2.dev para completar estos pasos de revisión.

## Pendientes que esta revisión no cierra

- Ensayos reales de interfaz nueva, carga y recolector, y artefacto mixto definitivo.
- CLI habitual con process.exit(0) aunque el informe registre errores o aborto: condición pendiente antes de automatizarlo; el CLI del ensayo acotado sí conserva su salida no cero para corrida incompleta.
- Cierre de accesos alternativos r2.dev y deployments antiguos. Reescribir las lecturas de la aplicación no deshabilita el acceso directo público.
- CPU y cuota de B, muestras de catálogo real, otros navegadores y móvil, migración inversa general y criterios de producción de la Fase 3.

Los datos no se inspeccionaron ni se cambiaron en esta revisión. No se afirma que staging esté vacío o restaurado a partir de estas lecturas públicas; esa afirmación pertenece a cada corrida con su snapshot. La Fase 3 completa sigue sin aprobación de producción.

Evidencia nueva: .codex/evidencia-mixta-recolector-v4-6929c61. Incluye diagnósticos independientes, hashes de fuentes, verificación pública, configuración efectiva y estado del dashboard. Se conserva la revisión V3 sin sobrescribirla.
