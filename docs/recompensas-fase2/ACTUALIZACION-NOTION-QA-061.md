# Texto preparado para Notion — QA-061 (NO escrito en Notion)

El conector de Notion no estaba disponible en esta sesión: la ficha **no se actualizó**. Pegar lo siguiente en
https://app.notion.com/p/3f0f27109e6a81acab0fc4ebb931a9f2 y pasar QA-061 a **Re-test** (nunca Verificado).

Resultados que se conservan (Codex, commit `58842f7`): suite completa 213 aprobadas, 1 omisión conocida, 0 fallos, sin reintentos; QA-060 Verificado. La suite no se repitió por este ajuste aislado (no cambia ningún caso de la suite).

## QA-061 — espera de carga en `qa-005-promociones-antiguas.mjs` — Estado: Re-test
- **Causa (arnés, no aplicación):** tras `goto('/promociones')` el script contaba el título en el acto; /promociones todavía mostraba el esqueleto (la consulta de React no había terminado) → 0 coincidencias y aborto. Reproducido en el arnés aislado: contar en el acto da 0 con la lista retenida.
- **Corrección:** `localizarPromocion(page, titulo)` (nuevo `tests/e2e/promociones-admin.mjs`) espera un estado **positivo** de carga: la lista (contenedor con las filas desplegables de cada promoción) o el estado vacío «No hay promociones registradas.» (excluyentes). Solo entonces:
  - si se ve «No se pudo cargar las promociones.» → error claro de consulta fallida (no se confunde con «ausente»);
  - 0 filas con el título exacto → «no aparece…; se detiene sin escribir»;
  - más de 1 → «aparece N veces… (duplicada); se detiene sin escribir»;
  - si no carga en el plazo → «/promociones no terminó de cargar».
  La tarjeta para «Editar» es la única de la lista que contiene esa fila (se quitó también `tarjeta.last()`). Sin sleeps, `force`, clics por JavaScript ni `first()`/`last()`.
- La comprobación previa de la lista cerrada pasó a `pendientesDeLaLista()` (mismo módulo): cada ID debe existir una sola vez con su título exacto; si no, aborta antes de iniciar sesión o escribir.
- **Se conserva:** verificación de Supabase Local TEST, lista cerrada de 4 IDs y títulos, inicio de sesión normal de ADMINISTRADOR, edición por interfaz (Editar → Inactiva → Guardar cambios), comprobación posterior de que ninguna otra promoción activa cambió, y el modo sin argumentos que solo informa.
- **Archivos:** `tests/e2e/qa-005-promociones-antiguas.mjs`, `tests/e2e/promociones-admin.mjs` (nuevo), `tests/e2e/promociones-admin.test.mjs` (nuevo), `tests/e2e/promociones-admin-navegador.test.mjs` (nuevo).

### Evidencia
- **Dobles en memoria** (`promociones-admin.test.mjs`, 6/6): todas presentes → solo activas; todas inactivas → nada; ID ausente, ID repetido y título distinto (aunque lo contenga) → abortan; filas ajenas activas no se devuelven.
- **Navegador ficticio** (Chromium real, origen `http://arnes-qa061.invalid`, sin app, sin Supabase, sin sesión; `promociones-admin-navegador.test.mjs`, 6/6 en 3 corridas seguidas): lista retenida → contar en el acto da 0 y `localizarPromocion` sigue pendiente; al soltar encuentra exactamente 1 (un título que contiene al objetivo no cuenta) y abre su tarjeta con «Editar»; ausente; lista vacía; duplicado (2); consulta fallida (HTTP 500); lista que nunca carga.
- **QA local, sin sesión:** modo informe → las 4 `activo=false, vigente=false`, «0 por desactivar». `--aplicar` → «Nada que desactivar: las cuatro ya están inactivas; no se inicia sesión ni se escribe», salida 0. Huella de toda la tabla `promociones` (md5 de sus 139 filas) y número de `auth.sessions`/`auth.refresh_tokens` idénticos antes y después: sin escrituras ni inicios de sesión. El camino idempotente termina antes de leer `QA_TEST_PASSWORD`, así que con la contraseña definida sería el mismo.

### Límites
- **No comprobado con sesión real:** `localizarPromocion` contra la /promociones real con ADMINISTRADOR (falta `QA_TEST_PASSWORD` en esta sesión). Comprobación de solo lectura pendiente: iniciar sesión, abrir /promociones y localizar una de las 4 (siguen listadas aunque inactivas) sin editar.
- La desactivación real por interfaz no se volvió a ejecutar: las 4 ya están inactivas y no se reactivan para probar.
- No se tocó código de aplicación, esquema, RLS, migraciones, guardas ni dependencias. Recompensas sigue apagado; sin apertura; producción intacta.
