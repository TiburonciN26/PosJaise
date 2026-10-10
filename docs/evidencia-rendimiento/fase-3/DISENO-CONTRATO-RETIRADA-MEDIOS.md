# Diseño local: contrato de retirada de medios (Pages `/medios` + R2)

Estado: **A (con política de navegador separada) y B (interruptor DESACTIVADO) implementados y probados SOLO en local** (48/48 en `probar-entrega.mjs`); sin commit, push, despliegue ni cambios en Cloudflare o Supabase, pendientes de revisión de Codex. Solo staging. Responde a `.codex/ESTUDIO-PURGA-MEDIOS-PAGES.md`.
Dominio propio: sigue siendo opcional y futuro; nada de este diseño lo exige.

## 1. Qué problema resuelve

Estado PUBLICADO en staging (build 08a740e9 y anteriores; la adaptación local posterior aún no está desplegada): `manejarMedios` consulta la Cache API **antes** que R2. Tras borrar un objeto, cualquier POP con copia fresca sigue sirviéndolo hasta que
expire (`max-age=300`), y el navegador puede reutilizar su propia copia otros 300 s sin contactar al servidor. Se observó en staging: los dos
objetos del ensayo de rollback respondieron HIT tras borrarlos y pasaron a 404 pasado el TTL (MIA). No hay un mecanismo de purga global
validado para `*.pages.dev` (el estudio de Codex lo deja como conclusión limitada, no como imposibilidad).

El contrato debe distinguir **cuatro cosas** que "retirar una foto" mezcla:

| Capa | Quién la controla | ¿Garantizable? |
|---|---|---|
| 1. Referencia en la web (fila `foto_url`/Galería) | La app, al guardar | Sí, inmediata (flujo ya existente: la fila se actualiza y el objeto viejo se borra después) |
| 2. Objeto en R2 | Worker autenticado (DELETE) | Sí, consistencia fuerte tras borrar |
| 3. Copia en caché de borde (Cache API, por POP) | La Function | Solo con el diseño B (comprobar R2 antes de servir) o esperando el TTL |
| 4. Copia en el navegador / página abierta | El cliente | No se puede borrar; solo acotar la reutilización futura con la política de `Cache-Control` |

Una purga nunca alcanza la capa 4 ni imágenes ya pintadas en una pestaña abierta.

## 2. Evento de retirada y URLs cubiertas

- **Evento:** el DELETE confirmado del objeto en R2 (después de que la fila ya no lo referencia, regla vigente "borrar el archivo viejo solo
  tras el guardado en BD"). El contrato se mide **desde ese DELETE**, no desde la edición en pantalla.
- **Cubiertas:** `https://<alias o dominio>/medios/<destino>/<uuid>/<m|g>.webp`. Cada origen (alias de rama, URL inmutable del deployment,
  producción) es una clave de caché distinta: el contrato aplica a todos los que sirvan la Function.
- **No cubierta:** la URL de respaldo `r2.dev` (sin Function, conserva `public,max-age=31536000,immutable`). Mientras exista como base
  reconocida para rollback, una foto retirada puede seguir en copias de `r2.dev`. Se documenta como limitación, o se deja de reconocer esa base
  cuando el rollback ya no se necesite. **Quitarla de las bases reconocidas NO desactiva su acceso público**: solo el cliente deja de
  tratarla como propia; para cerrarlo hay que desactivar el acceso público de pruebas del bucket (decisión y autorización aparte).

## 3. Opción A: retención temporal aceptada (menos invasiva)

- No cambia la lógica de **lectura** (caché antes de R2), pero **sí modifica la Function localmente**: separa las cabeceras del navegador (ver abajo). Se **documenta** el contrato: «tras el DELETE, la foto puede seguir viéndose hasta `TTL_borde +
  TTL_navegador`».
- Peor caso del código actual: la respuesta reconstruida no conserva `Age`/`Date` (diagnóstico local de Codex con `Age: 299` → HIT con
  `max-age=300` completo), así que un HIT casi vencido podría dar al navegador otra ventana completa. **Hipótesis a medir** (≈600 s) sobre la política ANTERIOR del navegador (`max-age=300`); NO es la ventana de la implementación local con `max-age=0`. No se fija una nueva garantía temporal sin medir; sigue la excepción de peticiones en vuelo y de copias con la política antigua. No
  garantía ni medición real.
- Mejora barata y compatible con A: **separar políticas.**
  - Copia almacenada en borde: `public, max-age=300` (como hoy).
  - Respuesta al navegador: `public, max-age=0, must-revalidate` + `ETag` → una copia caducada obliga a revalidar: con `If-None-Match` coincidente recibe 304 sin cuerpo; con ETag distinto o sin condicional puede recibir 200.
    Acota el navegador a ~0 s de reutilización ciega, al coste de una petición condicional por foto (ya cubierta por el camino 304 existente).
  - Efecto en rendimiento: se pierde la cuenta "sin tráfico" del navegador en visitas repetidas dentro de 5 min; se conserva el ahorro de
    cuerpo (304) y de R2 (HIT en el borde). Medir antes de adoptarlo.
- Cuándo basta: fotos de catálogo donde ver una foto retirada unos minutos no es un problema legal ni de privacidad.

## 4. Opción B: revocación comprobando R2 (ventana de borde ≈ 0)

Diseño candidato (historial: propuesto sin probar; hoy implementado y probado SOLO en local con R2/Cache simulados, desactivado, sin medir en Cloudflare):

1. En HIT y antes de responder 304, llamar `env.MEDIOS.head(clave)`.
2. Objeto ausente → 404 `no-store` (y `cache.delete(llave)` local, auxiliar, no se promete global).
3. `head` falla (excepción) → 503 `no-store`; **no** servir el cuerpo viejo como si la retirada estuviera validada.
4. ETag distinto al almacenado → tratar como MISS (nueva lectura y reemplazo de la copia). Hoy el UUID es único por foto, pero cubre un
   futuro reuso de clave.
5. Combinar con la política de navegador de §3 (`must-revalidate`), si no, el navegador sigue siendo ciego.

B **evita futuras entregas desde la Function; no borra globalmente las copias de caché** (el `cache.delete` es solo del POP que atiende).
Garantía propuesta: *toda petición que llegue a la Function después de un DELETE confirmado devuelve 404* (consistencia fuerte de R2). No
cubre: peticiones ya en vuelo (ver pruebas), copias del navegador frescas por política antigua, ni `r2.dev`.

Costos a medir antes de elegir:
- Un `head` (operación de lectura de R2) por petición en vez de cero en HIT: el HIT deja de ahorrar operaciones y solo ahorra transferencia de
  cuerpo/CPU de `get`. Revisar cuota (100.000 solicitudes/día compartidas de Functions) y operaciones R2 del plan.
- Latencia añadida por `head` en el borde.
- Carrera: GET en vuelo que leyó el objeto antes del DELETE y hace `cache.put` después. Mitigación: tras `put`, el siguiente acceso hace `head`
  y lo corrige (por eso B no depende del `put`); sin B, la carrera repuebla la copia por un TTL completo.

## 5. Endpoint de `cache.delete` local (descartado como contrato)

Un endpoint autenticado que ejecute `cache.delete` solo afectaría al POP que atienda esa petición. Puede existir como auxiliar de
diagnóstico, pero **no se presenta como purga global**. Si se llegara a construir: POST autenticado con el mismo token del Worker, nunca GET,
y la respuesta debe decir "POP local".

## 6. Descartado en este diseño

- `purge_build_cache` de Pages: borra artefactos de compilación, no respuestas servidas.
- `ctx.cache.purge` (Workers Caching): sistema independiente de `caches.default`; no invalida lo que hoy se guarda.
- API de purga de zona: exige una zona gestionada (dominio propio); es una vía futura, con su propio diseño y alcance de orígenes.
- `purge_everything`, token amplio, soporte, compra de dominio: fuera de alcance.

## 6b. Decisiones del usuario

- Staging con fotos ficticias: se acepta una ventana temporal.
- Producción: **pendiente de confirmar con la clienta**, sobre todo si habrá fotos identificables de personas. No se asume que todas las fotos
  admitan retirada demorada; si no, B pasa a obligatorio (tras medir) y se revisa el destino de `r2.dev`.

## 6c. Implementación local (`cloudflare/medios-pages/entrega.js`)

- Navegador: `public, max-age=0, must-revalidate` + ETag (200, 304 y HEAD). Copia almacenada: `public, max-age=300`. Errores: `no-store`.
- `REVOCAR_CON_R2 = false` (exportado); el cuarto argumento `{revocar}` lo fuerza solo en pruebas (los envoltorios no lo pasan).
- Con B: `head` (o `get` sin consumir) antes de HIT/304; ausente → 404 + `cache.delete` local; falla → 503; ETag distinto → MISS y reemplazo.
- Pruebas nuevas (11): política separada, B por defecto desactivado, ventana de A, B presente/borrado/304/HEAD/head caído/ETag/dos POP/en vuelo.
- *(Histórico)* Los dos verificadores exigían `public, max-age=300` al navegador y fallarían con la política nueva; ya están adaptados, ver §6d.

## 6d. Verificadores adaptados (local, sin ejecutar contra Cloudflare)

`verificar-medios-pages-cache.cjs` exige la cabecera del navegador `public, max-age=0, must-revalidate` en GET/HEAD/304/HIT; `TTL_S=300` queda solo
como TTL interno para el ensayo de expiración por POP. `verificar-interfaz-r2-preview.cjs` exige la misma política en las 4 variantes. La evidencia
anterior sigue atada a sus builds originales. Pendiente de nueva revisión de Codex; no se ha construido ni probado un artefacto con este cambio.
Pendientes antes de producción: decisión de la clienta, CPU/latencia/cuota y alcance del acceso público de `r2.dev`.

## 7. Recomendación

1. **Adoptar A + política de navegador separada** como contrato por defecto de staging, tras medir su costo (una prueba de caché con
   `must-revalidate`: HIT en borde + 304 en repetición).
2. **Tener B listo como interruptor** (constante en `entrega.js`), activable solo si el negocio define que ciertas fotos exigen retirada
   inmediata. No activarlo por defecto hasta medir CPU/latencia/cuota.
3. El contrato de producción (TTL definitivo, si B es obligatorio, qué se hace con `r2.dev`) es **decisión del negocio**: no se fija aquí.

## 8. Pruebas locales previstas (Node, R2 y Cache simulados; sin red)

Ampliación de `cloudflare/medios-pages/test/probar-entrega.mjs` (historial: previstas antes de implementar; hoy ya incluidas, 48/48 locales):

1. Caché caliente + objeto borrado: con B → 404 `no-store`; con A → HIT hasta expirar (documenta la ventana).
2. `If-None-Match` coincidente tras borrar: B → 404, nunca 304.
3. HEAD tras borrar (con y sin `head` en el binding).
4. `head` lanza → 503 `no-store`, sin servir la copia vieja.
5. ETag cambiado entre copia y R2 → MISS y reemplazo.
6. Dos POP simulados (dos cachés): borrar en uno no afecta al otro; B retira en ambos al primer acceso.
7. Petición en vuelo: GET leyó el objeto, DELETE ocurre, `put` posterior; el siguiente acceso con B devuelve 404.
8. Cabeceras del navegador: `Cache-Control` distinto de la copia almacenada; sin `Age`/`Date` heredados erróneamente.
9. Regresión: todas las respuestas conservan `nosniff` y `noindex`; los 37 casos actuales siguen pasando.

La prueba real (objetos ficticios, medir la ventana efectiva en navegador y en el borde) requeriría autorización aparte.

## 9. Fuera de alcance / no hecho

Historial: el diseño original no tocó nada. Estado local actual: sí se modificaron `entrega.js`, su prueba y dos verificadores (§6c, §6d), pero no el binding, las variables ni Cloudflare, y sin commit ni push. No se creó endpoint, token ni recurso. Este documento no aprueba un contrato de
producción.
