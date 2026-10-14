# Revisión Fase 9 · Corrección V2.1 y servidor con plazo

Fecha: 2026-10-12, America/Lima. Rama `feat/cloudflare-pages`, HEAD `6929c619e88a91434cb16ee6a8d2de90de94c091`. Entrega: [ENTREGA-FASE9-CORRECCIONES-V2.1.md](C:/WedJaiseReact/.codex/ENTREGA-FASE9-CORRECCIONES-V2.1.md).

## Veredicto

**APROBADA CON OBSERVACIONES, solo para implementación y preparación/QA LOCAL de la Fase 9. F9-03b queda cerrado en el alcance probado.** Se mantienen los cierres de F9-01, F9-02, F9-04, F9-05 y F9-06; no hay hallazgos bloqueantes abiertos de estas revisiones.

No es aprobación de una migración de medios del negocio ni de staging/producción. La nueva migración está aplicada únicamente en Local según lo comprobado; aplicarla en otro ambiente requiere autorización explícita. No se autoriza commit, push, cambio de hosting, retiro de GitHub Pages ni empezar la Fase 10 por este veredicto.

## 1. Comprobaciones independientes

| Comprobación | Resultado |
| --- | --- |
| Unitarias existentes repetidas | 17/17, exit 0 |
| CLI/harness reales contra backend ficticio repetidos | 18/18, exit 0 |
| Caso adicional: barrera que espera a un cambio ejecutado antes del plazo pero confirmado después | 1/1, original restaurado |
| Definiciones instaladas en Local | Los 3 cuerpos coinciden con el SQL de la migración |
| Seguridad de funciones y tablas | `SECURITY INVOKER` en las 3; sin EXECUTE para `anon`/`PUBLIC`; RLS activa en las 5 tablas del alcance |
| Hashes de paquete V2.1 y copias de rollback | 12 actuales y 7 copias V2 coinciden |
| `git apply -R --check` | Correcto; no se aplicó el parche |

Las repeticiones de CLI se ejecutaron con credenciales ficticias, servidor HTTP en memoria y el preload que bloquea/redirige destinos externos. Se aisló el temporal del proceso bajo la carpeta propia de QA para conservar las carpetas previas de Claude. El test de junction del harness volvió a ejercitarse con la trampa de efectos; no se siguió el enlace para borrar `src`.

No se ejecutaron `probar-plazo-pg.mjs` ni la simulación completa: ambos realizan escrituras SQL/creación y limpieza de fixtures, fuera del rol de auditor de Codex. Sus informes **7/7** y **18/18** son evidencia entregada por Claude y auditada, no una segunda ejecución independiente. La inspección de la base real de Local fue exclusivamente `READ ONLY` y no invocó las funciones que escriben.

## 2. Por qué cierra F9-03b

V2 cerraba una operación al leer el valor anterior, aunque su UPDATE todavía pudiera confirmar. V2.1 conserva la intención y usa dos funciones del servidor:

- `migracion_medios_cambiar`: compara valor anterior y plazo dentro del UPDATE.
- `migracion_medios_barrera`: antes del plazo responde `esperar`; después reescribe la fila con su mismo valor y devuelve el valor efectivamente visible tras obtener el bloqueo.

Para un cambio que ya escribió y mantiene el bloqueo, la barrera espera su resultado. Para un UPDATE esperando una versión anterior, la reescritura genera una versión nueva y permite reevaluar el WHERE. Este razonamiento concuerda con el comportamiento de `UPDATE` bajo Read Committed descrito en la [documentación de PostgreSQL 17](https://www.postgresql.org/docs/17/transaction-iso.html). La sesión de inspección de Local tenía `read committed` y servidor **17.6**.

La repetición del caso original confirmó que una lectura del original ya no cierra la duda por sí sola: se espera el plazo y se requiere la barrera. Una liberación tardía después de cerrar la reversión no aplica porque su plazo venció. También pasaron commit a 1.200 ms, barrera caída, espera insuficiente y operación antigua sin plazo con el original visible: se conserva el id y sale con código 3 cuando falta evidencia.

### Caso independiente adicional

El servidor ficticio representa una escritura ya ejecutada antes del vencimiento, pero cuya confirmación no llega hasta después. La lectura devuelve el original hasta confirmar. La barrera, cuando ya pasó el plazo, espera ese commit en vez de declarar «no aplicada».

Con la CLI original:

- cambio inicial: exit 3 e intención conservada;
- commit: **1.214 ms después del plazo**;
- barrera: espera adicional de **953 ms** en el modelo;
- reversión: 1 operación reconciliada, 1 cambio inverso, `completo:true`, estado `revertida` y original restaurado.

Es un doble de comportamiento, no una medición nueva de Postgres. Complementa la prueba nativa entregada: en ella la barrera esperó **1.310 ms** al commit de la transacción real. Se revisó el código de esa prueba y su informe; ambos distinguen reescritura de un bloqueo `FOR UPDATE` sin reescritura.

El cierre acredita estos casos y la operación serial de la herramienta. No certifica usos no ensayados con varios manifiestos independientes sobre las mismas filas, distintas configuraciones de aislamiento o una infraestructura remota diferente.

## 3. Seguridad y alcance del servidor

Se confirmó en Local mediante catálogo del sistema:

- las tres funciones instaladas tienen cuerpos idénticos a la migración revisada;
- todas son invoker; las dos funciones operativas comprueban `es_admin()`;
- lista cerrada de **5 tablas y 6 combinaciones tabla/columna**;
- identificadores SQL formateados con `%I` y valores parametrizados; no se añadió SQL arbitrario controlado por el cliente;
- RLS activa en `productos`, `producto_fotos`, `servicios`, `servicio_fotos` y `galeria_web`;
- no hay nuevas tablas, columnas, políticas o permisos de tabla en el archivo.

`SECURITY INVOKER` conserva los privilegios del llamador, conforme a [CREATE FUNCTION de PostgreSQL](https://www.postgresql.org/docs/17/sql-createfunction.html). No se sustituyó RLS por un `SECURITY DEFINER` nuevo.

### Observación O1 · Describir las ACL reales

La ACL de Local incluye **`authenticated`, `service_role` y el propietario `postgres`** con EXECUTE en las tres funciones. `anon` y `PUBLIC` no lo tienen. La migración no revoca el permiso de `service_role` heredado de los privilegios por defecto.

Además, `migracion_medios_columna_permitida` es un helper de lista de nombres y no contiene `es_admin()`. Las dos funciones que escriben sí lo comprueban. El helper administrativo existente usa `coalesce(..., false)`, por lo que la ausencia de rol no deja pasar un NULL.

Esto no produjo un hallazgo de ampliación de permisos sobre filas: la lista de columnas no revela datos, las funciones de escritura comprueban administración y aplican privilegios/RLS del invocador. Pero la entrega debe evitar las frases literales «solo authenticated tiene EXECUTE» y «las tres exigen es_admin». Si se pretende excluir también `service_role` por política, preparar su revocación explícita en las funciones nuevas antes de cualquier despliegue remoto; esta revisión no la implementó.

## 4. Observaciones operativas

### O2 · Reloj y duración del plazo

SQL compara con `clock_timestamp()`, que devuelve la hora real incluso dentro de una sentencia, según la [documentación de fecha/hora](https://www.postgresql.org/docs/17/functions-datetime.html). Sin embargo, la CLI construye `vence` con `Date.now()` del cliente y lo manda como fecha absoluta. La prueba nativa calcula su plazo con el reloj del servidor.

No presentar los 30 s nominales como una duración independiente de la hora del equipo operador. Un desfase puede expirar antes el cambio o prolongar la espera. Documentar sincronización y comprobar el caso antes de uso remoto. La lógica observada conserva la duda o rechaza un cambio vencido; no se reprodujo un fallo de seguridad por ese motivo.

### O3 · Límite de espera

`--espera-max-ms` limita la espera programada por `faltan_ms`. No es un timeout duro de cada petición HTTP a la barrera: un RPC bloqueado o una red que no responda puede excederlo. Declararlo así y validar timeouts/recuperación en staging antes de operación remota. Una interrupción debe conservar la intención para la próxima reconciliación.

### O4 · Compatibilidad de reversión

No retirar las funciones mientras haya operaciones pendientes o ejecuciones activas. Las operaciones antiguas sin plazo y sin evidencia de aplicación requieren revisión manual. Volver a V2 reabre F9-03b; el rollback es una capacidad de reversión de este paquete local, no una recomendación de operar con el defecto.

## 5. Datos e integridad

Inspección independiente de Local en `READ ONLY`:

- migración máxima `20261012000003`;
- **441 objetos** de Storage;
- **25.994 filas** de auditoría;
- cero productos `QA-F9`/`QA-F9B`, servicios `QA-F9` o filas de Galería `QA-F9` restantes.

Los conteos concuerdan con el +29 informado (8 del ensayo nativo y 21 de la simulación). No se borró auditoría. La huella de medios preexistentes idéntica pertenece a la evidencia de las simulaciones de Claude; no se extrapola a la igualdad completa de todos los campos de toda la base.

Los hashes actuales/copiados coinciden y el parche inverso pasa su comprobación sin aplicarlo. El SQL de reversión solo elimina las tres funciones y debe ir condicionado a resolver las operaciones pendientes. Codex no aplicó ni revirtió esta migración, no modificó fuentes, no instaló dependencias y no cambió Git, hosting, DNS, Cloudflare o Supabase remoto. HEAD permanece en `6929c619`.

## 6. Continuidad

Claude puede registrar **preparación e implementación local de Fase 9 aprobadas con observaciones**, con F9-03b cerrado y los cinco cierres anteriores conservados. Sin aprobación de inventario real del negocio, migración de objetos/referencias reales o rollback remoto.

Antes de cualquier migración real debe prepararse el despliegue de esta SQL en el ambiente autorizado y probarse allí el protocolo con fixtures y sus permisos normales. Staging y producción necesitan confirmación separada del usuario. La compatibilidad de lectores antiguos, tratamiento de PWA, elección de origen, periodo de reversión, perfiles/QR y comunicación pública siguen como decisiones/puertas del plan. Fase 10 espera indicación del usuario.

## Evidencia de Codex

[evidencia-revision-fase9-v2-1](C:/WedJaiseReact/.codex/evidencia-revision-fase9-v2-1): `unitarios-repetidos.json`, `cli-repetida.json`, `barrera-commit-pendiente.json`, `metadata-local-solo-lectura.json`, `acl-completa-local.json`, `hashes-y-rollback.json`, resumen y fuentes de diagnóstico como `.mjs.txt`. No se archivan cuentas ni archivos de entorno.
