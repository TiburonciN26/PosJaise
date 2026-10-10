# Fase 3 · Runbook para validar R2 real (entorno de PRUEBAS ligado a staging)

Estado: **Worker y bucket de PRUEBAS desplegados (§2b); verificación automatizada ejecutada contra ellos.** Queda pendiente todo lo que exige dominio propio, Pages Preview (commit/push), fotos de catálogo, navegadores/móviles y las decisiones del §6. (R2 fue habilitado por el usuario; el error 10042 de antes ya no aplica.) Nada de este documento autoriza por sí mismo a crear recursos, contratar un plan, hacer commit/push, retirar GitHub Pages ni escribir referencias `r2:` en datos del negocio. Cada paso con `⛔ requiere autorización` espera una indicación explícita del usuario.

Cierra los puntos 1–5 de `.codex/VERIFICACION-FASE-3-V5.md` («La aceptación completa de Fase 3 todavía requiere…»).

## 0. Qué se cerró en local y qué falta

| | Estado |
|---|---|
| F3-01 a F3-09 y el cierre de F3-07 (incluida la variante V4) | **Cerrados en LOCAL**, aceptados por Codex (V5): 166/166 pruebas propias repetidas. |
| Worker, bucket, dominio, CORS, caché HIT/MISS, CPU real | **Pendientes** (este runbook). |
| Firefox, Safari/iOS, móvil físico, fotos reales del catálogo | **Pendientes** (§5). |
| Purga de caché al borrar, operación real del recolector, migración inversa | **Pendientes de decisión** (§6). |

## 1. Decisiones y autorizaciones que necesito del usuario (en este orden)

| # | Decisión / acción | Quién | Por qué |
|---|---|---|---|
| 1 | **Habilitar R2** en el dashboard de Cloudflare. ¿Pide medio de pago? Si lo pide, decidir si se contrata. | Usuario | Sin esto no hay bucket. Costos: ver §7 y README §7 (franquicia 10 GB / 1 M clase A / 10 M clase B; egress gratis). |
| 2 | **Dominio de medios** de PRUEBA (p. ej. `media-staging.<dominio-del-usuario>`) y qué zona de Cloudflare lo aloja. Para producción será otro. | Usuario | La guía exige dominio propio para usar la caché de Cloudflare; `r2.dev` solo para desarrollo. |
| 3 | **Hostname del Worker de pruebas** (p. ej. `api-media-staging.<dominio>`) o permitir `workers.dev` solo para pruebas. Hoy `wrangler.toml` tiene `workers_dev = false`. | Usuario | Cómo se publica el endpoint de subida. |
| 4 | **Cómo se despliega el Worker**: sesión `wrangler login` del usuario, token de API acotado (Workers Scripts Edit + R2 Edit, solo esa cuenta) o que lo haga Codex con el panel. El MCP de Cloudflare disponible aquí **no despliega Workers**. | Usuario | Nunca pegar tokens en el chat. |
| 5 | **Commit y push de la Fase 3** a `feat/cloudflare-pages` (hoy sin commit, por instrucción) para que el preview de Pages construya con las variables `VITE_MEDIOS_*`. Recordatorio: el repo es público; el commit contiene código y pruebas, sin secretos. | Usuario | Hoy el preview de Pages no contiene la Fase 3. |
| 6 | **Fotos de muestra del catálogo** (carpeta con 20–30 fotos reales de productos/servicios, en una ruta local indicada por el usuario) para medir peso real. | Usuario | Las 15 combinaciones medidas son fotos de referencia del repo, no del catálogo. |
| 7 | **Dispositivos** disponibles para la prueba manual (Firefox, Safari/iOS, un móvil Android/iOS). | Usuario | §5. |

Reglas que se mantienen: solo staging; el repositorio sigue público; `main`, GitHub Pages, el Supabase del negocio, DNS de producción y las cuentas QA no se tocan; ningún dato real del negocio se sube.

## 2. Recursos que se crearán (solo con las autorizaciones 1–4)

| Recurso | Nombre propuesto | Notas |
|---|---|---|
| Bucket R2 (staging) | `pos-jaise-medios-staging` | Creación por MCP (`r2_bucket_create`) una vez habilitado R2. **Separado** del de producción, que no se crea ahora. |
| Dominio público del bucket | el del punto 2 | «Custom domain» del bucket (proxy de Cloudflare ⇒ caché). Reglas: sin listado público; solo los destinos `fotos-productos`, `fotos-servicios`, `fotos-galeria`. |
| Worker | `pos-jaise-medios-staging` | `cloudflare/medios-worker`. Binding `MEDIOS` → el bucket. |
| Variables del Worker | `SUPABASE_URL` (staging), `ORIGENES_PERMITIDOS` (origen exacto del preview de Pages y, si se prueba, `http://localhost:5173`), `AMBIENTE=staging`, `SERVIR_LECTURA=0` | Todas públicas. |
| Secreto del Worker | `SUPABASE_ANON_KEY` (clave **pública** de staging) | Se carga con `wrangler secret put`; no se guarda en `wrangler.toml` ni en el repo. **No** hay `service_role`, ni credenciales R2/S3, ni tokens. |
| Variables de Pages (solo *Preview*) | `VITE_MEDIOS_PROVEEDOR=r2`, `VITE_MEDIOS_API_URL`, `VITE_MEDIOS_PUBLIC_URL` | *Production* de Pages no se toca. |

Comandos de referencia (los ejecuta quien tenga la sesión; **no** se ejecutan sin autorización):

```bash
cd cloudflare/medios-worker
npx wrangler login                                   # sesión del usuario (no se comparte)
npx wrangler secret put SUPABASE_ANON_KEY            # pega la anon key de STAGING
npx wrangler deploy \
  --var SERVIR_LECTURA:0 \
  --var ORIGENES_PERMITIDOS:https://<alias-del-preview>.pages.dev
# y asociar el hostname del Worker y el dominio del bucket desde el panel (Custom domains)
```

CORS del bucket (solo hace falta si alguna página lee con `fetch` desde otro origen; las `<img>` no lo necesitan): permitir `GET`/`HEAD` desde el origen exacto del preview de Pages y `http://localhost:5173`, sin comodín. La subida pasa por el Worker, que ya resuelve su propio CORS por origen exacto.

## 2b. Estado del despliegue de `pos-jaise-medios-staging` (2026-10-09/10)

**DESPLEGADO (por el panel, con autorización del usuario, ejecutado por Codex; `.codex/WORKER-MEDIOS-STAGING-PUBLICADO.md`).**

| | |
|---|---|
| Bucket (pruebas) | `pos-jaise-medios-staging` (Standard, ENAM), creado por Codex; URL de desarrollo `https://pub-b248edba3e19402382b557a35b33c674.r2.dev` habilitada (`.codex/R2-URL-PRUEBAS-HABILITADA.md`). Sin CORS ni dominio propio. |
| Worker | `pos-jaise-medios-staging` → `https://pos-jaise-medios-staging.jdeostuas2.workers.dev`; versión activa `6d4cd0cc-41da-46a9-8b97-09714339579c`; código = `cloudflare/medios-worker/dist/index.js` (15 530 bytes, SHA-256 `A960C31C…FE86084`, comparado por Codex con el paquete local). Binding `MEDIOS` → el bucket; variables `AMBIENTE=staging`, `SUPABASE_URL` (staging), `ORIGENES_PERMITIDOS` (localhost:5173 + preview de Pages), `SERVIR_LECTURA=0`; secreto `SUPABASE_ANON_KEY` (clave pública de staging). |
| Sin cambiar | Wrangler sigue sin sesión (no se usó `wrangler login`); Pages, DNS, GitHub Pages, `main`, Supabase del negocio y cuentas QA intactos. El panel llama «Production» a la instancia activa de este Worker: es el servicio de **staging**, no el backend del negocio. |
| Pendiente | Variables *Preview* de Pages (`VITE_MEDIOS_*`), que esperan al commit/push no autorizado. Valores previstos: `VITE_MEDIOS_PROVEEDOR=r2`, `VITE_MEDIOS_API_URL=https://pos-jaise-medios-staging.jdeostuas2.workers.dev`, `VITE_MEDIOS_PUBLIC_URL=https://pub-b248edba3e19402382b557a35b33c674.r2.dev`. |

### Resultados de la verificación contra el entorno REAL de pruebas (Claude, tras «continua»)

`scripts/verificar-r2-real-fase3.mjs` — informes en `r2-real/solo-lectura-…json` (**8/8**, repite lo de Codex) y `r2-real/con-escritura-…json` (**30/30**, 0 fallos). Con escritura sube 4 fotos de referencia del repo (no del catálogo), prueba roles y archivos inválidos, mide y **borra solo lo que creó** (inventario final vacío; DELETE 200 y lectura pública posterior 404 en las 4).

| Comprobación | Resultado en R2/Worker reales |
|---|---|
| Sin sesión / origen ajeno / destino privado | 401 / 403 / 400; preflight del origen de Pages con origen exacto, sin comodín |
| Cajera, cliente | 403 (Auth + `es_admin` reales contra staging) |
| VP8X sin píxeles, PNG como WebP, HTML, truncado | 415; exceso de bytes 413; vacío 400 |
| Subida m/g | 201 ×2 por foto; reintento idéntico 200 `reanudado`; contenido distinto 409 |
| Entrega desde r2.dev | 200, `image/webp` y `cache-control: public, max-age=31536000, immutable` en **m y g**; contenido **idéntico byte a byte** a lo subido (comparación del cuerpo completo y SHA-256 de ambas variantes, 4 fotos × 2; corregido tras la revisión de Codex: la versión anterior solo comparaba la longitud y se rotulaba «bytes idénticos»); mediana ≈ 135–155 ms por lectura (desde esta máquina, no garantía de latencia) |
| Peso (4 fotos de referencia) | detalle 8,3–22,2 KiB; miniatura 3,8–9,3 KiB: dentro de los objetivos. **Fotos de catálogo reales: sin medir.** |
| Borrado | La URL pública responde 404 de inmediato (sin caché delante en r2.dev) |

**Hallazgos de `r2.dev` (esperables, a resolver con dominio propio):** (1) **no hay CDN**: no devuelve `cf-cache-status`, así que **HIT/MISS sigue sin poder validarse**; (2) **no envía `X-Content-Type-Options: nosniff`** (el Worker no sirve las imágenes en producción): hay que añadirlo en el dominio propio con una *Transform Rule* de cabecera de respuesta antes de producción; el verificador lo exigirá cuando el dominio público no sea `r2.dev`; (3) la purga de caché tras borrar no se pudo evaluar por lo mismo. **Observación de Codex a favor:** el panel mostraba 11 invocaciones, CPU 783 µs y 0 errores en las primeras solicitudes; eso no es CPU de procesamiento de fotos: tras esta corrida hay que leer *Metrics → CPU time p50/p99* del Worker (la subida de 4 fotos ×2 variantes + rechazos es la carga real a mirar).

## 3. Verificación automatizada (la ejecuta Claude y la repite Codex)

El script `scripts/verificar-r2-real-fase3.mjs` ya está probado contra el Worker local (8 casos solo-lectura; 30 con escritura; informe de humo en `r2-real/humo-local/`). Contra R2 real:

```bash
# A) sin escribir nada (puede ejecutarse en cuanto el Worker esté desplegado)
node scripts/verificar-r2-real-fase3.mjs --api=https://<worker> --publico=https://<dominio-medios> \
     --origen-pages=https://<alias-preview>.pages.dev --env-file=.env.staging.local

# B) con escritura — SOLO tras autorización del usuario; con fotos reales del catálogo
node scripts/verificar-r2-real-fase3.mjs <mismas opciones> --escribir --fotos-dir="<carpeta de muestra>" --repeticiones=8
```

Qué comprueba y cómo se mapea a V5:

| V5 | Prueba | Criterio de aceptación |
|---|---|---|
| 1 (subidas, autenticación/autorización, rechazo de archivos, lectura desde Pages) | A1–A8, B1–B3 | Sin sesión 401; cajera/cliente 403; destino privado 400; VP8X sin píxeles, PNG falso, HTML, truncado → 415; exceso → 413; vacío → 400; origen ajeno 403. |
| 1 | B4–B5 | Subida m/g = 201; reintento idéntico = 200 `reanudado`; contenido distinto = 409. |
| 2 (dominio, CORS, HIT/MISS) | A4–A5, B6 | Preflight con origen exacto (sin `*`); entrega 200, `image/webp`, `immutable`, `nosniff`, bytes idénticos; **se registra** `cf-cache-status` en N lecturas seguidas (no se exige HIT en todas; investigar si TODAS son MISS). |
| 3 (peso) | tabla `fotos` del informe | Miniatura ≤ 80 KiB y detalle ≤ 250 KiB con fotos del catálogo; los que no cumplan se listan con su causa. |
| 4 (purga) | `cacheTrasBorrado` | Registra si tras `DELETE` la URL pública sigue sirviendo desde la caché (insumo para §6). |
| — | B7–B8 | Inventario del Worker lista lo subido; el script **solo borra lo que creó**. |

No mide (indicado en el informe): **CPU del Worker** → panel *Workers y Pages → Worker → Metrics → CPU time (p50/p99) y Errors* durante la corrida (Free: 10 ms/petición; si p99 se acerca, medir antes de producción o pasar al plan de pago); **costo** → panel *R2 → Metrics* (operaciones A/B, almacenamiento).

## 4. Verificación con la interfaz real (preview de Pages, cuenta QA ADMIN de staging)

Requiere el punto 5 (commit/push) y las variables *Preview*. Con una foto nueva por cada flujo, comprobar y anotar con capturas:

1. Producto (web): foto principal nueva + galería; ver listado, detalle, carrito y POS (la miniatura `m` en tarjetas; `g` en detalle).
2. Servicio: igual. Galería antes/después: alta, reemplazo, eliminación.
3. Foto antigua de Supabase sigue visible; comprobantes siguen privados (URL pública conocida no los revela).
4. Reemplazo y eliminación: la anterior desaparece solo tras confirmar el guardado.
5. Abrir las herramientas de red: ninguna petición lleva credenciales R2, ni `service_role`, ni secretos; el tráfico de datos va solo a staging.

## 5. Navegadores y móviles (manual)

Firefox (escritorio), Safari (macOS) y Safari/iOS, y un Android/iOS físico: abrir el preview, iniciar sesión QA, subir una foto a Producto y a Galería, comprobar (a) que el navegador **codifica WebP** (`canvas.toBlob`) — si no, la subida cae a Supabase con una advertencia en consola, no a R2; (b) que las fotos nuevas y antiguas se ven; (c) que el bloqueo del formulario durante un guardado pendiente se comporta igual. Registrar versión/dispositivo y resultado. Hoy solo Chromium está probado.

## 6. Decisiones abiertas antes de cualquier uso con datos del negocio

1. **Purga de caché al eliminar.** Opciones: aceptar que la copia persista hasta expirar (medios públicos, no sensibles) o purgar por URL con un token «Cache Purge» como secreto del Worker. Decidir con el resultado de `cacheTrasBorrado`.
2. **Recolector de huérfanos.** Solo modo informativo. Antes de habilitar `--aplicar` hace falta una precondición operativa verificable (catálogo sin ediciones en la ventana) o una coordinación del servidor (cuarentena/bloqueo); la retención se calcula desde la fecha de subida, no desde la última referencia.
3. **Migración inversa / rollback que lea `r2:`.** Hasta tener un build de retorno que lea `r2:` (o un script validado que las convierta a Supabase), **no se escriben referencias `r2:` en datos del negocio y no se retira GitHub Pages**.

## 7. Costos y límites a vigilar durante la prueba

R2 Standard: $0,015/GB-mes; Clase A $4,50/M; Clase B $0,36/M; franquicia mensual 10 GB / 1 M / 10 M; egress gratis (fuente: documentación oficial de R2, confirmada por Codex). Workers Free: 100 000 peticiones/día y 10 ms de CPU por petición. Para esta prueba el volumen es de decenas de objetos: costo esperado ≈ 0, pero se confirma en el panel. Si el dashboard exige un plan/medio de pago para habilitar R2, **se detiene y se pregunta**: no se presupone autorización para contratar.

## 8. Condiciones de parada y rollback de la prueba

- **Parar** si: aparece cualquier cargo inesperado, el Worker responde con errores 5xx sostenidos, se detecta una credencial en el bundle o en la red, o cualquier prueba escribe fuera de staging.
- **Deshacer** (sin tocar datos del negocio): borrar los objetos de prueba (el script ya lo hace); eliminar el Worker y el bucket de staging desde el panel; quitar las tres variables `VITE_MEDIOS_*` de *Preview* de Pages y reconstruir; revocar el token de API si se creó. Las fotos de Supabase y el negocio no se modifican en ningún paso.

## 9. Entrega a Codex al terminar

Informes JSON de `r2-real/` (solo-lectura y con-escritura), capturas del §4, tabla de navegadores del §5, lecturas del panel (CPU p50/p99, errores, operaciones A/B), pesos del catálogo y las decisiones de §6. Codex repite el script y las comprobaciones de interfaz por su cuenta.

## 10. Revisión de Codex (REVISION-R2-REAL-Y-COMMIT-FASE-3) y su efecto

- **CPU real observada por Codex** (Metrics, 24 h, todas las versiones): P50 1,15 ms · P90 1,83 ms · P99 2,39 ms; por debajo del límite Free de 10 ms. Agregado de configuración, autorizaciones y pruebas, **no** medición exclusiva de PUT ni de fotos grandes ni de carga sostenida: sigue pendiente.
- **Bucket tras las pruebas:** vacío (0 B) según el panel. Contadores vistos: 43 operaciones clase A y 127 clase B (observados, no una factura).
- **R2-R2 (corregido):** el caso B6 del verificador compara ahora el contenido completo (y SHA-256) de las variantes m y g; la evidencia se regeneró.
- **R2-R1 (corregido):** el parche de rollback se regeneró incluyendo `.gitignore` con la línea `cloudflare/medios-worker/dist/`; el comando completo `git apply -R --check` pasa. Una vez hecho el commit de la fase, el rollback es `git revert <commit>`; el parche queda como referencia por archivo.

## 11. Commit de la Fase 3 y Preview de Pages (2026-10-10)

- **Commit `ba07a32` en `feat/cloudflare-pages`** (autorizado por el usuario; solo esa rama): 39 archivos = los 38 candidatos de Codex + `scripts/probar-clon-limpio.mjs` (ahora con `--medios`). `main` (`0dc629e`) sin cambios; `origin/testing` en `ce21b89` según las referencias remotas locales (sin fetch) y la rama `testing` **local** en `0dc629e`; el workflow de GitHub Pages solo se dispara con push a `main`.
- **Validación del commit exacto** (checkout limpio, `npm ci`, `build:cloudflare` con staging y las tres variables R2): build correcto, 179 archivos, sin `404.html`; sin ref del negocio, Supabase local, `sb_secret_`/`service_role` ni credenciales R2/S3. Diferencia con el árbol de trabajo: solo 2 reglas CSS que Tailwind genera al escanear informes sin versionar de `.codex/`; el checkout limpio es la referencia (`clon-limpio-commit.json`).
- **Preview (HISTÓRICO, antes de configurar las variables; el estado vigente está en el §12):** build de Pages para `ba07a32` correcto; alias con `build-id ba07a32a`; **sin variables `VITE_MEDIOS_*` todavía** (el bundle no contiene las URLs de R2; las subidas siguen en Supabase). Las variables solo de *Preview* las configura Codex (traspaso en `.codex/PAGES-PREVIEW-VARIABLES-PARA-CODEX.md`); después se requiere un build nuevo.
- Correcciones de la revisión de Codex: R2-R1 (parche con `.gitignore`, `git apply -R --check` completo OK) y R2-R2 (B6 compara contenido y SHA-256 de m y g). Tras el commit, el rollback de la fase es `git revert ba07a32` (sin escribir antes referencias `r2:` en el negocio).

## 12. Prueba de interfaz sobre el Preview de Pages (2026-10-10)

Contexto: Codex guardó las tres variables `VITE_MEDIOS_*` solo en *Preview* y reconstruyó (Retry deployment, sin push) el commit `ba07a32` → deployment `9d206972…` (`.codex/PAGES-PREVIEW-R2-CONFIGURADO.md`); Production sin cambios. Claude ejecutó `scripts/verificar-interfaz-r2-preview.cjs` contra el alias canónico `https://feat-cloudflare-pages.pos-jaise.pages.dev` con contexto de navegador nuevo (para no usar el bundle anterior, que tenía el mismo `build-id ba07a32a`).

**Resultado: 21/21** (`interfaz-preview/resultados.json`; capturas en la misma carpeta). Datos QA ficticios de staging; los registros se retocaron **por la propia interfaz** y, tras la corrida, se comprobó en solo lectura (Codex) que producto y servicio quedaron con `foto_url = null`, 0 filas en sus galerías, 0 objetos en los tres inventarios y las 2 filas de `galeria_web` de partida. **No hubo snapshot previo de todos los campos**, así que no se acredita igualdad completa de los registros frente a su estado original; esa comparación existe solo en la versión corregida del script (§13).

| Flujo (modales REALES) | Verificado por canales independientes |
|---|---|
| Producto *Agua San Luis 625ml*: foto principal + galería → reemplazo de la principal → quitar ambas (**el reemplazo de principal se ejercitó en Producto y en Galería, no en Servicio**) | BD (REST con token QA): `foto_url` `r2:` → nueva → `null`; filas de galería 1 → 0. Worker: 4 PUT (m/g ×2), inventario +2 grupos y vuelta al inicio; r2.dev: 4 variantes 200 `image/webp`; tras guardar la anterior ya no existe (las aserciones miran el estado final; no prueban el orden temporal «borrar solo después de guardar», que cubren las pruebas de modales). |
| Servicio *Corte de cabello*: principal + galería → quitar ambas | Igual; además **portal CLIENTE**: el listado carga la foto nueva desde r2.dev (tarjeta en `m`, portada en `g`) y el detalle muestra la foto de la galería en `g`; todo decodifica. |
| Galería antes/después: alta con 2 fotos → reemplazo de «antes» → eliminar | URLs del dominio público de pruebas en la fila; lista del administrador con miniaturas de r2.dev; objeto anterior eliminado tras guardar; al eliminar desaparecen la fila y los dos objetos. |
| Compatibilidad | La fila antigua de la galería (ruta relativa de `/public`) sigue resolviéndose. En staging no existían fotos antiguas de Supabase Storage (0 con foto), así que esa ruta quedó cubierta por las pruebas de modales y de la capa de medios. |
| Aislamiento | En la página ADMIN, las peticiones a Supabase fueron a staging y no hubo ninguna al negocio ni a Supabase local; **0 subidas/borrados a Supabase Storage** (todo por el Worker); 0 errores de página. **El contexto CLIENTE no tenía listener de peticiones** en esta versión del script (corregido en §13). |

Observaciones de diseño (no son defectos): con galería, el carrusel del detalle muestra solo las fotos de la galería y no duplica la principal; la portada del listado usa la variante `g` por su tamaño.

**No cubierto:** actualización PWA entre builds (los dos builds de `ba07a32` comparten `build-id` pero difieren en el service worker; la prueba interactiva O1 no se repitió), fotos de catálogo reales, Firefox/Safari/móvil físico, carga/concurrencia, dominio propio/CDN/`nosniff`, purga, recolector destructivo y migración inversa. Sin tocar: pagos, ventas, cuentas QA, la fila residual de staging, `main`, producción y GitHub Pages.

## 13. Revisión de Codex de la interfaz (REVISION-INTERFAZ-PREVIEW-R2) y correcciones del script

Veredicto de Codex: la evidencia 21/21 se acepta dentro de su cobertura; el script requería dos correcciones P2 en sus salvaguardas (no son fallos de la aplicación y no reabren F3-07).

- **IP-R1 (corregido):** antes de autenticar o escribir, `preflight()` exige alias = origen aprobado **exacto** (sin ruta/query/credenciales, HTTPS), Supabase = `https://<ref staging>.supabase.co` exacto (ya no `includes(ref)`), clave pública clasificada con `clasificarClave`, cuentas del dominio QA ficticio y `--build-id` obligatorio contrastado con el `meta build-id` del artefacto servido; una discrepancia **aborta antes del login**. Las peticiones a destinos no aprobados (otro Supabase, negocio, local, pasarelas, otro Worker/bucket/Preview) se **abortan en ADMIN y en CLIENTE** y los `fetch` del propio script usan lista cerrada de orígenes; cualquier bloqueo hace fallar la corrida.
- **IP-R2 (corregido):** precondición de fixtures (sin foto ni galería, lecturas estrictas) y snapshot de fotos, galerías, `galeria_web` e **inventario por claves completas** antes de escribir; marca **única por ejecución** en el título de Galería y limpieza de emergencia que borra solo la fila propia por `id` (y los objetos que esa fila referencia en el dominio aprobado); nunca por título compartido ni con lecturas fallidas; la comparación final es por igualdad de snapshot y diferencia de claves, no por cardinalidad. «Después» de Galería se compara con su URL anterior.
- **Regresiones sin red:** `scripts/verificar-guardas-interfaz-r2.cjs` (41 casos, todos OK tras IP-R1b/IP-R2b; `fetch` y rutas de Playwright son dobles que cuentan llamadas, salvo la prueba de redirección, que usa dos servidores HTTP efímeros locales): alias ajeno o con ruta/query/HTTP/host engañoso, Supabase ajeno con el ref en el query, negocio o local, cuenta ajena, clave `service_role`/vacía, sin `--build-id`, artefacto con otra marca o sin marca (cero login y cero red), tráfico prohibido del contexto CLIENTE, `fetch` del script, fotos/galerías previas, fila antigua con el mismo título, lectura fallida, cambio concurrente de inventario con la misma cardinalidad y snapshot.
- **Reejecución real de la versión corregida (staging, alias `ba07a32a`): NO completa.** Producto y Servicio pasaron (13 casos OK); en la sección de Galería el bloqueo nuevo detuvo la corrida porque la página ADMIN pidió `http://127.0.0.1:8789` — la **fila residual** `5bb670df…` («QA fase 3 (borrar)») guarda URLs del Worker local de pruebas anteriores, y su miniatura intenta salir a localhost. Es exactamente lo que la guarda debe impedir. La limpieza de emergencia retiró solo lo de esta ejecución (la fila de Galería creada y sus 2 grupos de objetos, borrados por el Worker); se comprobó en solo lectura que el inventario quedó en 0 y que la fila residual sigue intacta. `interfaz-preview/resultados.json` conserva la corrida 21/21 de la **versión anterior** del script.
- **Para cerrar la reejecución** hace falta una decisión del usuario sobre la fila residual (borrarla o dejarla inactiva sin URLs locales); sin ella la prueba de Galería con las guardas nuevas no puede completarse.

## 14. Segunda revisión de Codex (REVISION-INTERFAZ-PREVIEW-R2-V2) y correcciones

Codex repitió las 31 regresiones (sin fallos) y reprodujo dos variantes más; ambas corregidas:

- **IP-R1b (redirecciones):** `crearFetchSeguro` ya no sigue redirecciones: impone `redirect: 'error'` **después** del spread de opciones, por lo que el llamador no puede anularlo (cubre también el GET del preflight). Regresión con dos servidores HTTP locales: un 307 de un origen aprobado hacia uno no aprobado se rechaza con **cero peticiones** al segundo origen (POST con cabecera y cuerpo ficticios; `redirect: 'follow'` del llamador también se rechaza).
- **IP-R2b (orden de la limpieza):** `limpiarFilaPropia` borra primero la **fila** y la **confirma por relectura** (un DELETE de PostgREST puede responder 2xx sin borrar por RLS, y una respuesta perdida es incierta); solo si ya no existe elimina los objetos que referenciaba. Ante DELETE rechazado (403/500), sin efecto (204 con RLS) o relectura caída, los objetos se **conservan** y se informa el pendiente; si la fila se borró pero el Worker falla, el objeto queda como pendiente. Los contadores son solo de resultados confirmados. Regresiones: 403, 500, 204 sin efecto, respuesta perdida con y sin commit, lectura caída, Worker 500; ninguna fila queda apuntando a objetos borrados y ninguna otra fila se toca.
- **Paginación del inventario:** el Worker lista hasta 500 objetos y devuelve `cursor`; `leerInventario` ahora **rechaza** un `cursor` presente en vez de declarar un snapshot incompleto como completo (regresión incluida).
- **Informe por corrida:** cada ejecución (también la que falla a mitad) escribe `interfaz-preview/corridas/corrida-<id>.json` con versión, marca, error, limpieza confirmada y bloqueos; `resultados.json` queda como evidencia **histórica de la versión anterior** del script.
- **Alcance de las listas:** la del `fetch` del script es cerrada; la del navegador solo prohíbe las familias sensibles (otros Supabase, local, pasarelas, otros Worker/bucket/Preview) y deja pasar terceros como fuentes. Playwright advierte que el routing puede no aplicarse a Service Workers; Codex comprobó que en este Chromium sí se bloqueó, y no se bloquean SW aquí (la corrida valida la PWA solo en lo que ya se probó).
- **Contraseña de BD de staging:** rotada por el usuario tras el incidente de impresión en el transcript (sin valores en el repositorio ni en este documento).
- **Pendiente:** retirar la fila residual `5bb670df…` (requiere autorización explícita del usuario), repetir el recorrido real con evidencia de corrida separada, revisión de Codex y validación del commit exacto desde checkout limpio antes del push a `feat/cloudflare-pages`.

## 15. Revisión V3 de Codex, fila residual retirada y recorrido real completo (2026-10-10)

- **Codex V3:** IP-R1, IP-R2, IP-R1b e IP-R2b cerrados en la revisión local (41/41 repetidas; `oxlint` de los tres scripts sin diagnósticos; `npm run lint` global sigue con 2 errores previos en `tests/e2e/fixtures.mjs` y advertencias de evidencia antigua: «lint limpio» describe solo los scripts de esta entrega). Precisión: fallos anteriores al `try` del recorrido (preflight, login, snapshot inicial, arranque del navegador) no generan JSON de corrida; abortan antes de escribir nada.
- **Fila residual retirada con autorización explícita del usuario:** `galeria_web` `5bb670df-db45-4c70-a6aa-40b856fbf8a6` («QA fase 3 (borrar)», `activo=false`, URLs `http://127.0.0.1:8789/…`), solo en el Supabase de **staging**. Antes de borrar se confirmó el proyecto (`tqkdtojnhgykmcbvwdmz`), el id y el contenido; borrado por id exacto (DELETE 204) y relectura: queda únicamente «Foto de prueba (Inicio)» (`4ab5c994…`). Sin tocar producción ni otras filas.
- **Recorrido real completo con la versión corregida: 22/22, 0 fallos** (alias `https://feat-cloudflare-pages.pos-jaise.pages.dev`, marca `ba07a32a`; informe `interfaz-preview/corridas/corrida-652b14.json`, distinto del `resultados.json` histórico de la versión anterior). Cubre preflight antes del login, precondición y snapshot, Producto (alta, reemplazo, quitar), Servicio (alta, vista CLIENTE, quitar), Galería (alta, reemplazo de «antes» conservando «después», eliminar), compatibilidad con la fila antigua, tráfico de ADMIN **y** CLIENTE sin destinos no aprobados, 0 operaciones de Supabase Storage y **estado final idéntico al snapshot inicial con las mismas claves de inventario**. No se activó la limpieza de emergencia.
- **Límites que se mantienen:** el reemplazo de principal se ejercitó en Producto y Galería (no en Servicio); Chromium únicamente; sin fotos reales de catálogo, Firefox/Safari/móvil, carga, CDN/`nosniff`, purga, recolector destructivo ni migración inversa; sin repetir la prueba PWA entre builds.

## 16. Actualización PWA entre builds reales (Pages Preview, staging)

- **Ronda `venta`: OK (24 pasos; `vacio`: 19).** Alias `https://feat-cloudflare-pages.pos-jaise.pages.dev`, A=`c1693734` → B=`31787852` (commit `3178785`, publicado con `git push` solo a `feat/cloudflare-pages` por el propio verificador). Informe: `pwa-entre-builds-venta.json`.
- Comprobado: A exacta antes de publicar, SW controlando, sesión ADMIN real de staging; con una venta en el carrito el aviso «Hay una versión nueva de la app.» aparece, la pestaña sigue en A, «Actualizar» queda deshabilitado con su mensaje, pulsar no recarga y el carrito no se pierde; al vaciar se habilita; tras «Actualizar» el documento es B exacta, con sesión, sin HTTP ≥ 400, sin `requestfailed`/`pageerror` y con tráfico solo al Supabase de staging.
- **Límites:** este recorrido no escribe datos ni cobra; Chromium únicamente; la clave de localStorage es ficticia (no prueba borradores operativos). La ronda `vacio` se registra aparte cuando termine.
- **Ronda `vacio`: OK.** A=`31787852` → B=`e2293968` (commit `e229396`, publicado por el verificador solo a `feat/cloudflare-pages`). Informe: `pwa-entre-builds-vacio.json`. Con la caja vacía el aviso aparece, la pestaña sigue en A, «Actualizar» está habilitado sin mensaje de bloqueo, y tras pulsarlo el documento es B exacta, con sesión, 0 errores HTTP/`requestfailed`/`pageerror` y tráfico solo al Supabase de staging. Mismos límites (Chromium, sin escritura de datos, clave de localStorage ficticia). Quedan sin cubrir los estados `ventana`, `atras` y `dos-dialogos` de esta serie (cubiertos en O1 sobre builds anteriores).

## 17. Reemplazo de la foto principal de Servicio (cierra ese hueco)

- El verificador añade el caso «SERVICIO: reemplazo de la foto principal» (nueva existe, anterior borrada, galería intacta). Recorrido real sobre el alias con marca `e2293968`: **23 casos, 0 fallos** (informe `interfaz-preview/corridas/corrida-b6bb1f.json`; capturas `*-b6bb1f.png`; 41/41 regresiones y `oxlint` del script limpios). Estado final idéntico al snapshot e inventario del Worker con las mismas claves. Solo staging; sin tocar `main`, producción ni GitHub Pages.
- Mismo alcance de siempre: Chromium, fotos de referencia, la aserción observa el estado final (no el orden temporal). El script modificado queda sin commit hasta revisión de Codex.
- **Codex (revisión del servicio) — IP-S1 (P2):** la aserción del reemplazo solo comparaba `galS.length === 1` y el número de grupos, por lo que un cambio de referencia, etiqueta, orden o id de la galería habría pasado. **Corregido:** se conserva la galería previa, se compara con `galeriaConservada` (filas `id/foto_url/etiqueta/orden` iguales y variantes `m` y `g` de cada referencia presentes por clave completa en el inventario) y hay una regresión nueva con negativos (otra referencia, etiqueta, orden, id, galería vacía, falta `m` o `g`): **42/42**, `oxlint` limpio. Corrida real con la condición corregida sobre `e2293968`: **23 casos, 0 fallos** (`corridas/corrida-f8a486.json`, capturas `*-f8a486.png`). `corrida-b6bb1f.json` queda como histórico de la aserción anterior (válido para el reemplazo de la principal, no para «galería intacta»).
