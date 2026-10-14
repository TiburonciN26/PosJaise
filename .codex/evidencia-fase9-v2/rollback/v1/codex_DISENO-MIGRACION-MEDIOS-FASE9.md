# Diseño de la migración de medios existentes · Fase 9

Fecha: 2026-10-12. Estado: **diseño, herramientas y simulación LOCAL**. No se migró ningún dato real, no se tocó ningún recurso remoto (Supabase de staging o del negocio, R2, Worker, Pages, DNS) y no hubo commit ni push. Herramienta: `scripts/migracion-medios/`. Inventario: [INVENTARIO-MEDIOS-FASE9.md](INVENTARIO-MEDIOS-FASE9.md). Plan del cambio público: [PLAN-CAMBIO-PUBLICO-FASE9.md](PLAN-CAMBIO-PUBLICO-FASE9.md).

## 1. Alcance

| Bucket (Supabase Storage) | Clasificación | ¿Se migra a R2? | Motivo |
| --- | --- | --- | --- |
| `fotos-productos`, `fotos-servicios`, `fotos-galeria` | público de catálogo | **Sí** | Son los únicos destinos que acepta el Worker de la Fase 3 (`r2:<destino>/<uuid>`) |
| `fotos-usuarios`, `fotos-clientes`, `fotos-asistentes` | público **personal** (perfiles) | No | El plan exige clasificar perfiles explícitamente antes de moverlos. Decisión pendiente del usuario; las fotos del equipo (asistentes) se muestran en el portal |
| `qr-pagos` | público del negocio | No | Pocos objetos, no es catálogo; requeriría un destino nuevo en el Worker |
| `comprobantes-pedidos-web`, `comprobantes-citas-web` | **privado** | **Nunca** | Siguen en el flujo privado de Supabase (URL firmadas). Cualquier intento aborta (§6) |
| `mobiliario.foto_url` | valor directo (URL pegada) | No | No es un objeto de Storage |

Dentro del alcance solo se migra una referencia si su objeto **existe** y su tipo es JPEG, PNG o WebP. Las referencias rotas (sin objeto), los GIF/SVG, las URL de Storage de **otro proyecto**, las URL externas y los recursos del build (`inicio-web/…`) se informan y se dejan como están. Así la fase no arrastra archivos rotos al cambio público, y la lectura mixta los sigue mostrando como hoy.

## 2. Formatos de referencia (contrato de la Fase 3, sin cambio de esquema)

| Columna | Hoy (Supabase) | Después |
| --- | --- | --- |
| `productos.foto_url`, `producto_fotos.foto_url`, `servicios.foto_url`, `servicio_fotos.foto_url` | ruta dentro del bucket (`<uuid>.webp`) | `r2:<destino>/<uuid>` |
| `galeria_web.antes_url` / `despues_url` | URL completa de Storage, o ruta relativa de `public/` | URL completa de la variante g: `<base pública>/fotos-galeria/<uuid>/g.webp`, lo mismo que guarda la app al subir a R2 |

La galería **fija la base pública vigente al migrar**. Un cambio posterior de base (p. ej. al dominio propio futuro) ya lo cubren `VITE_MEDIOS_BASES_RECONOCIDAS` y la lectura por la base configurada (`urlDeLecturaPropia`), o un lote acotado con `convertirBaseUrl`. Por eso la galería conviene migrarla con la base definitiva o asumir esa transición.

## 3. Manifiesto

Un JSON por ambiente, reanudable, que se reescribe de forma **atómica** (archivo temporal + rename) después de cada objeto y de cada fila. Un `.lock` impide dos ejecuciones sobre el mismo manifiesto.

- **Entrada** (un objeto de origen): `id` (UUID v5), `destino`, `origen` (bucket, ruta, URL, **bytes descargados**, tipo, **SHA-256 de los bytes**, ancho, alto, códec), `ref` nueva, `variantes` m/g (bytes, SHA-256, medidas, calidad, si se recodificó), `estado` e `historial` con fechas.
- **Referencia** (cada fila que usa ese objeto): tabla, columna, fila, `original`, `nuevo`, `estado` y fechas. Es el **diario de reversión**.
- **Estados.** Entrada: `planificada → copiada → verificada | error`. Referencia: `pendiente → actualizada | conflicto`, y `actualizada → revertida | conflicto-reversion`.
- **Checksum confiable:** SHA-256 de los bytes descargados. El `eTag` de Storage solo se guarda como dato informativo (en multipart no es un hash del contenido). Si el tamaño descargado difiere del declarado, se registra un evento.
- **Sin duplicados:** varias filas que usan el mismo objeto comparten **una** entrada y una sola copia (en la simulación, 3 filas → 1 copia). El id es `UUIDv5(ambiente | bucket | ruta | SHA-256)`: repetir o reanudar produce el mismo id, y el Worker responde 200 «reanudado» a la misma cuenta con los mismos bytes.

## 4. Copia y variantes

- **Vía:** el Worker autenticado de la Fase 3 (PUT `/v1/medios/<destino>/<id>/<m|g>`). Exige sesión de **administración** (`es_admin()` con el token de la persona), **solo crea** (`etagDoesNotMatch: '*'`, nunca sobrescribe) y valida el WebP. No hacen falta credenciales de R2, `service_role` ni un SDK S3: el operador inicia sesión con una cuenta de administración (variables `MIGRACION_EMAIL`/`MIGRACION_PASSWORD`, nunca guardadas).
- **Variantes:** `m` cabe en 320 px y `g` en 1400 px (el mayor tope que usa la app al subir), un fotograma, sin metadatos, `libwebp` con calidad 80. Si supera el tope de bytes del Worker (96 KiB / 512 KiB) se baja a 70 y luego a 60; si aun así no cabe, la entrada queda en `error` y su referencia no se toca. Nunca se amplía.
- **`g` sin pérdida extra:** si el original ya es un WebP válido para el Worker y está dentro de los topes, `g` es el **original byte a byte**. Así salieron los 10 objetos reales de Local (WebP generados por la app).
- **Validación previa:** cada variante pasa por el **mismo** `inspeccionarWebp` del Worker antes de subirse.
- **409 «ya existe»:** la herramienta lee la copia publicada. Solo la acepta si su SHA-256 es exactamente el de la variante registrada (p. ej. la subió otra administradora en una ejecución anterior); con otro contenido queda `error` por conflicto y nunca se sobrescribe.
- **Verificación por lectura:** tras subir, se lee cada variante por la base pública y se exige `image/webp` y el **mismo SHA-256**. Solo entonces la entrada pasa a `verificada`. Una entrada no verificada **nunca** cambia referencias.
- **Paradas:** 3 fallos transitorios seguidos (5xx, 429, red) detienen el lote; lo hecho queda reanudable. Los 4xx de validación marcan error en esa entrada y siguen con la siguiente.
- **Determinismo:** las variantes se guardan en la caché local y se reutilizan por SHA. No se regeneran variantes de algo ya subido, porque otra versión de `ffmpeg` podría producir otros bytes. El manifiesto registra la versión de `ffmpeg`.

## 5. Actualización de referencias y reversión

- `UPDATE <tabla> SET <col> = nuevo WHERE id = fila AND <col> = original` (PostgREST con la sesión de administración; RLS y GRANTs como en la app). Si no afecta filas se relee: si ya tiene el valor nuevo cuenta como hecho (respuesta perdida); si tiene otro valor queda en **conflicto** y no se toca, porque alguien la editó entretanto.
- Lotes (`--lote`, `--pausa-ms`). El manifiesto se guarda **después de cada fila**: el diario de reversión nunca queda por detrás de la base.
- **Reversión** (`revertir --aplicar`): el mismo UPDATE condicional en sentido inverso (`= original WHERE <col> = nuevo`). Una fila editada después de migrar queda `conflicto-reversion` y no se pisa. **Ni los originales de Supabase ni las copias en R2 se borran**: revertir solo cambia referencias. Una copia en R2 que quede sin referencia la recoge, si se decide, el recolector de huérfanos con retención (`scripts/medios-huerfanos.mjs`), fuera de esta herramienta.
- `productos` y `servicios` tienen triggers de auditoría: cada cambio de referencia deja una fila en `auditoria` a nombre de la cuenta que ejecuta.

## 6. Garantías y guardas

1. **Sin borrados:** la herramienta no contiene `storage.remove`, `DELETE` al Worker ni `delete` de filas (comprobado por una prueba estática). Hay un solo punto de `UPDATE` y es condicional (también comprobado).
2. **Privados excluidos tres veces:** al clasificar, en las invariantes del manifiesto (solo buckets públicos de catálogo) y en `planificar`. Los informes no copian valores ni rutas de comprobantes, solo conteos.
3. **Ambiente:** lo local (loopback) se permite. Un destino remoto exige `--permitir-remoto=<host exacto>` y https; el Supabase del negocio exige además `--permitir-produccion`. Todo se rechaza **antes** de autenticar.
4. **Simulación por defecto:** sin `--aplicar`, `copiar` solo prepara variantes y `actualizar`/`revertir` solo muestran lo que harían.
5. Argumentos estrictos: flags sin valor, números con rango y opciones desconocidas rechazadas.

## 7. Procedimiento para la migración real (NO autorizado en esta fase)

Cada paso requiere autorización explícita del usuario con su alcance. Codex revisa antes de cualquier escritura remota.

0. **Puerta de compatibilidad (bloqueante).** Todo frontend que lea los datos de ese ambiente debe entender `r2:` y tener `VITE_MEDIOS_PUBLIC_URL`. Hoy **no se cumple en producción**: `main` (lo que publica GitHub Pages) no tiene `lib/medios.js` y pediría `…/object/public/fotos-productos/r2:fotos-productos/<id>`, que responde **400** (`evidencia-fase9/compatibilidad-main-r2.txt`). Las PWA instaladas con bundles viejos tampoco lo entienden. Consecuencia: **las referencias de producción se actualizan solo después de la Fase 10B** (frontend nuevo publicado y observado, GitHub Pages redirigido o reconstruido con lectura de R2). La copia a R2 (pasos 3–4) sí puede adelantarse sin efecto visible.
1. Infraestructura de producción aprobada: bucket R2, Worker y Function `/medios` con revocación B (Fase 3/10). Nada de esto existe hoy en producción.
2. `inventariar --desde-json=<salida de inventario.sql>`: el SQL es de solo lectura y lo ejecuta, con autorización, quien tenga acceso al SQL del ambiente. Revisar las clasificaciones.
3. `planificar` con `--permitir-remoto` (solo lectura HTTP de objetos públicos); revisar el manifiesto, los eventos y una **muestra visual estratificada** (por bucket, tipo y tamaño).
4. `copiar` sin `--aplicar` (variantes) → revisión de muestra → `copiar --aplicar` en lotes pequeños.
5. `verificar`: R2 = SHA-256 y originales intactos.
6. Tras la puerta 0: `actualizar --aplicar` en lotes (empezando por un lote piloto), `verificar` después de cada tanda y control visual.
7. **Periodo de reversión.** Originales y referencias anteriores se conservan durante el periodo que **decida el usuario** (propuesta: al menos 30 días desde que termine la actualización de referencias, y nunca antes de cerrar la observación de la Fase 10B). Durante ese tiempo `revertir --aplicar` devuelve todo a Supabase.

**Staging primero:** el mismo procedimiento debe ensayarse completo en staging, con fixtures propios, antes del negocio (lo pide la verificación de Codex: «rollback ejecutable en staging»). No se hizo en esta fase porque la autorización excluye cambios remotos.

## 8. Límites conocidos

- **Orientación EXIF:** `ffmpeg` no aplica de forma fiable la orientación EXIF de un JPEG. Los originales actuales salen del navegador ya orientados (canvas), pero un JPEG antiguo con EXIF podría quedar girado. Lo detecta la muestra visual; si aparece, se trata como revisión manual de esa entrada.
- La recodificación es con pérdida: calidad 80, igual que la app. Los WebP ya válidos no se recodifican.
- La verificación lee por la base pública. En producción eso es la Function `/medios` con caché de borde, así que una lectura podría venir del borde; el SHA-256 lo comprueba igual.
- No hay bloqueo del lado del servidor contra ediciones simultáneas: el UPDATE condicional evita pisar, pero una edición entre la planificación y la actualización deja esa fila en `conflicto`, a resolver a mano. Conviene ejecutar con el catálogo en calma.
- `planificar` descarga los originales completos a una caché local. Para miles de objetos hace falta espacio en disco; la caché no contiene nada privado.
