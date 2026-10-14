# Revisión de Fase 10A · regresión integrada · V1

Fecha: 2026-10-13, America/Lima. Revisor: Codex, QA y auditor. HEAD observado: `6929c619e88a91434cb16ee6a8d2de90de94c091`, rama `feat/cloudflare-pages`, con las Fases 4–10A en el árbol local.

**Veredicto: pendiente de correcciones.** Acepto en sus alcances locales las dos reglas CSS y la matriz de navegación por roles. No cierro la Fase 10A: encontré cuatro defectos de las herramientas nuevas y una insuficiencia importante del plan de convivencia de deudas. No hay validación de staging ni producción en esta revisión.

| ID | Prioridad | Resultado |
| --- | --- | --- |
| F10A-01 | P1 | Las guardas comprueban que existe Local, pero no que el frontend de login use Local. |
| F10A-02 | P2 | El evaluador sale con código 0 incluso cuando el medidor falla y no existen mediciones. |
| F10A-03 | P2 | El servidor estático permite leer un archivo fuera de su raíz mediante un prefijo compartido. |
| F10A-04 | P2 | Redondear CLS antes del presupuesto convierte incumplimientos en aprobados. |
| F10A-05 | P1, transición remota | El contrato de deudas heredadas puede reabrir una deuda pagada; no se limita a perder su fecha. |

## 1. Alcance y evidencia independiente

Leí la entrega, los pendientes, el plan de staging, los seis archivos de `scripts/fase10a/`, las modificaciones de QA/CSS y el rollback. También revisé el flujo de deudas de `main`, el frontend nuevo y la migración de pagos. Supabase se verificó como `http://127.0.0.1:54321`, contenedores `supabase_kong_WedJaiseReact` y `supabase_db_WedJaiseReact`.

Las comprobaciones independientes fueron:

- **Roles: 13/13 grupos, 230 visitas directas (5 perfiles × 46 rutas)**, más menú y cierre de sesión del POS. Repetí el verificador desde una copia externa con preflight del artefacto local, validación de cuentas QA, WebSockets cerrados y guardas de red antes de autenticar. La corrida válida es `roles-v2/roles-repetidos.json`, código 0 y sin solicitudes bloqueadas por su guarda de escrituras. Prueba navegación y montaje; no prueba por sí sola todos los datos, operaciones o permisos SQL de cada pantalla.
- **Guardas del login:** dos cuentas completamente inventadas enviaron sus campos a otro backend ficticio de loopback. No se usó ninguna contraseña QA real en ese negativo.
- **Evaluador:** reproducción con carpeta sin mediciones y reproducción del CLI completo con un medidor que falla por un archivo de cuentas inexistente. Ambos terminan con código 0 y «0/0 presupuestos cumplidos».
- **Servidor:** una solicitud con traversal codificado devolvió 200 y una marca ficticia de una carpeta vecina. El control de `/ventas` conservó su fallback propio.
- **Rendimiento:** recalculé CLS desde las muestras originales y volví a evaluar copias externas de los cinco JSON; son **18/219 presupuestos incumplidos**, no 16/219. No repetí las mediciones de laboratorio.
- **Integridad:** los **18 SHA-256** del manifiesto de rollback coinciden. La migración de medios difiere de su copia anterior solo en comentarios. `PestanasCacheadas.jsx` coincide con la copia previa; el experimento de scroll está revertido.
- **Deudas:** ejecuté la UI compilada con una fila ficticia y respuestas de PATCH/RPC simuladas en memoria. La fila pasa de COBRADA a PENDIENTE al guardar una nota, con el monto sin cambiar. Las escrituras de deuda nunca llegan a Supabase real. Inspección SQL real de solo lectura: Local tenía 59 deudas, ninguna COBRADA sin pago, y ningún trigger de compatibilidad en `deudas`.
- **Visual:** inspeccioné las capturas antes/después del cupón a 1200 ms; se conserva su aspecto. La evidencia de comparación de los cinco momentos se corresponde con el cambio de `left` a `transform`.

Evidencia nueva: [evidencia-revision-fase10a-v1](C:/WedJaiseReact/.codex/evidencia-revision-fase10a-v1).

### Efectos de esta QA

No modifiqué código, configuración, dependencias, migraciones ni Git. No ejecuté SQL mutante, migraciones, los seeders de las baterías completas ni operaciones remotas. Solo se guardan este informe y evidencia nueva de QA.

Para las dos corridas de roles se provisionó y eliminó un ASISTENTE ficticio por corrida, dentro de la excepción explícita de `AGENTS.md` para Auth y perfiles QA Local. Las relecturas confirman 6 cuentas QA antes y después, cero asistentes temporales restantes y 59 deudas antes y después. Esas altas/bajas dejaron **4 filas de auditoría Local** (26019 → 26023), conservadas. No afirmo igualdad de toda la base: los logins también actualizan metadatos normales de Auth.

La primera repetición externa de roles restringió por error algunas RPC de lectura; queda conservada como diagnóstica. Tras leer sus definiciones SQL y corregir únicamente la guarda de la copia externa, se repitió completa en `roles-v2/`, sin esos bloqueos. Ninguna de las dos cambió el código del proyecto.

## 2. Hallazgos que debe atender Claude

### F10A-01 · P1 · Verificar Docker Local no valida el frontend que recibe las credenciales

Fuentes: [medir-vitales-10a.cjs:111](C:/WedJaiseReact/scripts/fase10a/medir-vitales-10a.cjs:111), [verificar-roles-rutas.cjs:85](C:/WedJaiseReact/scripts/fase10a/verificar-roles-rutas.cjs:85), [verificar-roles-rutas.cjs:120](C:/WedJaiseReact/scripts/fase10a/verificar-roles-rutas.cjs:120).

El medidor acepta un `--app` arbitrario, verifica el puerto de Docker y hace los dos logins en `c0` sin instalar la guarda de `prepararPagina`. Esta última solo se usa después, en los contextos de medición. El verificador de roles valida el API del CLI local, pero acepta cualquier origen de APP y permite todas sus solicitudes; no confirma el API efectivo del bundle antes del login ni de provisionar su asistente.

**Reproducción:** se mantuvieron literalmente las comprobaciones iniciales y `sesionDe` del medidor en una copia diagnóstica; solo se resolvió Playwright desde la ruta del repo y se terminó tras los dos logins. Un frontend ficticio local envió dos POST con los campos inventados a un segundo servidor, distinto de `127.0.0.1:54321`. El arranque terminó con código 0. Prueba que la presencia de Docker no acota el destinatario de las credenciales; no es evidencia de una filtración real en las corridas de Claude.

**Corrección recomendada:** antes de autenticar o provisionar, validar el origen aprobado de APP, el backend efectivo exacto del artefacto y las identidades QA. Instalar las guardas también en el contexto de login, cubrir redirecciones y WebSockets, y rechazar un proxy de mismo origen cuyo destino no esté verificado. El futuro modo staging debe tener aprobación y host exactos propios, no relajar la guarda de Local.

**Regresiones:** app remota; app local con backend ajeno; redirect; proxy a otro backend; cuenta ajena al conjunto QA. En todos, cero credenciales enviadas y cero provisiones. Control positivo con Local exacto.

Evidencia: `diagnosticos-herramientas.json`, caso `login-a-backend-no-aprobado`; copia diagnóstica archivada como texto.

### F10A-02 · P2 · Una medición fallida se convierte en éxito del comando principal

Fuente: [medir-rendimiento-10a.mjs:48](C:/WedJaiseReact/scripts/fase10a/medir-rendimiento-10a.mjs:48) y [línea 108](C:/WedJaiseReact/scripts/fase10a/medir-rendimiento-10a.mjs:108).

El estado de los procesos solo se imprime. `evaluar()` omite archivos ausentes y el código final depende exclusivamente de las filas numéricas obtenidas. Sin filas no hay fallos y el comando devuelve 0. Tampoco distingue de forma fiable una salida anterior de la salida de la ejecución que acaba de fallar.

**Dos reproducciones con el CLI original, sin red ni credenciales:**

1. `--evaluar --salida=<carpeta QA vacía>`: 0 mediciones, 0 fallos, exit 0.
2. `--solo=vitales --cuentas=<archivo QA inexistente> --salida=<carpeta QA nueva>`: imprime «FALLÓ vitales», luego «0/0 presupuestos cumplidos», exit 0.

**Corrección recomendada:** conservar y propagar el estado de cada productor; exigir archivos, muestras, escenarios y tipos válidos para el alcance solicitado; marcar una evaluación parcial como parcial. Vincular resultados a ejecución y artefacto, y no reutilizar salidas viejas sin verificar esa identidad. Un productor fallido o una evaluación incompleta debe terminar con código no cero aunque los datos anteriores cumplieran.

**Regresiones:** vacío, archivo faltante, productor no cero, muestras vacías, escenario omitido, resultados antiguos y ejecución completa sana. `--solo` válido puede evaluar un alcance menor, pero no presentarlo como el cierre global.

Evidencia: `evaluador-vacio/`, `evaluador-medidor-fallido/` y `evaluador-medidor-fallido-resumen.json`.

### F10A-03 · P2 · El servidor permite escapar de su carpeta mediante un prefijo vecino

Fuente: [servir-como-pages.cjs:48](C:/WedJaiseReact/scripts/fase10a/servir-como-pages.cjs:48).

`f.startsWith(raiz)` comprueba texto, no pertenencia a un directorio. La decodificación después de construir la URL admite un `..%2f` que `path.join` normaliza hacia fuera. Una carpeta llamada `servidor-fixture-ajeno` comparte el prefijo de `servidor-fixture`, por lo que pasa la comprobación.

**Reproducción con archivos inventados:** raíz `servidor-fixture`; carpeta vecina `servidor-fixture-ajeno/marca.txt`. GET `/..%2fservidor-fixture-ajeno%2fmarca.txt` devuelve 200 y el contenido de la marca vecina. No leí archivos privados ni del proyecto mediante esa vía. El servidor solo escucha loopback; el defecto está en esta herramienta local, no en Cloudflare Pages.

**Corrección recomendada:** validar la pertenencia del destino resuelto por componentes de ruta y por ruta real cuando haya enlaces/junctions. Rechazar traversal, codificación malformada y escapes por enlace, con respuesta controlada. Conservar el fallback de SPA para rutas legítimas que no correspondan a un archivo.

**Regresiones:** carpeta vecina con prefijo común, traversal codificado, junction hacia fuera, URI malformada y controles de assets, HEAD y `/ventas`.

Evidencia: `diagnosticos-herramientas.json`, casos `servidor-escape-prefijo` y `control-fallback-propio`.

### F10A-04 · P2 · CLS se redondea antes de decidir si cumple

Fuente: [medir-vitales-10a.cjs:70](C:/WedJaiseReact/scripts/fase10a/medir-vitales-10a.cjs:70) y [línea 134](C:/WedJaiseReact/scripts/fase10a/medir-vitales-10a.cjs:134).

`r1` redondea todas las métricas a un decimal y `resumen` lo aplica también a CLS. Un CLS entre 0,1 y aproximadamente 0,15 se convierte en 0,1 y pasa el presupuesto `<= 0.1`.

**Impacto en la evidencia entregada:** Inicio visitante, frío y caliente, tiene mediana cruda **0.10043430171997483**. El resumen contiene 0.1 y ambos presupuestos figuran aprobados. Al conservar el CLS exacto y volver a ejecutar el evaluador original sobre copias, los incumplimientos pasan de **16 a 18**, con el mismo total de 219. La diferencia de este caso concreto es pequeña y no demuestra una degradación perceptible; el defecto de clasificación sí afecta valores más alejados, como 0.14.

**Corrección recomendada:** comparar con valores sin redondear y reservar el formato visual para la tabla. Conservar muestras y precisión suficientes; si se admite margen de laboratorio, declararlo explícitamente en el presupuesto y justificarlo, sin introducirlo mediante redondeo.

**Regresiones:** 0.1, 0.10001, 0.14, 0.149, 0.15 y valores ausentes; clasificación exacta antes de presentación.

Evidencia: `auditoria-evidencia.json`, `clsFalsamenteAprobados`; `evaluador-cls-corregido/`. No se sobrescribieron los JSON originales.

### F10A-05 · P1 para la transición · Las deudas heredadas pueden volver a cobrarse

Fuentes: [plan de staging:27](C:/WedJaiseReact/.codex/PLAN-VALIDACION-STAGING-FASE10.md:27), [ModalDeuda.jsx:168](C:/WedJaiseReact/src/components/ModalDeuda.jsx:168), `main:src/pages/Deudas.jsx::alternarCobrada` y [migración de pagos](C:/WedJaiseReact/supabase/migrations/20261010000001_deuda_pagos.sql).

El plan identifica un riesgo real, pero lo describe como «cobrada sin fecha». El contrato de convivencia es más amplio:

1. Después de aplicar la migración, `main` puede marcar COBRADA una deuda sin insertar `deuda_pagos`.
2. La nueva UI la muestra COBRADA, sin pago.
3. Guardar **solo una nota**, sin modificar el monto, llama a `recalcular_estado_deuda`: suma cero y la deja PENDIENTE por el importe completo. Vuelven los botones de cobro.
4. La operación inversa también importa: una deuda cuyo pago creó el backfill puede ser marcada PENDIENTE desde `main`, sin anular ese pago. La nueva UI recibe PENDIENTE con saldo cero y muestra «Pago parcial» y botones de cobro.

Los puntos 2–3 se reprodujeron en la UI compilada con backend simulado. El punto 4 se comprobó alimentando el resultado que produciría el PATCH heredado; no ejecuté `main` ni SQL mutante. La definición de la RPC y la ausencia de un trigger de compatibilidad se inspeccionaron en Local real. **No hay deudas dañadas en Local ni evidencia de daño remoto.** Es un riesgo del plan previo a cualquier convivencia de versiones.

**Corrección recomendada:** ampliar el contrato antes de aprobar su ejecución remota. Definir cómo se impiden o compatibilizan los cobros, reaperturas y ediciones del frontend antiguo, incluidas PWA antiguas; no confiar únicamente en «se publicó el frontend nuevo» o en rellenar al final. Ensayar ambos sentidos y pagos parciales. Si se elige una pausa operativa, debe abarcar las operaciones afectadas, tener condición verificable de cierre y reconciliación, y contar con la decisión del usuario. Claude debe proponer el mecanismo; esta revisión no autoriza migraciones ni ajustes remotos.

**Precisión documental:** volver a ejecutar el archivo SQL completo no duplicaría pagos: `CREATE TABLE` sin `IF NOT EXISTS` falla antes del INSERT y la transacción se revierte. Ejecutar **otra vez el bloque de backfill aislado** sí duplica pagos. El plan debe distinguir ambos casos.

Evidencia: `deudas-transicion-simulada.json` y sus dos capturas. Este hallazgo condiciona el plan remoto y 10B; no exige que Codex modifique el modelo ni haga escrituras reales para cerrar esta revisión.

## 3. Qué queda aceptado y qué sigue pendiente

- Las **dos reglas CSS** corresponden al alcance declarado; no encontré un bloqueo en ellas. La excepción de lint se aplica a `tests/e2e/**/*.mjs`, no exclusivamente a `fixtures.mjs`; describir su alcance literal y mantener las reglas del producto activas.
- La matriz de **46 rutas**, menú y salida queda corroborada en Local, con los límites descritos. No implica una nueva ejecución de la matriz SQL de 664 comparaciones, cobros, ventas, anulación, escáner ni la suite de 214 casos.
- La entrega documenta correctamente que el cierre funcional combina corridas: `bateria-cierre` es **19/20**; después F5 y F6 pasan **32/32 y 21/21**. No lo presentaría como una única ejecución global 20/20. No repetí todas las suites con seeders o SQL mutante.
- Los **18/219 incumplimientos** de laboratorio necesitan corrección o una excepción concreta revisada. El presupuesto del propio paquete dice que bloquean 10A salvo justificación. Que las metas de campo se midan después no convierte estas pruebas locales en aprobadas. No atribuí el TBT de Ventas a la precarga: esa causalidad sigue sin traza.
- Con `--muestras=4`, la función actual de mediana escoge el segundo valor de cuatro, no la media de los dos centrales. El cierre usa tres muestras y no está afectado; corregir la función o validar el número permitido antes de ampliar las mediciones.
- Las intermitencias F4/F5 permanecen abiertas. No se demostró su causa ni se resolvieron por el hecho de pasar la última corrida.
- El plan dice **47 rutas** en §4; el conjunto final y la prueba son **46**. También registra como pendiente una fila residual de staging cuyo borrado y relectura ya se documentaron antes: sincronizar el historial y hacer un inventario de solo lectura si se necesita afirmar el estado remoto actual.
- La prueba RLS de staging debe comparar una fotografía **del propio staging antes y después**, con sus cuentas y datos aprobados. La réplica Local no es una referencia de igualdad de ids/filas para una base distinta; puede servir como referencia de lógica y metadatos.
- Si se ejecuta la suite protegida de `testing`, tiene que validar el **candidato nuevo exacto**. Cambiar a una rama antigua por sí solo no valida este árbol. Mantener las guardas y preparar el artefacto/worktree autorizado; no debilitar la protección para obtener un resultado verde.

No instalé Lighthouse ni requerí contraseñas nuevas. Continúan pendientes el alcance remoto, navegadores/móvil, pagos/correos, accesos alternativos a R2, CPU/cuota, recuperación operativa y las decisiones del cambio público. El dominio propio puede seguir siendo futuro; no es requisito de esta QA local.

## 4. Entrega siguiente

Claude debe corregir F10A-01 a F10A-04 en las herramientas, añadir sus regresiones y ampliar el plan de F10A-05. Conservar esta evidencia y los originales, presentar V2 y mantener el trabajo local hasta la indicación del usuario. Los ajustes de cifras existentes pueden reevaluarse sin repetir todo el laboratorio; los cambios de guardas y servidor requieren sus negativos y controles positivos. Las autorizaciones de commit, push, migraciones remotas y 10B pertenecen al usuario.
