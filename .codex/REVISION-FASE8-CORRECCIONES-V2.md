# Revisión Fase 8 · Correcciones V2

Fecha: 2026-10-12, America/Lima. Rama `feat/cloudflare-pages`, HEAD `6929c619e88a91434cb16ee6a8d2de90de94c091`. Revisión independiente de `.codex/ENTREGA-FASE8-CORRECCIONES-V2.md`, del código vigente y de los artefactos locales A `f8v2-a`, B `f8v2-b` y V1 `v1-a`.

## Veredicto

**APROBADA CON OBSERVACIONES, únicamente para implementación y QA local.** F8-01, F8-02 y F8-03 quedan cerrados dentro de los alcances descritos abajo. No se encontraron hallazgos bloqueantes nuevos. Esta aprobación no acredita staging, producción, otros navegadores ni móvil, y no autoriza commit, push, migraciones remotas, cambios de hosting ni comenzar la Fase 9.

La recuperación no garantiza que todos los imports fallidos se reparen al volver la conexión. En particular, una dependencia estática fallida puede permanecer rechazada en el documento. Se verificó que esa situación conserva la venta y ofrece una salida segura; se acepta como limitación, no como recuperación automática de la pantalla.

| Hallazgo de V1 | Resultado V2 |
| --- | --- |
| F8-01, pérdida de venta y desaparición del aviso de actualización | Cerrado: los errores probados quedan en la pantalla o ventana; se mantienen carrito, navegación y actualización protegida. |
| F8-02, imagen firmada almacenada y entregada después de revocar | Cerrado para el SW corregido: lista positiva, validación de respuesta y limpieza de entradas heredadas comprobadas. |
| F8-03, video con acceso alternativo que elude la retirada | Cerrado documentalmente: contrato V2 exige retirada equivalente a fotos; no se implementó video. |

## 1. Verificación independiente

Se usaron Chromium/Playwright ya instalados, builds existentes y servidores estáticos temporales en loopback. Se confirmó el contenedor `supabase_kong_WedJaiseReact` en `127.0.0.1:54321`. Se utilizaron cuentas QA locales existentes y un producto `TEST` existente; solo hubo carrito ficticio en memoria, nunca una venta confirmada.

La repetición del arnés de Claude se ejecutó desde una copia externa de QA. Se reforzó esa copia con una lista exacta de orígenes/RPC de lectura, bloqueo de escrituras de negocio y cierre de WebSockets. Los archivos originales no se editaron. Las fuentes de los diagnósticos se conservan como `.txt` en la evidencia, fuera del código de la app.

| Comprobación | Resultado independiente |
| --- | --- |
| Nueve regresiones V2, incluido SW real y transición A→B | 9/9, exit 0 |
| Predicados de caché, bases `/` y `/PosJaise/`, tipos y exclusiones | 48/48 |
| Caso vacío de actualización, cinco contextos adicionales | 5/5 |
| Recompensas, clienta QA: apertura y navegación de lectura entre subpestañas | 3/3 finales |
| Control V1: Citas fría sin conexión | Falla esperada: aparece el límite global |
| Control V1: imagen firmada ficticia revocada | Falla esperada: entrega 200 en vez de 401 |
| Dependencia fallida de Citas | Dos reproducciones, un control sano y un recorrido de salida/recarga segura |
| Manifiestos de rollback | 10 hashes V1 y 15 V2 coinciden |
| `git apply -R --check` del parche V2 | Correcto; no se aplicó |

Los casos de diagnóstico de dependencia que imprimen `1/1` solo indican que el harness terminó y guardó la observación: no prueban que «Reintentar» recupere la pantalla. El recorrido de recuperación segura sí contiene aserciones de carrito conservado y Citas abierta tras la recarga permitida.

No se recompiló ni se restauró código del proyecto durante esta revisión. Se comprobó que `sw-reglas-cache.js` del artefacto A coincide byte a byte con la fuente vigente y que los hashes V2 del manifiesto corresponden al árbol revisado. El ensayo de reconstrucción de rollback y las mediciones de rendimiento de Claude se auditaron como evidencia entregada; no se ejecutaron de nuevo.

## 2. F8-01: venta conservada y actualización controlada

La repetición real confirmó:

- Citas nunca descargada: el fallo queda dentro de su pestaña, carrito 1, menú operativo y ausencia de «Recargar la página» mientras existe trabajo pendiente. El caso de fallo del archivo principal se recupera mediante `?reintento=N`.
- Citas ya precargada: abre sin conexión desde memoria, con la venta intacta.
- A→B: no existen archivos comunes bajo `assets/`. El servidor deja de ofrecer los archivos de A y devuelve HTML de fallback. La pestaña permanece en A, «Actualizar» está bloqueado con venta y Citas previamente precargada abre.
- Escáner de A retirado: muestra el error dentro de su ventana; Esc la cierra. No desmonta el carrito ni el aviso. El HTML de fallback no queda guardado como JS. Los íconos de cobro están disponibles.
- Vaciar el carrito habilita la actualización y se comprueba B exacta, con Citas funcionando.
- Recargar A sin trabajo pendiente después de publicar B conserva el código que ya estaba en caché. Esto no implica que todas las pantallas se hubieran terminado de precargar.
- El portal mantiene su cabecera ante un import fallido. Si una dependencia queda rechazada, la recarga explícita sin trabajo pendiente permite recuperarlo.

Se revisaron también las capturas de los avisos entregadas por Claude. Esa inspección corresponde a escritorio y no constituye auditoría completa de accesibilidad o prueba móvil.

### Observación O1: dependencia estática fallida

En el build A se abortó únicamente `ModalRegistroAtencion-FSTkVtWV.js`, dependencia estática de Citas, antes de abrir Citas. Después se permitió de nuevo ese archivo, con la red disponible. Dos ejecuciones dieron el mismo resultado:

- Citas pidió su archivo con `?reintento=1`, `2` y `3`.
- La dependencia fallida solo se había pedido una vez y no volvió a solicitarse.
- El aviso persistió después de dos reintentos manuales; carrito 1, sin límite global.
- El control sin aborto abrió Citas correctamente.

Esto concuerda con el límite explicado en `src/lib/moduloDiferido.js:19`: cambiar la URL del módulo principal no cambia las URLs de sus imports estáticos. No equivale a la pérdida de venta de V1.

Se probó la salida prevista: «Ir a Ventas» devuelve el carrito con su producto; no ofrece recarga con venta pendiente. Tras cancelar el carrito ficticio, aparece «Recargar la página» y esa recarga abre Citas con el archivo disponible. No se forzó una recarga con trabajo pendiente ni se confirmó ninguna venta.

**Recomendación para Claude:** incorporar este caso a la regresión oficial y al registro de límites. No describir la recuperación al volver la red como universal. Si se quiere mejorar el reintento del grafo completo, debe mantener los providers y módulos compartidos coherentes y nunca usar recarga automática como reparación.

## 3. F8-02: caché acotada y limpieza

Con el SW real corregido, la imagen privada ficticia del proxy respondió 200 antes de revocar y 401 después; no se devolvieron los bytes viejos. Se verificó que no quedan en Cache Storage imágenes firmadas, Storage público del proxy, datos del proxy, otro origen, `/medios`, errores, recursos con query ni HTML que supla archivos inexistentes. Los positivos de hero, ícono público y chunks sí se guardan.

La transición desde V1 eliminó las dos entradas indebidas de prueba y conservó las 44 válidas observadas. Los 48 controles adicionales verifican el mismo criterio para raíz y base de GitHub Pages; eso no sustituye una sesión funcional de navegador del build de GitHub Pages.

Alcance: respuestas ficticias del servidor local, sin comprobantes reales ni tokens privados. No se promete retirar bytes ya entregados ni corregir antes de su actualización todas las pestañas que sigan controladas por el SW antiguo.

## 4. F8-03: contrato de video

La V2 fija por defecto:

- GET, HEAD, Range y condicionales bloqueados tras borrado confirmado, con errores `no-store` y 503 si no se puede comprobar el origen.
- Comprobación B antes de entregar desde caché, incluidas respuestas parciales; navegador con revalidación.
- Sin fallback automático a R2 público, `r2.dev` ni dominio directo. Un endpoint alternativo debe demostrar garantía equivalente.
- Originales/pendientes privados y pruebas previstas de retirada para video y poster, incluyendo accesos alternativos.
- Caché anual o acceso directo únicamente como excepción explícita futura del usuario.

Se acepta la especificación corregida. No hay aprobación de una implementación de video, infraestructura nueva, precio, proveedor contratado ni garantía medida sobre un endpoint de video real.

## 5. Intermitencias y límites de la repetición

El timeout de `h1` en el caso vacío no se reprodujo en la suite completa repetida ni en las cinco ejecuciones adicionales. El timeout de `tabpanel` tampoco se reprodujo en las tres aperturas finales de Recompensas con clienta QA y navegación por «Mis cupones», «Mis sellos», «Movimientos» y vuelta a «Cómo funciona».

Eso no identifica ni elimina la causa de las intermitencias históricas. Se conservan como observación; no deben cambiarse retrospectivamente a éxito. Esta comprobación de Recompensas es un recorrido de lectura, no la suite completa de 32 casos de Fase 5 ni una repetición de sus siembras y limpiezas.

**Incidencia propia del harness:** en las primeras tres aperturas de lectura se omitió de la lista de RPC permitidas `mi_historial_fidelizacion`; el panel abrió, pero la guarda bloqueó esa lectura y la aserción final falló. Se verificó en la migración existente que es una función SQL `stable` de lectura, se corrigió solo la copia externa del diagnóstico y se repitió 3/3. Se conservan la salida inicial y el script inicial; no se atribuye ese bloqueo a la aplicación.

Otros límites:

- Chromium únicamente; sin Safari, Firefox, móvil físico, staging ni producción.
- La descarga en reposo del POS con Save-Data sigue siendo una decisión abierta del usuario. La continuidad solo cubre código descargado/evaluado o guardado; no convierte los datos del negocio en datos offline.
- Login en el primer uso sin red, precarga normal del portal y maquetas publicadas siguen como decisiones pendientes.
- Las cifras de laboratorio de Claude no son INP/LCP de usuarias reales ni mediciones nuevas de Codex.
- No se repitieron el laboratorio de Fase 8, la suite completa de Fase 5 ni el build de GitHub Pages. Se revisaron sus informes y las superficies pertinentes al cambio.

## 6. Integridad y continuidad

HEAD permanece en `6929c619`; se verificaron los hashes iniciales de las fuentes centrales y los 15 del estado V2, sin cambios. El recuento de entradas de `git status --porcelain` siguió siendo 320 antes de archivar este informe; los cambios previos de Claude no se confirmaron ni modificaron. No se instaló nada, no se ejecutó SQL mutante, ni hubo cambios externos. Los navegadores y servidores temporales de QA se cerraron; no se detuvo el Vite del usuario.

Claude puede registrar la Fase 8 como **aprobada con observaciones solo local**, enlazar este veredicto y conservar O1 y las intermitencias en los límites. La Fase 9 espera la indicación del usuario. Publicación y migraciones remotas requieren su decisión aparte.

## Evidencia

Carpeta: [evidencia-revision-fase8-v2](C:/WedJaiseReact/.codex/evidencia-revision-fase8-v2).

- `regresiones-repetidas.json`: 9/9.
- `reglas-y-hashes.json`: 48 predicados y hashes/rollback.
- `control-v1-venta.json`, `control-v1-cache.json`: controles negativos esperados.
- `vacio-1.json` a `vacio-5.json`: repeticiones adicionales.
- `dependencia-pos.json`, `dependencia-pos-repetida.json`, `dependencia-control.json`, `dependencia-recuperacion-segura.json`: limitación y salida segura.
- `recompensas-lectura.json`: incidente de la guarda inicial; `recompensas-lectura-corregida.json`: 3/3 finales.
- Fuentes de diagnósticos `.cjs.txt` y resumen de revisión. Ninguna credencial se archiva en estos documentos.
