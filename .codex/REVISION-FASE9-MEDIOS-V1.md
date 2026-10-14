# Revisión Fase 9 · Medios y preparación del cambio público · V1

Fecha: 2026-10-12, America/Lima. HEAD `6929c619e88a91434cb16ee6a8d2de90de94c091`, rama `feat/cloudflare-pages`. Entrega: [ENTREGA-FASE9-MEDIOS-Y-CAMBIO-PUBLICO.md](C:/WedJaiseReact/.codex/ENTREGA-FASE9-MEDIOS-Y-CAMBIO-PUBLICO.md).

## Veredicto

**PENDIENTE DE CORRECCIONES. No se aprueba todavía el paquete local de Fase 9.** Se confirmaron seis hallazgos: tres P1 y tres P2. El escenario sano de la simulación entregada no cubre los fallos de destino, respuesta incierta, verificación incompleta y redacción reproducidos aquí.

No se ejecutó la simulación completa ni ninguna migración real. La revisión usó la CLI original contra un servidor HTTP ficticio en memoria y una VM con operaciones de filesystem sustituidas. No se borró nada, no se usó ninguna credencial real para esas pruebas y no se escribió en Supabase. La inspección de Local fue `READ ONLY`.

| ID | Prioridad | Problema |
| --- | --- | --- |
| F9-01 | P1 | El harness elimina recursivamente `--trabajo` sin comprobar que sea una carpeta propia y segura. |
| F9-02 | P1 | Actualizar/revertir no comprueban que el manifiesto pertenezca al backend seleccionado. |
| F9-03 | P1 | Un PATCH confirmado con respuesta incierta no queda en el diario y la reversión lo omite. |
| F9-04 | P2 | `verificar` puede terminar `ok:true` y exit 0 sin comprobar ninguna variante de R2. |
| F9-05 | P2 | Una URL firmada privada en Galería queda con privacidad de catálogo y aparece completa en el informe. |
| F9-06 | P2 | Una única opción de permiso de host no permite usar los tres orígenes remotos del flujo real. |

## F9-01 · Borrado recursivo sin guarda de salida

Archivo: [simular-fase9.mjs:195](C:/WedJaiseReact/scripts/migracion-medios/simular-fase9.mjs:195), con el destino calculado en línea 23.

La primera operación del IIFE es `rmSync(TRABAJO, { recursive: true, force: true })`. El parámetro proviene directamente de `resolve(arg('trabajo'))`; las comprobaciones previas solo verifican cuentas QA y Supabase Local. No protegen el repositorio ni los archivos del usuario.

**Reproducción segura:** se ejecutó el texto del harness en una VM, sustituyendo `rmSync` por un doble que registra la petición y lanza antes de borrar. Docker y la lectura de las cuentas/entorno también fueron dobles; ninguna operación destructiva llegó al sistema real. Las entradas `--trabajo=.`, `--trabajo=C:/WedJaiseReact/.codex` y `--trabajo=C:/WedJaiseReact/src` solicitaron, respectivamente, eliminar el repositorio entero, todos los informes y el código fuente. En los tres casos la opción fue `recursive:true, force:true`.

**Corregir:** validar la ruta resuelta y su identidad en Windows antes de cualquier borrado, creación de carpeta o conexión. Rechazar raíces, ancestros, repositorio y carpetas protegidas, también con otra capitalización o aliases. Preferir una carpeta nueva de QA y, para reutilizarla, exigir marca de propiedad y borrar exclusivamente sus artefactos conocidos. Ya existe un precedente de guarda en `scripts/lib/salida-segura.mjs`; adaptar sus principios a este harness.

**Regresión requerida:** raíz/ancestro, `.codex`, `src`, ruta existente ajena y capitalización distinta deben fallar con cero llamadas de borrado. Un directorio propio de QA sí debe funcionar. No basta una prueba estática que excluya `DELETE` en las dos bibliotecas de migración: esta operación está en el harness.

## F9-02 · El manifiesto no está vinculado al backend que se escribe

Archivo: [medios-migracion.mjs:347](C:/WedJaiseReact/scripts/migracion-medios/medios-migracion.mjs:347). Afecta `actualizar`, `revertir` y, por consistencia del paquete, la copia/verificación. La comprobación `m.ambiente !== inv.supabase` existe en `planificar`, pero no se repite al consumir el manifiesto para escribir referencias.

**Reproducción con la CLI original:** se entregó un manifiesto válido con `ambiente = 127.0.0.1:1`, mientras el archivo de entorno apuntaba a otro puerto de un servidor ficticio. Ese servidor representaba otra base con el mismo id y valor anterior. `actualizar --aplicar` hizo login, envió un PATCH, cambió la foto y terminó con exit 0 y `hechas:1`.

No se afirmó que esto haya ocurrido en otra base real. La reproducción demuestra que el binding de ambiente se ignora. IDs y rutas pueden coincidir entre réplica, staging y negocio, por lo que el UPDATE condicional no sustituye esa comprobación.

**Corregir:** comprobar antes de autenticar o escribir que el origen/proyecto y las bases del manifiesto corresponden al entorno seleccionado. Fijar una identidad canónica que incluya lo necesario para distinguir bases con prefijos o proxies; no depender solo de un host ambiguo. Mantener la autorización adicional de producción. Aplicar el mismo criterio a reanudación, copia, actualización, reversión y verificación.

**Regresión requerida:** manifiesto de A + entorno B debe abortar antes del login/PUT/PATCH; cubrir los comandos de escritura y el caso de IDs/valores iguales. Un manifiesto del mismo entorno debe conservar el flujo sano.

## F9-03 · PATCH confirmado pero respuesta incierta: rollback incompleto

Archivo: [medios-migracion.mjs:339](C:/WedJaiseReact/scripts/migracion-medios/medios-migracion.mjs:339), selección de referencias en línea 358 y persistencia del diario después del PATCH en línea 371.

`cambiarCondicional` lanza si PostgREST devuelve error; solo reconcilia cuando la respuesta fue exitosa y no afectó filas. El estado del manifiesto se cambia después de recibir el resultado. `revertir` selecciona únicamente referencias `actualizada`.

**Secuencia reproducida en memoria por la CLI original:**

1. La referencia empieza `pendiente`, con el valor original.
2. El servidor ficticio aplica el PATCH y guarda la referencia nueva, pero responde 503 como resultado incierto del cliente.
3. `actualizar` termina con exit 2; la referencia del manifiesto sigue `pendiente` aunque la fila ya está migrada.
4. `revertir --aplicar` informa `candidatas:0`, `hechas:0`, exit 0. La fila conserva el valor migrado.

**Control positivo:** si la respuesta del PATCH llega normalmente, actualizar y revertir terminan con exit 0, la fila vuelve al original y el diario queda `revertida`.

Una interrupción entre el commit y el `rename` del manifiesto tiene la misma ventana. Guardar después de cada fila y hacer el rename atómico evita un JSON truncado, pero no hace atómica la operación base+archivo. La afirmación del diseño «el diario nunca queda por detrás de la base» debe corregirse.

**Corregir:** persistir intención/identidad de la operación antes del PATCH, distinguir resultado rechazado de incierto, reconciliar con una lectura estricta y conservar explícitamente la duda si esa lectura falla. La reanudación y la reversión deben considerar también operaciones posiblemente confirmadas, sin pisar una edición ajena ni dar éxito a una reversión que omitió trabajo incierto. No hay que borrar originales o copias para resolverlo.

**Regresión requerida:** commit + respuesta perdida/503, lectura de reconciliación caída, interrupción tras commit antes de persistir y posterior reversión; variantes sin commit y con edición ajena. Debe conservarse el id y el diario recuperable, o informar pendientes y resultado incompleto; nunca una reversión exitosa con la fila todavía migrada por esa operación.

## F9-04 · Verificación exitosa sin verificar R2

Archivo: [medios-migracion.mjs:393](C:/WedJaiseReact/scripts/migracion-medios/medios-migracion.mjs:393), con `verificar` requiriendo solo `manifiesto` en línea 422.

Las lecturas de R2 están condicionadas a `opciones.lectura`. No proporcionar esa opción omite ambas variantes sin añadir un problema o declarar verificación parcial.

**Reproducción:** manifiesto con una entrada `verificada` y referencia `actualizada`; original intacto y fila con el valor nuevo. Los objetos R2 del servidor ficticio no existen. Sin `--lectura`, la CLI responde `ok:true`, exit 0, `r2Comprobados:0`, `problemas:[]`. Con `--lectura` al mismo servidor, comprueba m y g, recibe dos 404 y responde `ok:false`, exit 1.

**Corregir:** exigir una base de lectura aprobada cuando haya copias que deban verificarse, y reconciliar el número esperado de variantes con las realmente verificadas. Si se quiere ofrecer una inspección parcial, separarla claramente de la verificación completa y no emitir `ok:true` como equivalencia base+R2+originales. Validar también el destino de lectura antes de usarlo.

**Regresión requerida:** omitir lectura con referencias migradas falla cerrado antes de una falsa aprobación; m/g ausentes, una sola variante ilegible y cobertura incompleta nunca cuentan como reconciliación completa. El caso de manifiesto vacío debe tratarse explícitamente, sin inventar objetos esperados.

## F9-05 · URL firmada privada filtrada al informe

Archivo: [lib.mjs:113](C:/WedJaiseReact/scripts/migracion-medios/lib.mjs:113), privacidad/redacción en [medios-migracion.mjs:156](C:/WedJaiseReact/scripts/migracion-medios/medios-migracion.mjs:156) y selección de referencias en línea 191.

Para URLs `sign` o `authenticated`, y para URLs de otro proyecto, la clasificación devuelve el bucket declarado por la columna. En Galería ese bucket es `fotos-galeria`, aunque la URL realmente apunte a `comprobantes-pedidos-web`. La privacidad resultante es de catálogo y el informe conserva `valor`.

**Reproducción sin descargar nada:** un JSON ficticio de inventario contiene en `galeria_web.antes_url` una URL `/storage/v1/object/sign/comprobantes-pedidos-web/qa/foto.png?token=<ficticio>`. Se probaron el origen propio y un origen ajeno. En ambos casos `inventariar --desde-json` termina con exit 0, marca `supabase-url-ajena`, privacidad `publico-catalogo`, `migrar:false` y conserva la URL completa con su token en `referencias`.

No se detectó ni expuso un token real. El problema confirmado es que la redacción no cubre esa variante, aunque sí cubra rutas privadas normales y el formato `public` del origen propio probado por Claude.

**Corregir:** analizar el tipo de endpoint y bucket real de la URL antes de aplicar la privacidad de la columna; las URLs firmadas/autenticadas y los buckets privados deben redactarse también en referencias mal ubicadas o de otro proyecto. Nunca propagar credenciales query a informes, eventos o manifiestos. Mantener la exclusión de migración y los conteos, sin descargar contenido privado.

**Regresión requerida:** origen propio/ajeno × `sign`/`authenticated`/`public` hacia bucket privado, tanto en columnas privadas como en Galería; la salida completa no debe contener rutas sensibles ni tokens. URLs públicas normales de catálogo deben seguir clasificándose correctamente.

## F9-06 · El permiso remoto único no permite el flujo previsto

Archivo: [lib.mjs:155](C:/WedJaiseReact/scripts/migracion-medios/lib.mjs:155), llamadas de `copiar` en [medios-migracion.mjs:255](C:/WedJaiseReact/scripts/migracion-medios/medios-migracion.mjs:255).

`copiar --aplicar` exige que Worker, base pública de lectura y Supabase tengan cada uno `u.host === opciones['permitir-remoto']`. Es una sola cadena. La arquitectura prevista tiene tres hosts diferentes (Worker, Pages y Supabase). No existe una combinación válida para habilitar los tres.

**Reproducción pura:** con tres hosts ficticios distintos, cada uno de los tres valores posibles de la opción permite un host y rechaza los otros dos. Repetir `--permitir-remoto` no crea una lista: el parser conserva el último valor. El ensayo Local no lo detecta porque loopback se permite sin esa opción.

**Corregir:** autorizaciones exactas por función, o una lista cerrada validada de destinos aprobados, que conserve la distinción Supabase/Worker/lectura. No solucionar esto omitiendo guardas, con comodines o permitiendo cualquier remoto. Mantener el permiso específico adicional para producción.

**Regresión requerida:** configurar tres hosts diferentes aprobados permite llegar al cableado ficticio correcto; un host no autorizado, intercambio de roles y producción sin su autorización adicional deben fallar antes del login o escritura. Esta prueba puede hacerse sin conectar ningún remoto real.

## Comprobaciones favorables y alcance

- Se repitieron las **12/12** pruebas unitarias existentes. Su resultado no contradice estos hallazgos: son otros escenarios y la garantía estática de borrados no revisa el harness.
- La CLI de copia usa el Worker existente, valida contenido al generar variantes y compara SHA-256 al leerlas. No se añadió una operación de borrado de objetos o filas a la herramienta de migración. No se confundió el ETag multipart con un checksum de contenido.
- El UPDATE condicional protege la columna de referencia contra un valor distinto y el control sano de reversión funciona. Esto no protege todos los campos de una fila ni resuelve un resultado incierto por sí solo.
- Se auditó el informe de simulación entregado **18/18**, sus corridas previas y las comprobaciones de lectura mixta. No se ejecutó de nuevo: contiene escrituras SQL y limpieza de fixtures, fuera del rol de Codex. Tampoco sería seguro ejecutarlo con la ruta sin corregir F9-01.
- Se corroboró Local mediante `inventario.sql` y otra transacción **READ ONLY**, guardando solo conteos y hashes: **577 referencias, 441 objetos, auditoría 25.944, cero productos/servicios/filas de galería `QA-F9`**. La última corrida entregada empieza en auditoría 25.923 y termina en 25.944 (+21); el aumento acumulado de 84 frente a 25.860 concuerda con los cuatro ensayos informados. No se borró esa auditoría.
- La Fase 8 mantiene su cierre local: O1 documenta la limitación y la salida segura. La Fase 9 no altera ese veredicto.

## Observaciones sobre el plan público

### O1 · Compatibilidad de `main`: conservar la puerta

Se revisó `main` mediante Git, sin modificarlo. Mantiene pantallas con `React.lazy`, el límite de error global y carece de la lectura R2 de la rama actual. Se acepta separar **copiar** objetos de **cambiar referencias** y bloquear lo segundo hasta publicar lectores compatibles. La observación por un plazo no demuestra que todas las PWA antiguas hayan actualizado: incluir en 10A/10B el tratamiento de clientes instalados y la estrategia de compatibilidad durante la transición.

### O2 · Retirada del SW: no basta evitar una navegación forzada

`PLAN-CAMBIO-PUBLICO-FASE9.md:43` propone activación inmediata, borrar cachés y desregistrar, y deduce que una venta no se pierde porque no se fuerza la navegación. Esa garantía todavía no se ha probado. `main` sigue teniendo imports diferidos que dependen del código antiguo; si se retiran sus archivos y cachés, abrir una pantalla fría puede alcanzar el límite global. El cierre de F8 local no modifica las PWA antiguas.

Antes de ejecutar esa retirada, diseñar una transición que mantenga disponibles los recursos necesarios de clientes abiertos y ensayar específicamente: venta pendiente en una PWA antigua, retiro del SW/cachés, apertura de pantalla y ventana no visitadas, continuidad y recarga segura. No presentar «sin navegación forzada» como prueba suficiente. `unregister()` finaliza el registro pero no constituye una garantía de conservación del estado de React. [Referencia de MDN](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/unregister).

### O3 · Dominio y Auth

El dominio propio sigue opcional y futuro según el usuario; no convertir su compra en un requisito de esta preparación. El plan puede mantener `pages.dev` como alternativa y documentar el cambio de origen posterior. Para un dominio propio futuro, el requisito de zona para apex y el CNAME para subdominio concuerdan con la [documentación de Pages](https://developers.cloudflare.com/pages/configuration/custom-domains/).

Site URL y Redirect URLs deben revisarse con el flujo real de confirmación antes de publicar. La Site URL es el destino por defecto si el código no proporciona `redirectTo`, conforme a la [documentación de Supabase](https://supabase.com/docs/guides/auth/redirect-urls). Esta revisión no cambió ninguna configuración de Auth.

## Qué debe entregar Claude para V2

Corregir F9-01 a F9-06 en local y convertir cada reproducción en regresión. Mantener la prueba sana, las salvaguardas de privacidad, originales intactos y control de ediciones ajenas. Sin commit/push, migración remota, nuevos recursos ni cambios de hosting. Corregir la afirmación de atomicidad del diario y registrar las reservas del plan público. Entregar resultados, alcance y limitaciones, y detenerse para nueva revisión.

Inventario de producción, rollback en staging, periodo de retención y ejecución pública siguen fuera de esta autorización. Estos diagnósticos no autorizan esas operaciones ni la Fase 10.

## Evidencia de Codex

[evidencia-revision-fase9-v1](C:/WedJaiseReact/.codex/evidencia-revision-fase9-v1):

- `unitarios-repetidos.json`: 12/12.
- `diagnosticos-cli-y-guardas.json`: CLI original con backend ficticio, control sano, redacción, permisos y VM sin borrados reales.
- `inspeccion-local-solo-lectura.json`: conteos y hash de referencias, sin valores privados.
- `hashes-paquete.json`: hashes del paquete revisado.
- Fuentes de diagnósticos como `.mjs.txt`; ningún archivo de entorno ni credencial real se archiva.

Se trabajó exclusivamente como auditor. No se corrigió código, no se ejecutaron migraciones, no se alteró Git ni se tocó Cloudflare/GitHub/Supabase remotos. Los servidores ficticios terminaron al acabar el diagnóstico. HEAD permanece en `6929c619`.
