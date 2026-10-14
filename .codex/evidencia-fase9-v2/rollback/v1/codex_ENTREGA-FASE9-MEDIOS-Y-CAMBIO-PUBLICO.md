# Entrega Fase 9 · Medios existentes y preparación del cambio público

Fecha: **2026-10-12**, America/Lima. Rama `feat/cloudflare-pages`, HEAD `6929c619`, árbol local sin commit (Fases 4–9). Autorización del usuario: inventario, diseño de migración, herramientas y simulación local **sin cambios remotos**; conservar originales y preparar el rollback; dominio propio a futuro. **No incluye** commit, push, migración de datos reales, cambio de hosting ni retiro de GitHub Pages, y no se hizo nada de eso.

Antes de empezar se cerró la Fase 8 según la revisión de Codex (aprobada con observaciones, solo local): `CIERRE-FASE8-OBSERVACIONES.md` y el caso O1 incorporado a `verificar-fase8-v2.cjs`.

## 1. Alcance completado

| Pedido del plan | Entregable |
| --- | --- |
| Inventario por tipo/proveedor y clasificación de privacidad | `scripts/migracion-medios/inventario.sql` (solo lectura, portable) + `inventariar`. Informe de Local: [INVENTARIO-MEDIOS-FASE9.md](INVENTARIO-MEDIOS-FASE9.md) |
| Manifiesto con origen, destino, tamaño, checksum confiable y estado | `planificar`: SHA-256 de los **bytes descargados** (el eTag queda solo como dato informativo), medidas, UUIDv5 determinista, diario de referencias. Diseño: [DISENO-MIGRACION-MEDIOS-FASE9.md](DISENO-MIGRACION-MEDIOS-FASE9.md) |
| Simulación previa sin cambios | Sin `--aplicar`, ningún comando escribe fuera del manifiesto y la caché (probado: base y R2 sin cambios) |
| Copia por lotes reanudable, sin duplicados | `copiar --aplicar --lote=N` por el Worker de la Fase 3 (solo crea, nunca sobrescribe); verificación byte a byte por lectura; reanudación con 200 «reanudado» o 409 + SHA-256 coincidente |
| Verificar bytes y variantes; actualizar referencias en lotes controlados | Variantes `m` 320 px y `g` 1400 px validadas con el validador del Worker. `actualizar`: UPDATE **condicional** al valor anterior, con conflicto si alguien editó la fila |
| Lectura mixta mientras exista contenido viejo | Ya existe (Fase 3); la simulación la comprueba en la app con fotos de R2 y de Supabase a la vez |
| Conservar originales y referencias para la reversión | La herramienta **no tiene borrados**; `revertir` es condicional; el manifiesto es el diario |
| Plan de dominio, DNS/TLS, `/PosJaise/`, canonical/sitemap, Auth, enlaces, sesiones, carritos y comunicación | [PLAN-CAMBIO-PUBLICO-FASE9.md](PLAN-CAMBIO-PUBLICO-FASE9.md) |

## 2. Hallazgo que condiciona el orden: puerta de compatibilidad

GitHub Pages publica `main`, que **no tiene** el código que lee referencias `r2:`. Con una referencia migrada, el bundle de `main` pide `…/object/public/fotos-productos/r2:fotos-productos/<id>` y recibe **400** (`evidencia-fase9/compatibilidad-main-r2.txt`). Lo mismo le pasaría a una PWA instalada con un bundle antiguo. Por eso:

- la **copia** a R2 puede hacerse antes, sin efecto visible;
- la **actualización de referencias en producción** queda para **después de la Fase 10B**, con el frontend nuevo publicado y observado y GitHub Pages redirigido o reconstruido con lectura de R2;
- la reversión del hosting necesita un build de reversión que lea R2, o revertir antes las referencias.

## 3. Pruebas y resultados

| Comando | Resultado |
| --- | --- |
| `node scripts/migracion-medios/probar-lib.mjs` | **12/12**. Incluye: vector UUIDv5 de la RFC 9562, clasificación de cada formato visto, privados y perfiles nunca migrables, guardas de ambiente y producción, argumentos estrictos, invariantes del manifiesto, **ausencia estática de borrados** y un único UPDATE condicional |
| `node scripts/migracion-medios/simular-fase9.mjs --cuentas=… --trabajo=…` | **18/18** (corrida final, `evidencia-fase9/simulacion-local.{json,log}`) |
| `npx oxlint scripts/migracion-medios` | sin diagnósticos |
| `verificar-fase8-v2.cjs --solo=O1` (cierre de la Fase 8) | 1/1 |

La simulación usa Supabase Local + el **Worker de medios en `wrangler dev --local`** (R2 simulado en disco, ligado al Supabase Local) + la app en Vite dev leyendo de ese R2. Casos:

1. Inventario, planificación y variantes en solo lectura sobre **todo** el dataset de Local: base sin cambios.
2. El inventario con fixtures clasifica: referencia rota, archivo corrupto, GIF, recurso del build, URL de galería que apunta al bucket **privado** (no aparece con su valor) y la foto compartida.
3. Planificar: SHA-256 = bytes en caché; **3 filas que usan el mismo objeto → 1 copia**; el corrupto se descarta con un evento; repetir no añade nada.
4. Sin `--aplicar`: 0 objetos en R2. `g` del WebP chico es el original sin recodificar, el PNG conserva el **alfa** y el ruido de 960 px baja `g` a calidad 70. El de 1300 px **no cabe**: queda en error y su referencia no se toca.
5. Bloqueo por `.lock`.
6. Guardas: Worker remoto y Supabase de **producción** rechazados antes de autenticar.
7. App **antes**: fotos de los fixtures desde Supabase, cargadas.
8. Copia en 2 lotes: 7 entradas verificadas, **exactamente 14 objetos** en R2 (m+g), nada de la que no cabe.
9. Reanudación tras «perder» el estado: 200 «reanudado», sin duplicar.
10. Reanudación por **otra** administradora: 409 aceptado solo porque el SHA-256 coincide.
11. Mismo id con **otro contenido**: error de conflicto, R2 sin cambios.
12. Actualizar en lotes de 3: una fila editada entretanto queda en `conflicto` y su edición se conserva; las filas preexistentes de Local, intactas.
13. `verificar`: referencias = manifiesto, R2 = SHA-256 y **originales intactos** en Supabase.
14. App **después**: producto (2 fotos), servicio y galería (antes/después, con URL completa) **cargan desde R2**; la ficha con foto rota no se rompe.
15. Revertir en lotes: 8 referencias revertidas; la editada tras migrar queda en `conflicto-reversion` sin pisarse; `verificar` OK; R2 conserva sus 14 objetos.
16. App tras revertir: todo vuelve a Supabase.
17. Limpieza de fixtures y del R2 simulado.
18. Estado final de Local: **huella de los valores de medios preexistentes idéntica** y 441 objetos de Storage, como al inicio.

Corridas anteriores conservadas, sin reclasificarlas como éxito:
- `simulacion-local-corrida1.json` (17/18): `fetch failed` en el primer contacto con el Worker recién arrancado.
- `simulacion-local-corrida2.json` (17/18): una aserción mía recorría la entrada sin variantes; corregida.
- `simulacion-local-corrida3.json` (18/18): previa a cambios menores de la biblioteca.

En todas las corridas que lo registran, la primera petición al Worker local respondió `ECONNRESET` y se recuperó al reintentar. Queda en `reintentosRed`; es un comportamiento del arranque de `wrangler dev`, no de la herramienta.

## 4. Cambios en datos, recursos y cómo limpiarlos

- **Remotos:** ninguno. No se leyó ni escribió staging, producción, R2 real, el Worker de staging, Pages ni DNS.
- **Local:** cada corrida crea fixtures `QA-F9-<marca>` (filas en `productos`, `producto_fotos`, `servicios`, `servicio_fotos`, `galeria_web` y 10 objetos en los 3 buckets públicos) y **los elimina al terminar** (comprobado: 441 objetos y huella idéntica). Quedan **84 filas en `auditoria`** (21 por corrida, 4 corridas: 25.860 → 25.944) por los triggers de `productos` y `servicios`. No se borraron, para no alterar la auditoría. Si se quisieran retirar: `select … from auditoria` filtrando por los nombres `QA-F9-%`.
- El R2 simulado y la caché viven en la carpeta temporal de trabajo y se borran al terminar. El `.dev.vars` del Worker no se tocó (las variables se pasan con `--var`).
- No hay migraciones SQL ni cambios de configuración de infraestructura. **No cambió el código de la app** (`src/`); solo hay herramientas nuevas en `scripts/migracion-medios/` y documentos.

## 5. Medidas

No aplica una medida de rendimiento de la app: la fase no cambia el frontend. De los 10 objetos reales de Local, el `g` sale sin recodificar (0 pérdida) y el `m` pesa entre 1,3 y 13,9 kB. La duración de la copia contra R2 real **no se midió** (sin R2 real); en local la simulación completa tarda unos 2–3 minutos con un navegador.

## 6. Rollback de esta fase

Fase solo aditiva: borrar `scripts/migracion-medios/` y los documentos y evidencias nuevos de `.codex` (`DISENO-MIGRACION-MEDIOS-FASE9.md`, `INVENTARIO-MEDIOS-FASE9.md`, `PLAN-CAMBIO-PUBLICO-FASE9.md`, esta entrega, `evidencia-fase9/`), la sección §53 de `implementacionesWed.md` y la fila 9 del registro. El cierre de la Fase 8 es independiente: `CIERRE-FASE8-OBSERVACIONES.md` y el caso O1 (`verificar-fase8-v2.cjs`, manifiesto `evidencia-fase8-v2/rollback/` actualizado). El rollback de una **migración real** es `revertir --aplicar` sobre su manifiesto (diseño §5); los originales siguen en Supabase.

## 7. Pendientes concretos

1. **Decisiones del usuario:**
   - dominio propio, o publicar sobre pages.dev y aceptar dos cambios de origen;
   - periodo de reversión de los medios (propuesta: al menos 30 días tras actualizar referencias y nunca antes de cerrar 10B);
   - perfiles (usuarios, clientas, equipo) y QR: migrar después o mantener en Supabase;
   - horario y comunicación del cambio.
2. **Inventario real del negocio:** ejecutar `inventario.sql` (solo lectura) en producción, con autorización. Local no representa producción: tiene 10 objetos migrables.
3. **Rollback ejecutable en staging** (lo pide la verificación del plan): la herramienta lo permite (`--permitir-remoto`), pero exige autorización de escritura en staging, que esta fase no tenía.
4. Infraestructura de medios de producción (bucket, Worker y Function con B) y el build de reversión para GitHub Pages: Fase 10.
5. Límites: orientación EXIF de JPEG antiguos, que detecta la muestra visual; ediciones concurrentes, que quedan en conflicto y no se pisan; caché local proporcional al volumen.

**Cómo preparar cuentas QA de forma segura:** la simulación usa las cuentas ficticias `qa-…@test.local` de Local desde un JSON fuera del repositorio. La herramienta toma la cuenta de administración de `MIGRACION_EMAIL`/`MIGRACION_PASSWORD` y nunca la escribe en el manifiesto ni en los informes (comprobado: sin tokens ni contraseñas en `evidencia-fase9/`).

Fase 9 lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario.
