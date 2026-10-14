# Entrega Fase 7 · correcciones V2 (respuesta a REVISION-FASE7-SQL-V1.md)

Fecha: 2026-10-12. Base HEAD `6929c619`, rama `feat/cloudflare-pages`. Solo Supabase Local (54321). Sin commit, push, migraciones remotas, producción ni cambios de hosting. Fase 8 no iniciada. **No se modificó ninguna migración ni el rollback**: las dos migraciones (`20261012000001`, `…002`) y `rollback-fase7.sql` son los mismos archivos; las correcciones afectan a herramientas de medición, mediciones y documentación. `ENTREGA-FASE7-SQL.md` se conserva como histórico (solo se le añadió un aviso al inicio); sus cifras de Q03 y de costo de escritura **no** se reasignan: las vigentes son las de este documento.

## F7-01 · Q03 contaba un conjunto distinto del que paginaba — corregido

**Defecto (confirmado):** la página de Q03 hacía `INNER JOIN` con `clientes` filtrado por nombre, pero su `count(*)` solo aplicaba el estado. PostgREST (y por tanto la app) cuenta con el mismo filtro como `EXISTS` sobre `clientes`.

**Corrección:** `scripts/lib/consultas-fase7.cjs` (nuevo, compartido) construye página y conteo con **el mismo filtro**: la página usa el lateral `INNER`, el conteo `exists (select 1 from clientes c where c.nombre ilike … and c.id = p.cliente_id)`, igual que el SQL capturado de PostgREST. El medidor usa además un término de búsqueda **con coincidencias reales**, calculado de los datos (el nombre de pila más frecuente entre clientas con pedidos: «TEST», 90 pedidos ENTREGADO coinciden, en la réplica; «Ana», 4.285, en el ampliado). Antes el término `maria` no tenía ninguna coincidencia en la réplica, así que Q03 medía un caso degenerado.

**Regresión nueva:** `scripts/verificar-conteos-fase7.cjs` → `evidencia-fase7/v2/conteos-q03.json`, veredicto **CORRECTO**.
- **Parte A** (transacción con ROLLBACK, ejemplo mínimo de la revisión: entregado de «Zzqf7 Maria», entregado de «Zzqf7 Ana», listo de «Zzqf7 Maria»): 24 combinaciones estado × término. Para cada una, `total_result_set` del SQL medido == filas de su propia página sin límite. `ENTREGADO/zzqf7 maria` → 1, `LISTO/zzqf7 maria` → 1, `ENTREGADO/zzqf7` → 2, término inexistente → 0.
- **Control negativo:** el conteo antiguo del medidor da **2** en ese ejemplo y el correcto **1** (`discrepa=true`): la regresión habría fallado con el defecto.
- **Parte B** (solo lectura, datos reales): 16 combinaciones (4 estados × términos reales y uno inexistente); el conteo del SQL medido == filas de su página == conteo exacto devuelto por **`leerPedidos` de la app** (`src/lib/listasAdmin.js`, PostgREST, sesión de administración). 0 discrepancias.
- La base queda igual tras la parte A (429 pedidos, 4.749 clientas).

**Q03 repetida** (`q03-final-actual.*`, `q03-final-ampliada.*`; mediana, ms; «antes» = sin la Fase 7; ver F7-04 sobre la línea base):

| Escenario | Término (coincidencias) | Antes | Política (001) | 001 + 002 |
| --- | --- | ---: | ---: | ---: |
| Réplica local (429 pedidos) | TEST (90) | 25,0 | 5,8 | 5,4 |
| Ampliado sintético (60.429 pedidos) | Ana (4.285) | 7.600 | 120 | 37 |

(Q01/Q02/Q04 repetidas en la misma corrida: ampliado Q01 11.538 → 165 → 7,3; Q02 1.734 → 48 → 8,5; Q04 780 → 7,9 → 7,8.) Las cifras de Q03 de la entrega V1 (6.980 → 89 → 12 ms) quedan **históricas y no válidas** para la búsqueda: medían el conteo de otro conjunto.

**Ablaciones A/B con Q03 corregida** (ampliado, política + el índice indicado; `q03-abl-*.txt`): 

| Variante | Q01 | Q02 | Q03 | Q04 |
| --- | ---: | ---: | ---: | ---: |
| 001 sola | 165 | 48 | 120 | 7,9 |
| + A `(creado_en desc, id desc)` | 7,2 | 8,9 | 36,0 | 8,2 |
| + B `(estado, creado_en desc, id desc)` | 153 | 3,0 | 34,4 | 3,0 |
| + A y B | 8,0 | 3,2 | 35,3 | 2,8 |

Conclusión: **A sigue justificado** (Q01 165 → 7, Q03 120 → 36). **B no mejora Q03** (34–36 ms con o sin B) y sobre A solo ahorra ~5 ms en Q02 y Q04 (que la app lanza en el conteo por estado); sigue descartado, con esa cifra como contrapartida a valorar si en el futuro los conteos por estado pesaran más.

## F7-02 · ensayo del costo de escritura — rehecho; la cifra «+3 %» era ruido

**Defectos confirmados:** dos bucles separados (no alternados), el segundo tras crear índices y `ANALYZE`; no se fijaba ni validaba el estado de índices antes de cada muestra (en Local ya existen los tres, así que los lotes «sin» podían tenerlos); y el denominador era mayormente generación de filas.

**Hallazgo al corregirlo:** generar las filas del lote **sin insertarlas** tarda ≈ **29 s**, casi todo el «lote total» de ≈ 30 s del ensayo V1. Por eso aquel ensayo no podía ver el mantenimiento de índices: la diferencia de medianas (+3 %) no es distinguible del ruido. Se comprobó repitiendo el diseño antiguo ya con alternancia y condición validada (`costo-indices-v2-lote-con-generacion-2.json`): diferencias pareadas −2,7 / +2,6 / +1,4 / −2,9 % (media −0,4 %), es decir, sin señal.

**Nuevo diseño** (`scripts/costo-indices-fase7.cjs`, `evidencia-fase7/v2/costo-indices-v2.json`):
- orden contrabalanceado **sin, con, con, sin, sin, con, con, sin**; cada muestra se deshace con `ROLLBACK TO SAVEPOINT`;
- el estado de índices se **fija** antes de cada muestra (`DROP` de los tres / `CREATE` de la migración) y se **valida** con un `DO` que lanza excepción si el número de `idx_f7_*` no es el esperado (0 o 3); el script falla si algún supuesto no se cumple; las 8 condiciones quedaron registradas y válidas;
- las filas del lote (20.000 pedidos + 20.000 ítems + 40.000 cupones) se **pre-generan en tablas temporales fuera del cronómetro**; se cronometra solo el `INSERT … SELECT`;
- se comprueba al final que la base real es la de antes (4.749 / 429 / 429 / 3.067 / 25.860 auditoría, 3 índices, 0 marcas de prueba): `base_intacta=true`.

**Resultado:** tiempo del `INSERT` de 80.000 filas (ms):

| Orden | 1 sin | 2 con | 3 con | 4 sin | 5 sin | 6 con | 7 con | 8 sin |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ms | 352 | 590 | 925 | 512 | 409 | 623 | 698 | 472 |

Diferencias pareadas (con − sin, parejas adyacentes del diseño): **+238 / +413 / +214 / +226 ms**, es decir **+48 % a +81 % (media +62 %)** del tiempo del `INSERT`; medianas 472 → 698 ms. Los cuatro pares tienen el mismo signo. En términos absolutos son ≈ **+0,2 a +0,4 s por cada 80.000 filas insertadas en bloque** (≈ 3 µs por fila). Es una cota de laboratorio con `session_replication_role=replica` (sin triggers ni FK), en Local, tablas en caché y volumen ampliado: no se extrapola a producción. **Se retira la afirmación de la entrega V1** de que el costo era «≈ +3 %» y de que «el sobrecosto puro era ≤ 3 %»: el costo de mantener los tres índices en carga masiva es apreciable en términos relativos, aunque pequeño por fila (la operación real de la app inserta pedidos/cupones de uno en uno). Tamaños de los índices sin cambio: 2,4 / 2,9 / 8,7 MB (ampliado), 40 / 32 / 232 kB (réplica).

## Precisiones de la revisión, sincronizadas

1. **37** combinaciones consulta × contexto en cada JSON final (no 38).
2. El verificador tiene **14** tipos de consulta paginada (no 15): 19 objetos/firmas/RPC + 14 × 4 páginas + 8 escrituras = **83** comprobaciones por contexto, × 8 = **664**.
3. `solo_envoltorio` cuenta ahora **políticas distintas** (12), no una por fase «después» (antes 24). Verificador actualizado.
4. Los ocho «roles» son **ocho contextos de seguridad**: dos roles PostgreSQL (`anon`, `authenticated`) más los perfiles del negocio existentes (administración, cajera, asistente) y clientas; la cajera «inactiva» es una condición transitoria creada dentro de la transacción.
5. **Línea base.** Con las migraciones ya aplicadas en Local, el estado actual **no es «antes»**. `medir-fase7.cjs` y `verificar-fase7.cjs` incluyen ahora una guarda (`lineaBase` en `scripts/lib/consultas-fase7.cjs`): si detectan políticas o índices de la Fase 7, los **revierten dentro de la transacción de prueba** con `rollback-fase7.sql`, comprueban que el estado es el original (si no, abortan) y lo registran (`linea_base: "revertida dentro de la transaccion"` en los JSON v2). Todo se deshace con el ROLLBACK final. Con esto, repetir los medidores sobre la Local actual vuelve a medir un «antes» real. Los JSON de la entrega V1 se midieron antes de aplicar las migraciones al Local, con la base original.
6. `CREATE INDEX` normal y su bloqueo de escrituras: se deja para la planificación de migraciones remotas; no hay decisión de publicación aquí.
7. Lint: las **2 advertencias** de variables sin uso del medidor (`llamadasAntes`, `f`) se eliminaron; `oxlint` sin diagnósticos en los 6 scripts de la fase; `node --check` correcto.
8. Las migraciones 001/002 reflejan que `promociones_admin_todo` es **ALL**; la entrega V1 ya lo decía. No se describe la 001 como «solo SELECT».
9. Los helpers se evalúan una vez **por InitPlan/expresión de la sentencia**: una consulta compleja puede tener varios nodos (los JSON muestran 2–28 llamadas por consulta en el estado final, no una por helper). La entrega no promete «una llamada por helper».

## Verificación de seguridad repetida con línea base real

`verificar-fase7.cjs` repetido (`evidencia-fase7/v2/verificacion-roles-v2.json`, 594 s, `linea_base: revertida dentro de la transaccion`), veredicto **CORRECTO**: 8 contextos × 83 = 664 comprobaciones; tras la 001 **0** diferencias; tras 001 + 002 **0**; control negativo detectado con **76** diferencias; tras la reversión **0** diferencias y políticas idénticas a las originales; **12** políticas modificadas, **12** difieren solo por el envoltorio, 0 con estructura ajena; GRANT, definiciones de los tres helpers y RLS activo sin cambios; la base queda con las mismas filas tras el ROLLBACK.

## Estado de Local y archivos

- **Local (54321) sin cambios respecto de la entrega V1:** migraciones hasta `20261012000002`, 3 índices, 12 políticas modificadas. Conteos verificados al terminar: 429 pedidos, 429 ítems, 25.860 filas de auditoría, 3 índices `idx_f7_*`.
- **Nuevos:** `scripts/lib/consultas-fase7.cjs`, `scripts/verificar-conteos-fase7.cjs`; **modificados:** `scripts/medir-fase7.cjs`, `scripts/verificar-fase7.cjs`, `scripts/costo-indices-fase7.cjs` (reescrito); evidencia en `.codex/evidencia-fase7/v2/` (`conteos-q03.json`, `q03-final-*`, `q03-abl-{A,B,AB}.*`, `costo-indices-v2*.json`, `verificacion-roles-v2.*`, `cola.sh`). Preservados sin tocar: `ENTREGA-FASE7-SQL.md` (solo aviso inicial), `REVISION-FASE7-SQL-V1.md`, JSON y `.txt` de V1, `rollback-fase7.sql`, migraciones.
- Incidente de la entrega V1 (siembra confirmada por error y su limpieza): sin novedad; la revisión V1 confirmó los conteos y la ausencia de marcas. Esta corrida no escribió nada permanente (todas las pruebas con escrituras son transacciones con ROLLBACK, comprobado con `ESTADO` antes/después).

## Límites

- Todo es laboratorio en Supabase Local: réplica de pruebas (3.245 productos, que no son el catálogo real de ~300) y un escenario ampliado sintético; no hay medición de producción ni staging.
- El costo de escritura es de carga masiva con triggers y FK desactivados; el costo por fila real puede ser distinto.
- B se descartó por una ganancia pequeña (≈ 5 ms en Q02/Q04); no se midió su efecto en cargas mixtas lectura/escritura.
- Las búsquedas `ilike '%x%'` siguen lineales (Q03 ≈ 37 ms, Q10 ≈ 230 ms, Q14 ≈ 630 ms a escala ampliada); no se propone `pg_trgm`.
- Las políticas de otras tablas no se midieron ni modificaron. La reversión se probó dentro de transacciones, no ejecutándola sobre Local.
- Producción/staging, commit/push y la Fase 8 requieren decisión del usuario.
