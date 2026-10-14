# Revisión Fase 5 · V2

Fecha: 2026-10-11, America/Lima. Proyecto: C:/WedJaiseReact. Base: `6929c619e88a91434cb16ee6a8d2de90de94c091`, rama `feat/cloudflare-pages`, cambios locales sin commit. Entrega revisada: `.codex/ENTREGA-FASE5-CORRECCIONES-V1.md`.

## Veredicto

**RECHAZADA para el cierre local de la Fase 5.** Las reproducciones iniciales mejoraron y quedan cerrados F5-01, F5-03 y F5-05. El caso original de F5-02 (cambiar de subpestaña) está resuelto, pero falta invalidar correctamente Programa al cambiar de cuenta. La búsqueda resuelve las tildes compuestas probadas por Claude, pero sigue sin equivaler al normalizador anterior para texto Unicode descompuesto.

Hay **dos pendientes P2**, F5-02b y F5-04b. Corregirlos en local y entregar V3. No se autoriza avanzar a Fase 6, publicar, confirmar/subir código ni aplicar migraciones remotas por este veredicto.

| Hallazgo V1 | Resultado de V2 |
| --- | --- |
| F5-01, página/filtro fallidos presentados como nuevos | Cerrado en las reproducciones y reintentos verificados |
| F5-02, borradores al cambiar de subpestaña | Caso original cerrado; pendiente F5-02b por cambio de cuenta |
| F5-03, identidad B sin recursos | Cerrado: B consulta saldo y cupones sin tocar pestañas, con A fallida/lenta |
| F5-04, búsqueda con y sin tildes | Compuestos comunes corregidos; pendiente F5-04b para Unicode descompuesto y equivalencia anterior |
| F5-05, catálogo público bajo StrictMode | Cerrado: carga termina con StrictMode habilitado |

## Comprobaciones independientes

- **13 escenarios de componentes reales en Chromium**, servidos por Vite en localhost:5173, con BrowserRouter y datos/contextos simulados: siete repeticiones de V1, cuatro controles adicionales de borradores/reintento y dos controles del catálogo público. Los trece terminaron sin errores de página ni errores del harness en la corrida final. No se simularon cobros ni se enviaron escrituras a Supabase.
- **9/9 controles del SDK real**: siete con fetch simulado verifican rango, filtro, columnas normalizadas, orden y conteos. Dos SELECT anónimos reales contra Local vuelven a denegarse en las vistas con `42501` / HTTP 401.
- **12 cadenas ficticias** comparadas mediante SELECT de constantes en Postgres Local entre la expresión exacta de `translate()` de la migración y `normalizarBusqueda()` del cliente. Se comprobó también la coincidencia ILIKE, no solo la igualdad de cadenas normalizadas. Se usó el normalizador real, equivalente al de HEAD antes de Fase 5, como referencia independiente.
- Las vistas locales siguen con `security_invoker=true`, SELECT de anon denegado y de authenticated concedido. Las dos nuevas columnas de búsqueda están instaladas. Se verificó el puerto 54321 del contenedor Kong de WedJaiseReact antes de consultar.
- Conteos observados: 429 pedidos y 208 promociones; cero clientes/promociones/cupones/reseñas con los prefijos QA F5 examinados. Esto no acredita una igualdad de todas las filas de la base.
- Lint de los seis archivos de aplicación afectados por esta corrección: exit 0, sin diagnósticos. No se ejecutó build ni lint global.
- `git apply -R --check .codex/evidencia-fase5/parche-fase5-modificados.patch`: correcto, **sin aplicarlo**. El parche contiene **13 archivos**, no 12. Sus nombres excluyen los archivos de Fase 4 y los del CLI de Fase 3; `implementacionesWed.md` se trata aparte por la sección 48.
- Se revisó el JSON `verificacion-despues-v2.json`: registra 32/32, sin fallo global. **Es evidencia de Claude**, no una reejecución de su suite por Codex: su siembra/limpieza usa SQL mutante y desactivación de triggers. No se repitió rendimiento; las mediciones anteriores siguen siendo de Claude.

Los cambios de documentación de RLS e Inicio se corroboraron en el código. No hace falta repetir todo el laboratorio para corregir estos dos pendientes, pero sí agregar sus regresiones y revisar las suites afectadas.

## F5-02b · Programa muestra el borrador de otra cuenta y el almacén conserva al dueño anterior

Prioridad: **P2**. Archivos: `src/pages/RecompensasWeb.jsx:860–877`, `1038–1060` y `1266`.

### Reproducción

Pantalla real RecompensasWeb, subpestaña Programa, contextos de identidad ficticios A/B y configuración del servidor simulada:

1. La tasa «Servicios: monedas» inicia en `1`.
2. A escribe `77`, va a Catálogo de monedas y vuelve: sigue en `77`. Este control acredita que la conservación entre subpestañas **sí** está corregida.
3. Cambiar la identidad A→B **con la pantalla y Programa montados**, sin guardar y sin render intermedio de sesión nula.
4. B sigue viendo **`77`**, el borrador de A.
5. Desmontar Programa y volver a abrirlo como B: muestra `1`, la configuración confirmada. Eso distingue el borrador anterior de un dato del servidor.

Otra reproducción, en Protección de servicios: A escribe 77 → B ve vacío → volver a A sin editar con B devuelve **77**. El comentario del almacén dice que el borrador anterior se descarta al cambiar de dueño, pero solo se oculta: el estado conserva `{dueno:A, datos:...}` hasta que alguien escribe.

### Causa

`useAlmacenBorradores` devuelve un objeto vacío al detectar un dueño distinto, pero no invalida el almacén guardado. Más directamente, Programa inicializa `f` con `useState` una sola vez y lo sigue mostrando cuando cambia `almacen`; su key solo depende de `config.actualizado_en`, no del dueño. Por tanto, vaciar lo que devuelve `leer()` no reinicializa el formulario ya montado.

Esta prueba usa una actualización controlada del contexto, no dos logins reales. No demuestra un acceso indebido a otra fila de la base; demuestra un borrador local anterior visible y potencialmente guardable por la identidad nueva. Es el caso de cuenta con pantalla montada que la fase requiere cubrir.

### Corrección recomendada y aceptación

- Vincular también el formulario montado de Programa a la identidad, y limpiar/invalidatear los borradores al cambio de dueño o cierre de sesión según el contrato acordado.
- Mantener la conservación al plegar, paginar y cambiar de subpestaña **dentro de la misma cuenta**.
- No corregirlo montando permanentemente todos los detalles.
- Regresiones: Programa A escribe → B sigue en Programa y no ve el borrador de A; Protección A→B→A sin editar con B no resucita un borrador declarado descartado; logout/login; dos tipos de Protección; guardado confirmado. Verificar que B no pueda enviar los valores locales de A.

## F5-04b · `translate` no equivale a NFD y quitar diacríticos

Prioridad: **P2**. Archivo: `supabase/migrations/20261011000002_vistas_listas_admin.sql:44–45`, consumido por `src/lib/listasAdmin.js:66–82`.

### Reproducción en Postgres, sin crear filas

Se ejecutó exactamente `lower(translate(s, tabla_origen, tabla_destino))` con las tablas de traducción de la migración y se comparó su ILIKE con el patrón producido por el normalizador real del cliente:

| Texto almacenado ficticio | Representación | Búsqueda normalizada | ¿Lo encuentra ahora? | Comportamiento anterior |
| --- | --- | --- | --- | --- |
| María | NFC, í como U+00ED | maria | Sí | Sí |
| María | NFD, i + U+0301 | maria | **No** | Sí |
| Peña | NFC, ñ como U+00F1 | pena | Sí | Sí |
| Peña | NFD, n + U+0303 | pena | **No** | Sí |
| José Perez | NFC | jose perez | Sí | Sí |
| José Perez | NFD, e + U+0301 | jose perez | **No** | Sí |
| Ångela | NFC, Å como U+00C5 | angela | **No** | Sí |

NFC y NFD pueden verse idénticos para la persona. El texto almacenado no se normaliza al escribirlo por esta corrección. El cliente sí elimina las marcas del término, mientras la vista conserva marcas combinantes y letras no incluidas en la tabla fija. Afecta tanto nombres como códigos con ese texto.

**Precisión:** el caso NFD «José» buscado solo como `jose` sí coincide porque el `%` final absorbe la marca después de la e. No se afirma que toda cadena NFD falle. Las reproducciones que bloquean son las marcas **interiores** de María/Peña o antes del espacio en José Perez, y Å no incluida en la tabla. La evidencia registra los puntos de código y la coincidencia ILIKE explícita.

Los 20 términos de Claude cubren bien tildes comunes compuestas y escape de caracteres. Su referencia de total utiliza las columnas `*_busqueda` ya transformadas; no detecta por sí sola que un nombre se haya normalizado de forma distinta al contrato anterior. Agregar una referencia independiente sobre las cadenas originales.

### Corrección recomendada y aceptación

Alinear la normalización del dato del servidor y del término con el comportamiento anterior, incluyendo representaciones canónicas compuestas/descompuestas. No basta añadir dos nombres a la tabla de prueba ni normalizar solo el texto del input. Mantener filtros/rangos/conteos en servidor, escape literal y `security_invoker`; no ampliar RLS ni descargar toda la tabla. Claude decide la implementación local sin que Codex aplique SQL.

Regresiones: pares NFC/NFD de María, Peña y José Perez; códigos y nombres; coincidencias con y sin tildes; un caso fuera de la tabla fija como Å; y los caracteres especiales ya cubiertos. Comparar contra `normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase()` sobre las cadenas originales, no contra la misma columna SQL que se está validando.

## Cierres corroborados

- F5-01: error en página 2 conserva etiqueta Página 1, muestra alerta y Reintentar. El reintento sano muestra Página 2 y Promo 41. La búsqueda fallida deja cero filas anteriores y ningún paginador; su reintento recupera un resultado y total exacto. Los rangos sanos siguen siendo 40/40/1.
- F5-02 original: servicios y productos conservan 77 al plegar y al ir a Programa y volver. Programa también conserva su borrador dentro de la misma identidad. Ese progreso no se revoca por F5-02b.
- F5-03: al pasar a B en Mis cupones con saldo de A fallido o pendiente, B pide `mi_saldo_recompensas` y `mis_cupones` sin tocar pestañas. La respuesta tardía de A no impide la carga de B.
- F5-05: catálogo público normal: una consulta y ningún indicador de carga pendiente. Bajo replay StrictMode: dos consultas, ninguna consulta personal del visitante, carga terminada y sin error de página. La segunda consulta es coherente con la corrección en desarrollo, no una duplicación de producción acreditada aquí.

## Evidencia, observaciones y alcance

Carpeta nueva: `C:/WedJaiseReact/.codex/evidencia-revision-fase5-v2/`.

- `diagnosticos.json`: siete escenarios repetidos de V1.
- `borradores-y-reintento.json`: cuatro controles adicionales, incluyendo F5-02b.
- `diagnosticos-adicionales.json`: dos controles de StrictMode.
- `normalizacion-sql.json`: SELECT de 12 cadenas y sus puntos de código/normalizaciones/coincidencias.
- `sdk-listas.json`: nueve controles del SDK, con el alcance de red real indicado.
- `estado-revision.json`: HEAD, hashes, vistas/permisos/conteos y auditoría de suite/rollback.
- Copias de scripts externos como `.txt`, sin añadir ejecutables al proyecto.

El harness inicial repetido conservaba un selector que esperaba un paginador después de una búsqueda fallida; ahora ese paginador se oculta correctamente. Se ajustó la lectura del diagnóstico a ese estado y se usa solo la corrida final sin errores. No se atribuyó ese timeout a la app.

Observación editorial: corregir «12 archivos» a **13** en la entrega/rollback. No es un bloqueo de reversión: la comprobación inversa pasa.

La matriz real de cajera/asistente, staging/producción, rendimiento de campo y los demás límites de V1 siguen fuera de esta revisión. No se hizo una segunda ejecución completa de 32 casos, no se aplicó rollback y no se rehicieron mediciones de rendimiento.

## Siguiente entrega

Corregir únicamente F5-02b y F5-04b, incorporar las regresiones y corregir la cifra documental del parche. Entregar evidencia nueva en `.codex`, sin sobrescribir las rondas anteriores, y detenerse para revisión V3. Mantener separados los cambios de Fases 3/4. Sin commit, push, migración remota, hosting ni Fase 6.

Codex no modificó código, configuración, datos, esquema, dependencias ni Git. Solo generó este informe y evidencia de QA conforme a la instrucción persistente del usuario.
