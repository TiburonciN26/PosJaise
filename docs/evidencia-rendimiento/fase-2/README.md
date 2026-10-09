# Fase 2 · Cloudflare Pages en preview — ESTADO VIGENTE

**Veredicto de Codex: APROBADA CON OBSERVACIONES para el preview de staging** (`.codex/VERIFICACION-FORMAL-FASE-2.md`). Fase 1 aprobada previamente por Codex (el registro `.codex/FASES-RENDIMIENTO-CLOUDFLARE.md` la enlaza como `VERIFICACION-FASE-1.md`; ese archivo no está en la carpeta `.codex` de este árbol, por lo que no pude comprobar su contenido).

- **Publicado (QA, ficticio):** `https://preview.pos-jaise-preview.pages.dev` (deployment `91c40d00…`), proyecto Direct Upload `pos-jaise-preview`, backend `pos-jaise-staging`. Es un entorno QA que se conserva; **no** autoriza publicar el POS real, retirar GitHub Pages, borrar/rotar recursos ni iniciar R2.
- **Pendientes que siguen abiertos:** (O1) actualización PWA entre dos versiones **online** (preparado: `dist-preview-a`/`dist-preview-b`; ensayo local de 6 escenarios OK en `verificador-pwa-escenarios.json`; la prueba online requiere publicar B bajo el mismo alias); (O2) caché HTML `max-age=0, must-revalidate` (sin bloqueo; revisar en el hosting definitivo y en rutas profundas); pagos/callbacks, correos reales, rendimiento vs GitHub Pages, móvil físico, CSP; cuentas QA sin rotar (a la espera de autorización).
- **Siguiente paso preparado para revisión (sin ejecutar):** `FASE-2B-PAGES-GIT.md` **v3.2** (preparación aprobada por Codex para rama y preview QA; repo PÚBLICO y GitHub Pages activo hasta validar el hosting definitivo) — v3.1 (3.ª revisión de Codex: aprobada con observaciones; P2 del diálogo oculto corregido y probado con Atrás/regreso, cierre y dos diálogos) — corregido tras `.codex/VERIFICACION-PREPARACION-FASE-2B.md` (B1–B5) y `.codex/VERIFICACION-FASE-2B-V2.md` (B1/B2 cerradas; B3–B5 preparadas: imagen del login versionada de forma acotada, verificador con preflight y aborto antes de publicar, protección de «Actualizar», clon limpio idéntico, listado regenerado): clasificación estricta de claves y backend por entorno (`salvaguardas-entornos.json`, 43 casos), verificador online con IDs exactos A/B, hallazgo de pérdida del carrito POS al actualizar, y listado de commit (`COMMIT-PROPUESTO.md`) con un bloqueo de clon limpio (`foto-login.jpeg` ignorado por Git).
- **Informe externo de Fase 1 (Codex):** `C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/fase1-verificacion/VERIFICACION-FASE-1.md`. Mediciones de Claude (94,0–98,7 %) y de Codex (91,3–96,5 %) son distintas; ver README de la Fase 1.
- **Rollback de código preciso (O3):** ver «Rollback de código» al final; sustituye al texto de rollback del apartado histórico.

---
# HISTÓRICO — Fase 2: preparación previa a la publicación (estado al inicio, 2026-10-09)
> Lo que sigue describe el estado ANTES de crear y publicar el preview; frases como «Pages no está creado» o «no hay nada publicado» ya no son vigentes. Se conserva como registro.


Fecha: 2026-10-09. **Estado: build y routing verificados en local; el proyecto Pages y la URL de preview NO están creados** (ver «Qué falta»). GitHub Pages y el dominio público no se tocaron; no hay cambios de DNS, datos, migraciones ni R2.

## Inventario
- Base actual (GitHub Pages): `/PosJaise/` en `vite.config.js`; `BrowserRouter basename={BASE_URL}`; todos los recursos del código usan `import.meta.env.BASE_URL` (verificado por grep: no hay `/PosJaise/` en `src/`); manifest/scope/íconos salen de la misma `base`.
- `public/404.html` + script en `index.html` = truco SPA de GitHub Pages. En la raíz de Pages **su presencia desactiva el fallback de SPA** (comprobado en el servidor de simulación: con `404.html` → `/ventas` da 404; sin él → 200).
- Auth: no hay `redirectTo`/`emailRedirectTo`/OAuth en `src/`; la sesión vive en `localStorage` (clave `sb-…-auth-token`, por origen). Edge Functions `crear-cargo` y `webhook-pasarela`: CORS `*`, URLs de Supabase, no dependen del origen del frontend.
- Workflow `deploy-pages.yml` (GitHub) sin cambios.

## Cambios
| Archivo | Cambio |
|---|---|
| `vite.config.js` | `base` toma `VITE_BASE_PATH` (por defecto `/PosJaise/`); si es `/` excluye `404.html` del precache de Workbox. **Build por defecto idéntico byte a byte** al de la config anterior (comparado con `git show HEAD:vite.config.js`). |
| `scripts/build-cloudflare.mjs` + `npm run build:cloudflare` | build con `VITE_BASE_PATH=/`, borra `dist/404.html`, copia `_headers`, y falla si queda `/PosJaise/` en index/manifest o `404.html` en `sw.js`. |
| `cloudflare/_headers` | `/assets/*` y `workbox-*.js` inmutables 1 año; `index.html`, `sw.js`, `registerSW.js`, `manifest.webmanifest` `no-cache`; `nosniff` + `Referrer-Policy`. Sin CSP (Google Fonts/Maps/Culqi; se define aparte). Sin «Cache Everything». |
| `.node-version` | `22` (igual que el CI de GitHub). |
| `scripts/servir-dist-base.cjs` (3.er arg base), `scripts/verificar-pages-fase2.cjs` | herramientas de verificación local. |

## Verificación local (Supabase Local verificado; cuentas QA temporales borradas)
`verificar-pages-fase2.cjs` visita por **URL directa + recarga** 48 rutas con el mismo script contra el build de GitHub (`/PosJaise/`) y el de Cloudflare (`/`): 27 rutas POS (ADMIN), 4 con CAJERA (incluye 2 solo-admin → redirigen a `/ventas` igual en ambos), 10 públicas (incluye ruta inexistente → `/inicio`), 7 de cliente.
- **0 diferencias de comportamiento entre ambos builds**, 0 respuestas ≥ 400 del mismo origen, 0 errores de página, todas con contenido.
- PWA en raíz: manifest `start_url`/`scope` = `/`; 4 íconos 200; SW registrado con scope `/`, controla tras recargar; al cambiar `sw.js` aparece «Hay una versión nueva de la app.» (aviso de actualización conservado).
- JSON crudos: `github.json`, `cloudflare.json`. `npm run build` (GitHub) OK; lint = línea base (2 errores de fixtures + 44 advertencias).

## Qué falta para la URL de preview (requiere decisión/credenciales del usuario)
La conexión MCP de Cloudflare disponible solo permite leer/gestionar Workers, R2, KV, D1; **no crea ni despliega proyectos de Pages**, y no hay `wrangler` ni token en este equipo. Además hay que decidir contra qué Supabase se conecta un preview público (el plan prohíbe apuntarlo a datos reales o a `127.0.0.1`): ¿existe un proyecto de staging?
Pasos (dashboard o `wrangler`):
1. Pages → Create project → conectar el repo (o Direct Upload: `CLOUDFLARE_ACCOUNT_ID=… npx wrangler pages deploy dist --project-name=<nombre>` tras `npm run build:cloudflare`).
2. Build command `npm run build:cloudflare`, output `dist`, Node 22 (lo toma `.node-version`).
3. Variables: en **Preview** `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` del staging; **no** poner las de producción hasta decidirlo. (`VITE_CULQI_PUBLIC_KEY` si aplica: llave de pruebas.)
4. No añadir dominio personalizado ni cambiar la rama de producción en esta fase.
5. En Supabase staging → Auth → URL configuration: añadir el origen `https://<proyecto>.pages.dev` (Site URL/Redirect URLs; hoy el código no usa redirectTo, pero los correos de confirmación usan Site URL). Revisar si Culqi exige registrar el dominio.

## Transición de usuarios (origen distinto)
Sesión, `localStorage` (carrito, borradores, tema) y service worker no se transfieren de `*.github.io` a `*.pages.dev`: habrá nuevo login y se pierden carrito/borradores locales.

## Rollback
No hay nada publicado que revertir. Para quitar el código: `git revert` de los cambios arriba (o borrar `cloudflare/`, `.node-version`, `scripts/build-cloudflare.mjs`, el script npm y las 5 líneas de `vite.config.js`); GitHub Pages sigue intacto porque su build no cambió. Si luego existe el proyecto Pages: borrar el proyecto/deployment en Cloudflare.

---
# Entrega formal de la Fase 2 (2026-10-09) — lista para revisión de Codex

## Estado publicado (por Codex, vía dashboard con sesión del usuario; ver `.codex/PAGES-PUBLICADO-PARA-CLAUDE.md`)
- Proyecto Pages `pos-jaise-preview` (Direct Upload), alias de rama **https://preview.pos-jaise-preview.pages.dev**, deployment inmutable **https://91c40d00.pos-jaise-preview.pages.dev** (ID `91c40d00-3813-4aa6-8430-98b304269845`). Existe además un primer deployment en `main` del mismo proyecto de pruebas (`c80701b6…`, mismo artefacto) porque el dashboard no ofrecía «Preview» sin un deployment previo. Ninguno toca el dominio del negocio.
- Artefacto: `dist-preview` generado por `scripts/build-preview-staging.mjs` (base `/`, variables de staging incrustadas **al compilar**, sin `404.html`, 178 archivos / 4.713.271 bytes). Backend: solo `https://tqkdtojnhgykmcbvwdmz.supabase.co` (staging, datos ficticios).
- Auth de staging (configurado por Codex con confirmación del usuario): Site URL `https://pos-jaise-preview.pages.dev`; Redirect URLs `https://pos-jaise-preview.pages.dev/**` y `https://*.pos-jaise-preview.pages.dev/**`. Antes: Site URL `http://localhost:3000`, redirects vacíos. Producción no se alteró.

## Evidencia (mi verificación independiente de la de Codex)
- Repetí `scripts/verificar-preview-staging.cjs` contra la URL en línea (`preview-staging-online.json`): login real por formulario ADMIN→/ventas, CAJERA→/ventas, CLIENTE→/inicio; **38 rutas** por URL directa + recarga, **0 problemas, 0 errores**; todo el tráfico a Supabase fue al host de staging.
- Cabeceras observadas (curl): `/sw.js` → `no-cache`; HTML `/` → `public, max-age=0, must-revalidate`; `x-robots-tag: noindex, nofollow`.
- Evidencia de Codex (en `.codex/`): `verificacion-online-root.json`, `verificacion-online-preview.json`, `pwa-headers.json`, `artefacto-verificado.json` (SHA-256 por archivo), capturas.
- Localmente (antes de publicar): paridad GitHub vs Cloudflare en 48 rutas/4 roles, PWA y aviso de actualización (`github.json`, `cloudflare.json`).

## Diferencia reconocida — caché del HTML
`cloudflare/_headers` declara `no-cache` para `/index.html`, pero Pages redirige `/index.html` → `/`, y para `/` no hay regla, así que se aplica el valor por defecto `max-age=0, must-revalidate`. Es equivalente en la práctica (siempre revalida; no sirve contenido caducado) y el shell se actualiza igual. Decisión: **no se parcheó ni se republicó** (el artefacto publicado es el verificado). Si Codex lo exige, la corrección es añadir una regla `/` (y `/index.html`) a `cloudflare/_headers` en una publicación futura (se puede agrupar con la Fase 10).

## Limitaciones explícitas
1. **Pagos:** las Edge Functions `crear-cargo` y `webhook-pasarela` NO están desplegadas en staging; no se hicieron ventas, canjes, comprobantes ni pagos. El preview **no valida cobros** ni callbacks de pasarela. Culqi sigue sin llaves válidas.
2. **Correos QA:** cuentas con dominio ficticio `@staging.test`; no se enviaron correos de confirmación ni recuperación y su entrega efectiva no está probada. El `signUp` público de staging está limitado por el límite de correos (429). Las cuentas se crearon por SQL.
3. **Actualización PWA en línea:** NO probada entre dos bundles distintos (ambos deployments son el mismo artefacto). Solo se probó en local (cambio de `sw.js` → aviso «Hay una versión nueva de la app»). Queda pendiente publicar un segundo build distinto en una fase posterior (p. ej. 10A) para verificarlo online.
4. Sin comparación de rendimiento frente a GitHub Pages, sin hardware móvil físico, sin CSP (decisión explícita), sin dominio propio/DNS.
5. Cambiar de origen implica nuevo login y pérdida de carrito/borradores locales (localStorage y SW por origen).
6. Las contraseñas QA se generaron y aplicaron en esta sesión y quedan en el transcript: **rotación/borrado pendiente de autorización del usuario** (no se hizo). Tampoco se borró ni rotó ningún deployment.

## Rollback
- Pages: eliminar los deployments `91c40d00…` y `c80701b6…` o el proyecto `pos-jaise-preview` en el dashboard (sin dominio ni DNS asociados).
- Supabase staging: restaurar Auth (Site URL `http://localhost:3000`, redirects vacíos) y pausar/eliminar `pos-jaise-staging`; `delete from auth.users where email like 'qa-%@staging.test'` para quitar las cuentas.
- Código: revertir `vite.config.js`, `package.json` (script `build:cloudflare`), `.node-version`, `cloudflare/`, `scripts/build-*.mjs`, `scripts/verificar-*.cjs`; GitHub Pages sigue intacto (su build no cambió, verificado byte a byte).
- Producción y GitHub Pages: sin cambios en ningún momento.

---
## Rollback de código (preciso, no destructivo) — O3
El árbol tiene ~156 entradas sin confirmar de trabajo anterior y **no existe un commit exclusivo de Fase 1/2**. No usar `git reset`, `git clean`, `git checkout -- <archivo>` ni restaurar `package.json`/`vite.config.js`/`index.css` completos: se perderían cambios ajenos. Usar los parches inversos de `docs/evidencia-rendimiento/fase-2/rollback/` (verificados con `git apply -R --check`; contienen solo hunks propios):

| Parche | Revierte | Archivos |
|---|---|---|
| `fase2-tracked.patch` | base configurable, exclusión de `404.html`, marca `VITE_BUILD_ID`, ignore de `dist-preview*` | `vite.config.js`, `.gitignore` |
| `fase2-package-json.patch` | solo la línea `"build:cloudflare"` (no toca la dependencia `supabase` ni lo demás) | `package.json` |
| `fase2b-proteccion-actualizar.patch` | protección de «Actualizar» con trabajo POS pendiente | `src/components/AvisoActualizacionPWA.jsx`, `src/context/CarritoContext.jsx`, `src/hooks/useCerrarConEscape.js` (+ borrar el archivo nuevo `src/lib/trabajoPendiente.js` y quitar `, { trabajoPendiente: false }` de 7 llamadas en `BarraCatalogo`, `MenuUsuario`, `MenuUsuarioCliente`, `SelectorOrden`, `Citas`, `Gastos`) |
| `fase1.patch` | cupones sin animación continua (Fase 1) | `src/index.css` (solo hunks propios, calculados contra la copia `fase-1/antes-fuentes`), `src/components/EnvolturaCupon.jsx`, `tests/e2e/niveles-visuales-helpers.mjs` |

Procedimiento: `git apply -R --check --ignore-whitespace <parche>` y, si no hay errores, `git apply -R --ignore-whitespace <parche>`. Si otra sesión modificó después las mismas líneas, el `--check` fallará y se resuelve a mano (no forzar).

**Archivos NUEVOS de la Fase 2** (se pueden borrar sin afectar nada previo; ninguno existía antes): `.node-version`, `cloudflare/_headers`, `scripts/build-cloudflare.mjs`, `scripts/build-preview-staging.mjs`, `scripts/aplicar-migraciones-staging.mjs`, `scripts/verificar-pages-fase2.cjs`, `scripts/verificar-preview-staging.cjs`, `scripts/verificar-actualizacion-pwa.cjs`, `scripts/verificar-actualizacion-pwa-online.cjs`, `scripts/probar-salvaguardas-entornos.mjs`, `scripts/listar-commit-propuesto.mjs`, `scripts/lib/entornos-supabase.mjs`, `scripts/probar-verificador-pwa.mjs`, `scripts/probar-clon-limpio.mjs`, `src/lib/trabajoPendiente.js`, `docs/evidencia-rendimiento/fase-2/`. `scripts/servir-dist-base.cjs` y `scripts/medir-cupones-reposo.cjs`/`verificar-cupones-fase1.cjs` y `docs/evidencia-rendimiento/fase-1/` pertenecen a la Fase 1 (servir-dist-base se extendió en la 2). Las secciones 44 y 45 de `implementacionesWed.md` se quitan borrando esos bloques por su título. `.env.staging.local` (local, ignorado por git) contiene secretos de staging: no se borra sin tu indicación.

Recursos externos (NO parte del rollback automático; cada uno requiere autorización específica y tiene consecuencias distintas): deployments/proyecto `pos-jaise-preview`, proyecto Supabase `pos-jaise-staging`, Auth de staging y cuentas QA. Se mantienen disponibles para QA.
