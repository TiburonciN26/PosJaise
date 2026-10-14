# Entrega Fase 8 · Correcciones V2 (F8-01, F8-02, F8-03)

Fecha: **2026-10-12**, America/Lima. Base HEAD `6929c619`, rama `feat/cloudflare-pages`; árbol local sin commit (Fases 4–8). Responde a [REVISION-FASE8-INICIO-PWA-V1.md](REVISION-FASE8-INICIO-PWA-V1.md). La entrega V1 ([ENTREGA-FASE8-INICIO-PWA.md](ENTREGA-FASE8-INICIO-PWA.md)) y su evidencia (`evidencia-fase8/`) se conservan sin cambios. Solo Local: sin commit, push, migraciones, despliegues, R2 ni hosting; Fase 9 no iniciada. Lista para verificación de Codex.

## 0. Resumen

| Hallazgo | Corrección | Regresión (V2) | Misma regresión contra V1 |
| --- | --- | --- | --- |
| **F8-01** P1 · chunk frío fallido desmonta el POS y pierde la venta | Límite de error **local** por pestaña/ventana/página (nunca recarga solo); módulos diferidos **reintentables con otra URL**; **precarga en reposo** de las pantallas del rol (en memoria + caché por uso del SW); sin `modulepreload` en los diferidos del POS; íconos de cobro en el precaché; aviso de actualización fuera del límite de la app | 7/7 casos F8-01 | 5 fallan con «Algo salió mal» (límite global); 2 no dependen de la corrección y pasan |
| **F8-02** P2 · la regla de imágenes cachea URLs firmadas del proxy | Reglas en `public/sw-reglas-cache.js`: solo estáticos públicos del build por espacio de nombres, sin query, con validación de la respuesta (200, básica, no redirigida, sin `private`/`no-store`, tipo de contenido esperado); limpieza al activar **solo** de entradas indebidas | 2/2 casos F8-02 | Falla: tras revocar, el SW devuelve la copia privada (`200 !== 401`) |
| **F8-03** P2 · contrato de video con caché anual y R2 directo | `POLITICA-VIDEO-FASE8.md` V2: misma garantía de retirada que las fotos por defecto; endpoint revocable; sin fallback público; originales/pendientes en espacio privado; caché anual/R2 directo solo como excepción explícita | documental | — |

Corrida final: `verificar-fase8-v2.cjs` **9/9**; control V1 **2/8**; arnés V1 corregido (`verificar-fase8.cjs`, ahora con publicación real) **13/13**; regresión Fase 5 **32/32**; `oxlint` sin diagnósticos en lo tocado; `build:cloudflare` y `npm run build` (GitHub Pages) correctos. Rollback V2→V1 ensayado: **build idéntico byte a byte** al V1.

## 1. F8-01 · conservar la operación cuando una pantalla no llega

### 1.1 Causas (más de una)

1. El rechazo de un `import()` llegaba al ErrorBoundary global de `main.jsx`, que reemplazaba Layout/CarritoProvider **y** AvisoActualizacionPWA (lo reproducido por Codex).
2. `React.lazy` guarda el rechazo para siempre: sin recargar no hay reintento posible.
3. **Chromium guarda el fallo de un `import()` dinámico en el mapa de módulos del documento** y no vuelve a pedir esa URL (medido: dos `import()` de la misma URL, 404 y luego 200 → una sola petición, ambos fallan). Reintentar con la misma URL nunca funciona sin recargar.
4. Igual con `<link rel=modulepreload>`: una dependencia cuya precarga falló sin red queda envenenada; un reintento de la página con otra URL sigue fallando por ella (medido con un servidor de prueba).

### 1.2 Corrección

| Pieza | Qué hace |
| --- | --- |
| `src/components/LimiteCargaDiferida.jsx` (nuevo) | Límite de error local. Variante **pantalla** (cada pestaña del POS, la página del portal, Login, la raíz del portal) y **ventana** (escáner de Ventas, cierra con Esc vía `useCerrarConEscape`). Explica si es falta de red o posible versión nueva; si hay trabajo pendiente lo dice («Lo que tenías en curso sigue aquí… No recargues la página») y **no ofrece recargar**; sin trabajo pendiente y con red ofrece «Recargar la página». «Ir a Ventas» (pantalla inicial del rol). Reintenta al pulsar «Reintentar», al volver la red (si está visible) y al volver a mostrarse la pestaña. **Nunca recarga solo.** |
| `src/lib/moduloDiferido.js` (nuevo) | `componenteDiferido(importar)`: lee el módulo con `use()` (sin fallback tras precargar, como `paginasCliente.js`), **conserva el rechazo** hasta `reintentar()` (si lo descartara solo, React volvería a pedir el módulo en bucle sin red) y el reintento importa **la URL que falló con `?reintento=N`** (módulo nuevo en el mapa). `precargar()` no deja rechazos guardados. `esErrorDeCarga()` reconoce los mensajes de Chromium/Firefox/Safari/Vite. |
| `PestanasCacheadas.jsx` | Las 26 pantallas diferidas son `componenteDiferido` envueltas en el límite local. **Precarga en reposo** (`requestIdleCallback`, de a una) de las pantallas que el rol puede abrir: quedan **evaluadas en memoria** (abrirlas no necesita red ni los archivos del servidor aunque se haya publicado otra versión) y en `assets-por-uso` (sobreviven a una recarga de la misma versión). Se cancela si cambia la cuenta o el rol. No incluye el escáner (481 kB, no hace falta para cobrar: si falla, falla en su ventana y se puede buscar el producto por nombre/código). |
| `vite.config.js` · `build.modulePreload.resolveDependencies` | Las dependencias JS de los diferidos **del POS** ya no se precargan con `modulepreload` (causa 4). La lista se **deriva del código** (`import('../pages/X.jsx')` en PestanasCacheadas y Ventas): una pantalla nueva entra sola; el build falla si no encuentra Citas y el escáner. El portal **conserva** el `modulepreload`: quitarlo también allí costaba ≈1 RTT (medido: 251 → 412 ms con 150 ms de latencia al abrir Términos; con la regla final, 244 → 246 ms). En el portal recargar no pierde trabajo (sus rutas no se cachean y el carrito de la clienta vive en `carrito_servicios`/`carrito_productos`), y el aviso local lo ofrece. |
| `src/config/paginasCliente.js` | Usa `componenteDiferido` (antes borraba el rechazo y el siguiente render volvía a pedir la página: bucle sin red). `reintentarPaginasFallidas()` para el límite del portal. |
| `PortalCliente.jsx`, `App.jsx` | Límite local alrededor del `<Outlet>` del portal (se reinicia al cambiar de ruta), de Login y de la raíz del portal. |
| `Ventas.jsx` | Escáner como `componenteDiferido` en un límite variante ventana. |
| `main.jsx` | AvisoActualizacionPWA queda **fuera** de un ErrorBoundary interno que envuelve la app: un error que llegue arriba ya no se lleva el botón «Actualizar». |
| `vite.config.js` · shell | **Dependencias críticas del cobro:** Ventas y todo su código de cobro son imports estáticos de la entrada (ya precacheados); lo único que el panel de cobro pide aparte son los 4 íconos de método de pago (`icons/{efectivo,targueta,transferencia,yape}.svg`, ≈30 kB) → entran al precaché (33 → 37 entradas). `assets-por-uso` sube a 300 entradas: caben POS y portal de **dos** versiones. |

Confirmar la venta sigue necesitando Supabase (red) por diseño; no se confirmó ninguna venta: la prueba llega hasta el panel de cobro y cancela.

### 1.3 Regresiones (`scripts/verificar-fase8-v2.cjs`)

Responde a por qué el 13/13 de V1 no lo detectaba:

- **B real con URLs distintas:** B se compila del mismo árbol con `[name]-[hash]-b` (`evidencia-fase8-v2/vite-b.config.mjs.txt`): **0 archivos de assets en común** con A (152 en A). El arnés aborta si comparten alguno.
- **Publicación sin conservar A:** el servidor del arnés cambia la raíz servida; un archivo de A ya no existe y, como en Pages, recibe el `index.html` con 200 (fallback de SPA). Se comprueba explícitamente (`Citas` de A → `text/html`).
- **Ruta y ventana frías con venta pendiente**, y se verifica **estado y UI** (`Algo salió mal`, contador del carrito en el DOM aunque Ventas esté oculta, menú, aviso), no `pageerror`.
- Los casos esperan el desenlace (pantalla lista, aviso local o límite global) y comprueban primero la propiedad, así contra V1 fallan con el efecto real.

| Caso | V2 | Control V1 (`--a=dist V1`) |
| --- | --- | --- |
| Sin red, Citas **nunca** descargada (su precarga se aborta): aviso local, carrito 1, menú, «trabajo conservado», sin «Recargar»; «Ir a Ventas» con el producto; al volver la red abre (pidió `Citas-…js?reintento=N`) | OK | FALLA «Algo salió mal» |
| Sin red **después** de la precarga: Citas abre desde memoria, carrito 1 | OK | FALLA «Algo salió mal» |
| A→B real con venta en curso: aviso con «Actualizar» deshabilitado; Citas de A (no visitada) abre; **escáner de A retirado → falla en su ventana**, carrito visible, Esc cierra; el HTML del fallback **no** quedó guardado como chunk; íconos de cobro cargados; quitar el producto habilita «Actualizar» → B, Citas abre en B | OK | FALLA «Algo salió mal» |
| Retención: tras publicar B, **recargar** A sin trabajo pendiente sigue en A y Citas abre con su código del SW (el servidor ya no lo tiene) | OK | FALLA «Algo salió mal» |
| Portal sin red, página pública no descargada: aviso dentro del portal (cabecera y menú), sin trabajo pendiente; al volver la red se reintenta y, si una dependencia quedó marcada, ofrece «Recargar la página», que la abre (desenlace observado: recarga) | OK | FALLA «Algo salió mal» |
| Cliente nuevo de B (Inicio, login, Citas) | OK | OK |
| Caso vacío: «Actualizar» disponible de inmediato | OK | OK |

Capturas de los tres avisos en `evidencia-fase8-v2/capturas/`. Escrituras de negocio bloqueadas por el arnés: 0 intentos en todas las corridas; cuenta `qa-…@test.local` y producto `TEST E2E …` de Local; ninguna venta confirmada.

En el caso de retención la precarga en reposo había quedado a medias al publicar B; tras la recarga se pidieron 21 archivos de A que no estaban en caché: recibieron el HTML del fallback y **no se guardaron** (validación de tipo de F8-02). Esas pantallas mostrarían el aviso local si se abrieran antes de actualizar.

### 1.4 Costo de la precarga del POS

Primera sesión del personal por versión (SW bloqueado, servidor local **sin compresión**; Pages comprime, no medido): **administración 70 chunks / 547 kB**, **cajera 34 / 235 kB**, en reposo y de a uno, después de que Ventas está lista. Con el SW activo, las sesiones siguientes de la misma versión los toman de `assets-por-uso`. Visitantes y clientas no descargan nada de esto (no montan el POS). Antes de la Fase 8 todos, visitantes incluidos, descargaban 3,58 MB al instalar. Hoy se precarga también con Save-Data: **decisión abierta para el usuario** (§4.3).

## 2. F8-02 · solo estáticos públicos del build

- `public/sw-reglas-cache.js` (nuevo, importado por `sw.js` con `workbox.importScripts`; las funciones de `vite.config.js` solo lo llaman, siguen autocontenidas). Relativo al alcance del SW (`/` o `/PosJaise/`):
  - `assets-por-uso` (CacheFirst): `assets/<archivo>.(js|css|woff2?|ttf|png|jpe?g|webp|avif|svg)`.
  - `imagenes-del-sitio` (StaleWhileRevalidate): `inicio-web/*`, `icons/*`, `favicon*`, `icon-*`, `icons.svg`.
  - Nunca: otro origen, cualquier query o hash (`?token=` de URLs firmadas), y además una denegación explícita de `__supabase`, `medios`, `/(rest|auth|storage|functions|realtime|graphql)/vN/` y `/object/(sign|authenticated)/` bajo cualquier prefijo.
  - `cacheWillUpdate`: solo `200`, tipo `basic`, no redirigida, sin `private`/`no-store`, y **tipo de contenido coherente con la extensión** (JS/CSS/fuente/imagen). Esto impide guardar el `index.html` que Pages devuelve con 200 en lugar de un chunk retirado (envenenaría esa URL 30 días).
  - Al **activarse** una versión retira de esas dos cachés **solo** las entradas que estas reglas no admitirían; lo válido (código que una pestaña abierta de la versión anterior todavía necesita) se conserva.
- Si el script faltara, la instalación del SW falla y sigue el anterior (falla cerrado). `build-cloudflare.mjs` exige que `sw.js` lo importe, que esté en la salida y que no quede ninguna regla `sameOrigin &&`. `_headers`: `no-cache` para el script.
- Predicados probados en Node para ambas bases (`/` y `/PosJaise/`) y en el navegador:

| Petición (SW real de A) | Resultado |
| --- | --- |
| `/__supabase/storage/v1/object/sign/…/qa-f8.png?token=ficticio` (`private, no-store`), luego revocada (401) | 200 → **401**; sin entrada en ninguna caché |
| `/__supabase/storage/v1/object/public/…png` (`public, max-age=60`) | no se guarda |
| `/__supabase/rest/v1/productos` ×2 | lecturas 1 y 2 (red) |
| Imagen de **otro origen** con CORS (como el Supabase absoluto) | no se guarda |
| `/medios/…webp` | no se guarda |
| `/inicio-web/no-existe.webp` y `/assets/no-existe.js` (fallback HTML 200), `/inicio-web/error-404.webp` (404) | no se guardan |
| Chunk real con `?token=1` | no se guarda |
| Hero, ícono público, chunks por uso, íconos de cobro (precaché) | **sí** |

- **Estado QA heredado:** con el SW de V1 se guardaron a propósito la imagen firmada ficticia y un HTML como chunk inexistente; al actualizar a V2 se retiraron **las 2** y se conservaron **las 44 válidas**.
- Alcance igual al de Codex: fixtures del servidor propio; no se accedió a comprobantes ni tokens reales; el Supabase absoluto de los builds Local está en otro origen.

## 3. F8-03 · contrato de video

`POLITICA-VIDEO-FASE8.md` pasa a V2 (V1 conservada en `evidencia-fase8-v2/v1/POLITICA-VIDEO-FASE8-V1.md`):

- **§5.1** misma garantía que las fotos tras borrado confirmado para GET/HEAD/Range/`If-Range`/condicionales: `404 no-store`, `503 no-store` si no se puede comprobar; sin prometer borrar descargas ni bytes ya entregados. El hash en el nombre no equivale a retirada.
- **§5.2** solo por el endpoint revocable (B antes de entregar desde cualquier caché, también parciales); navegador `max-age=0, must-revalidate`, borde con TTL solo detrás de B; Range completo; si la Function no soporta Range, **otro endpoint con garantía equivalente**, nunca fallback automático a bucket público/`r2.dev`/dominio directo.
- **§5.3** originales y pendientes en un espacio privado separado de los aprobados; el endpoint público solo resuelve aprobados `LISTO` y publicados.
- **§5.4** caché anual o R2 directo solo como **excepción explícita** del usuario a la decisión del 10/10/2026, no como contrato.
- **§6** la evaluación de Stream debe incluir la misma garantía. **§7** pruebas de retirada (video y poster, Range y condicionales, 503, en vuelo, reemplazo, originales, accesos alternativos).
- Sin módulo, tablas, infraestructura, dominio ni Stream.

## 4. Precisiones de la revisión V1

1. **Rollback y expiración:** corregido en `evidencia-fase8-v2/rollback/rollback-fase8-v2.md` §2: sin las reglas, nada dispara la expiración; esas cachés pueden persistir hasta borrar datos del sitio, desalojo por cuota o una limpieza explícita de una versión futura.
2. **«Sin POS»:** lo exacto es que el precaché **no incluye las 26 pantallas diferidas del POS ni el escáner**. La entrada sigue importando estáticamente Ventas, PestanasCacheadas, Layout y código compartido del POS (costo fijo ya reconocido).
3. **Decisiones de producto abiertas:** login sin conexión en el primer uso (Login no está en el shell; ahora falla con aviso local y se reintenta solo), precarga normal del portal, maquetas de `public/diseñosPropios`, y **nueva:** si la precarga del POS debe omitirse con Save-Data (hoy no se omite: se priorizó que la caja siga operando sin red).
4. Solo Chromium; sin móvil físico, Firefox/Safari, staging ni producción. Safari no incluye la URL en el error de `import()`: allí el reintento usa la misma URL (no verificado si Safari guarda el fallo como Chromium).

## 5. Mediciones (laboratorio, loopback salvo donde se indica)

| Métrica | V1 | V2 |
| --- | ---: | ---: |
| Inicio en frío sin scroll, 390 / 412 / 1440 | 1.578.432 / 1.578.432 / 1.612.496 B | 1.580.592 / 1.580.592 / 1.614.656 B (+2,2 kB, código nuevo en la entrada) |
| LCP Inicio (mediana, 3 cargas) 390 / 412 / 1440 | 164 / 164 / 176 ms | 160 / 148 / 160 ms (ruido) |
| Precaché | 33 entradas, 877.472 B | 37 entradas, 909.634 B (+4 íconos de cobro) |
| Abrir Términos (no precargada) con 150 ms de RTT, mediana de 5 | 244 ms | 246 ms |
| JS descargado tras el login, admin / cajera | 0 / 0 | 547 kB (70) / 235 kB (34), sin compresión |

Datos: `medicion-inicio-v1.json`, `medicion-inicio-v2.json`, `apertura-pagina-no-precargada.txt`, `precarga-pos-bytes.txt`, `deps-precarga.json.txt` (dependencias precargadas por import dinámico: portal igual que V1; diferidos del POS 0 JS).

## 6. Intermitencias observadas (no ocultadas)

- `verificar-fase8-v2.cjs`: una corrida completa dio 8/9 («Caso vacío»: `h1` de Inicio no visible en 20 s). Pasó en las otras 8 corridas completas de la sesión (varias con builds intermedios) y 4/4 aislado; no se identificó la causa (el caso no depende de las correcciones: abre Inicio público y espera el aviso). Corrida conservada: `verificacion-v2-corrida-con-intermitente.{log,json}`.
- Fase 5: la primera corrida dio 31/32 (Recompensas de clienta: `tabpanel` no visible en 30 s); aislado pasó 2/2 en V2 y 1/1 en V1, y la corrida completa siguiente 32/32 (la registrada).

## 7. Rollback

`evidencia-fase8-v2/rollback/rollback-fase8-v2.md`: copias V1 de los 10 archivos modificados (SHA-256 en `SHA256-v1.txt`; `main.jsx` coincide con el hash de `evidencia-fase8/antes/`; `vite.config.js` y `paginasCliente.js` salen de «antes» + parche V1), los 4 archivos nuevos a borrar, parche `parche-v1-a-v2.patch` (`git apply -R --check` correcto) y el reconstructor usado. **Ensayo:** restauradas las copias V1 dentro del repo (con respaldo y restauración automática verificada por SHA-256), `build-cloudflare` produjo una salida idéntica byte a byte (198 archivos) al build V1 compilado antes de empezar. Para volver hasta antes de la Fase 8 se encadena el rollback de V1 sin cambios.

## 8. Archivos

Nuevos: `src/lib/moduloDiferido.js`, `src/components/LimiteCargaDiferida.jsx`, `public/sw-reglas-cache.js`, `scripts/verificar-fase8-v2.cjs`. Modificados: `src/App.jsx`, `src/main.jsx`, `src/components/PestanasCacheadas.jsx`, `src/pages/Ventas.jsx`, `src/pages/PortalCliente.jsx`, `src/config/paginasCliente.js`, `vite.config.js`, `scripts/build-cloudflare.mjs`, `cloudflare/_headers`, `scripts/verificar-fase8.cjs` (publicación real: borra A antes de copiar B; producto de prueba TEST/QA; marcas leídas del build), `.codex/POLITICA-VIDEO-FASE8.md`, `implementacionesWed.md` (§52), `.codex/FASES-RENDIMIENTO-CLOUDFLARE.md` (fila 8). Evidencia: `.codex/evidencia-fase8-v2/`.

Comandos (Supabase Local en 54321; rutas de build a elección):

```bash
CF_OUT_DIR=<A> VITE_BUILD_ID=f8v2-a node scripts/build-cloudflare.mjs
VITE_BASE_PATH=/ VITE_BUILD_ID=f8v2-b node node_modules/vite/bin/vite.js build --config <vite-b.config.mjs> --outDir <B>   # en Git Bash: MSYS_NO_PATHCONV=1
node scripts/verificar-fase8-v2.cjs --a=<A> --b=<B> --v1=<build V1> --cuentas=<cuentas QA> --salida=… --capturas=…
node scripts/verificar-fase8-v2.cjs --a=<build V1> --b=<B> --cuentas=… --etiqueta=control-v1        # control: debe fallar
node scripts/verificar-fase8.cjs --antes=<build anterior a F8> --despues=<A> --a=<A> --b=<B> --cuentas=…
```

En Git Bash, `VITE_BASE_PATH=/` se convierte en una ruta de Windows salvo con `MSYS_NO_PATHCONV=1` (me ocurrió al compilar B la primera vez; `build-cloudflare.mjs` no se ve afectado porque fija la variable dentro de Node).
