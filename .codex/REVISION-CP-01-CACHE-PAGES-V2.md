# Revisión CP-01: prueba de caché Pages, versión corregida

Fecha: 10 de octubre de 2026, America/Lima. Codex, QA de solo lectura. No se ejecutó la prueba real con escritura, el recorrido de interfaz ni la ronda PWA. Sin login real, lectura de `.env`, cambios de configuración/código/datos, commit ni push. Solo se añaden este informe y su evidencia en `.codex`, conforme a la instrucción persistente del usuario.

## Veredicto

**CP-01 cerrado en la implementación local revisada.** El falso éxito de la revisión anterior ya no se reproduce: las lecturas finales fallidas y una limpieza no confirmada generan fallo, código 1 y `completa=false`. **Sin nuevos bloqueos para preparar las dos pruebas reales propuestas**, sujetas a la autorización específica de escrituras de staging.

Esta aprobación es de los scripts/guardas, no del resultado de caché real ni de la Fase 3 completa. IP-P1 conserva su cierre anterior. La configuración aplicada por Codex en Preview no se cambió.

## Evidencia ejecutada por Codex

- `node scripts/verificar-guardas-interfaz-r2.cjs`: **47/47**, cero fallos. La prueba nueva agrupa escenarios de limpieza sana, ya limpia, lectura fallida, DELETE fallido, diferencias de inventario y falta del inventario inicial. No significa que cada variante sea una prueba numerada independiente.
- `node --check` de los dos verificadores: correcto.
- Oxlint de guardas, suite de guardas, verificador UI y verificador de caché: limpio.
- **Nueve escenarios independientes sobre el script de caché completo**, con dobles locales, todos con el comportamiento esperado.
- Un diagnóstico adicional del aborto temprano de UI, sin red, login ni escrituras, para precisar el alcance de la nueva salida de informes.

No repetí builds ni pruebas de la aplicación, cuyos archivos no cambiaron. HEAD y main local conservan respectivamente `b36e7495c013b3cff8f167655de051a899ce77cf` y `0dc629e430ed07eeaccec273d31de93e9717d9bf`. No hice fetch y no afirmo un estado remoto nuevo.

## CP-01: comprobación independiente

`G.limpiarObjetoPropio` (`scripts/lib/guardas-interfaz-r2.cjs:50`) consulta el lector estricto, solo invoca el borrado propio si hay claves de ese prefijo, confirma ausencia e igualdad con el inventario inicial, y devuelve `confirmada=false` ante excepciones o diferencias. Su llamador incorpora un caso explícito de estado final y usa esa confirmación para la completitud/exitCode (`scripts/verificar-medios-pages-cache.cjs:235`).

El diagnóstico externo ejecuta el texto actual del script en VM. FS, HTTP, Auth, Chromium, reloj y temporizadores son ficticios; la única sustitución textual en memoria cambia el import del clasificador por un doble válido. Se conserva la lógica real de flujo, limpieza, resumen, `--salida` y exitCode. La espera del TTL se simula: estos resultados **no son medidas de Cloudflare**.

| Escenario | Resultado del script |
| --- | --- |
| Sano, HIT y 404 posterior en POP ficticio coincidente | 27 casos, 0 fallos, exit 0, completa/estado final true |
| Sano, POP ficticio posterior distinto | Exit 0, estado final true, atribución a misma copia false |
| Inventario final: red caída | 1 fallo, exit 1, completa/estado final false |
| Inventario final: HTTP 500 | Igual, fallo confirmado |
| Inventario final: JSON sin objetos | Igual, fallo confirmado |
| Inventario final: cursor presente | Igual, fallo confirmado |
| Limpieza necesaria y relectura caída | Igual, fallo confirmado |
| DELETE de limpieza 500, objetos todavía presentes | Igual, fallo confirmado |
| Build-id incorrecto | Exit 1, incompleta, cero login/PUT/DELETE simulados |

Para forzar las ramas de limpieza necesaria y relectura, el doble hace reaparecer claves propias justo en la lectura del `finally`. Es una inyección de escenario para probar el manejo de fallos, no un comportamiento observado en R2. El diagnóstico no borra objetos reales ni demuestra una pérdida de datos.

La corrección añade el fallo final al resumen, en lugar de guardar solo un campo de error ignorado por exitCode. El caso sano conserva éxito. La prueba negativa que antes acababa en exit 0 ahora acaba en exit 1.

## Salida de evidencia y POP

Ambos scripts aceptan `--salida` y pueden dirigir la evidencia a una carpeta nueva de `.codex` en la ejecución autorizada. En los nueve escenarios de caché, el doble de FS recibió únicamente la carpeta ficticia indicada; no se escribió en la evidencia versionada.

**Precisión documental, no bloqueo:** el aborto por build-id incorrecto del verificador **UI** ocurre antes de crear su carpeta/informe. Lo reproduje con su texto actual: una llamada GET ficticia al HTML, cero login/escrituras, código **2** y **cero informes JSON**. El comportamiento «escribe el informe en la salida y sale con código 1» está comprobado para **caché**, no para ambos scripts. `--salida` en UI funciona para las corridas que alcanzan el recorrido. Conviene conservar la salida del comando de preflight si se necesita evidencia de ese rechazo, o documentar esta diferencia.

El script de caché incorpora `CF-Ray`, `popHit` y `popExpiracion`, y ya describe el caso como «404 observado después del TTL». Con POP distinto no atribuye la observación a la misma copia. Esta inferencia sigue siendo externa: comparar el POP no instrumenta una entrada individual de Cache API ni mide `head()`/CPU/cuota. Evaluar siempre casos/fallos y exitCode junto a los campos descriptivos del informe; `completa` no sustituye el resumen de aserciones.

## Próximo paso autorizado por separado

Los scripts quedan listos para las dos pruebas propuestas: objeto ficticio de caché (dos variantes) y recorrido UI de staging con `--entrega=pages`, previa comprobación de la marca/configuración efectivamente servidas. Usar carpetas nuevas de salida, preservar snapshot e inventario inicial/final, y detenerse/informar si quedan pendientes.

El permiso anterior «Sí, aplicar y reconstruir solo Preview» excluía escrituras de prueba. El usuario todavía no ha autorizado en este intercambio la ejecución de esas dos pruebas: no las ejecuté. Commit/push y ronda PWA permanecen fuera de esa eventual autorización. Dominio propio sigue opcional para el futuro; no es un requisito añadido para probar esta entrega de staging por Pages.

## Archivos y hashes

Evidencia nueva en `.codex/evidencia-cp01-v2/`: `diagnostico-cache-v2.json`, `diagnostico-salida-interfaz.json` y copias `.txt` de los diagnósticos externos. No contienen secretos ni bundles completos. Informes previos, runbook y registro sin editar.

Fuentes revisadas, SHA-256:

- Cache script: `a290abbb0fd44eda941dfbf1987dc21d59f429fc86e82262985b0c2d16882747`.
- Guardas: `065106c0bde5d6ddd6ae35c0b9edc96cc92d2f26b904ce9a8df2d9833a4e6867`.
- Verificador UI: `537d96f1fbdee0ada054cf927bbd9b206680fbaed44ac1f98d2917337bbfe530`.
