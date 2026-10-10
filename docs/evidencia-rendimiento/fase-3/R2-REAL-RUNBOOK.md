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

## 18. Dominio propio: futuro y opcional (aclaración de Codex, `R2-SIN-DOMINIO-PROPIO-Y-B0A83A2`)

- **Comprar un dominio NO es requisito para subir ni almacenar fotos en R2**: las subidas de staging ya funcionan sin él. Las menciones anteriores de este runbook a «dominio propio» (§1, §2, §3, hallazgos de `r2.dev`) describen la opción escogida en su momento para la **entrega pública con caché**, no una condición para avanzar. La compra del dominio es una decisión futura del usuario; hasta entonces se separa «dominio propio (opcional/futuro)» de «entrega de medios apta para el negocio (por implementar y verificar en la opción que se elija)».
- **Estado:** el preview sube por el Worker de staging y lee de `r2.dev`, una URL de desarrollo (con límite de solicitudes y sin caché ni controles de dominio propio): **no es la entrega definitiva del negocio**. El Worker mantiene `SERVIR_LECTURA=0` (ruta de lectura solo de desarrollo); cambiar esa variable no equivale a una ruta de producción terminada.
- **Alternativa sin dominio, diseño PENDIENTE (no implementada ni desplegada):** una Pages Function del proyecto `pos-jaise` con *binding* al bucket R2 que sirva `/medios/<destino>/<uuid>/{m,g}.webp` desde el hostname `*.pages.dev`, sin `r2.dev`. Requisitos: subidas/borrados siguen protegidos por sesión y rol; lectura pública solo de los destinos de catálogo; cabeceras `image/webp` y `nosniff`; política de caché con Cache API (alcance por centro de datos, no es tiered cache; hay que **medir** HIT/MISS y el borrado); rutas SPA, assets y service worker sin efectos accidentales; binding de pruebas aislado del negocio y configuración de producción separada. Las URLs ya guardadas deben revisarse al cambiar de entrega (las que guardan URLs absolutas no se actualizan solas).
- **Sigue siendo necesario** antes de activar datos del negocio: pruebas del endpoint elegido, fotos reales, otros navegadores y móvil, carga, purga y migración inversa. Nada de esto aprueba producción.
- **Publicación `b0a83a2`:** Codex verificó el alias (marca `b0a83a2f`, 140 scripts 200, solo staging). El clon limpio de ese commit está en `clon-limpio-b0a83a2.json` (0 diferencias de contenido); `clon-limpio-commit-nuevo.json` describe `c169373`.

## 19. Entrega de medios por Pages Functions: implementación y pruebas LOCALES (sin commit/push ni cambios en Cloudflare)

Autorizado por el usuario solo en local, siguiendo `REVISION-DISENO-MEDIOS-PAGES-FUNCTIONS-V2.md`. **No se cambió `VITE_MEDIOS_PUBLIC_URL`, ni se creó el binding `MEDIOS`, ni se tocó el dashboard.** Mientras no exista el binding, la Function responde 404 y nada del cliente apunta a `/medios`.

**Paquete (archivos nuevos/modificados):**
- `cloudflare/medios-pages/entrega.js` (lógica pura), `functions/medios/[[ruta]].js` y `functions/medios.js` (envoltorios; este último atiende `/medios` sin barra, precisión 1 de Codex).
- `scripts/build-cloudflare.mjs` (genera `dist/_routes.json` = `{version:1, include:["/medios","/medios/*"], exclude:[]}` y falla el build si falta o es otro, o si el SW no excluye `/medios`), `vite.config.js` (`navigateFallbackDenylist: [/^\/medios(?:\/|$)/]` solo con base `/`; el build de GitHub Pages no cambia: 0 coincidencias en su `sw.js`).
- `src/lib/urlsMedios.js` (módulo puro), `src/lib/medios.js`, `src/lib/imagenes.js`.
- Pruebas: `cloudflare/medios-pages/test/probar-entrega.mjs`, `scripts/verificar-urls-medios.mjs`.

**Contrato implementado:** solo GET/HEAD (405 `Allow: GET, HEAD`); ruta exacta `/medios/<3 destinos>/<uuid>/<m|g>.webp`, todo lo demás 404 `no-store`; `nosniff` y `noindex` en TODAS las respuestas; Cache-Control positivo `public, max-age=300` que **sustituye** el `immutable` de un año de R2 en la respuesta y en la copia de Cache API (precisión 2); errores `no-store`, 503 sin detalles si R2 falla, el fallo de la caché no impide servir; `Range` ignorado (200 completo); `ETag` = `httpEtag` y `If-None-Match` (coincidente, débil, lista, `*`) en MISS y HIT; HEAD nunca almacena; `X-Medios-Cache` se recalcula en cada respuesta.

**Cliente (PF-01/PF-02 y precisiones 3–4):** la lista cerrada de bases es `VITE_MEDIOS_PUBLIC_URL` + `VITE_MEDIOS_BASES_RECONOCIDAS` (coma); se valida origen exacto, prefijo, destino, UUID y variante (`m|g.webp`), sin query/hash/credenciales/`%`. `rutaDeUrlGaleria` solo cae a Storage si la URL cuelga del prefijo público de Supabase Storage **de este proyecto**; cualquier otra devuelve `null` (cambio de comportamiento respecto de `indexOf('/<bucket>/')`: una URL de otro proyecto de Supabase ya no se borra desde aquí). `resolverUrlGaleria` no cambia: **leer** sigue funcionando para cualquier URL http(s), **reconocer para borrar** es estricto. `errorDeConfiguracionMedios` exige URL absoluta https (http solo `localhost`/`127.0.0.1`). `convertirBaseUrl` es la conversión acotada para el rollback (la ejecución sobre filas de staging NO se hizo: requeriría escribir en la BD).

**Resultados (todo local, sin red salvo lo indicado):**
| Prueba | Resultado |
|---|---|
| `probar-entrega.mjs` (R2 y Cache simulados con reloj; cuenta lecturas) | **30/30** |
| `verificar-urls-medios.mjs` (módulo puro + `medios.js`/`imagenes.js` reales vía Vite SSR) | **14/14** |
| `verificar-guardas-interfaz-r2.cjs` | 42/42 (sin cambios) |
| `verificar-medios-r2-fase3.cjs` (navegador + Worker local con R2 simulado; Supabase staging solo para autenticar, escrituras simuladas) | **24/24**, sin escrituras a Supabase |
| `build:cloudflare` con variables de Preview + `_routes.json` + SW | OK |
| `wrangler pages dev` sobre esa salida con R2 simulado en disco | `/medios` y `/medios/` → Function (404 con nosniff/noindex); `/ventas`, `/medios-extra`, `/assets/`, `/sw.js` → estático; foto: 200 `image/webp` `max-age=300` ETag, 304 por ETag, HEAD sin cuerpo, Range → 200, POST → 405, sin objeto → 404 |
| `npm run build` (GitHub Pages) | OK; `sw.js` sin cambios de denylist |
| `oxlint` de lo tocado | sin diagnósticos |

**Límites:** el primer GET de la prueba con `wrangler pages dev` salió HIT porque peticiones anteriores (colgadas por un proceso viejo que se limpió) ya habían calentado la caché local; el MISS→HIT está probado de forma determinista en `probar-entrega.mjs`. La Cache API real de Cloudflare (por centro de datos), la cuota de 100.000 solicitudes diarias, el CPU y el comportamiento tras el binding de Preview **no se midieron**. No se ejecutó el recorrido 23/23 con la nueva base ni la ronda PWA con `/medios`. La política TTL definitiva, la purga, el ensayo del rollback sobre filas reales de staging, fotos reales, otros navegadores y carga siguen pendientes.

**Rollback:** nada publicado; revertir los archivos del paquete (`git checkout`/borrar `functions/` y `cloudflare/medios-pages/`).

### 19b. Revisión de Codex de la implementación local (`REVISION-IMPLEMENTACION-MEDIOS-PAGES-FUNCTIONS.md`): PFM-01 y observaciones

- **PFM-01 (P2) — corregido.** `await objeto.arrayBuffer()` estaba fuera del `try/catch`: si `get()` resolvía y el cuerpo fallaba, `manejarMedios` rechazaba la promesa. Ahora un fallo del cuerpo en GET devuelve **503 `no-store` sin detalles** (con `nosniff`/`noindex`), sin escribir en la caché, y el siguiente GET sano vuelve a responder 200 MISS. No se disfraza de 404.
- **HEAD y rendimiento — corregido.** HEAD usa `env.MEDIOS.head()` (solo metadatos; 0 bytes leídos de R2) y, si el binding no la ofreciera, `get()` **sin consumir el cuerpo**; nunca almacena en caché. Un fallo de metadatos → 503 controlado; un cuerpo ilegible no afecta a HEAD.
- **HEAD de error sin cuerpo — corregido.** 404 (objeto, ruta, binding ausente) y 503 salen sin cuerpo ante HEAD, con las mismas cabeceras (`no-store`, `nosniff`, `noindex`); el 405 conserva su `Allow`.
- **Comprobación del SW en el build — endurecida.** `swSalida.includes('medios')` se sustituyó por `swExcluyeMedios` (`scripts/lib/sw-medios.mjs`), que exige la propiedad `denylist` y el patrón exacto `/^\/medios(?:\/|$)/`. Controles negativos probados: la palabra «medios» en el nombre de un asset, un patrón distinto (`/^\/medio/`, `/\/medios/`, `/^\/medios-extra/`), `denylist` vacía y `allowlist`. El `sw.js` del build de Cloudflare cumple; el de GitHub Pages **no** lo contiene (como debe ser).
- **Configuración futura de transición.** No basta cambiar `VITE_MEDIOS_PUBLIC_URL`: para seguir reconociendo y gestionando la Galería antigua hay que definir además `VITE_MEDIOS_BASES_RECONOCIDAS` con las bases de staging aprobadas (p. ej. la `r2.dev` de pruebas), solo en Preview. Ni esa variable, ni el binding `MEDIOS`, ni `VITE_MEDIOS_PUBLIC_URL` se han tocado.
- **Rollback local corregido.** `git checkout` de archivos completos no aísla el paquete en un árbol con otros cambios. Lista propia del paquete:
  - **Nuevos (borrar):** `functions/medios.js`, `functions/medios/[[ruta]].js`, `cloudflare/medios-pages/entrega.js`, `cloudflare/medios-pages/test/probar-entrega.mjs`, `src/lib/urlsMedios.js`, `scripts/lib/sw-medios.mjs`, `scripts/verificar-urls-medios.mjs`, `docs/evidencia-rendimiento/fase-3/DISENO-MEDIOS-PAGES-FUNCTIONS.md`.
  - **Modificados (revertir solo los hunks del paquete):** `src/lib/medios.js`, `src/lib/imagenes.js`, `vite.config.js` (bloque `navigateFallbackDenylist`), `scripts/build-cloudflare.mjs` (`_routes.json`, import y comprobación del SW), y las adiciones §18–§19 de este runbook y del changelog.
  - Un parche exacto y comprobado se generará con `git diff` sobre esa lista cuando se prepare el commit (hoy nada está versionado ni publicado).

**Regresiones y suites repetidas tras la corrección (todo local):** `probar-entrega.mjs` **37/37** (PFM-01 GET y recuperación; HEAD sin leer bytes, con y sin `head`; HEAD de errores sin cuerpo; fallo de metadatos; HEAD→GET y GET→HEAD), `verificar-urls-medios.mjs` **16/16** (incluye el control del SW y, con `SW_REAL`, el `sw.js` del build), `verificar-guardas-interfaz-r2.cjs` 42/42, `build:cloudflare` OK, `oxlint` de lo tocado sin diagnósticos. **No se repitió** `wrangler pages dev` ni la corrida de 24 casos con el cambio de HEAD (el `head()` real del binding de Cloudflare y la Cache API real siguen sin medirse).

## 20. Publicación b36e749 verificada por Codex y siguiente paso (configuración de Preview PENDIENTE de autorización)

- **Codex (`REVISION-PAGES-B36E749-Y-CONFIGURACION-PREVIEW.md`):** el alias sirve la marca `b36e7495`; `/medios`, `/medios/` y una ruta válida sin objeto responden 404 con `no-store`/`nosniff`/`noindex` (GET y HEAD sin cuerpo); `/ventas` y `/medios-extra` siguen siendo la SPA; el SW servido cumple `swExcluyeMedios`; el cliente sigue leyendo de `r2.dev`. El 404 de una clave válida es compatible con binding ausente u objeto inexistente (no se inspeccionó el panel).
- **Configuración preparada por Codex, NO aplicada** (solo Preview, proyecto `pos-jaise`): binding R2 `MEDIOS` → `pos-jaise-medios-staging`; `VITE_MEDIOS_PUBLIC_URL=https://feat-cloudflare-pages.pos-jaise.pages.dev/medios`; `VITE_MEDIOS_BASES_RECONOCIDAS=https://pub-b248edba3e19402382b557a35b33c674.r2.dev`. Después hay que reconstruir (las `VITE_*` se incrustan al compilar; reconstruir el mismo commit conserva el build-id pero cambian bundle y SW: registrar el ID/URL del deployment y hashes, y usar un contexto de navegador nuevo). Aplicarlo es un cambio externo que requiere autorización expresa del usuario; no se ha hecho.
- **Preparación local ya hecha (sin commit):** `scripts/verificar-interfaz-r2-preview.cjs` acepta `--entrega=pages` (por defecto `r2dev`): usa `<alias>/medios` como base pública (conservando `r2.dev` aprobado para filas antiguas), exige en las 4 variantes `nosniff`, `Cache-Control: public, max-age=300` y `X-Medios-Cache: HIT|MISS`, y localiza las imágenes por prefijo de la base. Los borrados siguen comprobándose contra el **inventario del Worker** (ausencia en R2), nunca con un 404 público inmediato, porque durante el TTL puede haber un HIT. La limpieza de emergencia usa la base de la entrega elegida. Regresión nueva (43/43) y `oxlint` limpio; el informe de la corrida registra `entrega` y `publico`.
- **Aún sin script:** las pruebas de caché (MISS→HIT, expiración y borrado según el TTL de 300 s, `head()` real) requieren objetos de prueba escritos por el Worker; se prepararán y ejecutarán con la autorización de ese recorrido, una vez configurado el binding.

## 21. Preview configurado (binding y variables) e IP-P1 corregido

- **Configuración aplicada por Codex con autorización expresa del usuario («Sí, aplicar y reconstruir solo Preview»), solo Preview** (`.codex/PAGES-PREVIEW-MEDIOS-FUNCTIONS-CONFIGURADO.md`): binding `MEDIOS` → `pos-jaise-medios-staging`; `VITE_MEDIOS_PUBLIC_URL=<alias>/medios`; `VITE_MEDIOS_BASES_RECONOCIDAS=<r2.dev de pruebas>`. Reconstruido el mismo commit `b36e7495` → deployment `4d23d410-61a8-4617-b224-cc9bc9396624` (anterior, con r2.dev: `4d334b5d-…`). Misma marca de build, **bundle y SW distintos** (SHA-256 del SW registrados por Codex): la marca sola no identifica la entrega. Production sin cambios. Codex no probó un objeto real.
- **IP-P1 (P2) — corregido.** El verificador de interfaz solo validaba marca/backend/cuenta; con dos deployments de la misma marca y distinta `publicUrl`, `--entrega=pages` podía empezar a escribir contra un artefacto equivocado. Ahora `G.preflight` exige `entrega` (`r2dev|pages`) y, tras la marca y **antes de autenticar o escribir**, lee `sw.js` y todos los módulos JS de su precache (solo GET al alias; rutas relativas, sin `..`), localiza la configuración de medios del bundle **por rol** y la compara con la esperada: `proveedor=r2`, Worker de staging, `publicUrl` exacta (`<alias>/medios` para `pages`, la `r2.dev` aprobada para `r2dev`) y el **segundo argumento** de `basesReconocidas` (la `r2.dev` para `pages`; vacío/ausente para `r2dev`). No usa la mera presencia de cadenas (el bundle de Pages contiene las dos): roles invertidos, `/` final, base extra ajena, otro Worker, proveedor distinto, módulos contradictorios, bundle sin configuración reconocible o `sw.js` sin scripts **abortan sin login**. Si Vite cambia el formato del bundle, el control falla cerrado (aborta) en vez de aceptar.
- **Regresiones:** `verificar-guardas-interfaz-r2.cjs` **46/46** (incluye marca igual + entrega equivocada, build sin la variable de bases para `r2dev`, `scriptsDelSw`). `oxlint` limpio. **Comprobación en vivo, solo GET públicos, sin login ni escrituras:** contra el alias real con la marca `b36e7495`, `--entrega=pages` es aceptada y `--entrega=r2dev` es rechazada con la `publicUrl` observada.
- **Preparado, NO ejecutado (escribe en staging):** `scripts/verificar-medios-pages-cache.cjs --build-id=<8 hex> [--sin-expiracion]`: mismo preflight de entrega y marca antes de autenticar; sube **un objeto ficticio** (`fotos-galeria/<uuid propio>`, m y g) por el Worker; comprueba 404 previo sin cachear, HEAD (sin cuerpo, ETag, no puebla la caché), GET con bytes exactos (MISS) y luego HIT (con reintentos, registrados), 304 por ETag (`*` incluido), Range ignorado, 405, rutas inválidas, `/medios-extra` = SPA; borra por el Worker, confirma la ausencia en R2 por el **inventario**, acepta HIT 200 retenido o 404 pero **nunca un 200 MISS**, y espera el TTL de 300 s para exigir el 404 de expiración; limpia solo el objeto propio y compara el inventario final con el inicial. Verificado: aborta antes de autenticar con un build-id equivocado. Límites declarados: HIT por centro de datos, `head()` inferido, tiempos del cliente (no CPU/cuota).
- **Pendiente de autorización de escrituras en staging:** esa prueba de caché, el recorrido de interfaz con `--entrega=pages` (23 casos) con la marca del deployment vigente y la ronda PWA con la base `/medios`; después, el ensayo de rollback de URLs sobre filas ficticias, purga, fotos reales, otros navegadores/móvil, carga, recolector y migración inversa. Los scripts de esta sección y la corrección de IP-P1 están **sin commit**.

## 22. Revisión de Codex de IP-P1 y de la prueba de caché (`REVISION-IP-P1-Y-PRUEBA-CACHE-PAGES.md`): CP-01 corregido

- **IP-P1 cerrado por Codex** para las reproducciones y los dos deployments reales (46/46 repetidas; con la marca `b36e7495` el alias actual —Pages— se acepta en `pages` y se rechaza en `r2dev`, y el inmutable anterior `4d334b5d` al revés; SW SHA-256 actual `4c3d38c2…` / anterior `64bd81f2…`). El reconocimiento es específico del formato de Vite: si cambia, hay que revisar la guarda y sus negativos.
- **CP-01 (P2) — corregido.** En `verificar-medios-pages-cache.cjs`, un error en la limpieza o en la comprobación final se registraba como `errorLimpieza` sin afectar `completa`, el resumen ni el código de salida (falso éxito con estado final no verificable). Ahora la limpieza y la comprobación final están en `G.limpiarObjetoPropio` (`scripts/lib/guardas-interfaz-r2.cjs`): solo toca el grupo propio (`fotos-galeria/<uuid propio>/`), relee el inventario con lectura estricta (red caída, 5xx, malformado o cursor lanzan) y devuelve `confirmada` únicamente si no hubo errores, no quedan claves propias y el inventario final es idéntico al inicial; cualquier excepción es un resultado NO confirmado (nunca un inventario vacío). El script añade un caso «ESTADO FINAL confirmado», separa `estadoFinalConfirmado` de las pruebas principales, exige ambos para `completa` y sale con código ≠ 0 si hay fallos o la corrida no es completa.
- **Regresión nueva (47/47):** caso sano (confirma, un DELETE), ya limpio (sin DELETE), primer inventario fallido (sin borrar nada), relectura fallida, DELETE que lanza, DELETE 500 con el objeto aún presente, inventario final con una clave extraña o sin una ajena, y sin inventario inicial; en todos los negativos `confirmada=false` y solo se intenta borrar el grupo propio. Comprobación de extremo a extremo: con un build-id equivocado el script aborta antes de autenticar, escribe su informe y sale con código 1.
- **Salida configurable:** ambos scripts (`verificar-medios-pages-cache.cjs` y `verificar-interfaz-r2-preview.cjs`) aceptan `--salida=<carpeta>` para escribir informes/capturas fuera de la evidencia del repo (p. ej. una carpeta propia de un revisor), sin sobrescribir los archivos versionados.
- **POP / expiración:** el informe registra el `CF-Ray`→POP del HIT y del 404 posterior al TTL (`popHit`, `popExpiracion`) y `expiracionDeLaMismaCopia`: el caso solo afirma que se OBSERVA un 404 tras el plazo; únicamente si el POP coincide se atribuye a la expiración de la copia que dio HIT (si no, avisa). `head()` sigue inferido; CPU/cuota no se miden.
- **Autorización:** «Sí, aplicar y reconstruir solo Preview» cubrió binding, variables y reconstrucción; **no** las escrituras de pruebas. La prueba de caché, el recorrido de interfaz con `--entrega=pages` y la ronda PWA siguen sin ejecutarse y sin commit, a la espera de autorización específica de escrituras en staging.

## 23. CP-01 cerrado por Codex (`REVISION-CP-01-CACHE-PAGES-V2.md`)

- **Cerrado en la implementación local:** 47/47 guardas repetidas, `oxlint` limpio y nueve escenarios sobre el script de caché completo con dobles (sano con POP coincidente y distinto; inventario final con red caída, 500, JSON sin objetos y cursor; limpieza necesaria con relectura caída; DELETE 500 con objetos presentes; build-id incorrecto). Las lecturas finales fallidas y una limpieza no confirmada dan fallo, código 1 y `completa=false`. Es una aprobación de scripts y guardas, **no** del resultado de caché real ni de la Fase 3.
- **Precisión (no bloqueo):** el aborto por build-id incorrecto del verificador de **interfaz** ocurre antes de crear su carpeta e informe: sale con código **2** y **sin JSON** (ya documentado en §6: los fallos anteriores al `try` no generan informe). «Escribe el informe y sale con 1» está comprobado solo para el script de **caché**. Si hace falta evidencia del rechazo de la UI, conservar la salida del comando de preflight. El POP compara centros de datos pero no instrumenta una entrada concreta de Cache API; evaluar siempre casos/fallos y código de salida junto a `completa`.
- **Pendiente de autorización específica de escrituras en staging (sin ejecutar):** (1) prueba de caché con un objeto ficticio (`verificar-medios-pages-cache.cjs`, ~6 min por el TTL); (2) recorrido de interfaz 23 casos con `--entrega=pages`. Usar `--salida=<carpeta nueva>`, conservar snapshot e inventario inicial/final y detenerse si queda algo pendiente. Commit/push y ronda PWA, aparte.

## 24. Ejecución real contra el alias Preview con la entrega Pages `/medios` (marca `b36e7495`, deployment `4d23d410`)

Autorizada por el usuario («si») para estas dos pruebas, solo staging. Informes en `.codex/evidencia-ejecucion-cache-ui/` (`--salida`), sin tocar la evidencia versionada. Producción, `main` y GitHub Pages sin cambios. **Aprobada por Codex para el alcance de staging (`REVISION-CACHE-UI-PAGES-B36E7495.md`: 16 controles independientes sin fallos; no es la Fase 3 completa).**

**Prueba de caché (`cache-52d575.json`): 27 casos, 0 fallos, `completa=true`, `estadoFinalConfirmado=true`, exit 0.** Preflight de marca+entrega antes de autenticar; 404 previo `no-store` sin cachear; subida de m y g por el Worker (201); HEAD 200 sin cuerpo con ETag y `max-age=300`, sin poblar la caché (segundo HEAD MISS); GET con los bytes **exactos** subidos (MISS) y siguiente GET **HIT** a la primera (POP `MIA`); 304 por ETag y `*`, 200 con ETag distinto; Range ignorado (200 completo); POST 405; rutas inválidas 404 `no-store`; `/medios-extra` = SPA; borrado por el Worker con ausencia en R2 confirmada por el inventario; tras borrar, **HIT 200 retenido** por el TTL (contrato, nunca un 200 MISS); a los 315 s, **404 `no-store`** en m y g con el **mismo POP (`MIA`)** que dio el HIT (`expiracionDeLaMismaCopia=true`). Inventario final idéntico al inicial. Tiempos del cliente (no CPU/cuota): HEAD ≈ 149 ms, GET MISS ≈ 382 ms, GET HIT ≈ 242 ms.

**Recorrido de interfaz con `--entrega=pages` (`corrida-20df1b.json`): 23 casos, 0 fallos, `completa=true`, sin limpieza de emergencia.** Preflight de la configuración efectiva (publicUrl `<alias>/medios`) antes del login; Producto (alta, reemplazo, quitar), Servicio (alta, vista cliente, reemplazo con galería idéntica, quitar), Galería (alta, reemplazo de «antes», eliminar), fila antigua de `/public`; las 4 variantes responden con `nosniff`, `max-age=300` y `X-Medios-Cache`; ADMIN y CLIENTE sin tráfico a destinos no aprobados, sin Storage de Supabase y sin errores de página; snapshot e inventario finales idénticos.

**Límites:** el HIT/expiración se observó en UN centro de datos (MIA) y en UNA ejecución; `head()` solo se infiere de HTTP; CPU y cuota de 100.000 solicitudes sin medir; Chromium únicamente; fotos de referencia. **Siguen pendientes:** ronda PWA con la base `/medios` (requiere commits que reconstruyen el alias), ensayo de rollback de URLs de Galería sobre filas ficticias, purga, fotos reales, otros navegadores y móvil, carga, recolector y migración inversa. Scripts de IP-P1/CP-01 y este registro, **sin commit**.

## 25. Publicación 9bb1330 verificada por Codex y plan PWA con la entrega Pages (SIN publicar)

- **Codex (`REVISION-PAGES-9BB1330.md`):** preview `9bb13306` verificado (deployment `a68f02d7-3f45-43de-b494-f27d0c7a9d76`, success, 34 s; 140 scripts 200; entrega Pages `/medios` y solo staging conservados; SW excluye `/medios`; SW SHA-256 `8018435f…9071`, distinto del de `b36e7495` `4c3d38c2…ca42`; CSS idéntico entre los dos artefactos). Las pruebas 27/27 y 23/23 **siguen atribuidas a `b36e7495`**.
- **Plan local de la ronda PWA:** `PLAN-PWA-PAGES-MEDIOS.md` (A = `9bb13306`; rondas `venta` y `vacio`; dos commits B1/B2 con documentación y scripts útiles; evidencia en `.codex/evidencia-pwa-pages/`; sin push solo para archivar la última ronda). `verificar-actualizacion-pwa-online.cjs` acepta `--entrega=pages|r2dev` (preflight de marca+entrega **antes** del navegador y de publicar B; repetido para B; SW SHA-256 de A y B; comprobaciones de `/medios` bajo el SW sin escribir nada). Comprobado hoy sin publicar: tres negativos del preflight (código 1, sin navegador) y el ensayo del lado A completo (todas las comprobaciones OK hasta «no apareció el aviso», `--espera-min=0`). Corregido el código de salida 127 (libuv/`process.exit`).
- **Pendiente de autorización específica:** commits B1/B2 y pushes (cada uno reconstruye el alias). Sin escrituras de datos; la comprobación de imágenes reales por `/medios` durante la ronda, si se quiere, necesita su propia autorización.
