# Auditoría de rendimiento · POS Jaise y portal web

Fecha: 8 de octubre de 2026 · Entorno local Windows · Estado: auditoría terminada, correcciones propuestas.

**Conclusión:** los nuevos cupones sí son una causa confirmada del retraso, pero se encontraron problemas independientes de listas, carga de datos, arranque y retención de pantallas. Las pruebas finales incluyen la aplicación autenticada y una compilación de producción del estado actual del código.

**Trabajo realizado:** 122 mediciones de navegación/carga, 24 informes Lighthouse (12 con caché conservada y 12 con caché HTTP vacía), 14 trazas de Chrome y 14 perfiles de CPU, comparación de efectos en 5 pantallas, recorridos repetidos y un recorrido de las 27 pestañas del POS, búsquedas/modales/subpestañas, dos temas, reduced-motion, PWA y siete planes SQL de lectura.

**Integridad:** no se modificaron fuentes, dependencias del proyecto, configuración, migraciones ni Git. Lighthouse 13.5.0 se instaló únicamente en esta carpeta de diagnóstico; el build y sus mapas también están aquí. Se crearon y eliminaron cuentas ficticias locales para ADMINISTRADOR, CAJERA, ASISTENTE y CLIENTE. La comprobación final encontró cero cuentas perf-* restantes; el perfil temporal de Chromium fue eliminado. El estado Git mantuvo 137 entradas ya modificadas/no rastreadas.

## 1. Alcance y método

- POS: las 27 rutas definidas en navegacion.js; además, seis rutas con CAJERA y dos con ASISTENTE.
- Portal: diez rutas públicas, veinte variantes/rutas de cliente y detalles reales de producto, servicio y equipo seleccionados desde enlaces de la aplicación.
- Subpestañas: cinco de Recompensas Web, dos de Catálogo Web y las seis de Recompensas del cliente.
- Navegador: Playwright 1.63.0 y Chromium 153.0.8010.12. Escritorio 1440×900; prueba directa móvil 390×844 con CPU 4×.
- Desarrollo en 127.0.0.1:5173; build separado en 127.0.0.1:4173/PosJaise/; Supabase verificado en 127.0.0.1:54321.
- Lighthouse móvil usa su perfil estándar: 412×823, CPU 4× y red simulada de 1.638,4 Kbps / RTT 150 ms. Se conserva la sesión ficticia; para la serie fría se limpia explícitamente la caché HTTP antes de cada navegación. Service workers bloqueados durante el aislamiento de rendimiento y probados por separado.
- El monitoreo registra cuerpos por tamaño/conteo y rutas de API; no exporta contraseñas ni sesiones de usuario. Los 370 fingerprints identifican el estado del código revisado, incluyendo cambios locales: [source-fingerprints.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/source-fingerprints.json).

**Cómo leer las medidas:** readyMs incluye espera de estabilidad de red y unos 350 ms de margen; no es LCP ni tiempo exacto hasta el primer contenido. Los ensayos de interacción incluyen escritura y esperas del conductor: se usan EventTiming y tareas largas para señalar bloqueos, no su duración total como “latencia de clic”. TaskDuration es tiempo de trabajo medido por CDP alrededor de la ventana; incluye sobrecosto de instrumentación y no debe convertirse directamente en porcentaje de CPU del equipo. La cadencia rAF no es FPS físico de GPU. Los commits se cuentan con un hook de diagnóstico, sin atribuir duración individual a componentes. Las trazas tienen eventos anidados: sus duraciones no se suman entre categorías.

**Límites concretos:** estos resultados corresponden al dataset local y al build probado, no a una medición de usuarios reales ni de producción desplegada. Los perfiles nuevos de cliente no tienen historial personal de compras; las listas administrativas sí usan el conjunto local existente. No se hicieron cobros, ventas, migraciones, carga concurrente ni pruebas sobre producción. Las funciones crear-cargo y webhook-pasarela se revisaron estáticamente: sus fetch externos no establecen un timeout explícito, oportunidad de robustez a validar con un proveedor de pruebas; su latencia real no fue medida. No se probó hardware móvil físico ni consumo energético/GPU.

La falta de trazas del informe anterior fue una limitación del acceso diagnóstico del navegador integrado. Esta auditoría la resuelve con Chromium independiente y cuentas ficticias: ahora se entregan trazas reales de las sesiones medidas.

## 2. Resultados decisivos

### Efectos activados frente a detenidos

Mediana de tres ensayos por pantalla, ventanas aproximadas de 2,5 s; intervención temporal en el navegador, sin editar CSS del proyecto.

| Pantalla | Trabajo con efectos (ms) | Con CSS detenido (ms) | Reducción |
| --- | --- | --- | --- |
| /promociones | 2,359.5 | 137.2 | 94.2 % |
| /referidos-web | 2,387.6 | 97.6 | 95.9 % |
| /fidelizacion-web | 1,469.8 | 64.7 | 95.6 % |
| /inicio | 192.5 | 23.2 | 88 % |
| /recompensas?seccion=tarjeta | 257.2 | 237.2 | 7.8 % |

La intervención específica sobre los efectos de cupones corrobora la causa: 3.215,9 → 179,1 ms en unos 4 s. Detener solo el barrido o solo las chispas deja trabajo residual. La tarjeta 3D tiene otra causa, su bucle JavaScript. La recomendación de mover efectos mediante transform/opacity y verificar layout/pintura sigue la [guía de animaciones de web.dev](https://web.dev/articles/animations-guide).

### Búsqueda amplia en catálogos

| Pantalla | Dispositivo simulado | Tarjetas | DOM total | Mayor tarea larga (ms) |
| --- | --- | --- | --- | --- |
| /servicios | Escritorio | 3,322 | 54,960 | 861 |
| /productos | Escritorio | 976 | 19,632 | 274 |
| /servicios | Móvil CPU 4× | 3,322 | 54,960 | 5,644 |
| /productos | Móvil CPU 4× | 976 | 19,632 | 1,787 |

### Lighthouse con caché HTTP vacía

Una ejecución por ruta y perfil; son puntuaciones y LCP de laboratorio. Los informes guardan sus parámetros y no presentan errores de ejecución ni advertencias.

| Ruta / perfil | Escritorio | Móvil | LCP móvil (s) | TBT móvil (ms) | CLS móvil |
| --- | --- | --- | --- | --- | --- |
| /ventas · ADMINISTRADOR | 99 | 90 | 3.28 | 10 | 0.000 |
| /promociones · ADMINISTRADOR | 97 | 68 | 4.27 | 426.5 | 0.109 |
| /recompensas-web · ADMINISTRADOR | 92 | 71 | 9.66 | 16 | 0.000 |
| /inicio · PUBLICO | 91 | 70 | 9.81 | 64 | 0.039 |
| /productos · PUBLICO | 99 | 89 | 2.94 | 180 | 0.000 |
| /recompensas?seccion=tarjeta · CLIENTE | 95 | 74 | 6.02 | 40 | 0.000 |

La serie inicial con caché conservada obtuvo en móvil 100 / 79 / 75 / 78 / 99 / 91, en el mismo orden. Se conserva para comparación, pero la tabla principal usa la serie fría. La nota se calcula a partir de métricas de carga; no resume por sí sola navegación prolongada o animaciones en reposo. [Cómo puntúa Lighthouse](https://developer.chrome.com/docs/lighthouse/performance/performance-scoring).

### Sesiones largas y datos

- 27 pestañas visitadas: 69.547 nodos conservados al volver a Ventas y aproximadamente 53,1 MB de heap JS en el último punto tras GC. Ventas fresca: 369 nodos y aproximadamente 3 MB.
- En el ciclo de cinco rutas, el heap se estabiliza en 20–20,3 MB: no hay evidencia suficiente de fuga creciente en las tres repeticiones. Sí existe retención deliberada por la caché de páginas.
- Dataset: 208 promociones, 3.067 cupones, 429 pedidos, 3.340 servicios (3.325 activos), 3.245 productos activos, 893 premios y 812 canjes. Son datos locales existentes, no volúmenes de producción.
- Recompensas Web: 1,12 MB de cuerpos API al entrar; Protección de servicios: 20.327 nodos.
- Productos públicos: 3.245 accesibles según conteo anónimo, 1.000 recibidos por la aplicación.

## 3. Hallazgos y correcciones propuestas

| ID | Severidad | Hallazgo |
| --- | --- | --- |
| PERF-01 | Alta · P1 | Los efectos continuos de cientos de cupones saturan el renderizado |
| PERF-02 | Alta · P1 | Las búsquedas públicas renderizan miles de tarjetas de golpe |
| PERF-03 | Alta · P1 | El catálogo público de productos queda truncado en 1.000 registros |
| PERF-04 | Alta · P1 | Recompensas Web carga recursos de todas sus secciones por adelantado |
| PERF-05 | Alta · P1 | Pedidos, promociones y reseñas montan listas completas y detalles plegados |
| PERF-06 | Alta · P1 | Inicio descarga todo el catálogo de servicios para mostrar cuatro destacados |
| PERF-07 | Media · P2 | El arranque duplica lecturas de sesión y precarga el portal en el POS |
| PERF-08 | Media · P2 | La caché de pestañas conserva un árbol completo por cada ruta visitada |
| PERF-09 | Media · P2 | La tarjeta 3D mantiene su bucle con reduced-motion |
| PERF-10 | Media · P2 | La instalación PWA precarga todos los módulos y recursos coincidentes |
| PERF-11 | Media · P2 | Inicio carga un mapa externo y recursos visuales mejorables durante el ensayo inicial |
| PERF-12 | Media · P2 | Consultas paginadas futuras necesitan revisar planes e índices bajo RLS |
| PERF-13 | Baja · P3 | Convertir estos escenarios en controles de rendimiento repetibles |

### PERF-01 · Los efectos continuos de cientos de cupones saturan el renderizado

**Severidad y prioridad:** Alta · P1. Prioridad de implementación: inmediata.

**Descripción y evidencia:** Promociones muestra 208 cupones y 624 chispas; Referidos, 183 cupones. En tres ensayos por pantalla, detener CSS temporalmente redujo el trabajo del hilo principal un 94,19 % en Promociones, 95,91 % en Referidos y 95,60 % en Fidelización. La prueba que detuvo solo los efectos de cupones pasó de 3.215,9 a 179,1 ms en ventanas de unos 4 s. En CPU 4×, la cadencia de requestAnimationFrame cayó a 9 y 10,4 callbacks/s en Promociones y Referidos.

**Por qué es un problema:** El barrido anima left, provocando cálculo de posiciones; las chispas añaden animaciones y filtros. La clase apagada solo reduce la opacidad: las promociones inactivas conservan los efectos. Detener únicamente el barrido reduce layout, pero las chispas siguen costando. El problema aparece en tema claro y oscuro.

**Consecuencia:** Menor fluidez al escribir, abrir formularios y desplazarse; trabajo continuo aunque el usuario no haga nada.

**Corrección propuesta para Claude Code:** Mantener el acabado metálico estático de las tarjetas de lista. Reservar movimiento para una tarjeta enfocada o interactuada; detenerlo fuera de pantalla y en cupones inactivos. Cambiar el barrido a transform si se conserva, y comprobar su composición real. Limitar también la cantidad de tarjetas montadas. No añadir will-change indiscriminadamente a cientos de elementos.

**Criterio de aceptación:** Repetir las tres comparaciones con el mismo conjunto: reducir al menos 80 % el trabajo en reposo; sin animación de cupones inactivos o fuera de pantalla; conservar legibilidad y apariencia aprobada. Confirmar navegación, arrastre y reduced-motion.

**Código:** [src/index.css:1785](C:/WedJaiseReact/src/index.css:1785) · [src/index.css:3252](C:/WedJaiseReact/src/index.css:3252) · [src/components/EnvolturaCupon.jsx:37](C:/WedJaiseReact/src/components/EnvolturaCupon.jsx:37).

**Evidencia:** [measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/measurements.json) · [extra-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/extra-measurements.json) · [pos-targeted-animation.trace.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/pos-targeted-animation.trace.json).

### PERF-02 · Las búsquedas públicas renderizan miles de tarjetas de golpe

**Severidad y prioridad:** Alta · P1. Prioridad de implementación: inmediata.

**Descripción y evidencia:** Buscar “test” en Servicios públicos monta 3.322 tarjetas y 54.960 nodos. Se registró una tarea de 861 ms en escritorio y de 5.644 ms con CPU 4×. En Productos, 976 tarjetas y 19.632 nodos: tareas de 274 ms y 1.787 ms, respectivamente. Las trazas separan el trabajo de React, recálculo de estilos y layout.

**Por qué es un problema:** La vista agrupada limita visualmente las filas, pero la vista de búsqueda/categoría ejecuta listaFiltrada.map sobre todos los resultados. El filtrado cambia a una grilla completa en una sola actualización.

**Consecuencia:** La interfaz puede quedar bloqueada durante varios segundos en el escenario simulado. La cantidad de datos determina el costo de cada búsqueda.

**Corrección propuesta para Claude Code:** Implementar búsqueda y filtros en el servidor con páginas de 40 resultados y orden determinista. Mantener el total en una consulta de conteo o agregado. Si se exige desplazamiento continuo, usar carga por páginas y virtualización; no montar todas las tarjetas ocultándolas con CSS.

**Criterio de aceptación:** Con 3.325 servicios activos, la primera página debe montar como máximo 40 tarjetas; una búsqueda amplia no debe producir tareas mayores de 200 ms en el mismo ensayo CPU 4×. Verificar categorías, orden, conteos y acceso a todos los resultados.

**Código:** [src/pages/cliente/ServiciosCliente.jsx:562](C:/WedJaiseReact/src/pages/cliente/ServiciosCliente.jsx:562) · [src/pages/cliente/ProductosCliente.jsx:555](C:/WedJaiseReact/src/pages/cliente/ProductosCliente.jsx:555).

**Evidencia:** [catalog-search-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/catalog-search-measurements.json) · [catalog-search-servicios-mobile.trace.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/catalog-search-servicios-mobile.trace.json) · [catalog-search-productos-mobile.trace.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/catalog-search-productos-mobile.trace.json).

### PERF-03 · El catálogo público de productos queda truncado en 1.000 registros

**Severidad y prioridad:** Alta · P1. Prioridad de implementación: inmediata.

**Descripción y evidencia:** La consulta anónima de conteo confirma 3.245 productos activos accesibles públicamente. La consulta de la aplicación devuelve exactamente 1.000. ProductosCliente no pagina esa lectura y Supabase Local tiene max_rows = 1000.

**Por qué es un problema:** Se trata el máximo de respuesta del servidor como si fuera el catálogo completo. Filtrar localmente no puede encontrar productos que nunca fueron descargados.

**Consecuencia:** Además del costo de descargar 1.000 filas, 2.245 productos quedan fuera de ese conjunto y sus búsquedas, categorías y contadores pueden resultar incompletos.

**Corrección propuesta para Claude Code:** Resolver junto con PERF-02 mediante paginación y búsqueda en servidor. Obtener categorías y totales de forma independiente. No aumentar max_rows como sustituto de paginar ni descargar todo para corregir el recorte.

**Criterio de aceptación:** Buscar un producto situado después del registro 1.000 debe encontrarlo. Recorrer todas las páginas sin duplicados ni omisiones; comparar el total con el conteo autorizado por RLS.

**Código:** [src/pages/cliente/ProductosCliente.jsx:93](C:/WedJaiseReact/src/pages/cliente/ProductosCliente.jsx:93) · [supabase/config.toml:18](C:/WedJaiseReact/supabase/config.toml:18).

**Evidencia:** [focus-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/focus-measurements.json) · [measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/measurements.json) · [database-audit.txt](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/database-audit.txt).

### PERF-04 · Recompensas Web carga recursos de todas sus secciones por adelantado

**Severidad y prioridad:** Alta · P1. Prioridad de implementación: inmediata.

**Descripción y evidencia:** Al abrir la ruta se transfieren 1.124.141 bytes de cuerpos de respuestas locales: 3.340 servicios en cuatro bloques, 893 premios, 944 protecciones y 812 canjes, además de configuración y sesión. “Protección de servicios” monta 20.327 nodos; “Protección de productos” se mantiene en 528. Lighthouse móvil frío: LCP simulado de 9,66 s.

**Por qué es un problema:** El Promise.all inicial exige los recursos de secciones todavía no abiertas; los canjes se cuentan en JavaScript y la protección de servicios recorre la lista completa.

**Consecuencia:** Carga inicial pesada y crecimiento lineal de DOM, datos y procesamiento conforme aumentan servicios y canjes.

**Corrección propuesta para Claude Code:** Cargar cada recurso cuando su sección lo necesite. Paginar catálogo y protección de servicios con 40 filas, siguiendo el límite existente de productos. Sustituir la descarga de canjes individuales por un agregado autorizado en el servidor. Mantener invalidación específica después de guardar.

**Criterio de aceptación:** Abrir Programa no debe descargar servicios, protecciones ni canjes. Cada lista debe limitar su primera página; el conteo de canjes debe seguir siendo exacto con más de 1.000 filas. Comparar bytes y LCP antes/después.

**Código:** [src/pages/RecompensasWeb.jsx:973](C:/WedJaiseReact/src/pages/RecompensasWeb.jsx:973) · [src/pages/RecompensasWeb.jsx:792](C:/WedJaiseReact/src/pages/RecompensasWeb.jsx:792).

**Evidencia:** [measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/measurements.json) · [extra-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/extra-measurements.json) · [lighthouse-cold-administrador--recompensas-web-mobile.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-administrador--recompensas-web-mobile.html).

### PERF-05 · Pedidos, promociones y reseñas montan listas completas y detalles plegados

**Severidad y prioridad:** Alta · P1. Prioridad de implementación: inmediata.

**Descripción y evidencia:** Pedidos Web trae 429 pedidos con sus ítems y monta 18.270 nodos. Promociones: 8.826; Reseñas: 7.316. Al limpiar la búsqueda, Pedidos y Promociones registran eventos de 248 ms. En Pedidos aparece una tarea de 203 ms durante la reconstrucción.

**Por qué es un problema:** Las consultas no tienen paginación de interfaz. CampoColapsable mantiene children montados aunque su fila tenga altura cero, por lo que plegar no elimina el costo inicial ni el DOM.

**Consecuencia:** Más trabajo al cargar, filtrar y volver a mostrar las listas; el historial acumulado hace más cara una pantalla operativa cotidiana.

**Corrección propuesta para Claude Code:** Paginar y filtrar en el servidor, con un orden estable por fecha e id. Montar los detalles al expandirlos y preservar por separado únicamente los borradores necesarios. Aplicar el mismo criterio a Referidos y Fidelización. Revisar Mobiliario y Galería como siguiente grupo de crecimiento.

**Criterio de aceptación:** La primera vista debe limitarse a 40 filas y los detalles cerrados no deben existir en el DOM. Repetir búsqueda/limpieza con el conjunto actual y comprobar eventos menores de 200 ms, sin perder acciones ni estado de formularios.

**Código:** [src/pages/PedidosWeb.jsx:62](C:/WedJaiseReact/src/pages/PedidosWeb.jsx:62) · [src/pages/Promociones.jsx:63](C:/WedJaiseReact/src/pages/Promociones.jsx:63) · [src/pages/ResenasWeb.jsx:63](C:/WedJaiseReact/src/pages/ResenasWeb.jsx:63) · [src/components/CampoColapsable.jsx:5](C:/WedJaiseReact/src/components/CampoColapsable.jsx:5).

**Evidencia:** [measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/measurements.json) · [extra-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/extra-measurements.json) · [pos-interactions.trace.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/pos-interactions.trace.json).

### PERF-06 · Inicio descarga todo el catálogo de servicios para mostrar cuatro destacados

**Severidad y prioridad:** Alta · P1. Prioridad de implementación: inmediata.

**Descripción y evidencia:** Inicio público solicita 3.325 servicios activos en cuatro peticiones: 524.695 bytes de cuerpos JSON. También trae 148 ids de servicios populares, 39 filas de galería para mostrar hasta tres y varias fuentes secundarias. La carga inicial observada tiene 15 peticiones locales. Lighthouse móvil frío: LCP simulado de 9,81 s; el resultado incorpora además los recursos de PERF-11.

**Por qué es un problema:** El hero y el contenido inicial esperan el Promise.all de recursos principales y secundarios. Los cuatro servicios se seleccionan después de descargar todo el catálogo. Contacto y horario se consultan directamente aquí y otra vez mediante la caché compartida del pie.

**Consecuencia:** La primera impresión de la web queda ligada al tamaño del catálogo y a respuestas que no son necesarias para mostrar la parte superior.

**Corrección propuesta para Claude Code:** Crear una lectura limitada de los cuatro servicios destacados con los campos que se muestran. Limitar galería en servidor y diferir secciones inferiores. Compartir obtenerContacto/obtenerHorario y separar la disponibilidad del hero de los recursos secundarios. Priorizar la imagen principal únicamente en Inicio.

**Criterio de aceptación:** Inicio no debe descargar miles de servicios ni duplicar contacto/horario. Introducir 1 s de demora en un recurso secundario no debe retrasar el hero. Repetir Lighthouse frío y verificar la cadena de descubrimiento del LCP.

**Código:** [src/pages/cliente/InicioCliente.jsx:244](C:/WedJaiseReact/src/pages/cliente/InicioCliente.jsx:244) · [src/pages/cliente/InicioCliente.jsx:261](C:/WedJaiseReact/src/pages/cliente/InicioCliente.jsx:261) · [src/pages/cliente/InicioCliente.jsx:293](C:/WedJaiseReact/src/pages/cliente/InicioCliente.jsx:293) · [src/pages/cliente/PieClienteWeb.jsx:23](C:/WedJaiseReact/src/pages/cliente/PieClienteWeb.jsx:23).

**Evidencia:** [measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/measurements.json) · [focus-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/focus-measurements.json) · [lighthouse-cold-publico--inicio-mobile.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-publico--inicio-mobile.html).

### PERF-07 · El arranque duplica lecturas de sesión y precarga el portal en el POS

**Severidad y prioridad:** Media · P2. Prioridad de implementación: corto plazo.

**Descripción y evidencia:** En producción, una carga de Ventas registra dos consultas idénticas a usuarios y dos a estado_negocio. También descarga PortalCliente e InicioCliente aunque el rol sea ADMINISTRADOR. La duplicación persiste fuera de StrictMode de desarrollo.

**Por qué es un problema:** getSession y onAuthStateChange pueden disparar cargarPerfil durante el mismo arranque. EstadoNegocioProvider depende del objeto session y cargandoAuth. En App, !usuario activa vistaCliente antes de terminar de resolver la autenticación, por lo que se ejecuta la precarga del portal.

**Consecuencia:** Peticiones, suscripciones y descargas de JavaScript evitables en la ruta más frecuente del POS. En el cliente se añade la lectura secuencial de su perfil.

**Corrección propuesta para Claude Code:** Unificar y deduplicar la resolución inicial de perfil, manteniendo la salida del callback de Auth que evita bloqueos. Basar recursos compartidos en la identidad estable y esperar a conocer el rol antes de precargar el portal. En Recompensas cliente, solicitar los recursos personales por sección: actualmente abre 22 peticiones locales incluso en “Cómo funciona”.

**Criterio de aceptación:** Una restauración de sesión debe resolver cada perfil y configuración una sola vez. Ventas no debe descargar PortalCliente/InicioCliente por un estado transitorio. Probar login, refresh, cambio de cuenta y cierre de sesión sin perder restricciones de rol.

**Código:** [src/context/AuthContext.jsx:189](C:/WedJaiseReact/src/context/AuthContext.jsx:189) · [src/context/AuthContext.jsx:206](C:/WedJaiseReact/src/context/AuthContext.jsx:206) · [src/context/EstadoNegocioContext.jsx:114](C:/WedJaiseReact/src/context/EstadoNegocioContext.jsx:114) · [src/App.jsx:52](C:/WedJaiseReact/src/App.jsx:52) · [src/pages/cliente/recompensas/useRecursosRecompensas.js:112](C:/WedJaiseReact/src/pages/cliente/recompensas/useRecursosRecompensas.js:112).

**Evidencia:** [measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/measurements.json).

### PERF-08 · La caché de pestañas conserva un árbol completo por cada ruta visitada

**Severidad y prioridad:** Media · P2. Prioridad de implementación: corto plazo.

**Descripción y evidencia:** Ventas fresca: 369 nodos y aproximadamente 3 MB de heap JS. Tras recorrer las 27 rutas: 69.547 nodos al volver a Ventas y 53,1 MB de heap después de GC en el último punto del recorrido. En 6 s se contaron 202 commits de React. En el recorrido repetido de cinco rutas, el heap se estabiliza alrededor de 20–20,3 MB.

**Por qué es un problema:** visitadas no tiene política de expulsión. Las páginas se ocultan con display:none y conservan sus estados, listas y hooks. Los placeholders siguen sus temporizadores porque InputBusqueda no usa la actividad de la página.

**Consecuencia:** Retención de memoria y actualizaciones innecesarias durante sesiones largas. Las animaciones CSS ocultas no mantienen el mismo costo de pintura que cuando están visibles: el costo dominante de PERF-01 pertenece a la pestaña visible.

**Corrección propuesta para Claude Code:** Conservar los datos y borradores necesarios, y limitar los árboles montados mediante una caché acotada. Mantener protegido el carrito y las operaciones en curso. Pausar temporizadores y efectos cuando la página esté inactiva; pasar el estado activo al placeholder.

**Criterio de aceptación:** Recorrer las 27 rutas no debe retener 27 árboles de pantalla. Verificar memoria estabilizada después de tres ciclos, pocos o ningún commit en páginas ocultas y recuperación de carrito, filtros, scroll y borradores. No se ha demostrado una fuga creciente con estas tres repeticiones.

**Código:** [src/components/PestanasCacheadas.jsx:94](C:/WedJaiseReact/src/components/PestanasCacheadas.jsx:94) · [src/components/PestanasCacheadas.jsx:116](C:/WedJaiseReact/src/components/PestanasCacheadas.jsx:116) · [src/components/InputBusqueda.jsx:20](C:/WedJaiseReact/src/components/InputBusqueda.jsx:20) · [src/hooks/useTextoEscritura.js:21](C:/WedJaiseReact/src/hooks/useTextoEscritura.js:21).

**Evidencia:** [measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/measurements.json) · [extra-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/extra-measurements.json) · [pos-production-journey.trace.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/pos-production-journey.trace.json).

### PERF-09 · La tarjeta 3D mantiene su bucle con reduced-motion

**Severidad y prioridad:** Media · P2. Prioridad de implementación: corto plazo.

**Descripción y evidencia:** Con reduced-motion, el transform de .tp-card cambia durante una muestra de 3 s y se registran 205,5 ms de trabajo. La traza posterior de 4 s contiene 244 eventos Layout y 732 Paint. Detener CSS solo reduce 7,78 % el trabajo de la tarjeta: su animación principal es JavaScript.

**Por qué es un problema:** TarjetaPuntos usa un requestAnimationFrame continuo que cambia transform, gradientes y left, consulta nodos cada frame y no comprueba reduced-motion ni intersección. FondoNivel sí contempla reduced-motion, pero también recorre continuamente cuando está habilitado. Inicio mantiene un rAF para su máscara incluso sin interacción.

**Consecuencia:** Trabajo continuo y consumo de recursos en dispositivos modestos; la preferencia de movimiento reducido no se cumple para la tarjeta.

**Corrección propuesta para Claude Code:** Aplicar una presentación estática cuando se solicita movimiento reducido; animar solo mientras el componente esté visible y la pestaña activa. Cachear referencias a los nodos, evitar left y gradientes recalculados cada frame, y detener la máscara de Inicio cuando converge al reposo. Conservar interacción directa y limpieza al desmontar.

**Criterio de aceptación:** La tarjeta debe permanecer inmóvil en reduced-motion, sin bucle continuo de layout/pintura. Fuera del viewport no debe actualizar estilos. Comprobar arrastre, cambio de nivel y presentación normal.

**Código:** [src/components/TarjetaPuntos.jsx:106](C:/WedJaiseReact/src/components/TarjetaPuntos.jsx:106) · [src/components/FondoNivel.jsx:36](C:/WedJaiseReact/src/components/FondoNivel.jsx:36) · [src/pages/cliente/InicioCliente.jsx:89](C:/WedJaiseReact/src/pages/cliente/InicioCliente.jsx:89).

**Evidencia:** [extra-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/extra-measurements.json) · [client-tarjeta-reduced.trace.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/client-tarjeta-reduced.trace.json) · [cpu-summary.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/cpu-summary.json).

### PERF-10 · La instalación PWA precarga todos los módulos y recursos coincidentes

**Severidad y prioridad:** Media · P2. Prioridad de implementación: corto plazo.

**Descripción y evidencia:** Se verificaron 168 entradas en el precache, con 3.530.690 bytes de contenido. El patrón incluye todos los JS/CSS/HTML y fuentes woff2, incluso módulos que se importan de forma diferida. En la segunda carga, el service worker controla la página y 89 recursos se sirven mediante él.

**Por qué es un problema:** El glob de Workbox abarca el conjunto completo del build. La división en chunks reduce el arranque de ejecución, pero el precache vuelve a descargar esos chunks durante la instalación.

**Consecuencia:** Tráfico y almacenamiento iniciales mayores, especialmente relevantes para un visitante móvil que nunca utilizará el POS o el escáner.

**Corrección propuesta para Claude Code:** Definir un shell mínimo y estrategias de caché por uso para módulos opcionales; revisar qué rutas deben funcionar sin conexión. Conservar la política actual de no cachear respuestas de Supabase y el aviso de actualización. Medir primera instalación y visita repetida por separado.

**Criterio de aceptación:** El visitante no debe precargar los módulos exclusivos del POS/escáner. Verificar actualización, recarga y offline del shell; las consultas operativas deben seguir yendo a la red. Los 3,53 MB son contenido de caché, no una medida de transferencia comprimida.

**Código:** [vite.config.js:41](C:/WedJaiseReact/vite.config.js:41) · [src/components/AvisoActualizacionPWA.jsx:12](C:/WedJaiseReact/src/components/AvisoActualizacionPWA.jsx:12).

**Evidencia:** [extra-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/extra-measurements.json) · [focus-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/focus-measurements.json) · [bundle-summary.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/bundle-summary.json).

### PERF-11 · Inicio carga un mapa externo y recursos visuales mejorables durante el ensayo inicial

**Severidad y prioridad:** Media · P2. Prioridad de implementación: corto plazo.

**Descripción y evidencia:** Lighthouse frío de Inicio móvil registra 14 peticiones a maps.googleapis.com (397.817 bytes) y una a maps.gstatic.com (76.630 bytes). La etiqueta del mapa ya tiene loading=lazy, pero aun así se descargó durante esta navegación. Estima 93 KiB de ahorro en las dos imágenes del hero. index.html declara siete familias de Google Fonts; en este ensayo se descargan tres recursos de fonts.gstatic.com por 70.451 bytes.

**Por qué es un problema:** El lazy loading nativo depende de la distancia al viewport y no garantiza que el mapa espere una interacción. Las imágenes principales no tienen variantes responsivas ni prioridad alta explícita. CSS global y tipografías forman parte de la ruta crítica.

**Consecuencia:** Competencia por red y CPU durante la primera visita. La transferencia total de Inicio móvil frío alcanza aproximadamente 1,85 MB en este entorno.

**Corrección propuesta para Claude Code:** Activar el iframe con un marcador o al acercarse realmente a su sección. Usar tamaños responsivos y WebP/AVIF para el hero, con prioridad alta solo en su imagen LCP. Revisar familias/pesos utilizados por ruta y fuentes TTF locales, manteniendo font-display:swap. Evitar precargar recursos del portal en el POS.

**Criterio de aceptación:** Sin llegar a la sección del mapa no deben aparecer sus peticiones. Comprobar ahorro real de imágenes a 390/412/1440 px y mantener apariencia. Comparar bytes por origen y LCP; el ahorro estimado por Lighthouse no equivale a una mejora ya implementada.

**Código:** [src/pages/cliente/InicioCliente.jsx:869](C:/WedJaiseReact/src/pages/cliente/InicioCliente.jsx:869) · [src/pages/cliente/NosotrosCliente.jsx:541](C:/WedJaiseReact/src/pages/cliente/NosotrosCliente.jsx:541) · [index.html:55](C:/WedJaiseReact/index.html:55) · [src/index.css:1872](C:/WedJaiseReact/src/index.css:1872).

**Evidencia:** [lighthouse-cold-publico--inicio-mobile.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-publico--inicio-mobile.html) · [lighthouse-cold-publico--inicio-mobile.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-publico--inicio-mobile.json).

### PERF-12 · Consultas paginadas futuras necesitan revisar planes e índices bajo RLS

**Severidad y prioridad:** Media · P2. Prioridad de implementación: corto plazo.

**Descripción y evidencia:** Siete EXPLAIN ANALYZE de SELECT dentro de transacción READ ONLY y rol authenticated: Promociones completa 15,22 ms; con límite 40, 13,69 ms; Referidos con cliente 3,43 ms; Pedidos limitados a 40, 30,59 ms; Servicios limitados a 1.000, 23,25 ms, y a 40, 21,94 ms; agregado de canjes 54,12 ms. Los planes relevantes conservan escaneos, filtros RLS y ordenamientos. Son consultas diagnósticas, no la reconstrucción exacta de todo SQL interno de PostgREST.

**Por qué es un problema:** Reducir filas de salida no garantiza reducir el trabajo del servidor. Faltan índices alineados con algunos filtros/órdenes; las políticas muestran llamadas a helpers en filtros por fila.

**Consecuencia:** El costo puede crecer al aumentar las tablas. En el conjunto local, estos milisegundos no explican por sí solos el gasto continuo de los cupones.

**Corrección propuesta para Claude Code:** Después de diseñar la paginación, medir índices compuestos acordes con origen/fecha/id y fecha/id, y las relaciones de ítems de pedido. Revisar la posibilidad de evaluar helpers constantes mediante initPlan, manteniendo exactamente la autorización. Validar bajo cada rol y con EXPLAIN, sin añadir índices indiscriminadamente.

**Criterio de aceptación:** Los planes deben mejorar con el mismo rol y filtros sin alterar resultados ni visibilidad de datos. Registrar costo de escrituras/almacenamiento de los índices nuevos. Este trabajo corresponde a Claude Code y su revisión de migraciones; no se aplicó ningún cambio de esquema.

**Código:** [src/pages/ReferidosWeb.jsx:88](C:/WedJaiseReact/src/pages/ReferidosWeb.jsx:88) · [src/pages/PedidosWeb.jsx:72](C:/WedJaiseReact/src/pages/PedidosWeb.jsx:72) · [src/lib/leerPaginado.js:9](C:/WedJaiseReact/src/lib/leerPaginado.js:9).

**Evidencia:** [database-audit.sql](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/database-audit.sql) · [database-audit.txt](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/database-audit.txt).

### PERF-13 · Convertir estos escenarios en controles de rendimiento repetibles

**Severidad y prioridad:** Baja · P3. Prioridad de implementación: medio plazo.

**Descripción y evidencia:** Hay pruebas E2E y un script de rendimiento existente, pero en src no se encontró instrumentación web-vitals/PerformanceObserver. El lint actual termina con 2 errores y 44 advertencias; los errores señalan callbacks use de fixtures de Playwright como hooks de React.

**Por qué es un problema:** Una prueba funcional puede pasar aunque una búsqueda bloquee durante segundos. Los resultados de carga inicial tampoco describen el costo sostenido de las animaciones.

**Consecuencia:** Es fácil reintroducir listas gigantes, precargas o animaciones costosas sin detectarlo antes de publicar.

**Corrección propuesta para Claude Code:** Incorporar un conjunto pequeño de pruebas de rendimiento: primera carga, sesión caliente, búsqueda amplia, cupones en reposo, 27 pestañas y reduced-motion. Guardar tendencias y presupuestos; añadir medición de campo de LCP/INP/CLS con datos mínimos y sin información personal. Ajustar el alcance de la regla de lint para fixtures, tras revisar sus dos errores.

**Criterio de aceptación:** CI debe detectar la reaparición de listas sin límite y regresiones importantes frente a la misma máquina/dataset. Separar métricas de campo y laboratorio; no usar una nota Lighthouse alta como única aprobación.

**Código:** [tests/e2e/performance-audit.mjs:1](C:/WedJaiseReact/tests/e2e/performance-audit.mjs:1) · [tests/e2e/fixtures.mjs:8](C:/WedJaiseReact/tests/e2e/fixtures.mjs:8) · [src/main.jsx:13](C:/WedJaiseReact/src/main.jsx:13).

**Evidencia:** [lint.txt](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lint.txt) · [audit.cjs](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/audit.cjs) · [extra.cjs](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/extra.cjs) · [catalog-search.cjs](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/catalog-search.cjs).

## 4. Lo que ya funciona y debe conservarse

- Inventario, Servicios POS, Clientes, Historial y Auditoría tienen mecanismos de límites/paginación; los buscadores de caja usan consultas limitadas y debounce. En los ensayos de búsqueda de estas pantallas no aparecieron las tareas de segundos de los catálogos públicos.
- Porcentajes limita la ventana renderizada a 50 servicios y evita montar el detalle hasta abrirlo, aunque todavía lee el conjunto completo para configuración.
- Catálogo Web y Protección de productos tienen límites de consulta; son referencias para las pantallas grandes.
- El escáner ZXing se importa de forma diferida. Hay limpieza de listeners/rAF en TarjetaPuntos y FondoNivel; el hallazgo se refiere a cuándo permanecen activos.
- Se redimensionan imágenes subidas y se recomprimen a WebP. La galería de Inicio usa IntersectionObserver para acercar sus imágenes; el mapa puede seguir ese patrón.
- reduced-motion ya detiene los efectos CSS de cupones y FondoNivel; el hueco comprobado está en TarjetaPuntos.
- La PWA recupera recursos desde caché en la segunda carga y no tiene una regla de runtime cache para Supabase.
- No hubo pageerror no controlados en las series finales ni desbordamiento horizontal en las diez muestras móviles principales.

## 5. Bundle, desarrollo y base de datos

El build aislado terminó correctamente: 2.673 módulos transformados, salida minificada y mapas ocultos. Tailwind advirtió sobre la falta de sourcemap CSS; los mapas JavaScript se usaron para atribuir perfiles. No se ejecutó npm run build en la salida normal del proyecto.

| Conjunto | Archivos | Bytes sin comprimir | Gzip calculado |
| --- | --- | --- | --- |
| .js | 138 | 2,194,903 | 641,540 |
| .css | 1 | 181,351 | 32,067 |
| .ttf | 2 | 134,488 | 50,901 |
| .jpeg | 1 | 121,254 | 102,259 |
| .woff2 | 5 | 76,420 | 76,545 |

El cierre estático inicial del manifest suma 755,060 bytes, aproximadamente 197,133 bytes con gzip calculado, antes de fuentes y recursos adicionales. El módulo del escáner es grande pero diferido; por eso no se propone quitarlo como primera medida. El problema del precache se trata por separado.

En desarrollo, las siete rutas comparadas muestran más heap y algunas consultas adicionales: Recompensas Web pasa de 12 peticiones locales en producción a 20 en desarrollo; su heap tras GC, de 6,3 a 28,6 MB. Esto es coherente con comprobaciones adicionales de desarrollo. El problema de cupones persiste en el build de producción y la duplicación de perfil también. No se recomienda desactivar StrictMode para ocultar efectos duplicados: [comprobaciones de React StrictMode](https://react.dev/reference/react/StrictMode).

Los planes SQL se obtuvieron con un administrador QA como authenticated en una transacción READ ONLY y terminaron en ROLLBACK. No se crearon índices ni cambiaron RLS. Las decisiones deben conservar la autorización y verificarse con planes, siguiendo las [recomendaciones de rendimiento RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations).

El lint ejecutado sin autofix terminó con código 1: 2 errores y 44 advertencias. Los dos errores están en fixtures de Playwright por el identificador use, no constituyen por sí mismos evidencia de una infracción de hooks en la UI. Se adjunta el log completo. No se reejecutaron suites que crean datos o escriben resultados dentro del proyecto: esta auditoría usa su propio conductor externo.

## 6. Plan de implementación para aprobar

| Orden | Paquete | IDs | Resultado verificable | Estimación orientativa |
| --- | --- | --- | --- | --- |
| 1 | Cupones y listas operativas | 01, 05 | Baja marcada del trabajo en reposo y filas limitadas | 1–2 jornadas |
| 2 | Catálogos públicos completos y paginados | 02, 03 | Buscar sin bloqueo y encontrar productos más allá de 1.000 | 2–3 jornadas |
| 3 | Recompensas e Inicio por demanda | 04, 06, 07 | Menos datos iniciales y consultas deduplicadas | 2–3 jornadas |
| 4 | Sesiones largas y movimiento reducido | 08, 09 | Caché acotada, borradores preservados, animación pausada | 1–2 jornadas |
| 5 | Recursos, PWA e índices medidos | 10, 11, 12 | Menos precarga, mapa diferido y planes comprobados | 1–2 jornadas |
| 6 | Regresión y observabilidad | 13 | Presupuestos automatizados y seguimiento de campo | 1–2 jornadas |

Las estimaciones son de planificación y se solapan entre paquetes; dependen de cambios de diseño, migraciones y revisión. Primero conviene resolver 01–06. El timeout y conciliación de pagos se deja como revisión separada: no se deben reintentar cargos a ciegas al optimizar tiempos de espera.

**Puerta de aceptación propuesta:** repetir el mismo dataset y condiciones, comparar tres muestras de los escenarios prioritarios, reducir al menos 80 % el costo en reposo de los cupones, limitar las listas a 40 filas por página, eliminar las tareas de varios segundos, preservar carrito/borradores y confirmar datos completos bajo cada rol. Para el seguimiento de usuarios reales, usar p75 segmentado de LCP ≤ 2,5 s, INP ≤ 200 ms y CLS ≤ 0,1; estos umbrales de campo no convierten EventTiming ni TBT local en INP real. [Web Vitals](https://web.dev/articles/vitals).

**Calificación del alcance medido:** la serie fría de Lighthouse va de 91–99 en escritorio y 68–90 en móvil. No se asigna una nota global inventada a seguridad, accesibilidad o calidad profesional: esta es una auditoría de rendimiento. Las altas notas de algunas rutas no compensan los bloqueos de búsquedas y animaciones demostrados.

## 7. Matriz de rutas e informes

Primera medición de cada ruta del administrador en producción. readyMs incluye el margen del conductor; el trabajo en reposo usa ventanas de alrededor de 1,6 s.

| Ruta POS | readyMs | DOM | Trabajo reposo (ms) | Heap JS (MB) | Cuerpo API (KiB) |
| --- | --- | --- | --- | --- | --- |
| /ventas | 980 | 369 | 27.8 | 3 | 0.9 |
| /inventario | 1377 | 2,701 | 7.9 | 3.7 | 30.3 |
| /historial | 1539 | 1,700 | 20.1 | 3.5 | 14 |
| /servicios | 922 | 2,826 | 16.6 | 3.8 | 73.4 |
| /dashboard | 1927 | 378 | 38.5 | 2.9 | 1.7 |
| /mi-panel | 1096 | 328 | 18.1 | 3 | 28.1 |
| /citas | 985 | 522 | 8.3 | 3.3 | 218.8 |
| /estadisticas | 1916 | 483 | 6.8 | 3 | 3.2 |
| /auditoria | 835 | 683 | 29.1 | 3.2 | 11 |
| /clientes | 1308 | 3,667 | 26.3 | 4.1 | 16.5 |
| /deudas | 845 | 2,160 | 33.2 | 3.7 | 19.1 |
| /porcentajes | 1029 | 724 | 12.4 | 3.6 | 348.1 |
| /gastos | 831 | 1,840 | 9.9 | 4 | 11.4 |
| /asistentes | 839 | 1,417 | 18.1 | 3.7 | 9.6 |
| /mobiliario | 908 | 4,432 | 43 | 4.4 | 34.8 |
| /web | 847 | 314 | 32 | 2.9 | 0.9 |
| /promociones | 1052 | 8,826 | 1,522.4 | 5.8 | 46.7 |
| /pedidos-web | 1237 | 18,270 | 75.1 | 8.7 | 335.9 |
| /resenas-web | 1029 | 7,316 | 170.2 | 5.7 | 74.1 |
| /contacto-web | 829 | 439 | 22.8 | 3 | 87 |
| /puntos-web | 827 | 276 | 29.4 | 2.8 | 1 |
| /referidos-web | 985 | 3,961 | 1,527.3 | 4.3 | 36.8 |
| /fidelizacion-web | 904 | 2,136 | 895 | 3.6 | 19.6 |
| /recompensas-web | 1107 | 8,191 | 28.9 | 6.3 | 1,097.8 |
| /catalogo-web | 839 | 695 | 38.9 | 3.3 | 30.2 |
| /libro-reclamaciones-web | 825 | 273 | 26 | 3 | 1 |
| /galeria-web | 915 | 1,006 | 27.5 | 3.2 | 396.7 |

Cobertura adicional: /inicio, /servicios, /productos, /recompensas?seccion=tarjeta, /recompensas?seccion=sellos, /recompensas?seccion=cupones, /recompensas?seccion=canje, /recompensas?seccion=movimientos, /recompensas?seccion=como, /citas, /citas/carrito, /mi-perfil, /historial, /carrito, /mis-resenas, /mi-perfil/direcciones, /mi-perfil/pedidos, /mi-perfil/notificaciones, /mi-perfil/seguridad, /mi-perfil/referidos. Público: /inicio, /servicios, /productos, /nosotros, /recompensas, /libro-de-reclamaciones, /terminos-y-condiciones, /politica-de-cambios-y-devoluciones, /politica-de-privacidad, /login. Los tres detalles navegados están en extra-measurements.json.

Informes Lighthouse de la serie fría:

- [lighthouse-cold-administrador--ventas-desktop.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-administrador--ventas-desktop.html) · ADMINISTRADOR · escritorio
- [lighthouse-cold-administrador--ventas-mobile.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-administrador--ventas-mobile.html) · ADMINISTRADOR · móvil
- [lighthouse-cold-administrador--promociones-desktop.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-administrador--promociones-desktop.html) · ADMINISTRADOR · escritorio
- [lighthouse-cold-administrador--promociones-mobile.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-administrador--promociones-mobile.html) · ADMINISTRADOR · móvil
- [lighthouse-cold-administrador--recompensas-web-desktop.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-administrador--recompensas-web-desktop.html) · ADMINISTRADOR · escritorio
- [lighthouse-cold-administrador--recompensas-web-mobile.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-administrador--recompensas-web-mobile.html) · ADMINISTRADOR · móvil
- [lighthouse-cold-publico--inicio-desktop.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-publico--inicio-desktop.html) · PUBLICO · escritorio
- [lighthouse-cold-publico--inicio-mobile.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-publico--inicio-mobile.html) · PUBLICO · móvil
- [lighthouse-cold-publico--productos-desktop.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-publico--productos-desktop.html) · PUBLICO · escritorio
- [lighthouse-cold-publico--productos-mobile.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-publico--productos-mobile.html) · PUBLICO · móvil
- [lighthouse-cold-cliente--recompensas-seccion-tarjeta-desktop.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-cliente--recompensas-seccion-tarjeta-desktop.html) · CLIENTE · escritorio
- [lighthouse-cold-cliente--recompensas-seccion-tarjeta-mobile.html](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-cliente--recompensas-seccion-tarjeta-mobile.html) · CLIENTE · móvil

## 8. Evidencias y reproducción

- [measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/measurements.json): 90 muestras iniciales, 15 comparaciones y recorrido repetido.
- [extra-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/extra-measurements.json): subpestañas, interacciones, 27 pestañas, PWA y reduced-motion.
- [focus-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/focus-measurements.json): temas, conteo público exacto, latencia artificial y PWA caliente.
- [catalog-search-measurements.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/catalog-search-measurements.json): búsquedas amplias corregidas y trazadas en escritorio/móvil. Los dos skipped de búsqueda en focus-measurements fueron sustituidos por estas pruebas.
- [trace-summary.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/trace-summary.json) y [cpu-summary.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/cpu-summary.json): resumen de eventos y atribución mediante sourcemaps.
- [database-audit.txt](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/database-audit.txt), [bundle-summary.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/bundle-summary.json), [lint.txt](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lint.txt): base de datos, bundle y lint.
- [lighthouse-cold-summary.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-cold-summary.json) y [lighthouse-summary.json](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/lighthouse-summary.json): series fría y con caché.
- [audit.cjs](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/audit.cjs), [extra.cjs](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/extra.cjs), [focus.cjs](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/focus.cjs), [catalog-search.cjs](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/auditoria-rendimiento/catalog-search.cjs): conductores reproducibles externos al repositorio. Requieren los servidores locales, las rutas de herramientas de este equipo y Supabase Local; aprovisionan cuentas QA temporales, que eliminan en finally.

Las trazas *.trace.json se pueden importar en Performance de Chrome DevTools; los *.cpuprofile en el perfilador de JavaScript. El build separado y sus mapas se conservan en build. Los errores de preparación del conductor, cuando aparecen en harnessAttemptErrors, no son fallos de la aplicación: las series finales registran errors vacíos. No hay correcciones aplicadas al proyecto.
