# Diseño: entrega de medios por Pages Functions (sin dominio propio) — v2

Estado: **IMPLEMENTADO Y PROBADO SOLO EN LOCAL (sin commit, push, binding ni cambios en Cloudflare); pendiente de la revisión de Codex del paquete.** Diseño revisado por Codex (v1) y aprobado en v2 (`REVISION-DISENO-MEDIOS-PAGES-FUNCTIONS-V2.md`, con 4 precisiones ya incorporadas en código y pruebas: ver runbook §19). Origen: `.codex/R2-SIN-DOMINIO-PROPIO-Y-B0A83A2.md`, runbook §18 y `.codex/REVISION-DISENO-MEDIOS-PAGES-FUNCTIONS.md` (PF-01…PF-04 y decisiones 1–6, incorporados abajo). Solo staging; no toca `main`, producción ni GitHub Pages. Nada se implementa ni se cambia la variable de medios hasta que Codex apruebe esta versión y el usuario autorice la implementación.

## 1. Objetivo y no-objetivos
- **Objetivo:** que el navegador lea las fotos desde el hostname de Pages (`https://feat-cloudflare-pages.pos-jaise.pages.dev/medios/<destino>/<uuid>/{m,g}.webp`) con `image/webp`, `nosniff`, caché medible y errores limpios, sin `r2.dev`.
- **No-objetivos:** cambiar subidas/borrados (siguen en el Worker `pos-jaise-medios-staging`, con sesión y rol); migrar fotos de Supabase; escribir refs `r2:` en el negocio; comprar dominio; purga global y política definitiva de caché (su propia fase).

## 2. Qué hay hoy (verificado en el repo)
- `src/lib/medios.js`: `urlPublicaR2(ref, v) = ${VITE_MEDIOS_PUBLIC_URL}/<destino>/<uuid>/<v>.webp`. Para refs `r2:` (Producto, Servicio y sus galerías) cambiar la entrega es cambiar esa variable.
- **Galería guarda URLs completas** (`antes_url`/`despues_url`), y `referenciaDeUrlR2` solo reconoce el prefijo configurado en ese momento. De ahí PF-01 y PF-02 (§7).
- El Worker valida `DESTINOS`, `RE_ID` y `[mg].webp`; los objetos se guardan con `image/webp` y `immutable` de un año; las claves son únicas y nunca se reutilizan.
- `cloudflare/_headers` **no se aplica a respuestas de una Function**: esta fija todas sus cabeceras (200, 304, HEAD y errores).

## 3. Diseño de la función
`functions/medios/[[ruta]].js`; binding `MEDIOS` → bucket de pruebas, **solo en Preview**. Contrato (decisiones de Codex 1, 2, 4 y 5):

**Ruta y método.** Solo `GET` y `HEAD` (otro → 405 con `Allow`). La ruta debe coincidir exacta con `^(fotos-productos|fotos-servicios|fotos-galeria)/<RE_ID>/(m|g)\.webp$`; todo lo demás (incluidos `/medios`, `/medios/`, traversal, `%2e`, `//`, mayúsculas, doble extensión) → 404 `no-store`. Sin listado ni prefijos.

**Clave de caché.** Un `Request` GET canónico por URL (sin query ni `Range`). HEAD se atiende desde la misma entrada pero **nunca guarda** una representación vacía; probar HEAD→GET y GET→HEAD.

**Range y condicionales.** `Range` se ignora y se responde 200 completo (también se retira de la consulta a la Cache API, porque `match` podría devolver 206 y `put` lo rechaza). `ETag` = `httpEtag` de R2 (con comillas); `If-None-Match` (coincidente, no coincidente, lista y `*`) se evalúa en MISS y en HIT; el 304 no sustituye el objeto almacenado.

**Flujo.** `cache.match` → HIT: clonar la respuesta con `X-Medios-Cache: HIT`. MISS: `env.MEDIOS.get(clave)`; inexistente → 404 `no-store`; existente → 200 con `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex` (política de staging) y las cabeceras de caché de §5, con `X-Medios-Cache: MISS`; el almacenamiento va por `waitUntil` y **no se promete** que la solicitud inmediata siguiente sea HIT. La cabecera propia no prueba el ahorro: la prueba cuenta además las lecturas del doble R2.

**Fallos.** Binding ausente → 404 `no-store`. Error de lectura R2 → 503 `no-store` sin detalles. Fallo de `match`/`put` → se entrega igualmente la imagen desde R2. Nunca se cachean errores operativos.

**Cabeceras de todas las respuestas (incluidos 304, HEAD y errores):** `nosniff`, `noindex`. CORS: no hace falta con `<img>`; si se añadiera, no variar la clave compartida por `Origin`.

**Aislamiento.** `_routes.json` completo `{"version":1,"include":["/medios/*"],"exclude":[]}` generado en **`dist/`** por `scripts/build-cloudflare.mjs` (no basta ponerlo en la raíz). Probar `/medios` sin barra, la raíz del catch-all y una navegación inválida. El service worker excluye `/medios/` del fallback de navegación y no hace precache ni caché runtime de esas imágenes (verificado en el SW generado y en la prueba PWA).

## 4. Seguridad
- Lectura pública **solo** de los tres destinos, nombre exacto, sin listado; el binding da acceso a todo el bucket, por eso el filtro de ruta es estricto y hay tests de traversal.
- Subidas/borrados no pasan por la función; el binding se usa solo con `get`. Variables/binding solo en Preview; producción, configuración separada y solo con autorización.

## 5. Caché y borrado (PF-03)
Tres TTL **separados**, definidos explícitamente:
| Capa | Staging (esta fase) | Definitivo |
|---|---|---|
| Navegador (`max-age` de respuestas 200) | corto (p. ej. 300 s) | por decidir en su fase |
| Edge (Cache API, positivos) | el mismo valor corto | por decidir |
| Errores (404/503) | `no-store` (sin caché negativa en la primera versión) | caché negativa solo tras probar GET inexistente → subida → GET |
- Consecuencia reconocida: una foto retirada puede seguir sirviéndose desde el navegador o el edge **hasta que expire el TTL positivo**; un 404 corto no la mitiga, y `cache.delete` solo afecta al centro de datos que lo ejecuta. Con `immutable` de un año esa ventana sería de un año: por eso el TTL positivo en staging es corto mientras se valida el borrado.
- **No se promete purga por URL en `*.pages.dev`**: el mecanismo y su ámbito en esta cuenta quedan por validar en la fase de purga.
- **Prueba de borrado adaptada al contrato:** calentar la caché → borrar por el flujo autorizado → releer y registrar HIT/404 esperado; distinguir ausencia en R2, en el edge y en el navegador. La verificación actual que exige 404 inmediato tras el DELETE se adapta: no se afirma borrado inmediato donde el contrato permite un HIT.

## 6. Cuota y coste (decisión 6)
HIT ahorra una lectura R2 pero la solicitud **sigue ejecutando la Function**. Workers y Pages Functions comparten los **100.000 requests diarios** del plan gratuito (los estáticos excluidos no cuentan). Medir la suma real y el CPU en pruebas y documentar qué devuelve `/medios/*` al agotarse la cuota; no extrapolar de los GB almacenados.

## 7. Cliente, compatibilidad y rollback (PF-01, PF-02)
- **Base fija y absoluta (decisión 1):** `VITE_MEDIOS_PUBLIC_URL=https://feat-cloudflare-pages.pos-jaise.pages.dev/medios` solo en Preview. `quitarBarraFinal` solo recorta: la validación de que sea una URL absoluta HTTPS aprobada se añade en `medios.js` (error de configuración si no).
- **PF-01 — reconocimiento durante la transición:** `referenciaDeUrlR2` (y por tanto `resolverUrlGaleria`/`rutaDeUrlGaleria`) reconocerá, además del prefijo configurado, **una lista cerrada de bases aprobadas** (`r2.dev` de pruebas y `/medios` de Pages), validando origen exacto (no `includes`), prefijo, destino, UUID y variante. Hosts engañosos o rutas inválidas devuelven `null`. Así una fila antigua se puede mostrar, reemplazar y retirar **sin operaciones de Storage**, también tras el cambio o un rollback. Regresiones en memoria: URL antigua reconocida con cada base configurada, URL nueva igual, hosts engañosos, rutas inválidas y `rutaDeUrlGaleria` sin desvío a Supabase.
- **PF-02 — rollback:** restaurar la variable recompone solo las refs `r2:`; **no** las URLs absolutas de Galería. Por tanto: **no se retira la Function ni el binding mientras existan filas que usen la URL de Pages**. Antes de retirarlos se ejecuta un procedimiento acotado (solo filas ficticias de staging) que restaura esas URLs al prefijo anterior, con prueba: fila ficticia con URLs de Pages → ensayo de rollback → lectura y gestión de ambas fotos. No autoriza la migración inversa de producción (sigue pendiente).
- Nada se escribe en el negocio.

## 8. Decisiones tomadas (antes abiertas)
1. `Range` ignorado, 200 completo. 2. Errores `no-store`. 3. Prefijo `/medios/` fijo, URL absoluta de staging. 4. `_routes.json` completo en `dist/`. 5. Cabeceras fijadas por la propia Function. 6. Cuota medida. Siguen abiertos solo: TTL positivo definitivo y purga (fase propia) y la política de producción.

## 9. Plan de pruebas (antes de dar nada por válido)
1. **Local sin red:** unit con R2 y Cache simulados — ruta válida; traversal/encoding/método/destino/variante inválidos; HEAD→GET y GET→HEAD; ETag (coincidente, no, lista, `*`) en MISS y HIT; `Range` ignorado; cabecera propia HIT/MISS y **lecturas del doble R2 no aumentan en el HIT**; fallos de binding, R2 y cache; cabeceras exactas en 200/304/HEAD/errores.
2. **Regresiones de cliente (PF-01/PF-02):** reconocimiento de bases aprobadas y rechazo de hosts engañosos; sin desvío de borrado a Storage.
3. **`wrangler pages dev`** con bucket simulado y verificación del `_routes.json` generado en `dist/`; revisar el SW generado.
4. **Preview de staging** (tras el binding y la variable, solo Preview): GET a un objeto de prueba — 200, `image/webp`, `nosniff`, MISS→HIT; inexistente 404; rutas inválidas y listados 404; prueba de borrado según §5.
5. Recorrido de interfaz 23/23 con la nueva base y la marca exacta del deployment; ronda PWA confirmando que el SW no intercepta `/medios/`; ensayo de rollback de §7.
6. Solo después: fotos reales, navegadores/móvil, carga, purga y migración inversa (siguen pendientes).

## 10. Quién hace qué
- **Claude** (con autorización del usuario): `functions/`, `_routes.json` en el build, cambios de `medios.js`/`imagenes.js`, regresiones y build reproducible en `feat/cloudflare-pages`.
- **Codex:** revisión del paquete y, solo con autorización humana expresa, binding `MEDIOS` y variable `VITE_MEDIOS_PUBLIC_URL` en Preview (no cambiar la variable antes de tener la Function probada y la compatibilidad).
- **Usuario:** autorizar la implementación (cada push reconstruye el alias) y, aparte, el cambio de variable/binding. Nada toca producción.
