# Verificación Fase 5 · V3

Fecha: 2026-10-11, America/Lima. Proyecto: C:/WedJaiseReact. Base HEAD: `6929c619e88a91434cb16ee6a8d2de90de94c091`, rama `feat/cloudflare-pages`. Cambios locales sin commit. Entrega revisada: `.codex/ENTREGA-FASE5-CORRECCIONES-V2.md`.

## Veredicto

**FASE 5 APROBADA CON OBSERVACIONES, solo para la implementación y QA LOCAL.**

F5-02b y F5-04b quedan cerrados en las reproducciones revisadas. Se mantienen los cierres previos de F5-01, F5-03 y F5-05. No quedan hallazgos bloqueantes abiertos de estas revisiones para el alcance local probado.

Esta aprobación no incluye commit, push, staging, migraciones remotas, producción ni cambios de hosting. Tampoco inicia la Fase 6. Las limitaciones de Unicode y la precisión de permisos de la utilidad SQL se detallan abajo; no se certifica equivalencia universal ni una matriz completa de roles del negocio.

## F5-02b · Cerrado

Se repitió el cambio directo A→B **con Programa montado**, sin render intermedio de sesión nula, mediante contextos simulados en el navegador. Esto complementa el logout/login real que informó Claude.

| Escenario | Resultado independiente |
| --- | --- |
| Configuración confirmada de Programa | Tasa inicial 1 |
| A escribe 77 y cambia de subpestaña y vuelve | Conserva 77 |
| Identidad A→B, Programa montado | B ve 1, no el borrador 77 |
| B desmonta y vuelve a Programa | Sigue viendo 1 |
| Protección: A escribe 77, cambia a B | Las filas abiertas se cierran; al abrir, campo vacío |
| Protección: B→A sin editar con B | Vuelve cerrado; al abrir, vacío: no resucita el borrador 77 |

El reinicio condicionado del almacén y las keys por identidad resuelven las dos causas de V2. No aparecieron errores de página. No se guardaron formularios ni se enviaron mutaciones a Supabase.

Alcance: componentes reales servidos por Vite, contextos y datos simulados. No es un segundo recorrido de extremo a extremo con cuentas reales. El caso directo sin sesión nula sí queda ahora probado mediante el diagnóstico independiente, además de la revisión de código.

## F5-04b · Cerrado para las reproducciones y el alcance probado

Se llamó la **función realmente instalada en Local**, `public.normalizar_busqueda(text)`, mediante SELECTs de constantes. No se creó ninguna fila de cliente/cupón ni se reaplicó la migración.

**17/17 cadenas** devolvieron la misma normalización que el cliente real y una coincidencia ILIKE correcta con el patrón literal escapado:

- María, Peña, José Perez y Ångela, en NFC y NFD.
- Ørsted Ł, secuencia de tildes compuestas/descompuestas.
- `_100%`, apóstrofo, coma/paréntesis/comillas, barra inversa, diacríticos sueltos y espacios externos ASCII.

La referencia es `normalizarBusqueda()` del cliente sobre las cadenas originales, no la columna SQL que se verifica. Las constantes ficticias y sus puntos de código están en la evidencia. Con esto dejan de reproducirse los casos que fallaban en V2.

Se repitió también la comparación exhaustiva informada por Claude:

- 63.456 puntos de código BMP, desde 32 hasta 65535, excluidos sustitutos.
- Patrón `x + carácter + Y` para comparar cada resultado.
- **63.448 iguales y 8 diferentes**, exactamente los mismos: U+1C89, U+A7CB, U+A7CC, U+A7CE, U+A7D2, U+A7D4, U+A7DA y U+A7DC.
- Runtime de referencia: Node v24.14.1, Unicode 17.0.

La función ya normaliza primero a NFD y elimina la clase de diacríticos generada. Usa SQL puro, `search_path=pg_catalog`, es invoker (`prosecdef=false`) e immutable. No introduce una lectura privilegiada de datos.

### Observación de Unicode, no bloqueante para el alcance local probado

No afirmar «igual para todo Unicode». Las ocho diferencias de minúsculas están confirmadas; los diacríticos suplementarios fuera del BMP no están incluidos. El ensayo BMP `x+c+Y` tampoco prueba por sí solo todas las combinaciones, espacios Unicode en los bordes o todas las cadenas posibles. `btrim()` y `.trim()` no deben presentarse como equivalentes universales sin probar sus conjuntos de espacios.

Los nombres y códigos comunes de las reproducciones anteriores ya funcionan. Estas excepciones quedan expresamente documentadas y no vuelven a abrir F5-04b en este alcance local. Si el negocio usa alguno de esos caracteres, ampliar/ajustar el contrato antes de certificar esa búsqueda en producción. No se inspeccionaron nombres reales de producción para afirmar que no los usa.

## Comprobaciones adicionales

- Dos controles de error/reintento de Promociones se mantienen correctos: una página 2 fallida conserva la etiqueta de Página 1 y aviso; al reintentar carga Página 2. Una búsqueda fallida no muestra filas anteriores ni paginador; el reintento recupera un resultado con el total correcto.
- Catálogo público, con y sin replay StrictMode: termina de cargar, sin errores. En desarrollo con replay hace dos peticiones públicas, coherente con invalidar la primera y resolver la segunda; no se desactiva StrictMode.
- **6 escenarios de navegador** en esta revisión (cuatro de borradores/reintento y dos de catálogo público), todos sin `pageerror` ni errores del harness.
- **9/9 controles del SDK real**: siete con fetch simulado para construir consultas y verificar rangos/orden/filtros/conteos; dos SELECT anónimos a Local vuelven a denegar ambas vistas con 42501 / HTTP 401.
- Vistas locales: `security_invoker=true`, SELECT denegado a anon y permitido a authenticated. El puerto 54321 se verificó en el contenedor Kong de WedJaiseReact.
- Conteos observados: 429 pedidos y 208 promociones. Cero clientes/promociones/cupones/reseñas con los prefijos QA F5 examinados. Esto no prueba igualdad de toda la base.
- Lint de RecompensasWeb, listasAdmin y useListaPaginada: exit 0, sin diagnósticos.
- `git apply -R --check .codex/evidencia-fase5/parche-fase5-modificados.patch`: correcto, nunca aplicado; **13 archivos**. La cifra documental quedó corregida. El rollback de la migración contempla retirar las vistas antes de `normalizar_busqueda(text)`, por sus dependencias.
- El JSON `verificacion-despues-v3.json` registra **34/34**, sin fallo global. Es evidencia de Claude, auditada pero no ejecutada de nuevo por Codex: su suite siembra/limpia por SQL y cambia triggers, fuera del rol de Codex.
- Los hashes comparados con V2 muestran cambios en RecompensasWeb y en la migración; los archivos fuente de los cierres previos F5-01/F5-03/F5-05 y de Inicio permanecen iguales en esa comparación.

No se ejecutó un build que sobrescribiera dist ni se repitió el laboratorio de rendimiento. Las cifras antes/después siguen siendo de Claude. La nueva función puede tener un costo SQL que se debe medir con las consultas finales y roles en Fase 7; no se acredita ese costo mediante el ensayo de constantes ni por la reducción del DOM.

## Observación de permisos de la utilidad SQL

La entrega dice «EXECUTE solo authenticated», pero el estado real no coincide:

- ACL de la función: postgres, anon, authenticated y service_role tienen EXECUTE.
- `has_function_privilege('anon', ..., 'execute')` devuelve true.
- Una llamada sin sesión a `normalizar_busqueda` en Local, con la constante ficticia María NFD, responde **200 / maria**.

Revocar PUBLIC no elimina el grant directo a anon que aparece en la ACL. Es una precisión del contrato/permisos de esta **utilidad pura**: su cuerpo solo transforma el argumento, no consulta tablas ni devuelve datos del negocio. Las vistas administrativas siguen denegadas a anon. Por eso no es un nuevo bloqueo funcional ni una exposición de datos protegidos que impida el cierre local.

Antes de trasladar la migración a un entorno remoto, Claude debe alinear su ACL con la política declarada (revocación explícita del permiso de anon si se mantiene «solo authenticated»), o documentar deliberadamente que la utilidad es pública y por qué. No cambiar los permisos/RLS de las tablas o vistas para resolver esta discrepancia. Codex no modificó ningún grant.

## Evidencia y límites

Carpeta nueva: `C:/WedJaiseReact/.codex/evidencia-revision-fase5-v3/`.

- `borradores-y-reintento.json` y `diagnosticos-adicionales.json`: resultados de Chromium con componentes reales y dependencias simuladas.
- `normalizacion-nombres.json`: 17 cadenas y resultados de la función real.
- `normalizacion-bmp.json`: resumen exhaustivo y las ocho diferencias concretas.
- `normalizacion-permisos.json`: comprobación anónima de la utilidad, solo con texto ficticio.
- `sdk-listas.json`: nueve controles del SDK, con sus alcances de red indicados.
- `estado-revision.json`: HEAD, hashes, metadatos/ACL/vistas/conteos y auditoría de la suite/rollback.
- Copias de los scripts externos como `.txt`, sin añadir ejecutables al proyecto.

No se certifican staging/producción, cajera/asistente con sesiones reales, Safari/Firefox/móvil ni rendimiento de campo. Las tareas de montaje inicial y los pendientes de infraestructura de fases anteriores mantienen sus alcances respectivos. Los miles de registros son de la réplica local; el usuario informa unos 300 productos del negocio, sin conteo independiente de producción.

Codex no cambió código, configuración, dependencias, datos, esquema, Git ni hosting. Solo generó este informe y evidencia nueva en `.codex`, conforme a la instrucción persistente del usuario.

## Siguiente paso para Claude

Registrar **Fase 5 aprobada con observaciones, solo local** y enlazar este veredicto. Preparar una lista explícita de archivos de Fase 5 separada de Fases 3/4, si el usuario quiere publicar después. Conservar los límites Unicode y resolver/documentar la ACL de la utilidad antes de una migración remota.

No hacer commit/push, aplicar migraciones remotas ni comenzar Fase 6 a partir de esta aprobación. La siguiente fase requiere la indicación del usuario conforme a la guía. No hace falta un push solo para archivar esta revisión.
