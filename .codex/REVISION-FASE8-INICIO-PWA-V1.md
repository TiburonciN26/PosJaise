# Revisión Fase 8 · V1

Fecha: **2026-10-12**, America/Lima. HEAD `6929c619`, rama `feat/cloudflare-pages`. Entrega revisada: [ENTREGA-FASE8-INICIO-PWA.md](C:/WedJaiseReact/.codex/ENTREGA-FASE8-INICIO-PWA.md).

## Veredicto

**PENDIENTE DE CORRECCIONES. La Fase 8 todavía no queda aprobada.** Se reproduce una regresión **P1 de pérdida de venta en memoria**, una **P2 de caché de imágenes firmadas bajo el proxy del mismo origen** y una **P2 del contrato de video que contradice la retirada acordada**.

El mapa, las variantes del hero y el presupuesto de precaché tienen resultados favorables. Esos ahorros no compensan la pérdida de trabajo pendiente ni permiten asumir que toda respuesta privada queda fuera de caché.

| Hallazgo | Prioridad | Estado |
| --- | --- | --- |
| F8-01, chunk frío fallido desmonta el POS y pierde el carrito | **P1** | Reproducido en desconexión real del contexto y en cambio de assets simulado; control anterior conserva el carrito |
| F8-02, la regla de imágenes cachea URLs firmadas del proxy Supabase | **P2** | Reproducido con respuesta privada ficticia, incluso con `Cache-Control: private, no-store` |
| F8-03, video con caché anual y acceso directo público a R2 | **P2, contrato** | Incompatible con la decisión registrada sobre enlaces retirados; no existe implementación de video |

No avanzar a Fase 9 ni publicar como aprobada. Claude implementa las correcciones; Codex no modifica fuente o configuración.

## F8-01 · El precaché reducido necesita una recuperación que conserve la venta

Archivos relacionados: [vite.config.js:99](C:/WedJaiseReact/vite.config.js:99), [ErrorBoundary.jsx:19](C:/WedJaiseReact/src/components/ErrorBoundary.jsx:19), [main.jsx:17](C:/WedJaiseReact/src/main.jsx:17), [verificar-fase8.cjs:4](C:/WedJaiseReact/scripts/verificar-fase8.cjs:4) y [CarritoContext.jsx:7](C:/WedJaiseReact/src/context/CarritoContext.jsx:7).

Las rutas POS diferidas, entre ellas Citas, ya no están disponibles en el precaché inicial. Un rechazo de su import llega al ErrorBoundary global, que reemplaza todo su árbol. **Layout/CarritoProvider y AvisoActualizacionPWA están dentro de ese árbol:** se desmontan, el carrito solo en memoria se pierde y desaparece también el botón de actualización protegido.

### Reproducción con el artefacto real, sin publicar B

1. Instalar el SW real de `dist-f8-a`, iniciar sesión con una cuenta QA Local y entrar a Ventas.
2. Agregar un producto ficticio al carrito, sin confirmar ni cobrar la venta. Hay un botón Quitar y la venta queda registrada como pendiente.
3. Confirmar que Citas nunca se visitó ni está en Cache Storage.
4. Poner sin conexión el contexto Chromium y navegar a Citas usando el menú real.
5. Aparece **«Algo salió mal»** del límite global. Recuperar la conexión y recargar Ventas: **el carrito queda vacío**.

**Control anterior:** con `dist-f8-antes` y la misma secuencia, Citas está precacheada, no aparece el límite global y al volver a Ventas sigue **un producto en el carrito**. Sus peticiones de datos pueden fallar sin red, pero el árbol del POS y el trabajo en memoria se conservan.

Es una regresión de seguridad del trabajo: la indisponibilidad de una pantalla puede informarse conservando los providers y permitiendo volver a la venta. La decisión de que ciertas rutas no funcionen offline no autoriza descartar un carrito pendiente.

### Reproducción con B y URLs JS distintas

Se usa un servidor de diagnóstico local sobre el artefacto A real. B es **virtual**: renombra coherentemente todas las URLs JS y referencias, actualiza HTML/precaché y no sirve los assets JS antiguos de A. No es un build ni despliegue real de Cloudflare. Una sesión nueva de B inicia correctamente y abre Citas, control que descarta que B sea simplemente un servidor roto.

| Punto | Build nuevo de Fase 8 |
| --- | --- |
| A antes del cambio | `f8-a`, carrito 1, Citas sin caché |
| B instalado esperando | Aviso visible, Actualizar deshabilitado por venta pendiente |
| Navegar a Citas de A, aún no visitada | Peticiones a chunks A ausentes; aparece el error global |
| Tras el error | No quedan controles del carrito ni Actualizar; solo Recargar |
| Recargar Ventas | Sigue `f8-a` controlada por A; carrito **0** |
| Cliente nuevo de B | `f8-b-virtual`, Citas abre, sin error global |

En el control con el precaché anterior, A carga Citas desde su caché, no pide chunks antiguos a la red y conserva el carrito **1**. No se afirma que cada despliegue de Pages elimine inmediatamente cada recurso: se acredita el estado de assets antiguos ausentes, además del caso offline que no depende de un despliegue. [Vite documenta este fallo de imports tras cambios de assets](https://vite.dev/guide/build#load-error-handling).

### Por qué el 13/13 de Claude no lo detecta

- Los A/B entregados cambian la marca de HTML, pero sus **143 archivos JS son idénticos byte a byte**; las URLs del módulo principal y de Citas son iguales.
- `fs.cpSync(B, viva, {recursive:true, force:true})` añade/reemplaza archivos sin retirar los de A. Si hubiera hashes distintos, la simulación seguiría dejando sus archivos antiguos disponibles.
- La prueba mantiene la venta en Ventas y no intenta una ruta/modal fría mientras espera B.
- Un error capturado por React **no necesariamente genera `pageerror`**: el error global fue visible aunque ese observador estuviera vacío. Hay que comprobar estado y UI, no solo errores no capturados.

### Corrección y aceptación

Claude debe definir e implementar una transición que conserve la operación: disponibilidad/retención/pinning de los chunks de la versión en uso, shell POS apropiado o recuperación localizada que mantenga el carrito y los controles de regreso. El fallback de una ruta/modal no debe desmontar todo el Layout. **No resolver con un reload automático mientras haya trabajo pendiente.**

Regresiones necesarias:

- venta pendiente + desconexión + ruta/modal diferida no visitada: no pierde la venta; al volver la red se recupera con controles seguros;
- A/B con cambios reales de URLs JS y publicación simulada sin conservar por accidente archivos A: mantiene el estado y la posibilidad de terminar/cancelar la operación;
- volver a Ventas conserva el contenido; terminar o cancelar permite actualizar a B;
- cliente nuevo de B y caso vacío funcionan;
- incluir dependencias críticas que se piden al terminar una venta, sin confirmar ventas reales durante el diagnóstico ni hacer obsoletos los datos de Supabase.

No se exige volver indiscriminadamente al precaché de todo el portal/POS. La reducción debe incluir un contrato de recuperación seguro.

## F8-02 · Mismo origen no significa recurso estático público

**P2.** [vite.config.js:110](C:/WedJaiseReact/vite.config.js:110), [supabase.js:3](C:/WedJaiseReact/src/lib/supabase.js:3), [imagenes.js:119](C:/WedJaiseReact/src/lib/imagenes.js:119).

La regla `imagenes-del-sitio` admite cualquier GET del mismo origen con extensión de imagen, excluyendo solo `/medios`. No distingue los directorios públicos del build de los endpoints de Storage ni URLs firmadas.

La app permite configurar Supabase con una URL relativa (p. ej. `/__supabase`), resuelta contra `window.location.origin`; el proxy móvil está definido en Vite. Los comprobantes privados usan `createSignedUrl`. No se puede fundamentar el aislamiento únicamente en que el Supabase de este build concreto sea un origen distinto.

**Reproducción con el SW compilado:** un endpoint ficticio local bajo

`/__supabase/storage/v1/object/sign/comprobantes-pedidos-web/qa-f8.png?token=ficticio`

sirve una imagen de 68 bytes con `Cache-Control: private, no-store`. No se accede a un comprobante real ni se genera un token real.

| Resultado | Fase 8 nueva | Control anterior |
| --- | ---: | ---: |
| Primera petición | 200, 68 bytes | 200, 68 bytes |
| Entrada en `imagenes-del-sitio` | **Sí** | No |
| Servidor tras revocación ficticia | 401 | 401 |
| Nueva petición del cliente | **200, los 68 bytes anteriores** | 401 |

StaleWhileRevalidate devuelve la copia y su intento de renovar con 401 no elimina automáticamente la respuesta 200 anterior. El Cache API es gestionado por JavaScript; las directivas de caché HTTP no sustituyen la política de la estrategia. [Workbox explica la separación entre HTTP cache y Cache API](https://developer.chrome.com/docs/workbox/caching-strategies-overview).

**Alcance exacto:** esto prueba el SW ante un backend/fixture del mismo origen. El Supabase absoluto de los builds Local auditados se encuentra en otro origen y no cae en esta regla. **No se afirma que se hayan cacheado comprobantes reales, que producción use ese proxy o que hubiera una filtración de datos de negocio.** La exclusión prometida de APIs/archivos firmados no está garantizada por la regla.

Controles positivos: los JSON ficticios del proxy devolvieron lecturas **1 y 2**, sin copia stale; `/medios` quedó fuera de caché. El problema se concentra en recursos con extensión de imagen.

**Corrección:** limitar las reglas de caché por uso a los recursos estáticos públicos conocidos del build y excluir explícitamente los endpoints de datos, Storage/proxy y recursos firmados/privados. Mantener las funciones serializadas de Workbox autocontenidas. La regla de assets también debe mantenerse dentro de su namespace público, en vez de confiar en una extensión arbitraria en cualquier segmento de ruta.

Regresiones: positivos de hero/íconos/assets públicos; negativos de Supabase absoluto y relativo, Storage privado/firmado, `/medios` y respuestas de error. Tras retirar acceso, el SW no debe devolver una copia privada. Si se reutilizan nombres de caché de una versión que ya guardó entradas indebidas en QA, comprobar su retirada sin borrar indiscriminadamente los assets necesarios de una pestaña pendiente. No se necesita usar documentos privados reales para probarlo.

## F8-03 · El contrato de video debe conservar la retirada acordada

**P2, documental.** [POLITICA-VIDEO-FASE8.md:53](C:/WedJaiseReact/.codex/POLITICA-VIDEO-FASE8.md:53), §§5 y 6. Decisión vigente: [plan de pendientes Fase 3 V2, §4](C:/WedJaiseReact/.codex/REVISION-Y-PLAN-PENDIENTES-FASE3-V2.md:69).

El usuario eligió bloquear también el enlace antiguo después del borrado. El contrato de medios adoptó revalidación del navegador y revocación B antes de entregar desde caché, cubriendo accesos alternativos.

La política nueva propone `Cache-Control: public, max-age=31536000, immutable` y, si la Function no soporta Range, servir por un **dominio R2 público directo distinto del de fotos**. Un nombre con hash evita reemplazar contenidos bajo una URL; no garantiza su retirada. La caché larga del navegador/borde y el origen directo pueden seguir reutilizando el enlace al margen del control B.

No existe un módulo de video; no se sube ni borra un clip para esta revisión. El problema es que la especificación permitiría una futura implementación que reabre ese acceso alternativo.

**Corrección del documento:** establecer por defecto la misma garantía de impedir nuevas entregas tras borrado confirmado para GET/HEAD/Range/condicionales, con política de navegador compatible y un endpoint revocable. Un fallo de soporte Range de la Function actual debe llevar a diseñar otro endpoint con garantía equivalente, sin abrir el bucket público como fallback automático. Proteger originales/pendientes de procesamiento y separar su acceso de los objetos aprobados. Un año de caché/directo a R2 solo puede presentarse como alternativa que requiere una excepción explícita del usuario a la decisión vigente, no como el contrato aprobado.

No prometer borrar descargas ya realizadas ni detener bytes ya entregados. No contratar Stream, comprar dominio, crear módulo, tablas o infraestructura como parte de esta corrección. Basta alinear el contrato y sus futuras pruebas.

## Comprobaciones favorables y alcance

- **Mapa: 5/5** independientes con el componente y CSS reales en Vite: nada fuera de vista, activación al acercarse, Save-Data solo por botón, fallback sin IntersectionObserver, dirección vacía y activación por Enter en modo manual. Google se simula: no se repiten sus bytes ni su comportamiento interno. Iframe mantiene título, `loading=lazy` y referrerPolicy.
- **Hero: 14 variantes** inspeccionadas con ffprobe de solo lectura: anchos correctos y originales JPG/WebP conservados por SHA-256 frente al build anterior. No se regenera ninguna imagen. Las mediciones de selección srcset/transferencia y SSIM siguen atribuidas a Claude.
- **Precaché:** manifest generado del A identificado: **33 entradas, 877.472 bytes**, sin chunk Citas ni escáner. El build «después» sin la marca de A reporta 877.433 bytes: el HTML con marca explica los 39 bytes de diferencia. El manifest anterior tiene 176 entradas declaradas; Cache Storage elimina duplicados y las cifras 172/176 no son equivalentes.
- **Evidencia de Claude:** 13/13 funcionales y 32/32 Fase 5 en sus JSON. Se auditan, no se ejecuta la suite Fase 5 con SQL de siembra/limpieza. Sus casos no cubren los dos fallos reproducidos aquí.
- **Rollback:** hashes de las copias previas correctos; `main.jsx` y AvisoActualizacionPWA sin cambios; `git apply -R --check` correcto, sin aplicar. No se compila ni restaura el árbol del proyecto. Rehacer el rollback al agregar las correcciones.
- **Lint revisado:** sin diagnósticos en los archivos/scripts de esta fase examinados.
- **Local final:** SELECTs READ ONLY, puerto 54321 del proyecto verificado: 4.749 clientes, 429 pedidos, 3.067 cupones, 3.245 productos, 25.860 auditorías, migración `20261012000002`. No se acredita identidad de toda la base por esos conteos.

Los ensayos del POS usan una cuenta QA existente y un producto ficticio de Local. Se permite el login normal de Auth y se bloquean escrituras de negocio; no hubo intentos bloqueados en las corridas finales, ni venta/cobro/comprobante guardado. Las sesiones de Auth reciben la actividad normal del login. Los endpoints privados de la prueba son fixtures del servidor propio, no archivos de clientes. Se cerraron los contextos Chromium y servidores propios. No se toca producción, R2 real, hosting, Git, `.env`, dependencias o código del repositorio; tampoco se ejecuta un build que sobrescriba `dist`.

## Observaciones no bloqueantes

1. **Rollback y expiración:** el texto dice que las cachés huérfanas desaparecerán a los 30 días al quitar sus reglas. La limpieza de Workbox se dispara cuando la estrategia usa/actualiza la caché; si esa estrategia desaparece, no se acredita un temporizador que las limpie automáticamente. Documentar posible persistencia hasta limpieza explícita/cuota, o definir limpieza acotada. [Documentación de ExpirationPlugin](https://developer.chrome.com/docs/workbox/modules/workbox-expiration).
2. **Alcance de «sin POS»:** la entrada todavía importa PestanasCacheadas/Ventas estáticamente. El shell incluye esa entrada y código compartido del POS; los tests por nombre de chunk no prueban ausencia de todo código POS. Acotar la frase a los módulos diferidos retirados y al escáner. La entrega ya reconoce el costo fijo de la entrada.
3. **Producto offline/precarga:** las decisiones de login offline, precarga normal y maquetas públicas quedan abiertas. La pérdida de carrito de F8-01 debe corregirse antes de pedir aceptar ese contrato offline. No mover maquetas o cambiar sus archivos por decisión de Codex.
4. Solo Chromium. No se repite el build GitHub Pages en navegador ni staging/producción; no se reasignan los SSIM, LCP/FCP ni bytes de Google a esta revisión. Las métricas son de laboratorio; no hay móvil físico ni regresión completa de operaciones del negocio.

## Traspaso y evidencia

Claude corrige F8-01/F8-02 en local, actualiza el contrato F8-03 y las precisiones. Añade regresiones que fallen contra esta versión, incluyendo el control de código/hashes distintos y ausencia real de assets A. Entrega V2 con pruebas, limitaciones y rollback renovado, preservando V1. Codex verificará esa corrección antes del cierre.

En `.codex/evidencia-revision-fase8-v1/` quedan `resumen-verificacion.json`, `pwa-diagnosticos.json`, `pwa-control-antes.json`, `offline-diagnostico.json`, `offline-control-antes.json`, `mapa-diagnosticos.json`, `auditoria-fase8.json`, `artefactos.json`, captura `error-ruta-antigua.png` y diagnósticos de consulta en `.txt`.

Los diagnósticos registran observaciones: **exit 0 del arnés no significa aprobar el contrato de la aplicación**. El resumen identifica las regresiones y sus controles. Las capturas/datos finales pertenecen a las corridas corregidas del arnés, con menú abierto y tiempo de render al volver a Ventas. Los archivos «offline» reutilizan el servidor del arnés, pero **no publican B**: el fallo allí es solo la desconexión de A.
