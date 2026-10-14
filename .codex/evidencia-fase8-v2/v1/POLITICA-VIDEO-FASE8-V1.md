# Política y contrato técnico de video · Fase 8

Fecha: 2026-10-12. **Solo política y contrato; no se implementó ningún módulo de video, no se creó código, tablas ni ajustes, y no se contrató ni se configuró ningún servicio** (ni Cloudflare Stream ni almacenamiento nuevo). Sirve como especificación para cuando exista la función.

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
| `poster_url` | **obligatorio** para estado `LISTO`; imagen WebP/JPEG de calidad 80, ancho ≤ 960 px, ≤ 120 kB, generada del fotograma ~1 s; ya optimizada y servida como cualquier foto de `/medios` |
| `video_url` | MP4 (H.264 + AAC, `faststart`/moov al inicio) como formato base universal; WebM/VP9 o AV1 como fuente adicional opcional |
| `checksum_sha256` | del archivo servido (no el ETag de multipart), para verificar integridad |
| `publicado`, `orden`, `creado_en`, `creado_por` | como las demás entidades del panel |
| RLS | lectura pública solo si `estado = 'LISTO' and publicado`; escritura solo administración vía función `security definer` con validación del lado servidor (nunca confiar en duración/peso declarados por el navegador). Las políticas deben usar el patrón `(select es_admin())` de la Fase 7 |

## 3. Subida y procesamiento

1. La administración elige el archivo; el cliente valida **antes** de subir tipo (`video/mp4`, `video/webm`, `video/quicktime`), extensión y peso máximo de entrada (p. ej. 200 MB) y muestra el progreso con cancelación. Las rutas de subida usan URLs prefirmadas de corta vida y quedan en una carpeta de «pendientes».
2. Un proceso del servidor (no el navegador) inspecciona el archivo (ffprobe), rechaza lo que supere los límites o no sea video, transcodifica a MP4 H.264/AAC ≤ 1080 px con `-movflags +faststart`, extrae el poster y calcula checksum. Mientras tanto el registro queda en `PROCESANDO`; si falla pasa a `ERROR` con detalle y no se publica.
3. Solo con poster y archivo final verificados el estado pasa a `LISTO`. El original no se borra hasta la aprobación del usuario (mismo criterio de reversión que los medios).
4. Mismo patrón de las fotos para consistencia: procesar primero, subir al guardar, **borrar lo anterior solo después de que la base confirme lo nuevo**.

## 4. Reproducción en la web

- **Tarjetas y listados**: solo `poster` (imagen) con dimensiones/`aspect-ratio` reservadas e icono de reproducir; **ningún `<video>` montado ni descarga del archivo**. Sin autoplay masivo.
- **Reproductor**: se monta al pulsar «reproducir» (o al abrir el detalle); `<video controls playsinline preload="none" poster=…>`; `preload="metadata"` solo en el detalle de un único video, nunca en listas. Un solo video reproduciendo a la vez; los demás se pausan.
- **Autoplay**: solo si es mudo, decorativo, corto, dentro del viewport y con `prefers-reduced-motion: no-preference`; se pausa fuera de vista (`IntersectionObserver`) y al cambiar de pestaña. Con Save-Data o conexión 2G no hay autoplay y se pide pulsar.
- **Accesibilidad**: controles nativos con foco visible, teclado (espacio, flechas), `aria-label` con el título, subtítulos `<track kind="captions">` si hay voz, transcripción o descripción textual disponible; no depende solo del color. Estado de error visible («No se pudo cargar el video») con botón de reintento y enlace al poster, sin bloquear la página.
- **Móvil**: probar en red limitada y registrar bytes reales; el reproductor no debe mover el layout (CLS).

## 5. Entrega (R2) y comprobaciones obligatorias antes de aprobar

- Servir desde el endpoint real de medios con `Accept-Ranges: bytes`, **respuesta 206 con `Content-Range` correcto**, `Content-Length`, `Content-Type: video/mp4`, `ETag`/`Cache-Control: public, max-age=31536000, immutable` si el nombre del objeto lleva hash, `X-Content-Type-Options: nosniff`.
- Verificar con peticiones Range reales: inicio (`bytes=0-1023`), mitad (búsqueda temporal), final y rango inválido (416); que **no** se descargue el archivo completo para mostrar el poster; que la búsqueda temporal funcione en Chrome móvil y escritorio, Safari iOS y Firefox.
- La Function de `/medios` actual está pensada para imágenes: comprobar que el streaming/Range no se rompe, el límite de CPU/tiempo de la Function y cómo pasa el cuerpo (sin leerlo entero en memoria). Si no cumple, servir el video por un dominio de R2 público de solo lectura distinto del de las fotos, con su propia política de CORS/caché.
- Los videos **nunca** van al precaché del service worker ni al caché por uso (`assets-por-uso`/`imagenes-del-sitio`): las reglas actuales solo cubren js/css/fuentes del propio build e imágenes; añadir una regla de video exigiría una decisión explícita (hay problemas conocidos con Range y caché de respuestas parciales).

## 6. Cuándo evaluar Cloudflare Stream (decisión adicional del usuario)

R2 almacena objetos, **no** codifica ni ofrece reproducción adaptativa. Evaluar Stream solo si hay: videos largos (> 60 s), varios minutos de contenido, necesidad de calidades adaptativas (HLS/DASH), subida directa por usuarias en volumen o protección de descarga. Antes de contratar, el usuario decide con una estimación de costos por minuto almacenado y por minuto entregado (precios vigentes en la documentación oficial de Cloudflare Stream) para el volumen esperado. Hasta esa decisión el contrato usa `origen = 'r2'` con clips ≤ 60 s. El campo `origen` y el estado de procesamiento hacen que migrar a Stream después no cambie el modelo.

## 7. Presupuestos y pruebas que deberá cumplir una futura implementación

- Una página de listado con N tarjetas de video: **0 descargas de archivos de video** al cargar y al hacer scroll; solo posters (bytes totales ≈ N × poster).
- LCP de la página no afectado por videos (poster con `loading="lazy"` salvo que sea el candidato LCP, con `fetchpriority="high"` solo en ese caso).
- Un video del detalle: `preload="none"` hasta el clic; tras el clic, primer fotograma en < 2 s en 4G simulada; la búsqueda temporal no descarga el archivo completo.
- Estados: subida con progreso/cancelación, `PROCESANDO`, `ERROR`, `LISTO`; red caída durante la reproducción (mensaje y reintento); permisos (anónimo solo `LISTO` y publicado; asistente/cajera sin edición; administración total).
- Regresión de la Fase 8: el precaché no crece; ninguna ruta de video cacheada por el service worker; los datos (Supabase) siguen sin caché.

## 8. Fuera de alcance (no se hizo)

Tablas, funciones SQL, buckets, rutas de la Function, componentes React, panel de administración, cuentas o contratos externos. Cualquiera de ellos requiere indicación explícita del usuario y su propia revisión.
