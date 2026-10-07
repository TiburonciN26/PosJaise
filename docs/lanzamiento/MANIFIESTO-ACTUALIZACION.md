# Manifiesto de actualización — testing → producción (Recompensas Fase 2 APAGADO)

Estado: **preparación y ensayo en una instancia desechable. Nada se aplicó en producción, no se hizo merge ni push a `main`.** Fecha de los hechos: 2026-10-07. Complementa [`RESULTADO-ENSAYO.md`](RESULTADO-ENSAYO.md), [`PLAN-PUBLICACION.md`](PLAN-PUBLICACION.md) y [`REVISION-CUPONES-PROTECCION.md`](REVISION-CUPONES-PROTECCION.md).

## 1. Qué hay en producción (hechos comprobados, solo lectura)

Proyecto `WedJaiseReact` (`cmkelllerzjqjbsqsylc`). Solo se consultó el **catálogo** (objetos, definiciones, privilegios) y **agregados** sin datos personales; no se copió ningún usuario, contraseña, nombre ni teléfono.

| Hecho | Valor |
|---|---|
| `guardar_cita_pos`, `recompensas_*`, `servicios_proteccion`, `productos_proteccion` | **no existen** |
| Tablas / funciones / índices / políticas / triggers en `public` | 41 / 72 / 87 / 124 / 18 |
| Datos | 270 productos (5 con costo 0, 2 inactivos), 33 servicios (S/10–S/350), 69 clientes, 127 ventas (114 activas, 13 anuladas, máximo `VEN129`), 47 citas (13 pendientes), 0 pedidos web activos (2 cancelados), 6 usuarios de personal |
| Cupones | 3: `FIDELIZACION` 20 % DISPONIBLE, `REFERIDO_BIENVENIDA` S/10 DISPONIBLE, `REFERIDO_RECOMPENSA` S/5 ANULADO. 1 promoción (30 %, inactiva) |
| Configuración | `config_puntos` 30/10, 1 por visita, 0,05 por sol; `config_referidos` 10/5; `config_fidelizacion` 20 % |
| Storage | 9 buckets, 41 objetos, ≈ 3,6 MB (2 privados: `comprobantes-citas-web` y `comprobantes-pedidos-web`; 7 públicos) |
| Extensiones | sin `pg_cron`; Realtime publica `citas` y `estado_negocio` |

**Qué NO es cierto aunque lo parezca.** El historial de migraciones de producción (59 filas) no se numera como el de Local (145): son historiales distintos. **No hay «86 migraciones por aplicar».**

### Equivalencia del esquema de producción con las migraciones del repositorio

`supabase/sql/001–127` (heredado) ≡ `supabase/migrations/20260930… y 20261001…` (124 archivos). Se construyó en la instancia desechable un esquema con esas 124 migraciones y se comparó con producción mediante una **huella por categoría** (hash de cada función, columna, política, restricción, privilegio, índice, trigger, vista):

| Categoría | ¿Idéntica a producción? |
|---|---|
| Columnas (433), restricciones (178), políticas (124), índices (87), tablas (41), triggers (18), vistas (1) | **Sí** (huella igual; la deparse de `auth.uid()` coincide al usar el rol `postgres`) |
| Privilegios de tabla, columna y función | **Sí, tras reproducir los de producción** (ver abajo); con los privilegios por omisión de Local **no** |
| Funciones (72) | 70 idénticas; `anular_venta` y `confirmar_venta` difieren **solo en comentarios/una línea** (ninguna línea de producción falta en el repositorio). Ambas se reemplazan en las migraciones |
| `ventas.monto_pos_tarjeta` | producción `numeric` (sin precisión); el repositorio dice `numeric(10,2)`. **Deriva previa, sin relación con las 21 migraciones; no se corrige aquí** (el ensayo la reproduce) |

### Hallazgo estructural: los privilegios de producción NO son los de Local

En producción `postgres` crea las tablas con privilegios por omisión mínimos (`anon=Dxtm`, `authenticated=Dxtm`, `service_role=Dxtm`: **sin SELECT/INSERT/UPDATE/DELETE**) y las funciones solo con `postgres` (sin PUBLIC). `anon` no tiene acceso de datos a ninguna tabla; `productos` concede SELECT por columna (26 columnas, **sin `costo`**) y `authenticated` solo `awd` sobre la tabla. En Local (CLI) todo se concede a `anon/authenticated/service_role`. Consecuencia: **un objeto nuevo funciona en producción solo si su migración lo concede explícitamente**. El ensayo aplica las migraciones con **estos privilegios de producción** (`ensayo-privilegios-produccion.sql`).

## 2. Migraciones realmente necesarias: exactamente 21, en este orden

Son los archivos fechados `20261002…`–`20261007…`. **Ninguno anterior** hace falta (el esquema previo de producción equivale a ≤ `20261001`). **No se ejecutan «todas las del repositorio».** Cada archivo ya trae su `begin; … commit;` (transaccional). En producción se aplica con `apply_migration` usando como `name` el nombre del archivo (la `version` la asigna Supabase; seguirá sin coincidir con la del archivo, como ya ocurre hoy).

| # | Archivo | Qué hace | Funciones (firma) | Datos / privilegios |
|---|---|---|---|---|
| 1 | `20261002000001_guardar_cita_pos` | QA-004: guardar cita (crear/editar) atómico | **nueva** `guardar_cita_pos(uuid,uuid,text,uuid,timestamptz,text,numeric,jsonb)` | `revoke public/anon`, `grant authenticated` |
| 2 | `20261002000002_fidelizacion_dia_lima` | QA-012: visitas por día de Lima (no por instante) | reemplaza `generar_cupon_fidelizacion`, `mi_fidelizacion`, `mi_historial_fidelizacion`, `mis_puntos` (misma firma) | ninguna escritura al aplicarse (el `update clientes` está dentro de `generar_cupon_fidelizacion`, solo corre cuando una clienta reclama) |
| 3 | `20261002000003_pedidos_cupones_ambiguedades_pago` | QA-005/019/009: cupón de promoción y cupón en Caja; verificar pago de pedido web | reemplaza `confirmar_venta`, `reclamar_cupon_promocion`, `verificar_pago_pedido_web` | **re-crea el CHECK `ventas_metodo_pago_check`** (`Efectivo, Tarjeta, Transferencia, Yape, Plin`); producción ya lo tiene idéntico y sus 127 ventas lo cumplen |
| 4 | `20261002000004_anular_venta_concilia_pedido_web` | QA-027: anular una venta de pedido web cancela el pedido | reemplaza `anular_venta`; **nueva** `validar_pedido_web_venta_vigente` | trigger nuevo `trg_validar_pedido_web_venta_vigente` |
| 5 | `20261002000005_resumen_dashboard_envio_separado` | QA-031: el envío cobrado es una línea propia | `resumen_dashboard` (**DROP + CREATE**, devuelve además `envio_cobrado`; las 8 columnas anteriores se conservan) | queda con PUBLIC execute, igual que hoy |
| 6 | `20261002000006_es_admin_siempre_boolean` | QA-034: `es_admin()` nunca devuelve NULL | `es_admin` | — |
| 7 | `20261002000007_ventas_solo_admin_cajera` | QA-033: solo ADMINISTRADOR/CAJERA venden y anulan | `confirmar_venta`, `anular_venta` | política `ventas_insert` restringida a esos roles |
| 8 | `20261002000008_agregar_stock_solo_admin_cajera` | QA-035: solo ADMIN/CAJERA agregan stock; el historial solo lo escribe la RPC | `agregar_stock` | elimina la política `movimientos_insert` |
| 9 | `20261003000001_recompensas_fase2_nucleo` | libros de monedas/sellos, configuración, protección, catálogo, canjes | 11 funciones nuevas (`canjear_*`, `mi_*_recompensas`, `recompensas_*`) y reemplaza `confirmar_venta`/`anular_venta`/`generar_cupon_fidelizacion` | **8 tablas nuevas** (`recompensas_*`, `servicios_proteccion`) con RLS y GRANT explícito; **10 columnas nuevas en `cupones`** (`vigente_hasta`, `alcance`, `tope`, …, todas NULL en los cupones existentes); `recompensas_config` nace **`activo=false`, `corte=null`** |
| 10 | `20261003000002_recompensas_fase2_correcciones` | QA-033/041 y reparto de centavos | `confirmar_venta`, `anular_venta`, `recompensas_distribuir`, `_recompensas_emitir_canje` | — |
| 11 | `20261003000003_recompensas_simulacion_transicion` | simulación de solo lectura de la conversión ×5 (solo ADMIN) | `recompensas_simular_transicion[_resumen]` | **no escribe nada** |
| 12 | `20261003000004_recompensas_lectores_portal` | `mis_puntos`/`mi_fidelizacion`/`mis_cupones` coherentes con el libro cuando el programa esté activo | reemplaza esas 3 (misma firma; **`mis_cupones` DROP + CREATE con 10 columnas más**) y **nueva** `catalogo_recompensas_publico` | con el programa apagado devuelven lo mismo que antes |
| 13 | `20261004000001_ventas_codigo_mas_de_999` | QA-045: código de venta desde la 1000 | `confirmar_venta` | **no urgente**: producción va en `VEN129` |
| 14 | `20261005000001_cupones_proteccion_global` | regla global de protección del carrito para cupones | `confirmar_venta`; nuevas `proteccion_servicios_estado`, `recompensas_proteccion_*` | tablas nuevas `productos_proteccion`, `recompensas_venta_proteccion`; `servicios_proteccion.asistente_pct` |
| 15 | `20261005000002_cupones_validacion_pedido` | QA-054: validar el cupón antes de pedir el pago | `confirmar_pedido_productos`, `confirmar_venta`, `verificar_pago_pedido_web`; nuevas `recompensas_evaluar_cupon`, `recompensas_validar_cupon_pedido`, `recompensas_motivo_cliente`, `vista_previa_cupon_pedido` | — |
| 16 | `20261005000003_pedido_cantidades_total_anunciado` | QA-057: el pedido debe coincidir con lo anunciado | **cambia la firma** de `confirmar_pedido_productos` (13 → 15 parámetros; los 2 nuevos con `DEFAULT NULL`; la firma anterior se elimina) y `vista_previa_cupon_pedido` (3.º parámetro con default) | **concede EXECUTE a `anon` y `service_role`** de `confirmar_pedido_productos` (hoy solo `authenticated`) → ver §5 |
| 17 | `20261005000004_recompensas_reglas_publicas` | lectura pública de las reglas vigentes («Cómo funciona») | **nueva** `recompensas_reglas_publicas` (anon + authenticated; todo nulo con el programa apagado) | — |
| 18 | `20261006000001_resenas_inicio` | reseñas con fecha y servicio en Inicio | **nueva** `resenas_inicio` | — |
| 19 | `20261006000002_equipo_duena` | Nosotros/Equipo | reemplaza `equipo_para_web`; nueva `asistentes_validar_duena` | **5 columnas nuevas en `asistentes`**, índice único parcial, trigger `asistentes_validar_duena` |
| 20 | `20261007000001_cupones_promocion_vencimiento` | QA-075: la vigencia de una campaña limita el uso del cupón | `reclamar_cupon_promocion` | solo cupones **nuevos** reciben vencimiento |
| 21 | `20261007000002_reclamar_cupon_promocion_idempotente` | QA-075: doble clic simultáneo | `reclamar_cupon_promocion` | — |

**Dependencias.** Cada migración usa objetos de las anteriores: 9 crea la base de 10, 12, 14, 15, 17; 14 la necesitan 15 y 16; 20 y 21 reemplazan la `reclamar_cupon_promocion` que deja 3. **No se pueden aplicar fuera de orden ni a medias**: se aplican las 21 o ninguna (cada archivo es atómico; el conjunto se ensayó 2 veces seguidas sin error, 21/21).

### Resumen del cambio de esquema (ensayo: producción-equivalente → POST)

* Funciones: **28 nuevas**, **13 reemplazadas con la misma firma** (`agregar_stock`, `anular_venta`, `confirmar_venta`, `equipo_para_web`, `es_admin`, `generar_cupon_fidelizacion`, `mi_fidelizacion`, `mi_historial_fidelizacion`, `mis_cupones`, `mis_puntos`, `reclamar_cupon_promocion`, `resumen_dashboard`, `verificar_pago_pedido_web`), **1 con firma cambiada** (`confirmar_pedido_productos`), 58 sin cambios.
* Tablas: 10 nuevas; columnas nuevas: 10 en `cupones`, 5 en `asistentes`; **ninguna columna se elimina ni cambia de tipo**.
* Políticas: `ventas_insert` restringida a ADMIN/CAJERA; `movimientos_insert` eliminada; políticas nuevas solo sobre tablas nuevas.
* Storage, Auth y Realtime: **sin cambios** (las migraciones no tocan `storage.*`).

## 3. Efectos sobre datos, permisos y reglas existentes

**Datos.** Huella (conteo + md5 de un subconjunto de columnas de negocio, **no** del contenido completo; alcance y límites en `RESULTADO-ENSAYO.md` §3) de 17 tablas **sin cambios antes y después** de las 21 migraciones: productos, servicios, clientes, ventas, venta_items, citas, cita_servicios, registro_servicios, cupones, promociones, pedidos_web, config_*, usuarios, asistentes, porcentajes. Las lecturas del portal (`mis_puntos`, `mi_fidelizacion`, `mi_historial_fidelizacion`, `mi_estado_referidos`, `mi_codigo_referido`, `resenas_publicas`, `datos_contacto`, `horario_atencion`) y de los paneles (`resumen_estadisticas`, `resumen_historial`, `resumen_inventario`, `resumen_asistentes_periodo`) devuelven **los mismos valores**. Cambios aditivos: `mis_cupones()` +10 columnas, `resumen_dashboard()` +`envio_cobrado`. (`servicios_mas_pedidos` desempata de forma inestable incluso entre dos lecturas del mismo estado; no es efecto de la actualización.)

**Reglas que cambian de comportamiento (defectos corregidos, ver `RESULTADO-ENSAYO.md`)**

| Regla | Antes (producción hoy, medido en el ensayo) | Después |
|---|---|---|
| Cupón en Caja | **falla** con «column reference "codigo" is ambiguous» (QA-019) | funciona |
| «Verificar pago» de un pedido web | **falla** con «violates check constraint ventas_metodo_pago_check» (QA-009: el pedido guarda `YAPE`, la venta exige `Yape`) | funciona |
| ASISTENTE vende / anula | **permitido** por API | rechazado |
| ASISTENTE agrega stock | **permitido** por API | rechazado |
| Cupón sobre producto de costo 0 sin confirmar | (no existía la regla) | **bloqueado** («falta registrar el costo de compra…») |
| Cupón sobre servicio sin protección configurada | sin tope | tope del 50 % del precio por partida; regla global del carrito |
| Anular venta de pedido web | el pedido seguía «LISTO» | el pedido pasa a CANCELADO |
| `confirmar_pedido_productos` sin `p_cantidades`/`p_total_esperado` | — | sigue aceptando la llamada de 13 parámetros (los 2 nuevos son opcionales); sin ellos **no** se verifica la cantidad anunciada (solo el frontend nuevo la envía) |

## 4. Programa nuevo frente a lo heredado (qué sigue funcionando con el programa apagado)

`recompensas_config`: **`activo=false`, `corte=null`**, 0 movimientos, 0 aportes, 0 canjes (ensayo, tras las 21 migraciones y tras todas las pruebas). No se ejecutó la apertura, la conversión ×5 ni la activación.

* **Sigue igual (heredado):** puntos por visita/gasto (`config_puntos`, fórmula antigua), niveles Básico/Premium/VIP por los umbrales 10/30, tarjeta y sellos de fidelización (`config_fidelizacion`, cupón del 20 %), referidos (`config_referidos`, S/10 y S/5), promociones por fechas, y el canje de cupones existentes en Caja y en el pedido web.
* **Nuevo pero inactivo:** libro de monedas y de sellos, catálogo de premios, canje definitivo, protección económica por servicio/producto (esta **sí** afecta a los cupones aunque el programa esté apagado: ver `REVISION-CUPONES-PROTECCION.md`), reglas públicas y lectores (todo nulo/vacío mientras `activo=false`).
* **Riesgo de activación accidental:** la RPC `recompensas_establecer_activo(boolean)` permite a un ADMINISTRADOR encender el programa desde Recompensas Web y fija `corte = now()` **sin** haber hecho la apertura. Se propone retirar su permiso hasta el día de la apertura (`propuesta-correctivas-privilegios.sql`, punto 2, decisión del propietario).

## 5. Hallazgos que requieren decisión antes de publicar

1. **`confirmar_pedido_productos` queda ejecutable por `anon` y `service_role`** (la migración 16 lo concede; en producción hoy solo `authenticated`). Probado: una llamada sin sesión responde «Completa tu perfil antes de confirmar un pedido.» y **no crea nada**; aun así es una ampliación innecesaria. Corrección propuesta y ensayada: `propuesta-correctivas-privilegios.sql` (punto 1). **No se editó ninguna migración existente.**
2. **Activación accidental** (ver §4). Propuesta y ensayada: punto 2 del mismo archivo.
3. **Orden frontend/backend obligatorio:** el frontend nuevo contra el backend actual produce 404/400 (ver `RESULTADO-ENSAYO.md`): primero el backend, luego el frontend.
4. **Bundles/PWA antiguos abiertos** seguirán llamando `confirmar_pedido_productos` con 13 parámetros: funciona, pero sin la comprobación de cantidad anunciada hasta que se actualicen (la PWA usa `registerType: 'prompt'`: el usuario decide cuándo actualizar).
5. **Deriva `monto_pos_tarjeta`** (numeric vs numeric(10,2)): informativa; no bloquea.

## 6. Lo que NO incluye esta actualización

La apertura/conversión histórica ×5, la activación del programa, el catálogo real de premios, la revisión económica de monedas, la elegibilidad específica de premios y cualquier cambio de datos en producción. Siguen siendo lotes separados y requieren autorización propia.
