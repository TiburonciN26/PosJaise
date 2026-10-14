# Revisión Fase 4 — entrega V2

Fecha: 2026-10-11, America/Lima. HEAD: 6929c619. Código local sin commit; hashes en verificacion.json. Responde a ENTREGA-FASE4-CORRECCIONES-V1.md.

## Veredicto

**NO APROBADA todavía.** Las correcciones resuelven las reproducciones originales de ventana, duplicación y primera lectura fallida. El rollback quedó acotado. Permanecen una variante de F4-04 y dos fallos adicionales reproducidos: renovación de precios vencidos y metadatos de categorías truncados.

No es un rechazo de la mejora de rendimiento: continúa verificada. Los importes erróneos observados son los de las barras informativas; esta revisión no demuestra un cobro incorrecto.

## Qué se acepta de esta entrega

| Punto | Verificación independiente |
| --- | --- |
| F4-01, ventana de tarjetas | Once categorías ficticias en navegador: 40 artículos en ventana 1 y 4 en ventana 2, con paginador y categorías alcanzables. La lectura SQL real verifica las cotas. Pendiente la cardinalidad extrema de metadatos, F4-06. |
| F4-02, duplicados | Un UUID seleccionado presente a la vez en héroe/grupo y héroe/búsqueda: un servicio, S/ 10, en ambos casos. Cerrado en estas reproducciones. |
| F4-03, primera lectura fallida | Selección completa contada, sin subtotal; error con Reintentar. Cambiar cantidad recupera Producto a tres unidades/S/ 50; Reintentar recupera Servicio a dos/S/ 30. Cerrado el defecto original; F4-05 cubre caché vencida. |
| F4-04, precio fuera de vitrina | Fuera de la vitrina: S/ 20 por id, S/ 25 en la búsqueda, S/ 25 al limpiar. Correcto. No cierra la variante con una fila antigua todavía en la vitrina, F4-04b. |
| Rollback | git apply -R --check del parche, sin aplicar: correcto. Ocho archivos de Fase 4; no incluye el CLI del recolector. Lista explícita de nuevos archivos y de firmas SQL. |

Codex no modificó fuente, dependencias, configuración ni Git; no aplicó migraciones ni realizó mutaciones de BD. No ejecutó los scripts de siembra o limpieza por SQL.

## Pruebas repetidas y rendimiento

- verificar-catalogo-publico.mjs: **27/27**, en modo solo lectura contra http://127.0.0.1:54321. Entorno verificado: 3.245 productos y 3.325 servicios activos; cuatro categorías de Productos y dieciocho de Servicios tras la limpieza de Claude.
- verificar-catalogos-interfaz.cjs: **25/25**, sin --con-categorias. Incluye búsqueda completa, paginación de resultados, respuestas obsoletas, errores con recuperación y 390/412/1440 px.
- Trece observaciones diagnósticas nuevas sobre páginas y componentes reales en Chromium. REST y selección simulados mediante interceptación; reloj adelantado solo dentro del navegador para probar caducidad. Ninguna operación real de BD. El harness registra observaciones, no es una suite de aceptación cuyo exit 0 signifique ausencia de defectos.
- Lint de los siete archivos del núcleo revisado: sin diagnósticos.
- Medición actual: seis muestras nuevas, tres por catálogo, 1440 px, CPU 4×, réplica local, imágenes PNG 1×1 y sin escrituras.

| Máximo observado / transferencia | Productos | Servicios |
| --- | --- | --- |
| Evento de búsqueda | 64 ms | 32 ms |
| Tarea larga durante búsqueda | 103 ms | 62 ms |
| Datos de catálogo en carga | 11.984 bytes | 15.465 bytes |
| Artículos de «Todos» en la réplica | 11 | 16 |

Los dos informes finales entregados tienen dieciocho muestras cada uno y cero errores registrados; sus máximos son 56 ms/evento y 94 ms/tarea en la réplica, y 56/83 en el escenario sintético 300/100. La variación frente a mi repetición es esperable en laboratorio; no hay bloqueo de búsqueda de 200 ms en las muestras revisadas.

No repetí la línea base ni desactivé/reactivé filas para el escenario 300/100. No certifico INP/LCP de usuarios, Cloudflare ni rendimiento de producción.

## F4-04b · P2 · La vitrina antigua sobrescribe el precio recién confirmado

**Ubicación:** src/hooks/usePreciosSeleccion.js:29–40 y 82–86; conocidos en ambas páginas concatena filas de vitrina y búsqueda. La vitrina se conserva entre cambios de búsqueda en useCatalogoPublico.

**Causa:** cualquier fila de conocidos se trata como «la más reciente», aunque provenga del snapshot inicial de la vitrina. precioDe prioriza porId sobre la caché, y el efecto vuelve a copiar esa fila a la caché con una marca temporal nueva. Eso no prueba que sus datos hayan sido leídos después del resultado de búsqueda.

**Reproducción, en Producto y Servicio:**

1. Un artículo categorizado y seleccionado está en la vitrina inicial a S/ 20.
2. Una búsqueda posterior confirma ese mismo UUID a S/ 25; la barra muestra S/ 25.
3. Limpiar vuelve a la vitrina que todavía conserva la fila de S/ 20; la barra vuelve a **S/ 20**. No se hace consulta por id porque el registro está entre conocidos.

Datos simulados, sin editar precios reales. A diferencia de la prueba corregida de Claude, el UUID aparece en la vitrina; por eso todavía existe la reversión.

**Corrección recomendada:** resolver precios por identidad y procedencia/versión de lectura. Una fila antigua que vuelve a mostrarse no debe sobrescribir una confirmación posterior. Reconciliar también los snapshots del catálogo o conservar la prioridad real de las lecturas; no usar la hora de render/copia como hora de actualización del dato.

**Regresión:** vitrina antigua → búsqueda nueva → limpiar/volver a ventana anterior, tanto Producto como Servicio, incluidos UUID que también aparecen en héroe/cintas. El total debe conservar el precio confirmado o refrescar explícitamente, sin regresar al viejo.

## F4-05 · P2 · Precio vencido y renovación fallida siguen mostrándose como total válido

**Ubicación:** src/hooks/usePreciosSeleccion.js:46–49, 73 y 82–86; condición pendiente de ambas barras.

El efecto detecta una caché vencida y pide renovar, pero precioDe devuelve guardado.precio sin comprobar vigencia. Tras fallar la renovación, estado pasa a error; como el precio viejo sigue siendo un número, pendiente es false y la barra oculta el aviso y Reintentar.

**Reproducción de Producto:** leer un UUID fuera de vitrina a S/ 20; adelantar Date.now 61 segundos en el navegador; cambiar cantidad a dos; devolver 403 o 500 en la renovación. Se hizo la nueva petición, pero la barra muestra **dos productos/S/ 40**, con **cero botones Reintentar**. Ambas respuestas de error reproducen el defecto.

**Reproducción de Servicio:** un seleccionado fuera de vitrina a S/ 20; vencerlo, añadir un conocido de S/ 10 y fallar la renovación. Muestra **dos servicios/S/ 30**, sin advertencia ni botón. No se cambiaron reloj de servidor, base o RLS.

**Corrección recomendada:** distinguir precio vigente, precio vencido, renovación pendiente y fallida al resolver el total, no solo al decidir consultar. Puede conservarse el dato viejo internamente, pero no presentarlo como total completo y vigente si la renovación falló. Permitir Reintentar y preservar la cantidad seleccionada.

**Regresión:** caché caliente → caducidad → petición pendiente → 403/500/red → recuperación. Cubrir ambas barras y comprobar que el dato viejo no anula los estados de carga/error. No basta probar el primer fallo con caché vacía.

## F4-06 · P2 · Los metadatos completos siguen cortándose en 1.000 categorías

**Ubicación:** src/lib/catalogoPublico.js:118 y 137, las llamadas únicas a *_categorias_publicas, y metadatosCategorias. supabase/config.toml:18 configura max_rows = 1000.

Las tarjetas sí están paginadas, pero los metadatos se leen en una sola RPC sin range ni una estrategia para completar la respuesta. Son funciones que devuelven un conjunto de filas; el límite de PostgREST también se aplica a esa respuesta. El número de ventanas se calcula exclusivamente con el prefijo recibido.

**Reproducción:** datos ficticios de 1.001 categorías; respuesta REST limitada a las primeras 1.000. En Producto y Servicio la barra solo ofrece 1.000, termina en Categoria 0999 y el paginador muestra **100 ventanas**, no 101. Categoria 1000 desaparece de las opciones y de las ventanas accesibles. No sembré 1.001 categorías en la BD; simulé la respuesta truncada en el navegador y revisé la configuración local del límite.

Este es un extremo de crecimiento, no el volumen del negocio. El usuario indica aproximadamente 300 productos en producción; el sistema no tiene una cota de categorías declarada que permita asegurar el contrato «todas» con esta lectura.

**Corrección recomendada:** completar por páginas únicamente los metadatos ligeros, con orden estable y cancelación, o utilizar otro contrato de metadatos que no pierda filas. No aumentar max_rows ni descargar todas las tarjetas. Una respuesta parcial o lectura fallida no debe presentarse como lista completa.

**Regresión:** 999, 1.000 y 1.001 categorías en ambas tablas; última categoría en selector y ventana, conteos íntegros, ninguna tarjeta anticipada y ≤ 40 por ventana. Se puede probar con el SDK real y un fetch simulado que respete la paginación de RPC, además del escenario local pequeño.

## Alcance de las evidencias entregadas

- Revisé los informes de Claude: interfaz 31/31 (seis casos con siembra), barras 9/9 y fotos/sesión 8/8. No los atribuyo como repetición propia: repetí la parte de interfaz de solo lectura y usé un harness independiente para los casos de barras y crecimiento.
- La suite verificar-barras-seleccion.cjs ejecuta DELETE por SQL y recibe una cuenta. No la ejecuté ni reutilicé credenciales. Los nueve casos sanos de Claude no cubren un precio ya vencido, ni un precio viejo que permanece en la vitrina.
- No ejecuté --con-categorias: llama a escenario-catalogo-qa.mjs para sembrar y borrar datos por SQL y suspender disparadores. Los escenarios propios fueron simulados en el navegador. No cerré migraciones ni alteré schema/RLS.
- La caché por sesión está contemplada en el código, pero sigue sin prueba de interfaz real de cambio de cuenta. Los tests actuales no cierran ese límite.
- No hay control negativo independiente de esta entrega que sustituya funciones SQL antiguas. La falta de firma vieja no impide probar ventanas y metadatos con dobles; no requiere volver a cambiar schema para auditar.
- El parche de rollback se validó, no se aplicó. Su lista coincide con los ocho archivos de esta fase y conserva los cambios aceptados del CLI anterior.
- La afirmación «las categorías reales del negocio son ≤ 10» no se verificó en esta auditoría: expresarla como condición, no como conteo observado. El escenario 300/100 continúa siendo sintético.

## Evidencia y siguiente paso

.codex/evidencia-revision-fase4-v2/: verificacion.json (hashes y alcance), interfaz.json, codex-v2-replica.json, diagnosticos.json y diagnosticos.cjs.txt. La fuente diagnóstica se guarda como texto; no se añade un ejecutable al proyecto.

Claude debe corregir F4-04b, F4-05 y F4-06 y añadir sus regresiones. Se conservan las comprobaciones ya aceptadas; repetir lo necesario tras los cambios. No aplicar la migración a producción, publicar ni iniciar Fase 5 con este veredicto. No hubo commit, push o cambios de hosting por Codex.
