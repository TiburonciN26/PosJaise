# Verificación de Fase 3 · quinta revisión de Codex

Fecha local: 9 de octubre de 2026, America/Lima. La evidencia conserva sus fechas en UTC.

**Veredicto: F3-07 CERRADO en las reproducciones revisadas. La implementación LOCAL queda aceptada con observaciones para continuar la validación de R2 real. La Fase 3 completa permanece pendiente: aún no se han verificado bucket, Worker, dominio, CORS, caché ni CPU reales.** Esta aceptación técnica no es una publicación ni una autorización de cambio de producción.

No se modificó código, configuración, dependencias, datos de tablas remotas ni Git. No se instaló nada, activó R2, desplegó recursos ni ejecutó el recolector destructivo. Cuentas QA y fila residual de staging intactas. Solo se genera este informe y evidencia dentro de .codex, conforme a la autorización del usuario.

## Verificación independiente

| Comprobación | Resultado |
|---|---|
| Unitarias | 54/54 |
| Worker local con R2 simulado | 33/33 |
| Capa de medios en Chromium | 24/24 |
| Modales reales con REST en memoria | 55/55 |
| Total de las cuatro suites entregadas | **166/166** |
| Diagnósticos adicionales propios | **11/11** |
| Build Vite de QA, salida externa | Pasa |
| Rollback: git apply -R --check | Pasa; sin aplicar |
| Aislamiento y errores de página en diagnóstico propio | Cero peticiones de datos no simuladas; cero pageerror |

Las cuatro suites se copiaron fuera del proyecto y sus aserciones originales se mantuvieron. Las adaptaciones se limitan a rutas, puertos, binarios ya instalados, caché y limpieza para no generar archivos de prueba en el repositorio. Los datos REST/Storage se interceptaron o simularon; staging solo se usó para login de la cuenta QA existente y autorización es_admin del Worker local. No son pruebas de R2 remoto.

Lint completo: 2 errores y 54 advertencias. Las diez advertencias adicionales son diagnósticos de Codex de V2 dentro de .codex. Excluyendo esa evidencia por argumento temporal, queda la línea base **2 errores y 44 advertencias**; los errores están en tests/e2e/fixtures.mjs:11 y :27, sin cambios. No se cambió la configuración. Las copias de scripts de esta evidencia se guardan como .txt.

Árbol revisado: feat/cloudflare-pages; HEAD 940510543f629df11ce80d558399c7ef32bebb68; main 0dc629e430ed07eeaccec273d31de93e9717d9bf. Las fuentes permanecieron estables durante esta verificación; metadatos.json conserva hashes SHA-256. No hay commit/push de Codex.

## Cierre de F3-07

### Cuatro estados del helper

Se ejecutó el módulo real src/lib/resultadoBd.js en el navegador con un simulador de lectura:

| Respuesta | Resultado observado |
|---|---|
| Fila presente con el campo esperado | coincide |
| Fila presente con otro valor | difiere, junto con la fila real |
| Lectura exitosa sin fila | ausente |
| GET interrumpido | desconocido |

No se confunde diferencia con ausencia. Galería conserva los archivos cuando la fila existe con otro par o valores. La foto principal de Producto/Servicio inspecciona foto_url antes de limpiar tras una duda previa: conserva lo referenciado o desconocido. El helper anterior filaCoincide ya no se importa en esos consumidores.

### Bloqueo y recuperación en el modal real

Tras un INSERT confirmado cuya respuesta y lectura se pierden, los dos inputs de foto, título, orden y el botón de visibilidad quedaron deshabilitados mediante fieldset. El aviso de pendiente se mostró y no se emitió éxito. Al recuperar la lectura y reintentar, se conservaron la fila y las referencias, se habilitaron los cinco controles y hubo un solo evento de éxito.

### Reproducción V4, variante simétrica y edición

Además del bloqueo normal de UI, el diagnóstico elimina explícitamente disabled del fieldset SOLO en el DOM del arnés de pruebas, para verificar que la lógica de limpieza también protege las fotos si se elude esa barrera. No se modifica el código fuente.

| Caso tras guardado incierto y rechazo 403 | Fila | Fotos referenciadas | URLs | Éxitos falsos |
|---|---|---|---|---|
| Alta A/B, cambiar solo después por C | Intacta | Ambas conservadas | 200 / 200 | 0 |
| Alta A/B, cambiar solo antes por C | Intacta | Ambas conservadas | 200 / 200 | 0 |
| Edición A1/B0, cambiar la otra foto | Intacta | Ambas conservadas | 200 / 200 | 0 |

Estos son los tres casos que antes podían borrar una foto todavía referenciada. Ahora pasan. Los detalles están en regresiones-independientes.json. La evidencia negativa de mi revisión V4 (fila intacta, foto antes eliminada y GET 404) se conserva en .codex/evidencia-fase3-codex-v4; no se sobrescribió ni reinstaló código viejo en el proyecto. Claude declara un control negativo adicional; no lo presencié ni lo reejecuté. El cierre se apoya en mis reproducciones anteriores y en la ejecución independiente del código corregido.

### Campos editoriales y rechazo explícito

La suite entregada cubre el cambio de etiqueta de Producto durante la incertidumbre. Añadí el equivalente para Servicio: cambiar Resultado por Antes conserva la misma fila y referencia, aplica un PATCH y termina con foto existente y un único éxito.

Las 55 pruebas de modales también conservan las regresiones previas: respuesta perdida con y sin commit, reintentos 23505 con GET aún caído, recuperación posterior, foto principal, doble envío y rechazos explícitos sin incertidumbre previa. El control de Galería 403 sin duda previa limpia las dos fotos nuevas y no deja bloqueado el formulario.

## Estado y límites

No quedan bloqueos reproducidos de F3-07 en el alcance de esta revisión. F3-01 a F3-09 conservan sus aceptaciones locales previas y las condiciones del recolector. Los cambios respecto de V4 se concentran en helper/galería, los tres modales y sus pruebas; el Worker, validador, capa de imágenes/medios y recolector mantienen los hashes revisados anteriormente.

Una foto nueva no referenciada que se conserva por duda puede quedar como huérfana. Es una limitación aceptada para esta etapa; no se prueba ni habilita aquí su eliminación real. El recolector mantiene la retención y consulta puntual, pero conserva la ventana entre consulta y DELETE; su uso destructivo sigue condicionado a un modo operativo sin ediciones o coordinación más fuerte. No afirmar atomicidad ni automatización ya existente.

La aceptación completa de Fase 3 todavía requiere:

1. R2 y Worker reales en un entorno de prueba, asociados a staging; verificar subidas, autenticación/autorización, rechazo de archivos y lectura de fotos desde Pages.
2. Dominio de medios y CORS reales; medir HIT/MISS de caché, lecturas y CPU del Worker.
3. Muestra de fotos reales del catálogo y verificación de objetivos de peso; Firefox, Safari/iOS y móvil físico según la guía.
4. Definir la purga de caché al borrar y el funcionamiento operativo del recolector.
5. Preparar/verificar migración inversa o un rollback que siga leyendo r2: antes de escribir referencias en datos del negocio.

No se avanzó de fase, tocó main/GitHub Pages ni escribió referencias r2: en el Supabase del negocio. La fila residual ficticia de staging y las cuentas QA permanecen intactas. La implementación revisada corresponde a fotos; no certifica soporte de videos.

**Siguiente paso: registrar el cierre LOCAL de F3-07 y preparar las pruebas de R2 real.** No hace falta otra ronda de cambios para los fallos locales ya corregidos, salvo que una prueba nueva revele un problema concreto. No corresponde retirar GitHub Pages ni iniciar cargas del negocio en este punto.
