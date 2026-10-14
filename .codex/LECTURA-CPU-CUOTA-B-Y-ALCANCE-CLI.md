# Lectura de CPU y cuota con B, y alcance del arreglo del CLI

Fecha local de cierre: 2026-10-10 23:04:37 (America/Lima). Esta lectura sucede después de los ensayos; no hubo medición aislada antes/después. Solo lectura del panel, sin habilitar analítica, logs, planes, alertas o configuración.

## Resultado

**El consumo observado de pruebas es bajo y el panel no muestra errores de ejecución.** La cuenta registra 462 de 100.000 solicitudes del contador diario, aproximadamente 0,462 %, y no muestra uso facturable incurrido en Workers ni R2.

**No queda validado todavía el margen de CPU de la Pages Function con B.** La vista de CPU de Pages tiene una reserva de escala/unidades descrita abajo. El CPU del Worker de subidas sí se lee claramente en ms, pero no sirve para sustituir el de la Function de lectura.

Sí conviene que Claude corrija localmente el código de salida del CLI habitual; ese arreglo es independiente del panel y no exige ejecutar borrados reales.

## Pages Functions — pos-jaise, Preview

Filtro observado: Preview y Last 24 hours.

| Métrica | Valor visible |
| --- | --- |
| Success | 556 |
| Errors | 0 |
| Exceeded CPU Time Limits | 0 |
| Internal / Script Threw Exception / Exceeded Memory / Client Disconnected | 0 |
| Subrequests | 0 |
| CPU p50 | 1,906 |
| CPU p75 | 2,505 |
| CPU p99 | 6,461 |
| CPU p99.9 | 9,420 |

La captura completa del gráfico rotula el eje como ms y muestra valores de miles. No se debe afirmar que son 1,906 ms como cifra decimal, ni dividirlos por mil y presentarlos como 1,906/6,461 ms basándose en una suposición de microsegundos. Tampoco se afirma que la Function esté consumiendo realmente segundos de CPU por petición: hay que corroborar la escala de esa vista con una exportación o métrica de invocación cuya unidad sea explícita.

La ayuda accesible no reveló una unidad adicional, y las páginas oficiales revisadas describen los cuantiles sin aclarar la escala de este rótulo concreto. No se consultaron cookies, estado interno del dashboard, tokens ocultos o endpoints privados para resolverlo. La evidencia conserva los valores y la captura, en vez de normalizarla silenciosamente.

El cero de errores es una señal favorable del período observado, pero no reemplaza esa validación numérica. Estos datos agregan los previews del proyecto y no filtran solo 6929c619, B, respuestas 200 o los 302 GET/HEAD/condicionales de la carga.

Success representa éxito de la invocación; no significa que todas las respuestas HTTP sean 200. Una Function puede ejecutar correctamente y devolver un 404 previsto. Subrequests en esa vista no debe usarse como conteo completo de HEAD/Get de R2. [Métricas oficiales de Pages](https://developers.cloudflare.com/pages/functions/metrics/).

## Worker — pos-jaise-medios-staging

Filtro observado: Last 24 hours y All deployed versions. El recurso es el Worker de pruebas, aunque su entorno interno se llame Production; no es el backend del negocio ni el hosting de producción.

- Invocaciones: 971; errores: 0; subrequests: 1.77k (valor redondeado mostrado).
- CPU p50: 1,95 ms; p90: 2,58 ms; p99: 3,18 ms; p99.9: 3,2 ms. El eje del gráfico está expresamente rotulado ms.
- La tarjeta general muestra CPU Time 2 ms, redondeado.

Es evidencia de CPU del Worker de subidas/borrados y consultas administrativas, no de Pages /medios. No atribuir sus percentiles a la opción B de la Function. Son cuantiles agregados, no un máximo garantizado para fotos reales de hasta el tamaño permitido.

La documentación del plan Free indica 10 ms de CPU por petición HTTP; las esperas de red no cuentan como CPU. Por eso la latencia cliente de unos 300 ms del ensayo no equivale a CPU de 300 ms. [Límites oficiales de Workers](https://developers.cloudflare.com/workers/platform/limits/).

## Consumo compartido de cuenta

Panel Workers & Pages:

- Requests today: 462 / 100.000, aproximadamente 0,462 %.
- Período facturable mostrado: October 10 - November 10.
- Requests del período: 1.53k; CPU total del período: 3.05k ms (ambos valores redondeados del panel).
- Uso facturable mostrado: $0.00, No billable usage incurred yet.

No comparar el CPU total del período de 3.05k ms contra el límite de 10 ms por petición: son magnitudes distintas. Tampoco comparar una ventana móvil de 24 h con el contador Requests today como si fueran el mismo intervalo.

Pages Functions comparte el cupo Free de 100.000 solicitudes diarias con Workers; los assets estáticos que no invocan Functions son gratuitos e ilimitados. El contador diario se reinicia a medianoche UTC. [Precios oficiales de Pages Functions](https://developers.cloudflare.com/pages/functions/pricing/).

Los importes mostrados son una lectura del panel en este momento, no una proyección de factura ni garantía de coste futuro. No se abrió el dashboard de facturas, ni se cambió de plan, medio de pago, alerta o límite.

## R2

Panel Overview, Billable usage (current period), October 10 - November 10:

- Class A Operations: 744.
- Class B Operations: 752.
- Total storage: 0 B; bucket pos-jaise-medios-staging: 0 objetos, 0 B.
- Uso facturable mostrado: $0.00, No billable usage incurred yet.

Como comparación orientativa con la capa gratuita mensual de R2 Standard, 744 es aproximadamente 0,0744 % del millón de operaciones A y 752 es 0,00752 % de los diez millones B. No se mezclan aquí métricas de 24 h con consumo mensual; son los contadores del período que muestra Overview. R2 Standard incluye 10 GB-mes, un millón A y diez millones B al mes; HEAD/Get son operaciones B. La gratuidad no aplica igual a Infrequent Access. [Precios oficiales de R2](https://developers.cloudflare.com/r2/pricing/).

B conserva la caché de bytes, pero su comprobación de existencia puede seguir haciendo un HEAD de R2 al atender HIT o condicionales. Por tanto, HIT no significa automáticamente cero operaciones B ni cero solicitudes de Functions. El conteo observado no permite calcular el coste incremental exacto de B: incluye otros ensayos y operaciones de inventario.

## Qué queda comprobado y qué sigue pendiente

La lectura del consumo de cuenta, operaciones R2, errores y CPU del Worker queda registrada. Son agregados posteriores a los ensayos, sin atribución causal exclusiva a carga o recolector. No hubo tráfico nuevo de ensayo para producir estas cifras; las consultas fueron de UI del dashboard.

El margen numérico de CPU de Pages con B queda pendiente de corroborar por la reserva de escala indicada. No usar el CPU del Worker, un 0 de errores o una conversión inferida para declarar aprobado ese criterio de producción. También faltan tráfico y fotos representativos, otros navegadores/móvil, cierre de r2.dev/deployments alternativos y los criterios del cambio de hosting definitivo.

La Fase 3 conserva sus aprobaciones acotadas de staging y no queda aprobada para producción por estas cifras.

## Alcance recomendado para el arreglo local del CLI

Archivo: [medios-huerfanos.mjs](C:/WedJaiseReact/scripts/medios-huerfanos.mjs:130). El camino sano actual termina con process.exit(0) después de imprimir cualquier informe; el catch de excepciones ya termina con 1.

Pedir a Claude un cambio local que utilice un código no cero si informe.errores contiene elementos o informe.abortado señala un aborto. Preservar el informe y resultados parciales y mantener una terminación explícita si es necesaria por el temporizador de Supabase. No modificar retención, clasificación, consulta puntual, borrado, RLS, schema, backend, cron o producción para resolverlo.

Pruebas útiles, sin red ni credenciales reales:

| Caso | Salida esperada |
| --- | --- |
| Informe sano de lectura | 0 |
| Informe sano de aplicar sobre dobles | 0 |
| Informe con uno o varios errores de borrado | No cero |
| Informe con abortado por lectura incierta | No cero |
| Éxito parcial seguido de error/aborto | No cero y resultados parciales conservados |
| Excepción o argumentos inválidos | No cero |

Comprobar tanto la decisión del código como su cableado real al CLI y que el proceso termine. Una omisión legítima por referencia tardía no debe convertirse silenciosamente en error si el contrato decide que es un resultado seguro; documentar esa decisión.

El arreglo local no incluye ejecutar el CLI habitual contra staging, programarlo, hacer commit/push o operar contra datos del negocio. Después Codex revisará la corrección y sus regresiones. Esta recomendación no sustituye una autorización de operaciones remotas.

## Evidencia y estado

Textos del panel y capturas guardados en .codex/evidencia-lectura-cpu-cuota-b-20261010; los valores están en metricas-observadas.json. Las capturas distinguen el gráfico del Worker, cuyo eje ms es claro, de la reserva de Pages.

HEAD local leído: 6929c619e88a91434cb16ee6a8d2de90de94c091; main: 0dc629e430ed07eeaccec273d31de93e9717d9bf; archivos versionados sin cambios. No se modificó el CLI ni otros archivos de implementación, no se escribieron filas u objetos ni se alteró Git o configuración de Cloudflare.
