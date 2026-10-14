# Revisión del plan PWA con entrega Pages /medios

10 de octubre de 2026, America/Lima. Codex, QA. Revisados plan, ampliación del verificador y runbook. No hice commit/push, no publiqué B, no escribí objetos/filas ni cambié configuración. Los informes nuevos se guardan en `.codex` conforme a la instrucción persistente del usuario.

## Veredicto

**Plan local y ampliación revisada aprobados para preparar las dos rondas propuestas**, con las precisiones de alcance indicadas abajo. Sin nuevos bloqueos en las guardas de entrega/medios probadas. **Las transiciones A→B1 y B1→B2 todavía no están ejecutadas ni aprobadas.** El ensayo sin B no constituye una actualización PWA exitosa.

El orden propuesto se mantiene, con **autorización humana antes del primer commit**. La aprobación QA de este informe no autoriza commits/publicaciones y no sustituye la decisión del usuario.

## Plan y archivos

Revisados `docs/evidencia-rendimiento/fase-3/PLAN-PWA-PAGES-MEDIOS.md`, el diff de `scripts/verificar-actualizacion-pwa-online.cjs` y runbook §25. No cambian código de aplicación, Function o configuración. HEAD/main locales conservan `9bb133063270df2af2a52e2cfe4e260d5b8b518b` / `0dc629e430ed07eeaccec273d31de93e9717d9bf`. No hice fetch ni una nueva comprobación de main remoto.

A está identificado correctamente: marca 9bb13306, alias aprobado, deployment a68f02d7, SW SHA-256 `8018435f8d905900582e119857e3e5bae8e70ce62a74239aabd16d4d92bf9071`. El plan separa venta pendiente/vacío, carrito operativo/clave ficticia, sesión protegida real y límites de navegadores/estados.

B1 agrupa scripts y documentación útil; B2 agrupa una síntesis de la ronda 1. **Los JSON y capturas permanecen en `.codex`**, no en el commit: interpretar así la referencia del plan al informe de ronda 1, como aclara su paréntesis. No se propone un tercer push para archivar la ronda 2. La lista exacta de B1/B2 y el commit exacto se revisan/validan antes de cada push.

## Verificador ampliado

Con `--entrega=pages` el preflight común valida marca y configuración por rol antes del navegador y del comando de publicación. Tras aceptar la actualización, comprueba B por marca/configuración y registra hashes de SW distintos. La comprobación de B depende del alias remoto y del documento cargado; registrar esos dos resultados por separado en la evidencia.

La pestaña auxiliar debe estar controlada por SW; sus GET de medios exigen 404 de Function con no-store/nosniff/noindex, sin SPA. La navegación `/medios/` exige ese 404, mientras `/medios-extra` exige HTML SPA. Los pasos fallidos de A hacen lanzar antes del bloque `spawnSync` de publicación.

La sustitución de `process.exit` por `process.exitCode` conserva el retorno del aborto temprano. La rama de argumentos básicos ausentes/inválidos sigue usando exit 2; no afirmar que todos los errores posibles del CLI terminan en 1.

## Pruebas independientes ejecutadas por Codex

- `node --check` y oxlint del verificador modificado: correctos.
- **Seis preflights negativos sin red real**, ejecutando el texto actual con validadores reales, imports adaptados en memoria y dobles de FS/HTTP/Playwright/publicación: entrega r2dev contra Pages, entrega inválida, marca incorrecta, proveedor incorrecto, Worker incorrecto y roles de bases invertidos. Todos: **exit 1, cero llamadas a Chromium y cero llamadas al publicador**, con publicadoB=false. No se utilizaron credenciales reales.
- **Siete escenarios del helper/gate de medios**, extraídos del script actual: control sano y seis negativos (sin controlador, respuesta SPA en la ruta de objeto, cabecera incorrecta, navegación medios que recibe SPA, medios-extra 404 y fetch caído). El control sano alcanza un publicador ficticio; los seis negativos no lo alcanzan. La auxiliar se cierra en todos. Es prueba del gate de medios, no de toda la instrumentación de red del contexto.
- **Ensayo real solo del lado A**, usando el script actual con estado vacío, `--espera-min=0`, B ficticio `00000001` y **sin --publicar-cmd**. QA de staging existente; únicamente login y lecturas, sin venta ni objetos/filas.

El ensayo real registró **16 pasos: 14 correctos y dos fallos esperados** («no apareció el aviso» y su diagnóstico de ejecución). Pasaron preflight, marca, SW controlando, usuario propio/fila protegida, auxiliar controlada, GET de las tres rutas de medios, navegación sin fallback y SPA en medios-extra. El SW de A coincide con el hash registrado. No había B/aviso/waiting/installing; publicóB=false y salió con **código 1**, sin cierre forzado 127 en esta ejecución. El proceso y sus contextos de navegador terminaron.

El informe conserva resultado FALLA: no se cambia por OK porque los controles de A hayan pasado. El B ficticio no fue construido ni publicado, y no se ejecutó ningún comando Git. El mensaje del script que solicita publicar manualmente no se atendió.

## Precisiones de alcance, sin bloqueo

1. **Modo y salida explícitos:** usar `--entrega=pages` y el origen permitido exacto en ambas rondas. La entrega sigue siendo opcional para otros usos del script; omitirla no prueba la nueva cobertura. `--salida` de este verificador es **un archivo JSON**, no una carpeta; crear antes la carpeta nueva de `.codex` y usar nombres distintos para cada ronda, pues el script no crea la carpeta y puede sobrescribir un archivo existente.
2. **Errores y tráfico:** los observadores request/response/requestfailed/pageerror están en la pestaña principal; la auxiliar tiene las aserciones específicas de medios y comparte la ruta de bloqueo del contexto. No describirlo como una captura completa de todos los eventos de la auxiliar o de los workers. Acotar «sin errores» a esos observadores y comprobaciones, o ampliar la instrumentación si se desea esa garantía adicional. Los 404 intencionados de medios quedan fuera de la colección HTTP principal según el contrato del ensayo.
3. **SW:** el hash registrado es el de sw.js obtenido por GET y el controlador se verifica por presencia. El ensayo no instrumenta la identidad interna de cada worker en ejecución; marca de documento/configuración/hash remoto son los controles complementarios del protocolo. Comparar y registrar A/B exactos, sin presentarlos como medición de rendimiento o validación multi-dispositivo.
4. **Documentación histórica:** §24 aún rotula las corridas como pendientes de revisión, aunque el changelog/informe ya recogen su aprobación. Actualizar ese estado al agrupar documentación útil en B1, sin crear un push adicional para esa precisión.

## Orden de ejecución que se puede proponer al usuario

1. Autorización expresa de los dos commits y pushes exclusivamente a feat/cloudflare-pages y de las dos rondas QA de lectura, con lista de archivos y límites del plan. El permiso de las corridas de caché/UI no se reutiliza para publicaciones.
2. Claude crea B1 **local**, calcula su marca y valida ese commit exacto desde checkout limpio con las variables de Preview. No publica antes de esa validación.
3. Ronda 1 inicia en A 9bb13306 con entrega Pages. Solo tras sus controles A se ejecuta el push autorizado de B1. Se conserva la evidencia, incluso si falla; no se prepara/publica B2 para perseguir un fallo.
4. Con ronda 1 correcta/revisada, preparar B2 con la síntesis útil, validar su commit exacto y ejecutar la ronda vacío B1→B2 bajo el mismo protocolo.
5. Última evidencia en `.codex`, sin tercer push de archivo. Imágenes reales/objetos ficticios y rollback de filas siguen fuera de estas rondas y necesitan alcance/autorización aparte.

No autorizo ni ejecuto ese protocolo por cuenta del usuario, ni envié mensajes a Claude. La Fase 3 completa y producción mantienen sus pendientes: ronda ejecutada/revisada, rollback de URLs, purga, CPU/cuota, fotos reales, otros navegadores/móvil, carga, recolector y migración inversa.

## Evidencia y hashes

Nueva carpeta `.codex/evidencia-revision-plan-pwa-pages/`: `lado-a-sin-publicar.json`, `negativos-sin-publicar.json`, `guardas-medios-auxiliares.json` y copias `.txt` de los dos diagnósticos locales. No contiene contraseñas, claves reales ni bundles. No se editaron informes anteriores, plan ni runbook.

- Verificador revisado SHA-256: `947c7b1864609e6f5571e664a90d2d64c36c351ba8ee15d8315967acbf029859`.
- Plan revisado SHA-256: `10c0aba8d098f7906a2f7a09828679bcb3d86225643d11d567c3b79be210e0c1`.
