# Revisión de las dos rondas PWA con Pages /medios

10 de octubre de 2026, America/Lima. Codex, QA de solo lectura. Evidencia de las transiciones ejecutada por Claude; auditoría de JSON/código/commits y lecturas públicas actuales realizadas por Codex. No repetí las transiciones, no publiqué versiones, no hice login ni escribí datos/configuración/Git.

## Veredicto

**Aprobadas ambas rondas para el alcance de staging:** venta **37/37** y vacío **32/32**, entrega Pages `/medios`. La comprobación PWA propuesta queda cerrada en esos dos estados y artefactos. Sin hallazgos bloqueantes nuevos.

El alias actual **sirve 7ee3c78e** con la configuración Pages/staging esperada. **La Fase 3 completa y el paso del negocio a producción continúan pendientes.** No se extiende esta aprobación a otros estados, navegadores, imágenes reales durante la actualización o a un rollback de datos.

## Evidencia y protocolo auditados

Informes originales conservados en `.codex/evidencia-pwa-pages/`:

- `ronda1-venta.json`: fecha registrada `2026-10-10T21:02:43.246Z`, A `9bb13306` → B1 `c8923709`, resultado OK, 37 pasos efectivamente registrados y correctos.
- `ronda2-vacio.json`: fecha registrada `2026-10-10T21:05:26.619Z`, A `c8923709` → B2 `7ee3c78e`, resultado OK, 32 pasos efectivamente registrados y correctos.

El verificador conserva SHA-256 `947c7b1864609e6f5571e664a90d2d64c36c351ba8ee15d8315967acbf029859`, idéntico al revisado en el plan. No repetí lint/tests sin cambios. Su flujo valida A antes del bloque de publicación y los JSON ordenan los pasos coherentemente con ese flujo.

**Venta:** aviso visible; permanencia en A; botón deshabilitado y mensaje de bloqueo; intento de pulsarlo sin recarga; carrito operativo conservado; habilitación al vaciarlo; marca B1 exacta y lectura protegida real de sesión después de actualizar.

**Vacío:** aviso y permanencia en A; botón habilitado sin mensaje de bloqueo; marca B2 exacta y sesión protegida real después de actualizar.

Ambas rondas registran preflight de entrega Pages por rol, sesión A/B con Auth y lectura de la fila propia (200/200), hashes de SW distintos, lecturas de tres rutas de medios 404 con no-store/nosniff/noindex/“No encontrado”, navegación `/medios/` sin SPA y `/medios-extra` con SPA. La clave localStorage ficticia no se interpreta como borrador operativo.

Las colecciones de errores y peticiones bloqueadas están vacías. El tráfico Supabase registrado es únicamente staging: 39 peticiones en venta y 37 en vacío. El alcance es el de los observadores de la pestaña principal y las aserciones específicas de la auxiliar, conforme a las precisiones del plan; no se convierte en una traza universal de todo el contexto/worker.

El código de la ronda no confirma ventas ni crea objetos/filas: el carrito se manipula en memoria. No se capturó una auditoría independiente de todos los métodos de red de las rondas; no se presenta el JSON como esa prueba adicional. En esta revisión Codex solo hizo GET/HEAD públicos y no accedió a datos de Supabase.

## Identidades corroboradas independientemente

| Versión | Commit | Deployment inmutable | SHA-256 de sw.js |
| --- | --- | --- | --- |
| A inicial | 9bb133063270df2af2a52e2cfe4e260d5b8b518b | a68f02d7-3f45-43de-b494-f27d0c7a9d76 | 8018435f8d905900582e119857e3e5bae8e70ce62a74239aabd16d4d92bf9071 |
| B1 / A segunda ronda | c8923709bdbc73787e47dd1bef40d688e283569e | a3e716b2-a1f5-4fb9-b6b3-e1be97899434 | fb28df6670866474774a3049ce442d5188146896c8258faeaaad6fe8cf0308a4 |
| B2 actual | 7ee3c78ea6c1fcba3a6be2f89e4045b6507ab536 | 90303ee8-0e73-42b7-9a7f-4d2f3897a881 | 2a43dbc12adb80f8dcc8afef850c1c65f91691783e3b8c2aa878f8060650ce7e |

Lecturas públicas de HTML/SW de los inmutables A y B1 corresponden a sus marcas/hashes de la evidencia; alias e inmutable B2 coinciden entre sí y con ronda 2. La salida de B1 es exactamente la entrada de ronda 2. **28 controles de consistencia/proveniencia, cero fallos**, sobre 69 pasos auditados.

No presencié ni reproduje esos cambios de versión dentro de una pestaña retenida. La aprobación se basa en el verificador ya revisado, los informes originales y esta corroboración independiente, no en una tercera ronda inventada.

## Estado publicado actual

El panel de Cloudflare leído en el navegador integrado confirma B2 en **Preview**, rama `feat/cloudflare-pages`, commit `7ee3c78`, estado **success**, duración **37 s**, alias y URL inmutable `https://90303ee8.pos-jaise.pages.dev`. La vista general sigue mostrando producción automática pausada y sin deployment de producción. No se guardó configuración ni se pulsó Retry.

Verificador GET/HEAD público actual: 140 scripts JS de entrada/precache 200, sin errores HTTP ni hallazgos de claves privilegiadas en el escaneo; no se imprimieron/guardaron claves o bundles completos. Configuración por rol: R2, Worker aprobado de staging, publicUrl del alias `/medios`, base antigua r2.dev reconocida. Solo ref de staging, sin negocio o Supabase local.

Se conservan rutas SPA, manifest en raíz, exclusión específica de `/medios` y ausencia de 404.html en precache. GET/HEAD de rutas de medios sin objeto responden 404 no-store/nosniff/noindex; HEAD sin cuerpo. HTML revalida con noindex, SW no-cache y la URL Pages de producción responde 404. No repetí pruebas de imágenes existentes, caché positiva o ventas.

## Commits y clon limpio

B1 incorpora los cuatro archivos declarados (verificador, plan, runbook y clon limpio de 9bb1330); B2 solo añade la documentación de la primera ronda. El diff de runtime (`src`, Functions, cloudflare, public, Vite, package/lockfile) frente a 9bb1330 está vacío. No hay informes `.codex` ni `.env*` introducidos por esos commits.

Los dos informes locales de clon exacto corresponden a los commits completos correctos: 882 candidatos, 180 archivos, imagen de login incluida, cero diferencias de contenido y 11 diferencias solo de fin de línea en cada uno. Son ejecuciones de Claude auditadas; no repetí instalación/build.

HEAD local conserva B2, main local `0dc629e430ed07eeaccec273d31de93e9717d9bf`. Solo el runbook aparece modificado entre archivos versionados por la nota de ronda 2; no lo edité. No hice fetch ni una comprobación independiente de main remoto o del sitio GitHub Pages del negocio.

## Siguiente paso: diseñar el ensayo de rollback de Galería

Es razonable preparar **un plan local acotado** antes de solicitar la autorización de escritura. Esta revisión no autoriza ni ejecuta ese ensayo. Debe identificar staging/alias actuales, el id único y marca QA propios, snapshot/inventario inicial y las dos bases exactas aprobadas.

Precisar si valida **solo conversión de URLs en la fila** o también entrega y borrado reales. El inventario quedó vacío en la revisión anterior: una fila con URLs inventadas a objetos inexistentes probaría la conversión, pero no que una foto siga cargando después del rollback. Si el plan necesita crear objetos ficticios, incluir cantidad/grupos/limpieza y pedir ese alcance aparte; no asumirlo del permiso de una fila.

El protocolo debe convertir únicamente la fila propia de Pages a la base r2.dev aprobada preservando destino/UUID/variante, releer y comprobar valores; conservar la fila antigua y filas ajenas. No retirar Function/binding ni cambiar variables para este ensayo. La retirada futura exige comprobar que no quedan URLs dependientes de Pages.

La limpieza debe confirmar la eliminación de la fila propia antes de borrar sus objetos, conservarlos ante resultado incierto y comparar snapshot/inventario final exactamente. Mantener evidencia y pendientes si falla. Revisar el plan/script antes de ejecutar. Sin commit/push solo para archivar esta aprobación o la última ronda.

## Límites que permanecen

Chromium, una cuenta ADMIN, estados venta/vacío; fuera de esta serie atrás/ventana/dos-diálogos y fotos existentes durante la actualización. Hash del SW por GET y controlador por presencia, sin identidad interna instrumentada de cada worker. Las corridas caché 27/27/UI 23/23 siguen atribuidas a b36e7495.

Pendientes de Fase 3: ensayo de rollback de URLs, purga, CPU/cuota, fotos reales, Firefox/Safari/móvil, carga/concurrencia, operación destructiva/programación del recolector y migración inversa. Dominio propio sigue opcional futuro. No se aprueba producción ni retiro de GitHub Pages.

## Evidencia de revisión

Nueva carpeta `.codex/evidencia-revision-pwa-pages-7ee3c78/`: `auditoria-rondas.json`, `verificacion-entrega-pages.json`, copias `.txt` de los diagnósticos y `deployment-b2.png`. Los JSON originales, plan, runbook e informes previos se conservaron. Este informe y su evidencia son los únicos archivos de proyecto añadidos por Codex en la revisión, bajo la autorización persistente de informes.
