# Tercera revisión de preparación de Fase 2B

Fecha: 9 de octubre de 2026. Proyecto: C:/WedJaiseReact.

**Veredicto: APROBADA CON OBSERVACIONES para preparar una rama y un preview Git de QA.** Las salvaguardas, el empaquetado de la imagen y los seis escenarios entregados superan la verificación ejecutada por Codex. Se encontró una cobertura pendiente de la protección PWA: un diálogo retenido en una pestaña oculta deja de bloquear la actualización. Debe corregirse antes de ofrecer el hosting al personal.

Esta aceptación técnica no autoriza por sí misma a Codex a hacer commit/push, conectar GitHub, publicar B, cambiar producción ni iniciar R2. El usuario decide las acciones externas de Claude. Las fases anteriores mantienen sus veredictos y la Fase 2B completa sigue pendiente del despliegue Git y O1 online.

## Qué ejecutó Codex

| Comprobación | Resultado |
| --- | --- |
| Build del código actual con Vite y configLoader native, salida fuera del repo | Pasa; imagen disponible y sin instalar dependencias |
| Seis escenarios de PWA, repetición independiente | 6/6 pasan |
| Caja vacía | Actualizar habilitado; documento pasa de A exacta a B exacta |
| Producto en carrito | Actualizar deshabilitado con mensaje; no borra el carrito; habilitado al quitar el producto |
| Diálogo visible | Actualizar deshabilitado; habilitado al cerrar con Escape |
| A incorrecta | Falla en la comparación exacta, sin ejecutar el marcador de publicación local |
| Origen no permitido / backend del negocio en configuración | Falla en preflight, sin login ni publicación local |
| Salvaguardas de build | 43/43 pasan |
| Cuatro parches de rollback | git apply -R --check pasa; no se aplicaron |
| Niveles visuales | 9/9 pruebas unitarias pasan |
| Lint | Se ejecutó; exit 1, coherente con la línea base fallida indicada en la entrega |
| Listado actualizado | 197 entradas; 10 exclusiones; imagen nueva incluida; cero hallazgos pendientes en el escáner por patrones |
| Caso adicional: Atrás con diálogo retenido | Se reproduce una brecha de cobertura, descrita abajo |

No se escribió dentro del proyecto ni se instalaron dependencias. Los escenarios usaron localhost y las cuentas QA existentes de staging, con login y lecturas protegidas. Solo hubo carrito y búsquedas ficticias en memoria; no se confirmó venta, guardó cliente ni envió pago.

Para la repetición se compiló A desde el código actual. B es una copia diagnóstica del mismo build con otra marca HTML y la revisión del index en su precache; no representa un segundo commit real. Los servidores y la copia de B fueron exclusivamente locales, bajo esta carpeta externa. Esto verifica el comportamiento local de la app; no cierra O1 en Cloudflare.

Los primeros intentos de Chromium fallaron por la ruta del navegador dentro del sandbox y por ERR_NETWORK_ACCESS_DENIED. Se conservaron esos registros; se seleccionó el Chromium ya instalado y se repitió con acceso permitido al diagnóstico. El resultado válido es escenarios-codex-3.json, no los intentos anteriores. No se descargó ni instaló navegador.

## Empaquetado y reproducibilidad

Se confirmó que git status incluye src/assets/login/foto-login.jpeg como archivo nuevo. La excepción de .gitignore permite ese JPEG y sigue excluyendo otro archivo de prueba en la misma carpeta. La foto permanece en la ruta de importación de Login.jsx; no hay necesidad técnica de moverla ni descartar el diseño.

**La inclusión de ese archivo está aprobada desde el punto de vista del build.**

La evidencia clon-limpio.json de Claude registra 808 candidatos, 178 archivos de salida y cero diferencias entre la copia limpia y el árbol bajo las mismas variables. Se revisó su script, pero no se volvió a ejecutar npm ci: las instrucciones de este repositorio reservan instalaciones a Claude. Codex comprobó además el build actual con dependencias existentes.

Detalle para el commit final: probar-clon-limpio.mjs excluye .codex y resultados de pruebas, pero no excluye las tres capturas PNG que el listado propone omitir. Estas imágenes son documentación, fuera del build de la app, y no invalidan el resultado observado; aun así el snapshot final debe corresponder al conjunto exacto autorizado. Comprobar el commit real desde un checkout limpio después de crearlo, incluyendo la imagen y las exclusiones definitivas.

El total 197 describe el estado actual; la cifra anterior 188 no era una exigencia permanente. El listado calculado actualmente tiene 101 modificadas, 95 nuevas y 1 eliminada.

## B1–B3

B1/B2 permanecen aprobadas. El verificador ahora valida backend y cuenta ficticia antes del navegador, restringe orígenes, aborta tráfico ajeno y detiene una A inválida antes de la publicación. Los negativos de origen, backend y marca A se reprodujeron.

Se revisó la lectura de usuario propio con /auth/v1/user y usuarios?id=eq.<id>, y el conteo de filas del cobro por botones Quitar. No se usó la presencia genérica de texto de producto para declarar conservación de carrito.

La intercepción en el contexto es pertinente para peticiones originadas por un service worker en Chromium. Conviene conservar el límite documentado por Playwright: la actualización del script principal del SW no puede interceptarse de la misma forma. El tráfico del SW tampoco queda completamente descrito por eventos registrados solo en page; cuando se documente su red completa, registrar los eventos en browserContext. [Documentación oficial de Playwright](https://playwright.dev/docs/service-workers). Estos límites no produjeron un fallo en los escenarios ejecutados.

## B4 · Protección con diálogos visibles: aprobada; diálogo oculto pendiente

**Hallazgo adicional P2: ocultar una pestaña no significa que su trabajo haya terminado.**

Reproducción realizada por Codex, sin guardar datos:

1. Entrar a Clientes por el menú y después volver a Ventas.
2. Abrir Seleccionar cliente y escribir una búsqueda ficticia.
3. Disponer de B local esperando actualización. Actualizar está deshabilitado mientras se ve el diálogo.
4. Usar Atrás del navegador: vuelve a Clientes, conservando Ventas y su diálogo en la caché.
5. Actualizar queda habilitado, aunque el diálogo sigue montado con su borrador.
6. Regresar a Ventas: se recupera la búsqueda ficticia y Actualizar vuelve a bloquearse.

Resultado de dialogo-oculto-2.json:
- visibleDialogBlocks = true.
- backRoute = /clientes.
- hiddenDialogRetained = true.
- updateEnabledWithHiddenDialog = true.
- dialogDraftRecovered = true.
- returnBlocks = true.

No se pulsó Actualizar para destruir el borrador en ese caso. La combinación de estado retenido en memoria y actualización habilitada acredita que la protección permite una recarga en presencia de ese trabajo.

**Causa:** useCerrarConEscape.js usa activoSolicitado && paginaActiva para el efecto que registra tanto Escape como trabajo pendiente. Al ocultar la página, su cleanup elimina el pendiente, aunque el diálogo no se cierre ni se desmonte. Eso es correcto para la pila de Escape, pero no para contabilizar trabajo que se perdería al recargar.

**Corrección recomendada para Claude:** separar el registro de trabajo pendiente de la visibilidad. Conservarlo mientras el diálogo esté realmente abierto/montado, incluso cuando su página se oculte; limpiar al cerrar/desmontar. Mantener Escape y foco limitados a la página activa, preservando QA-049 y el orden de modales apilados.

**Aceptación:** repetir el recorrido Atrás/regreso y comprobar que Actualizar permanece deshabilitado en la ruta anterior hasta cerrar el diálogo pendiente. Probar además dos diálogos, cierre/desmontaje, y caja vacía para que no quede un bloqueo permanente.

Este hallazgo no impide preparar una rama y un preview ficticio para QA. Sí impide declarar completa la protección de todos los diálogos antes del uso operativo del hosting definitivo. Los formularios embebidos no registrados mantienen el límite declarado por Claude.

![Actualizar habilitado en Clientes con el borrador de Ventas retenido](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/fase2b-verificacion-v3/dialogo-oculto.png)

## B5 y documentación

**Recomendación técnica:** conservar foto-login.jpeg y preparar feat/cloudflare-pages con el conjunto revisado y sus exclusiones, sin actualizar main. El workflow de GitHub Pages no cambió y sigue disparándose al actualizar main.

El listado contiene muchos cambios ajenos al hosting. Esta revisión de preparación no es una aprobación de cada función del producto, de todas las migraciones o de los cobros. Mantener la revisión de esos cambios y no aplicar migraciones/Edge Functions al negocio como consecuencia del commit de la rama.

El plan v3 incorpora las aclaraciones nuevas, pero conserva debajo textos antiguos en presente: “el build falla”, “la foto está ignorada” y “protección no implementada/carrito se pierde”. Rotular ese bloque como histórico o actualizarlo. No bloquea el preview; evita transmitir a quien ejecute que sigue pendiente un problema ya resuelto.

pos-jaise sigue siendo un nombre propuesto: no se comprobó disponibilidad ni se creó nada. El usuario puede elegirlo al autorizar el paso de Cloudflare.

## Pasos siguientes

- Corregir el registro de diálogos ocultos y actualizar el estado vigente del plan; no hace falta rehacer las salvaguardas aprobadas.
- El usuario puede autorizar a Claude el commit/push solamente a feat/cloudflare-pages con las exclusiones indicadas y la imagen. Codex no ejecuta Git.
- Comprobar el commit final reproducible y crear el Pages Git con variables de preview/staging, manteniendo producción sin backend/pago y RAMA_PRODUCCION explícita.
- Ejecutar O1 real con dos versiones bajo el mismo alias. No trasladar datos a otro Supabase; el negocio conserva el backend actual.
- Antes de transición pública, cerrar protección de trabajo pendiente y límites relevantes de pagos/correos/origen. R2 continúa en su fase.

## Mensaje para Claude

> Codex aprueba con observaciones la preparación de rama y preview QA: build externo, 6 escenarios PWA, 43 salvaguardas, 4 rollback checks y 9 unitarios pasan. La imagen está incluida correctamente. Nuevo P2 confirmado: con un diálogo de Ventas abierto, Atrás a Clientes oculta la pestaña y Actualizar se habilita aunque conserva el borrador; al volver vuelve a bloquear. Separa el registro pendiente de paginaActiva, manteniendo Escape/foco limitados a la página visible. Prueba Atrás/regreso, cierre y dos diálogos, sin cobrar ni guardar datos. Actualiza los bloques históricos del plan. El usuario decide commit/push a feat/cloudflare-pages y nombre Pages; esta aceptación técnica no autoriza producción ni R2.

## Evidencia válida

- build-resumen.json y build.log.
- escenarios-codex-3.json y los seis JSON/logs con sufijo -3.
- salvaguardas-43-codex.json.
- COMMIT-ACTUAL-CODEX.md.
- dialogo-oculto-2.json, comprobar-dialogo-oculto-2.cjs y dialogo-oculto.png.
- preparar-build.cjs, repetir-pwa-3.cjs y publicar-local.cjs.

Se conservaron los intentos diagnósticos anteriores para trazabilidad. Los servidores temporales terminaron y no se borraron ni rotaron recursos externos.
