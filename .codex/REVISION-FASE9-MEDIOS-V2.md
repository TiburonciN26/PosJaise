# Revisión Fase 9 · Correcciones V2

Fecha: 2026-10-12, America/Lima. HEAD `6929c619e88a91434cb16ee6a8d2de90de94c091`, rama `feat/cloudflare-pages`. Entrega revisada: [ENTREGA-FASE9-CORRECCIONES-V2.md](C:/WedJaiseReact/.codex/ENTREGA-FASE9-CORRECCIONES-V2.md).

## Veredicto

**PENDIENTE DE UNA CORRECCIÓN: F9-03b (P1).** Las correcciones F9-01, F9-02, F9-04, F9-05 y F9-06 quedan cerradas en sus alcances locales. F9-03 corrige las reproducciones V1 y la recuperación de un UPDATE que ya terminó, pero todavía da por descartada una operación que puede continuar ejecutándose en el servidor.

Se repitieron **17/17 unitarias** y **14/14 regresiones de CLI/harness**. La regresión independiente del UPDATE todavía en vuelo **falla 0/1**, como se describe abajo. La simulación completa entregada 18/18 se auditó, no se ejecutó de nuevo.

No se modificaron fuentes, datos de negocio, esquema, Git ni recursos remotos. Los diagnósticos adicionales usan la CLI original con backend HTTP ficticio en memoria y credenciales ficticias; la inspección de Supabase Local fue `READ ONLY`. No se inicia ni autoriza la Fase 10.

| Hallazgo | Estado |
| --- | --- |
| F9-01 P1, carpeta de trabajo | Cerrado: guarda temprana y pruebas de ruta/junction sin efectos indebidos. |
| F9-02 P1, ambiente del manifiesto | Cerrado: las reproducciones con entorno distinto abortan antes del login/PUT/PATCH. |
| F9-03 P1, respuesta incierta y reversión | Reproducciones V1 corregidas; permanece abierta la variante F9-03b. |
| F9-04 P2, verificar sin leer R2 | Cerrado: lectura obligatoria para copias y cobertura comprobada. |
| F9-05 P2, URL privada en informe | Cerrado para la matriz de endpoints/orígenes probada. |
| F9-06 P2, permiso remoto único | Cerrado: permisos por función, opciones repetidas/antiguas rechazadas. |

## F9-03b · Una lectura del valor anterior no prueba que el UPDATE haya terminado

Ubicación principal: [medios-migracion.mjs:382](C:/WedJaiseReact/scripts/migracion-medios/medios-migracion.mjs:382). Relacionado con el borrado de la operación en línea 393 y el cálculo de `completo` en línea 455.

`reconciliar()` devuelve `no-aplicada` cuando la fila aún contiene `op.de`. `cerrarOperacion()` elimina inmediatamente la intención abierta. En modo `revertir`, la referencia sigue `pendiente`, no entra en las candidatas `actualizada` y el comando puede devolver `completo:true`, exit 0.

Un proxy puede devolver un 503/timeout al cliente mientras el servidor todavía ejecuta o espera para confirmar la sentencia. Una lectura exitosa durante ese intervalo solo demuestra el valor visible en ese momento. No certifica que la operación original haya concluido, abortado o perdido la capacidad de escribir más tarde.

### Reproducción con la CLI original

Servidor HTTP ficticio en memoria; no Postgres real, ni escritura en Local o remoto. El servidor devuelve 503 y mantiene el UPDATE pendiente. Después lo confirma, condicionado al mismo valor anterior usado por la CLI.

1. `actualizar --aplicar` guarda la intención y recibe 503. La lectura todavía devuelve el original. Resultado correcto en este paso: exit 3, operación `incierta` y referencia `pendiente`.
2. Se ejecuta `revertir --aplicar` antes de terminar la operación anterior. La lectura vuelve a devolver el original.
3. La reversión borra la intención y termina con **exit 0, `completo:true`, `operacionesAbiertas:0`**, referencia `pendiente`.
4. El UPDATE original confirma después: la fila queda con la referencia R2 nueva, pero el manifiesto sigue `pendiente`, sin operación abierta.
5. Una segunda reversión devuelve otra vez **exit 0, `completo:true`, `hechas:0`** y deja la foto migrada.

Se ejecutaron dos formas del diagnóstico:

- Commit liberado de forma controlada después de terminar la primera reversión, para fijar el orden exacto.
- Commit temporizado automáticamente a los **1.202 ms** desde el inicio; la primera reversión había terminado a los **198 ms**. El fallo no necesita una demora ilimitada ni una ventana de minutos.

**Control sano:** si el UPDATE concluye antes de reconciliar la reversión, el código V2 reconoce el valor nuevo, revierte y deja el original restaurado, estado `revertida`, exit 0.

**Regresión independiente:** se añadió la aserción «una reversión no puede declararse completa mientras el UPDATE anterior pueda confirmar después de la lectura». Contra V2 falla con `true !== false`, exit 1. Los JSON de diagnóstico que imprimen `1/1` solo acreditan que se completó y registró la reproducción: no son aprobación del contrato. `regresion-en-vuelo.json` guarda el fallo de la garantía.

### Por qué el límite documentado no cierra el hallazgo

El diseño §5 recomienda que entre ejecuciones pase más que el tiempo máximo de una sentencia. La herramienta no verifica ese límite, no impone la espera ni dispone de evidencia de que la operación haya terminado. El ejemplo observado confirma en poco más de un segundo. La garantía de que una reversión nunca da éxito con una operación posiblemente aplicada sigue siendo falsa para el comando permitido actualmente.

El UPDATE condicional evita pisar un valor distinto; no evita este caso, porque la fila conserva precisamente el valor anterior cuando la operación pendiente finalmente se evalúa. La intención previa resuelve una interrupción posterior al commit, pero se pierde aquí al interpretar la lectura previa como desenlace definitivo.

### Corrección recomendada

No eliminar una operación incierta ni declarar reversión completa únicamente porque una lectura devuelve el original. Hace falta evidencia fiable de que la operación anterior ya no puede confirmar: coordinación/identificación del lado del servidor, una barrera comprobable o un protocolo de espera basado en límites realmente validados. Si esa certeza no existe, conservar la operación abierta con su id, informar pendiente y salir con código 3. No sustituirlo por una demora arbitraria o por una recomendación manual presentada como garantía automática.

La reversión debe seguir recogiendo operaciones que posteriormente se confirman y respetando ediciones ajenas. Mantener las pruebas sanas y las variantes sin commit, 4xx definitivo, lectura caída e interrupción después de confirmar. No hace falta borrar originales o copias para resolver este defecto.

### Regresiones necesarias

- Respuesta incierta, valor anterior visible y UPDATE todavía en vuelo; pedir reversión antes de confirmar.
- Commit después de esa lectura y después de que el cliente haya recibido el resultado de la reversión.
- La misma secuencia sin commit definitivo, cuando haya evidencia de finalización suficiente.
- Lectura caída, edición ajena y reanudación conservando el id de operación.
- Control donde el commit concluye antes de reconciliar: reversión normal y sin PATCH duplicado.

Criterio de aceptación: ninguna corrida declara reversión completa y elimina el diario de una operación que todavía puede aplicar el cambio después.

## Cierres verificados

### F9-01

El harness valida primero la carpeta. Se repitieron las guardas puras y el caso del harness original con la trampa de efectos. Raíz, proyecto, `.codex`, `src`, otra capitalización, carpeta ajena y junction se rechazaron sin operaciones de borrado/escritura/conexión. **La junction real sí se pudo crear y probar en esta repetición**; se retiró solo el enlace mediante la limpieza no recursiva del test. La carpeta ajena de QA se conservó hasta la limpieza propia del test y `src` no se modificó.

Las pruebas se ejecutaron con el temporal del proceso aislado en la carpeta de QA, para no vaciar las carpetas previas de Claude. No se borraron `%TEMP%/sim-f9-v2` ni `%TEMP%/sim-f9-pruebas-cli` del usuario. Esto no es una garantía contra un atacante que cambie el filesystem entre comprobaciones y uso; las carpetas de prueba deben seguir siendo propias y controladas.

### F9-02

La CLI original rechazó manifiesto A/entorno B para copiar, actualizar, revertir y verificar, con cero solicitudes al backend ficticio B. Se rechazaron manifiestos V1, URL original ajena y Worker distinto. El control del mismo entorno actualizó, verificó y revirtió correctamente. Se acepta el vínculo canónico de URL y el límite declarado de una base diferente servida en la misma URL; no se afirma identidad interna de la base después de un reset.

### F9-04

Se repitió el rechazo de `verificar` sin lectura cuando existen copias; m/g inexistentes, una sola variante, tipo incorrecto, fallo de lectura y base distinta nunca dieron `ok:true`. El manifiesto vacío quedó rotulado explícitamente, sin login. No se reabre el defecto V1 de omitir R2.

Precisión de alcance: `refsComprobadas` cuenta lecturas. Los estados `conflicto`/`conflicto-reversion` no tienen un valor esperado de igualdad y el verificador los deja fuera de esa comparación; no describir ese contador como hash o igualdad de todas las filas de la base. Los conflictos siguen requiriendo revisión del operador.

### F9-05

Se repitió la matriz del inventario con endpoints `sign`, `authenticated` y `public`, buckets privados/desconocidos y orígenes propio, ajeno y proxy. Los informes no conservaron las rutas/tokens ficticios de esas URLs. Los valores públicos normales mantuvieron su clasificación migrable. No se accedió a comprobantes reales.

### F9-06

Tres hosts ficticios distintos llegaron a los destinos correctos en la prueba del cableado. Permisos ausentes/intercambiados, producción sin su permiso, opciones repetidas y `--permitir-remoto` se rechazaron antes del login. El preload redirige a un único servidor en memoria: no demuestra TLS, CORS ni disponibilidad de los servicios reales.

## Evidencia, integridad y datos

- Unitarias repetidas: **17/17**.
- CLI/harness repetidos: **14/14**.
- Regresión adicional F9-03b: **0/1**, exit 1, fallo confirmado.
- Once hashes del manifiesto V2 y once copias V1 coinciden. Los cinco scripts V1 coinciden también con el registro de la revisión anterior de Codex.
- `git apply -R --check` pasa. No se aplicó el parche ni se ensayó una restauración dentro del proyecto. Volver a V1 reabre los defectos de V1; las copias son evidencia de reversión, no recomendación de operar con esa versión.
- Se auditó la simulación entregada **18/18**. No se repitió porque contiene escrituras SQL y limpieza de fixtures, fuera de la función de auditor de Codex.
- Inspección de Local en transacciones `READ ONLY`: **577 referencias, 441 objetos, auditoría 25.965 y cero productos/servicios/galería `QA-F9`**. Concuerda con el aumento de 21 informado por Claude; no se borró auditoría.
- HEAD sigue en `6929c619`; las herramientas originales no se editaron. Los diagnósticos adicionales son copias de harness con servidor ficticio modificado, siempre llamando a la CLI original del proyecto.

El plan público ya registra las reservas de compatibilidad de PWA antiguas, la retirada del SW todavía no diseñada/probada y el dominio propio opcional. No se ejecutó nada de ese plan. Inventario del negocio, ensayo remoto de staging, retención de originales y publicación siguen esperando sus decisiones/autorizaciones.

## Siguiente entrega de Claude

Corregir únicamente F9-03b en local, añadir esta secuencia a la regresión oficial y actualizar el diseño para que las garantías coincidan con el protocolo real. Conservar los cinco cierres y las pruebas V2 existentes. Sin commit/push, cambios remotos ni Fase 10. Si la solución exige coordinación nueva de servidor, entregar primero su alcance y reversión antes de aplicarla a un ambiente remoto.

## Archivos de evidencia

[evidencia-revision-fase9-v2](C:/WedJaiseReact/.codex/evidencia-revision-fase9-v2): `unitarios-repetidos.json`, `cli-repetida.json`, `en-vuelo.json`, `en-vuelo-temporizado.json`, `regresion-en-vuelo.json`, `hashes-y-rollback.json`, `inspeccion-local-solo-lectura.json` y las fuentes de los diagnósticos como `.mjs.txt`. Los informes contienen solo resultados de QA y conteos/hashes de Local; no se archivan cuentas ni archivos de entorno.
