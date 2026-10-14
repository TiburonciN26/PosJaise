# Plan por fases · rendimiento y migración a Cloudflare

Fecha: 9 de octubre de 2026.
Proyecto: C:\WedJaiseReact.
Estado: plan para implementación por Claude Code y verificación independiente por Codex. Ninguna corrección ni configuración de Cloudflare se ha ejecutado al preparar este documento.

## Cómo usar este documento

Entregar a Claude Code este archivo junto con `AUDITORIA-RENDIMIENTO.md` y las evidencias que necesite. La auditoría conserva el diagnóstico original; este documento sustituye su orden de implementación e incorpora la migración solicitada a Cloudflare.

Claude implementa **una sola fase a la vez**. Al terminar entrega su resumen y se detiene. El usuario trae esa entrega a Codex; Codex revisa el diff, prueba la aplicación y emite **APROBADA**, **APROBADA CON OBSERVACIONES** o **RECHAZADA**. Una observación solo permite avanzar si Codex identifica que no bloquea funcionalidad, seguridad, integridad ni el objetivo de la fase. Los bloqueos se corrigen y se vuelven a verificar dentro de la misma fase. El usuario comunica a Claude la autorización para la fase siguiente.

Codex mantiene su rol de QA de solo lectura conforme al AGENTS.md. Claude es responsable de código, dependencias, configuración, migraciones y despliegues. Este plan no es una autorización para borrar datos de producción o desactivar servicios existentes.

No mezclar una reforma visual, cambios de reglas comerciales o una reescritura del stack con las optimizaciones. Mantener los efectos visuales que resulten sostenibles; sustituir el movimiento continuo costoso con una presentación estática o interacción breve cuando sea necesario.

### Entrega obligatoria de Claude al finalizar cada fase

1. Número de fase, alcance completado y pendientes concretos.
2. Archivos modificados y explicación del cambio; referencia de commit si existe, además del diff de cambios no confirmados relevante.
3. Comandos de build/lint/pruebas ejecutados, resultados completos y errores conocidos. No decir «todo pasa» si el lint sigue fallando.
4. URL local y, cuando corresponda, URL de preview; forma segura de preparar cuentas QA. Nunca entregar contraseñas, tokens, URL firmadas activas ni claves en el informe.
5. Migraciones y configuración de infraestructura incluidas, ambiente en que se aplicaron y procedimiento de reversión.
6. Medidas antes/después con navegador, CPU/red, dataset, caché, duración y número de repeticiones. Las medidas de Claude son preliminares: la aceptación depende de la comprobación independiente de Codex.
7. Cambios en datos de prueba, archivos subidos o recursos externos creados y cómo limpiarlos.
8. La frase: «Fase N lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario».

### Método de comparación para Codex

- Comparar el estado real del código; la auditoría original identifica 370 archivos con fingerprints. Si el proyecto cambió, conservar ese diagnóstico como referencia y registrar una nueva línea base del escenario afectado.
- Usar la aplicación autenticada, datos QA y build de producción. Las pruebas locales con mutación requieren confirmar Supabase Local en http://127.0.0.1:54321. Contra producción, Codex solo inspecciona y prueba flujos de lectura; la creación de objetos QA externos requiere autorización específica y un ambiente aislado.
- Tres repeticiones por escenario crítico, misma máquina/dataset, caché fría y caliente separadas. Comparar medianas y guardar muestras individuales.
- Distinguir LCP de laboratorio, TBT, EventTiming y tareas largas. No presentar TBT como INP real, cadencia rAF como FPS físico ni TaskDuration como porcentaje de CPU del equipo.
- Las metas nuevas de este plan son criterios propuestos de aceptación, no mejoras ya conseguidas. Si alguna no es viable, Claude debe documentar la causa y una alternativa para revisión antes de darla por cumplida.

## Orden acordado para ejecutar

| Fase | Trabajo | Auditoría relacionada | Condición para avanzar |
| --- | --- | --- | --- |
| 1 | Detener el gasto continuo de los cupones | PERF-01 | Animación sostenible y funciones preservadas |
| 2 | Cloudflare Pages en preview | Migración nueva | Rutas, sesión y PWA correctas en el nuevo origen |
| 3 | R2 y flujo seguro para nuevas imágenes | Migración nueva / PERF-11 | Subidas, permisos y entrega optimizada verificados |
| 4 | Catálogos completos, paginados y con fotos | PERF-02, PERF-03 | Búsqueda completa sin listas gigantes |
| 5 | Listas administrativas y cargas por demanda | PERF-04, PERF-05, PERF-06, PERF-07 | Datos iniciales limitados y sin duplicados evitables |
| 6 | Memoria, pantallas ocultas y movimiento reducido | PERF-08, PERF-09 | Sesión larga estable y borradores conservados |
| 7 | Planes SQL e índices ajustados a las consultas finales | PERF-12 | Mejora comprobada bajo RLS, sin ampliar permisos |
| 8 | Recursos de Inicio, PWA y política de video | PERF-10, PERF-11 | Menos descarga inicial y actualización segura |
| 9 | Migración de medios existentes y preparación del cambio público | Migración nueva | Copia validada, compatibilidad y reversión listas |
| 10 | Regresión completa, publicación y seguimiento | PERF-13 / todos | QA final aprobada y cambio de hosting comprobado |

Primero se corrige la causa de CPU ya demostrada. Después se prepara Pages y R2, **antes de subir masivamente fotos**. La paginación se valida con fotos en la fase 4. El cambio del dominio público y la retirada de GitHub Pages quedan para la fase final, tras comprobar las funciones del negocio.

## Decisión de arquitectura para medios y hosting

Las fotos pueden añadir transferencia, decodificación y memoria, sobre todo si se montan miles de tarjetas. La auditoría no comparó la velocidad de Supabase Storage contra R2 ni GitHub Pages contra Pages: no se promete una ganancia numérica por cambiar de proveedor. Los bloqueos de animación y renderizado deben resolverse en el cliente aunque los archivos se entreguen rápidamente.

Arquitectura propuesta:

- **Cloudflare Pages:** HTML, JavaScript, CSS y recursos estáticos del build de React/Vite. GitHub puede seguir siendo el repositorio; dejar GitHub Pages no exige abandonar GitHub.
- **Supabase:** Auth, Postgres, RLS, Realtime, RPC y los datos del negocio. Guarda referencias y metadatos de medios, no las claves de R2.
- **Cloudflare R2 + dominio de medios:** nuevas imágenes públicas de productos, servicios y galería, con variantes y caché. Dominio ilustrativo `media.tudominio.com`; Claude debe usar el dominio real que confirme el usuario.
- **Backend autenticado de medios:** autoriza crear/finalizar/eliminar objetos. Recomendación: Worker dedicado con binding R2 y validación de sesión Supabase, o un firmador server-side de cargas directas si el tamaño/uso lo justifica. Claude documentará la opción elegida y sus límites antes de implementar. No colocar credenciales R2 o service_role en el navegador.
- **Comprobantes y otros archivos privados:** mantener inicialmente el flujo privado existente de Supabase. Su eventual traslado requiere una fase separada con equivalencia de permisos. Nunca poner comprobantes en el bucket público de fotos. Perfiles de usuarios/clientes también requieren clasificación explícita antes de migrarlos; no moverlos por modificar globalmente el helper.
- **Videos:** R2 puede almacenar archivos, pero el procesamiento, tamaños y reproducción deben definirse. Evaluar Stream únicamente si se necesitan videos largos o streaming adaptativo; no asumir que tener R2/Pages incluye Stream o transformaciones Images.

Cloudflare documenta la entrega de Pages con caché y compresión; eso no garantiza que esta SPA ejecute más rápido en el dispositivo. [Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/).

## Fase 1 · Cupones sin saturación continua

**Claude debe:**

- Revisar `.cupon-metal`, su barrido `::after`, `.cupon-chispa` y `EnvolturaCupon`. Las chispas son hermanas del cupón: una corrección dirigida solo a sus descendientes dejaría el efecto activo.
- Evitar animar `left`, filtros/sombras y propiedades que obliguen a layout/pintura por cada tarjeta en reposo. Usar movimiento breve de transform/opacity cuando resulte apropiado; no promover cientos de capas GPU como sustituto indiscriminado.
- Limitar los efectos a elementos visibles y a una interacción/entrada breve; los cupones apagados no necesitan chispas continuas. Conservar el acabado, legibilidad y estado activo/inactivo.
- Mantener `prefers-reduced-motion`, y detener efectos cuando la pantalla esté oculta. No desactivar StrictMode para ocultar el problema.

**Referencia original:** en ventanas aproximadas de 2,5 s, Promociones pasó de 2.359,5 a 137,2 ms de trabajo con CSS detenido; Referidos 2.387,6 → 97,6; Fidelización 1.469,8 → 64,7. Se probaron 208, 183 y 92 cupones respectivamente.

**Codex verificará:** tres muestras equivalentes de reposo por pantalla, dos temas, CPU 4×, navegación y modales. Reducción mínima propuesta del 80 % del trabajo en reposo frente al código anterior; sin bloqueo sostenido ni tarea mayor de 200 ms atribuible a los efectos en reposo después de estabilizar. Revisará traza de layout/pintura y apariencia, no solo Lighthouse. Vigencia, aplicación y acciones de cupones deben conservarse.

## Fase 2 · Preparar Cloudflare Pages en preview

**Claude debe:**

- Inventariar dominio real, proyecto Pages, rama/origen de despliegue, versión de Node, comando de build y salida `dist`. Registrar configuración de preview y producción por separado, sin publicar secretos.
- Adaptar la base `/PosJaise/` de `vite.config.js`, el `BrowserRouter` basado en BASE_URL, manifest, iconos y rutas de recursos. Para alojamiento en raíz, usar `/`; no hacer reemplazos globales de cadenas que alteren URLs legítimas o enlaces históricos.
- Revisar `public/404.html` y el mecanismo de recuperación de rutas de GitHub Pages. Pages usa fallback de SPA por defecto cuando no existe un `404.html` superior: eliminarlo de la salida de Pages o implementar una estrategia de routing deliberada y comprobarla. Mantener la opción anterior disponible para reversión durante la transición. [SPA en Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/#single-page-application-spa-rendering).
- Configurar las variables públicas de Supabase del build con el proyecto correcto. Un preview accesible debe estar conectado a staging seguro para mutaciones; nunca apuntar sus usuarios a `127.0.0.1` remoto ni crear un clon público del POS con datos reales para pruebas.
- Revisar URLs de Auth/callback/recuperación, orígenes permitidos por endpoints, CSP, metadatos/canonical y enlaces absolutos afectados. Registrar qué ajustes necesitan hacerse en Supabase o la pasarela sin alterar la lógica de cobro.
- Mantener el aviso de actualización PWA. Al cambiar de origen, sesión, localStorage y service worker no se transfieren automáticamente: documentar nuevo login y revisión de carrito/borradores en la transición.
- Crear un preview, sin cambiar todavía el dominio público ni apagar GitHub Pages. Empezar con las políticas de caché de Pages; evitar `Cache Everything` indiscriminado en HTML/API/sesiones.

**Codex verificará:** abrir por enlace directo y recargar `/ventas`, `/inicio`, catálogos, detalle y rutas de cliente; recursos sin 404; sesión, permisos y logout; recuperación de acceso en staging; manifest/iconos/scope; actualización desde un build anterior. Comparará carga fría/caliente del mismo build. Entregar URL de preview y rollback. No es necesario superar una puntuación de GitHub Pages para aprobar la compatibilidad.

## Fase 3 · Nuevas imágenes en R2 con autorización y optimización

Esta fase debe quedar aprobada antes de la carga masiva de imágenes. Empezar con fotos ficticias de productos/servicios y galería en staging.

### Implementación por Claude

1. Inventariar buckets y todos los consumidores de `src/lib/imagenes.js`: `subirFoto`, `eliminarFoto`, `urlPublicaFoto`, `urlFirmadaFoto` y `resolverUrlGaleria`. Revisar modales Producto/Servicio/Galería, tarjetas, detalles, carritos, equipo y perfiles. Actualmente muchos `foto_url` son claves relativas, mientras la galería guarda URLs completas o recursos relativos; no interpretar todo como el mismo formato.
2. Separar R2 de prueba y producción, permisos mínimos de backend y límites operativos. Publicar solo medios clasificados como públicos. Conectar el bucket público a un dominio propio de medios: es el mecanismo documentado para usar caché Cloudflare. `r2.dev` se deja para desarrollo, no como URL de producción. [Buckets públicos](https://developers.cloudflare.com/r2/buckets/public-buckets/).
3. Diseñar un contrato de referencia que distinga proveedor, bucket/key y variantes. Mantener lectura de referencias antiguas de Supabase y galería; la ausencia del dato de proveedor no puede redirigir silenciosamente fotos antiguas a R2. Guardar dimensiones, formato y estado cuando se necesiten; no almacenar URL firmadas temporales como referencia permanente.
4. Backend: validar el token Supabase, la identidad y los permisos existentes del recurso. El rol enviado por el navegador no es una fuente de autorización. El backend decide la key y no permite elegir un objeto ajeno para sobrescribir/eliminar. Para operaciones sensibles comprobar la autorización vigente, no solo un claim de rol antiguo. Mantener la lectura/escritura de metadatos bajo autorización equivalente a RLS.
5. Elegir subida autenticada mediante Worker o PUT directo con URL prefirmada breve. Si se usa firma, funciona sobre el endpoint S3 de R2, **no** el dominio público. La URL es reutilizable hasta expirar: no llamarla «de un solo uso». CORS debe permitir los orígenes concretos de local/preview/producción y métodos/cabeceras necesarios; CORS no sustituye autenticación. [URLs prefirmadas](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) y [CORS](https://developers.cloudflare.com/r2/buckets/cors/).
6. Validar en servidor tipo real, dimensiones, tamaño y destino. La comprobación MIME del cliente y el Content-Type firmado no verifican por sí solos el contenido ni garantizan un límite estricto de bytes. Para PUT directo, usar área de staging privada y finalización con validación antes de publicar; si hace falta transformar/inspeccionar, implementar ese procesamiento sin bloquear el Worker con archivos ilimitados. Rechazar formatos activos no previstos y archivos malformados. Registrar cuotas y límites efectivos por ruta/ambiente.
7. Conservar la compresión WebP existente (`procesarImagen`, por defecto 600 px/calidad 0,8) y revisar los topes específicos de cada llamador. Generar variantes coherentes con tarjetas/detalles: propuesta inicial 320/640/1280 px, sin ampliar originales. Ajustar las medidas según diseño/DPR y comprobar legibilidad. R2 por sí solo no redimensiona ni transcodifica: decidir entre variantes generadas al subir y Cloudflare Images, verificando disponibilidad y costos si se contrata. [Transformaciones Images](https://developers.cloudflare.com/images/optimization/transformations/overview/).
8. Usar keys nuevas/versionadas para reemplazos; caché larga e immutable solo en objetos inmutables, con Content-Type correcto. No sobrescribir la misma URL y esperar que todos vean la foto nueva. Definir recolección de objetos huérfanos con retención para rollback y política de invalidación.
9. Guardar la referencia solo después de confirmar y validar la subida. Ante fallo de DB, conservar una operación recuperable o limpiar el objeto pendiente; no borrar la imagen anterior antes de confirmar el reemplazo. Manejar fallos de eliminación: el helper actual de Supabase ignora su error, por lo que no debe trasladarse ese comportamiento a la integración nueva.
10. Publicar estados de progreso, error y reintento para la subida. Evitar blobs/base64 en los registros del catálogo. No cargar el SDK S3 de servidor en el bundle del cliente. Dejar configurada la selección de proveedor por ambiente para reversión de nuevas subidas.

### Verificación por Codex

- Imagen nueva, reemplazo, eliminación, galería antes/después y lectura desde listado, detalle, carrito y POS; foto antigua Supabase sigue funcionando.
- Intentos sin sesión, con rol no autorizado y sobre un recurso ajeno rechazados por backend. MIME falso, exceso de bytes, firma expirada y subida incompleta no producen medios públicos válidos ni referencias rotas.
- Fallo de subida y fallo de guardado DB no eliminan la foto anterior ni dejan estado de éxito ficticio. Repetición de finalización no duplica referencias.
- Comprobantes permanecen privados; abrir una URL pública conocida no revela esos archivos. No aparecen secretos en bundle, red o logs.
- Comprobar transferencia/dimensiones, headers y caché del dominio R2 en visitas repetidas al mismo punto de presencia; investigar MISS repetidos y no exigir HIT en todas las peticiones/regiones.
- Criterios iniciales propuestos: miniatura visible objetivo ≤ 80 KiB, detalle ≤ 250 KiB salvo excepción visual documentada; espacios reservados por dimensiones y sin degradación apreciable. No son límites impuestos por R2.

## Fase 4 · Catálogos completos y paginados, ahora con fotos

**Claude debe:** búsqueda/filtros/orden en servidor, páginas de hasta 40 elementos, orden estable y resultados completos. Resolver los 1.000 de 3.245 productos actuales sin descargar todo para luego cortar en React. No aumentar `max_rows` como sustituto de paginación. Tratar conteos, búsqueda sin resultados, cancelación de respuestas anteriores, cambios de filtro y duplicados/omisiones entre páginas.

Renderizar una ventana acotada aunque se ofrezca scroll infinito. Fotos de tarjeta con variante adecuada, `srcset/sizes` cuando corresponda, dimensiones/aspect-ratio, lazy loading para las inferiores y fallback. No descargar galerías de detalles en las tarjetas ni todas las imágenes de páginas no visitadas. Conservar stock/selección/carrito y detalles.

**Codex verificará:** buscar un producto conocido más allá del antiguo límite 1.000; recorrer páginas sin duplicados/omisiones en dataset estable; búsqueda amplia «test» y limpieza en Productos/Servicios, con CPU 4×. Antes se montaban 3.322 tarjetas/54.960 nodos y había una tarea de 5.644 ms. Criterio: hasta 40 tarjetas por página o ventana equivalente acotada; ningún bloqueo de un segundo o más atribuible a búsqueda/render; objetivo de eventos ≤ 200 ms. Cualquier tarea de 200–999 ms se revisará antes de aprobar.

Usar dataset con cientos de referencias a imágenes QA, incluidas variantes y fallos. Guardar un HAR/resumen sin secretos: la primera vista debe solicitar únicamente la ventana visible y el margen de lazy loading, no el catálogo completo. Probar 390/412/1440 px, filtro rápido con respuestas fuera de orden y detalle/carrito con fotos. Reservar datos de producción para lectura.

## Fase 5 · Listas administrativas y recursos por demanda

**Claude debe:**

- Paginar Pedidos Web con ítems, Promociones, Reseñas, Referidos y Fidelización. Montar detalles de `CampoColapsable` al expandir, preservando borradores fuera del árbol cuando sea necesario. Revisar contadores globales para no convertirlos en conteos solo de la página.
- Recompensas Web: configuración mínima inicial; catálogo, protección, canjes y datos de cada subpestaña se solicitan al entrar. Protección de servicios y demás listas deben tener ventana/paginación, no miles de nodos.
- Inicio: consultar solo cuatro destacados y tres elementos de galería, o un límite de diseño explícito; no descargar 3.325 servicios para escoger cuatro. Separar hero de recursos secundarios; reutilizar contacto/horario compartidos.
- Deduplicar perfil al restaurar sesión, configuración de negocio y suscripciones. Evitar precargar PortalCliente/InicioCliente antes de conocer el rol en POS.
- Cliente Recompensas: cargar recursos personales por sección; no lanzar las 22 lecturas locales actuales al abrir «Cómo funciona». Evitar respuestas de la cuenta anterior tras cambio de usuario.

**Codex verificará:** hasta 40 filas por página; detalles cerrados ausentes del DOM; búsqueda/limpieza y acciones operativas; altas/modificaciones refrescan filas y contadores correctos. Cambiar todas las subpestañas, abrir/cerrar, volver y refrescar sin perder datos.

Comparará cuerpos/peticiones iniciales: Recompensas Web originalmente 1,12 MB; Inicio 524.695 bytes solo de servicios. Las consultas completas ya no deben aparecer en arranque. Con 1 s de demora en una dependencia secundaria el hero permanece disponible. Restaurar sesión produce una lectura por recurso deduplicable, sin exigir eliminar consultas distintas necesarias. Login/logout/cambio de cuenta funcionan y no muestran datos anteriores.

## Fase 6 · Sesiones largas y animación JavaScript

**Claude debe:** caché acotada de pantallas con una política explícita, preservando carrito/operaciones pendientes, filtros, scroll y borradores. Pausar efectos y placeholders de pantallas inactivas. Separar conservar datos de conservar todos los árboles montados.

TarjetaPuntos: respetar reduced-motion, visibilidad y pestaña activa; cachear referencias y eliminar layout/gradientes continuos innecesarios. FondoNivel: conservar su soporte actual de movimiento reducido y pausar fuera de vista. Máscara de Inicio: detener rAF cuando converge al reposo. Mantener limpieza de rAF/listeners; no hay evidencia de que falte por completo.

**Codex verificará:** las 27 rutas, volver a Ventas, tres ciclos relevantes y GC donde sea posible. Referencia: 69.547 nodos y 53,1 MB después del recorrido, 202 commits en 6 s. El heap de cinco rutas se estabilizaba: no declarar una fuga creciente como hecho.

Criterios: pantallas montadas dentro del límite documentado; nodos/heap se estabilizan al repetir; ningún temporizador o rAF continuo innecesario de una pantalla oculta; reducción clara frente a la retención original. Borradores/carrito recuperables; cambios de rol invalidan contenido protegido. Tarjeta estática en reduced-motion y sin actividad de estilos fuera de vista; arrastre y niveles conservados.

## Fase 7 · SQL bajo las consultas definitivas

**Claude debe:** medir las consultas reales de las fases 4 y 5 bajo los roles que las ejecutan, con datos representativos. Diseñar índices para filtros/orden/relaciones medidos, revisar helpers constantes de RLS cuando sea equivalente y seguro, y comparar EXPLAIN ANALYZE antes/después. No agregar índices a ciegas ni abrir RLS para reducir latencia. Versionar migraciones con rollback o reversión documentada y validar en local/staging antes de producción.

**Codex verificará:** planes y resultados, todos los roles existentes y accesos denegados, fronteras de paginación, conteos y costo de índices. No tratar un índice ausente como cuello confirmado sin evidencia. Referencia SQL original: 3–54 ms en las lecturas diagnósticas; esos tiempos no explicaban la saturación continua de cupones. Codex no aplica las migraciones.

## Fase 8 · Inicio, PWA y preparación de videos

**Claude debe:**

- Mapa diferido por interacción/intersección controlada. Imágenes del hero optimizadas y responsivas; prioridad alta solo en la LCP. Revisar familias/pesos/font-display y recursos de ruta; mantener apariencia y textos.
- Precaché del shell realmente esencial: el portal no debe descargar el escáner y todos los módulos POS durante instalación. Conservar actualización con aviso y red para datos operativos Supabase. No cachear respuestas privadas/firmadas indiscriminadamente.
- Definir un contrato de video compatible con el proveedor elegido, poster, duración/tamaño máximo, estado de procesamiento y reproducción. Para clips cortos R2: archivo optimizado y comprobación de Range/206, búsqueda temporal y caché sobre su endpoint real. No almacenar videos cargados por usuarios en el build de Pages.
- No descargar videos en tarjetas de listado ni hacer autoplay masivo. Usar poster, `preload="none"` cuando sea apropiado y activar reproducción al solicitarla; pausar fuera de vista. Comprobar red móvil y consumo de datos.
- Si se requieren videos largos o múltiples calidades adaptativas, evaluar Cloudflare Stream y sus costos como decisión adicional antes de contratar. Stream ofrece codificación y reproducción adaptativa; R2 almacena objetos y no reemplaza ese pipeline. [Cloudflare Stream](https://developers.cloudflare.com/stream/). Si aún no existe función de video, entregar la política y contrato para implementarla después, sin inventar un módulo comercial ajeno al alcance actual.

**Codex verificará:** no hay llamadas al mapa antes de su activación; hero adecuado a viewport; fuentes realmente usadas; menor transferencia y descubrimiento temprano del LCP. Primera instalación PWA y segunda visita, update con carrito abierto, offline del shell, datos operativos nunca obsoletos por caché. Si existe video: poster sin descargar el archivo completo, play/pause/seek, Range, error de red y accesibilidad.

## Fase 9 · Medios existentes y preparación del cambio público

**Claude debe:** inventario por tipo/proveedor y clasificación de privacidad; manifiesto de migración con registro, origen, destino, tamaño, checksum confiable y estado. No asumir que el ETag de un objeto multipart es checksum de contenido. Simulación previa sin cambios; copia por lotes reanudable, evitando duplicados.

Copiar solo medios públicos incluidos en el alcance a R2; verificar bytes y variantes, luego actualizar referencias en lotes controlados. Mantener lectura mixta mientras exista contenido viejo. Conservar los originales de Supabase y referencias anteriores durante un periodo de reversión que acuerde el usuario. Las nuevas fotos ya se suben a R2 desde la fase 3; esta fase evita arrastrar archivos antiguos rotos al cambio público.

Entregar plan para dominio final, DNS/TLS, URLs antiguas `/PosJaise/`, canonical/sitemap, callback de Auth y enlaces de mensajes/QR si los hubiera. Preparar redirects posibles y documentar límites del dominio github.io; no prometer control de su DNS. Definir transición de sesiones/carritos y comunicación para usuarios del POS. GitHub Pages sigue disponible hasta aprobar el cambio.

**Codex verificará:** manifiesto, muestras de cada tipo, correspondencia de referencias, imágenes viejas/nuevas y errores; rollback ejecutable en staging. Conteos reconciliados, cero referencias rotas del lote aprobado, ningún privado accesible públicamente. Para grandes volúmenes se combina reconciliación automática de todos los objetos con inspección visual de una muestra estratificada. No se borran originales al cerrar esta fase.

## Fase 10 · Regresión final, cambio de hosting y seguimiento

### 10A · Aprobación previa a publicar

Claude incorpora un conjunto pequeño de pruebas de rendimiento reproducibles y presupuestos: cupones en reposo, búsqueda amplia, datos iniciales, sesión larga, reduced-motion y fotos. Ajustar el alcance de lint de fixtures Playwright tras revisar los dos errores existentes; registrar advertencias pendientes sin esconderlas.

Codex verifica todas las fases integradas: 27 rutas POS, roles, portal, detalles, carrito, recompensas, medios, sesión y PWA. Los flujos que mutan negocio se prueban en Supabase Local verificado o staging autorizado, nunca mediante cobros reales para QA. Las integraciones de pago/callback afectadas por dominio se prueban con sandbox y la conciliación se conserva; no agregar reintentos de cargo a ciegas.

Repetir Lighthouse frío/caliente y trazas de interacciones en los escenarios principales. Metas de producto: LCP ≤ 2,5 s, INP ≤ 200 ms y CLS ≤ 0,1 en p75 de usuarios reales; el laboratorio sirve de control previo y no demuestra esos percentiles. Registrar tres muestras de laboratorio y explicar cualquier presupuesto pendiente. Las fotos no deben volver a producir miles de nodos ni descargas del catálogo completo.

### 10B · Publicación y comprobación posterior

Después de la aprobación 10A y la autorización del usuario para el cambio público, Claude aplica el despliegue/configuración y conserva rollback. Codex comprueba en lectura dominio/TLS, rutas profundas, recursos, imagen nueva, acceso por roles, headers/caché, manifest, service worker y enlaces antiguos. Claude controla sus operaciones de escritura autorizadas y configura las URLs de backend necesarias.

No retirar GitHub Pages ni borrar fotos originales de Supabase hasta completar el periodo de observación acordado. Si se revierte el frontend, la versión anterior debe ser compatible con las referencias R2 nuevas o existir un build de reversión preparado; cambiar DNS solamente no garantiza rollback de datos/medios.

Medir LCP/INP/CLS con datos mínimos, sin información personal, diferenciando dispositivo/ruta, y medir errores de subida y reproducción. Definir alertas/cuotas de R2, Worker, Images o Stream según los productos que realmente se activen. No asumir costos cero por usar CDN. Las tendencias posteriores justifican ajustes; no usar una nota Lighthouse aislada como garantía.

## Registro de aprobación

Actualizar este registro con cada entrega y verificación; inicialmente no hay fases aprobadas.

| Fase | Estado inicial | Entrega Claude | Veredicto Codex | Evidencia / pendientes |
| --- | --- | --- | --- | --- |
| 1 | **Aprobada** | 2026-10-09 · docs/evidencia-rendimiento/fase-1/ | Aprobada por Codex — informe: C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/fase1-verificacion/VERIFICACION-FASE-1.md | Claude: 94,0–98,7 %; Codex (independiente): 91,3–96,5 %; mínimo 80 % superado en ambas; ver README de la fase 1 |
| 2 | **Aprobada con observaciones** (preview de staging) · **Fase 2B Git/preview: APROBADA; O1 CERRADA** | 2026-10-09 · docs/evidencia-rendimiento/fase-2/README.md y O1-ONLINE.md · preview https://feat-cloudflare-pages.pos-jaise.pages.dev | Fase 2: aprobada con observaciones (VERIFICACION-FORMAL-FASE-2.md). Fase 2B: preparación aprobada (VERIFICACION-FASE-2B-V3-1.md) y preview Git + O1 aprobados (VERIFICACION-O1-ONLINE.md) | Pendiente (esperan indicación del usuario): hosting definitivo/producción, retiro de GitHub Pages (solo tras validar Cloudflare), limpieza de cuentas QA, R2/Fase 3. Observaciones vivas: Node real del preview 22.22.0 con EBADENGINE de @zxing/library (>=24), escáner no validado; compatibilidad del frontend con el esquema/RPC/Edge Functions del negocio por comprobar; pagos, correos, CSP, móvil físico y rendimiento vs GitHub Pages sin validar; formularios embebidos fuera de la protección de «Actualizar»; HTML max-age=0,must-revalidate (O2) |
| 3 | **Hitos de medios en STAGING verificados y aceptados en sus alcances acotados (vigente al 2026-10-10, commit 6929c619, Preview con entrega Pages `/medios` y B activa). Fase 3 completa y producción: NO aprobadas.** Pendiente la habilitación para datos reales del negocio (ver pendientes). | 2026-10-10 · evidencia en `.codex/`: `evidencia-interfaz-6929c61` (23/23), `evidencia-carga-6929c61` (20/20), `evidencia-recolector-6929c61` (13/13), `artefacto-lectura-mixta-v3` y `evidencia-ml03-bundle-v3b` (paquete mixto y ML-03 en bundle compilado). Corrección local del código de salida del CLI habitual del recolector (`scripts/lib/huerfanos-medios.mjs`, `scripts/medios-huerfanos.mjs`, suite `scripts/verificar-cli-huerfanos.mjs`): **sin commit**. | Codex: REVISION-LECTURA-MIXTA-V4-Y-PAGES-6929C61.md (Pages 6929c619 confirmado); REVISION-INTERFAZ-6929C61-147B24.md (23/23, 18 controles independientes); REVISION-PAQUETE-MIXTO-V3-Y-ML03-BUNDLE.md y REVISION-VERIFICADOR-ML03-BUNDLE-V2.md (paquete v3 candidato local de rollback; ML-03 cerrado en bundle compilado); REVISION-CARGA-6929C61-59D8CB.md (20/20, retirada B acreditada en MIA, 29 controles); REVISION-RECOLECTOR-6929C61-73159D.md (13/13 para UUID ficticios, 38 controles); LECTURA-CPU-CUOTA-B-Y-ALCANCE-CLI.md (consumo bajo observado); ESTADO-FASE3-CLI-Y-PREPARACION-FASE4.md (código de salida del CLI aceptado localmente, 23/23 con control negativo). | Pendientes reales: escala/unidades de CPU de Pages por corroborar y B con condiciones representativas (el CPU del Worker de subidas es otra métrica); retirada en accesos alternativos (r2.dev y deployments antiguos) sin cubrir; fotos reales de catálogo y Firefox/Safari/móvil, o decisión explícita de alcance; operación del recolector habitual con mitigación de referencias concurrentes (ventana consulta→DELETE abierta; no activar cron por haber cerrado su código de salida); rollback/despliegue operativo, compatibilidad del negocio y preparaciones de Fases 9–10 antes del cambio público. Vídeos: Fase 8, no certificados aquí. El dominio propio pasó a opcional/futuro (se eligió la entrega por Pages Functions). Sin commit/push de los cambios locales recientes; no escribir refs `r2:` en el negocio ni retirar GitHub Pages. |
| 4 | **Aprobada con observaciones SOLO para implementación y QA LOCAL (2026-10-11, base 6929c619, sin commit).** Staging/producción: NO acreditadas. | 2026-10-11 · `.codex/ENTREGA-FASE4-CATALOGOS-ESCALABLES.md` (histórico) y correcciones `ENTREGA-FASE4-CORRECCIONES-V1/V2/V3.md`; evidencia en `.codex/evidencia-fase4/`; lista de archivos y separación de rondas en `.codex/PAQUETE-FASE4-ARCHIVOS.md`. | Codex: REVISION-FASE4-CATALOGOS-V1/V2/V3.md (hallazgos F4-01…F4-06b, todos cerrados) y VERIFICACION-FASE4-CATALOGOS-V4.md (aprobada con observaciones). | Pendientes: migración `20261011000001` (4 RPC) solo en Supabase local — preparar por separado para el backend de STAGING y validar frontend + esquema en Pages Preview (sin apuntar al Supabase del negocio); producción/commit/push sin autorización; prueba de interfaz de cambio real de cuenta; tareas de montaje inicial 250–410 ms; cifras de laboratorio (no INP/LCP); ≤10 categorías y 300/100 son supuestos/sintético. |
| 5 | **Aprobada con observaciones SOLO para implementación y QA LOCAL (2026-10-11, base 6929c619, sin commit).** Staging/producción: NO acreditadas. | `ENTREGA-FASE5-LISTAS-ADMIN.md`, `ENTREGA-FASE5-CORRECCIONES-V1/V2.md`; evidencia en `.codex/evidencia-fase5/`; lista de archivos en `.codex/PAQUETE-FASE5-ARCHIVOS.md`. | Codex: REVISION-FASE5-LISTAS-ADMIN-V1.md (RECHAZADA, F5-01…F5-05), REVISION-FASE5-LISTAS-ADMIN-V2.md (RECHAZADA, F5-02b, F5-04b) y VERIFICACION-FASE5-LISTAS-ADMIN-V3.md (aprobada con observaciones). | Pendientes: migración `20261011000002` (2 vistas + `normalizar_busqueda`) solo en Local; límites Unicode (8 mayúsculas, fuera del BMP, espacios); costo SQL de la función y latencias RLS → Fase 7; sin matriz de roles cajera/asistente ni staging/producción; mediciones antes/después son de Claude; commit/push sin autorización; (histórico, al cierre de la Fase 5) Fase 6 no iniciada; luego implementada, ver fila 6. |
| 6 | **Aprobada con observaciones SOLO para implementación y QA LOCAL (2026-10-11, base 6929c619, sin commit).** Staging/producción: NO acreditadas. Fase 7 no iniciada (decisión del usuario). | `.codex/ENTREGA-FASE6-SESIONES-LARGAS.md` y `ENTREGA-FASE6-CORRECCIONES-V1.md` y `-V2.md` (rollback vigente: `evidencia-fase6/rollback-archivos-mixtos.md`, V3 de la entrega); evidencia en `.codex/evidencia-fase6/`; archivos en `.codex/PAQUETE-FASE6-ARCHIVOS.md` | V1: RECHAZADA (F6-01…F6-04), corregidos; V2: RECHAZADA (F6-01b, F6-05; F6-02/03/04 cerrados), corregidos en `ENTREGA-FASE6-CORRECCIONES-V2.md`; V3: `VERIFICACION-FASE6-SESIONES-LARGAS-V3.md` APROBADA CON OBSERVACIONES (solo local) | Sin migraciones. Límites: estado local no-filtro se reinicia al desmontar; tope 6 sin validar con usuarios reales; cifras de laboratorio; sin commit/push; Fase 7 no iniciada. |
| 7 | **Aprobada con observaciones SOLO para implementación y QA LOCAL (2026-10-12, verificación V2; F7-01/F7-02 cerrados; sin commit).** Historial: V1 pendiente de correcciones. Observaciones O1–O3 cerradas en `CIERRE-FASE7-OBSERVACIONES.md`. Staging/producción NO acreditadas. Fase 8 no iniciada. Aplicadas en Local las migraciones `20261012000001` (helpers RLS evaluados una vez) y `20261012000002` (3 índices medidos). Producción/staging NO acreditadas. Fase 8 no iniciada. | `.codex/ENTREGA-FASE7-SQL.md` (histórica), `.codex/ENTREGA-FASE7-CORRECCIONES-V2.md`, `.codex/VERIFICACION-FASE7-SQL-V2.md`, `.codex/CIERRE-FASE7-OBSERVACIONES.md`, `.codex/evidencia-fase7/` (rollback: `rollback-fase7.sql`) | Pendiente de Codex | — |
| 8 | **Aprobada con observaciones SOLO para implementación y QA LOCAL (2026-10-12, revisión V2; F8-01/F8-02/F8-03 cerrados; sin commit).** O1 (dependencia estática fallida: el reintento no la repara, la venta se conserva y la salida es segura) incorporado a la regresión y registrado en `CIERRE-FASE8-OBSERVACIONES.md`. Historial: V1 pendiente de correcciones (F8-01 P1 pérdida de venta por chunk frío, F8-02 P2 caché de imágenes firmadas del proxy, F8-03 P2 contrato de video). V2: límite de error local + módulos reintentables + precarga en reposo del POS; reglas de caché por uso limitadas a estáticos públicos con limpieza de entradas indebidas; contrato de video con la retirada vigente. Precaché 37 entradas, 0,91 MB. Producción/staging NO acreditadas. | `.codex/ENTREGA-FASE8-INICIO-PWA.md` (histórica), `.codex/ENTREGA-FASE8-CORRECCIONES-V2.md`, `.codex/POLITICA-VIDEO-FASE8.md` (V2), `.codex/evidencia-fase8/`, `.codex/evidencia-fase8-v2/` (rollback: `rollback/rollback-fase8-v2.md`) | Codex: REVISION-FASE8-INICIO-PWA-V1.md (pendiente de correcciones); REVISION-FASE8-CORRECCIONES-V2.md (aprobada con observaciones, solo local) | Límites: `CIERRE-FASE8-OBSERVACIONES.md` (recuperación no universal, intermitencias, decisiones abiertas, solo Chromium) |
| 9 | **V2 entregada para revisión de Codex (2026-10-12, solo Local, sin commit, sin cambios remotos).** V1 pendiente de correcciones (`REVISION-FASE9-MEDIOS-V1.md`: F9-01…F9-03 P1, F9-04…F9-06 P2) → V2 corrige los seis: guarda de `--trabajo` del harness, manifiesto v2 ligado a Supabase/Worker/lectura, diario con intención previa y reconciliación de resultados inciertos (código 3), verificación de cobertura completa, redacción de URLs firmadas/privadas, permisos remotos por función. Pruebas: unitarias 17/17, CLI y harness reales con backend ficticio 14/14, simulación local 18/18. Reservas O1–O3 en el plan público. Puerta: referencias de producción solo tras 10B. Sin datos reales migrados, sin hosting ni DNS. Fase 10 no iniciada. | `.codex/ENTREGA-FASE9-CORRECCIONES-V2.md`, `ENTREGA-FASE9-MEDIOS-Y-CAMBIO-PUBLICO.md`, `DISENO-MIGRACION-MEDIOS-FASE9.md`, `INVENTARIO-MEDIOS-FASE9.md`, `PLAN-CAMBIO-PUBLICO-FASE9.md`, `.codex/evidencia-fase9/`, `.codex/evidencia-fase9-v2/` | Pendiente de Codex (V2) | Decisiones del usuario: dominio o pages.dev, periodo de reversión, perfiles y QR, comunicación. Inventario de producción y rollback en staging requieren autorización |
| 10A / 10B | Pendiente | — | — | — |

### Histórico de la fila 3 (hasta el commit ba07a32, 2026-10-09; sustituido por el estado vigente de arriba)

> Texto original conservado sin cambios. Describe un estado anterior (r2.dev sin CDN, Preview sin variables, PWA pendiente, etc.); varias de sus carencias ya se resolvieron con Pages Functions, B y las corridas aceptadas. No usar como estado actual.

| 3 | **Implementación LOCAL aceptada con observaciones (VERIFICACION-FASE-3-V5.md); Worker + bucket de STAGING desplegados y verificados (8/8 + 30/30); commit ba07a32 publicado en feat/cloudflare-pages (Preview con VITE_MEDIOS_* configuradas por Codex solo en Preview; prueba de interfaz 21/21 sobre el alias); Fase 3 completa PENDIENTE de dominio propio, PWA entre builds, otros navegadores/móvil, fotos de catálogo y resto** | 2026-10-09 · docs/evidencia-rendimiento/fase-3/README.md y R2-REAL-RUNBOOK.md | Codex: F3-07 cerrado en las reproducciones revisadas (166/166 + 11/11) | Sin dominio propio (r2.dev: sin CDN ⇒ HIT/MISS imposible; sin nosniff), sin CORS del bucket, CPU de procesamiento sin leer del panel, Pages Preview sin VITE_MEDIOS_*; Firefox/Safari/móvil y fotos de catálogo sin medir; purga de caché, operación del recolector (ventana consulta→DELETE) y migración inversa sin decidir; sin commit/push; no escribir refs r2: en el negocio ni retirar GitHub Pages; fila residual de staging (galeria_web 5bb670df…) pendiente de decisión del usuario |

## Mensaje inicial para Claude Code

> Lee AUDITORIA-RENDIMIENTO.md y FASES-RENDIMIENTO-CLOUDFLARE.md. Implementa únicamente la fase 1 de este plan y conserva la lógica comercial. Guarda evidencia antes/después y entrega archivos modificados, pruebas, limitaciones y rollback. Al terminar detente para la verificación independiente de Codex. No inicies la fase 2 ni migres infraestructura o datos por anticipado. El objetivo posterior es usar Cloudflare Pages para el frontend y R2 para medios públicos nuevos, manteniendo Supabase Auth/Postgres y la privacidad de comprobantes. Sigue las puertas de aceptación de cada fase.
