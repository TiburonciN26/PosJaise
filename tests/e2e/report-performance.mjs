import {readFile,writeFile} from 'node:fs/promises';
const root='C:/WedJaiseReact',dir='tests/e2e/results/performance/';
const read=n=>readFile(dir+n+'.json','utf8').then(JSON.parse);
const [desktop,mobile,tablet,routes,production,aux,writes,updates,images]=await Promise.all(['catalogs-desktop','catalogs-mobile','catalogs-tablet','routes','production','aux','writes','updates','images'].map(read));
const round=n=>n==null?'—':Math.round(n);
const range=values=>`${round(Math.min(...values))}–${round(Math.max(...values))}`;
const link=(file,line)=>`[${file}](${root}/${file}${line?':'+line:''})`;
const issueURLs={
  'QA-020':'https://app.notion.com/p/3edf27109e6a81268400df6bb0d19170',
  'QA-021':'https://app.notion.com/p/3edf27109e6a8156b9fef7cb91be645d',
  'QA-022':'https://app.notion.com/p/3edf27109e6a81e0bbe1d0511bfec5a4',
  'QA-023':'https://app.notion.com/p/3edf27109e6a8124bdeaefce568dd181',
};
const catalogRows=[['1440×900',desktop],['768×1024',tablet],['390×844',mobile]].flatMap(([size,r])=>['/productos','/servicios'].map(path=>{
  const normal=r.samples.filter(s=>s.path===path&&!s.reduce),reduced=r.samples.filter(s=>s.path===path&&s.reduce);
  return `| ${size} | ${path} | ${range(normal.map(s=>s.cardsDom))} | ${range(normal.map(s=>s.cardsVisible))} | ${range(reduced.map(s=>s.cardsVisible))} |`;
})).join('\n');
const routeRows=routes.samples.map(s=>`| ${s.role} | ${s.path} | ${s.label==='return'?'vuelta':'primera muestra'} | ${s.routeMode==='UI link'?'enlace UI':'documento¹'} | ${round(s.settledContentMs)} | ${s.apiResponses.length} |`).join('\n');
const prodRows=production.samples.map(s=>s.phase==='cold-login'?`| ${s.role} | ${s.slow?'limitado':'local'} | Login, primer contenido | ${round(s.metrics.paint.find(p=>p.name==='first-contentful-paint')?.start)} | — |`:`| CLIENTE | ${s.slow?'limitado':'local'} | ${s.path}, primera tarjeta | ${round(s.visibleMs)} | ${round(s.domMs)} |`).join('\n');
const writeRows=[...writes.operations,...updates.operations].filter(o=>o.status).map(o=>`| ${o.name} | ${o.status} | ${round(o.responseMs)} | ${round(o.feedbackMs)} |`).join('\n');
const latency=routes.samples.flatMap(s=>s.apiResponses.map(r=>r.headersReceivedMs)).sort((a,b)=>a-b);
const imageResources=images.resources.filter(r=>!r.mobile);
const imageRows=imageResources.map(r=>`| ${r.path.replace('/storage/v1/object/public/','Storage/')} | ${r.bytes.toLocaleString('es-PE')} | ${r.cache??'—'} |`).join('\n');
const summary={date:'2026-10-01',environment:'Supabase Local TEST http://127.0.0.1:54321',routes:{observations:routes.samples.length,roles:Object.fromEntries(['ADMINISTRADOR','CAJERA','ASISTENTE','CLIENTE'].map(role=>[role,routes.samples.filter(s=>s.role===role).length])),errors:routes.errors},catalogObservations:24,productionObservations:production.samples.length,auxObservations:aux.samples.length,imageObservations:images.samples.length,pooledLocalApi:{count:latency.length,medianMs:latency[Math.floor(latency.length/2)],p95Ms:latency[Math.floor(latency.length*.95)]},issues:issueURLs,stock:writes.stock,testData:{prefix:writes.prefix,sales:[writes.priorSale?.codigo,writes.sale.codigo],products:writes.products,services:writes.services,deleted:updates.records},limitations:['Local rather than deployed network/database.','Headless Chromium, external fonts and service workers blocked.','Low sample counts and small TEST catalogue; no load capacity SLA.','Route DOM markers are not LCP/INP; direct-document markers begin after DOMContentLoaded.']};
await writeFile(dir+'summary.json',JSON.stringify(summary,null,2));
const report=`# Auditoría de rendimiento — POS y portal Web

Fecha: 1 de octubre de 2026. Rama testing. Supabase Local TEST **http://127.0.0.1:54321**, verificado desde el módulo efectivo de Vite antes de escrituras. Orígenes externos bloqueados, cuentas ficticias QA e inicio de sesión mediante formularios normales. Aplicación y configuración sin correcciones.

## Resultado principal

La espera señalada en Productos/Servicios tiene una causa medida: una secuencia de animación mantiene transparentes tarjetas que ya existen. En escritorio, Productos crea la primera tarjeta alrededor de 88–100 ms, pero empieza a mostrarla a 1744–1761 ms. Servicios: 92–100 ms frente a 1234–1266 ms. La preferencia de movimiento reducido elimina esa espera sin editar código. La versión optimizada reproduce el retraso: 1745/1217 ms respectivamente. Se puede conservar una animación breve y mostrar antes contenido útil.

También hay una dependencia de contacto/horario que retrasa el catálogo, carga inicial de JS que incluye páginas todavía no utilizadas y fotos inferiores descargadas antes del scroll. No se encontró evidencia de una base local constantemente lenta: las ${latency.length} respuestas REST observadas tuvieron mediana ${round(summary.pooledLocalApi.medianMs)} ms y percentil 95 ${round(summary.pooledLocalApi.p95Ms)} ms hasta recibir encabezados. Son muestras agrupadas de lecturas locales, con efectos de desarrollo; no equivalen a tiempos del servicio publicado ni a capacidad bajo carga.

## Alcance y método

- 24 páginas principales POS y 18 páginas del portal CLIENTE. 55 observaciones de navegación: ADMINISTRADOR 24 páginas + 5 vueltas; CAJERA 6; ASISTENTE 2; CLIENTE 18. Todas terminaron con contenido, sin main detenido en Cargando ni HTTP Supabase ≥400/pageerror en ese lote.
- 24 comparaciones de catálogos: dos entradas por página × dos preferencias de movimiento × escritorio/tablet/móvil. Cinco observaciones POS adicionales en pos-focus.json resolvieron capturas prematuras del cargador del instrumento.
- Build optimizado del proyecto y ocho observaciones en preview: cuatro aperturas frías de login y cuatro cambios a catálogos, con red/CPU normales o limitadas artificialmente. No se desplegó el build.
- Ocho observaciones para aislar contacto lento; tres productos y tres servicios ficticios creados; edición y eliminación de un ejemplar propio sin movimientos de cada tipo; dos ventas y anulaciones; recargas y stock; cuatro observaciones de imágenes en Inicio/detalle de producto.
- PerformanceObserver para tareas largas/paint/CLS; rAF para intervalos; marcas DOM/estilos a aproximadamente 16 ms. Tarjeta visible significa opacity de sus ancestros ≥0.05, no final de la animación ni LCP. Las capturas muestran el estado al finalizar cada muestra.
- Las pruebas de rendimiento se ejecutaron secuencialmente. Los primeros borradores con navegación mal sincronizada o carga simultánea se excluyen. No se exportaron sesiones, HAR ni tokens.

## Catálogos: separar carga de revelado

Rangos de dos observaciones por combinación, en milisegundos:

| Viewport | Página | Primera tarjeta en DOM, normal | Empieza a mostrarse, normal | Empieza a mostrarse, movimiento reducido |
|---|---|---:|---:|---:|
${catalogRows}

En tablet/móvil el clic automatizado incluye aproximadamente 350 ms de espera de estabilidad del menú; ambos grupos tienen esa condición. La diferencia entre normal/reducido identifica el retraso de revelado. El breakpoint propio de animación es 1024 px: 768 px utiliza la secuencia compacta. La comparación no modifica la preferencia real del navegador del usuario.

Fuente: ${link('src/pages/cliente/ProductosCliente.jsx',72)}, ${link('src/pages/cliente/ServiciosCliente.jsx',68)}, ${link('src/index.css',2455)} y ${link('src/hooks/useRevelarEnPantalla.js',34)}. Productos acumula 1500/1600 ms de fila +120 ms de tarjeta +90 ms de escalonado; Servicios 1000/1050 +120 +90. El CSS aplica fill-mode:both, opacity inicial cero, desplazamiento y desenfoque. Al salir y volver, las rutas CLIENTE se montan de nuevo y repiten la secuencia.

## Build optimizado y conexión limitada

| Rol | Condición | Medida | Tiempo ms | Tarjeta en DOM ms |
|---|---|---|---:|---:|
${prodRows}

Condición limitada: latencia artificial 150 ms, descarga 1.6 Mbps, subida 750 kbps y CPU 4x más lenta; viewport 390×844. La comparación combina red/CPU/tamaño y no permite atribuir todos sus cambios a una sola variable. Es una simulación sobre servidor local, no medición de un teléfono físico ni GitHub Pages. En login se midió FCP del documento; no se presenta como tiempo del formulario completamente listo ni de finalización de autenticación.

Archivo inicial index-BLshSQRs.js: **1.002.616 bytes decodificados**; gzip estimado del build 269.90 kB. El preview sirvió gzip y se observó transferSize 268.230 bytes para ese archivo. El total JS observado al abrir login fue **278.717 bytes** en las cuatro aperturas, incluyendo pequeños módulos adicionales. En la condición limitada su descarga tardó aproximadamente 1.67–1.70 s y hubo una tarea de 215–216 ms. No es una medición de INP real.

${link('src/App.jsx',8)} importa estáticamente las páginas del cliente. ${link('src/components/PestanasCacheadas.jsx',16)} ya divide las páginas secundarias del POS. El scanner de aproximadamente 481 kB pertenece a otro módulo; no se atribuye su tamaño a la descarga inicial de login. Evaluar división del portal por rutas/rol puede reducir descarga/parseo crítico usando [React.lazy](https://react.dev/reference/react/lazy).

La PWA genera 70 entradas de precaché, aproximadamente 2404 KiB, según build.log. El worker fue bloqueado para comparar contextos limpios: **no se midieron instalación, actualización ni repetición con caché PWA**. Antes de optimizar división de código, revisar cómo el precaché de ${link('vite.config.js',40)} descarga assets en segundo plano. Preservar que las consultas de negocio no se sirvan desde una caché obsoleta.

## Dependencia de contacto y horario

Con movimiento reducido, control Productos 88–167 ms y Servicios 83–107 ms hasta primera tarjeta. Al retener sólo la petición de lectura datos_contacto durante 1000 ms: Productos 1084–1157 ms y Servicios 1085–1092 ms. GET productos/servicios seguía llegando aproximadamente en 7–12 ms. Reproducido dos veces por catálogo; no se devolvieron errores ni se alteraron datos.

Ambos catálogos agrupan todo en Promise.all antes de quitar la carga. El pie vuelve a pedir contacto/horario: ${link('src/pages/cliente/PieClienteWeb.jsx',19)}. Separar la carga principal y reutilizar datos secundarios evita que una respuesta secundaria lenta o su repetición decida cuándo aparece la lista. StrictMode duplica efectos en desarrollo; los conteos del lote dev no se interpretan como conteos de producción.

## Guardado, edición y actualización

Tiempo desde invocar clic hasta respuesta leída/terminada y feedback del formulario o confirmación, incluyendo esperas de interacción del instrumento; no es tiempo puro de SQL. Milisegundos:

| Operación ficticia | HTTP | Clic → respuesta | Clic → feedback |
|---|---:|---:|---:|
${writeRows}

Los productos se localizaron después de recargar y los tres servicios también se comprobaron tras carga nueva. Producto 3 y Servicio 3 fueron editados, sus precios persistieron tras recargar y después se eliminaron por UI al no tener movimientos. Permanecen dos productos y dos servicios de esta muestra, incluida la foto del Producto 1.

Ventas **${writes.priorSale.codigo}/${writes.sale.codigo}**, ambas de dos unidades por S/2 con CAJERA, terminaron ANULADA. Producto 1: **10 − 2 = 8; anulación devuelve 2 → 10**, verificado en inventario tras recargas. El diálogo de impresión automático es esperado y no se cronometró ni se registró como problema. Nunca se repitió la confirmación de una misma venta.

La consulta por código utilizó VEN completo debido a QA-013 ya conocido. La primera anulación respondió correctamente HTTP204 sin cuerpo; el primer script intentó JSON y se detuvo. Se comprobó primero la anulación/stock persistentes, después se ejecutó otro ciclo TEST para recuperar la medición pendiente. Esto fue un error del instrumento, no una incidencia de la aplicación.

Volver al inventario, filtrar el nombre y comprobar stock tomó aproximadamente 1.58–1.63 s en tres observaciones. Incluye navegación, montaje de página, búsqueda y su debounce: **no significa que actualizar stock tarde 1.6 s en la base**. No se midieron todas las escrituras de los otros módulos ni autoactualización entre dos equipos abiertos.

## Imágenes

PNG sintético TEST de 2400×1800: **5.305.168 bytes → WebP 600×450 de 78.016 bytes**. La preparación/preview de la imagen tardó aproximadamente 721 ms; incluye seleccionar archivo y observar feedback, separado del guardado. Imagen servida correctamente en el detalle CLIENTE de escritorio y móvil. La conversión y caché de Storage funcionan: ${link('src/lib/imagenes.js',17)}. Las tarjetas de producto/servicio reservan proporción y utilizan loading lazy, aspecto positivo.

| Recurso observado, escritorio | Bytes de cuerpo | Cache-Control |
|---|---:|---|
${imageRows}

Antes de hacer scroll, Inicio tenía ocho elementos img completos en ambos tamaños. Cuatro WebP exclusivos de la galería inferior sumaron **332.684 bytes**, estando fuera del viewport y con loading auto. Las dos referencias JPEG se reutilizan en hero/galería; sus **203.747 bytes** no se cuentan dos veces. Se descargaron 1680×944 tanto a 1440 como a 390 px, sin srcset; variantes por tamaño son una oportunidad adicional. El JPG de 500.645 bytes existente en public no apareció entre estas solicitudes y no se atribuye a esta carga.

Storage tardó aproximadamente 9–24 ms en estas lecturas locales. ResourceTiming muestra bytes cero por restricción cross-origin; los tamaños de esta tabla vienen del body real de respuesta y no de ese cero. Los JPEG estáticos llevan no-cache en Vite dev; no se extrapola esa política al alojamiento publicado.

Diferir galería inferior y servir variantes puede disminuir el consumo inicial; mantener imágenes críticas del hero inmediatas. [Guía de carga diferida de imágenes](https://web.dev/articles/browser-level-image-lazy-loading).

## Fluidez, renderizado y crecimiento

En las doce muestras de animación normal de catálogos, la mediana de intervalos rAF fue aproximadamente 16.7 ms, p95 16.7–16.8 ms, sin intervalos >33.4 ms en esas ventanas. CLS observado fue 0 en las 24 comparativas. Esto indica ausencia de pausas grandes del bucle observado bajo esas condiciones, **no certifica 60 FPS pintados ni fluidez GPU en móviles**. Las muestras tenían pocos registros y muchas tarjetas sin foto.

El lote completo de rutas tuvo 26 tareas largas repartidas en la navegación/desarrollo; no se atribuyen todas a animaciones ni a una sola causa. Bajo CPU/red limitadas, Productos tuvo tareas de 267/103 ms. Revisar desenfoques y evitar trabajo fuera de pantalla; priorizar transform/opacity y usar will-change sólo si el perfil lo justifica. [Guía de animación eficiente](https://web.dev/articles/animations-guide).

El POS preserva páginas visitadas montadas/ocultas: tras recorrer diez rutas en una sesión se observaron hasta **8983 nodos DOM**. Es un coste de conservar estado, no evidencia de fuga de memoria. Las navegaciones por documento reiniciaron ese conjunto. Conviene medir memoria/CPU de una jornada larga antes de reducir caché o introducir virtualización. Inventario pagina de 50 en 50; Servicios y catálogos descargan listas más amplias y metadatos completos. Con 45 productos y 37 servicios antes de esta muestra no se demostró un problema de capacidad; faltan tamaños grandes aislados.

Los carruseles usan rAF con transform directo, evitando estado React cada frame; revisar pausa al salir del viewport/pestaña. El hero usa revelado gráfico; su coste GPU no se midió. index.html solicita seis familias de Google Fonts y existe tipografía local adicional; reducir familias/pesos es una oportunidad de revisión, pero **las fuentes externas estaban bloqueadas**, por lo que no se calculó su coste real.

## Matriz de páginas recorridas

Tiempo = primera marca del texto principal que coincide con el contenido final (prefijo de hasta 600 caracteres). Puede incluir actualización de contadores/datos, pero no verifica todos los bloques de la página. Para catálogos usar la tabla específica de revelado. Las marcas genéricas antiguas contentVisible/textReady pueden capturar controles/cargadores transitorios; no se usan como tiempo final.

| Rol | Ruta | Visita | Método | Marca contenido ms | Respuestas REST observadas |
|---|---|---|---|---:|---:|
${routeRows}

¹ Documento: navegación directa segura cuando no se encontró enlace visible; la instrumentación de estas filas comienza después de DOMContentLoaded. **Su tiempo excluye parte de la carga de documento/autenticación y no es comparable a una carga fría completa**. Tampoco comparar estos conteos de requests con páginas ya montadas. Inicio y algunas rutas con cargas múltiples comparten consultas del shell.

## Hallazgos registrados para Claude

| ID | Severidad | Hallazgo | Evidencia |
|---|---|---|---|
| [QA-020](${issueURLs['QA-020']}) | Media | Coreografía de entrada oculta contenido ya cargado | catalogs-desktop/mobile/tablet.json; production.json; PNG |
| [QA-021](${issueURLs['QA-021']}) | Media | JS inicial incluye páginas todavía no usadas | build-size.json; production.json; App.jsx |
| [QA-022](${issueURLs['QA-022']}) | Media | Contacto/horario retrasan catálogo principal | aux.json; Promise.all |
| [QA-023](${issueURLs['QA-023']}) | Baja | Galería inferior descarga fotos fuera del viewport | images.json; InicioCliente.jsx |

Se revisó Notion antes de registrar y se verificaron las cuatro páginas creadas. Todas Pendiente, ninguna corregida. “Verificado” de las incidencias anteriores sigue significando comprobación manual del usuario, no corrección. QA-010 se volvió a observar como NaN en historial CLIENTE; no se duplicó. QA-013 condiciona búsqueda usada. No se reabrieron como nuevas las demás incidencias funcionales conocidas ni la impresión automática.

## Prioridades propuestas, sin implementación

1. **Primero:** acortar/capar retrasos de entrada, mostrar lista/filtros cuando estén listos y evitar repetir la secuencia larga al volver. Mantener una entrada breve paralela, por ejemplo 150–250 ms como punto de partida a validar.
2. **Después:** separar carga crítica/secundaria y compartir contacto/horario. Mantener invalidación de stock, ventas y configuración al guardar. Una caché compartida puede bastar; [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/query-invalidation) ofrece invalidación si se decide introducirla, pero no elimina automáticamente consultas mal agrupadas.
3. **Carga fría:** dividir páginas CLIENTE y shells; revisar el efecto de precaché PWA, fuentes y dependencias antes de cambios de build.
4. **Imágenes:** diferir galería inferior, miniaturas/variantes por tamaño y prioridad de la imagen crítica. La compresión WebP y cacheControl existentes deben conservarse.
5. **Validación posterior:** perfil GPU/dispositivo real para blur/hero/carruseles; jornada POS con pestañas acumuladas; catálogos grandes y concurrencia aislada; retest de las mismas muestras contra un build optimizado.

**No hay evidencia suficiente para justificar migrar React, sustituir Supabase ni contratar otro proveedor.** Las causas confirmadas se pueden tratar con el stack existente. Un CDN/servicio de transformación sólo debería evaluarse después de medir imágenes y red del alojamiento real; SSR/otro framework no elimina retrasos CSS deliberados. No se calcularon costes ni se recomendaron planes de pago.

## Límites y áreas pendientes

No se accedió a producción. Quedan sin medir región/red real de Supabase alojado, TTFB/CDN publicados, fuentes externas, caché/service worker en instalación real, Safari/Firefox, teléfonos físicos/GPU, INP/LCP de usuarios reales, memoria de jornada completa, carga con cientos/miles de registros y muchos usuarios, todas las escrituras por módulo y sincronización automática entre sesiones. No se ejecutó SQL mutante ni un reset masivo. No hay cobertura del 100%, SLA, nota Lighthouse ni afirmación de ausencia de errores.

El frontend es Vite dev en parte de los lotes; StrictMode y módulos de desarrollo afectan tiempos/conteos. Se corroboró la causa principal en el build optimizado. La preferencia de movimiento reducido, retención de lectura, CPU/red limitadas y guardas son exclusivamente opciones de contextos de prueba, no cambios de la aplicación.

Errores del instrumento excluidos: selector de enlace de menú cerrado, muestreo de contenido anterior/cargador antes de terminar navegación, primer lote móvil con otro trabajo simultáneo, preview con base incorrecta para el artefacto y parseo JSON de HTTP204. Archivos con draft en su nombre no sustentan conclusiones; se conservaron los lotes válidos por tamaño. No se registraron como incidencias.

## Artefactos y reproducción

Datos de esta muestra: prefijo **${writes.prefix}**, ventas ${writes.priorSale.codigo}/${writes.sale.codigo} anuladas, stock final 10. Identificadores y registros borrados constan en summary.json/writes.json/updates.json. No se tocaron registros reales ni se modificaron precios/configuración de negocio ajenos a estos TEST.

${link('tests/e2e/results/performance/summary.json')} enlaza los lotes; JSON/PNG/build quedan en results/performance. Scripts QA: performance-audit.mjs, performance-build.mjs, performance-production.mjs, performance-write.mjs, performance-images.mjs, performance-update.mjs y este generador. No se reemplazó el informe funcional de 77 casos ni su baseline.

Para Claude: ejecutar sólo en testing y con el guardado local efectivo. Los modos routes, catalogs, aux y production leen negocio; writes/update crean/modifican/eliminan únicamente sus propios TEST por UI. El build QA escribe únicamente en results/performance/build. El preview debe utilizar ese outDir y base /PosJaise/ explícita en 127.0.0.1:4174; no reutilizar un build de producción ni publicar el artefacto. Cerrarlo al terminar. Las mediciones de navegador deben ejecutarse de una en una. Nuevos writes cambian datos y generan IDs nuevos; no hace falta repetirlos para leer este informe.

Archivos fuente, dependencias, .env, esquema, migraciones, funciones, triggers, RLS y configuración existentes sin cambios de Codex. AGENTS.md ya estaba modificado por el usuario. Cambios propios limitados a tests y documentación autorizados; sin commit, push ni cambio de rama.
`;
await writeFile('tests/e2e/RENDIMIENTO-20261001.md',report);
console.log(JSON.stringify({report:'tests/e2e/RENDIMIENTO-20261001.md',observations:summary.routes.observations,issues:Object.keys(issueURLs)}));
