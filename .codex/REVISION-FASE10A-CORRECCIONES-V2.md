# Revisión Fase 10A · correcciones V2

Fecha: 2026-10-13, America/Lima. Codex, QA y auditor de solo lectura. HEAD `6929c619e88a91434cb16ee6a8d2de90de94c091`, rama `feat/cloudflare-pages`.

**Veredicto: no cierro todavía la Fase 10A.** Las reproducciones originales están atendidas y repetí la suite de herramientas: **38/38, código 0**. La evidencia sí respalda una batería única **22/22**. Sin embargo, encontré variantes no cubiertas por esa suite que dejan abiertas las guardas, la evaluación y el fallback del servidor. La propuesta de convivencia de deudas necesita además resolver el importe que muestra la versión antigua cuando existen abonos.

| ID | Prioridad | Pendiente |
| --- | --- | --- |
| F10A-01b | P1 | Una redirección durante el envío alcanza el señuelo antes de que la guarda haga fallar el CLI. |
| F10A-02b | P2 | Se aprueban muestras inválidas parciales, errores de página y manifiestos sin cierre o sin artefactos. |
| F10A-03b | P2 | El fallback a `index.html` evita la comprobación de ruta real. |
| F10A-05b | P1 para D11/transición | `main` sigue mostrando el importe original; el trigger registra solo el saldo sin que la operadora lo vea. |

**F10A-04 queda cerrado para el defecto de precisión:** se comparan muestras sin redondear, la mediana par es correcta y los límites no cambiaron. La validación de muestras incompletas se trata en F10A-02b.

**Cambio concurrente al cierre, 10:40 America/Lima:** después de las comprobaciones de hashes cambiaron `src/index.css` y `src/pages/cliente/InicioCliente.jsx`. El CSS añade `.lw-gutter-sep` para padding móvil; Inicio usa esa clase y nuevos márgenes móviles. El hash CSS pasó de `98e5f3ee…` a `87d3677d…`; Inicio tiene ahora `34076fd6…`. No los modifiqué ni revierto ese trabajo. Las herramientas y el borrador revisados conservan sus hashes. El 22/22 y las mediciones anteriores se atribuyen al paquete entregado; **no se reasignan al árbol de UI posterior a ese cambio**, que no forma parte de esta revisión.

## 1. Verificación independiente y alcance

- Repetí el comando **original** `probar-herramientas-10a.mjs` con el artefacto local servido y las identidades QA existentes. Sustituye las contraseñas por inventadas: **38/38**. Su control positivo inspecciona el bundle real; sus negativos no dejan asistentes temporales.
- Corroboré el resumen y los resultados de `bateria-v2-b/`: **22 productores con estado 0**; roles 19/19 con 46 rutas por perfil; compatibilidad de deudas 21 resultados correctos más la comprobación final, 22/22. **No repetí esa batería completa**.
- Verifiqué **23 SHA-256** del manifiesto V2, sin discrepancias, y las **6 copias de rollback** de herramientas contra sus hashes V1. Los 6 archivos de producto/configuración/verificaciones controlados por el manifiesto V1 coincidían al verificarlos; posteriormente cambió el CSS como se indica arriba. Esto no es una comparación de todo `src/`, del que ese manifiesto no contiene una fotografía completa.
- La evidencia de vitales V2 registra **18/46 incumplimientos en alcance parcial**, veredicto `NO CUMPLE`, sin problemas declarados y con 0 errores de página en sus muestras reales. La comparación anterior global conserva 18/219.
- Ejecuté nuevos negativos con Chromium real, el CLI original y servidores ficticios de loopback; usé una contraseña inventada. También evalué fixtures sintéticos con hashes coherentes, sin medir rendimiento nuevo.
- Inspeccioné en la UI compilada de `main` una deuda ficticia con monto original S/100 y abono previo supuesto de S/30: muestra **S/100**, ningún saldo S/70, y el botón «Cobrado». No pulsé ese botón ni escribí una deuda real.
- Consultas **de solo lectura** confirman el estado declarado de Local: 59 deudas, 8 pagos, suma 79 y firma `98734d8454b3fdac9007e277449705c2`; 0 triggers de compatibilidad, 0 funciones `deudas_compat%`, 0 deudas de ese ensayo y 0 asistentes temporales. El borrador no está instalado.

No ejecuté el ensayo SQL de compatibilidad. [AGENTS.md](C:/WedJaiseReact/AGENTS.md) prohíbe «execute destructive or mutating SQL» y modificar funciones/triggers/esquema, también en Local; la excepción permite workflows de UI y provisionar usuarios QA, no instalar DDL dentro de un ROLLBACK. Revisé ese ensayo por fuente, evidencia y estado actual. Las pruebas de UI aquí solo hicieron login QA Local y lecturas, con escrituras de negocio bloqueadas.

No modifiqué código, configuración, dependencias, migraciones ni Git; no hice acciones remotas. Los nuevos archivos del proyecto son únicamente este informe y su evidencia.

Evidencia: [evidencia-revision-fase10a-v2](C:/WedJaiseReact/.codex/evidencia-revision-fase10a-v2).

## 2. Hallazgos pendientes

### F10A-01b · P1 · Registrar la redirección no impide el envío

Fuente: [guardas-local-10a.cjs:179](C:/WedJaiseReact/scripts/fase10a/lib/guardas-local-10a.cjs:179), [línea 188](C:/WedJaiseReact/scripts/fase10a/lib/guardas-local-10a.cjs:188) y [línea 203](C:/WedJaiseReact/scripts/fase10a/lib/guardas-local-10a.cjs:203).

La comprobación de Node rechaza un 302 en `/login` **antes de navegar**, y los destinos directos ajenos se bloquean correctamente. Queda otra vía: una solicitud permitida durante la ejecución responde 302 hacia un destino ajeno. El callback de enrutado no intercepta el nuevo salto; `ctx.on('request')` solo lo registra y `exigirSinViolaciones` falla después.

La [documentación oficial de `page.route`](https://playwright.dev/docs/api/class-page#page-route) advierte que el handler se invoca para la primera URL de una respuesta redirigida. El fallo aquí está corroborado con el contexto real del proyecto y la versión instalada, no deducido solo de esa documentación.

**Reproducción con el CLI original `medir-vitales-10a.cjs`:**

1. App ficticia de loopback, bundle con la forma Local aceptada, y cuentas QA Local con contraseña inventada. El preflight pasa.
2. `/login` responde 200 tanto al preflight de Node como al navegador.
3. Al enviar el formulario, el bundle pide un GET a `/assets/rebote` con los campos inventados. Es una ruta permitida de la app.
4. La respuesta redirige al segundo servidor de loopback. El señuelo **recibe la contraseña inventada y el correo QA ficticio**.
5. El CLI registra «redireccion GET …/captura» y termina con **código 2**, pero el envío ya ocurrió.

Un control con solicitud **directa** al mismo señuelo fue bloqueado y dejó 0 peticiones. No utilicé contraseñas reales en esta reproducción, no se autenticó ningún usuario ni hubo red externa. Los 16 negativos entregados siguen siendo válidos para sus escenarios; no prueban esta redirección posterior al login.

**Corrección recomendada:** impedir la salida antes de transmitir cada salto, incluidas peticiones de datos/recursos y métodos con cuerpo; un listener posterior no sirve como barrera. Mantener el bloqueo en todos los contextos y la comprobación de backend. Si se usa otra forma de interceptar, verificar que no retire el throttling de red del medidor: reemplazar solicitudes por fetch de Node sin control de tiempos cambiaría el método de medición.

**Regresiones:** login inicial 200 seguido de 302/303/307/308 durante el envío o la carga de recursos, destino ajeno de mismo host/otro puerto y destino externo simulado, cadenas de varios saltos, y controles positivos locales. La condición es **0 peticiones al señuelo**, no solo exit distinto de cero.

Evidencia: `login-redirect-runtime.json`, `medidor-negativo-redirect.json`, `medidor-negativo-redirect.log`; control de contexto en `diagnosticos-v2.json`.

### F10A-02b · P2 · La evaluación aún acepta datos o identidad incompletos

Fuentes: [evaluar-presupuestos.mjs:132](C:/WedJaiseReact/scripts/fase10a/lib/evaluar-presupuestos.mjs:132), [estadistica.cjs:5](C:/WedJaiseReact/scripts/fase10a/lib/estadistica.cjs:5), [medir-rendimiento-10a.mjs:105](C:/WedJaiseReact/scripts/fase10a/medir-rendimiento-10a.mjs:105).

La corrección del vacío, del productor fallido, de los archivos ausentes y del hash incorrecto funciona. Persisten cuatro reproducciones con el **evaluador original**, alcance vitales, archivos esperados presentes y hashes coherentes:

| Fixture | Resultado observado |
| --- | --- |
| Tres registros por modo, pero solo uno con LCP/CLS/interacción numéricos; los otros dos contienen `null` o texto | `46/46`, 0 problemas, `CUMPLE`, exit 0 |
| Todas las muestras con `errores: 3` | `46/46`, 0 problemas, `CUMPLE`, exit 0 |
| Sin `manifiesto.fin` y con todas las huellas finales `null` | `46/46`, 0 problemas, `CUMPLE`, exit 0 |
| Manifiesto con `artefactos: {}` | `46/46`, 0 problemas, `CUMPLE`, exit 0 |

Un control sintético completo y válido también obtiene 46/46; los negativos preservan su estructura y solo cambian el campo indicado. **No son métricas reales ni invalidan por sí mismos los valores reales de la entrega.**

La longitud del array se valida antes de que `mediana()` filtre los valores inválidos: se pueden exigir tres registros y decidir con una única muestra válida. Los errores de página no afectan al estado `completo`. En el manifiesto se comprueba el final solo si existe (`h.fin && …`) y no se exige ninguna entrada de artefacto ni cierre de ejecución. Por eso una medición cuyo servidor desaparece al tomar la huella final, o una ejecución interrumpida después de guardar productores, puede aprobarse al reevaluarla.

**Corrección recomendada:** exigir el mínimo de muestras **válidas por cada métrica obligatoria**, comprobar calidad del escenario y declarar cómo se tratan errores de página; si existe una excepción conocida, documentarla expresamente. Exigir cierre de ejecución y el conjunto de artefactos requerido por el alcance, con inicio y final no vacíos e iguales. Aplicar la misma validación a los grupos cuyo esquema contiene muestras; no fiarse únicamente de una mediana o resumen.

**Regresiones:** mezclas válido/null/texto/no finito, errores de página, falta de final, fallo al obtener huella final, artefactos vacíos/omitidos y productor íntegro de control. Los datos inciertos deben quedar `INCOMPLETA`, código no cero.

Evidencia: `diagnosticos-v2.json`, `muestras-invalidas-mixtas/`, `muestras-con-pageerror/`, `sin-huella-final/`, `sin-artefactos/` y `control-sano/`.

### F10A-03b · P2 · La comprobación de ruta real se omite en el fallback

Fuente: [servir-como-pages.cjs:87](C:/WedJaiseReact/scripts/fase10a/servir-como-pages.cjs:87).

Los assets y el índice de un directorio pasan por `archivoDentro`. Si la ruta solicitada no existe, se asigna directamente `path.join(raiz, 'index.html')` y se lee sin validar su ruta real.

**Reproducción independiente:** tras arrancar el servidor en una carpeta QA propia, renombré exclusivamente esa carpeta y la sustituí por una junction a otra carpeta QA con una marca inventada. Las rutas absolutas del movimiento se verificaron dentro del directorio de prueba. GET `/index.html` devuelve **403**, como debe; GET `/ventas` cae en el fallback y devuelve **200 con el índice ajeno**. No leí ningún archivo privado ni modifiqué carpetas del proyecto. Requiere un árbol servido mutable; es un defecto de la herramienta local, no de Cloudflare.

**Corrección recomendada:** aplicar la misma validación de pertenencia y ruta real al archivo de fallback antes de leerlo. Mantener las respuestas controladas y el fallback normal sobre un índice propio.

**Regresiones:** raíz/índice enlazado fuera al resolver el fallback, cambio del árbol después del arranque, y controles directos y SPA con un índice propio. Evitar que un caso sea 403 por ruta directa y 200 por fallback.

Evidencia: `diagnosticos-v2.json`, caso `fallback-sin-ruta-real`.

### F10A-05b · P1 para D11 · El saldo registrado y el importe visible en `main` difieren

Fuentes: `main:src/pages/Deudas.jsx`, especialmente su SELECT sin `deuda_pagos`, `totalVisible` y `formatearSoles(deuda.monto)`; [borrador:91](C:/WedJaiseReact/.codex/propuesta-f10a-05/compat-deudas-borrador.sql:91), [plan:52](C:/WedJaiseReact/.codex/PLAN-VALIDACION-STAGING-FASE10.md:52).

El borrador atiende el problema de estado/ledger original en los escenarios seriales descritos. No basta todavía para recomendar que la versión antigua siga cobrando deudas con abonos:

- Deuda original S/100, abono previo S/30 en la UI nueva: saldo S/70.
- `main` no lee los pagos. La tarjeta y el total de pendientes siguen mostrando **S/100**, y el botón «Cobrado» continúa disponible. Lo confirmé en la UI compilada con respuesta de deuda ficticia.
- El caso S2 del ensayo y el AFTER trigger registran **S/70** al recibir ese cambio de estado. No reciben el importe que la operadora cobró; solo infieren el saldo.

Por tanto, el invariante de SQL puede cumplirse mientras la pantalla antigua induce a cobrar S/100 y el ledger añade S/70. **No hice un cobro ni afirmo que una persona haya cobrado de más.** Lo demostrado es que la UI no informa el saldo y que el borrador presupone el importe restante. Lo mismo aplica al saldo pendiente tras aumentar una deuda ya pagada.

**Corrección recomendada:** ampliar D11 al contrato del importe que se muestra y se cobra. Impedir el cobro heredado cuando no pueda representar de forma inequívoca el saldo —por ejemplo, deudas con pagos previos— o usar la pausa de Deudas hasta que todas las operadoras utilicen el lector compatible. No presentar como única pérdida de `main` la reapertura. La solución y la autorización de cualquier migración corresponden al usuario/Claude; este hallazgo no implica aplicar el borrador ahora.

**Regresión necesaria:** abono en UI nueva → lectura real de `main` → intento de cobro antiguo, verificando monto visible, importe efectivamente autorizado y ledger; repetir con deuda pagada cuyo monto aumenta. Un ensayo que solo valida `COBRADA` y suma de pagos no cubre el monto que ve la persona.

Evidencia: `deuda-parcial-main-ui.json`, `main-deuda-abono-ficticio.png`; referencia de S2 en la evidencia y SQL del autor. El borrador sigue sin aplicar. No lo apruebo todavía como opción D11 de producción.

## 3. Aceptaciones y observaciones

- F10A-04: precisión y mediana par cerradas. No se modificaron umbrales. Los valores reales continúan con **18 incumplimientos**, correctamente rotulados `NO CUMPLE`.
- Se corroboran el éxito único 22/22 y las copias de rollback. La lectura actual coincide con la firma y conteos de deudas/pagos entregados. Esto no acredita igualdad física de toda la base, ni ejecución concurrente, ni un despliegue del mecanismo.
- No repetí las 19 comprobaciones de roles: el paquete entregado conserva los archivos de producto controlados, la suite 38/38 prueba sus nuevas guardas para los escenarios que contiene y la evidencia de roles del autor es coherente. Se conserva la corroboración anterior de navegación en Local, con el límite del cambio concurrente indicado arriba; los accesos SQL y las operaciones de cada pantalla tienen sus alcances separados.
- El rechazo de `/%2e%2e/...` en el servidor puede normalizarse a una ruta SPA y responder 200 con el índice propio, como reconoce la prueba nueva. Es correcto que no sirva la marca ajena; el encabezado de la herramienta/entrega no debe prometer 400 para todas las variantes de puntos codificados si la prueba espera 200.
- El hash de `index.html` identifica razonablemente un build cuyos assets llevan hashes. En Vite dev no identifica todo el código servido: el HTML puede mantenerse mientras cambia `src/`. Documentar ese límite y mantener la disciplina de no editar durante mediciones, o registrar una identidad suficiente del candidato.
- Los 14 incumplimientos LCP no quedan exceptuados por este informe. La razón «no peor que lo publicado» solo puede usarse para pares comparables: el visitante no tiene un portal equivalente en `main`, y el Inicio de clienta de `main` no terminó de cargar. Son mediciones de laboratorio local, no una comparación de hosts públicos.
- No apruebo una excepción permanente de CLS 0,33. La decisión D12 puede autorizar a Claude una corrección local de espacio reservado y su QA; sigue pendiente del usuario. Las excepciones LCP requieren alcance, criterio y tratamiento si la evidencia de campo incumple, sin cambiar silenciosamente los presupuestos.
- Las intermitencias previas F4/F5 siguen como observación. Una corrida verde no demuestra su causa.

## 4. Siguiente entrega

Claude debe corregir F10A-01b, F10A-02b y F10A-03b en las herramientas, conservar los controles positivos y añadir estas variantes a las regresiones. Ampliar la propuesta/alternativa D11 para F10A-05b. Presentar V3 en Local con evidencia nueva sin sobrescribir V1/V2. No hace falta rehacer todo el laboratorio para corregir validaciones puras, pero deben ejecutarse los negativos y positivos afectados.

Esta revisión no valida una publicación ni la 10B. No ejecuté commit, push ni migraciones remotas; esas decisiones corresponden al usuario. La QA deja avanzadas las correcciones originales y el control de precisión, y mantiene pendientes las variantes documentadas.
