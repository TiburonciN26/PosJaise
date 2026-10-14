# Verificación de Fase 3 · cuarta revisión de Codex

Fecha: 9 de octubre de 2026, America/Lima. Evidencia con fecha UTC.

**Veredicto: la secuencia anterior de F3-07 está corregida. La Fase 3 sigue NO APROBADA por una variante P1 del mismo problema en Galería: una lectura con coincidencia parcial permite borrar la foto «antes» que todavía está referenciada.** No se reabren los otros hallazgos ya aceptados ni se pide rehacer esas correcciones.

No se modificó código, configuración, dependencias, datos remotos ni Git. No se activó ni desplegó R2. No se borró la fila residual de staging ni cuentas QA. Se generan únicamente este informe y evidencia en .codex conforme a la autorización del usuario.

## Pruebas independientes

| Comprobación | Resultado |
|---|---|
| Suite unitaria | 54/54 |
| Worker local, R2 simulado | 33/33 |
| Capa de medios en Chromium | 24/24 |
| Modales reales, REST en memoria | 49/49 |
| Total de suites entregadas | **160/160** |
| Build Vite con staging y R2 simulado, salida externa | Pasa |
| Rollback: git apply -R --check | Pasa; sin aplicar |
| Diagnóstico propio del problema anterior | Pasa en Producto, Servicio y Galería |
| Diagnóstico propio de coincidencia parcial | **Falla; reproducido dos veces** |
| Foto referenciada tras la segunda reproducción | **Antes: HTTP 404; después: HTTP 200** |
| Aislamiento / errores de página en diagnósticos | Pasa: cero datos remotos no simulados, cero pageerror |

Las suites se copiaron fuera del repositorio; solo se adaptaron rutas, puertos, binarios ya instalados, caché y limpieza para no escribir resultados ni estado en el árbol del proyecto. Los casos originales no se alteraron. Supabase staging se usó únicamente para autenticar la cuenta QA existente y verificar su autorización en el Worker local; las escrituras de tablas y Storage se interceptaron/simularon. R2 fue local y simulado.

Lint completo: 2 errores y 54 advertencias. Diez advertencias corresponden a diagnósticos que Codex guardó en .codex en la revisión V2. Con --ignore-pattern '.codex/**' queda la línea base de **2 errores y 44 advertencias**, en fixtures.mjs:11 y :27. No se cambió la configuración. Los scripts de evidencia de esta entrega se guardan como .txt.

Árbol: feat/cloudflare-pages; HEAD 940510543f629df11ce80d558399c7ef32bebb68; main 0dc629e430ed07eeaccec273d31de93e9717d9bf. Fuentes estables durante esta verificación; hashes SHA-256 en metadatos.json. Fase 3 continúa sin commit/push de Codex.

## F3-07: lo que ya pasa

Mi reproducción original se volvió a ejecutar con los modales reales de Producto, Servicio y Galería:

1. El INSERT se confirma en el servidor simulado, pero se pierde la respuesta y falla el GET de reconciliación.
2. Tres reintentos con el mismo id reciben 23505, con la lectura todavía caída.
3. Se conserva una sola fila y sus archivos, sin evento de éxito.
4. Al recuperar la lectura, se confirma la misma referencia y se emite un único evento de éxito.

Los tres casos pasan. La memoria de incertidumbre y el tratamiento de null resuelven el defecto reproducido en V3. Las 13 regresiones nuevas de la suite de modales también pasan; incluye foto principal de Producto, rechazo posterior y limpieza sin duda previa.

## F3-07/P1: variante pendiente — una coincidencia parcial no prueba ausencia

**Reproducción con una acción permitida por la UI, sin modificar fuentes ni datos reales:**

1. Abrir «Nueva foto de galería» y elegir antes A y después B.
2. Guardar: el servidor simulado crea una fila con A/B; se pierde la respuesta y el GET falla. El modal queda abierto con un mensaje de incertidumbre y conserva ambas fotos.
3. Pulsar «Cambiar foto» solo en después y elegir C. La UI permite hacerlo mientras la operación queda pendiente.
4. Restablecer el GET y simular un rechazo 403 del siguiente INSERT.
5. Reintentar Guardar: el GET devuelve la fila existente A/B. El intento actual espera A/C, por lo que filaCoincide devuelve false.
6. El código interpreta false como autorización para limpiar y borra A junto con C. La fila sigue guardada con A/B, pero A ya no existe.

| Observación | Antes del reintento | Después |
|---|---|---|
| Filas en galeria_web | 1 con A/B | Misma fila, sin cambios |
| Foto A («antes») | Existe | **Eliminada, GET 404** |
| Foto B («después» original) | Existe | Existe, GET 200 |
| Eventos de éxito | 0 | 0 |

La primera reproducción está en reconciliacion-inaccesible.json; la segunda, aislada y con GET de las URLs, en reconciliacion-parcial.json. En ambas, before=[true,true], after=[false,true], dbUnchanged=true. El exit 1 de estos diagnósticos es el fallo esperado de la aserción de conservación; no indica que la infraestructura de prueba no arrancara.

### Causa y líneas

- src/lib/resultadoBd.js:33–38 devuelve false tanto si la fila no existe como si existe y algún campo difiere. Son dos hechos diferentes.
- src/components/ModalGaleriaWeb.jsx:203–209 compara las dos fotos del intento actual con el par guardado.
- src/components/ModalGaleriaWeb.jsx:216 permite limpiar tras incertidumbre previa cuando lectura === false.
- src/components/ModalGaleriaWeb.jsx:222–228 borra ambas subidas; fotoAntes reutiliza A de la operación anterior, que sí se confirmó.

Por tanto, «solo false autoriza limpiar» sigue siendo insuficiente: aquí la lectura es exitosa y la fila **existe**, además referencia una de las fotos que se borra. No se debe afirmar en el README que false prueba exclusivamente ausencia.

### Corrección recomendada para Claude

Separar existencia, coincidencia y resultado desconocido. Si una fila existe con un par diferente, conservar cada archivo que esa fila utiliza; un desacuerdo de una foto no autoriza a borrar la otra. Conservar también la identidad y las referencias del intento incierto, incluso si el usuario cambia campos.

Una opción acotada es bloquear los cambios de fotos mientras se reconcilia una operación pendiente, y permitir modificarlas después de resolverla. Otra es reconciliar primero el intento anterior y procesar los cambios como una operación nueva, con información de las referencias efectivamente guardadas. Si se mantiene la edición durante la duda, la decisión de limpieza debe hacerse por referencia, no por coincidencia total del par.

No solicito instalar herramientas, desplegar recursos ni migrar datos para corregir esta reproducción. La decisión de implementación corresponde a Claude.

### Criterios de aceptación

- Añadir regresión de la secuencia A/B → resultado incierto → cambiar solo B por C → rechazo 403 → GET exitoso A/B. La fila A/B y sus dos fotos deben permanecer válidas.
- Verificar la variante simétrica cambiando solo antes, y el modo de edición de una fila existente si comparten la misma lógica.
- El mensaje y los reintentos deben permitir resolver el pendiente sin éxito falso ni duplicados.
- Mantener los tres casos anteriores de 23505/GET inaccesible y el control de rechazo explícito sin incertidumbre previa.
- Si se bloquea la edición durante el pendiente, comprobar en el modal real que el cambio no puede efectuarse y que se vuelve a habilitar al resolver la operación.
- Revisar usos del helper compartido: false por diferencia de campos no equivale a «fila ausente». No afirmo otros fallos de Producto/Servicio sin reproducción; su caso original pasa.

## Lo que conserva su aceptación y lo que espera infraestructura

F3-01/02 y rechazos explícitos de F3-03 conservan la aceptación anterior. F3-05/06/08/09 también: paginación por llave y consulta puntual, parámetros de retención, guarda de doble envío y parser acotado. El diario/recolector conserva sus pruebas locales, con las condiciones de V3: eliminación real no certificada, ventana consulta→DELETE y necesidad de operación sin ediciones o coordinación más fuerte. No se ejecutó --aplicar.

R2 real, dominio, CORS desde Pages, caché HIT/MISS y CPU real siguen sin verificarse. Tampoco Firefox/Safari/móvil físico, muestra de fotos del catálogo, programación del recolector, purga de caché ni migración inversa. No escribir referencias r2: en datos del negocio hasta validar el rollback compatible. La fila ficticia residual de staging permanece intacta.

**Siguiente paso: corregir únicamente esta variante de F3-07 y entregar la regresión.** Después podremos revisar el cierre local y preparar la validación de R2 real según la guía y la autorización del usuario.
