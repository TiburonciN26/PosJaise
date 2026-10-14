# Entrega Fase 9 V2 · Correcciones de la revisión de Codex (F9-01…F9-06)

> **Revisada por Codex** (`REVISION-FASE9-MEDIOS-V2.md`): F9-01, F9-02, F9-04, F9-05 y F9-06 cerrados; F9-03 pendiente por la variante F9-03b, corregida en [ENTREGA-FASE9-CORRECCIONES-V2.1.md](ENTREGA-FASE9-CORRECCIONES-V2.1.md). El límite de §6 sobre «repetir el UPDATE condicional» era el defecto y ya no vale.

Fecha: **2026-10-12**, America/Lima. Rama `feat/cloudflare-pages`, HEAD `6929c619`, árbol local sin commit. Responde a [REVISION-FASE9-MEDIOS-V1.md](REVISION-FASE9-MEDIOS-V1.md). Misma autorización que la Fase 9: solo Local, **sin commit, sin push, sin migrar datos reales, sin recursos remotos, sin cambiar hosting ni retirar GitHub Pages**. Nada de eso se hizo. La Fase 10 no se inició.

## 1. Hallazgos y corrección

| ID | Corrección | Archivo principal | Regresión |
| --- | --- | --- | --- |
| F9-01 P1 | El harness valida `--trabajo` **antes de cualquier efecto**: solo `sim-f9` o `sim-f9-<sufijo>` dentro del temporal del sistema, con identidad real (mayúsculas, nombres 8.3, enlaces y junctions resueltos por `realpath` nativo). Rechaza raíz, ancestros, el proyecto y todo lo que está dentro de él, el temporal mismo, carpetas ajenas sin marca de propiedad, enlaces y archivos. Ya no borra la carpeta: solo vacía su hijo conocido `corrida/`. `RAIZ` sale del propio script, no del directorio actual. | `trabajo-seguro.mjs` (nuevo), `simular-fase9.mjs` | Unitarias con `fs` ficticio (15 rutas, cero borrados), garantía estática del orden y **harness real** ejecutado con una trampa que bloquea borrar, crear, escribir, procesos y red: raíz, proyecto, `.codex`, `src`, otra capitalización, carpeta ajena real en `%TEMP%` y **junction real** de `%TEMP%` hacia `src` terminan con código 2 y cero efectos; la carpeta propia pasa la guarda |
| F9-02 P1 | Manifiesto **versión 2**: `ambiente` = identidad canónica del Supabase (esquema, host, puerto y ruta, para distinguir proxies con prefijo). La primera copia fija `api` (Worker) y `lectura`, y la lectura debe ser la `publica` de la galería. Cada `origen.url` debe ser de **ese** Supabase (esto cierra también una vía que vi al corregir: `verificar` descargaba la URL que trajera el archivo). `copiar`, `actualizar`, `revertir` y `verificar` lo comprueban **antes de autenticar**; los manifiestos V1 se rechazan. | `lib.mjs` (`normalizarBase`, `rechazoDeVinculo`), CLI | CLI real: manifiesto de A con entorno B y **mismo id y valor** → los cuatro comandos terminan con código 2 y **cero pedidos** al backend B (ni login, ni PUT, ni PATCH); manifiesto V1, origen ajeno y Worker distinto, también. Control sano del mismo entorno: actualizar → verificar → revertir con código 0 |
| F9-03 P1 | **Diario con intención previa.** Antes de cada UPDATE se guarda la `operacion` (id, modo, de, a, `en-curso`); después, el resultado. Se distingue el rechazo **definitivo** (4xx de PostgREST, o 0 filas por RLS) del resultado **incierto** (red, 5xx, 408 o 429), y siempre se reconcilia con una lectura estricta. Si la duda persiste, la operación queda `incierta` con el mismo id, el lote se detiene y el comando sale con **código 3** y `completo: false`. Toda ejecución reconcilia primero las operaciones abiertas, solo leyendo; con alguna en duda no envía UPDATE nuevos. La reversión recoge lo que una actualización incierta pudo confirmar. Se corrigió en el diseño la afirmación «el diario nunca queda por detrás de la base». | CLI (`cambiarCondicional`, `reconciliar`, `cerrarOperacion`), `lib.mjs` | CLI real contra PostgREST ficticio: commit + 503; commit + 503 con la lectura caída, donde revertir sale con 3 sin dar éxito y, con el backend sano, reconcilia y restaura; interrupción entre el commit y el guardado (actualizar y revertir); 503 sin commit; interrupción sin commit; edición ajena con operación abierta y entre el UPDATE y la lectura; 403; RLS con 0 filas; corte de socket tras el commit |
| F9-04 P2 | `verificar` **exige `--lectura`** si hay copias; si falta, termina con código 2 sin emitir informe. `ok` exige cobertura completa: todos los originales, **2 variantes por entrada copiada** (`image/webp` y SHA-256) y todas las referencias, sin operaciones abiertas. Si no, `cobertura: incompleta`. Los fallos de red cuentan como problemas, no abortan el informe. El manifiesto vacío es un caso explícito: `cobertura: vacia`, sin login ni objetos inventados. La lectura pasa su guarda y su vínculo. | CLI | m y g ausentes, una sola variante, tipo incorrecto, lectura caída (500), lectura distinta de la ligada al manifiesto, operación abierta y manifiesto vacío; el caso completo da `ok` |
| F9-05 P2 | En las URL de Storage manda el **bucket real** de la URL, no el de la columna. Los endpoints `sign` y `authenticated`, los buckets privados y los buckets desconocidos se clasifican `privado`, sean propios, ajenos o detrás de un proxy, y su valor, ruta y token no salen al informe. En las demás URL no migrables el informe omite la query (`?<omitido>`). Las migrables siguen exactas, porque son el «original» del UPDATE condicional. | `lib.mjs` (`clasificarValor`, `valorParaInforme`), CLI | Matriz origen propio/ajeno/proxy × `sign`/`authenticated`/`public` × buckets privados y desconocido × columnas de galería, comprobante y producto (108 URL): la salida completa (archivo, stdout, stderr) no contiene ruta ni token. La URL pública de catálogo sigue siendo migrable |
| F9-06 P2 | Permisos **por función**: `--permitir-supabase`, `--permitir-worker` y `--permitir-lectura`, cada uno con su host exacto. El permiso de una función no habilita otra. `--permitir-remoto` se retiró con un mensaje que lo explica, las opciones repetidas se rechazan y producción sigue exigiendo `--permitir-produccion` por cualquier rol. | `lib.mjs` (`rechazoDeAmbiente`), CLI | Tres hosts ficticios `*.qa.invalid` aprobados: copiar, actualizar y verificar llegan cada uno a **su** host (auth y REST al de Supabase, PUT al Worker, lecturas de R2 a Pages, original a Supabase). Sin permiso, con roles intercambiados, con producción sin su permiso, con una opción repetida o con `--permitir-remoto`: código 2 y cero pedidos |

## 2. Cómo se prueba sin remotos

`probar-cli.mjs` ejecuta la **CLI y el harness reales** como procesos:

- Un servidor HTTP en memoria hace de Auth, PostgREST, Storage, Worker y lectura, y su comportamiento se programa por caso.
- `pruebas/red-ficticia.mjs` (preload) redirige al servidor ficticio los hosts `*.qa.invalid` y, como red de seguridad, el Supabase de producción. Cualquier otro host remoto lanza «conexión externa bloqueada».
- `pruebas/trampa-efectos.mjs` (preload) sustituye las escrituras de fs, los procesos hijo y `fetch` del harness por dobles que registran y lanzan antes de actuar.

No se usan credenciales reales: las variables son ficticias.

## 3. Resultados

| Comando | Resultado |
| --- | --- |
| `node scripts/migracion-medios/probar-lib.mjs` | **17/17**: las 12 de V1, más F9-06, F9-02, F9-05, F9-01 (fs ficticio) y la garantía estática del harness |
| `node scripts/migracion-medios/probar-cli.mjs` | **14/14** (`evidencia-fase9-v2/pruebas-cli.json`) |
| `node scripts/migracion-medios/simular-fase9.mjs --cuentas=… --trabajo=%TEMP%/sim-f9-v2` | **18/18 a la primera** (`evidencia-fase9-v2/simulacion-local.{json,log}`). El caso de guardas incluye ahora el permiso de otra función, el manifiesto de otro Supabase y `--permitir-remoto`. `verificar` sin `--lectura` falla cerrado y la verificación da `cobertura: completa`, R2 14/14 y referencias 11/11 |
| `npx oxlint scripts/migracion-medios` | sin diagnósticos |

**Estado de Local tras la simulación V2:**
- La huella de los valores de medios preexistentes es idéntica: `93b565019ca98416a7dca946b1ee89ad`.
- Storage tiene 441 objetos antes y después.
- `auditoria` tiene **+21 filas** (25.944 → 25.965), de los triggers sobre los fixtures, igual que en cada corrida V1. No se borraron.
- `reintentosRed`: el mismo `ECONNRESET` del arranque de `wrangler dev`, recuperado en el segundo intento.

## 4. Lo que se mantiene

- Sin borrados en la herramienta: la prueba estática sigue en verde y hay un solo UPDATE, que es condicional.
- Originales intactos y control de ediciones ajenas.
- Privados excluidos.
- Simulación por defecto.
- `inventario.sql` sin cambios.

## 5. Plan público: reservas registradas

En [PLAN-CAMBIO-PUBLICO-FASE9.md](PLAN-CAMBIO-PUBLICO-FASE9.md), §3, §5 y el nuevo §9:

- **O1:** observar durante un plazo no demuestra que las PWA antiguas se hayan actualizado. El tratamiento de los clientes instalados entra en 10A/10B, y se propone evaluar un build de GitHub Pages que lea R2 antes de cambiar referencias.
- **O2:** la retirada del SW queda **sin diseñar ni probar**, y «sin navegación forzada» deja de presentarse como garantía. Antes de ejecutarla hace falta una transición que conserve los recursos de los clientes abiertos y un ensayo concreto: venta pendiente, retirada, pantalla y ventana no visitadas, continuidad y recarga.
- **O3:** el dominio propio es opcional y `pages.dev` es una alternativa válida. Site URL y Redirect URLs se revisan con el flujo real de confirmación antes de publicar.

## 6. Límites

- Tras un fallo **incierto** cuya lectura muestra el valor anterior, la siguiente ejecución lo trata como no aplicado y repite el UPDATE condicional. Este solo puede aplicarse sobre ese mismo valor, así que no pisa nada, pero conviene que entre ambas ejecuciones pase más que el tiempo máximo de una sentencia (diseño §5).
- La identidad del ambiente compara la URL configurada con el manifiesto y no una huella interna de la base. Dos bases distintas servidas en **la misma** URL (por ejemplo, Local reiniciado con `db reset`) se consideran el mismo ambiente; el UPDATE condicional sigue protegiendo cada fila.
- El ensayo con hosts remotos usa nombres `*.qa.invalid` redirigidos al servidor en memoria. No prueba TLS, CORS ni la latencia real de esos servicios.
- Sigue fuera de esta autorización: el inventario de producción, el rollback ejecutable en staging, el periodo de retención y la ejecución pública.

## 7. Rollback

`evidencia-fase9-v2/rollback/`:
- copias V1 con `SHA256-v1.txt`, cuyos hashes coinciden con `hashes-paquete.json` de Codex;
- `SHA256-v2.txt`;
- `parche-v1-a-v2.patch`, cuya aplicación inversa reprodujo V1 **byte a byte** sobre una copia;
- `rollback-fase9-v2.md`, con los archivos nuevos que hay que borrar y la compatibilidad de manifiestos (V2 rechaza V1; no hay manifiestos reales).

## 8. Archivos

- **Nuevos:** `scripts/migracion-medios/trabajo-seguro.mjs`, `probar-cli.mjs`, `pruebas/red-ficticia.mjs`, `pruebas/trampa-efectos.mjs`, este documento y `.codex/evidencia-fase9-v2/`.
- **Modificados:** `scripts/migracion-medios/lib.mjs`, `medios-migracion.mjs`, `simular-fase9.mjs` y `probar-lib.mjs`; `.codex/DISENO-MIGRACION-MEDIOS-FASE9.md` (§3, §5, §6 y §7), `PLAN-CAMBIO-PUBLICO-FASE9.md` (§1, §3, §5 y §9) y `FASES-RENDIMIENTO-CLOUDFLARE.md` (fila 9); `implementacionesWed.md` (§54); nota de cabecera en `ENTREGA-FASE9-MEDIOS-Y-CAMBIO-PUBLICO.md`.
- `src/` y `inventario.sql` no cambiaron, no hubo migraciones SQL y no se tocó ningún recurso remoto.

Fase 9 V2 lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario.
