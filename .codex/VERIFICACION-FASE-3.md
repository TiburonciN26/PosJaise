# Revisión de Fase 3 · imágenes nuevas en R2

Fecha: 9 de octubre de 2026 (America/Lima).

**Veredicto: REQUIERE CORRECCIONES; Fase 3 NO APROBADA todavía para publicación.** La base de autorización y almacenamiento funciona en pruebas locales, pero se reprodujeron fallos de validación de contenido, recuperación de reintentos y guardado/limpieza. La ausencia de R2 real es una limitación adicional; habilitarlo no corrige esos fallos.

Las fases anteriores y el cierre de O1 conservan sus veredictos. No se hizo commit/push, habilitación de R2, despliegue, cambio de producción ni limpieza de recursos remotos.

## Verificación ejecutada

- Build actual con proveedor R2 configurado para un endpoint ficticio: pasa. Salida y diagnóstico fuera del proyecto, con configLoader native; sin instalar dependencias.
- **33/33** comprobaciones del Worker repetidas con Wrangler ya instalado, R2 local simulado y login/lecturas de las cuentas QA de staging.
- Se usó una copia aislada del Worker y del test: mismos casos, con cambios únicamente de rutas, puerto, lanzamiento del binario instalado y limpieza de archivos desactivada. No se escribieron .dev.vars ni estado en el repositorio.
- Pruebas adicionales contra el código real del Worker y cliente con fetch/R2 en memoria: archivo inválido aceptado y respuesta perdida después de escribir.
- Handlers/loops originales de galería, Producto y Servicio ejecutados en VM con subida/BD simuladas: fallos de limpieza y error de insert ignorado.
- La evidencia de Claude de **15 casos en navegador** fue revisada, no repetida: su script modifica archivos del proyecto y crea/borra filas en Supabase de staging. Las instrucciones de Codex solo permiten escribir datos Supabase cuando se verifica el endpoint Local. Codex no ejecutó esas mutaciones remotas ni alteró fuentes para probar los fallos.

El diagnóstico adicional no pretende reproducir límites, latencia o CPU de Cloudflare. Los mocks ejercitan las decisiones del código; el test del Worker usa el runtime local real y autorización contra staging.

## F3-01 · Se publica un archivo que no es una imagen decodificable

**Severidad: alta/P1. Corregir antes de desplegar el Worker.**

Archivo: cloudflare/medios-worker/src/validar-imagen.js:25–61; publicación en src/index.js:140–154.

La validación comprueba RIFF/WEBP, tamaño total y dimensiones del primer fragmento. En VP8X no exige que exista un fragmento de imagen VP8/VP8L ni recorre la estructura del contenedor.

Reproducción propia:
- Archivo de 30 bytes: cabecera RIFF/WEBP, VP8X de 10 bytes, dimensiones 128×128; **sin datos de píxeles**.
- inspeccionarWebp devuelve ok=true.
- Chromium rechaza createImageBitmap del mismo archivo.
- Worker.fetch devuelve **201** y llama al put del R2 simulado: el objeto queda almacenado.

No se demostró ejecución de HTML/XSS ni una evasión del rol admin. El fallo es aceptar contenido malformado y permitir una referencia a una imagen rota. Las 33 pruebas normales no cubren este caso.

**Corrección para Claude:** validar la estructura completa del contenedor: longitudes, límites y padding de chunks, chunks de imagen obligatorios, flags/coherencia del formato y dimensiones efectivas. No afirmar validación completa por una cabecera. Si para garantizar decodificabilidad se requiere otro procesamiento, diseñarlo con límites y coste explícitos; no añadir decodificación ilimitada al Worker.

**Aceptación:** rechazar VP8X sin imagen, chunks truncados/longitudes falsas y dimensiones incoherentes antes de put; aceptar WebP reales opacos, con alfa y lossless de los navegadores admitidos. Comprobar que las imágenes aceptadas decodifican. [Especificación oficial del contenedor WebP](https://developers.google.com/speed/webp/docs/riff_container).

## F3-02 · Recuperación de respuesta perdida incompatible con solo-crear

**Severidad: media/P2. Corregir antes de aprobar el flujo de subida.**

Archivos: src/lib/medios.js:77–96 y 124–137; Worker src/index.js:148–154.

El servidor guarda con condición solo-crear y el cliente reintenta errores de red con el mismo UUID. Si la escritura terminó pero se perdió la respuesta, el siguiente intento encuentra el objeto y responde 409. El cliente lo trata como fallo definitivo y elimina la operación.

Reproducción propia, con WebP generado por Chromium:
- Sin fallo: m=201, g=201; devuelve referencia y quedan 2 objetos.
- Respuesta de m perdida después de guardar: m=201 → error de red → m=409 → DELETE; no devuelve referencia.
- Respuesta de g perdida: m=201, g=201 → error de red → g=409 → DELETE; no devuelve referencia.

Esto no borra la foto anterior ya referenciada: el UUID era nuevo. Sí convierte una escritura recuperable en un error y hace que los reintentos prometidos fallen en una situación real de red móvil.

**Corrección:** definir recuperación/idempotencia de la operación. Confirmar si el mismo objeto ya guardado pertenece a la misma operación y coincide en contenido/variante antes de considerarlo éxito. Puede requerir un identificador de operación, checksum y endpoint de estado/finalización. Mantener 409 ante contenido distinto y la prohibición de sobrescribir; no habilitar upsert indiscriminado.

**Aceptación:** respuesta perdida después de m y después de g termina en una referencia válida, sin duplicados ni borrado prematuro; contenido diferente en la misma clave sigue rechazado. [Operaciones condicionales de R2](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).

## F3-03 · Fallos de varias fotos y BD todavía dejan huérfanos o éxito parcial silencioso

**Severidad: alta/P1. Corregir antes de activar R2 en los consumidores.**

1. ModalGaleriaWeb.jsx:141–150: si “antes” se sube y “después” falla, el catch no limpia lo ya subido. El nuevo cleanup solo está en errorGuardado de BD.
   - Diagnóstico: dos objetos de “antes” quedan; 0 llamadas de cleanup; no se llega a BD.
2. ModalProducto.jsx:395–408 y ModalServicio.jsx:358–371: insert de producto_fotos/servicio_fotos devuelve error como resultado normal. No se inspecciona y el catch no lo recoge.
   - Diagnóstico en ambos loops: insert devuelve error 42501; una referencia subida, 0 cleanup, ninguna excepción propagada.
   - El flujo luego puede llamar onGuardado sin mostrar que falló la foto.
3. Delete/update de galerías adicionales también ignora sus resultados. Al quitar filas se debe coordinar la eliminación del objeto: en los bloques actuales no se elimina su archivo R2 tras confirmar el delete de la fila.

Los problemas de Producto/Servicio ya existían en esos llamadores; no se atribuyen a una modificación de esos modales en esta fase. Sin embargo, ahora son consumidores del nuevo proveedor y el plan exige manejar estos fallos de extremo a extremo. No tocarlos no evita el problema.

**Corrección:** coordinar subidas nuevas, guardados y cleanup en todos los llamadores. Examinar error de Supabase en insert/update/delete; conservar la foto anterior hasta confirmar el reemplazo. Si el producto ya se guardó pero fallaron fotos adicionales, mostrar un resultado parcial claro y una vía de reintento, sin fingir éxito completo. Limpiar los objetos de una primera foto si la segunda falla, o registrar una operación recuperable.

**Aceptación:** probar desde los modales Producto, Servicio y Galería: fallo de segunda foto, insert/update/delete fallido, reemplazo y reintento. Cero referencias a archivos ausentes; objetos sobrantes limpios o registrados para recuperación; foto anterior conservada. No guardar datos reales para probarlo.

## F3-04 · Eliminaciones fallidas y retención sin implementación

**Severidad: media/P2. Condición antes de carga masiva/producción.**

eliminarImagenR2 informa false, pero los consumidores no usan ese resultado. No hay recolector ni operación persistente pendiente; el comentario de medios.js que dice que “lo recoge la política de retención” describe algo que todavía no existe.

Definir e implementar seguimiento/recuperación de borrados fallidos y una política de huérfanos con retención. Un inventario de solo lectura puede ser una primera herramienta, pero no constituye un recolector. Proteger objetos con referencias vigentes y operaciones todavía en curso; no borrar por antigüedad a ciegas.

También falta definir invalidación del dominio/CDN cuando se elimine una URL con caché immutable. Borrar en R2 no es una garantía de desaparición inmediata de las copias en caché.

## Lo que sí funciona dentro de las pruebas observadas

- Sesión vigente y es_admin con token del usuario; sin sesión/token alterado 401, cajera/cliente 403.
- Destinos cerrados: productos, servicios y galería. Destinos privados rechazados.
- Topes de bytes y dimensiones; PNG con MIME falso y HTML rechazados.
- CORS de orígenes exactos, sin comodín.
- Claves versionadas y protección contra sobrescritura.
- GET de desarrollo, ETag/304 e idempotencia del DELETE.
- Prefijo r2 diferenciado de referencias antiguas; separación de los destinos privados en el cliente.
- Dependencias del Worker aisladas; package.json/lock de la app no cambiaron.
- La galería principal sí añadió cleanup para el fallo de BD después de subir ambas fotos; falta el fallo previo y los otros consumidores.

## Desviaciones y condiciones reales pendientes

- **Dos variantes** no son un bloqueo por sí mismas: 320 y el detalle actual pueden ser adecuados sin ampliar originales. Validar tamaños CSS/DPR, peso y legibilidad con fotos representativas antes de cerrar la fase; las fotos de ~2 KiB no acreditan objetivos de peso reales.
- **Solo WebP:** documentar navegadores admitidos y el comportamiento de fallback; la subida JPEG original puede convertirse antes de R2. No confundir extensión con contenido.
- **Proveedor r2 incompleto:** subidasNuevasEnR2 retorna false si falta API/public URL y cae a Supabase. Mostrar/validar la configuración para que el operador no crea que usa R2 cuando no está configurado.
- **Rollback:** los cambios no tienen commit de fase; git revert genérico no es ejecutable aún. Preparar diff/parche o commit aislado, conservar las URLs/configuración necesarias para leer referencias ya guardadas y un build de rollback compatible. Volver a un frontend que no entiende r2 rompe esas fotos.
- Antes de escribir referencias R2 en el negocio, el rollback a GitHub Pages debe poder leerlas. No cambiar datos del negocio ni retirar el hosting actual en esta etapa.
- R2 real, dominio, CORS desde Pages, caché HIT/MISS, CPU del Worker y flujo UI completo siguen pendientes. El error 10042 es el bloqueo reportado por Claude; Codex no habilitó ni contrató R2 para esta revisión.

## Costos y permisos

Las cifras R2 Standard de la entrega coinciden con la documentación consultada: $0.015/GB-mes, $4.50/M operaciones A, $0.36/M B; franquicia mensual 10 GB-mes/1 M A/10 M B y egress gratis. El total depende del uso y de otras cargas de la cuenta, no es una promesa de coste cero. [Precios oficiales de R2](https://developers.cloudflare.com/r2/pricing/).

Workers Free tiene 100.000 peticiones/día y 10 ms de CPU por petición; espera de red no es CPU. No se midió el presupuesto real del servicio ni se contrató un plan. [Límites oficiales de Workers](https://developers.cloudflare.com/workers/platform/limits/).

No se conceden permisos nuevos por este veredicto. El usuario decide habilitar R2, dominio y despliegue cuando la implementación sea revisable; primero corresponde corregir los fallos locales. Si el dashboard exige pago/contrato, se revisa en ese paso, no se presupone autorización para contratar.

## Entrega para Claude

> Fase 3 todavía no aprobada. Codex repitió 33 pruebas del Worker y el build (pasan), pero reprodujo tres fallos adicionales: VP8X de 30 bytes sin píxeles aceptado y almacenado aunque Chromium lo rechaza; respuesta perdida tras put causa reintento 409 y DELETE; galería “antes” queda huérfana si falla “después”, e insert de producto_fotos/servicio_fotos ignora error devuelto y no hace cleanup. Corrige validación completa, recuperación idempotente y coordinación de todos los llamadores. Implementa/define recuperación de eliminaciones y huérfanos con retención. Añade los negativos y pruebas de los modales, con datos ficticios/aislados. Entrega rollback preciso y límites de peso/compatibilidad. No solicites todavía publicación como si la fase estuviera aprobada; R2 real y sus métricas siguen pendientes. No hacer commit/push, activar recursos, cambiar producción o limpiar QA por esta revisión.

## Evidencia propia

[Carpeta de evidencia](C:/WedJaiseReact/.codex/evidencia-fase3-codex):

- worker-33-codex.json: repetición de casos del Worker en copia aislada.
- validacion-y-reintentos.json: archivo inválido, decode de Chromium, Worker/cliente y respuestas perdidas.
- fallos-guardado.json: rutas originales de guardado con fallos de subida/BD simulados.
- build.log: build con configuración R2 ficticia, fuera del proyecto.

El código y estado de los diagnósticos se mantuvieron fuera del repositorio. No se copiaron .env ni .dev.vars a esta carpeta; los informes no incluyen contraseñas, tokens ni valores de claves.
