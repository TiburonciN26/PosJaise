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
