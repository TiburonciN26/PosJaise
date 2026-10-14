# Revisión Fase 4: catálogos públicos — V1

Fecha: 2026-10-11, America/Lima. Base HEAD: 6929c619. Código revisado: cambios locales sin commit, según los hashes de verificacion.json.

## Veredicto

**NO APROBADA todavía.** La reducción de transferencia y bloqueo al buscar está respaldada por las mediciones y por la repetición independiente. Quedan cuatro defectos reproducidos que deben corregirse antes de aceptar la fase. Son fallos del listado agrupado y de los totales informativos; esta revisión no demuestra un cobro incorrecto ni altera pagos.

Codex no modificó código, configuración, dependencias, Git ni datos de Supabase. No aplicó la migración ni ejecutó los escenarios que suspenden disparadores o cambian activos. No hubo escrituras de pruebas remotas.

## Comprobaciones independientes

- Datos: repetición de verificar-catalogo-publico.mjs, **21/21**, contra Supabase Local verificado en http://127.0.0.1:54321. Incluye RPC, búsqueda posterior a 1.000, recorrido completo, orden, filtros y ausencia de las columnas privadas seleccionadas por la prueba.
- Interfaz: repetición de verificar-catalogos-interfaz.cjs, **25/25**, en la aplicación Vite local. Incluye paginación, respuestas fuera de orden, recuperación de error y anchos 390/412/1440.
- Rendimiento: **6 muestras nuevas**, tres por catálogo, 1440 px y CPU 4×. Solo lectura de la réplica; no reconstruí la línea base ni el escenario de 300 registros.
- Lint de los diez archivos de aplicación revisados: 0 errores, las dos advertencias conocidas de Fast Refresh en TarjetaProductoCliente.
- Seis reproducciones observacionales nuevas en Chromium: páginas y componentes reales, contexto de carrito y respuestas REST simulados por interceptación. Ninguna mutación de BD; sin errores de página. El código 0 del harness significa que terminó, no que los defectos sean pruebas aprobadas.

| Medición independiente actual | Productos | Servicios |
| --- | --- | --- |
| Transferencia de catálogo en carga | 11.830 bytes | 16.489 bytes |
| Evento máximo durante búsqueda | 64 ms | 48 ms |
| Tarea larga máxima durante búsqueda | 86 ms | 68 ms |
| Tarjetas de la búsqueda utilizada | 39 | 1 |
| Encuentra el objetivo | Sí | Sí |

Las cuatro tablas históricas contienen 18 muestras cada una, sin errores registrados, y sus resúmenes coinciden con las cifras entregadas. Los resultados de antes y después no tienen idéntica espera de estabilización: la entrega explica esa diferencia. No certifico un porcentaje exacto de mejora bajo condiciones idénticas, pero la reducción de segundos a decenas de milisegundos está respaldada y mi medición actual es consistente.

## F4-01 · P2 · «Todos» no tiene una ventana global acotada

Ubicación: ProductosCliente.jsx:471, ServiciosCliente.jsx:421; catalogoPublico.js:41 y RPC de la migración, líneas 58/93.

La RPC limita tarjetas POR categoría, pero devuelve todas las categorías. Ambas páginas montan todos los grupos con grupos.map. La transferencia y el DOM crecen con categorías × cuatro. La réplica de miles utilizada tiene pocos productos categorizados y en las mediciones solo monta 11 tarjetas de Productos y 24 de Servicios; eso no prueba el crecimiento de esta vista.

**Reproducción:** once categorías, cuatro productos por categoría, sin héroe ni cintas: la página real monta **44 artículos**, sin paginador ni ventana de grupos. Cada categoría adicional suma más. No inserté esas categorías en la base: son respuestas simuladas válidas del contrato de la RPC.

Además, la RPC no tiene paginación de categorías ni límite superior para por_categoria. Con suficientes categorías, el límite de respuestas de PostgREST también puede truncar los grupos de los que se derivan las categorías y conteos. Este último extremo se identifica por el diseño, no se ha reproducido escribiendo miles de categorías.

**Corrección recomendada:** mantener los metadatos completos de categorías/contadores separados de las tarjetas de la ventana; paginar grupos o virtualizar una ventana limitada preservando el diseño agrupado. Acotar en servidor los parámetros de la RPC. No ocultar categorías ni descargar todas las tarjetas para luego cortarlas en React.

**Regresión requerida:** al menos 11 y muchas más categorías, conteos y categorías completos, todas alcanzables, hasta 40 tarjetas del listado montadas por ventana y carga de imágenes restringida a la ventana. Documentar por separado el pequeño héroe y las cintas.

## F4-02 · P2 · «Tu cita» duplica servicios y su importe

Ubicación: ServiciosCliente.jsx:156–158 y BarraTuCitaFlotante.jsx:38–48.

conocidos concatena héroe, grupos y listado sin deduplicar. La barra selecciona con servicios.filter, conservando todas las ocurrencias, y suma cada una. El Set conocidos solo evita duplicados provenientes de extras, no los que ya están dentro de servicios.

**Reproducción:** un único UUID seleccionado, precio S/ 10, presente en héroe y primera fila de categoría: la barra muestra **«2 servicios en tu cita · S/ 20.00»**. Buscar ese mismo servicio y tenerlo a la vez en héroe/listado produce el mismo resultado. Esperado: un servicio, S/ 10.

**Corrección recomendada:** resolver los seleccionados mediante un Map por id, con una única fila/precio por servicio, incluso si aparece en varias piezas visuales. El conteo debe representar los UUID seleccionados, no sus apariciones.

**Regresión requerida:** seleccionado en héroe y grupo; héroe y búsqueda; combinación con extras; ninguna duplicación de cantidad ni importe. La prueba actual de página 3 no cubre el servicio compartido con el héroe.

## F4-03 · P2 · Una lectura de precios fallida presenta un subtotal como total

Ubicación: BarraTuCarritoFlotante.jsx:25–45 y BarraTuCitaFlotante.jsx:24–42.

El rechazo de leerPorIds se ignora. Los registros sin precio se omiten también del conteo. No hay estado de error, total pendiente ni botón para reintentar. La dependencia del efecto es solo claveFaltantes; aumentar la cantidad de un id ya faltante no cambia esa clave y no vuelve a solicitarlo, pese al comentario de recuperación al cambiar el carrito.

**Reproducción de Producto:** seleccionados A de S/ 10 y B de S/ 20; falla la consulta por id de B con 403. La barra muestra un producto/S/ 10. Después el endpoint vuelve a estar disponible y B aumenta a dos unidades; la barra sigue mostrando un producto/S/ 10, sin petición nueva. Esperado: tres unidades/S/ 50, o un estado explícito que no presente el subtotal como completo.

**Reproducción de Servicio:** dos seleccionados, precios 10 y 20; falla la lectura del segundo. La barra muestra un servicio/S/ 10 y no se recupera por un rerender con los mismos ids. Estas reproducciones no cambian RLS: el 403 es una respuesta simulada.

**Corrección recomendada:** contar la selección independientemente de la disponibilidad del precio; distinguir total completo de carga/error, permitir recuperación explícita y controlar respuestas obsoletas. Añadir pruebas de 403, 5xx y error de red, incluyendo recuperación sin añadir un id distinto.

## F4-04 · P2 · El precio confirmado en una página se pierde al salir de ella

Ubicación: ambas barras, estado extras y resolución entre datos de la página y extras. Reproducido en Producto.

extras guarda el primer precio consultado por id y nunca incorpora los valores más nuevos recibidos por la página. Mientras el producto está visible se usa su precio actual; al ocultarlo se vuelve al viejo precio de extras y no se solicita otra lectura porque el id ya existe en el Map.

**Reproducción:** producto seleccionado fuera de la vitrina, consulta por id devuelve S/ 20. Una búsqueda posterior devuelve la misma fila con precio S/ 25: la barra cambia correctamente a S/ 25. Al limpiar la búsqueda regresa a **S/ 20**. Dos consultas iniciales por StrictMode; ninguna consulta adicional tras el cambio. La secuencia simula una actualización legítima de precio sin modificar la BD.

**Corrección recomendada:** reconciliar la caché por id con las filas nuevas y definir su invalidación/refresco. El total no debe volver a un dato anterior solo porque la tarjeta salió de la página. Aplicar el mismo contrato a ambas barras y verificar su ciclo de sesión.

**Regresión requerida:** precio leído fuera de página, actualización confirmada al visitar otra página, salir/volver/limpiar filtro sin regresar al precio viejo; selección sin cambios y sin mezclar respuestas de una sesión anterior.

## Precisiones documentales y límites

- El rollback de ENTREGA-FASE4 propone git checkout -- src y restaurar los dos archivos del CLI del recolector. **No ejecutar esa receta:** revierte una carpeta completa y también cambios aceptados de la ronda previa que no pertenecen a Fase 4. Entregar un parche inverso por hunks propios y una lista explícita de archivos nuevos; conservar los cambios del CLI. Codex no generó ni aplicó un rollback de código.
- Producción tiene aproximadamente 300 productos según el usuario. Los 3.245 productos/3.325 servicios activos son la réplica local. El escenario 300/100 es sintético; 100 servicios no es una cardinalidad confirmada del negocio.
- Los 3.214 productos sin categoría conservan el comportamiento anterior: observación de producto, no una regresión introducida. La decisión de «Sin categoría» puede resolverse aparte sin bloquear estas correcciones.
- La migración utiliza SECURITY INVOKER y no añade RLS ni devuelve las columnas privadas mencionadas. La prueba repetida de RPC se ejecutó como anon; no acredita por sí sola todas las combinaciones de roles de producción. Codex no aplicó la migración en ningún entorno.
- No repetí la suite de fotos/sesión 8/8 ni un cambio real de cuenta. Revisé su código y su informe; sus casos sanos no cubren los fallos de barras reproducidos arriba. No creé cuentas QA ni cambié carritos reales.
- Los snapshots entregados y estado-base-original.json no equivalen a una comparación de toda la base de datos. La igualdad de los conteos de activos no acredita todos los campos, bitácoras, usuarios o tablas. No afirmar restauración «exacta» de toda la BD con esa evidencia.
- Las métricas son laboratorio Vite/Chromium, CPU 4×, red local e imágenes PNG 1×1; no son INP/LCP de usuarios ni mediciones de Cloudflare. Las tareas de montaje de 250–410 ms quedan como observación abierta; no las atribuyo a la búsqueda rápida ya verificada.
- No repetí build, migraciones ni suites de fases anteriores. No hubo commit, push, despliegue ni cambios de hosting. Fase 5 no iniciada.

## Evidencia y próximo paso

Evidencia nueva: .codex/evidencia-revision-fase4-v1/ con interfaz.json, codex-replica.json, diagnosticos.json, verificacion.json y fuente diagnóstica como .txt. Los resultados positivos y las reproducciones nuevas están separados.

Claude debe corregir F4-01 a F4-04, añadir regresiones equivalentes y precisar el rollback. Luego entregar diff y resultados para una nueva revisión local. No pedir ni aplicar migración de producción ni iniciar Fase 5 con este veredicto.
