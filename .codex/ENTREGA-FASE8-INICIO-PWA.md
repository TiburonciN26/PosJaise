# Entrega Fase 8 · recursos de Inicio, mapa diferido y precaché PWA

Fecha: 2026-10-12. Base HEAD `6929c619`, rama `feat/cloudflare-pages`; árbol local sin commit con las Fases 4–7. Solo local: sin commit, push, migraciones, despliegues ni cambios de hosting; Fase 9 no iniciada. No hay cambios de base de datos. Lista para revisión de Codex.

## 1. Qué se midió y cómo (léase primero)

- **Escenario:** build de producción (`VITE_BASE_PATH=/`, sin `404.html`, como Cloudflare Pages) servido por un servidor estático local, Chromium (Playwright) contra el Supabase **Local**; los únicos orígenes externos son los que la página pide por sí misma (Google Fonts y, en el «antes», Google Maps), por Internet real. Es **laboratorio**: no es Lighthouse, no hay estrangulamiento de red ni de CPU, no hay dispositivo físico, y los tiempos (LCP/FCP) son de loopback para lo propio. Las cifras de bytes son **bytes transferidos** (CDP `encodedDataLength`), no tamaños en disco.
- **Antes:** build del árbol local inmediatamente previo a la Fase 8. **Después:** el árbol actual. Mediana de 3 cargas en frío (contexto nuevo, sin caché) por viewport: 390×844 @2x, 412×915 @2x, 1440×900 @1.
- Herramienta: `scripts/medir-fase8.cjs`; datos crudos en `.codex/evidencia-fase8/medicion-antes.json` y `medicion-despues.json`.
- El «sin scroll» es la carga inicial sin tocar la página (2 s sin tráfico); el «tras scroll» recorre la página hasta el final.

## 2. Resultados antes → después

### Inicio (carga en frío)

| Métrica | 390×844 | 412×915 | 1440×900 |
| --- | ---: | ---: | ---: |
| Bytes transferidos sin scroll | 2.239.296 → **1.578.392** (−29,5 %) | 2.240.922 → **1.578.393** (−29,6 %) | 2.286.927 → **1.612.457** (−29,5 %) |
| Peticiones sin scroll | 115 → **98** | 115 → **98** | 115 → **98** |
| Peticiones a Google Maps al abrir | **16 → 0** | **16 → 0** | **16 → 0** |
| Bytes de Google Maps al abrir | 473.411 → **0** | 475.039 → **0** | 521.043 → **0** |
| Peticiones a Maps tras llegar a la sección | 27 → 27 | 27 → 27 | 35 → 35 |
| Bytes hero (2 fotos) | 204.105 → **30.588** (−85 %) | 204.105 → **30.588** | 204.105 → **64.652** (−68 %) |
| LCP, laboratorio (mediana) | 320 → 156 ms | 304 → 140 ms | 328 → 148 ms |
| FCP, laboratorio (mediana) | 212 → 68 ms | 212 → 68 ms | 208 → 64 ms |

Notas: el mapa estaba a ≈4.500 px (móvil) y ≈3.300 px (escritorio) de la parte superior y aun así se descargaba al abrir Inicio. Ahora no existe hasta que la sección se acerca (margen 150 px) o se pulsa «Ver mapa»; tras llegar descarga lo mismo que antes. El elemento LCP sigue siendo la imagen «después» del hero. Los LCP/FCP sin estrangular son de laboratorio y mejoran sobre todo porque la hoja de Google Fonts dejó de bloquear el primer render; **no son una promesa de mejora en un móvil real**. Los bytes de Google Fonts pasan de 79.233 B (4 peticiones) a 62.520 B (3), y el conjunto de fuentes (Google + TTF propias) de 214.066 B / 6 peticiones a 197.353 B / 5.

### PWA y precaché

| Métrica | Antes | Después |
| --- | ---: | ---: |
| Entradas del precaché (Cache Storage, sin duplicados) | 172 (Workbox declara 176) | **33** |
| Bytes del precaché | 3.583.112 | **877.433** (−75,5 %) |
| Escáner (`ModalEscanerCodigoBarras`, 481.063 B) en precaché | sí | **no** |
| Maquetas HTML de `public/diseñosPropios` (≈640 kB) en precaché | sí | **no** |
| Íconos de la PWA duplicados en precaché (≈275 kB) | sí | **no** (el navegador los pide solo al instalar) |
| Páginas del POS (Ventas, Citas, Inventario, …) en precaché | sí | **no** |
| Bytes de red de la 1.ª visita con SW activo (incluye la instalación) | 2.240.895 / 115 peticiones | **1.565.399 / 98** |
| 2.ª visita: peticiones propias servidas por el SW | 71 de 75 (338.938 B de red) | **75 de 75 (0 B)** |
| 3.ª visita | 71 de 75 | **75 de 75 (0 B)** |
| Peticiones a Supabase pasando por el SW | 0 de 30 | **0 de 30** |
| Entradas de Supabase en cualquier Cache Storage | 0 | **0** |

**Qué contiene el shell ahora:** `index.html`, `manifest.webmanifest`, el chunk de entrada y sus importaciones estáticas, el CSS, la fuente Geist latina, y los chunks de `PortalCliente` e `InicioCliente` (ruta de aterrizaje). La lista **se calcula del grafo real de Rollup** durante el build (plugin `cierre-del-shell-pwa` en `vite.config.js`), no por nombres con hash; si el grafo saliera vacío el build falla. Todo lo demás (páginas del POS y del portal, escáner, modales) entra a **caché por uso** (`CacheFirst` con hash inmutable, 160 entradas/30 días, `assets-por-uso`) la primera vez que se pide con el SW activo; las imágenes del sitio van a `imagenes-del-sitio` (`StaleWhileRevalidate`, nunca `/medios`). **No hay regla para Supabase ni para `/medios`: siguen yendo siempre a la red.**

### Contrato sin conexión (cambio deliberado)

- Inicio ya visitado, recargado **sin conexión**: arranca (hero, textos, «Iniciar sesión»), antes y después. Los datos no se sirven de caché: sin red se ven los estados vacíos/errores de siempre.
- Una ruta **no visitada nunca** (p. ej. `/login` en el primer uso sin red): **antes** abría el formulario (aunque iniciar sesión es imposible sin red); **ahora** muestra la pantalla «Algo salió mal… recarga la página» (el chunk no existe aún). Es el costo de no descargar todo el POS en la instalación. El POS necesita la red para vender, así que no se considera pérdida funcional, pero **es una decisión de producto que queda para el usuario** (§6).

## 3. Cambios

| Archivo | Cambio |
| --- | --- |
| `src/components/MapaDiferido.jsx` (nuevo) | Placeholder con «Ver mapa»; el iframe (mismos atributos: `loading="lazy"`, `referrerpolicy`, mismo `src`) se monta al intersectar con 150 px de margen o al pulsar; con Save-Data o sin `IntersectionObserver` exige el botón; sin dirección conserva el icono. |
| `src/pages/cliente/InicioCliente.jsx`, `NosotrosCliente.jsx` | Usan `MapaDiferido`. En Inicio, el hero usa `srcset` WebP 640/960/1280/1680 (el JPG/WebP original queda como `src` de reserva), `sizes`, `width/height`, `fetchPriority="high"` solo en «después» (candidato LCP) y `"low"` en el overlay «antes», `decoding="async"`. |
| `public/inicio-web/*-{640,960,1280,1680}.webp` (14) y `scripts/generar-hero-responsivo.mjs` | Variantes generadas con ffmpeg/libwebp q80, reproducibles; los originales no se tocaron. |
| `index.html` | Google Fonts deja de bloquear el render (`media="print"` + `onload`, con `<noscript>`); se quita la familia **Outfit** (declarada solo aquí: ninguna regla CSS ni componente la usa). Resto de familias/pesos intactos, `display=swap` conservado. |
| `vite.config.js` | Plugin `cierre-del-shell-pwa`, `manifestTransforms` (solo el shell), `includeManifestIcons:false`, dos reglas `runtimeCaching` autocontenidas. `registerType:'prompt'`, `injectRegister:false`, `navigateFallbackDenylist` de `/medios` y el manifest no cambian. |
| `src/config/paginasCliente.js` | Con **Save-Data o 2G** no se precargan en reposo las 8 pestañas del portal (~330 kB de JS). Con conexión normal sigue igual. |
| `AvisoActualizacionPWA.jsx`, `trabajoPendiente.js`, `main.jsx` | **Sin cambios** (hashes idénticos). |

## 4. Pruebas

`scripts/verificar-fase8.cjs` → `verificacion-fase8.json`: **13/13** correctos (Chromium; A, B y «antes»/«después» servidos en puertos locales; Supabase Local):

1. Mapa de Inicio: 0 peticiones a Google al abrir (control: el build anterior sí las hace); un desplazamiento corto no lo carga.
2. Se activa al llegar a la sección; el iframe conserva `loading`, `referrerpolicy` y `src`.
3. Con Save-Data: no carga al llegar; carga solo con «Ver mapa»; «Cómo llegar» sigue presente sin cargar nada.
4. Nosotros: nada al abrir (el mapa vive en la pestaña «Contacto»); se activa al llegar.
5. Sin dirección: marcador sin iframe ni peticiones.
6. Hero oscuro 390×2: se piden solo los WebP de 960 px (no el JPG de 1680), prioridad `high`/`low` correcta.
7. Hero claro y escritorio 1440: variantes adecuadas (960 y 1680) y ahorro > 4× a 390.
8. Precarga de pestañas: normal ≥ 6 pestañas, Save-Data 0.
9. Google Fonts: `renderBlockingStatus` **blocking → non-blocking**; Outfit ausente; las familias usadas se siguen cargando.
10. Precaché: ≤ 40 entradas, < 1 MB, sin POS/escáner/maquetas/íconos, con `index.html`, entrada, CSS y la ruta de aterrizaje; control: el anterior sí precacheaba el escáner.
11. PWA: instala, tercera visita desde el SW, Inicio arranca sin conexión, `assets-por-uso` se llena, **ninguna** respuesta de Supabase en cachés ni por el SW.
12. **Actualización A→B con venta en curso** (administración, Ventas, un producto en el carrito): «Actualizar» aparece **deshabilitado** con el aviso de trabajo pendiente, sigue siendo A, el carrito se conserva; al quitar el producto se habilita y actualiza a B; tras actualizar no hay datos de Supabase en cachés.
13. Actualización A→B sin trabajo pendiente: «Actualizar» disponible de inmediato.

Además:
- **Equivalencia visual** (`comparar-visual-fase8.cjs`, `evidencia-fase8/visual/`): hero y mapa, oscuro/claro, 390/1440, movimiento reducido; SSIM 0,985–1,000 y PSNR 42,9–∞ dB en el hero; en el mapa, SSIM 0,995–0,998 salvo claro-escritorio donde Google dibujó otro nivel de zoom del mapa embebido (SSIM 0,845): el diseño de la página es idéntico y la diferencia es contenido de terceros que depende del tamaño del iframe al crearse.
- **Regresión de la Fase 5** (`verificar-fase5.cjs` contra el build nuevo): **32/32**, base con los mismos conteos (4.749 / 429 / 3.067 / 25.860).
- `oxlint` sin diagnósticos en los archivos modificados y scripts; `node --check` correcto.
- Build de GitHub Pages (`/PosJaise/`): compila y genera el mismo precaché de 33 entradas (no se publicó ni probó en navegador).
- **Error propio detectado por la prueba:** mis primeras reglas `runtimeCaching` usaban una variable del `vite.config.js` (`base`); Workbox serializa las funciones tal cual dentro de `sw.js`, así que en el SW la variable no existía y la regla nunca cachéaba. El caso 11 lo detectó (`assets-por-uso` vacío) y se corrigió con funciones autocontenidas (`grep` de `base}` en `sw.js` = 0).

## 5. Video

Solo política y contrato: `.codex/POLITICA-VIDEO-FASE8.md`. No existe función de video en la app; no se creó ningún módulo, tabla, ruta ni cuenta, y no se contrató ningún servicio.

## 6. Límites y decisiones abiertas

- Cifras de laboratorio sobre loopback, sin estrangulamiento ni dispositivo real, no Lighthouse; los bytes de Google dependen de Internet y de Google. Solo Chromium; no se probó Firefox, Safari (donde no existe `navigator.connection`, se usa solo `IntersectionObserver`), móvil físico, staging ni producción. No se ejecutó la actualización contra el alias real de Pages (el arnés existente apunta a staging remoto).
- **Decisión de producto abierta:** una ruta nunca visitada no abre sin conexión (§2). Si se quisiera, se puede añadir Login al shell (≈ pocos kB) o un mensaje específico de «sin conexión».
- **Decisión abierta:** con conexión normal el portal sigue precargando 8 pestañas en reposo (~330 kB de JS, prioridad baja, después del hero). Quitarlo ahorraría esos bytes a costa del salto de navegación que esa precarga evita.
- El suelo del shell es el chunk de entrada (371 kB) + CSS global (185 kB) + Supabase (203 kB); reducirlo exige dividir código, fuera de esta fase.
- **Hallazgo adicional sin tocar:** `public/diseñosPropios/*.html` (maquetas, ≈640 kB) se publican en el sitio aunque ya no se precachean; convendría moverlas fuera de `public/` (decisión del usuario sobre sus archivos de diseño).
- La fuente local Heavitas (122 kB) sigue cargándose en Inicio; el resto de familias de Google Fonts mantiene sus pesos porque no se midió su uso por pesos.
- El caché por uso puede retener chunks de versiones antiguas hasta 30 días/160 entradas; no afecta a la frescura de los datos (Supabase nunca se cachea).
- Rollback: `.codex/evidencia-fase8/rollback-fase8.md` (copias byte a byte + SHA-256 + parche). Nada de esto está aplicado a producción.
