# Entrega Fase 5 — correcciones de la revisión V2 (F5-02b, F5-04b)

Fecha: 2026-10-11. Base `6929c619`, solo local, sin commit/push/migraciones remotas/hosting. Fase 6 no iniciada. Responde a `REVISION-FASE5-LISTAS-ADMIN-V2.md`. Se conservan los cierres de F5-01, F5-03 y F5-05.

## F5-02b — borradores de otra cuenta
- `useAlmacenBorradores` ya no solo oculta: **reinicia** el almacén cuando cambia el dueño (ajuste de estado durante el render), así que A→B→A no resucita el borrador de A.
- `Programa` lleva la cuenta en su `key` y el panel de pestaña también (`key` por id de cuenta), de modo que el formulario ya montado se reinicializa con la configuración confirmada de la cuenta nueva y las filas abiertas de Protección vuelven a cerrarse.
- Se mantiene la conservación dentro de la misma cuenta (plegar, paginar, buscar, cambiar de subpestaña).
- Regresión (`F5-02b`): administradora A escribe 77 (Protección) y 88 (Programa), cierra sesión y entra una **segunda administradora**: Programa muestra la configuración confirmada y Protección sin borrador.
- **Límite:** no hay forma de producir en el navegador un cambio de identidad con Programa montado sin un instante de sesión nula (cerrar sesión recarga la página y otra pestaña también pasa por «sin sesión»). El caso «identidad cambia sin remontar» queda cubierto por la lógica (reinicio en render + `key`), no por una prueba de extremo a extremo; el diagnóstico de Codex con contextos simulados sigue siendo la forma de reproducirlo.

## F5-04b — equivalencia con NFD y diacríticos
- Migración (solo local): función `public.normalizar_busqueda(text)` `immutable`, SQL puro: `btrim(lower(regexp_replace(normalize(texto, NFD), '[<clase>]', '', 'g')))`. La clase se **generó** de la propiedad `\p{Diacritic}` de JavaScript (144 rangos del plano básico), así que el servidor y el normalizador anterior comparten definición; sustituye a la tabla fija de `translate()`. `normalize()` exige PostgreSQL ≥ 13 y base UTF8. Las columnas `codigo_busqueda` y `cliente_busqueda` usan la función; `execute` solo a `authenticated`. Rollback: además `drop function public.normalizar_busqueda(text)`.
- Verificación exhaustiva: para los 63.456 puntos de código del plano básico (32–65535, sin sustitutos) se comparó `normalizar_busqueda('x'+c+'Y')` con `normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().trim()`: **63.448 iguales; 8 diferencias** (mayúsculas de Unicode muy recientes que la configuración regional de Postgres y Node minusculizan distinto: U+1C89, U+A7CB, U+A7CC, U+A7CE, U+A7D2, U+A7D4, U+A7DA, U+A7DC). Fuera del plano básico no se contemplan caracteres diacríticos.
- Regresión (`F5-04b`): clientas NFC y NFD de María, Peña, José Perez, Ångela (Å como U+00C5 y como A + U+030A) y Ørsted Ł; 21 términos (compuestos y descompuestos, mayúsculas, espacios, `^`, `´`, `` ` ``, `¨`, código) cuyo total se compara con una referencia **independiente**: las cadenas originales traídas de la base y normalizadas en el navegador con el normalizador anterior. La referencia debe encontrar al menos las dos versiones de cada nombre.

## Verificación
`verificar-fase5.cjs` **34/34** (32 anteriores + 2 nuevos) con build de producción (:5192) y servidor de desarrollo (:5193, StrictMode); servidores cerrados; 0 filas «QA F5» / «QAF5-» tras la corrida. Build y oxlint sin diagnósticos nuevos. No se repitió el laboratorio de rendimiento (no cambian las rutas medidas).

## Rollback exclusivo
`evidencia-fase5/parche-fase5-modificados.patch` regenerado: **13 archivos** (cifra corregida; `git apply -R --check` correcto). Más lo ya indicado en `ENTREGA-FASE5-CORRECCIONES-V1.md` (archivos nuevos, `drop view` de ambas vistas **y** `drop function public.normalizar_busqueda(text)`, sección 48 de `implementacionesWed.md`: texto en `evidencia-fase5/seccion-48-implementacionesWed.md`).

Fase 5 lista para verificación por Codex. No iniciaré la siguiente fase hasta recibir el resultado y la indicación del usuario.
