# Pages Functions: PFM-01 cerrado y paquete local aprobado

Fecha: 10 de octubre de 2026, America/Lima. Codex: QA de solo lectura.

## Veredicto

**PFM-01 queda cerrado. La implementación local está APROBADA dentro del alcance revisado, sin nuevos bloqueos encontrados.** Puede prepararse el paquete de commit de la rama de pruebas y su validación reproducible, cuando el usuario autorice esas acciones. No se aprueba todavía la entrega real de Cloudflare ni el cierre completo de Fase 3 o producción.

Repetí 94 casos de las suites existentes, todos correctos, y nueve diagnósticos independientes. El lint dirigido de once archivos pasa sin diagnósticos. No cambié código, Git, datos ni recursos externos; solo se crean este informe y su evidencia en `.codex` según la instrucción persistente del usuario.

## Corrección de PFM-01 confirmada

La lectura de `objeto.arrayBuffer()` está ahora protegida por su propio try/catch. Un fallo de bytes después de obtener correctamente los metadatos devuelve 503, `Cache-Control: no-store`, nosniff/noindex y el mensaje genérico «No disponible». No se devuelve 404 ni se propaga el error interno, y no se llama a cache.put.

Repetí mi reproducción original contra la función real y un doble en memoria: GET con cuerpo fallido devuelve 503 con cero escrituras de caché; tras recuperar el cuerpo, el siguiente GET devuelve 200 con los bytes esperados y permite almacenar la representación válida. La nueva suite también incluye esa secuencia.

## Observaciones anteriores atendidas

- **HEAD:** el MISS usa `head()` cuando existe. Si no existe, usa get sin consumir arrayBuffer. Los dos casos independientes respondieron 200 con cero consumos de cuerpo y cero escrituras de caché; el cuerpo del doble estaba diseñado para lanzar si se consumía. HEAD desde HIT conserva el comportamiento probado. La mejora se verifica localmente; no se midió el binding real de Cloudflare.
- **HEAD de error:** ruta inválida, binding ausente y objeto ausente devolvieron 404 sin bytes; fallo de metadatos devolvió 503 sin bytes. Todos conservan no-store y nosniff/noindex. El 405 mantiene Allow en la suite.
- **SW:** `swExcluyeMedios` comprueba denylist y la expresión específica. Repetí los negativos de assets que contienen «medios», patrones distintos, denylist vacía y allowlist. El build importa el helper y falla si devuelve false. No se exige aquí un parser general de JavaScript: es una comprobación acotada al formato generado.
- **Transición:** §19b deja explícito `VITE_MEDIOS_BASES_RECONOCIDAS`, además de la URL pública. Sigue sin configurarse. La validación anterior de reconocimiento de ambas bases y de rechazo de hosts ajenos permanece pasando.
- **Rollback:** §19b separa los ocho archivos nuevos y los hunks de cuatro archivos de código/configuración, además de las adiciones documentales. La generación y comprobación del parche exacto queda para preparar el commit. No se ejecutó rollback ni se restauraron archivos completos. Después de escribir URLs de Pages en Galería, debe seguir respetándose el rollback de datos acordado: no retirar Function/binding con referencias vivas.

## Pruebas repetidas por Codex

| Prueba | Resultado |
| --- | --- |
| `probar-entrega.mjs` | 37/37, cero fallos |
| `verificar-urls-medios.mjs` sin SW_REAL | 15/15, cero fallos |
| `verificar-guardas-interfaz-r2.cjs` | 42/42, cero fallos |
| oxlint dirigido a once archivos | Exit 0, sin diagnósticos |
| Diagnósticos independientes | Nueve comprobaciones, cero fallos |

**Precisión sobre los 16 casos de Claude:** el caso 16 depende de SW_REAL y de que exista el archivo indicado. En mi ejecución sin esa variable se ejecutan 15, incluidos los controles del helper. No afirmo haber repetido ese caso contra un SW nuevo de Cloudflare.

Leí los artefactos disponibles: `dist/sw.js` tiene manifest con scope `/PosJaise/` y el helper devuelve false, lo esperado para el build de GitHub Pages. `dist-preview/sw.js` es un artefacto anterior, del 9 de octubre, que tampoco contiene la exclusión. No es evidencia del build nuevo y no se presenta como un fallo de la implementación actual. Sus hashes quedan registrados para distinguirlos.

No repetí el build de Cloudflare, `wrangler pages dev` ni la corrida de 24 casos. El build que Claude reporta correcto no se atribuye a una ejecución de Codex. La aceptación local de la corrección descansa en el código revisado, las suites repetidas y la reproducción independiente; la validación del commit exacto y su artefacto siguen siendo el paso previo al push acordado.

## Alcance del siguiente paso

Claude puede preparar una lista explícita del paquete, su commit y validación desde checkout limpio con el permiso del usuario; el push debe limitarse a `feat/cloudflare-pages`. No incluir `.env`, informes de `.codex` ni cambios ajenos al paquete. El parche de rollback debe corresponder al estado exacto que se publique.

Después se configura **solo Preview**, con autorización humana aplicable, el binding MEDIOS al bucket de pruebas y las variables de entrega/transición. El cambio debe realizarse cuando la Function esté disponible y antes de verificar un build nuevo con marca exacta. No cambiar la URL ahora por iniciativa de esta revisión.

Quedan pendientes de verificación real: head del binding, Cache API/HIT/MISS y borrado según TTL, CPU/cuota, recorrido UI con la nueva base, PWA de medios, rollback de filas ficticias, fotos reales, otros navegadores/móvil y carga. La purga, recolector, migración inversa y criterios del negocio conservan su estado anterior. El dominio propio sigue siendo opcional y futuro.

Evidencia nueva: `.codex/evidencia-implementacion-medios-pages-v2/diagnosticos-medios-pages-v2.json` y reproducción `.txt`. El JSON contiene resultados, hashes de los once archivos revisados y de los artefactos leídos. Todo el diagnóstico usa datos ficticios en memoria; no autentica ni escribe en Supabase/R2.
