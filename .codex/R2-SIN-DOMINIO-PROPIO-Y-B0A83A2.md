# R2 sin comprar dominio y verificación del preview b0a83a2

Fecha: 10 de octubre de 2026, America/Lima. Informe de QA y aclaración de la guía; no implementación.

## Aclaración principal

**Comprar un dominio no es requisito para almacenar o subir fotos a R2.** Las subidas de staging ya funcionan sin él. El dominio propio era la opción escogida en el plan para entregar públicamente las imágenes con caché y controles del bucket; no es la única arquitectura disponible.

La preferencia vigente del usuario es comprar el dominio en el futuro. La guía no debe convertir esa compra en una condición obligatoria para continuar. Debe separar «dominio propio opcional/futuro» de «entrega de medios apta para el negocio, todavía por implementar/verificar en la opción elegida».

## Estado actual y límites

El preview usa el Worker de staging para subidas protegidas y `r2.dev` para leer las fotos. Cloudflare indica que `r2.dev` es una URL de desarrollo con limitación de solicitudes y sin las capacidades de caché/control del acceso directo mediante dominio propio. No recomendar esa URL de pruebas como entrega definitiva del negocio. [Documentación de buckets públicos](https://developers.cloudflare.com/r2/buckets/public-buckets/#public-development-url).

El Worker actual conserva `SERVIR_LECTURA=0`; su ruta de lectura está descrita en el código como solo de desarrollo. Por tanto, no basta con cambiar una variable y declarar una ruta de producción terminada. Las aceptaciones actuales de pruebas de staging se mantienen.

## Alternativa sin comprar dominio: Pages Functions

**Propuesta para Claude:** servir las imágenes mediante una función del proyecto Pages vinculada al bucket R2, usando el hostname `*.pages.dev` que ya ofrece Cloudflare. Una ruta ilustrativa sería `/medios/<destino>/<uuid>/m.webp` o `/g.webp`; no existe como implementación nueva por este informe.

Cloudflare documenta bindings de R2 en Pages Functions: la función puede obtener el objeto directamente del bucket y devolverlo como respuesta. Esto evita depender de la URL pública `r2.dev`. [Binding R2 en Pages Functions](https://developers.cloudflare.com/pages/functions/bindings/#r2-buckets).

La Cache API funciona en Pages Functions tanto con dominio propio como con `*.pages.dev`. Su caché se limita al centro de datos que recibe la solicitud y no equivale a tiered cache ni a que todas las invocaciones de la función desaparezcan. Debe implementarse y medirse la política efectiva de HIT/MISS y borrado. [Cache API, disponibilidad y alcance](https://developers.cloudflare.com/workers/runtime-apis/cache/#background).

Esta es una alternativa técnica compatible con la preferencia del usuario, **no una función ya desplegada ni una aceptación de producción**. Claude puede preparar el diseño y la implementación en staging, manteniendo:

- Subidas/borrados protegidos por sesión y rol, sin debilitar la lógica ya revisada.
- Lectura pública limitada a los destinos de catálogo autorizados, cabeceras WebP/`nosniff`, caché y tratamiento de borrados.
- Rutas SPA, assets y service worker fuera de efectos accidentales de esa función.
- Backend y binding de pruebas aislados del negocio; configuración de producción separada cuando corresponda.

El acceso del bucket desde Functions no exige hacerlo público por `r2.dev`. Las URLs que ya estén almacenadas deberán considerarse al cambiar de entrega: no prometer que todas las referencias actuales se actualizan solas, especialmente los campos que guardan URLs absolutas.

El dominio propio puede añadirse más adelante. Mientras tanto siguen siendo necesarias las pruebas del endpoint elegido, fotos reales, navegadores/móvil, carga, purga y migración inversa antes de activar datos del negocio. La Cache API en Pages permite abordar la caché sin esperar a comprar el dominio; no da por cerradas esas pruebas.

## Publicación b0a83a2 verificada

Commit local: `b0a83a2f2afea2c4966e399a890ee9e4d662315f`. Main local sigue en `0dc629e430ed07eeaccec273d31de93e9717d9bf`.

El diff frente a e229396 contiene los 11 archivos del paquete revisado: scripts/guardas/regresiones, runbook, ambas corridas de Servicio, cuatro capturas y PWA vacio. No cambia fuentes de aplicación, assets de `public`, dependencias, configuración de Vite/Cloudflare o workflows. No incluye `.codex`/`.env` ni las capturas de Fase 1.

Mediante GET públicos sin login o escritura comprobé el alias `https://feat-cloudflare-pages.pos-jaise.pages.dev`:

- Marca exacta **`b0a83a2f`**: ya no está pendiente esperar a que el alias sirva el nuevo commit.
- 140 entradas de scripts consultadas, todas HTTP 200.
- Proveedor R2, Worker de staging, URL r2.dev y backend de staging presentes.
- Ref del negocio y Supabase local ausentes; sin hallazgos de credenciales privilegiadas/JWT no admitidos en los formatos examinados.
- `/ventas` responde 200; manifest raíz; sin `404.html` precacheado.
- HTML revalida, SW `no-cache`, robots `noindex`.
- `https://pos-jaise.pages.dev/` sigue respondiendo 404, como antes.

Las corridas de Servicio mantienen su marca e2293968; no se reetiquetan como pruebas del build nuevo. No repetí escrituras de interfaz ni PWA en esta revisión. No consulté el dashboard ni obtuve UUID/duración/Node del deployment.

La validación de checkout limpio de b0a83a2 es la informada por Claude. El JSON disponible `clon-limpio-commit-nuevo.json` aún identifica c169373: no se usa aquí como prueba de b0a83a2. Conservar un informe por commit de la validación nueva cuando se prepare la siguiente evidencia; no requiere otro push solo para archivarlo.

## Registro y acciones

Claude puede ajustar la guía para presentar el dominio como futuro opcional y la alternativa Pages Functions como diseño pendiente de staging. Este informe no ejecuta cambios de configuración, recursos, dominio, datos, archivos fuente o Git, ni modifica el registro de fases existente.

Evidencia nueva en `.codex/evidencia-r2-dominio-b0a83a2/`: resultados/hashes del artefacto público y copia del diagnóstico como texto. Se creó únicamente este informe y sus copias QA conforme a la instrucción persistente de guardarlos en `.codex`.
