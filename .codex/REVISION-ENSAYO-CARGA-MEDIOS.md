# Revisión local del ensayo de carga de medios

Fecha: 10 de octubre de 2026 (America/Lima). Codex, QA de solo lectura. Base: `ec2a3b64b4fe7ad96e29d43bf9aef61ea2aa1c04`.

**Veredicto: ensayo remoto pendiente de corregir EC-01 y EC-02. No recomendar todavía su autorización de escrituras.** Los dos hallazgos se reprodujeron sin red. No son defectos demostrados de la Function desplegada; son defectos de validación/limpieza de la herramienta nueva.

## Fuentes examinadas

| Archivo | SHA-256 |
|---|---|
| scripts/lib/ensayo-carga.cjs | `23d2b2077708dd7a78d8163f2e4cdf81393c92aa71ce479739c0f3be2a890aed` |
| scripts/ensayo-carga-medios.cjs | `4d6b56777376d4177e57522c34d78a073906db48de677ddc99c950aba640ff69` |
| scripts/verificar-ensayo-carga.mjs | `7226216313deb32ca68c0df24fd874830ff9b7351699ae3df553b21a5926a10c` |

Se revisaron núcleo, CLI, suite y el helper existente de limpieza. Las tres herramientas nuevas siguen sin commit/publicación.

## Comprobaciones ejecutadas

- Suite existente `verificar-ensayo-carga.mjs`: **11/11**, exit 0.
- Sintaxis del CLI y `oxlint` de los tres archivos: sin diagnósticos.
- Diagnóstico independiente ETag: **5 escenarios**, con el adaptador real de lectura del CLI y el núcleo real; reprodujo aceptación indebida de ETag ausente en GET, HEAD y 304. Control sano aceptado y ETag distinto rechazado.
- Diagnóstico independiente de subida/limpieza: **4 escenarios**, usando los bloques reales de subida y `finally` más el helper real. Control sano, primer PUT confirmado con respuesta perdida e inventario final caído funcionan según lo previsto; el conflicto 409 borra un objeto inicial.

Son secciones aisladas con respuestas/Worker/inventario en memoria, no la ejecución completa del CLI. No se leyeron credenciales, no hubo navegador, red, subidas ni borrados externos.

## EC-01 — P2: un ETag ausente se acepta como lectura correcta

En `scripts/ensayo-carga-medios.cjs`, el adaptador convierte un header ETag ausente en `undefined`. En `scripts/lib/ensayo-carga.cjs:44`, la comparación está condicionada a `r.etag !== undefined`, por lo que omite precisamente ese caso.

Reproducción con ETag de referencia válido:

| Respuesta alterada | Resultado actual |
|---|---|
| GET sin ETag | completa=true; 302 lecturas; ninguna parada |
| HEAD sin ETag | completa=true; 302 lecturas; ninguna parada |
| 304 sin ETag | completa=true; 302 lecturas; ninguna parada |
| GET con otro ETag | completa=false; parada en la primera lectura |

**Corrección:** exigir referencias ETag válidas antes de lanzar la carga y un ETag presente e igual al esperado en cada 200/304, GET/HEAD/condicional. Ausente, vacío, null, undefined o distinto deben detener la corrida e informar la anomalía. Añadir regresiones usando también el adaptador del CLI, para no esconder la conversión de null a undefined. Mantener el límite y las paradas existentes.

## EC-02 — P2: la limpieza puede borrar un objeto anterior tras un 409

El CLI toma el inventario inicial, pero no comprueba que ambos prefijos previstos estén ausentes antes de hacer PUT. Marca `subidos=true` como intención, recibe un 409 y entra en `finally`, donde pasa ambos prefijos al helper. Ese helper borra cualquier objeto dentro de esos prefijos y solo compara con el estado inicial **después** del borrado.

Reproducción: el inventario inicial contiene `fotos-galeria/<UUID previsto de A>/m.webp`. El PUT A/m recibe 409 sin sobrescribirlo. A continuación la limpieza hace DELETE al grupo y elimina el objeto previo. El informe queda no confirmado porque falta una clave inicial, pero detectar la pérdida después no la evita.

Los UUID aleatorios hacen muy improbable una colisión casual. El diagnóstico fija los UUID únicamente en el doble para ejercitar el conflicto. Aun así, un rechazo por conflicto no demuestra propiedad de los objetos ni autoriza borrarlos; la herramienta debe respetar su promesa de tocar solo lo creado por la ejecución.

**Corrección:**

1. Comprobar ambos prefijos contra el inventario inicial y que los UUID sean distintos; ante conflicto, abortar antes de PUT y no hacer limpieza destructiva.
2. Mantener estados separados de precondición válida e intención de escribir, registrada antes de cada PUT. No perder la protección ante respuesta perdida del primer PUT, que en el control actual funciona.
3. Excluir siempre claves/grupos presentes inicialmente del plan de borrado. Ante 409 o pertenencia incierta de un grupo, conservarlo y registrar el pendiente; no inferir propiedad por conocer su UUID.
4. Añadir regresiones de los bloques/adaptadores reales del CLI: conflicto inicial A/B, error antes del primer PUT sin ningún DELETE, primer PUT guardado con respuesta perdida, rechazo sin commit e inventario caído. Los objetos iniciales deben quedar intactos.

El arreglo puede quedarse en el harness; no ampliar ni relajar permisos del Worker o Supabase para facilitarlo.

## Qué sí quedó corroborado

El núcleo sano realiza 302 lecturas y alcanza 10 simultáneas sin superar ese número. Implementa los niveles 1/5/10, tres muestras y paradas por discrepancia de bytes, ETag distinto, estado inesperado, fallo de red y umbral de 3 respuestas 429/5xx. Un error aislado queda contabilizado según el contrato declarado. Al dispararse la parada puede haber solicitudes ya en vuelo; no afirmar que se cancelan, porque el código las espera.

El CLI conserva preflight de marca/entrega antes de login, autenticación única, origen de staging acotado, intención de PUT antes del fetch, uso del evaluador de retirada por variante/POP y limpieza con inventario estricto. La respuesta perdida de un PUT ya guardado no dejó huérfanos en el control aislado. Inventario final ilegible no se aceptó como vacío.

## Precisiones no bloqueantes para agrupar con la corrección

- **Presupuesto:** 302 es el número del núcleo, no todo el CLI. HEAD de referencia, calentamiento, retirada, control, inventarios y preflight generan peticiones adicionales. Definir y registrar si el tope de 450 abarca solo lecturas de medios o todos los GET/HEAD; el contador actual no es global. Contabilizar y reservar la limpieza, sin bloquearla al agotar la carga.
- **Métricas:** se agregan por nivel; el registro interno incluye muestra pero no se conserva en el resultado. Guardar resúmenes por muestra mejora la comparación de las tres repeticiones. Indicar si los percentiles incluyen las respuestas con error; actualmente se incluyen.
- **Integridad del informe:** `completa` se determina por retirada y limpieza aunque otro `caso` haya fallado (p. ej., control B). El exit code sí falla por `resumen.fallos`. Conviene también hacer `completa=false` ante cualquier caso fallido para evitar dos señales contradictorias.
- Leer el panel antes/después no atribuye por sí solo sus agregados de 24 h a esta carga. Mantener la limitación y no equiparar latencia cliente con CPU.

## Qué debe preparar Claude mientras se revisa la corrección

**Continuar primero con el build de lectura mixta con B**, solo localmente. Facilita un rollback compatible antes de cerrar accesos alternativos. Debe conservar lectura de referencias `r2:`/URLs de Galería y la revocación B; un retorno a `r2.dev` público o una Function A no satisface el plan V2. Entregar artefacto reproducible y sus pruebas sin publicación automática.

Puede preparar después el harness del recolector limitado a UUID propios, pero no operarlo de forma destructiva ni programarlo. La corrección del ensayo de carga y sus regresiones se revisan antes de pedir autorización de sus 4 PUT/borrados en staging. No hay autorización nueva de escrituras, commit, push, cambios de acceso o producción en esta revisión.

## Evidencia

`evidencia-revision-ensayo-carga/diagnostico-etag.json` y `diagnostico-limpieza.json`; reproducciones conservadas como `.txt`. La ejecución de la suite fue de Codex, los escenarios independientes usaron las secciones reales sin modificar las fuentes. Los originales y el Git del proyecto permanecen intactos; solo se generan informe/evidencia nuevos bajo `.codex`, conforme a la instrucción del usuario.
