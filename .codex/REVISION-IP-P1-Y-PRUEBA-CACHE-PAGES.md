# Revisión IP-P1 y preparación de la prueba de caché de Pages

10 de octubre de 2026, America/Lima. Codex, QA de solo lectura. No hay cambios de código/configuración, login real, escrituras de staging/R2, commit ni push en esta revisión. Informes nuevos guardados en `.codex` por la instrucción persistente del usuario.

## Veredicto

**IP-P1 cerrado para las reproducciones revisadas y los dos deployments reales.** El preflight distingue la entrega efectiva de medios antes de autenticar, aun con el mismo build-id. **El nuevo script de caché requiere corregir CP-01 (P2) antes de aceptar su ejecución/evidencia.** La aprobación de la Function local y la configuración ya aplicada solo en Preview se mantienen.

La respuesta anterior «Sí, aplicar y reconstruir solo Preview» autorizó binding/variables/reconstrucción; excluía escrituras de pruebas. El texto de Claude que pregunta «¿Autorizas los pasos 1 y 2?» no constituye autorización del usuario. No ejecuté ninguno de esos recorridos ni la ronda PWA/publicación.

## Alcance y comprobaciones

Revisados `scripts/lib/guardas-interfaz-r2.cjs`, cambios de `scripts/verificar-guardas-interfaz-r2.cjs` y `scripts/verificar-interfaz-r2-preview.cjs`, y el archivo nuevo `scripts/verificar-medios-pages-cache.cjs`. HEAD conserva `b36e7495c013b3cff8f167655de051a899ce77cf`; main local conserva `0dc629e430ed07eeaccec273d31de93e9717d9bf`. No hice fetch ni afirmo un estado remoto nuevo de main.

- Suite existente de guardas: **46/46**, cero fallos, ejecutada por Codex. Incluye sus servidores locales de redirección ficticia; no usa credenciales reales ni escribe en servicios externos.
- Oxlint de los cuatro scripts revisados: salida limpia, código 0. No repetí lint global, builds ni suites de aplicación sin cambios.
- GET públicos independientes: **cuatro combinaciones reales de entrega/artefacto**, sin `.env`, sin login, sin POST/PUT/DELETE. El clasificador compartido recibe una clave publishable ficticia únicamente para llegar a la comprobación pública del bundle; no se usa para autenticar.
- Diagnóstico independiente del script de caché: **tres escenarios simulados**, incluyendo control sano y dos lecturas finales fallidas. No hubo red real, objetos, datos ni archivos de proyecto modificados por la simulación.

## IP-P1: cierre

`G.preflight` valida parámetros y marca, obtiene SW/módulos, compara proveedor, API, publicUrl y bases extra por su papel en la configuración, y devuelve el control antes de que el llamador inicie sesión (`scripts/verificar-interfaz-r2-preview.cjs:118`). No se basa en encontrar ambas cadenas en cualquier parte del bundle.

| Artefacto público | Marca | Modo pages | Modo r2dev |
| --- | --- | --- | --- |
| Alias actual, entrega Pages | b36e7495 | Aceptado | Rechazado |
| Inmutable anterior 4d334b5d, entrega r2.dev | b36e7495 | Rechazado | Aceptado |

Para el inmutable anterior, el adaptador GET lee las mismas rutas de ese deployment, conservando el alias aprobado como parámetro de G.preflight. Esto prueba la configuración del artefacto anterior sin ampliar los orígenes de las guardas ni ejecutar el verificador de interfaz. Se reutilizan las lecturas en memoria para ambos modos; 141 GET únicos por artefacto.

SW SHA-256:

- Actual: `4c3d38c262bc6f00879681c535548bd45d0e8cf440d2206222df247be39bca42`.
- Anterior: `64bd81f2c9773b349685f2265bea473ba2d654ee6b3edbe082c45693b6706493`.

Coinciden con la identidad documentada al configurar Preview. El módulo reconocido actual es `assets/index-DGsWTpdi.js`; el anterior, `assets/index-BmxprMuZ.js`. Las regresiones cubren roles invertidos, bases erróneas, proveedor/API distintos y módulos contradictorios reconocibles. El reconocimiento es específico del formato de Vite revisado: no equivale a analizar semánticamente cualquier JavaScript posible. Si se cambia el formato de compilación, habrá que revisar la guarda y sus negativos.

## CP-01 (P2): el error de limpieza puede terminar como éxito

**Ubicación:** `scripts/verificar-medios-pages-cache.cjs:233` y cálculo de resumen/exitCode en líneas 234–240. `completa` se asigna en la línea 214, antes del `finally`.

Si pasan los casos principales pero falla una lectura del inventario en el `finally`, el catch guarda `informe.errorLimpieza` y escribe un mensaje en consola. No añade un caso fallido ni cambia el estado completo. El resumen solo cuenta los casos registrados, y el código de salida solo depende de ese resumen. Por tanto, una corrida cuya comprobación final no terminó puede aceptarse como correcta en una automatización o al leer el resumen.

**Reproducción independiente sobre el script actual:** ejecuté su texto en VM, con FS/auth/HTTP/Chromium/reloj ficticios. La única sustitución del texto en memoria cambia el import del clasificador por un doble válido; no se altera el manejo de errores, resumen, limpieza ni exitCode. El reloj simulado permite atravesar la espera del TTL sin dormir ni afirmar una medición real.

| Escenario | Casos/fallos del script | errorLimpieza | completa | exitCode |
| --- | --- | --- | --- | --- |
| Control sano | 27 / 0 | ausente | true | 0 |
| Falla primer inventario del finally | 26 / 0 | presente | true | **0** |
| Falla inventario de igualdad final | 26 / 0 | presente | true | **0** |

Los dobles de ambos negativos habían retirado sus objetos; la reproducción demuestra **falso éxito ante estado final no verificable**, no una fuga o borrado de objetos reales observado. El mismo catch también absorbe una respuesta de inventario ilegible o paginada que haga lanzar al lector estricto.

**Corrección recomendada a Claude:** contar toda excepción de limpieza/comprobación final como fallo, producir exitCode no cero y marcar la corrida como fallida o incompleta. Separar «pruebas principales terminadas» de «estado final confirmado» si se necesitan ambas propiedades. Conservar el id/grupo propio y detalle de pendientes sin borrar grupos ajenos. No convertir una lectura fallida en inventario vacío.

**Regresiones necesarias:** caso sano; inventario final con red caída/500/malformado/cursor; DELETE de limpieza fallido y relectura fallida. En los negativos, exitCode distinto de cero, resumen con fallo y ningún éxito completo falso; confirmar que solo se intenta borrar el grupo propio. Puede demostrarse localmente, sin nuevo despliegue ni escrituras remotas.

## Precisiones para la ejecución posterior

- El cache script limita orígenes mediante fetch seguro, usa preflight antes del login y genera un UUID propio. La prueba no cambia filas, pero sí sube y borra dos variantes en R2 de staging; requiere autorización específica de escrituras. El recorrido UI también modifica fixtures y los restaura: es otra ejecución con escritura.
- Los scripts todavía fijan evidencia en `docs/evidencia-rendimiento/...`. Para el trabajo solicitado a Codex debe poder elegirse una carpeta nueva bajo `.codex`, sin sobrescribir capturas/resultados existentes. Recomiendo un parámetro de salida; no lo implementé.
- La prueba observa un 404 después del plazo, pero sin registrar/contrastar el centro de datos de las respuestas no demuestra por sí sola que expiró **la misma copia** que dio HIT. Conservar `CF-Ray`/POP cuando esté disponible y distinguir «404 observado después del plazo» de «expiración de la copia antes observada». `head()` se infiere desde HTTP; no se mide el número real de lecturas de metadatos ni la CPU/cuota.
- Sigue pendiente el ensayo real de caché y UI con Pages. No están ejecutados ni aprobados sus resultados; la simulación de este informe no sustituye Cloudflare real. PWA entre versiones y sus commits necesitan una autorización aparte.
- El dominio propio continúa siendo una compra futura opcional. Esta revisión no lo convierte en requisito para la entrega por Pages Functions.

## Evidencia

Carpeta nueva `.codex/evidencia-ipp1-cache/`: `preflight-publico.json`, `diagnostico-cache.json`, y copias `.txt` de los dos diagnósticos externos. Las copias son para reproducir/revisar, no cambios al código del proyecto. No contienen secretos, claves reales ni bundles completos.

Hashes de fuentes revisadas:

- guardas-interfaz-r2.cjs: `07b2ce7927a597c22897b684d3a6451d7f477abc0d73f315bfd7c3f3f2872279`.
- verificar-medios-pages-cache.cjs: `92f6964d893d973270f54e001c24c137ec5706e44c9cf03870f66df7f4cf0c3c`.
- verificar-interfaz-r2-preview.cjs: `8e578066c81686ffcf997186b7037cae40bc0e6a59215362a31e2370384f51b0`.

No se editaron el runbook/registro ni informes anteriores. Producción, GitHub Pages, configuración de Preview y datos se conservaron.
