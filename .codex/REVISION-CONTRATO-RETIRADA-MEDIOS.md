# Revisión local del contrato de retirada de medios

Fecha: 10 de octubre de 2026. Revisor: Codex, QA de solo lectura.

**Veredicto: implementación local aprobada para continuar con la adaptación de los verificadores. Sin hallazgos bloqueantes en el código revisado.** Esto no aprueba el despliegue, la activación de B, pruebas con escritura remota ni el contrato de producción.

## Identidad y alcance

HEAD leído: `08a740e9ff39646161ea9c45ea2fe37866d5758f`. Se revisó el diff local sin confirmar de `cloudflare/medios-pages/entrega.js` y `cloudflare/medios-pages/test/probar-entrega.mjs`, los dos envoltorios de Functions, el diseño no versionado y las aserciones de los dos verificadores reales. No se comprobó nuevamente el deployment en esta revisión; el código local no equivale al artefacto publicado.

SHA-256 de las fuentes examinadas:

| Archivo | SHA-256 |
|---|---|
| entrega.js | `8c12603133e1c217831f42a95ee7889034b64c4a992289fff733683379610e66` |
| probar-entrega.mjs | `bf8aa5392645bdfc938c2dc9028cb08226a2840c1c0d80865355b9d6a5e1f627` |

## Validación ejecutada por Codex

- `node cloudflare/medios-pages/test/probar-entrega.mjs`: **48 casos, 0 fallos, exit 0**.
- `oxlint` de los dos archivos modificados: **sin diagnósticos, exit 0**.
- Diagnóstico independiente con dobles propios en memoria: **14 casos, 0 fallos, exit 0**. Evidencia en `evidencia-contrato-retirada/diagnostico.json`; reproducción en `diagnostico.txt`, conservada como texto para no añadir ejecutables al proyecto.

Los 14 casos complementarios comprueban: separación de las dos políticas; A por defecto; B sin `head()`; HEAD y condicionales tras borrar; fallos de `get`, `head`, `cache.match`, `cache.put` y `cache.delete`; y reemplazo real de bytes/ETag seguido de HIT y de 304. El reemplazo no se aceptó solo por una cabecera: se compararon los bytes nuevos de la respuesta, de la copia almacenada y del siguiente HIT.

No se ejecutaron build, instalación, pruebas HTTP remotas ni ensayos contra Supabase/R2 reales. Las pruebas no usaron red ni credenciales. Codex no modificó código, configuración ni datos, y no hizo commit o push.

## Comportamiento corroborado

- Respuestas al cliente: `public, max-age=0, must-revalidate` en 200/304/HEAD; copia positiva almacenada: `public, max-age=300`; errores: `no-store`.
- A conserva la copia de borde tras borrar en R2 hasta que expire. La nueva política del navegador no convierte A en retirada inmediata.
- `REVOCAR_CON_R2` sigue en `false`, y los envoltorios no fuerzan B. Cuando se fuerza en el diagnóstico, B consulta R2 antes de reutilizar la copia; ante ausencia responde 404 y ante fallo de metadatos responde 503. Un fallo del borrado local de caché no permite volver a servir esa copia en solicitudes posteriores con B.
- Con ETag distinto, GET recarga y reemplaza el cuerpo. HEAD no guarda un cuerpo vacío; un GET posterior actualiza la copia.
- B verifica futuras entregas; no constituye eliminación global de las copias. Mantiene las exclusiones declaradas para peticiones en vuelo, pestañas abiertas, copias con política anterior y acceso por `r2.dev`.

## Observaciones no bloqueantes y siguiente entrega de Claude

1. **Adaptar los verificadores antes de probar un nuevo artefacto.** `scripts/verificar-medios-pages-cache.cjs:142,150,163,168` y `scripts/verificar-interfaz-r2-preview.cjs:204` aún exigen `public, max-age=300` en la respuesta al navegador. Deben exigir la política nueva en GET/HEAD/304, conservando las comprobaciones de bytes, ETag, HIT/MISS, errores, aislamiento y limpieza. No confundir la cabecera externa con el TTL interno: mantener el ensayo de expiración por POP para el borde. La evidencia previa sigue identificando sus builds originales.

2. **Precisar el diseño vigente.** En `DISENO-CONTRATO-RETIRADA-MEDIOS.md`, §3 debe identificar los ~600 s como hipótesis de la política anterior de navegador de 300 s; no como ventana de la implementación local con `max-age=0`. No fijar una nueva garantía temporal sin medir, y conservar la excepción de peticiones en vuelo. §4 (“no probado”), §8 (“solo si se aprueba implementar”) y §9 (“no se tocó código”) necesitan distinguir el historial del estado local actual.

3. **304 no es incondicional.** La política obliga a revalidar una respuesta almacenada caducada. Una solicitud condicional recibe 304 cuando coincide el ETag; con ETag distinto o sin condicional puede recibir 200. Ajustar esa frase en el diseño y en el comentario de `entrega.js:16`. En `entrega.js:24`, el TTL positivo de 300 s corresponde al borde, no a la política nueva del navegador.

Claude puede preparar localmente los verificadores, sus regresiones y estas precisiones para nueva revisión. Esta aprobación no autoriza commit, push, reconstrucción, escrituras en staging ni cambios en Cloudflare. B sigue desactivada. Antes de producción quedan pendientes la decisión de la clienta sobre retirada, CPU/latencia/cuota y el alcance del acceso público de `r2.dev`.

## Límites de aceptación

Los resultados son de Node con R2/Cache simulados. No demuestran el comportamiento del caché real del navegador, el TTL efectivo de Cloudflare ni el costo de la revalidación. Tampoco cierran los demás pendientes de la Fase 3 ni habilitan el uso del Supabase del negocio.
