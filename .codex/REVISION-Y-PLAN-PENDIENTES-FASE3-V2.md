# Fase 3: revisión de pendientes y ejecución conjunta — V2

Fecha: 10 de octubre de 2026. Codex, QA de solo lectura. Rama de referencia: `feat/cloudflare-pages`, commit `d16d816f4d64cde80c230092126ed8204c6ce0e9`.

**Podemos trabajar todos los frentes como un paquete coordinado. No están todos resueltos.** En esta sesión se completaron lecturas de métricas, procesamiento local de una muestra del usuario y diagnóstico del recolector sin borrar. Los ensayos remotos adicionales requieren fixtures y autorización acotados; la implementación y las instalaciones corresponden a Claude según AGENTS.md. Codex los revisa y prueba dentro del alcance autorizado.

**Actualización V2:** incorpora la decisión de bloquear el enlace antiguo tras el borrado (§4). Las métricas y pruebas locales de la revisión anterior se conservan como evidencia de A; todavía no se ha activado ni medido B en Cloudflare. Esta versión sustituye al plan anterior para preparar los próximos pasos.

## 1. Lectura real de CPU, solicitudes y R2

### Cuenta y Worker

- Cuenta Workers & Pages: **1.015 / 100.000 solicitudes hoy**, aproximadamente **1,015 %**. El panel de Workers muestra **$0,00 de uso facturable** en el periodo mostrado, 10 oct.–10 nov. Esto no es una proyección ni una factura de todos los productos.
- Worker `pos-jaise-medios-staging`, últimas 24 h y todas las versiones: **855 invocaciones**, **0 errores**; versión activa `6d4cd0cc`, mediana de CPU **1,97 ms**.
- Gráfica de CPU del Worker: **p50 1,88 ms; p90 2,50 ms; p99 3,06 ms; p99,9 3,08 ms**. Cero errores registrados por CPU/memoria. Son agregados de autenticación, inventario, pruebas y subidas, no un benchmark exclusivo de PUT ni de archivos al límite.
- Wall time de esa gráfica: p50 305 ms, p99 828 ms. No confundirlo con CPU; las esperas de red no consumen el presupuesto de CPU de la misma forma.

Workers Free tiene límite de CPU de 10 ms por petición y 100.000 peticiones diarias. Las solicitudes a Pages Functions comparten la cuota de Workers; los assets estáticos que no invocan Functions quedan fuera. Fuentes verificadas: [límites Workers](https://developers.cloudflare.com/workers/platform/limits/) y [Pages Functions](https://developers.cloudflare.com/pages/functions/pricing/).

### Pages Preview: lectura con observación de unidades

La vista Preview, últimas 24 h, muestra **160 solicitudes exitosas y 0 errores**, incluidos cero errores de CPU/memoria. B continúa desactivada.

La gráfica «Median CPU Time» muestra literalmente p50 `2,020`, p75 `2,907`, p99 `8,760` y p99,9 `9,346`; la representación accesible contiene valores 2020, 2907, 8760 y 9346, pero el eje de la captura lleva `ms`. La gráfica de duración también utiliza una escala distinta a la del Worker. **No convierto estas cifras automáticamente a 2,020/8,760 ms ni a 2.020/8.760 ms: la unidad/normalización debe confirmarse con una exportación o consulta de analytics autorizada antes de comparar Pages con el límite.** Se conserva la captura y el texto originales. No declarar aprobada la CPU de B a partir de esta vista.

Los percentiles agregados tampoco describen exclusivamente el último deployment ni las rutas GET/HEAD/MISS/HIT. La documentación explica el muestreo y que ciertos percentiles pueden superar límites sin generar errores; ver [métricas de Pages](https://developers.cloudflare.com/pages/functions/metrics/).

### R2

Bucket Standard `pos-jaise-medios-staging`, vista de 24 h:

- Tamaño actual del bucket: **0 B**.
- Tarjetas superiores: **626 operaciones clase A y 375 clase B**.
- Gráficas: 620 A y 373 B; conservar ambas lecturas y sus diferencias de agregación/actualización, sin tratar estos valores como el consumo mensual exacto de la cuenta.
- «Data Retrieved» muestra 0 B/sin datos. No significa que las lecturas de fotos probadas no ocurrieran.
- Acceso público de pruebas todavía habilitado.

R2 Standard incluye 10 GB-mes, 1 millón de operaciones A y 10 millones B mensuales. Los contadores de un bucket en 24 h no prueban por sí solos el saldo de la franquicia mensual de toda la cuenta. [Precios y franquicia oficial](https://developers.cloudflare.com/r2/pricing/).

**Conclusión:** lectura y cuota actual documentadas, sin alarma de volumen observado; no basta para aprobar B ni carga de producción. Un HIT de la Function sigue contando como petición. Con B, verificar R2 en HIT agrega lecturas aunque se conserve la copia del cuerpo. Medirlo para validar el contrato estricto elegido en §4.

## 2. Fotos proporcionadas: prueba local terminada

El usuario proporcionó `C:\Users\jdeos\OneDrive\Pictures\MINECRAFT`. Contiene 46 PNG. Se tomaron **30 muestras distribuidas por peso**, incluyendo extremos; originales entre 7.463 y 1.361.468 bytes. Son capturas arbitrarias, no fotos reales del catálogo.

Se ejecutaron sin modificar las funciones `procesarImagen` y `miniaturaDe` extraídas de las fuentes existentes, en Chromium aislado, sin solicitudes externas ni subidas. Configuraciones de los llamadores actuales:

| Flujo | Tope detalle / calidad | Máximo detalle | Máximo miniatura | Máximo tiempo local de la combinación |
|---|---|---|---|---|
| Producto | 600 px / 0,8 | 42,3 KiB | 14,7 KiB | 59,5 ms |
| Servicio | 900 px / 0,85 | 87,3 KiB | 15,5 KiB | 91,3 ms |
| Galería | 1400 px / 0,85 | 141,8 KiB | 16,2 KiB | 146,8 ms |

Resultado: **90 combinaciones, 180 variantes WebP decodificadas y aceptadas por el validador estructural del Worker**. No se ampliaron imágenes pequeñas. Ninguna miniatura superó 80 KiB ni detalle 250 KiB. Estos tiempos son del escritorio, no del S23 ni CPU de Cloudflare; no se evaluó sistemáticamente la legibilidad de texto/calidad visual.

Esto completa una muestra técnica más amplia. **La aceptación de fotos reales de catálogo queda pendiente hasta disponer de ellas**, especialmente fotos con pelo/texturas, rostros, etiquetas y letras pequeñas. No se subió ningún archivo de esa carpeta ni se modificaron originales.

## 3. Navegadores y S23 Ultra

- Chromium está instalado y usado para la muestra local.
- Firefox y WebKit de la versión actual de Playwright **no están instalados**. Tampoco se encontró Firefox en las dos ubicaciones habituales de Program Files. No se instalaron programas ni se cambiaron dependencias.
- El usuario dispone de **Samsung S23 Ultra**, útil para Android físico. Falta la ejecución en el teléfono y anotar versiones de Android/Chrome/Samsung Internet. Emulación de viewport no sustituye esa prueba.
- WebKit automatizado en Windows **no equivale a Safari/macOS/iOS físico**. No hay dispositivo Apple indicado. Dejar esa cobertura pendiente o pedir una excepción explícita al alcance de lanzamiento; no inventar una prueba de Safari ni exigir comprar un dispositivo.

**Paquete que Claude puede preparar localmente:** usar la versión ya fijada de Playwright, obtener sus navegadores oficiales sin cambiar versiones del proyecto, y recorrer con fixtures ficticios idénticos la subida WebP, lectura mixta, reemplazo, borrado, errores/reintentos y guardado pendiente. Conservar la red restringida a staging y salidas nuevas en `.codex`. Codex revisará el script antes de escrituras remotas.

**Guía breve para el S23:** abrir https://feat-cloudflare-pages.pos-jaise.pages.dev en Chrome; anotar versión, orientación, scroll y carga de Inicio/Servicios/Productos. Para la prueba con fotos, coordinar primero los fixtures de staging y la cuenta QA, sin enviar contraseña por chat. Comprobar elegir foto desde el teléfono, previsualizar, guardar, verla en cliente, reemplazar y retirar; cerrar sin borrar registros ajenos. Repetir lectura en Samsung Internet si está disponible. La parte que escribe no está ejecutada ni autorizada por esta guía.

## 4. Decisión vigente: bloquear el enlace antiguo tras borrar

**Decisión del usuario, 10 de octubre de 2026 (resumen):** bloquear también el enlace antiguo después del borrado. Esta decisión sustituye el pendiente de selección A/B del informe anterior. Se registra como requisito del proyecto; Codex no la atribuye a una consulta ya realizada a la clienta.

**Contrato que Claude debe preparar:** tras confirmar el borrado del objeto en R2, una nueva petición al enlace antiguo de la foto —miniatura m y detalle g, GET o HEAD, incluso con If-None-Match— no debe entregar bytes antiguos ni un 304 que permita reutilizarlos. Objeto ausente: 404 no-store; imposibilidad de comprobar R2: 503 no-store, sin servir la copia vieja. Una petición iniciada antes del borrado puede terminar; las copias ya descargadas o mostradas no se borran a distancia.

- **B pasa a ser requisito para el hosting definitivo de estos medios.** Preparar y verificar primero su activación en staging y adaptar la prueba de retirada. A deja de ser la política propuesta para producción. La existencia de B en local no equivale a tenerla activada: el commit actual d16d816 aún contiene REVOCAR_CON_R2=false.
- Conservar la separación de políticas: navegador max-age=0,must-revalidate, borde con TTL positivo, ETag y errores no-store. Reutilización condicional solo da 304 cuando el objeto sigue existiendo y el ETag coincide.
- **Cubrir los accesos alternativos.** Inventariar r2.dev, alias e inmutables que sirvan /medios. Activar B en el alias nuevo no modifica la lógica de deployments antiguos con A. Proponer una transición que cierre los accesos que eludan la revocación, después de comprobar referencias y conservar un rollback compatible; no borrar deployments ni deshabilitar accesos en esta sesión.
- **r2.dev no debe quedar como vía pública alternativa en el hosting definitivo.** Migrar o comprobar previamente las URLs completas de Galería que lo usen y el plan de reversión. Quitar su base de las variables de reconocimiento no deshabilita el acceso público del bucket. Las copias con immutable de un año ya entregadas no desaparecen retroactivamente al cambiar esa configuración.
- Si un borrado falla o queda en el diario de pendientes, la interfaz debe informarlo y no afirmar que el enlace ya está bloqueado. B verifica existencia en R2: no puede revocar un objeto que sigue existiendo por un DELETE fallido. Si se exige revocar incluso antes de completar ese DELETE, Claude debe proponer revocación del lado del servidor independiente del borrado físico; no asumir que ya existe.
- URLs de Supabase Storage o assets estáticos quedan fuera de la Function R2. Si también se incluyen en la promesa de retirada, inventariarlos y verificar su contrato antes de extender esa garantía. No trasladar una garantía de B a otro proveedor sin pruebas.

**Pruebas necesarias:** calentar caché, borrar, confirmar ausencia y comprobar inmediatamente GET/HEAD y condicionales en ambas variantes; repetir sobre los orígenes permitidos. El reemplazo debe bloquear la URL vieja y conservar la nueva. Cubrir fallo de head, dos POP cuando sean accesibles, petición en vuelo, borrado incompleto y conservación de objetos aún referenciados. Los 27/27 anteriores aceptaban A y su HIT retenido: siguen válidos para aquel alcance, no prueban este contrato nuevo.

Medir CPU, latencia y operaciones R2 con B y carga representativa; los números obtenidos con A no aprueban B. El dominio propio sigue opcional y futuro. La decisión fija el comportamiento deseado; no es una orden de cambiar ahora Cloudflare, publicar, eliminar recursos o escribir datos. Claude prepara la implementación/ensayos, Codex revisa y las acciones externas se autorizan con alcance concreto.

## 5. Carga y concurrencia: preparar un único ensayo acotado

Todavía no se hizo carga real con objetos existentes. El bucket vacío no sirve para acreditar HIT bajo carga; un ensayo de 404 no sustituye ese objetivo.

Propuesta para que Claude implemente y Codex revise antes de autorizar:

1. Preflight de build/entrega, backend, clave pública, rol QA y estado inicial, sin escritura ante cualquier discrepancia.
2. **2 grupos ficticios propios, 4 PUT** en R2 de staging; sin filas del negocio. Usar imágenes sintéticas, no publicar la carpeta personal del usuario.
3. Lecturas GET/HEAD/condicionales, fases fría y caliente, niveles de concurrencia **1, 5 y 10** y tres muestras. Tope total **450 lecturas y 10 peticiones simultáneas**, sin martilleo de Auth ni backend del negocio. Registrar bytes, ETag, HIT/MISS, POP, errores y p50/p95/p99 de latencia cliente.
4. Parar ante 429/5xx repetidos, error de CPU, tráfico ajeno, discrepancias de bytes o snapshot, sin aumentar la carga automáticamente.
5. Borrar únicamente los dos grupos propios y confirmar inventario inicial. El ensayo del contrato nuevo con B debe exigir 404 inmediato para solicitudes posteriores al DELETE confirmado, incluidas las condicionales: no aceptar el HIT retenido que admitía A. Si la limpieza falla, evidencia incompleta y pendiente explícito.
6. Leer las métricas de Cloudflare antes/después y distinguir CPU de latencia. Los agregados de 24 h no atribuyen automáticamente el costo a ese ensayo. Preparar primero el alcance de despliegue/medición de B, revisado y autorizado en staging. Comparar A/B si es útil, pero la aceptación final de retirada debe usar B.

Este diseño no es una herramienta implementada/aprobada para escribir. No ejecutarlo aún ni contratar un plan de pago para la prueba.

## 6. Recolector: diagnóstico real de lectura terminado

Se usó el código actual `crearFuentes` y `recolectar` con **`aplicar:false`, retención 14 días**, detrás de una guarda que bloquea PUT/PATCH/DELETE y cualquier POST distinto del login QA exacto de staging. Se leyeron conteos y las cinco tablas de referencias, e inventario de los tres destinos.

Resultado: **0 referencias R2, 0 objetos, 0 candidatos, 0 errores, 0 eliminados**. Una autenticación QA, 8 GET y 5 HEAD. No se borró ni programó nada. Ejecutar `--aplicar` con ese inventario vacío tampoco demostraría un borrado operativo.

Para completar el ensayo destructivo sin riesgo para contenido ajeno, Claude debe preparar un harness que **limite las fuentes a UUID propios previstos antes de subir**, cree una fila QA propia que proteja un grupo y deje otro sin referencia, pruebe el borrado selectivo y confirme el estado inicial. Si se usa un reloj simulado para no esperar 14 días, dejarlo exclusivo del harness y declarar que no verifica el envejecimiento real en Cloudflare; no acortar la retención del recolector habitual ni exponer un override a producción. Las pruebas locales existentes siguen cubriendo retención de recientes y abortos ante dudas.

La ventana entre consulta puntual y DELETE sigue vigente. Operación habitual: catálogo sin ediciones o coordinación más fuerte preparada por Claude; **no programar el recolector de producción todavía**. Evaluar además la salida del CLI: actualmente puede terminar con exit 0 aun cuando el informe contenga `errores` o `abortado`; un scheduler no debe equiparar exit 0 con limpieza completa. Esto es una condición para su automatización futura, no un cambio aplicado en esta sesión.

## 7. Reversión general: falta un artefacto operativo

**Condición nueva del rollback:** preservar el bloqueo del enlace antiguo. Un retorno a r2.dev público o a una Function antigua con A no es compatible con la decisión de §4. Conservar un build de lectura mixta que utilice la entrega controlada con B, o demostrar un contrato equivalente en el proveedor de destino. El ensayo histórico Pages→r2.dev no autoriza reabrir ese bypass en el hosting definitivo.

El ensayo aprobado de Galería Pages→`r2.dev` cubre solo esa transición de URLs. No es una migración general R2→Supabase ni garantiza que el `main` antiguo lea referencias nuevas.

Hay dos alternativas válidas; Claude debe preparar la elegida y Codex comprobarla:

- **Build de reversión con lectura mixta:** detener subidas nuevas a R2, pero conservar lectores `r2:`, base pública y Function/binding mientras haya referencias. El helper actual lee R2 independientemente del proveedor de nuevas subidas si conserva la base correcta. Preparar un artefacto desde commit exacto y probar las cinco ubicaciones de referencia, variantes y URLs de Galería. Una mera constante del helper no acredita un build de rollback desplegable.
- **Migración inversa de datos/archivos:** manifiesto previo con tabla/id/columna, referencia antigua/nueva y SHA-256; copiar/verificar bytes antes de cambiar filas; actualización condicionada a la referencia anterior, reintentos/reconciliación, conservación de originales R2 y restauración por manifiesto. Probar solo fixtures propios de staging y todas las ubicaciones (productos, producto_fotos, servicios, servicio_fotos, galeria_web). No borrar originales ni aplicar sobre el negocio.

Para avanzar rápido, recomendaría preparar primero el build de lectura mixta: satisface la condición de rollback compatible sin obligar a copiar todas las fotos de vuelta. La elección y su aceptación deben quedar explícitas, no rotular como hecha una migración que no existe.

## 8. Ejecución agrupada y autorizaciones

Preparar juntos los scripts de navegadores/carga/recolector y el artefacto de rollback, validarlos localmente y revisarlos como un paquete. **No hacer un push por cada informe.** La evidencia de esta sesión y las notas ya pendientes pueden agruparse con un próximo cambio útil revisado.

El permiso anterior cubrió las dos corridas específicas caché/UI sobre d16d816f. La solicitud actual de abordar todos los frentes no fija los UUID/objetos/filas de un nuevo borrado ni autoriza publicar fotos personales. Antes de escrituras, borrados, nueva publicación o cambios de acceso, presentar el alcance exacto para una autorización agrupada. No pedir tokens ni datos de tarjeta para estos ensayos.

| Frente | Estado al terminar esta sesión |
|---|---|
| Lectura de uso/cuenta/Worker/R2 | Hecha, agregados documentados; unidades Pages con observación |
| Muestra técnica de imágenes | Hecha localmente: 30 capturas, 90 combinaciones, 180 variantes válidas |
| Fotos auténticas del catálogo | No disponibles; pendientes |
| Firefox / Safari / S23 | Preparación e inventario hechos; instalación/prueba y Apple pendientes |
| Retirada de producción / r2.dev | Decisión del usuario definida: bloquear enlace antiguo; preparar B y cierre de bypass, sin cambios externos todavía |
| Carga real con imágenes | Protocolo acotado; script y autorización pendientes |
| Recolector | Lectura hecha; ensayo de eliminación y automatización pendientes |
| Rollback general | Alternativas y criterios definidos; artefacto/ensayo pendientes |

No se modificó código, configuración, dependencias, `.env`, Git, Cloudflare ni datos. Los originales de la carpeta personal permanecen intactos y no se transmitieron a servicios externos. Solo se generan este informe y evidencia de QA fuera del código y en `.codex`, conforme a la instrucción del usuario.
