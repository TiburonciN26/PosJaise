# Cierre del P2 y cuarta revisión de preparación de Fase 2B

Fecha: 9 de octubre de 2026. Proyecto: C:/WedJaiseReact.

**Veredicto: P2 del diálogo oculto CORREGIDO Y APROBADO. Preparación de Fase 2B APROBADA para la rama y el preview de QA.**

No quedan bloqueos nuevos dentro de la corrección revisada. La Fase 2B completa sigue pendiente del commit real reproducible, la integración Git con Pages y O1 online entre dos versiones. Esta aceptación técnica no es una publicación del negocio ni autoriza a Codex a modificar Git o recursos externos.

## Decisión vigente del usuario

El usuario indicó: “por ahora publico ya que la wed lo estan usando , uva ves desplegado en cloudfare lo desactivamos”.

- Mantener **PosJaise público** y **GitHub Pages activo** mientras la web está en uso.
- Retirar GitHub Pages después de verificar el hosting definitivo en Cloudflare y la transición del negocio; crear o validar solo el preview de staging no alcanza para ese retiro.
- No se autorizó ni ejecutó un cambio de visibilidad del repositorio en esta revisión. La privacidad posterior del repo se distingue de desactivar GitHub Pages y se decidirá en el paso correspondiente.

Consulta de GitHub ejecutada por Codex: TiburonciN26/PosJaise, visibility PUBLIC, isPrivate false. El plan aún contiene “repo privado/privado según el usuario”; Claude debe actualizarlo con el estado y la decisión actuales. Esta corrección documental no bloquea el preview.

## Evidencia ejecutada por Codex

| Comprobación | Resultado |
| --- | --- |
| Build del código actual, fuera del repositorio | Pasa |
| Ocho escenarios PWA repetidos | 8/8 pasan |
| Caja vacía, venta, diálogo visible | Actualización normal o bloqueo según el trabajo |
| Atrás con diálogo de Ventas oculto | Sigue deshabilitado; cierra y se habilita |
| Dos diálogos, uno oculto | Escape cierra el visible; el oculto sigue bloqueando |
| A incorrecta | Falla antes de ejecutar la publicación local |
| Origen / backend incorrectos | Falla en preflight, sin login |
| Recorrido adicional independiente con búsqueda ficticia retenida | Pasa; conserva texto, orden de cierre y limpieza final |
| Cuatro parches de rollback | git apply -R --check pasa; no se aplicaron |
| Listado regenerado fuera del repo | 199 entradas, 11 exclusiones y cero hallazgos pendientes del escáner |

El build se generó con Vite usando configLoader native y dependencias existentes; no se instaló nada. A/B son variantes diagnósticas del build actual: B cambia la marca HTML y la revisión del precache del index. No son dos commits publicados.

Los recorridos se realizaron en localhost con las cuentas QA existentes de staging: login y lecturas protegidas, búsqueda ficticia y carrito en memoria. No se guardaron clientes, confirmaron ventas, enviaron pagos ni modificaron datos de negocio. Los servidores temporales terminaron.

Se mantienen las comprobaciones anteriores aprobadas de salvaguardas y niveles visuales. No se repitieron esas pruebas sin cambios que lo justificaran. El clon limpio con npm ci es evidencia de Claude revisada, no una instalación ejecutada por Codex.

## Corrección revisada

useCerrarConEscape mantiene dos efectos separados:

- Escape/pila dependen de activoSolicitado y visibilidad, preservando el comportamiento de la página activa.
- Trabajo pendiente depende de activoSolicitado y trabajoPendiente; ocultar la página no elimina el registro.
- Cerrar o desmontar limpia el registro. Un identificador único por instancia distingue los diálogos.

Se revisaron las siete exclusiones: BarraCatalogo, menú de MenuUsuario, menú de MenuUsuarioCliente, SelectorOrden, selectores de mes/filtro de Citas y selector de mes de Gastos. Se trata de menús/selecciones de interfaz, no de los formularios y confirmaciones. Las llamadas de confirmación de esos mismos componentes siguen usando el comportamiento que registra trabajo pendiente.

## Reproducción independiente del P2 anterior

Se usó navegación real del menú y Atrás:

1. Clientes → Ventas; abrir Seleccionar cliente y escribir una búsqueda ficticia.
2. Presentar la actualización B local: Actualizar deshabilitado.
3. Atrás → Clientes: diálogo de Ventas retenido y Actualizar todavía deshabilitado.
4. Abrir Nuevo cliente en Clientes: dos diálogos montados, uno oculto.
5. Escape cierra solamente el diálogo visible; el oculto sigue bloqueando.
6. Regresar a Ventas: la búsqueda se recupera y sigue bloqueado.
7. Cerrar el último diálogo: no queda un bloqueo permanente.

Resultados de dialogo-oculto-corregido.json:
- updateEnabledWithHiddenDialog = false.
- twoDialogsRetained = true.
- onlyVisibleClosed = true.
- hiddenStillBlocks = true.
- dialogDraftRecovered = true.
- returnBlocks = true.
- lastClosedUnlocks = true.
- ok = true.

Esto cierra el hallazgo observado en la tercera revisión. No se reintrodujo código antiguo ni se modificaron fuentes para generar un negativo; se revisó el control negativo aportado por Claude como evidencia adicional.

## Commit, rollback y pendientes

El listado actual tiene 199 entradas y 11 exclusiones. El JPEG está disponible para el build y sigue propuesto como archivo nuevo. La estrategia técnica recomendada continúa siendo feat/cloudflare-pages, sin actualizar main.

El usuario aún debe autorizar el commit/push que ejecutaría Claude y elegir el nombre del proyecto Pages. La aceptación de esta preparación no implica aprobación de cada cambio funcional, migración o Edge Function incluido en el árbol completo.

Claude registra clon-limpio.json con 811 candidatos, 178 archivos de salida y cero diferencias frente al árbol bajo las mismas variables. Al crear el commit, verificar un checkout del commit exacto con sus exclusiones finales. El script de snapshot todavía incluye tres PNG de documentación que se propone excluir; no afectan el build observado, pero debe validarse el conjunto real que se subirá.

Los cuatro parches inversos son aplicables actualmente. El rollback de la protección también debe considerar las siete llamadas con trabajoPendiente:false, según la lista de Claude. No usar restauraciones completas de esos archivos con cambios ajenos.

O1 sigue abierta: no se publicó B en Cloudflare ni se probaron dos commits online. Se mantienen los límites declarados de formularios embebidos no registrados, pagos/callbacks, correos reales, CSP, hardware móvil y comparación de rendimiento con GitHub Pages. R2 sigue fuera de esta etapa.

## Mensaje para Claude

> Codex cerró el P2: repitió los 8 escenarios y un recorrido independiente con búsqueda ficticia, dos diálogos, Atrás/regreso, Escape y limpieza final; todo pasa. Build externo y 4 rollback checks pasan. Preparación 2B aprobada para rama y preview QA. Actualiza el plan: el repo está PUBLIC, verificado en GitHub, y el usuario decidió mantenerlo público y GitHub Pages activo mientras se usa; su retiro espera el hosting definitivo validado. No cambiar visibilidad ni desactivar Pages por esta revisión. Falta autorización del usuario para commit/push a feat/cloudflare-pages y nombre de Pages; después validar el commit exacto, integrar Git y ejecutar O1 online. No actualizar main, producción ni R2 como efecto automático de esta aceptación.

## Evidencia en esta carpeta

- escenarios-codex-3.json: ocho escenarios.
- atras-3.json y dos-dialogos-3.json, junto con los otros seis JSON/logs.
- dialogo-oculto-corregido.json y comprobar-dialogo-corregido.cjs.
- dialogo-oculto-corregido.png.
- build-resumen.json y build.log.
- COMMIT-ACTUAL-CODEX.md.
- fuentes-verificadas.json: SHA-256 del hook, registro, aviso, contexto, siete componentes con llamadas y verificador.
- preparar-build.cjs, repetir-pwa.cjs y publicar-local.cjs.

Los archivos de este informe y sus diagnósticos están fuera del proyecto. No hubo commit, push, cambio de configuración remota ni publicación externa.
