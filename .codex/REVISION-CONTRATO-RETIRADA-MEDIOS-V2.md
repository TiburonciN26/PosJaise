# Revisión V2: verificadores y diseño del contrato de retirada

Fecha: 10 de octubre de 2026. Codex, QA de solo lectura.

**Veredicto: adaptación local de los verificadores aprobada, sin bloqueos de código.** La implementación local de la Function mantiene la aprobación anterior. Queda una precisión documental no bloqueante. Esta revisión no autoriza commit, push, reconstrucción, activación de B ni escrituras de pruebas remotas.

## Alcance e identidad

HEAD: `08a740e9ff39646161ea9c45ea2fe37866d5758f`. Se revisaron los cambios locales de los dos verificadores, los comentarios de `entrega.js` y el documento no versionado `DISENO-CONTRATO-RETIRADA-MEDIOS.md`.

| Archivo | SHA-256 |
|---|---|
| scripts/verificar-medios-pages-cache.cjs | `88c95dc3f1dc858b6dcf7011fd527f10db1bd468c1edc5701e5afd1bcf59244b` |
| scripts/verificar-interfaz-r2-preview.cjs | `13d86750335177dfda7336d1393405c14b4ea1bdd6468c1d864da7ca34c90c20` |
| cloudflare/medios-pages/entrega.js | `25a6371bcfcf972f3d6dbad8c34abc258bdf1c87c61c508c44237e5463fa6d08` |
| Diseño | `436e9759506a17de0eca488451004380f67c76753ac094e04d14f31257e03283` |

## Comprobaciones ejecutadas

- `node --check` de ambos verificadores: exit 0.
- `oxlint` de ambos verificadores y `entrega.js`: sin diagnósticos, exit 0.
- `node scripts/verificar-guardas-interfaz-r2.cjs`: **48 casos, 0 fallos, exit 0**. Suite local con dobles y servidores HTTP de bucle local; no acceso a servicios externos.
- Comparación independiente del texto de ambos verificadores con HEAD: **2 comparaciones, 0 diferencias fuera de las modificaciones aprobadas**. En caché se permitieron únicamente la nueva constante/cabecera, comentarios y nombres de casos; en interfaz, únicamente el literal de la cabecera esperada. El resto coincide.

La lógica ejecutable de la Function no cambió respecto de la revisión anterior; cambian los dos comentarios solicitados. La prueba de entrega conserva el SHA-256 `bf8aa5392645bdfc938c2dc9028cb08226a2840c1c0d80865355b9d6a5e1f627`. No repetí las 48 pruebas de entrega, los 14 diagnósticos anteriores ni la suite de rollback sin cambios. Los resultados anteriores siguen atribuidos a su revisión; no presento como ejecución propia nueva las tres suites citadas por Claude.

## Qué quedó correctamente adaptado

El verificador de caché exige `public, max-age=0, must-revalidate` en HEAD, GET MISS, GET HIT y 304. `TTL_S=300` se conserva para la espera de expiración del borde, con observación del POP y advertencia cuando cambia. El de interfaz exige la misma política en las cuatro variantes de Producto cuando la entrega es Pages; conserva el comportamiento de `r2dev`.

Se mantienen las verificaciones anteriores de bytes completos, ETag, HIT/MISS, rutas, métodos, errores, aislamiento, inventario, limpieza y estado final. El cambio no acredita que se haya probado la política en un deployment nuevo, ni el comportamiento del caché HTTP del navegador. Los HTTP del script y la suite simulada no sustituyen esa medición real.

Los comentarios de la Function ya diferencian 304 con ETag coincidente de 200 con otro ETag/sin condicional; los 300 segundos se describen solo como TTL del borde. El documento aclara que ~600 s era una hipótesis de la política anterior, que B está probada solo localmente y que el contrato de producción depende de la clienta. B continúa desactivada y los envoltorios no la fuerzan.

## Observación documental no bloqueante

`DISENO-CONTRATO-RETIRADA-MEDIOS.md:97–99` aún dice **“Pendiente de actualizar”** y **“No se tocaron”** los verificadores, pese al estado correcto de §6d. Marcar ese párrafo como histórico o sustituirlo por una referencia a §6d. Puede agruparse con la preparación del paquete, sin un push dedicado ni otra ronda de pruebas por esa edición. En §1, identificar también como estado publicado anterior la política de navegador de 300 s para distinguirla de la local nueva.

## Siguiente paso y límites

Claude puede preparar el listado exacto del paquete y su validación reproducible local, incluyendo esa precisión editorial. Antes de publicar o ejecutar ensayos reales se necesita la autorización humana correspondiente. La prueba real deberá identificar el nuevo artefacto y la configuración efectiva; la evidencia antigua no se reasigna al cambio local.

No se visitó Cloudflare ni Supabase, no se leyeron credenciales ni se ejecutaron los dos verificadores con sus flujos reales. No hubo build, instalación, cambios de fuente/configuración/datos, commit o push. Se guardan únicamente este informe nuevo y su evidencia en `.codex`, conforme a la instrucción del usuario.

Pendientes de producción sin cambios: medición de ventana efectiva, CPU/latencia/cuota, decisión de retirada de la clienta y alcance del acceso público de `r2.dev`. La aprobación local no cierra la Fase 3 completa.
