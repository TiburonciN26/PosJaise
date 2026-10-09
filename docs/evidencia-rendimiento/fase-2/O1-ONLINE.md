# O1 online + primer preview Git de Cloudflare Pages (`pos-jaise`) — entrega para revisión de Codex

Fecha: 2026-10-09. Proyecto Pages `pos-jaise` (Git, repo `TiburonciN26/PosJaise` público), creado y configurado por Codex con la sesión del usuario (`.codex/PAGES-GIT-CREADO-PARA-CLAUDE.md`). **Backend: solo el Supabase de staging con cuentas QA ficticias. No se tocó `main`, GitHub Pages, producción ni R2; no se borró ni rotó nada.**

## Qué hice
1. Comprobé que `main` seguía en `0dc629e` y empujé un commit vacío a `feat/cloudflare-pages` (solo esa rama) para iniciar el primer preview (el push anterior a la creación del proyecto no había producido build).
2. Observé el build por GitHub (check «Cloudflare Pages»): **éxito** en el primer intento, Node 22 (`.node-version`), sin reintentos. Commit A = `f436e09e…` → deployment `6fa484d0-0a73-4313-a345-2451969566b6`.
3. Verifiqué A y luego ejecuté O1 en tres rondas con **dos commits reales por ronda empujados a la misma rama** bajo el mismo alias.

## URLs
- Alias de rama (el que usan las pruebas): `https://feat-cloudflare-pages.pos-jaise.pages.dev`
- Deployment inmutable de A: `https://6fa484d0.pos-jaise.pages.dev`
- Panel: `https://dash.cloudflare.com/af5ea2cb3f504970fe293b1923cd64d7/pages/view/pos-jaise`
- `pos-jaise.pages.dev` (producción) **no sirve un build**: el único intento de `main` falló por diseño (no existe `build:cloudflare` en `main`) y la producción automática está desactivada.

## Verificación de A (commit `f436e09e`)
- Marca del documento `f436e09e` (= 8 primeros caracteres del commit); HTML `200` con `Cache-Control: public, max-age=0, must-revalidate`, `x-robots-tag: noindex`; `sw.js` `no-cache`; ruta profunda `/ventas` `200`.
- **Contenido del build** (138 archivos JS del precache descargados y revisados): el ref del Supabase de **staging** aparece en el chunk de supabase; el ref del **negocio**, `127.0.0.1:54321`, `sb_secret_` y claves privilegiadas: **0 coincidencias**; sin llave de Culqi (el método Tarjeta no se ofrece, según `src/lib/culqi.js`).
- `verificar-preview-staging.cjs` contra el alias (`preview-git-A-rutas.json`): login real por formulario ADMIN→`/ventas`, CAJERA→`/ventas`, CLIENTE→`/inicio`; **38 rutas** por URL directa + recarga, **0 problemas, 0 errores**; todo el tráfico a Supabase fue solo a `tqkdtojnhgykmcbvwdmz.supabase.co`.

## O1 online (tres rondas, todas OK)
| Ronda | Estado probado | A → B (marcas exactas) | Resultado |
|---|---|---|---|
| 1 | `venta` (producto en el carrito) | `f436e09e` → `fb938add` | OK — `pwa-online-ronda1-venta.json` |
| 2 | `atras` (diálogo de Ventas oculto por «Atrás») | `fb938add` → `74e00c1d` | OK — `pwa-online-ronda2-atras.json` |
| 3 | `vacio` (sin trabajo pendiente) | `74e00c1d` → `1cd03d62` | OK — `pwa-online-ronda3-vacio.json` |
| neg. | A con marca incorrecta | esperada `marca-incorrecta`, observada `1cd03d62` | FALLA como debe; aborta **antes** de publicar (`publicadoB=false`, el comando de publicación no se ejecutó) — `pwa-online-negativo-A-incorrecta.json` |

En cada ronda el verificador: validó antes del login el Supabase de staging, la cuenta `@staging.test` y el origen; comprobó A exacta, SW controlando y sesión autenticada real (usuario propio + su fila `usuarios`); publicó B con `git push` a `feat/cloudflare-pages`; esperó el aviso «Hay una versión nueva de la app.» (Cloudflare construyó y desplegó B bajo el mismo alias); verificó que la pestaña seguía en A **exacta** sin actualización silenciosa; comprobó el bloqueo de «Actualizar» con trabajo pendiente (venta / diálogo oculto) o su disponibilidad inmediata (caja vacía), el carrito sin pérdida mientras estuvo bloqueado y la habilitación automática al terminar; tras «Actualizar» comprobó la marca **B exacta**, sesión autenticada, 0 errores HTTP, 0 `requestfailed`, 0 `pageerror`, 0 peticiones bloqueadas (otro backend, Supabase local o pasarela) y tráfico solo a staging. Commits reales de A/B de las rondas: ver `o1-registro.md` y el historial de la rama.

## Observaciones y límites (no los oculto)
- **Node:** Cloudflare usó Node `22.16.0`; `@zxing/library` declara `>=24` y `npm ci` emitió `EBADENGINE` (advertencia, no error); el build compiló y el escáner no se probó en esta fase. Valorar fijar Node 24 en `.node-version` antes del hosting definitivo.
- Es **evidencia mía (preliminar)**: falta la verificación independiente de Codex. Los scripts son los mismos que ya revisó Codex.
- Siguen sin validar: pagos/callbacks (sin llave de Culqi y sin Edge Functions en staging), correos reales de Auth, CSP, móvil físico y rendimiento frente a GitHub Pages. Los formularios embebidos que no son diálogos no registran trabajo pendiente.
- Los builds de Cloudflare (LF) no coinciden byte a byte con builds locales de Windows (CRLF) solo por fin de línea; la comparación válida es contra un checkout del mismo commit.
- El repo es público: todo lo empujado a la rama es visible; `main` no se actualizó.
- Cuentas QA de staging sin rotar ni borrar (el usuario lo dejó para después). `pos-jaise-preview` (Direct Upload) se conserva.

## Rollback
- Pages: pausar/eliminar el proyecto `pos-jaise` o sus deployments en el dashboard, o quitar la rama `feat/cloudflare-pages` del control de previews. Nada de esto afecta a GitHub Pages ni a la web en uso.
- Git: la rama `feat/cloudflare-pages` se puede borrar del remoto sin tocar `main`; los parches de `rollback/` revierten por archivo.
- Producción: no hay nada que revertir (no se publicó).

## Pendiente (siguiente etapa, con autorización del usuario)
Revisión de Codex de esta entrega; cambio definitivo (variables de producción solo con backend del negocio aprobado, dominio, DNS, transición de usuarios); retiro de GitHub Pages después de validarlo; limpieza de cuentas QA; R2/Fase 3.
