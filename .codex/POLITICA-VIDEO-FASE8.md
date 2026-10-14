# Política y contrato técnico de video · Fase 8 (V2)

Fecha: 2026-10-12. **Solo política y contrato; no se implementó ningún módulo de video, no se creó código, tablas ni ajustes, y no se contrató ni se configuró ningún servicio** (ni Cloudflare Stream ni almacenamiento nuevo). Sirve como especificación para cuando exista la función.

**V2 (corrección F8-03 de la revisión de Codex):** la V1 proponía `Cache-Control: public, max-age=31536000, immutable` y, si la Function no soportaba Range, servir el video desde un dominio R2 público directo. Eso contradecía la decisión vigente del usuario (10/10/2026: **bloquear también el enlace antiguo después del borrado**, con revocación B antes de entregar desde caché y cubriendo los accesos alternativos; ver `REVISION-Y-PLAN-PENDIENTES-FASE3-V2.md` §4). Ahora el contrato por defecto es la **misma garantía de retirada que las fotos**; la caché anual y el acceso directo a R2 quedan solo como alternativa que exige una excepción explícita del usuario (§5.4). La V1 se conserva byte a byte en `.codex/evidencia-fase8-v2/v1/POLITICA-VIDEO-FASE8-V1.md` (SHA-256 `4eff3c37…094ee1`). Cambian §2 (`video_url`, `clave_original`), §3, §5, §6 y §7; §0, §1 y §4 no cambian.

## 0. Punto de partida verificado

- No existe una función de video en la aplicación: la única aparición de `<video>` en `src/` es el flujo de la cámara en vivo de `ModalCamara.jsx` y `ModalEscanerCodigoBarras.jsx` (`getUserMedia`), que no reproduce archivos.
- No hay columnas ni migraciones de video. La carpeta `videos/pos-jaise-promo/` del repositorio es un proyecto de producción de un clip promocional (guion, audio, capturas, 18 MB); **no forma parte del build ni de la app**.
- Los medios públicos nuevos (fotos) ya van a R2 desde la Fase 3 (`/medios`, Pages Function). Esa ruta está documentada y probada solo para imágenes: no se asume que sirva video hasta comprobar Range/206 sobre su endpoint real (ver §5).

## 1. Principios

1. **El video es opcional y de bajo impacto**: nunca debe entrar en la ruta crítica (LCP) ni descargarse sin que la persona lo pida o esté a punto de verlo.
2. **Un video no es una foto**: necesita estado de procesamiento, poster, límites y reproducción con búsqueda temporal; no se reutiliza el flujo de subida de fotos tal cual.
3. **Privacidad primero**: solo contenido público aprobado por el negocio; los videos subidos por usuarias o con rostros requieren la decisión previa de privacidad (consentimiento) antes de publicarse.
4. **No almacenar videos en el build de Pages** (límites de tamaño/archivos y de caché): siempre en almacenamiento de objetos o servicio de video.

## 2. Contrato de datos (por video)

| Campo | Regla |
| --- | --- |
| `id` | uuid (`gen_random_uuid()`), como el resto de tablas del negocio |
| `titulo` | texto obligatorio, ≤ 120 caracteres; `descripcion` opcional (también es el texto alternativo) |
| `origen` | `r2` (clip corto propio) o `stream` (solo si se aprueba, §6) |
| `estado` | `SUBIDO` → `PROCESANDO` → `LISTO` / `ERROR`; solo `LISTO` es visible en el sitio |
| `error_detalle` | texto técnico corto solo visible para administración |
| `duracion_s` | entero medido en el servidor, no declarado por el navegador. **Máximo 60 s** para clips R2 (promociones, resultados, tutoriales breves) |
| `peso_bytes` | medido; **máximo 25 MB** por clip R2 tras la optimización (el original puede ser mayor y se rechaza o reprocesa) |
| `ancho`, `alto`, `relacion` | medidos; se admite 9:16 (vertical móvil), 16:9 y 1:1; ancho máx. 1080 px |
| `poster_url` | **obligatorio** para estado `LISTO`; imagen WebP/JPEG de calidad 80, ancho ≤ 960 px, ≤ 120 kB, generada del fotograma ~1 s; ya optimizada y servida como cualquier foto de `/medios` (misma retirada) |
| `video_url` | MP4 (H.264 + AAC, `faststart`/moov al inicio) como formato base universal; WebM/VP9 o AV1 como fuente adicional opcional. **Siempre una ruta del endpoint revocable de medios (§5.2)**, nunca una URL de bucket público, `r2.dev` ni un dominio R2 directo |
| `clave_original` | clave del archivo subido tal cual, en el espacio **privado** de originales/pendientes (§3, §5.3), distinto del de objetos aprobados; nunca se publica ni se devuelve al sitio |
| `checksum_sha256` | del archivo servido (no el ETag de multipart), para verificar integridad |
| `publicado`, `orden`, `creado_en`, `creado_por` | como las demás entidades del panel |
| RLS | lectura pública solo si `estado = 'LISTO' and publicado`; escritura solo administración vía función `security definer` con validación del lado servidor (nunca confiar en duración/peso declarados por el navegador). Las políticas deben usar el patrón `(select es_admin())` de la Fase 7 |

## 3. Subida y procesamiento

1. La administración elige el archivo; el cliente valida **antes** de subir tipo (`video/mp4`, `video/webm`, `video/quicktime`), extensión y peso máximo de entrada (p. ej. 200 MB) y muestra el progreso con cancelación. Las rutas de subida usan URLs prefirmadas de corta vida, **solo de escritura**, hacia un espacio privado de «pendientes/originales» (prefijo o bucket sin acceso público, sin dominio ni `r2.dev`), separado del de objetos aprobados. El endpoint público nunca resuelve claves de ese espacio.
2. Un proceso del servidor (no el navegador) inspecciona el archivo (ffprobe), rechaza lo que supere los límites o no sea video, transcodifica a MP4 H.264/AAC ≤ 1080 px con `-movflags +faststart`, extrae el poster y calcula checksum. Mientras tanto el registro queda en `PROCESANDO`; si falla pasa a `ERROR` con detalle y no se publica.
3. Solo con poster y archivo final verificados el estado pasa a `LISTO`, y solo entonces el archivo final se escribe en el espacio de **aprobados** (el único que el endpoint de §5 puede entregar). El original sigue en el espacio privado y no se borra hasta la aprobación del usuario (mismo criterio de reversión que los medios); mientras exista, ningún enlace público lo alcanza.
4. Mismo patrón de las fotos para consistencia: procesar primero, subir al guardar, **borrar lo anterior solo después de que la base confirme lo nuevo**.

## 4. Reproducción en la web

- **Tarjetas y listados**: solo `poster` (imagen) con dimensiones/`aspect-ratio` reservadas e icono de reproducir; **ningún `<video>` montado ni descarga del archivo**. Sin autoplay masivo.
- **Reproductor**: se monta al pulsar «reproducir» (o al abrir el detalle); `<video controls playsinline preload="none" poster=…>`; `preload="metadata"` solo en el detalle de un único video, nunca en listas. Un solo video reproduciendo a la vez; los demás se pausan.
- **Autoplay**: solo si es mudo, decorativo, corto, dentro del viewport y con `prefers-reduced-motion: no-preference`; se pausa fuera de vista (`IntersectionObserver`) y al cambiar de pestaña. Con Save-Data o conexión 2G no hay autoplay y se pide pulsar.
- **Accesibilidad**: controles nativos con foco visible, teclado (espacio, flechas), `aria-label` con el título, subtítulos `<track kind="captions">` si hay voz, transcripción o descripción textual disponible; no depende solo del color. Estado de error visible («No se pudo cargar el video») con botón de reintento y enlace al poster, sin bloquear la página.
- **Móvil**: probar en red limitada y registrar bytes reales; el reproductor no debe mover el layout (CLS).

## 5. Entrega y retirada (contrato por defecto)

### 5.1 Garantía de retirada (la misma que las fotos)

Tras **confirmar el borrado** del objeto aprobado (o su revocación del lado del servidor, si se llega a implementar), una petición **nueva** al enlace antiguo del video o de su poster —**GET, HEAD, con `Range`/`If-Range` y condicionales (`If-None-Match`, `If-Modified-Since`)**— no debe entregar bytes antiguos ni un `304` que permita reutilizarlos:

- objeto ausente: `404` con `Cache-Control: no-store`;
- imposibilidad de comprobar el origen: `503` `no-store`, nunca la copia retenida;
- una petición (o un rango) iniciada antes del borrado puede terminar. **No se promete borrar descargas ya realizadas ni detener bytes ya entregados**, ni copias hechas por terceros.

Un nombre de objeto con hash evita **reemplazar** contenidos bajo una misma URL; **no garantiza su retirada** y no sustituye esta regla.

### 5.2 Endpoint revocable y política de caché compatible

- El video y su poster se sirven **solo** por el endpoint revocable de medios (la Pages Function de `/medios` o un endpoint hermano con el mismo control), que aplica la comprobación B **antes de entregar desde cualquier caché**, también para respuestas parciales.
- Navegador: `Cache-Control: max-age=0, must-revalidate` (la misma separación de políticas que las fotos): el navegador revalida en cada uso y no puede reutilizar el enlace después del borrado. Borde: TTL positivo permitido **solo** detrás de la comprobación B. `ETag` fuerte; `304` únicamente si el objeto sigue existiendo y el ETag coincide. Errores siempre `no-store`.
- Range: `Accept-Ranges: bytes`; `206` con `Content-Range` y `Content-Length` correctos; `416` para rangos inválidos; un `If-Range` con ETag desactualizado entrega el objeto completo **solo si sigue existiendo**. `Content-Type: video/mp4`, `X-Content-Type-Options: nosniff`. El cuerpo se transmite por streaming desde R2, sin leerlo entero en memoria.
- **Si la Function actual no soporta Range o excede su límite de CPU/tiempo**, se diseña **otro endpoint con garantía equivalente** (p. ej. un Worker con binding de R2 que pida el rango al bucket y aplique la misma comprobación por petición) y se prueba con §7 antes de usarlo. **No hay fallback automático** a un bucket público, `r2.dev`, un dominio R2 directo ni otro proveedor: si no hay un endpoint revocable que cumpla, el video no se publica.

### 5.3 Originales y pendientes de procesamiento

Los originales y los archivos en `SUBIDO`/`PROCESANDO`/`ERROR` viven en el espacio privado de §3: sin acceso público, sin dominio, sin `r2.dev`, accesibles solo para el proceso del servidor y por URLs prefirmadas de escritura de corta vida. El endpoint público resuelve únicamente claves del espacio de aprobados de registros `LISTO` y publicados; cualquier otra clave responde `404` `no-store`. Borrar un video borra el archivo aprobado y su poster con el mismo patrón de las fotos (primero confirmar en la base, después borrar), y la interfaz no afirma «enlace bloqueado» si el borrado quedó pendiente.

### 5.4 Alternativa que exige una excepción explícita del usuario (no aprobada)

`Cache-Control: public, max-age=31536000, immutable` y/o servir el video desde un dominio R2 público directo **reabren el acceso alternativo** que la decisión del 10/10/2026 cerró: las copias inmutables ya entregadas se siguen reutilizando y el origen directo elude la revocación B. Solo podría presentarse si el usuario concede una **excepción explícita** a esa decisión para videos, con el costo documentado (los enlaces antiguos dejarían de bloquearse). No forma parte de este contrato.

### 5.5 Service worker

Los videos **nunca** van al precaché ni a las cachés por uso: las reglas de `public/sw-reglas-cache.js` (Fase 8 V2) solo admiten chunks/CSS/fuentes/imágenes con hash bajo `assets/` e imágenes públicas de `inicio-web/`, `icons/` y favicons, sin query, y excluyen `/medios` explícitamente. Añadir video exigiría una decisión explícita (problemas conocidos con Range y respuestas parciales) y seguiría sujeto a §5.1.

## 6. Cuándo evaluar Cloudflare Stream (decisión adicional del usuario)

R2 almacena objetos, **no** codifica ni ofrece reproducción adaptativa. Evaluar Stream solo si hay: videos largos (> 60 s), varios minutos de contenido, necesidad de calidades adaptativas (HLS/DASH), subida directa por usuarias en volumen o protección de descarga. Antes de contratar, el usuario decide con una estimación de costos por minuto almacenado y por minuto entregado (precios vigentes en la documentación oficial de Cloudflare Stream) para el volumen esperado. Hasta esa decisión el contrato usa `origen = 'r2'` con clips ≤ 60 s. El campo `origen` y el estado de procesamiento hacen que migrar a Stream después no cambie el modelo. **La evaluación de Stream debe incluir la misma garantía de retirada de §5.1** (qué ocurre con un enlace o token de reproducción después de borrar el video, y con las cachés del reproductor y del borde): no se traslada la garantía de B a otro proveedor sin pruebas.

## 7. Presupuestos y pruebas que deberá cumplir una futura implementación

- Una página de listado con N tarjetas de video: **0 descargas de archivos de video** al cargar y al hacer scroll; solo posters (bytes totales ≈ N × poster).
- LCP de la página no afectado por videos (poster con `loading="lazy"` salvo que sea el candidato LCP, con `fetchpriority="high"` solo en ese caso).
- Un video del detalle: `preload="none"` hasta el clic; tras el clic, primer fotograma en < 2 s en 4G simulada; la búsqueda temporal no descarga el archivo completo.
- Estados: subida con progreso/cancelación, `PROCESANDO`, `ERROR`, `LISTO`; red caída durante la reproducción (mensaje y reintento); permisos (anónimo solo `LISTO` y publicado; asistente/cajera sin edición; administración total).
- **Range sobre el endpoint real:** inicio (`bytes=0-1023`), mitad (búsqueda temporal), final y rango inválido (`416`); que **no** se descargue el archivo completo para mostrar el poster; búsqueda temporal en Chrome móvil y escritorio, Safari iOS y Firefox (los que no estén disponibles quedan como pendiente explícito, sin inventar la prueba).
- **Retirada (§5.1), sobre el endpoint real y cada origen permitido:** calentar navegador y borde (GET completo y varios rangos), borrar y confirmar la ausencia en R2; inmediatamente después, GET, HEAD, `Range: bytes=0-1023`, un rango intermedio, `If-None-Match` con el ETag viejo e `If-Range` → `404` `no-store` en el video **y** en el poster (nunca `206`, `200` ni `304`). Fallo simulado de la comprobación del origen → `503` `no-store`. Una petición en vuelo antes del borrado puede terminar. Reemplazo: la URL vieja queda bloqueada y la nueva funciona. Repetir en dos POP cuando sean accesibles.
- **Originales/pendientes:** ninguna clave del espacio privado responde por el endpoint público (`404` `no-store`) ni existe dominio público, `r2.dev` o alias que los sirva; las URLs prefirmadas de subida caducan y no permiten lectura.
- **Sin acceso alternativo:** inventario de dominios/alias que podrían servir video; ninguno entrega un objeto borrado.
- Regresión de la Fase 8: el precaché no crece; ninguna ruta de video cacheada por el service worker; los datos (Supabase) siguen sin caché.

## 8. Fuera de alcance (no se hizo)

Tablas, funciones SQL, buckets, rutas de la Function, componentes React, panel de administración, cuentas o contratos externos; tampoco se compró un dominio ni se contrató Stream para la corrección V2. Cualquiera de ellos requiere indicación explícita del usuario y su propia revisión.
