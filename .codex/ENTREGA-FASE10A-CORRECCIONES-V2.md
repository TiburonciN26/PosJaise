# Entrega Fase 10A V2 · Correcciones de la revisión de Codex (F10A-01…F10A-05)

Fecha: **2026-10-13**, America/Lima. Rama `feat/cloudflare-pages`, HEAD `6929c619`, árbol local sin commit. Responde a [REVISION-FASE10A-REGRESION-INTEGRADA-V1.md](REVISION-FASE10A-REGRESION-INTEGRADA-V1.md).

Misma autorización que la 10A: **solo Local**, sin commit, push, migraciones remotas, cambios de hosting ni publicación 10B. Nada de eso se hizo. **El código del producto no cambió en la V2:** `src/`, `supabase/migrations/` y las dos verificaciones corregidas en la V1 conservan exactamente los hashes de `evidencia-fase10a/rollback/SHA256-10a.txt`. Solo cambian herramientas de QA de `scripts/fase10a/` y documentos.

## 1. Hallazgos y corrección

| ID | Corrección | Archivos | Regresión |
| --- | --- | --- | --- |
| F10A-01 P1 | **Guardas comunes** para las dos herramientas que inician sesión, con un **preflight antes de cualquier credencial**: antes de leer la clave de servicio, provisionar la asistente o abrir el navegador. El orden es fijo: (1) `--app` es loopback `http` exacto, sin credenciales, query ni fragmento, y no es el puerto de Supabase; (2) las cuentas son `qa-…@test.local` con id; (3) Docker publica Supabase Local en 54321; (4) el **backend efectivo del bundle servido** es exactamente `http://127.0.0.1:54321`. Este último punto se lee por su **rol en el código compilado** (`X=\`url\`,Y=X.startsWith(\`/\`)?…`, de `src/lib/supabase.js`), recorriendo `index.html`, el precaché del SW y los imports de cada módulo. Se rechazan una URL relativa (proxy del mismo origen), otro puerto, un Supabase remoto, dos configuraciones o ninguna; (5) cada cuenta existe en el Auth de Local con ese id y correo. **Todo** contexto del navegador, incluido el de login, se crea con las guardas: service workers bloqueados; la app solo con GET/HEAD y nunca en rutas de API; Supabase Local; WebSockets solo al Realtime Local; los GET de terceros (fuentes) se responden con 204 dentro del navegador; todo lo demás se aborta y cuenta como **violación**. Un oyente de peticiones cubre además lo que escape al enrutado. Antes de navegar al login se comprueba **desde Node, sin seguir redirecciones**, que la app responde ella misma: Playwright no enruta los saltos 3xx. Antes de escribir credenciales se comprueba que la página cargada es la de la app aprobada. En roles, la asistente ficticia se crea **justo antes de su turno** y solo si la visitante y la clienta recorrieron la app sin violaciones. **Solo Local:** un modo staging tendrá su propio host aprobado y su propia autorización. | `lib/guardas-local-10a.cjs` (nuevo), `medir-vitales-10a.cjs`, `verificar-roles-rutas.cjs` | **Las dos herramientas reales** se ejecutan contra apps falsas en loopback y un servidor **señuelo** que registra todo. Casos: app remota; backend ajeno en el bundle; proxy `/__supabase`; cuenta ajena; cuenta QA inexistente; login redirigido (302) al señuelo; credenciales desviadas al enviar el login a otro servidor (más un WebSocket) y por proxy del mismo origen. En **los 16 casos** (8 × 2 herramientas): código distinto de 0 por el motivo esperado, **el señuelo no recibe ni una petición**, la contraseña inventada y los correos QA no llegan a ningún servidor, la app falsa no recibe escrituras y **cero asistentes provisionadas**. **Controles positivos:** preflight de la app real (143 módulos, una sola configuración, Local exacto); medición real de vitales con login bajo guardas (0 violaciones); matriz de roles en la batería (§3) |
| F10A-02 P2 | El evaluador ya no puede dar «0/0» con código 0. Cada medición escribe en una **carpeta nueva o vacía** un **manifiesto** (`ejecucion.json`): id de ejecución, alcance, SHA-256 del `index.html` de cada app al empezar y al terminar y, por productor, su código de salida y el SHA-256 de su archivo, que debe haberse escrito **en esta ejecución**. La evaluación exige el manifiesto, código 0 en cada productor del alcance, archivos idénticos a los registrados y **todos los resultados esperados** (`esperados` por grupo en `presupuestos-rendimiento.json`, escenarios de vitales, ciclos de sesión y muestras mínimas). Cualquier problema da **INCOMPLETA y código 1**, aunque las filas presentes cumplan. `--solo` declara el alcance **PARCIAL**. Sin `--solo`, una ejecución parcial no se acepta como global. | `medir-rendimiento-10a.mjs`, `lib/evaluar-presupuestos.mjs` (nuevo), `presupuestos-rendimiento.json` (solo listas de esperados; **ningún límite cambió**) | Carpeta vacía; productor que falla (el caso de Codex: «FALLÓ vitales» → ahora INCOMPLETA, código 1); carpeta con resultados anteriores (rechazada, código 2); archivo faltante; archivo alterado tras la ejecución; productor con código ≠ 0 en el manifiesto; muestras vacías; escenario omitido; medición declarada incompleta; resultado de datos iniciales omitido; `--solo` parcial y su uso como global; ejecución sana completa sintética (219/219, código 0) |
| F10A-03 P2 | El servidor sirve un archivo solo si **pertenece** a la carpeta. Se comprueba por **componentes de ruta** (`path.relative`), no por prefijo de texto, y por **ruta real** (enlaces y junctions). Se decodifica por segmento: `.`, `..`, barras normales o invertidas, `:` o NUL codificados y URI malformadas dan **400**; un destino fuera de la carpeta, **403**. Lo que no es un archivo conserva el fallback de SPA. | `servir-como-pages.cjs` | Carpeta vecina con prefijo común (`/..%2fservidor-fixture-ajeno%2fmarca.txt` → 400), `%2e%2e`, `%5c`, **junction real** hacia fuera (archivo y directorio → 403), URI malformada y NUL → 400. En ninguno aparece la marca de fuera. Controles: asset 200 con su `Cache-Control` de `_headers`, HEAD sin cuerpo, `/ventas` y `/` con el fallback. **Reproducción del defecto en la V1** (copia de rollback): devolvía 200 con la marca vecina |
| F10A-04 P2 | Las comparaciones usan el **valor exacto**. El medidor guarda medianas sin redondeo; el evaluador **recalcula LCP, CLS e interacción desde las muestras crudas**, sin fiarse del resumen. El redondeo queda solo en la tabla (CLS con 4 decimales). La **mediana con número par** de muestras es la media de las dos centrales (antes tomaba la inferior), y `--muestras` se valida (entero 1–9). | `lib/estadistica.cjs` (nuevo), `medir-vitales-10a.cjs`, `lib/evaluar-presupuestos.mjs` | 0.1 cumple; 0.10001, 0.14, 0.149, 0.15, ausente, texto y NaN no cumplen; un resumen 0.1 con muestras 0.1004 no aprueba; mediana impar, par, con valores no numéricos y vacía; `--muestras` inválidos. La evidencia V1 reevaluada da **201/219 (18 incumplimientos)**, la cifra de Codex |
| F10A-05 P1 (transición) | **Contrato de convivencia de deudas** ampliado en el plan (§0.1) y **mecanismo propuesto** (decisión D11): compatibilidad **en la base**, con dos triggers en `deudas` aplicados en el **mismo lote** que `20261010000001`. Mantienen el invariante «COBRADA ⇔ pagos ≥ monto» para cualquier escritor, incluidas las PWA antiguas: un cobro desde `main` registra el pago del saldo; una reapertura desde `main` de una deuda pagada **se rechaza** sin borrar pagos; la edición de monto recalcula. El lote termina con un relleno **dirigido e idempotente** y una comprobación del invariante que lo aborta si queda alguna incoherencia. Alternativa: pausa operativa con su alcance y su condición de cierre. Se distingue re-ejecutar el **archivo completo** (no duplica: falla en `create table`) del **bloque de relleno aislado** (sí duplica). | `PLAN-VALIDACION-STAGING-FASE10.md` §0.1, `propuesta-f10a-05/compat-deudas-borrador.sql` (**borrador; no es migración ni se aplicó**), `ensayar-compat-deudas.mjs` y `propuesta-f10a-05/ensayo-compat-deudas.sql` (nuevos) | **Ensayo en Local dentro de una transacción revertida**, como la administradora QA con RLS y GRANT reales, con las mismas sentencias que usan `main` y la UI nueva: **22/22**. Primero reproduce en SQL real los dos defectos de Codex (cobro en `main` + nota → reabierta por el total; reapertura en `main` → PENDIENTE con saldo 0). Con el borrador: ambos sentidos, abonos parciales, monto subido y bajado, flujo normal de la UI nueva, relleno dirigido (1 y luego 0) y bloque original repetido (duplica). **Local queda idéntico**: 59 deudas, 8 pagos, misma firma, 0 triggers y 0 funciones nuevas |

### 1.1 Precisiones de §3 de la revisión

- **Excepción de lint:** su alcance literal es `react/rules-of-hooks: off` en **todo `tests/e2e/**/*.mjs`**, no solo en `fixtures.mjs`. Las reglas del producto (`src/`, `scripts/`) siguen activas. Corregido el texto de §56 y de P20.
- **Cierre 10A V1:** era la **combinación** de `bateria-cierre` (19/20) y `bateria-cierre-f5f6` (32/32 y 21/21), no una única corrida global. En la V2 se repitió la batería **en una sola corrida** (§3).
- **Plan de staging:** 46 rutas, no 47. La fila residual de galería (`5bb670df…`) **ya se retiró** en la Fase 3 con autorización del usuario: borrado y relectura documentados. Para afirmar el estado actual queda una lectura en §1 del plan. La prueba RLS compara una **fotografía del propio staging antes y después**; la réplica Local sirve solo como referencia de lógica y metadatos. Si se ejecuta la suite protegida de `testing`, valida el **candidato exacto** en un worktree autorizado, sin debilitar su guarda.
- **TBT de Ventas (P23):** sigue siendo una **hipótesis sin traza** de atribución; no se atribuye a la precarga.
- **Intermitencias F4/F5 (P28):** siguen abiertas. Pasar una corrida no las resuelve.

## 2. Herramientas nuevas de la V2

| Herramienta | Qué hace |
| --- | --- |
| `scripts/fase10a/lib/guardas-local-10a.cjs` | Preflight y guardas de navegador (F10A-01) |
| `scripts/fase10a/lib/evaluar-presupuestos.mjs` | Evaluación exacta y completa, sin navegador (F10A-02 y 04) |
| `scripts/fase10a/lib/estadistica.cjs` | Mediana y validación de muestras |
| `scripts/fase10a/probar-herramientas-10a.mjs` | Las regresiones de F10A-01…04 (`--filtro`, `--sin-navegador`, `--app-real`) |
| `scripts/fase10a/ensayar-compat-deudas.mjs` | El ensayo de F10A-05 en una transacción revertida; se niega si el SQL contiene COMMIT o no termina en ROLLBACK |

Las dos últimas se añadieron a `bateria-10a.mjs` como `f10a-herramientas` y `f10a-compat-deudas`: la batería pasa de 20 a **22** comprobaciones.

## 3. Resultados

| Comando | Resultado |
| --- | --- |
| `probar-herramientas-10a.mjs --app-real=…5403` (todas, con navegador) | **38/38** (`evidencia-fase10a-v2/herramientas.json`) |
| `ensayar-compat-deudas.mjs` | **22/22**, Local intacto (`evidencia-fase10a-v2/compat-deudas.json`) |
| `medir-rendimiento-10a.mjs --solo=vitales` con la herramienta V2 | Manifiesto `cdf364ab…`, **0 problemas**, 0 violaciones de guarda (53 GET de fuentes neutralizados); **28/46 en alcance PARCIAL, NO CUMPLE, código 1**: los mismos 18 incumplimientos (§4) (`evidencia-fase10a-v2/rendimiento-vitales/`) |
| Evidencia V1 reevaluada (copia) | **201/219**, INCOMPLETA por no tener manifiesto (código 1) |
| `bateria-10a.mjs`, **una sola corrida** del árbol final (`evidencia-fase10a-v2/bateria-v2-b/`) | **22/22**: Fases 1–9 (F4 31/31, 17/17 y 8/8; F5 32/32; F6 21/21; F8 9/9…), `f10a-herramientas` 38/38, `f10a-compat-deudas` 22/22 y `f10a-roles-rutas` **19/19** (13 de la V1 + preflight + 5 «sin violaciones de guarda») |
| Corrida anterior (`evidencia-fase10a-v2/bateria-v2/`), **sin reclasificar** | **20/22.** Primer fallo: F6 16/21, porque Docker Desktop se reinició a mitad de la corrida («Docker Desktop is unable to start»; los contenedores llevaban 26 min arriba al terminar). No quedaron fixtures: 0 clientas «QA F6», 6 cuentas QA, 0 asistentes temporales, 59 deudas y 8 pagos. Segundo fallo: `f10a-herramientas` 37/38, por un **defecto mío**. El evaluador imprimía el veredicto correcto (INCOMPLETA), pero `process.exit()` tras los `fetch` de la huella abortaba el proceso en Windows (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`) y se perdía el código. Pasa a `process.exitCode`, igual en las pruebas: antes abortaba 6/6 veces, después da código 1 en 8/8 |
| `verificar-roles-rutas.cjs --control-negativo` | **18/19, código 1, como debe:** la única fila fallida es la alterada (cajera en `/dashboard`: esperado `/dashboard`, real `/ventas`). Los 5 casos de guarda dan 0 violaciones y no queda ninguna asistente temporal (`evidencia-fase10a-v2/roles-control-negativo.json`) |
| `npx oxlint` | **0 errores y 66 advertencias**, las mismas de la V1. Las tres que introducían los scripts nuevos se corrigieron |

## 4. Presupuestos que no se cumplen: excepciones propuestas para revisión

El paquete dice que un presupuesto incumplido **bloquea la 10A salvo una justificación revisada**. **No se cambió ningún límite** ni se codificó ninguna excepción en las herramientas: el veredicto sigue siendo **NO CUMPLE**.

Los 18 incumplimientos son los mismos en la evidencia V1 reevaluada y en la medición V2. Valores en ms, frío / caliente; entre paréntesis, la V1:

| Grupo | Filas | Valor | Frente a `main` | Causa medida | Propuesta |
| --- | --- | --- | --- | --- | --- |
| **LCP del portal**: Inicio, Productos y ficha, como visitante y como clienta | 12 | Inicio 3020/2692 (3272/2796); Productos 4104/3676 (4508/3984); ficha 4116/3824 (4380/3936); clienta: Inicio 3328/3012, Productos 4492/4056, ficha 4496/4176 | Productos **mejora** (5044 frente a 6172 en la V1); la ficha queda **igual** (4848 frente a 4600); Inicio no es comparable (en `main` no termina de cargar con clienta) | Primer pintado a ~1,6 s; el elemento LCP final es el `H1` o la imagen del héroe, que espera los datos y la animación de entrada; el carrusel vuelve a actualizarlo | **Excepción de laboratorio, condicionada**: no hay regresión frente a lo publicado; la meta es de campo (p75) y se confirma en 10B (P22). Si el p75 de campo supera 2,5 s, la excepción cae y se abre la corrección (pintar el título sin esperar datos, acortar la entrada sobre el pliegue, precargar el héroe) |
| **LCP de Pedidos Web** (admin) | 2 | 2860/2632 (3168/2780) | **Mejora** fuerte: 6276 → 3168 en la V1 | Texto de la lista tras llegar los datos | Igual que la anterior |
| **CLS de Inicio con sesión de clienta** | 2 | 0,3344 / 0,3280 (≈0,28) | No comparable | Contenido que llega tarde: el héroe crece de 284 a 330 px y la promoción y «Lo más pedido» se insertan después (P21) | **No propongo excepción permanente.** Es un desplazamiento visible para la clienta. Recomiendo corregirlo antes de 10B reservando el espacio, una decisión de diseño (D12) |
| **CLS de Inicio como visitante** | 2 | 0,1004 / 0,1004 (igual) | — (en `main` no hay portal de visitante) | La misma causa, en menor grado | Se corrige con lo anterior. Mientras tanto, excepción de **0,0004** sobre el límite, sin tocar el presupuesto |

La decisión es del usuario (**D12**) y la revisión, de Codex.

## 5. Datos y recursos

- **Local:** el ensayo de deudas escribe dentro de una transacción que se **revierte**; su foto antes/después es idéntica. Cada corrida de roles crea y borra su asistente ficticia; las pruebas de guardas, ninguna (0|0 antes y después de cada caso). La batería repite los fixtures de cada fase como en la V1. Las filas de auditoría que generan esos fixtures se conservan.
- **Fuera del repositorio:** apps falsas, señuelos y carpetas temporales de las pruebas en `%TEMP%\qa-f10a-herramientas-*`, borradas al terminar; builds y servidores en la scratchpad.
- **Remoto:** nada.

## 6. Rollback

`evidencia-fase10a-v2/rollback/`:
- `v1/` guarda las seis herramientas modificadas tal como estaban en la V1, **verificadas con los SHA-256 de la V1**, que coinciden con los `hashes-iniciales.json` de Codex: `bateria-10a.mjs`, `medir-rendimiento-10a.mjs`, `medir-vitales-10a.cjs`, `presupuestos-rendimiento.json`, `servir-como-pages.cjs` y `verificar-roles-rutas.cjs`;
- `SHA256-v2.txt` registra los hashes actuales;
- `rollback-fase10a-v2.md` explica la reversión.

Revertir la V2 es restaurar esas seis copias y borrar los archivos nuevos (`lib/`, `probar-herramientas-10a.mjs`, `ensayar-compat-deudas.mjs`, `propuesta-f10a-05/`). No hay producto, migraciones ni datos que revertir.

## 7. Archivos

- **Herramientas de QA** (`scripts/fase10a/`):
  - modificadas: `medir-vitales-10a.cjs`, `verificar-roles-rutas.cjs`, `medir-rendimiento-10a.mjs`, `servir-como-pages.cjs`, `presupuestos-rendimiento.json` y `bateria-10a.mjs`;
  - nuevas: `lib/guardas-local-10a.cjs`, `lib/evaluar-presupuestos.mjs`, `lib/estadistica.cjs`, `probar-herramientas-10a.mjs` y `ensayar-compat-deudas.mjs`.
- **Propuesta F10A-05** (no es migración): `.codex/propuesta-f10a-05/compat-deudas-borrador.sql` y `ensayo-compat-deudas.sql`.
- **Documentos:**
  - esta entrega y `evidencia-fase10a-v2/`;
  - el plan de staging en su V2 (§0.1 nuevo y precisiones en §1, §2, §4, §5, §7 y §8);
  - los pendientes (D11, D12, P19, P20, P23, P27, P29 y D8);
  - la fila 10A del registro;
  - `implementacionesWed.md` §56.
- **Sin cambios:** `src/`, `supabase/migrations/`, `.oxlintrc.json` y las verificaciones de las Fases 1–9.

Fase 10A V2 lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario.
