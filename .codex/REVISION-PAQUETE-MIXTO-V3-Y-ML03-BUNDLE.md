# Revisión del paquete de lectura mixta v3 y ML-03 en bundle compilado

Fecha local: 10 de octubre de 2026 (America/Lima); evidencia UTC del 11 de octubre. Codex realiza QA de solo lectura. No se modificó la implementación, el paquete original, Git, Cloudflare ni Supabase.

## Veredicto

**Paquete v3 aceptado en el alcance local revisado, y ML-03 cerrado también en el bundle compilado de esa versión.** El paquete identifica 6929c619e88a91434cb16ee6a8d2de90de94c091, contiene servidor + frontend de lectura mixta y conserva B activa. Codex repitió 6/6 comprobaciones del paquete desde una copia aislada y 7/7 de ML-03 en Chromium sobre dist, con red externa simulada/abortada.

El paquete ec2a3b6 utilizado como control negativo falla exactamente los dos casos de reescritura antigua, con código 1; los cinco restantes pasan. El nuevo termina con código 0. La prueba distingue la implementación nueva de la anterior.

Esta aceptación acredita el artefacto local como candidato de rollback con lectura mixta y B. No acredita un despliegue real de ese artefacto, la ejecución de un rollback en Cloudflare, la migración inversa general ni el cierre de r2.dev o de deployments anteriores. Carga y recolector siguen sin autorización de ejecución.

## Identidad e integridad

Paquete auditado: [artefacto-lectura-mixta-v3](C:/WedJaiseReact/.codex/artefacto-lectura-mixta-v3/manifiesto-lectura-mixta.json).

- Commit completo: 6929c619e88a91434cb16ee6a8d2de90de94c091.
- publicado=false, problemas=[], revocacionBActiva=true.
- 180 archivos en dist; sin 404.html. _routes.json incluye exactamente /medios y /medios/*.
- Tres archivos de servidor: entrega.js y los dos entrypoints Functions. Sus hashes binarios coinciden exactamente con el manifiesto, sin faltantes ni sobrantes; los imports cargan desde la copia aislada.
- Se compararon además con git show del commit. Los tres difieren en bytes por CRLF frente a LF, pero su contenido normalizado a LF es idéntico. No afirmar identidad binaria paquete/Git. La comparación inicial por bytes dio false; la evidencia de fines de línea resuelve esa diferencia y el veredicto final es verificacion-final.json.
- sw.js cumple la exclusión /medios y su hash coincide con el manifiesto: 3366f401561636524a06a4665f69dee2902f67c4788795c63464c8470823ea4e.
- Configuración efectiva del bundle contrastada por roles: proveedor supabase, API del Worker de staging, base pública Pages /medios y r2.dev aprobado como extra reconocida. No hay hallazgos del escáner de backend del negocio, Supabase local o claves privilegiadas en los JS del paquete.

La diferencia frente al sw.js publicado en Preview (2eb8003d...) no es un error de integridad: son artefactos con configuraciones distintas, y esta comprobación confirma que el paquete lleva lectura mixta. No se realizó una reconstrucción controlada para atribuir cada diferencia de hash exclusivamente al proveedor; los fines de línea también afectan hashes binarios. El módulo principal del paquete es index-wNHNGUlW.js; el Preview revisado usaba index-BJKOrzqm.js.

## Pruebas repetidas por Codex

**Paquete: 6/6.** Importación desde copia aislada, hashes, SW y rutas, B por defecto y caso efectivo de MISS → HIT → borrar en R2 simulado → 404 no-store en GET, HEAD y condicional. Ese caso usa la variante m con R2/Cache en memoria; no mide Cloudflare real ni decodifica los bytes de la imagen.

**ML-03 compilado: 7/7.** Se sirvió el dist del paquete por 127.0.0.1, se abrió /nosotros y la pestaña Galería, y se respondió a galeria_para_web con filas ficticias. Las imágenes externas se cumplieron con un PNG ficticio y el resto de terceros se abortó. No se usaron cuentas ni credenciales.

Se confirmó por peticiones de imagen interceptadas, no solo por src del DOM:

- La URL r2.dev antigua de UUID terminado en 01 y variante g se solicita por Pages /medios.
- La URL antigua de UUID terminado en 02 y variante m conserva m y también pasa por Pages /medios.
- No se solicita directamente r2.dev.
- Las URLs ya en Pages, la ajena y la relativa histórica no se reescriben indebidamente.

La ruta relativa se observa en el DOM y se sirve por el origen local, por lo que no pertenece a la lista de imágenes externas interceptadas. Las peticiones externas g/m de ML-03 sí están separadas y comprobadas.

**Control negativo repetido:** paquete v2 desde ec2a3b6: dos fallos esperados, precisamente g y m antiguas; código 1. El resultado no es un fallo de la versión actual. Se conservaron ambos informes independientes en carpetas diferentes.

**Sintaxis y oxlint del script nuevo:** correctos, sin diagnósticos.

La primera ejecución en el sandbox no pudo abrir 127.0.0.1 por ERR_NETWORK_ACCESS_DENIED. Se detuvo ese proceso; luego se completaron ambas corridas locales con acceso al loopback permitido. No se relajó la intercepción externa ni se conectó a staging. Las copias diagnósticas bloquearon los Service Workers y guardaron peticiones interceptadas separadas del DOM; los archivos del proyecto permanecieron intactos.

## Precisiones del script nuevo antes de versionarlo

Estas observaciones no invalidan ML-03 ni el paquete: la reproducción independiente ya cubre el comportamiento con los controles descritos. Conviene incorporarlas a la herramienta de Claude para que sus afirmaciones y fallos sean reproducibles.

1. **Bloquear explícitamente Service Workers en la simulación.** [verificar-ml03-bundle.cjs:48](C:/WedJaiseReact/scripts/verificar-ml03-bundle.cjs:48) crea un contexto sin serviceWorkers:block. Playwright advierte que browserContext.route no intercepta solicitudes manejadas por un Service Worker y recomienda bloquearlos en pruebas de intercepción. [Documentación oficial](https://playwright.dev/docs/api/class-browsercontext#browser-context-route). Codex añadió ese bloqueo únicamente en su copia externa. No se afirma que la corrida de Claude haya enviado peticiones reales; el ajuste sustenta la garantía de simulación, especialmente si cambia el SW.
2. **Separar peticiones de URLs del DOM.** [Línea 75](C:/WedJaiseReact/scripts/verificar-ml03-bundle.cjs:75) une imagenes y srcs y lo llama pedidas. Un src presente no demuestra por sí solo una solicitud. Guardar ambos conjuntos por separado y exigir imagenes para los dos casos que afirman que g/m se pidieron. La evidencia independiente confirma que ambos requests existen; esta precisión mejora la prueba original.
3. **Cerrar recursos también al fallar.** El cierre de navegador y servidor está únicamente en el camino sano, y el catch final solo fija process.exitCode=2 ([línea 103](C:/WedJaiseReact/scripts/verificar-ml03-bundle.cjs:103)). En el error de navegación del sandbox el proceso quedó vivo con el servidor abierto y fue necesario interrumpirlo. Usar finally para cerrar los recursos inicializados ante fallos de lanzamiento, navegación o interacción, sin depender de que la ruta sana llegue al cierre. No se modifica el manejo de datos remotos porque este script no los utiliza.

## Alcance y próximos pasos

- ML-03 queda probado sobre el frontend compilado de 6929c619, además de la aprobación previa por SSR. Este pendiente específico está cerrado.
- El paquete debe desplegarse como conjunto: dist y servidor/Functions del mismo artefacto, con la configuración de lectura mixta y B compatibles. El resultado local no autoriza hacerlo.
- La prueba usa Chromium y red/imágenes simuladas. No valida entrega real de imágenes por Pages, GPU, peso de catálogo, CPU ni cuota. No es una ronda PWA ni demuestra borrado global de copias descargadas.
- Las URLs antiguas se reescriben al leer desde esta aplicación; el acceso público directo al bucket r2.dev continúa siendo un frente externo independiente.
- No hacer un push solo para archivar esta revisión. El script de Claude sigue sin commit. Cualquier agrupación futura requiere la autorización correspondiente y mantiene .codex fuera del repo público.
- Los ensayos de carga y recolector permanecen listos en el alcance local ya revisado, pero requieren autorizaciones separadas para sus escrituras/borrados en staging.

La aprobación de interfaz 147b24 no cambia. La Fase 3 completa y producción siguen sin aprobación.

Evidencia nueva: .codex/evidencia-revision-paquete-v3-ml03. Contiene la copia del manifiesto, resultados independientes positivos/negativos, cotejo con Git/fines de línea y diagnósticos en .txt. Los informes y paquetes originales se conservan con sus hashes, sin sobrescribirlos.
