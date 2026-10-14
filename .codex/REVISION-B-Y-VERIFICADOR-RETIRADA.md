# Revisión: B por defecto y verificador de retirada

Fecha: 10 de octubre de 2026. Codex, QA de solo lectura. Referencia: `d16d816f4d64cde80c230092126ed8204c6ce0e9`, rama `feat/cloudflare-pages`; modificaciones locales sin commit.

**Veredicto: B por defecto aceptada localmente; paquete pendiente de corregir CB-01 en el verificador antes de recomendar commit/push y su ensayo real.** El hallazgo es de validez de la prueba, no una reproducción de fallo de la Function B.

## Comprobaciones ejecutadas

- Pruebas de la Function: **48/48**, exit 0. Los escenarios de retención A pasan con `revocar:false`; el escenario de HEAD HIT registra la consulta adicional de metadatos; B queda activa por defecto.
- Sintaxis del verificador: exit 0. `oxlint` de Function, pruebas y verificador: sin diagnósticos. `git diff --check`: sin errores, solo avisos LF/CRLF en los documentos.
- Diagnóstico independiente: Function real y rama real de aserciones del verificador, **tres escenarios con R2/Cache simulados, sin red**. Defecto reproducido, con controles A y B.

No se ejecutó el CLI completo con sus flujos remotos ni el ensayo con escrituras. El diagnóstico ejecuta la sección de retirada extraída del verificador, no la copia de una lógica reescrita.

## CB-01 — P2: el verificador puede aceptar A como si demostrara B

Ubicación: `scripts/verificar-medios-pages-cache.cjs:213–218` y comprobaciones posteriores de HEAD/condicionales.

El script comprueba únicamente que exista `informe.popHit`. No exige que el POP del 404 posterior (`CF-Ray`) sea el mismo que el del HIT previo. Por tanto, un HIT en MIA y un 404 de otro POP sin copia son compatibles con **A**, pero la rama `--contrato=b` los acepta y registra «sin retención: 404 inmediato (contrato B)».

Reproducción independiente:

| Opción real de la Function | HIT previo | Lecturas tras borrar | Resultado de las 5 aserciones de B |
|---|---|---|---|
| A (`revocar:false`) | MIA caliente | MIA caliente | 4 fallos: rechaza A, control correcto |
| **A (`revocar:false`)** | **MIA caliente** | **SCL frío** | **0 fallos: falsa aceptación de B** |
| B (`revocar:true`) | MIA caliente | MIA | 0 fallos: control correcto |

Se calentaron ambas variantes en MIA y se simuló un DELETE confirmado antes de ejecutar los GET/HEAD/condicionales reales de la rama. La Function A seguía conservando las copias en MIA; el verificador veía las respuestas de SCL. No se cambió ninguna fuente del proyecto para reproducirlo.

Además, el script busca un HIT previo solo para `m`. La primera lectura de `g` no exige HIT ni registra su POP para asociarlo a la retirada. Su 404 tampoco acredita por sí solo la retirada de una copia caliente de esa variante.

### Corrección requerida por Claude

1. Registrar HIT confirmado **por variante**, con ETag, bytes, POP y momento de la lectura; calentar `m` y `g` antes de borrar, dentro del TTL.
2. Comparar el POP de las comprobaciones posteriores con el de la copia caliente correspondiente. POP ausente/distinto o falta de HIT: **no acreditar retirada de caché**. Guardar la evidencia como inconclusa/incompleta o fallida según el contrato, sin declarar que se demostró B. No dirigir ni inventar un POP desde el cliente.
3. Cubrir GET, HEAD y condicional con el ETag anterior para ambas variantes; conservar comprobaciones de 404/no-store, seguridad, cuerpo vacío de HEAD e inventario/limpieza.
4. Añadir regresiones sin red equivalentes a los tres escenarios anteriores, más POP ausente y variante g sin HIT. El control A con POP frío debe dejar de pasar como evidencia de B; B con POP coincidente debe seguir pasando.
5. `retencionObservada` no debe afirmar retirada validada cuando sus comprobaciones fallaron o son inconclusas. La ausencia en R2 y la prueba contra una copia caliente son resultados separados.

La comparación de POP es una condición necesaria para esa afirmación; no prueba estabilidad de caché en todos los centros de datos. La evidencia real seguirá limitada a los POP observados. No se exige un mecanismo global de purga para resolver este hallazgo.

## Precisiones de entrega, no nuevos bloqueos de Function

- El modo `--contrato=a` sigue siendo el valor por defecto del CLI. Para esta entrega el comando de aceptación debe indicar explícitamente `--contrato=b` y el informe debe identificar ese contrato; no usar un resultado A como cierre del requisito nuevo.
- Los comentarios de la suite y el encabezado del CLI conservan frases de la política A/espera de TTL. Rotularlas por modo; agrupar estas precisiones con la corrección, sin un push dedicado.
- Activar B en el nuevo alias no cierra automáticamente `r2.dev` ni cambia versiones antiguas de la Function. Esa transición y el rollback compatible siguen dentro del plan V2, con sus autorizaciones independientes.

## Acción recomendada para responder a Claude

Primero corregir CB-01 y entregar las regresiones locales. Después Codex revisa esa corrección y se solicita la autorización acotada del commit/push con validación del commit exacto antes de publicar. No solicitar todavía autorización de escrituras para un verificador que puede aceptar un POP frío como revocación de una copia caliente.

Se conserva la decisión del usuario de bloquear el enlace antiguo. No se modificó código, Git, Cloudflare, Supabase, variables, binding, permisos, dependencias ni datos. No se pidió ni usó una credencial. Solo se crean este informe y evidencia nuevos en `.codex` conforme a la instrucción permanente.

Evidencia: `evidencia-revision-b-retirada/diagnostico-pop.json`, reproducción `diagnostico-pop.txt` y salidas de validación local. La reproducción no afirma haber ejecutado el CLI completo ni un deployment real con B.
