# Cierre Fase 8 · observaciones de la revisión V2

Fecha: 2026-10-12. Veredicto de Codex: [REVISION-FASE8-CORRECCIONES-V2.md](REVISION-FASE8-CORRECCIONES-V2.md), **aprobada con observaciones, solo para implementación y QA local**. Sin commit, push, staging, producción ni cambios de hosting. El código de la app no cambió en este cierre: se añadió un caso a la regresión y se registraron los límites.

## O1 · dependencia estática fallida: incorporada a la regresión oficial

`scripts/verificar-fase8-v2.cjs`, caso «O1 (límite)». La dependencia se toma del grafo real del build: el `import` estático de Citas `ModalRegistroAtencion-*.js`, que la entrada no carga. Se aborta solo ese archivo desde el inicio, con una venta ficticia en el carrito. Después se vuelve a permitir y Citas se abre con red.

Resultado en el build A (`evidencia-fase8-v2/o1-dependencia-estatica.json`, 1/1):

- Aviso local, sin «Algo salió mal», carrito 1.
- Tras dos «Reintentar» el aviso **persiste**: la dependencia se pidió una sola vez y el navegador no la vuelve a pedir. No se ofrece «Recargar la página» porque hay una venta en curso.
- «Ir a Ventas» devuelve el producto. Al cancelar la venta aparece «Recargar la página», y esa recarga abre Citas.

El caso **afirma el límite**: si un día el reintento reparara también la dependencia, la aserción «el aviso persiste» fallaría y habría que actualizar el contrato.

## Límites registrados (sustituyen cualquier lectura más amplia de la entrega V2)

1. **La recuperación al volver la red no es universal.** `?reintento=N` repara el fallo del archivo principal de una pantalla, como en el caso «Citas nunca descargada». No repara una dependencia estática que ya falló en ese documento (O1), ni una dependencia envenenada por `modulepreload` en el portal. Lo que sí se garantiza en los casos probados es que la venta y la navegación se conservan y que la salida es segura: volver a la venta y recargar solo sin trabajo pendiente. Nunca hay recarga automática. Para reparar el grafo completo sin recargar habría que mantener coherentes los providers y los módulos compartidos; no se implementó.
2. **La continuidad cubre código, no datos.** Solo funciona el código ya descargado, evaluado o guardado. Los datos del negocio no pasan a estar disponibles sin conexión.
3. **Intermitencias históricas.** «Caso vacío», con timeout de `h1`, y Recompensas de clienta, con timeout de `tabpanel`, no se reprodujeron en las repeticiones de Codex. Su causa no está identificada y se conservan como observación; no se reclasifican como éxito.
4. **Decisiones abiertas del usuario:** precarga en reposo del POS con Save-Data, login sin conexión en el primer uso, precarga normal del portal y maquetas publicadas en `public/diseñosPropios`.
5. **Alcance de las pruebas:** solo Chromium, sin Firefox, Safari, móvil físico, staging ni producción. Las cifras son de laboratorio. El build de GitHub Pages se verificó con predicados y compilación, no con una sesión de navegador.

## Manifiesto de rollback

El caso O1 modificó solo `scripts/verificar-fase8-v2.cjs` (arnés, no código de la app). Se regeneraron `evidencia-fase8-v2/rollback/SHA256-v2.txt` y `parche-v1-a-v2.patch`; `git apply -R --check` sigue correcto. El manifiesto que revisó Codex queda en `SHA256-v2-revisado-por-codex.txt`: la única línea distinta es la del arnés, y los 14 hashes restantes no cambian.
