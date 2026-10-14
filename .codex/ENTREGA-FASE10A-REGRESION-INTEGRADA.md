# Entrega Fase 10A · Regresión integrada en Local, rendimiento y plan de staging

> **Revisada por Codex** (`REVISION-FASE10A-REGRESION-INTEGRADA-V1.md`): pendiente de correcciones F10A-01…F10A-05, atendidas en [ENTREGA-FASE10A-CORRECCIONES-V2.md](ENTREGA-FASE10A-CORRECCIONES-V2.md). En esta V1 valen con reservas:
> - **«20 verdes» combina dos corridas:** el cierre (19/20) más la repetición de F5→F6.
> - **Incumplimientos de presupuesto:** fueron **18/219**, no 16. El evaluador redondeaba CLS.
> - **Deudas (§0 del plan):** el riesgo era mayor que «cobrada sin fecha».
> - **Descripciones de herramientas:** las de §1 corresponden a la V1. Sus guardas se ampliaron en la V2.

Fecha: **2026-10-12**, America/Lima. Rama `feat/cloudflare-pages`, HEAD `6929c619`, árbol local sin commit (Fases 4–10A).

**Autorización del usuario:** iniciar la 10A **en Local**. Verificar todas las fases integradas (roles, POS, portal, carritos, medios, sesiones, PWA y rendimiento), conservar los pendientes y preparar el plan de validación en staging. Excluye commit, push, migraciones remotas, cambios de hosting y la publicación 10B. **No se hizo nada de eso.**

Antes de empezar se cerró la Fase 9 según su revisión V2.1 (aprobada con observaciones, solo local): [CIERRE-FASE9-OBSERVACIONES.md](CIERRE-FASE9-OBSERVACIONES.md). Se corrigieron las frases sobre ACL que pedía la O1 y la fila 9 del registro.

## 1. Qué se entrega

| Pedido | Entregable |
| --- | --- |
| Verificar las fases integradas | `scripts/fase10a/bateria-10a.mjs`: 20 comprobaciones en serie (verificaciones de las Fases 1–9 y nuevas de 10A) sobre los builds del árbol final y Supabase Local; registra log, código de salida y resumen de cada una (§2). |
| Roles y rutas | **Nuevo:** `scripts/fase10a/verificar-roles-rutas.cjs`. Cinco perfiles (visitante, clienta, asistente, cajera y administración) × 46 rutas abiertas por URL directa: las 27 del POS, las del portal y dos fichas. Comprueba destino o redirección esperada, montaje sin límite de error, menú sin rutas ajenas y cierre de sesión. La matriz esperada se compara además con `navegacion.js`. Incluye **control negativo** (`--control-negativo`), que falla donde debe. |
| Pruebas de rendimiento reproducibles y presupuestos | `scripts/fase10a/presupuestos-rendimiento.json`: cada límite parte de la medición aceptada de su fase, con su fuente. `medir-rendimiento-10a.mjs` mide cupones en reposo, búsqueda amplia, datos iniciales, sesión larga, movimiento reducido, fotos y vitales, y evalúa los presupuestos. **Nuevos:** `medir-vitales-10a.cjs` (LCP, CLS, TBT e interacción, frío y caliente) y `servir-como-pages.cjs` (cabeceras de `_headers`, Brotli y 304, para que la carga caliente use la caché como en Pages). |
| Lint de `tests/e2e` | Revisados los 2 errores: el `use` de los fixtures de Playwright no es el hook de React. `react/rules-of-hooks` queda en `off` en **todo** `tests/e2e/**/*.mjs` (no solo en `fixtures.mjs`); `src/` y `scripts/` la conservan. **0 errores y 66 advertencias, registradas sin ocultar** (§5). |
| Conservar los pendientes | [PENDIENTES-CONSOLIDADOS-FASE10A.md](PENDIENTES-CONSOLIDADOS-FASE10A.md): decisiones D1–D10 y pendientes P1–P27, con lo nuevo de 10A. |
| Plan de validación en staging | [PLAN-VALIDACION-STAGING-FASE10.md](PLAN-VALIDACION-STAGING-FASE10.md): orden de migraciones, compatibilidad con `main`, dos caminos para el Preview, herramientas y adaptaciones, criterios para pasar a 10B. |

## 2. Regresión integrada (Local)

Builds del árbol final:
- **Cloudflare Pages** (`build:cloudflare`, base `/`): precaché de 37 entradas (≈888 KiB);
- **GitHub Pages** (`vite build`, base `/PosJaise/`);
- **A/B de la PWA**, con todos los nombres de assets distintos (0 en común).

Se sirven en local junto con Vite dev, y una variante de Vite con hosts R2 `.invalid` para las fotos. Cuentas QA ficticias de Local; la asistente se crea y se borra en cada corrida.

**Corrida de cierre sobre el árbol final** (`evidencia-fase10a/bateria-cierre/`): ver §2.1. Historial de corridas, sin reclasificar (hubo un corte de luz entre la 3 y los diagnósticos posteriores; Local volvió sin fixtures sobrantes):

| Corrida | Árbol | Resultado | Qué falló y qué se hizo |
| --- | --- | --- | --- |
| 1 (`bateria/`) | sin correcciones de 10A | 18/20 | `f4-fotos-sesion`: **carrera en la verificación** (§3.1). `f6-sesion-larga`: scroll 400 → 0 (§3.2) y tiempo agotado del arnés (la Fase 6 completa tarda unos 17 min; límite subido a 25). |
| Aisladas (`diagnostico/`) | ídem | F6 20/21 y 21/21; fotos 3/3 tras la 1.ª corrección | Diagnóstico de §3.1 y §3.2. |
| 2 (`bateria-final/`) | correcciones CSS | 18/20 | `f6-sesion-larga`: el mismo scroll. `f4-catalogos-interfaz`: 30/31, «un fallo de red muestra Reintentar» (§3.3). |
| 3 (`bateria-final-2/`) | + ventana de scroll de 10 s (**luego revertida**) | 16/20 | El scroll **volvió a fallar con 10 s** → la hipótesis de la ventana no se sostiene (§3.2). Además, fallos de tiempo: «calculando total…» en la barra (§3.1), paginación de Pedidos Web de la Fase 5 (30 s) y «fallo de red» de Servicios (§3.3). |
| Aisladas (`diagnostico-2/`) | ídem | F5 32/32 (2 veces); **F6 21/21 justo después de F5**; F4 interfaz 31/31; fotos 7/8 («calculando total…») y, tras la 2.ª corrección, **3/3 8/8** | Ninguno de los fallos de la corrida 3 se reproduce aislado. |
| Cierre (`bateria-cierre/`) | **árbol final** (CSS de 10A; sin el cambio de scroll) | 19/20 | Solo el scroll de la Fase 6, por cuarta vez. Esto llevó a encontrar la carrera de su verificación (§3.2). |
| Cierre F5→F6 (`bateria-cierre-f5f6/`) | árbol final + verificación de la Fase 6 corregida | **2/2** (F5 32/32, F6 21/21) | — |

### 2.1 Corrida de cierre

Las 20 comprobaciones pasan sobre el árbol final:
- 19 en `bateria-cierre/`;
- la vigésima, `f6-sesion-larga`, tras corregir la carrera de su verificación, con la Fase 5 justo antes como en la batería, en `bateria-cierre-f5f6/`.

| Fase | Comprobación | Resultado |
| --- | --- | --- |
| 1 | cupones (funcional, ambos temas y movimiento reducido) | 30 OK |
| 2 | salvaguardas de backend y clave de los builds | 43/43 |
| 3 | URLs de medios, lectura mixta, salida segura, fuentes y CLI del recolector, guardas de interfaz R2 | 16/16, 7/7, 9/9, 9/9, 23/23, 49/49 |
| 4 | categorías completas, catálogo público, interfaz de catálogos (con 25 categorías QA), barras de carrito y cita, fotos y sesión | 31/31, 27/27, 31/31, 17/17, 8/8 |
| 5 | listas administrativas, detalles diferidos, sesión y cambio de cuenta | 32/32 |
| 6 | caché de pantallas, conservación, pausa de animaciones, invalidación por cuenta | 21/21 |
| 7 | conteos de Pedidos Web (SQL = página = app) | CORRECTO |
| 8 | PWA A→B con trabajo pendiente y caché por uso | 9/9 |
| 9 | biblioteca y CLI de la migración de medios | 17/17, 18/18 |
| 10A | matriz de roles × rutas | 13/13 |

**Intermitencias que se conservan** (P28): «un fallo de red muestra Reintentar» (Fase 4) y la paginación de Pedidos Web (Fase 5) fallaron en alguna batería anterior y pasaron en el cierre y aisladas. No se reclasifican como resueltas.

## 3. Hallazgos de la regresión

### 3.1 Verificación de fotos de la Fase 4: dos carreras en la propia prueba (corregidas)

**Carrera 1.** Al pasar a la página 3, el paginador muestra «Página 3» unos **150 ms antes** de que lleguen sus tarjetas (medido). La verificación leía el texto de la tarjeta *i*, que aún era de la página 2 y en stock. Al hacer clic, `nth(i)` ya era otra tarjeta: con los datos QA actuales, un producto «SIN STOCK» cuya ficha, correctamente, no tiene «Agregar al carrito».

**Estado de la cuenta.** La verificación no vaciaba el carrito ni la cita de su cuenta. Tras una corrida, la siguiente encontraba el servicio ya agregado.

**Carrera 2.** Leía la barra «Tu carrito» en cuanto aparecía «1 producto…», mientras aún decía «calculando total…».

**Corrección, solo en la verificación:**
- espera a que cambie el conjunto de tarjetas;
- hace clic en la tarjeta leída por su `href`;
- vacía el carrito y la cita de la cuenta ficticia antes y después, igual que `verificar-barras-seleccion.cjs`;
- espera hasta 20 s a que la barra termine de calcular. Si nunca termina, falla diciéndolo: eso sería un defecto de la barra.

Resultado:
- tras la 1.ª corrección, **3/3 corridas 8/8**;
- después, «calculando total…» en 2 corridas;
- tras la 2.ª corrección, **3/3 8/8**.

En todas el total terminó llegando: es una carrera de la prueba, no un defecto de la barra. En la app queda la observación P25: el paginador cambia de número antes que las tarjetas.

### 3.2 Scroll al volver a una pantalla del POS: carrera en la verificación de la Fase 6 (corregida; la app no cambia)

En la verificación de la Fase 6, Inventario volvía a veces con `scrollTop` 0 en vez de 400 tras desmontarse y volver a montarse. Falló en las 4 baterías y pasó en todas las corridas instrumentadas.

**Primera hipótesis, descartada.** La ventana de restauración de 3 s de `PestanasCacheadas`. La amplié a 10 s y la batería 3 volvió a fallar, así que **el cambio se revirtió**: el archivo es idéntico al previo a la 10A.

**Causa encontrada.** Está en la verificación:
- Tras volver a Inventario, la prueba espera con `quieto(1200)`. Esa función solo espera si hay peticiones en vuelo o si la última fue hace menos de 1,2 s.
- Antes de volver se pasa por Ventas, que está en caché y no pide nada. Si la última petición tenía más de 1,2 s, `quieto` volvía **en 1–2 ms**.
- La prueba medía el scroll a los ~0,5 s, antes de que llegaran los datos (`resumen_inventario`, ~1,6 s). La restauración ocurre justo al llegar ellos.
- La instrumentación pasaba siempre porque esperaba 12 s antes de medir.

**Reproducción determinista.** Forzando esa condición, una pausa de 1,3 s antes de volver, la prueba original falla 2/2 (`quieto volvió a los 1–2 ms`, `scroll 400 → 0`).

**Corrección, solo en la verificación.** Antes de volver, registra la espera de la primera petición que dispara el remontaje y luego aplica `quieto`. Con la condición forzada pasa 2/2. Las trazas instrumentadas muestran en todos los casos la restauración a los 1,6–1,8 s.

### 3.3 «Un fallo de red muestra Reintentar» (Fase 4): intermitente

Falló en 2 de 3 baterías (Productos en la 2, Servicios en la 3): la alerta no apareció en 20 s. Pasó 3/3 aislado, 31/31 aislado tras el corte y en la primera batería. Causa no identificada. Se conserva como intermitente; no se reclasifica como aprobado.

### 3.4 Matriz de roles

**13/13** en todas las corridas. El control negativo detecta exactamente la ruta alterada. Rutas a las que llega cada perfil:
- visitante: 11 públicas;
- clienta: públicas y privadas del portal;
- asistente: `/mi-panel` y `/citas`;
- cajera: Ventas, Inventario, Historial, Servicios, Citas y Gastos;
- administración: las 27.

Toda ruta sin permiso redirige a su destino esperado, y el menú nunca ofrece rutas ajenas.

## 4. Rendimiento con presupuestos (laboratorio, Local)

Detalle en `evidencia-fase10a/rendimiento/`: `presupuestos-tabla.md`, `presupuestos-resultado.json`, `comparacion-main.md` y las salidas de cada medidor.

| Grupo | Resultado |
| --- | --- |
| Cupones en reposo (Fase 1) | **cumple** todos (TaskDuration, animaciones activas, tareas largas) |
| Búsqueda amplia y fotos (Fase 4) | **cumple** todos (nodos, tarjetas, imágenes pedidas, bytes, evento de búsqueda, pedidos por búsqueda) |
| Datos iniciales (Fase 5) | **cumple** todos (nodos, bytes, 0 duplicadas, ≤ 1 canal Realtime, tareas largas) |
| Sesión larga (Fase 6) | **cumple** todos (pantallas montadas, heap tras GC, sin crecimiento entre ciclos, reposo) |
| Movimiento reducido | **cumple** tras corregir `.shiny-text` (§4.2) |
| Vitales de laboratorio | **no cumple** el LCP de 2,5 s en el portal ni en Pedidos Web, ni el CLS de Inicio con sesión (§4.1) |

### 4.1 Vitales: comparados con `main`, lo publicado hoy

**Método:** CPU 4×, red 4G lenta simulada (150 ms, 1,6 Mbps), 3 muestras frías y 3 calientes, mediana, ambos builds con el mismo servidor tipo Pages. En `main` el portal exige sesión: un visitante solo ve el login. Por eso la comparación justa del portal es **con sesión de clienta**. El Inicio de `main` con clienta no terminó de cargar, así que esa fila no se compara.

| Escenario | LCP frío 10A / main | Interacción 10A / main | Lectura |
| --- | --- | --- | --- |
| Productos (clienta) | 5,0 / 6,2 s | **80 / 544 ms** | Mejora: catálogo acotado (Fase 4) |
| Pedidos Web (admin) | **3,2 / 6,3 s** | **48 / 408 ms** | Mejora (Fases 5 y 7); TBT 143 frente a 654 |
| Ficha de producto (clienta) | 4,8 / 4,6 s | — | Igual |
| Ventas (admin) | 2,3 / 2,2 s | 32 / 32 ms | Igual en LCP; **TBT ≈300 frente a 47 ms** (P23) |

**Por qué el portal no baja de 2,5 s en este laboratorio:**
- El primer pintado llega a ~1,6 s.
- El elemento LCP final es el `H1` del héroe o de la ficha, que aparece **tras llegar los datos** y con la **animación de entrada** del portal. En Inicio es la imagen del héroe.
- El carrusel del héroe puede volver a actualizar el LCP mientras no haya interacción.

Son decisiones del diseño del portal (patrón de entrada) y de la carga de datos, no del hosting. Opciones para decidir:
- pintar el título del héroe sin esperar los datos;
- acortar los retrasos de entrada sobre el pliegue;
- precargar la imagen del héroe de Inicio.

Las metas del plan son de campo (p75) y se confirman en 10B (P22).

**CLS de Inicio:**
- Con la promoción activa visible había **0,2–0,4**. El destello del cupón rojo animaba `left`: un layout por cuadro, contado como desplazamiento. **Corregido** (§4.2).
- Queda **0,3 con sesión de clienta** (y ~0,1 como visitante) por **contenido que llega tarde**: el héroe crece de 284 a 330 px a los ~3 s, y la tarjeta de promoción y «Lo más pedido» se insertan después.
- Reservar ese espacio es una decisión de diseño. **No se cambió** (P21).

### 4.2 Correcciones de CSS de la 10A

1. **`@keyframes cupon-sheen`**: `left` → `transform: translateX() skewX()`, con el mismo recorrido (≈515 %), igual que `cupon-sheen-pasada` de la Fase 1.
   - Se fijaron los fotogramas en 0, 600, 1.200, 1.800 y 2.400 ms y se compararon píxel a píxel con el anterior: **diferencias en ≤ 11 de 141.360 píxeles** (borde del antialiasing; `evidencia-fase10a/cupon-sheen/`).
   - Las entradas de desplazamiento del `::after` pasaron de ~60/s a **0**.
2. **`.shiny-text`** («Reserva tu cita» en Inicio): sin animación con `prefers-reduced-motion: reduce`. Era la única animación infinita bajo movimiento reducido, y es anterior al programa de rendimiento (commit `4100ef1`).

### 4.3 Lighthouse

**No está instalado** (ni como dependencia ni global), y añadirlo es una dependencia nueva: decisión D9. Los vitales de laboratorio se midieron con Chromium/CDP. Codex puede usar su Lighthouse sobre los mismos builds.

## 5. Lint

`npx oxlint`: **0 errores y 66 advertencias**. Por regla:

| Regla | Advertencias |
| --- | --- |
| `no-unused-vars` | 30 |
| `exhaustive-deps` | 16 |
| `only-export-components` | 15 |
| `no-empty-pattern` | 3 |
| `only-used-in-recursion` | 1 |
| `no-control-regex` | 1 |

Por zona:

| Zona | Advertencias |
| --- | --- |
| `src` | 29 |
| `tests/e2e` | 15 |
| `scripts` | 10 |
| copias de evidencia de Codex en `.codex/` | 12 |

Ninguna se ocultó: la excepción afecta solo a `rules-of-hooks` en `tests/e2e`.

## 6. Lo que la 10A no cubre

- **Suite Playwright de 214 casos:** exige la rama `testing` y `QA_TEST_PASSWORD`, que no está en el entorno ni en el repositorio. No se debilitó su guarda ni se buscó la contraseña (D10).
- **Pagos y callbacks:** Culqi bloqueado con error 401; ningún cobro real.
- **Firefox, Safari y móvil físico:** solo se probó Chromium.
- **Staging y producción:** nada. Es el plan.
- **Cifras:** son de laboratorio y de Claude; la aceptación depende de Codex.

## 7. Datos y recursos

**Local:**
- La matriz crea y borra una cuenta ASISTENTE ficticia por corrida (`qa-f10a-asistente-…@test.local`).
- Las verificaciones de las Fases 1, 4, 5, 6 y 8 crean y limpian sus fixtures como antes.
- Los carritos de la clienta QA se vacían.
- Las filas de auditoría que generan esos fixtures no se borran.

**Fuera del repositorio:**
- builds y servidores en la scratchpad;
- una copia de `main` extraída con `git archive`, sin tocar ramas;
- `%TEMP%\sim-f9-*` de la Fase 9.

**Remoto:** nada. No se usó el MCP ni ninguna credencial de staging o producción.

## 8. Rollback

`evidencia-fase10a/rollback/` contiene:
- las versiones anteriores de `src/index.css`, `.oxlintrc.json`, las dos verificaciones corregidas y el comentario de la migración (este último coincide con el hash de la V2.1 que verificó Codex);
- `SHA256-10a.txt`;
- `rollback-fase10a.md`.

Sin migraciones ni datos que revertir.

## 9. Archivos

- **Producto:**
  - `src/index.css` (dos reglas). `src/components/PestanasCacheadas.jsx` se cambió para una prueba y se **revirtió**: es idéntico al previo a la 10A.
- **Configuración:** `.oxlintrc.json`.
- **QA:**
  - `scripts/verificar-catalogos-fotos-sesion.cjs` y `scripts/verificar-fase6.cjs` (carreras de las verificaciones, §3.1 y §3.2);
  - nuevos en `scripts/fase10a/`: `bateria-10a.mjs`, `verificar-roles-rutas.cjs`, `medir-rendimiento-10a.mjs`, `medir-vitales-10a.cjs`, `presupuestos-rendimiento.json` y `servir-como-pages.cjs`.
- **Migración:** comentario de `20261012000003` (O1 de la Fase 9, sin SQL ejecutable).
- **Documentos:** esta entrega, `PLAN-VALIDACION-STAGING-FASE10.md`, `PENDIENTES-CONSOLIDADOS-FASE10A.md`, `CIERRE-FASE9-OBSERVACIONES.md`, `evidencia-fase10a/`, las filas 9 y 10A del registro y `implementacionesWed.md` §55 (frase de ACL) y §56.

Fase 10A lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario.
