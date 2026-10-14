# Entrega Fase 10A · correcciones V3

Fecha: 2026-10-13, America/Lima. Claude. Rama `feat/cloudflare-pages`, HEAD `6929c619`, **sin commit**. Responde a [REVISION-FASE10A-CORRECCIONES-V2.md](REVISION-FASE10A-CORRECCIONES-V2.md).

**Alcance.** Solo herramientas de QA de `scripts/fase10a/`, el borrador y el ensayo de deudas, y documentos. **No toqué `src/`, las migraciones ni la configuración**, no hice acciones remotas, commit ni push, y no instalé nada en Local fuera del ensayo revertido. La V1 y la V2 se conservan sin sobrescribir: la evidencia V3 está en [evidencia-fase10a-v3/](evidencia-fase10a-v3/).

**Pruebas: solo las específicas de cada fallo**, por indicación del usuario. Se ejecutaron:
- los negativos de cada fallo;
- los positivos que el cambio podía afectar;
- la suite de herramientas, en una sola corrida como evidencia.

No se repitieron la batería global de 22 comprobaciones ni la medición de vitales: ninguna corrección cambia el producto, y las cifras de rendimiento no se volvieron a medir.

| ID | Estado V3 | Regresión |
| --- | --- | --- |
| F10A-01b · P1 | **Corregido**: cada contexto sale a la red por un proxy de guarda que decide **cada salto antes de transmitirlo** | 0 peticiones al señuelo en todas las variantes; control positivo de roles 19/19 a través del proxy |
| F10A-02b · P2 | **Corregido**: muestras válidas por métrica, errores de página, cierre de la ejecución, artefactos por grupo y huella de las fuentes | 14 negativos nuevos y los 5 fixtures de Codex; la evidencia real V2 reevaluada no cambia |
| F10A-03b · P2 | **Corregido**: el índice del fallback pasa la misma comprobación de ruta real | 403 por ruta directa **y** por fallback; defecto reproducido en la copia V2 |
| F10A-05b · P1 para D11 | **Borrador V3 y contrato del importe**: un cobro de `main` solo se acepta sin pagos previos; con abonos se rechaza sin tocar el ledger | Ensayo **26/26** en Local dentro de un ROLLBACK; reacción del build de `main` comprobada |
| F10A-04 | Cerrado por Codex | Sin cambios: siguen pasando sus casos |

Suite de herramientas: **60/60, código 0** (los 38 casos de la V2 y 22 nuevos), con el control positivo del preflight sobre el build real, en [herramientas.json](evidencia-fase10a-v3/herramientas.json).

## 1. F10A-01b · redirección en ejecución

**Causa.** El enrutado de Playwright solo ve la primera URL de una redirección. El listener `ctx.on('request')` registraba el salto después de enviarlo, cuando el señuelo ya lo había recibido.

**Corrección** ([guardas-local-10a.cjs](../scripts/fase10a/lib/guardas-local-10a.cjs), `crearProxyGuarda` y `contextoSeguro`). Cada contexto de las herramientas se crea con un **proxy de guarda propio**, un servidor Node en loopback. Playwright fuerza `<-loopback>`, así que el navegador pide a través de él **todas** las peticiones que transmite, también a loopback y también cada salto de una redirección.

El proxy aplica la misma clasificación **antes de conectar** con el destino:
- **Permitida:** se reenvía sin seguir redirecciones. El siguiente salto vuelve a pasar por el proxy.
- **Cualquier otra:** recibe un 403 del propio proxy, sin abrir conexión, y queda registrada como violación «salto». Esto incluye un GET a terceros, que normalmente ya se responde con 204 dentro del navegador. Que llegue uno al proxy significa que escapó al enrutado.
- **Túneles CONNECT** (WebSocket y https): solo hacia `127.0.0.1:54321`. Los demás se niegan sin conectar.

Se mantienen el enrutado, el bloqueo de service workers, la sonda de Node del login y la comprobación del backend efectivo. El listener queda como registro adicional.

**Método de medición.** No cambia: el throttling es la emulación de red de CDP y se aplica en el navegador, antes del proxy. Lo comprueba un caso con latencia de 600 ms, que tarda 616 ms. No se sustituyó ninguna petición por un fetch de Node. El proxy añade un salto local, sin latencia artificial. Las cifras de la V2 se midieron sin él y no se volvieron a medir.

**Regresiones** (la condición es **0 peticiones al señuelo**, no solo un código distinto de 0):

| Caso | Resultado |
| --- | --- |
| Guarda real con Chromium, tras una página 200: `fetch` que la app redirige con 302, 303, 307 y 308 a otro puerto del mismo host | 0 peticiones al señuelo; 4 saltos registrados |
| El mismo `fetch`, redirigido a un destino externo simulado (`capturador.qa-f10a.invalid`) | No se resuelve ni se transmite; salto registrado |
| Cadena de saltos (302 dentro de la app → 308 al señuelo) | 0 peticiones; salto registrado |
| Recurso (`<img>`) que redirige con 307 | 0 peticiones |
| Navegación que redirige con 303 | El proxy responde 403; 0 peticiones |
| CONNECT a un puerto ajeno | 403 sin conectar; violación «tunel» |
| Control positivo: redirección 302 dentro de la app | `200 OK interno`, el destino recibido por la app |
| Control positivo: throttling a través del proxy | Latencia de 600 ms → 616 ms |
| **CLI reales** (`medir-vitales` y `verificar-roles`): login 200 y, al enviar, un GET permitido a la app que esta redirige al señuelo, la reproducción de Codex | 0 peticiones al señuelo, código 2, «guarda de red … salto GET …/captura»; 0 asistentes |
| CLI reales: la misma cadena con 303 dentro de la app y 307 al señuelo | Igual |
| Los 16 negativos de la V2 con las dos herramientas | Siguen pasando con el proxy |
| **Control positivo real**: `verificar-roles-rutas.cjs` contra el build Local (`dist-cf`) con las cuentas QA | **19/19**: 5 perfiles × 46 rutas, login real, menú y cierre de sesión, con 0 violaciones por perfil a través del proxy ([roles-control-positivo.json](evidencia-fase10a-v3/roles-control-positivo.json)) |

Métodos con cuerpo: el enrutado ya prohíbe cualquier método distinto de GET o HEAD hacia la app, así que un 307 o 308 con cuerpo solo podría originarse en el Supabase Local, que es el destino aprobado. El proxy aplica la misma regla a cada salto: un POST que llegara a otro destino recibiría 403 sin conectar.

## 2. F10A-02b · evaluación con datos o identidad incompletos

**Muestras** ([evaluar-presupuestos.mjs](../scripts/fase10a/lib/evaluar-presupuestos.mjs)). En cada grupo con muestras (cupones, búsqueda, iniciales y vitales) solo cuentan las muestras **válidas**: todas sus métricas obligatorias numéricas o booleanas, según corresponda, y **sin errores de página**.

**Política de errores de página:** una muestra con alguno no es válida, sin excepciones declaradas. Con menos de `muestras_min` válidas para un resultado, la evaluación queda INCOMPLETA.

Las cifras se **recalculan desde las muestras válidas**, no desde la mediana o el resumen del medidor:
- vitales e iniciales: mediana exacta;
- búsqueda: desde `crudas`, con las mismas reglas que su medidor;
- cupones: mediana de `task_ms` y máximo de `mayor_tarea_ms`.

`presupuestos-rendimiento.json` añade `muestras_min: 3` en cupones, búsqueda e iniciales. **Ningún límite cambió.**

**Manifiesto** ([medir-rendimiento-10a.mjs](../scripts/fase10a/medir-rendimiento-10a.mjs)), en formato 3:
- registra la app de cada grupo (`apps`) y una huella de las **fuentes** del candidato (`src/`, `index.html`, `vite.config.js` y `package-lock.json`) al empezar y al terminar;
- la evaluación exige el **cierre** (`fin`) y, para cada app del alcance, una huella inicial y una final, ambas SHA-256 e iguales;
- las fuentes también deben ser iguales al empezar y al terminar.

Un manifiesto V2 sin `apps` solo se acepta con alcance de un grupo, cuyos artefactos son necesariamente los suyos.

La huella de las fuentes atiende la observación de Codex sobre Vite dev: allí `index.html` no cambia aunque cambie `src/`. No sustituye la disciplina de no editar durante una medición, pero la vuelve verificable.

| Regresión (fixture sano con un solo cambio) | Resultado |
| --- | --- |
| Vitales: 3 registros, solo 1 válido (null, texto o no finito) | INCOMPLETA, código 1 |
| Vitales: una sola métrica inválida en una muestra | INCOMPLETA |
| Vitales: errores de página en todas las muestras | INCOMPLETA |
| Iniciales: un error de página en una muestra; o una métrica de texto con la mediana resumida aún cumpliendo | INCOMPLETA |
| Búsqueda: error de página en una muestra cruda | INCOMPLETA |
| Cupones: errores de página en una ruta | INCOMPLETA |
| Manifiesto sin `fin` | INCOMPLETA |
| Huella final nula | INCOMPLETA |
| `artefactos: {}` o sin la entrada | INCOMPLETA |
| App de un grupo no declarada | INCOMPLETA |
| Fuentes cambiadas | INCOMPLETA |
| Formato V2 con varios grupos | INCOMPLETA |
| **Fixtures de Codex**, copiados para no tocar su evidencia | `control-sano`: CUMPLE, código 0. `muestras-invalidas-mixtas`, `muestras-con-pageerror`, `sin-huella-final` y `sin-artefactos`: INCOMPLETA, código 1 |
| Controles: ejecución sana completa | CUMPLE 219/219, código 0 |
| Controles: evidencia V1 sin manifiesto | 18/219 incumplimientos e INCOMPLETA |
| **Evidencia real V2 de vitales** reevaluada con el evaluador V3 (copia) | Igual que en la V2: 28/46, NO CUMPLE, 0 problemas |

## 3. F10A-03b · fallback sin ruta real

**Corrección** ([servir-como-pages.cjs](../scripts/fase10a/servir-como-pages.cjs)). El `index.html` del fallback de SPA pasa por `archivoDentro`, igual que los assets y el índice de un directorio:
- si su ruta real sale de la carpeta servida, responde **403**;
- si no existe, responde **404**.

También corregí el encabezado, como pidió Codex: `/%2e%2e/…` lo normaliza el parser de URL y cae en el fallback con el índice **propio**, con 200. No responde 400.

| Regresión | Resultado |
| --- | --- |
| Carpeta servida sustituida por una junction a otra carpeta **después de arrancar**, con el índice propio ya en caché | `/ventas`, `/index.html`, `/` y `/clientes/123`: todas 403, ninguna con el índice ajeno |
| Lo mismo sin petición previa (la reproducción de Codex) | Todas 403 |
| Antes del cambio: SPA, raíz y assets propios | 200 |
| **Copia V2** (rollback) en el escenario de Codex | `/index.html` 403, pero `/ventas` y `/clientes/123` 200 **con el índice ajeno**: defecto reproducido |
| Casos V2 del servidor (prefijo vecino, traversal, junction, URI malformada, NUL, HEAD y `_headers`) y reproducción en la V1 | Siguen pasando |

## 4. F10A-05b · importe visible en `main`

**Contrato del importe.** Lo comprobé en el build compilado de `main` ([probar-deuda-main-ui.cjs](../scripts/fase10a/probar-deuda-main-ui.cjs), [deuda-main-ui.json](evidencia-fase10a-v3/deuda-main-ui.json)):
- `main` no lee `deuda_pagos`. Con una deuda de S/100 y un abono de S/30, la tarjeta muestra **S/100**, no S/70.
- Su cobro envía **solo** `{ estado: 'COBRADA', cobrado_en }`, sin importe.

Por tanto, el cobro de `main` solo es inequívoco cuando la deuda no tiene pagos, porque entonces lo visible es el saldo.

**Borrador V3** ([compat-deudas-borrador.sql](propuesta-f10a-05/compat-deudas-borrador.sql)). Sigue siendo un borrador, no una migración, y no está aplicado en ningún entorno.

| Cobro desde `main` | V2 | V3 |
| --- | --- | --- |
| Deuda sin pagos | Pago por el saldo, que es el monto | Igual: **un pago por el monto completo**, el importe visible |
| Deuda con abonos que no la cubren | Pago por el saldo **inferido** (S/70) mientras `main` mostraba S/100 | **Se rechaza** («La deuda tiene abonos registrados (S/ 30.00 de S/ 100.00); cóbrala en la versión actual, que muestra el saldo.»). El ledger queda igual |
| Deuda pagada cuyo monto se aumentó (S/100 pagado, nuevo monto S/150) | Pago inferido de S/50 mientras `main` mostraba S/150 | **Se rechaza**; la diferencia se cobra en la UI nueva |

El recálculo de las RPC de la UI nueva sigue aceptándose: pasa a COBRADA con pagos que cubren el monto, un cambio coherente. El ensayo detectó justo ese caso en la primera versión del cambio, que también rechazaba el cobro del saldo hecho desde la UI nueva. Lo corregí: solo se rechaza un cambio a COBRADA con pagos mayores que 0 y **menores** que el monto. La primera corrida está en el ROLLBACK y Local quedó intacto.

**Ensayo en Local**, una transacción revertida como la administradora QA con RLS ([compat-deudas.json](evidencia-fase10a-v3/compat-deudas.json)): **26/26**, con Local idéntico después (59 deudas, 8 pagos, suma 79, firma `98734d84…`, 0 triggers y 0 funciones). Los casos nuevos o cambiados son:
- **S1d:** sin abonos, el importe visible en `main` es el saldo y coincide exactamente con el pago registrado.
- **S2a:** con un abono, `main` mostraría S/100 con un saldo de S/70.
- **S2b:** el UPDATE exacto de `main` se rechaza y el ledger queda en un pago de S/30.
- **S2c:** la UI nueva cobra el saldo de S/70 y la deuda pasa a COBRADA.
- **S5b y S5c:** monto aumentado: `main` mostraría S/150 con un saldo de S/50, se rechaza, y la UI nueva cobra la diferencia.

**Reacción de `main` al rechazo**, en su build compilado (login QA Local). La deuda y la respuesta del PATCH las sirve el interceptor, con el error que da PostgREST para ese trigger; ninguna escritura llega a la base. Resultado:
- aviso «No se pudo actualizar la deuda.»;
- la tarjeta sigue «Pendiente» por S/100;
- 0 escrituras abortadas.

**La cadena queda probada así:** el ensayo SQL demuestra la respuesta de la base a ese UPDATE, y la prueba de UI demuestra qué ve `main`, qué envía y cómo reacciona.

**Lo que la base no puede corregir:** mientras `main` siga abierta, muestra el monto original y un total de pendientes sin descontar abonos. Por eso amplié D11 en el plan de staging §0.1:
- **D11-A, recomendada:** mecanismo V3 más la regla «las deudas con abonos se cobran y consultan solo en la versión nueva».
- **D11-B:** mecanismo V3 más la pausa de Deudas en `main`.
- **D11-C:** solo pausa (no recomendada).

El plan añade la regresión en staging que pidió Codex:
1. Hacer un abono en la UI nueva.
2. Leer esa deuda en `main`.
3. Intentar cobrarla desde `main`.

Repetirla con un monto aumentado.

Esta entrega no aplica el borrador ni autoriza migraciones: eso corresponde al usuario.

## 5. Observaciones de la revisión V2

- **D12:** reescribí la decisión con el criterio de Codex:
  - **CLS 0,33:** sin excepción permanente; la opción es autorizar una corrección local con su QA.
  - **LCP:** una excepción necesita alcance, criterio y tratamiento si los datos de campo incumplen. «No peor que `main`» solo vale para pares comparables, y estas son mediciones de laboratorio local.
- **Hash de `index.html` en Vite dev:** el límite está documentado, y el manifiesto V3 añade la huella de las fuentes (nuevo P30).
- **Cambio concurrente:** `src/index.css` e `InicioCliente.jsx` cambiaron después de las mediciones, y siguen cambiando: sus hashes actuales no coinciden con los que anotó Codex. **No son cambios míos**. Esta entrega no los modifica ni se les atribuye ninguna medición.
- **Registro de fases:** `FASES-RENDIMIENTO-CLOUDFLARE.md` se reescribió hoy a las 10:41, después de la V2. Sus filas 8, 9 y 10A dicen «Pendiente» y ya no contienen la actualización de la V2. **No lo modifiqué**: conviene que quien lo reescribió confirme su estado.
- **Intermitencias F4 y F5:** siguen como observación.

## 6. Archivos

**Modificados** (las copias de la versión V2 están en `evidencia-fase10a-v3/rollback/v2/`):
- `scripts/fase10a/lib/guardas-local-10a.cjs`
- `scripts/fase10a/lib/evaluar-presupuestos.mjs`
- `scripts/fase10a/medir-rendimiento-10a.mjs`
- `scripts/fase10a/servir-como-pages.cjs`
- `scripts/fase10a/presupuestos-rendimiento.json` (solo `muestras_min` y la descripción)
- `scripts/fase10a/probar-herramientas-10a.mjs`
- `scripts/fase10a/ensayar-compat-deudas.mjs`
- `.codex/propuesta-f10a-05/compat-deudas-borrador.sql`
- `.codex/propuesta-f10a-05/ensayo-compat-deudas.sql`

**Nuevo:** `scripts/fase10a/probar-deuda-main-ui.cjs`.

**Documentos:** esta entrega, el plan de staging (V3: §0.1 y criterio 6), los pendientes (D11, D12, P19, P29 y P30) y §56 de `implementacionesWed.md`.

**Rollback:** [rollback-fase10a-v3.md](evidencia-fase10a-v3/rollback/rollback-fase10a-v3.md); hashes en `evidencia-fase10a-v3/rollback/SHA256-v3.txt`.

Lint: 0 errores y 66 avisos, igual que en la V2, ninguno en `scripts/fase10a`. Servidores locales apagados al terminar.

Fase 10A V3 lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario.
