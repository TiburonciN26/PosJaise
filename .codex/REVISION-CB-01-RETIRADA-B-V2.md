# CB-01: segunda revisión del verificador de retirada B

Fecha: 10 de octubre de 2026. Codex, QA de solo lectura.

**Veredicto: CB-01 CERRADO en las reproducciones locales revisadas. Verificador corregido aceptado localmente para preparar el paquete y su validación de commit exacto, una vez autorizado por el usuario. Sin nuevos bloqueos de código en este alcance.** La prueba real con B, publicación y cierre de accesos alternativos no quedan aprobados por esta revisión.

## Identidad del material revisado

HEAD local: `d16d816f4d64cde80c230092126ed8204c6ce0e9`; rama `feat/cloudflare-pages`. Los cambios siguen sin confirmar.

| Fuente | SHA-256 |
|---|---|
| entrega.js | `8302759d8eedfab797731e8c5f695a6297ac977284ebb0deb9d7ab1e34ccf3db` |
| probar-entrega.mjs | `e91dd9155e4aa28cb62fc08546445ee3e9699b2357e62ef7eba6273204ea958c` |
| verificar-medios-pages-cache.cjs | `e9677eb0f3c80d01e01f17296a581131a98279abe0a58fd43f3eeaaea1c9136c` |
| retirada-b.cjs | `76fa0ac7ac4b860c03148c04898857af07e9354272aa8ba3c507b051b92f0032` |
| verificar-retirada-b.cjs | `052f881cc9ae3bdfc5a0a2b0475ac49d32b7aeb803d5ff0a84099f1584c1dfc3` |

Las dos primeras fuentes conservan los hashes de la revisión anterior, que repetía 48/48 de la Function. No volví a repetir esa suite sin cambios.

## Validación de Codex

- `node scripts/verificar-retirada-b.cjs`: **13 casos, 0 fallos, exit 0**.
- Sintaxis del CLI: exit 0. `oxlint` de helper, regresiones y CLI: sin diagnósticos. `git diff --check`: sin errores; avisos LF/CRLF en los documentos.
- Diagnóstico independiente de las secciones reales del CLI: **6 escenarios, 0 fallos, exit 0**. Ejecuta calentamiento, recogida de seis respuestas, evaluación, asignación de `completa`, serialización del informe y política de código de salida; R2/Cache/espera/escritura del informe son dobles en memoria. No ejecuta preflight/login/PUT/DELETE REST reales ni todo el CLI.

| Escenario independiente | Conclusión | Completa | Salida |
|---|---|---|---|
| A, mismo POP caliente | fallida | false | 1 |
| **A, HIT MIA y respuestas SCL frío (CB-01)** | **inconclusa** | **false** | **1** |
| B, mismo POP caliente | acreditada | true | 0 |
| B, g sin HIT previo | inconclusa | false | 1 |
| B, condicional de g desde otro POP | inconclusa | false | 1 |
| B acreditada, limpieza no confirmada | acreditada | false | 1 |

El falso positivo original ya no se acepta. La clasificación de fallo, inconclusión y acreditación se conserva al cablearla al informe y a la salida, no solamente al llamar al helper aislado.

## Corrección corroborada

El CLI calienta m y g antes del borrado y acepta HIT únicamente con bytes iguales a la variante esperada. Registra POP, ETag, momento e intentos por variante. Las seis comprobaciones posteriores utilizan la copia caliente de su variante: GET, HEAD y GET condicional con su ETag anterior.

`retirada-b.cjs` falla ante estado distinto de 404, cabecera incorrecta o HEAD con cuerpo; declara inconclusión ante falta de observación/HIT/POP o POP distinto. Solo acredita las seis respuestas válidas del POP correspondiente. El CLI exige acreditación para `completa=true`, conserva el requisito independiente de limpieza confirmada y sale con código 1 ante fallo/inconclusión. `retencionObservada` ya distingue los tres estados.

## Precisiones no bloqueantes

1. El CLI conserva A por defecto. La aceptación del requisito nuevo debe ejecutar **explícitamente `--contrato=b`**, con la marca del deployment B, y comprobar `contrato=b` en el informe. Un resultado A no cierra B.
2. La evidencia está limitada a respuestas y POP observados. Un HIT previo no acredita retención indefinida de esa copia: acotar tiempos de calentamiento/prueba respecto del TTL y registrar el momento de DELETE facilita interpretar la corrida. No prometer ausencia de expulsiones de caché, revocación en todos los POP ni borrado de copias descargadas.
3. El documento `DISENO-CONTRATO-RETIRADA-MEDIOS.md` todavía describe B desactivada y la decisión pendiente. Actualizar su estado vigente o marcar ese bloque como histórico al preparar el paquete, conforme al plan V2. Es documentación; no requiere un push ni otra ronda de pruebas independientes por esa precisión editorial.
4. La descripción de falla del informe puede mencionar también errores de cabeceras/cuerpo, no solo «algo distinto de 404»: el evaluador ya los distingue correctamente. No es un bloqueo de funcionamiento.

## Paquete y próxima autorización

El paquete actual implica cinco archivos modificados (Function, suite, CLI, runbook, changelog) y **dos nuevos que no pueden omitirse**: `scripts/lib/retirada-b.cjs` y `scripts/verificar-retirada-b.cjs`. Incluirlos con lista explícita; si se actualiza el diseño, añadir ese archivo a la lista revisable. Mantener fuera `.codex/`, `.env*` e informes ignorados. No usar `git add .`.

Tras la autorización humana de commit/push solo a `feat/cloudflare-pages`, Claude valida el commit exacto en checkout limpio antes de publicar y detiene el push si falla. Después Codex verifica deployment, marca y alcance. La ejecución real de B con objetos ficticios y limpieza debe autorizarse aparte, sobre el build correcto. Esta revisión no ejecuta ni autoriza ninguna de esas acciones.

B seguirá disponible únicamente donde se despliegue su código nuevo. `r2.dev` y deployments anteriores con A son accesos alternativos pendientes del plan V2; no cerrarlos, borrar recursos ni cambiar variables/binding de forma implícita. Producción y GitHub Pages siguen fuera de este paquete.

## Evidencia y límites

Resultado del diagnóstico: `evidencia-cb01-v2/diagnostico-cableado.json`; reproducción como texto: `diagnostico-cableado.txt`; salidas de checks: `validacion-local.json`.

El primer intento del diagnóstico propio se detuvo al identificar delimitadores CRLF; se normalizaron finales de línea solo en memoria del diagnóstico externo y se ejecutó correctamente. No fue un fallo del proyecto ni se modificaron fuentes para hacerlo pasar.

Codex no usó red, credenciales, navegador, staging, R2 ni Cloudflare durante esta revisión; no hizo commit, push, instalación o cambios de código/configuración/datos. Solo se guardan este informe y evidencia nuevos en `.codex`, conforme a la instrucción del usuario.
