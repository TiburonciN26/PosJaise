# Entrega 10B · candidato y validación en staging

Fecha: 2026-10-13, America/Lima. Claude implementa y despliega; Codex hace la QA. Autorización del usuario: lanzamiento de la 10B condicionado a los controles críticos, con **D11-A** («Las deudas con abonos se consultan y cobran únicamente en la versión nueva»).

**Estado:** el candidato está validado en staging. **No se tocó producción:** ni la base, ni Pages producción, ni GitHub Pages, ni Auth. Esta entrega pide a Codex revisar los puntos críticos antes del paso 4.

## 1. Candidato

| Elemento | Valor |
| --- | --- |
| Rama | `feat/cloudflare-pages`. `main` (`0dc629e`) es ancestro, así que el merge es fast-forward. |
| Commit del producto | **`05b7be34`**. Los commits posteriores (`169c998`, `b308b1f`) solo añaden scripts de QA y del lanzamiento: `git diff 05b7be3 HEAD` sobre `src public index.html vite.config.js cloudflare functions package*.json supabase/migrations` está **vacío**. |
| Inicio/CSS recientes | Incluidos. Última edición a las 11:42, estable desde entonces y anterior al build. |
| SHA-256 por archivo | `evidencia-fase10b/candidato-sha256.txt`: los 152 archivos comprometidos en `3f80526…05b7be3`. |
| Fuera del candidato | `_ver.cjs`, un ayudante de análisis de la Fase 5, y `.codex/`, que nunca se ha versionado. |
| Revisión de secretos | Sobre la lista explícita: sin JWT, claves `sb_`, URLs de base con contraseña ni llaves de Culqi. Las direcciones de prueba que parecían reales se cambiaron a `.invalid`. El repositorio es **público**. |
| Build y lint | `build:cloudflare` y `build` correctos. Lint: 0 errores y 66 avisos, ninguno en los scripts de 10A/10B. |
| Migración nueva | `20261013000001_deudas_compatibilidad_convivencia.sql`, el borrador V3 aprobado por Codex con cabecera de migración y `begin/commit`. Aplicada y verificada en Local: 20/20. |

## 2. Validación en staging (Preview `43d3eeb4.pos-jaise.pages.dev`, marca `05b7be34`)

| Control | Resultado | Evidencia |
| --- | --- | --- |
| Migraciones | Staging ya tenía `20261010000001`, así que el plan V3, que decía «no consta», estaba equivocado; tenía 0 deudas. Se aplicaron `20261011000001…20261012000003` y `20261013000001` con `aplicar-migraciones-staging.mjs`. | salida en este informe |
| RLS por rol (`20261012000001`) | Foto de lectura por rol (anon, admin, cajera y clienta) sobre 55 relaciones antes y después: **0 cambios** en las existentes. Las únicas diferencias son las 2 vistas nuevas, `security_invoker`. Límite: staging tiene pocos datos; la equivalencia fuerte sigue siendo la de Local en la Fase 7. | `rls-staging-antes/despues.json` |
| Identidad del build | Meta `build-id` = `05b7be34`. Al recorrer los 143 módulos, el único backend es el de staging. Sin `pk_` de Culqi, sin Local y sin `service_role`. | — |
| Login, rutas directas, recarga y cierre de sesión | 38 rutas, 0 problemas, tráfico solo a staging | `preview-staging-05b7be34.json` |
| **Permisos por rol** | **14/14**: visitante, clienta, cajera y admin × 46 rutas, más menú y cierre de sesión. Usa un modo staging propio: proxy por contexto, build-id y backend exactos antes de cualquier credencial, y la guarda de Local intacta. La asistente no tiene cuenta en staging; está cubierta en Local (19/19). | `roles-staging-05b7be34.json` |
| **Mecanismo de deudas (SQL)** | **20/20** en staging con el mecanismo instalado: casos S1–S9 como la administradora QA con RLS, dentro de un ROLLBACK; staging intacto. | `compat-deudas-staging.json` |
| **Deudas con los dos frontends** | **8/8**. `main`, compilado contra staging, muestra S/100 en una deuda con un abono de S/30; su «Cobrado» se **rechaza**, avisa del error y el registro de pagos no cambia. Sin pagos previos, `main` cobra y la base registra el importe visible. La UI nueva propone y cobra el saldo de S/70. 0 incoherentes y limpieza por id. | `deudas-dos-frontends-staging.json` |
| **Venta y anulación** | Cajera: venta con Yape (`confirmar_venta`) y anulación en Historial; el stock vuelve. | `flujos-esenciales-staging.json` (10/10) |
| **Carrito y pedido** | Clienta: agregar, quitar y volver a agregar; pedido con recojo, Yape y captura generada (`confirmar_pedido_productos`), y cancelación en «Mis pedidos». Stock igual al inicial. | ídem |
| **Citas** | Reserva con una asistente de prueba (fila en `asistentes`, sin cuenta) y cancelación. | ídem |
| Perfil de la clienta QA | Estaba incompleto, y el servidor lo exigía correctamente para pedidos y citas. Se completó por la UI («Mi perfil → Editar → Guardar»); queda como dato QA de staging. | ídem |
| **Medios** | **23/23**: fotos nuevas, reemplazo y borrado de producto, servicio y galería por el Worker y R2, más la lectura por la Function `/medios`. Estado final idéntico al inicial. | `interfaz-r2-05b7be34/` |
| **PWA A→B con trabajo pendiente** | A = `05b7be34`, B = `169c9985` en el alias de la rama. Aviso visible; «Actualizar» bloqueado mientras había una venta en la caja; la venta no se perdió. Al vaciarla se actualizó exactamente a B, con la sesión conservada. SW distinto entre A y B, `/medios` sin el fallback, 0 errores. | `pwa-a05b7be34-b169c9985-venta.json` |
| **Reversión a `main` sobre la base migrada** | `main`, compilado contra staging: venta y anulación **4/4** y deudas (arriba). | `reversion-main-venta-staging.json` |
| Atomicidad del par de deudas | La transacción 06 que genera `aplicar-lote-10b.ps1`, ejecutada en Local desde un estado previo emulado (sin `deuda_pagos` ni compatibilidad): 6 COBRADAS → 6 pagos de relleno, 2 triggers, 0 incoherentes y 2 versiones. ROLLBACK con Local intacto. | `ensayo-par-deudas-local.*`, `lote-produccion/` |

**Observación:** en una corrida, la reserva de cita, ejecutada justo después del flujo de carrito, agotó la espera de navegación tras «Reservar ahora». Sola pasó 5/5 y la corrida completa siguiente pasó 10/10. Queda como intermitencia de la prueba, sin reproducción.

**Datos QA que quedan en staging:** dos ventas anuladas y un pedido cancelado, ya con su stock devuelto; el perfil de la clienta QA; y capturas `TEST-QA-F10B-*-NO-PAGO.png` en su Storage.

## 3. Plan de producción (paso 4, tras la aprobación de Codex)

**Medios:** en producción **no** se configuran `VITE_MEDIOS_*`. El frontend nuevo sube a Supabase Storage igual que `main` (`lib/medios.js`: proveedor por defecto `supabase`). No se escriben referencias `r2:`. No hace falta Worker ni bucket de producción, ni hay gasto nuevo. La migración de medios queda para después del lanzamiento.

**Culqi:** sin `VITE_CULQI_PUBLIC_KEY` en producción. El carrito no ofrece tarjeta y muestra «Por ahora no aceptamos tarjetas de crédito ni débito».

Orden:
1. **Respaldo** de producción según `docs/lanzamiento/PROCEDIMIENTO-RESPALDO-PRODUCCION.md` (lo ejecuta el usuario).
2. **Inventario de solo lectura** (`inventario-produccion-10b.ps1`, lo ejecuta el usuario). **Hoy no se sabe qué migraciones tiene producción**: el lanzamiento anterior de 23 migraciones consta como preparado, no como aplicado.
3. **Lote** (`aplicar-lote-10b.ps1`, lo ejecuta el usuario tras «APLICAR»):
   - las pendientes desde `20261009000001`, cada una en una transacción con su versión;
   - el par de deudas en una sola transacción;
   - se detiene si falta el lanzamiento anterior o hay huecos.

   Verificación posterior de solo lectura.
4. **Auth** (panel de Supabase, usuario): añadir `https://pos-jaise.pages.dev` a las Redirect URLs. La Site URL se cambia en el momento del cambio, conservando github.io en la lista.
5. **Git:**
   - un commit de lanzamiento cambia `deploy-pages.yml` a solo `workflow_dispatch`, para que GitHub Pages **conserve el build antiguo**;
   - después, merge fast-forward a `main` y push.
6. **Pages producción** (panel o token, usuario):
   - variables de Production: `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` del negocio; `RAMA_PRODUCCION=main` ya existe;
   - desplegar `main`. `build-cloudflare.mjs` rechaza el build si producción no apunta al negocio.
7. **Verificación del deployment exacto:**
   - build-id y backend del bundle;
   - login de solo lectura con una cuenta del personal autorizada;
   - rutas y cabeceras;
   - `/medios` sin uso.

   Las escrituras de prueba en producción no forman parte del plan sin autorización expresa.

**Reversión:**
- **Frontend:** GitHub Pages sigue sirviendo `main` sin cambios y el personal vuelve a él. Pages producción puede desactivarse.
- **Base:** las migraciones son aditivas y compatibles con `main` (probado en staging: ventas y deudas). La compatibilidad de deudas se queda. **No revertir `20261010000001` si hay abonos.**
- **Medios:** no hay referencias `r2:` en producción, así que `main` lee todas las fotos.

## 4. Bloqueos y decisiones para el usuario (antes del paso 4)

1. **Acceso a producción:** el MCP de Supabase está desconectado y no hay credenciales de producción en la máquina. El inventario, el respaldo y el lote los ejecuta el usuario con los scripts, como en el lanzamiento anterior.
2. **Cloudflare:** wrangler no está autenticado. Para las variables de Production y el despliegue hace falta:
   - (a) que el usuario las configure en el panel y lance el despliegue de `main`; o
   - (b) un `wrangler login` del usuario en esta máquina y un token de Pages para las variables, guardado fuera de Git.
3. **Ventana y comunicación:** cambio fuera del horario; nuevo inicio de sesión e instalación de la PWA en cada caja; regla D11-A para el personal.

## 5. Lista posterior al lanzamiento

| Prio. | Pendiente | Criterio de cierre | Validación |
| --- | --- | --- | --- |
| P1 | Retirada de github.io (build de redirección y retiro de las PWA antiguas, O2 del plan público) | Diseño que conserve el trabajo abierto, ensayado con una PWA instalada | Ensayo en un repositorio de prueba y revisión de Codex |
| P1 | Convivencia D11-A mientras exista github.io | Ninguna deuda incoherente; ningún uso de Deudas con abonos en `main` | Consulta de incoherentes semanal y al retirar `main` |
| P1 | CLS de Inicio con sesión de clienta (0,33) | Espacio reservado; CLS ≤ 0,1 en laboratorio y campo | Medición V3 uniforme y datos de campo |
| P2 | 18 presupuestos de laboratorio incumplidos (D12) | **Siguen incumplidos**: ni resueltos ni con excepción permanente | Mediciones V3 y de campo con criterio por escenario |
| P2 | Medios de producción: R2, Worker y Function; migración de referencias con plazo (O1 ACL `service_role`, O2 reloj, O3 timeouts) | Lectores compatibles publicados y periodo de reversión acordado | Autorización de gasto y ensayo en staging |
| P2 | Culqi (llaves 401) | Cuenta validada y sandbox con conciliación | Pruebas sin cobros reales |
| P2 | Recolector destructivo | **Sin automatizar** hasta validar su operación | Revisión aparte |
| P3 | Dominio propio | Compra (gasto aparte) y segundo cambio de origen ensayado | Plan público §1 |
| P3 | Móvil físico, Firefox y Safari; cuenta ASISTENTE QA en staging | Recorridos manuales guiados | Con el usuario |
| P3 | Registro `FASES-RENDIMIENTO-CLOUDFLARE.md` desactualizado (filas 8, 9 y 10A) | Conciliado con los informes originales | Su responsable |
| P3 | `verificar-roles-staging.cjs` duplica la guarda que ya está en `lib/guarda-staging.cjs` | Refactor, con la matriz de staging repetida | 14/14 |

## 6. Archivos nuevos o cambiados en esta entrega

- **Commits** (`feat/cloudflare-pages`, publicados): `3f80526`, `0708144`, `c4fe40d`, `05b7be3`, `169c998` y `b308b1f`.
- **Scripts nuevos:** `scripts/fase10b/` (psql de staging sin exponer la conexión, foto RLS, verificación de deudas instalada, roles en staging, flujos esenciales, deudas con los dos frontends y la guarda compartida) y `docs/lanzamiento/aplicar-produccion/{inventario-produccion-10b,aplicar-lote-10b}.ps1`.
- **Evidencia:** `.codex/evidencia-fase10b/`.
