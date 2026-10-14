# Fase 4: alcance local de catálogos escalables

Fecha: 2026-10-10, America/Lima. Referencia del código revisado: 6929c619.

## Decisión del usuario y procedencia de las cifras

El usuario indica que el negocio tiene aproximadamente 300 productos. Es una cifra aportada por él, no un conteo independiente de producción. Los miles de registros de la auditoría corresponden a la réplica / Supabase Local utilizada para pruebas de escala.

Los 3.245 productos accesibles, los 1.000 recibidos por la consulta anterior y las 3.322 tarjetas de servicios son referencias históricas del entorno de pruebas. No describen el volumen actual del negocio. La expresión «productos actuales» de la sección original de Fase 4 debe interpretarse con esta aclaración.

El usuario ha indicado continuar para preparar el sistema para cantidades mayores. Claude puede iniciar la implementación LOCAL de la Fase 4; Codex conserva su función de QA y auditor, sin modificar código. Este alcance no autoriza commit, push, despliegue, cambios externos ni mutaciones de datos remotos.

## Estado previo

La fila vigente del registro de fases refleja correctamente las aprobaciones acotadas de staging y la aceptación local del código de salida del CLI del recolector. Esta actualización documental no requiere repetir las pruebas ya aceptadas.

La Fase 3 completa y producción siguen sin aprobación. Permanecen las reservas de CPU de Pages con B, accesos alternativos por r2.dev y deployments antiguos, fotos reales y dispositivos, operación del recolector y rollback operativo. El dominio propio es opcional y futuro. Avanzar con la Fase 4 local no elimina estas condiciones de producción.

## Problema que debe resolver Claude

ProductosCliente consulta los productos activos sin paginación y filtra/renderiza en React los resultados recibidos. ServiciosCliente utiliza leerServicios para descargar el catálogo completo y después filtrarlo y renderizarlo. Incluso con unos 300 productos conviene limitar transferencia, imágenes y tarjetas; la réplica numerosa permite comprobar que el comportamiento no se deteriora al crecer.



## Implementación local

1. Búsqueda, filtros y orden del listado en servidor. Páginas de hasta 40 tarjetas o una ventana equivalente acotada; no descargar todo y luego cortarlo en React ni aumentar max_rows como solución.
2. Orden determinista con id como desempate. La búsqueda debe abarcar todo el catálogo permitido por RLS, incluidas filas posteriores al antiguo límite de 1.000.
3. Categorías y contadores globales independientes de la página actual. Hero, destacados y ofertas deben tener consultas limitadas y criterios explícitos, sin volver a exigir la descarga completa del catálogo.
4. Cambiar filtros reinicia la página de forma coherente. Cancelar o ignorar respuestas obsoletas, incluyendo cambios rápidos, navegación y cambios de cuenta. Mostrar carga, resultados vacíos y errores de consulta de forma diferenciada.
5. Pedir imágenes de tarjetas con la variante adecuada, dimensiones o aspect-ratio, carga diferida y fallback. No cargar galerías de detalle ni imágenes de páginas no visitadas. Conservar lectura compatible con Supabase, referencias r2: y URLs antiguas propias reescritas por Pages con B.
6. Conservar las reglas y el comportamiento de stock, precios, selección, carrito y detalle. Evitar rediseños y cambios de cobros, recompensas o permisos dentro de este tramo.
7. No cambiar globalmente leerServicios ni otros helpers de lectura completa: hay consumidores administrativos y selectores con contratos distintos. Usar una función específica de catálogo público o parámetros explícitos que preserven los consumidores existentes.
8. Si hace falta una RPC o cambio de esquema, documentar por qué y separar su revisión. No ampliar RLS para hacer funcionar búsquedas o conteos. Codex no aplicará migraciones; la optimización de índices medida pertenece a la Fase 7.

## Verificación que deberá entregar

- Dos tamaños: escenario representativo cercano a 300 productos y réplica de miles como prueba de crecimiento. Registrar entorno, rol y cardinalidades reales de cada ejecución; no atribuir resultados de la réplica a producción.
- Buscar un registro posterior al límite de 1.000; recorrer páginas sobre datos estables sin duplicados ni omisiones. Comprobar orden con valores iguales y conteos/categorías completos bajo RLS.
- Filtros rápidos con respuestas fuera de orden, limpieza de búsqueda, última página, ausencia de resultados, fallos de red y navegación. Comprobar que selección, carrito y detalle conservan su estado y contenido.
- Hasta 40 tarjetas del listado montadas por ventana; documentar por separado los pocos elementos del hero. No acumular todas las páginas en el DOM.
- Fotos QA, incluyendo variantes, URLs antiguas y fallos. Primera vista solicita solo imágenes visibles y el margen de carga diferida, sin galerías completas ni páginas futuras.
- Viewports de 390, 412 y 1440 px; tres muestras equivalentes antes/después para carga y búsqueda, con CPU 4×. Guardar muestras crudas y resumen de red sin tokens ni datos personales.
- Ningún bloqueo de un segundo o más atribuible a búsqueda/renderizado. Objetivo de interacción de hasta 200 ms; investigar tareas de 200–999 ms antes de aprobar. No llamar INP real a una medición de laboratorio de tareas o TBT.
- Usar fixtures ficticios. No copiar datos personales ni credenciales del negocio. Codex solo puede realizar mutaciones QA en Supabase Local positivamente verificado como http://127.0.0.1:54321; pruebas con escrituras remotas requieren autorización humana separada.

## Entrega y parada

Claude implementa y prueba en local, entrega diff, archivos, resultados, límites y reversión precisa, y se detiene para revisión de Codex. Los nuevos informes y evidencias se guardan dentro de .codex como solicitó el usuario, sin sobrescribir evidencia histórica ni incluir secretos.

No realizar commit/push, reconstruir Pages, configurar variables o binding, ni cambiar main, GitHub Pages, producción o datos remotos como parte de esta autorización local. La migración definitiva de hosting sigue sujeta al cierre previsto en las fases finales.