# Plan concreto de publicación (backend primero, frontend después; Recompensas APAGADO)

Estado: **plan; no se ejecutó nada**. Cada paso marcado **[AUTORIZACIÓN]** requiere tu confirmación explícita en ese momento (una aprobación anterior no se hereda). Base de este plan: `MANIFIESTO-ACTUALIZACION.md` y `RESULTADO-ENSAYO.md`.

## 0. Principios

1. **El revertir el frontend NO revierte la base** ni al revés. Son dos publicaciones independientes con su propia recuperación (§6).
2. **Orden obligatorio: backend → verificación → frontend.** El frontend nuevo contra el backend actual produce 404/400 (medido en el ensayo); el frontend actual contra el backend nuevo funciona (14/14).
3. Las 21 migraciones se aplican **todas y en orden**. **Cada archivo se confirma individualmente: las 21 juntas NO forman una única transacción**, así que un fallo en la n-ésima deja confirmadas las n−1 anteriores. Ante cualquier fallo: **detenerse, no seguir con las siguientes y documentar el estado parcial** (cuál falló, cuáles quedaron aplicadas y registradas en `supabase_migrations.schema_migrations`, salida del error). La decisión posterior (migración correctiva nueva o recuperación) es del propietario.
4. No se ejecuta la apertura/conversión ×5 ni se activa Recompensas. `activo=false`, `corte=null` antes, durante y después.
5. Ventana de bajo movimiento (el negocio es pequeño: 127 ventas históricas; elegir un momento sin Caja abierta y sin pedidos pendientes; hoy hay 0 pedidos web activos y 13 citas pendientes que **no** se tocan).

## 1. Preparación (sin tocar producción) — hecho / por hacer

| Paso | Estado |
|---|---|
| Manifiesto, ensayo, revisión de cupones y correctivas | hecho (`docs/lanzamiento/`) |
| Decidir las dos correctivas de privilegios (`propuesta-correctivas-privilegios.sql`): retirar `anon/service_role` de `confirmar_pedido_productos` (recomendado) y retirar `authenticated` de `recompensas_establecer_activo` hasta la apertura (opcional) | **tu decisión** |
| Avisar a Caja: un cupón puede rechazarse por protección (ver `REVISION-CUPONES-PROTECCION.md`) | por hacer |
| Revisar la rama a publicar: `testing` está **111 commits por delante de `main`**; el merge a `main` desplegará **todo** el frontend nuevo (portal web, Recompensas, Nosotros, tema claro, POS) y no solo lo del backend. Revisar el diff de `main..testing` en lo que afecte a rutas, textos y datos | por hacer |
| Confirmar que el frontend publicado tiene la PWA con `registerType: 'prompt'` (aviso de actualización) | por hacer |

## 2. Respaldo previo **[AUTORIZACIÓN]**

Se hace justo antes de aplicar, con el negocio sin movimiento. Todo se guarda fuera del repositorio, con hash. **El respaldo de producción es privado** (contiene usuarios, credenciales y datos personales reales): no se restaura en QA ni en la instancia de ensayo, no se comparte y no se copia al repositorio. Es distinto del ensayo, que usa **datos ficticios** (el `pg_dump`/`pg_restore` del ensayo se hizo solo sobre esos datos).

1. **Base de datos:** copia lógica completa del proyecto `cmkelllerzjqjbsqsylc` (esquema `public` + `auth` + `storage` + `supabase_migrations`): panel de Supabase → Database → Backups (copia diaria/PITR si el plan lo ofrece) **y además** `pg_dump -Fc` desde un cliente con la cadena de conexión del propietario (no pasa por el chat). Registrar hora exacta (UTC) y sha256.
2. **Definiciones previas de lo que se reemplazará** (para poder reinstalar sin restaurar toda la base): guardar la salida de `pg_get_functiondef` de las 14 funciones afectadas (`agregar_stock, anular_venta, confirmar_venta, confirmar_pedido_productos, equipo_para_web, es_admin, generar_cupon_fidelizacion, mi_fidelizacion, mi_historial_fidelizacion, mis_cupones, mis_puntos, reclamar_cupon_promocion, resumen_dashboard, verificar_pago_pedido_web`), las políticas `ventas_insert` y `movimientos_insert`, el CHECK `ventas_metodo_pago_check` y los `GRANT` de esas funciones.
3. **Archivos de Storage:** 9 buckets, 41 objetos, ≈ 3,6 MB (`comprobantes-citas-web` 1, `comprobantes-pedidos-web` 2, `fotos-asistentes` 0, `fotos-clientes` 1, `fotos-galeria` 6, `fotos-productos` 22, `fotos-servicios` 6, `fotos-usuarios` 1, `qr-pagos` 2). Descargar todos con el panel de Storage o la API S3 de Supabase a una carpeta fuera del repo y guardar la lista (nombre, tamaño) y un sha256 por archivo. **Las migraciones no tocan Storage**, pero el respaldo es barato y los comprobantes son privados e irrecuperables si se pierden.
4. **Huella de negocio previa** (conteo + md5 de un subconjunto de columnas de 17 tablas, ver `huellaNegocio()` en `lanzamiento-ayuda.mjs`): detecta cambios en **esas columnas**; no prueba que todo el contenido sea idéntico (límites en `RESULTADO-ENSAYO.md` §3). Se toma con consultas **de solo lectura**.
5. **Restauración completa del respaldo real: pendiente de definir.** El volcado de producción no se restaura en QA ni en la instancia de ensayo (traería usuarios, contraseñas y datos personales reales). Hay que **definir un entorno protegido de recuperación** (acceso restringido, cifrado, borrado posterior, sin exposición pública) donde validar una restauración completa. Mientras no exista, la recuperación real **no está demostrada**; lo demostrado es solo la mecánica `pg_dump`/`pg_restore` con datos ficticios.

**Criterio para continuar:** respaldo de base + Storage con hash guardado en lugar privado, y huella previa guardada (alcance en `RESULTADO-ENSAYO.md` §3). El entorno protegido de recuperación (§2.5) es una **decisión pendiente** del propietario: sin él, se continúa solo si el propietario acepta explícitamente que la restauración real no está validada. **Si algo falla: detenerse.**

## 3. Backend **[AUTORIZACIÓN]**

Con `apply_migration` del MCP de Supabase (o el editor SQL) **una por una**, en el orden del manifiesto, usando el SQL **idéntico** al archivo de `supabase/migrations/` (sin ediciones). Después de **cada** migración: sin error. Orden:

`20261002000001` → `…0002` → … → `20261002000008` → `20261003000001` → `…0004` → `20261004000001` → `20261005000001` → `…0004` → `20261006000001` → `…0002` → `20261007000001` → `…0002` (21 en total).

**Correctivas de privilegios: PROPUESTA pendiente de aprobación.** `propuesta-correctivas-privilegios.sql` **no es una migración y no se ejecuta como SQL suelto en producción**. Si el propietario las aprueba, primero deben convertirse en **migraciones nuevas** en `supabase/migrations/`, ensayarse en la instancia desechable (y en QA Local) y solo entonces —con autorización explícita— aplicarse en producción como una migración más, después de las 21 y de su verificación.

**Verificaciones del backend (solo lectura salvo donde se indica), antes de tocar el frontend:**

1. Huella de negocio igual que la previa (17 tablas); `recompensas_config`: `activo=false`, `corte is null`; 0 filas en `recompensas_movimientos`, `recompensas_canjes`, `recompensas_apertura_aportes`.
2. Comparación de esquema (huella por categoría) contra el ensayo POST: funciones 100, tablas 51, políticas 134, triggers 20, índices 108.
3. Privilegios (lectura de catálogo): `anon` sin acceso a las tablas nuevas; `authenticated` con los grants esperados; las correctivas solo si ya se aprobaron, se convirtieron en migraciones nuevas y se ensayaron (ver arriba).
4. **Comprobación inicial en producción: SOLO LECTURA.** Con el frontend actual y cuentas reales del negocio: cargar cada pantalla (ADMINISTRADOR, CAJERA, clienta de prueba) y consultas de lectura (`resumen_dashboard` devuelve `envio_cobrado`, `mis_cupones`, estado de `recompensas_config`). **No se crean ventas, anulaciones ni cupones de prueba en producción.** Las pruebas que modifican datos (venta y anulación con devolución de stock, cupones, pedidos, citas) **se mantienen en la instancia desechable** (ya hechas). Una venta, anulación o cupón de prueba real en producción sería una **autorización separada** y específica (qué cuenta, qué producto, cómo se revierte), no incluida en este plan.
5. Consultar los registros de Postgres/API (`get_logs`/panel) durante 15 minutos: sin errores 4xx/5xx nuevos.

**Criterios para DETENERSE (no publicar el frontend):** error en cualquier migración; huella de negocio distinta; `activo`≠false o `corte` no nulo; cualquier 5xx nuevo con el frontend actual; un permiso de `anon` sobre una tabla o función nueva que no esté en el manifiesto; Caja/pedido no funcionan con el frontend actual.

## 4. Frontend **[AUTORIZACIÓN]**

Solo después de §3 verde. El merge/push a `main` y su despliegue (el repositorio tiene un flujo de GitHub Pages; confirmar cuál es el despliegue vigente) **no se hicieron ni se autorizaron**; se ejecutan solo con tu orden.

1. Build de `testing` en limpio (`npm run build`) y revisión de que apunta al proyecto de producción (variables de entorno de producción, no las de Local).
2. Publicar. Los usuarios con la PWA/bundle anterior **siguen funcionando** (medido), pero sin la comprobación de cantidad del pedido hasta que acepten el aviso de actualización.
3. Verificación inmediata con cuentas reales: ADMINISTRADOR (Recompensas Web: ver que el programa figura **apagado** y **no pulsar activar**), CAJERA (Caja y Historial), una clienta de prueba (Inicio, Servicios, Citas, Recompensas con el programa apagado, carrito con cupón de prueba).
4. Revisión de los 5 productos con costo cero y de las protecciones de servicios (`REVISION-CUPONES-PROTECCION.md`), uno por uno.

**Criterios para DETENERSE y revertir el frontend:** errores de carga en Caja/Citas/Portal; el portal de la clienta muestra monedas o cifras de un programa que debe estar apagado; el toggle de activación está accesible y no se aplicó la correctiva; cualquier 4xx/5xx repetido en los registros.

## 5. Después de publicar

Observar 24–48 h: registros de errores, ventas (códigos `VEN130`+ correlativos), pedidos web, citas (guardado atómico `guardar_cita_pos`), rechazos de cupón por protección (anotar cuáles y por qué). Mantener el respaldo previo y la huella hasta cerrar la observación.

## 6. Recuperación — son dos cosas distintas

| Qué falla | Cómo se recupera | Costo |
|---|---|---|
| **Solo el frontend** (error visual, ruta rota) | Volver a publicar el frontend anterior (`main` previo). **La base queda actualizada**; el frontend anterior funciona con ella (ensayo `main + backend actualizado`: 14/14) | Ninguno de datos |
| **Una migración falla** | Cada archivo es su propia transacción: la que falla se deshace entera, pero **las anteriores ya quedaron confirmadas** (no hay transacción común de las 21). Detenerse, **documentar el estado parcial** (qué migraciones quedaron aplicadas y registradas) y no seguir. Corregir con una migración **nueva** (nunca editar una ya aplicada) y retomar solo con autorización; si es ambiguo, evaluar con el respaldo. Un estado intermedio (parte de las 21) no está ensayado con el frontend | Ninguno en la que falla; las anteriores quedan aplicadas |
| **Backend aplicado y hay que volver atrás** | **No hay «down»**: opciones (a) restaurar el respaldo previo (se pierden los datos nuevos desde su hora: ventas, citas, pedidos) o (b) reinstalar las definiciones previas guardadas en §2.2 y retirar lo nuevo con una migración correctiva (las tablas/columnas nuevas son aditivas y pueden quedar sin uso). La mecánica de restauración se ensayó solo con **datos ficticios** en la desechable (misma huella, mismo alcance, y el frontend anterior funcionó; la re-aplicación de las 21 tras restaurar salió 21/21). **La restauración del respaldo real no está validada** (§2.5) | (a) pérdida de datos posteriores; (b) sin pérdida, requiere SQL revisado |
| **Datos dañados por la actualización** | Detener ventas, comparar con la huella previa y con el respaldo, restaurar solo las tablas afectadas en una copia y decidir | Depende |

**Un frontend revertido con la base nueva y un frontend nuevo con la base vieja son estados distintos**: el primero está probado y es seguro; el segundo **no** (404/400 en Recompensas, reseñas de Inicio y Asistentes) y debe evitarse con el orden de §0.

## 7. Acciones exactas que requieren tu autorización final

1. Hacer el respaldo previo de producción (§2) y guardarlo en un lugar privado fuera del repo (sin restaurarlo en QA ni en el ensayo).
2. Aplicar las **21 migraciones** en producción con `apply_migration`, una por una (§3).
3. Aprobar (o no) las correctivas de privilegios: punto 1 (recomendado) y punto 2 (opcional). Si se aprueban: crear las migraciones nuevas, ensayarlas y pedir una autorización posterior para aplicarlas; **no** se ejecuta el SQL de la propuesta tal cual.
4. Merge de `testing` a `main` y publicación del frontend (§4): **no** se hará sin tu orden.
5. La revisión y confirmación de cada uno de los 5 costos y de las protecciones de servicios (te corresponde a ti, una por una).
6. Aparte, y no incluido en este plan: la apertura/conversión ×5, la activación de Recompensas, el catálogo de premios y cualquier push a `main` fuera de lo descrito.

## 8. Pendientes que no bloquean pero conviene cerrar

* Firefox/Safari/dispositivos físicos y la PWA instalada no se probaron.
* El checkout completo de la clienta con el bundle antiguo por la interfaz (se probó la llamada RPC exacta y la carga de pantallas).
* Una segunda ronda del ensayo con un volcado **anonimizado** de producción (requiere tu autorización y un procedimiento de anonimización; el ensayo actual usa datos ficticios con la misma forma).
* La deriva de `ventas.monto_pos_tarjeta` (numeric vs numeric(10,2)) y los comentarios distintos de `anular_venta`/`confirmar_venta` entre producción y el repositorio.
