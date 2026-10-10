# Plan: ronda PWA entre builds con la entrega Pages `/medios`

Estado: **PLAN LOCAL PARA REVISIÓN DE CODEX. Nada se ha publicado ni ejecutado con publicación.** Origen: `.codex/REVISION-PAGES-9BB1330.md` (puntos 1–5). Solo staging; sin tocar `main`, producción ni GitHub Pages.

## 1. Versión inicial A y qué ya está comprobado sin publicar
- **A = commit `9bb1330`**, marca `9bb13306`, deployment `a68f02d7-3f45-43de-b494-f27d0c7a9d76` (`https://a68f02d7.pos-jaise.pages.dev`), alias `https://feat-cloudflare-pages.pos-jaise.pages.dev`, SW SHA-256 `8018435f8d905900582e119857e3e5bae8e70ce62a74239aabd16d4d92bf9071` (Codex). Entrega Pages `/medios` efectiva en ambos (binding `MEDIOS` y variables solo en Preview).
- **Verificador ampliado** (`scripts/verificar-actualizacion-pwa-online.cjs`, sin cambios en la aplicación): opción `--entrega=pages|r2dev`. **Antes de abrir el navegador, enviar credenciales o publicar B**, ejecuta el mismo preflight de los verificadores de medios (`G.preflight`: marca + configuración efectiva del bundle servido por rol) y registra el SW SHA-256 de A. Negativos comprobados hoy contra el alias real, todos con salida 1 y sin navegador: `--entrega=r2dev` (el alias sirve Pages), entrega inválida y marca de A equivocada.
- **Ensayo del lado A, sin publicar B** (`--espera-min=0`, login QA de solo lectura en staging): preflight de entrega OK; marca A exacta; SW controlando; sesión ADMIN real; y las comprobaciones de `/medios` bajo el SW de A (ver §3) pasan. Se detiene en «no apareció el aviso», como debe cuando no hay B, sin publicar nada.
- Se corrigió además que el script terminara con código 127 (assert de libuv de Node en Windows al llamar `process.exit` con conexiones de `fetch` abiertas): ahora usa `process.exitCode` y los abortos de preflight salen con 1.

## 2. Transiciones propuestas y qué agrupa cada commit
| Ronda | Estado de trabajo | A → B | Qué comprueba |
|---|---|---|---|
| 1 | `venta` (producto en el carrito, sin cobrar) | `9bb13306` → marca del **commit B1** | Aviso de versión nueva; la pestaña sigue en A hasta aceptar; «Actualizar» **deshabilitado** con su mensaje; pulsar no recarga; el carrito operativo no se pierde; al vaciarlo se habilita; tras «Actualizar» marca B exacta y sesión real |
| 2 | `vacio` (sin trabajo pendiente) | marca B1 → marca del **commit B2** | «Actualizar» habilitado de inmediato sin mensaje de bloqueo; tras pulsarlo, marca B2 y sesión real |

- **Commit B1** (publica B para la ronda 1): esta ampliación del verificador PWA, este plan, runbook §25 y el informe de clon limpio de `9bb1330`. **Documentación y scripts útiles; sin cambios de aplicación.**
- **Commit B2** (publica B para la ronda 2): el informe JSON de la ronda 1 (`.codex/evidencia-pwa-pages/` se conserva allí; en el repo solo una síntesis en el runbook §25) y la corrección del conteo si procede.
- **La ronda 2 no se archiva con un tercer commit**: su resultado queda en `.codex/` y en el runbook local, y se agrupa con el siguiente cambio revisado (sin push solo para archivar).
- Cada commit se valida antes de publicar con `probar-clon-limpio.mjs --commit --medios` (checkout exacto) y la marca esperada de B se calcula del hash del commit local (8 primeros caracteres) **antes** de ejecutar la ronda; el propio verificador hace el `git push` (`--publicar-cmd="git push origin feat/cloudflare-pages"`), solo si A pasó todos sus controles.

## 3. Qué se verifica en cada versión (A y B), sin escribir nada
1. **Marca y entrega efectivas** (preflight por rol) antes de autenticar; después de «Actualizar», el mismo preflight con la marca B y el SW SHA-256 de B, que **debe ser distinto** del de A (identidades exactas registradas en el informe).
2. **Aviso y permanencia en A:** «Hay una versión nueva de la app.» y marca A hasta aceptar.
3. **Bloqueo según trabajo pendiente:** `venta` (carrito operativo real) frente a `vacio`. La clave `qa-clave-ficticia-pwa` de `localStorage` se conserva y **no se presenta como borrador operativo**.
4. **Sesión protegida real después de B:** usuario propio (`/auth/v1/user`) y su fila en `usuarios`.
5. **`/medios` y el SW** (solo con `--entrega=pages`, en una pestaña auxiliar controlada por el SW, con GET sin escritura): objeto ficticio inexistente, `/medios/` y `/medios` devuelven 404 `no-store` con `nosniff`/`noindex` del texto «No encontrado» de la Function y **nunca la SPA**; la **navegación** a `/medios/` no recibe el fallback del SW; `/medios-extra` sigue siendo la SPA (la exclusión no es por prefijo).
6. **Red y aislamiento:** cero respuestas HTTP ≥ 400 del mismo origen en la pestaña principal (los 404 esperados de `/medios` se hacen en la auxiliar para no contaminar), cero `requestfailed`, cero `pageerror`, cero peticiones bloqueadas (otro backend, Supabase local, pasarelas) y tráfico Supabase solo al staging aprobado.

## 4. Autorizaciones y alcance de escritura
- **Pedida al usuario:** (a) commits B1 y B2 y sus dos pushes a `feat/cloudflare-pages` (cada push reconstruye el alias, con marca y SW nuevos); (b) login QA de solo lectura a staging en cada ronda. **Ninguna escritura de datos**: sin objetos R2, sin filas, sin cobrar la venta; el carrito es solo estado de la pestaña.
- **No incluido y no asumido:** comprobar *imágenes reales* servidas por `/medios` durante la ronda exigiría subir objetos ficticios y/o crear filas QA; si se quiere, es una extensión aparte que necesita su propia autorización específica. La permisión de las corridas 27/27 y 23/23 **no** la cubre.
- No se toca producción, `main`, GitHub Pages, la configuración de Preview ni cuentas QA.

## 5. Evidencia, fallos y rollback
- **Informes** de cada ronda con `--salida` en una carpeta nueva bajo `.codex/evidencia-pwa-pages/` (un JSON por ronda, con marcas A/B, SW SHA-256, pasos y tráfico). Una ronda fallida **conserva su evidencia** y se detiene sin publicar más; no se hacen commits adicionales para perseguirla.
- **Si A falla** (marca, entrega, SW sin controlar, sesión, `/medios`): aborta **sin publicar B**. **Si B no llega o no se acepta:** el informe registra el diagnóstico (SW, índice servido, waiting/installing) y queda pendiente.
- **Rollback:** `git revert` de B1/B2 y push a la misma rama (reconstruye el alias); no hay datos que revertir. Configuración de Preview y Function sin cambios.

## 5b. Precisiones de Codex incorporadas (`REVISION-PLAN-PWA-PAGES-MEDIOS.md`)
- Usar siempre `--entrega=pages` y `--permitir-origen=feat-cloudflare-pages.pos-jaise.pages.dev`; `--salida` de este verificador es **un archivo JSON** (la carpeta `.codex/evidencia-pwa-pages/` se crea antes y cada ronda usa un nombre distinto).
- «Sin errores» se acota a los observadores de la pestaña principal (request/response/requestfailed/pageerror) y a las aserciones de la auxiliar; no es una captura de todos los eventos de la auxiliar ni de los workers. El hash del SW es el de `sw.js` por GET; el controlador se verifica por presencia. La comprobación de B se registra por separado: marca del documento cargado y configuración/hash del alias remoto.
- Los JSON y capturas de las rondas permanecen en `.codex`, no en los commits. La rama de argumentos inválidos sigue saliendo con 2.

## 6. Límites declarados
Chromium; una sola cuenta ADMIN; el carrito en memoria es el trabajo operativo; `atras`, `ventana` y `dos-dialogos` quedan fuera de esta serie (cubiertos en O1 sobre builds anteriores); no se mide CPU/cuota ni actualización en dispositivos móviles reales. La aprobación de esta ronda no cerraría la Fase 3 ni autorizaría producción.
