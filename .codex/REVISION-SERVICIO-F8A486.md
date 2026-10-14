# IP-S1 cerrado: Servicio, galería preservada y paquete agrupado

Fecha: 10 de octubre de 2026, America/Lima. Codex: QA de solo lectura.

## Veredicto

**IP-S1 queda cerrado.** La condición nueva compara las filas de galería y comprueba ambas variantes R2 por clave completa. Repetí **42/42 regresiones sin fallos** y el lint de los tres scripts pasa. Acepto la evidencia de Claude de **23/23** en la corrida `f8a486`, build `e2293968`, dentro de su alcance.

El paquete de 11 archivos queda técnicamente revisado para preparar un commit agrupado, validarlo desde checkout limpio y, con autorización del usuario, hacer push únicamente a `feat/cloudflare-pages`. No encontré un nuevo bloqueo en esta entrega. No se aprueba por esto el cierre completo de Fase 3 o la publicación del negocio.

## Corrección confirmada

`galeriaConservada` exige igualdad entre los estados anterior y posterior, incluidos `id`, `foto_url`, `etiqueta` y `orden`, y presencia de las claves `<destino>/<uuid>/m.webp` y `/g.webp` de cada referencia.

El verificador toma la galería antes de editar la principal, vuelve a leerla después y usa el inventario por claves completas. Además exige que la galería inicial de la prueba tenga una fila; el caso no puede pasar trivialmente con dos galerías vacías.

La regresión nueva comprueba el control positivo y los negativos de referencia, etiqueta, orden, ID, galería desaparecida y falta de cada variante. Son las reproducciones que faltaban para evitar el falso positivo por igualdad de cantidades.

Ejecuté la suite existente: 42 casos, cero fallos. Usa memoria y dos servidores HTTP locales efímeros para la prueba de redirecciones, sin servicios externos. `node --check` pasa para los tres scripts. `oxlint` de los tres scripts devuelve salida 0 sin diagnósticos. No repetí lint global; los errores conocidos de fixtures conservan el estado de las revisiones anteriores.

## Nueva evidencia real y comprobación posterior

Leí `corrida-f8a486.json`: marca `e2293968`, origen canónico de staging, corrida completa, error y limpieza de emergencia nulos, cero bloqueos y 23 casos OK. El caso de Servicio guarda las filas antes/después y muestra exactamente el mismo ID, referencia, etiqueta «Resultado» y orden 0. El resultado positivo procede de la condición que exige las variantes m/g.

Inspeccioné las dos capturas nuevas. Galería muestra la marca QA `f8a486`; no hay credenciales visibles. `corrida-b6bb1f.json` permanece como evidencia histórica del reemplazo de principal con la aserción anterior, sin atribuirle conservación íntegra de galería.

**Codex no presenció ni repitió las escrituras de la corrida real.** Auditó la evidencia de Claude y consultó posteriormente staging/Worker en solo lectura con la cuenta QA existente:

- Producto y servicio QA con `foto_url: null` y cero filas en sus galerías.
- Solo «Foto de prueba (Inicio)», ID `4ab5c994…`, en `galeria_web`.
- Cero objetos en los tres inventarios, sin cursor de continuación.

La igualdad con el snapshot inicial durante la corrida sigue siendo la evidencia del verificador; se limita a sus campos seleccionados. La aserción observa estado final y no acredita el orden temporal de los borrados. Chromium y fotos de referencia siguen siendo el alcance.

## Paquete revisado

La selección actual contiene **11 archivos**:

1. `scripts/verificar-interfaz-r2-preview.cjs`.
2. `scripts/lib/guardas-interfaz-r2.cjs`.
3. `scripts/verificar-guardas-interfaz-r2.cjs`.
4. `docs/evidencia-rendimiento/fase-3/R2-REAL-RUNBOOK.md`.
5. `interfaz-preview/corridas/corrida-b6bb1f.json` (histórico).
6. `interfaz-preview/corridas/corrida-f8a486.json` (aserción corregida).
7. `interfaz-preview/galeria-alta-b6bb1f.png`.
8. `interfaz-preview/producto-antes-de-guardar-b6bb1f.png`.
9. `interfaz-preview/galeria-alta-f8a486.png`.
10. `interfaz-preview/producto-antes-de-guardar-f8a486.png`.
11. `docs/evidencia-rendimiento/fase-3/pwa-entre-builds-vacio.json`.

Las rutas abreviadas `interfaz-preview/` pertenecen a `docs/evidencia-rendimiento/fase-3/`. Lista completa, pesos y hashes en `lista-candidata.json`. El escaneo de adiciones modificadas/JSON nuevos no encontró valores sensibles locales ni formatos de secretos examinados; las capturas se revisaron visualmente. No es una garantía universal.

Excluir `.codex/**`, `.env*` y las capturas antiguas ajenas de Fase 1; usar selección explícita. Las fuentes de la aplicación, configuración, dependencias y workflows no aparecen modificados en esta entrega. HEAD permanece en `e2293968fdc3e502bf362b4a891cd691fea839fc`; main local en `0dc629e430ed07eeaccec273d31de93e9717d9bf`.

Después de crear el commit autorizado, Claude debe validar ese commit exacto desde checkout limpio y comprobar la publicación resultante tras el push autorizado. Conservar las marcas originales de cada corrida: ambas de Servicio prueban e2293968, no el futuro commit que las archive. Las evidencias PWA mantienen su aceptación y el runbook corrige el recuento de venta a 24 pasos.

## Límites restantes y acciones de Codex

El hueco de reemplazo de principal de Servicio y conservación de su galería queda cubierto en staging/Chromium. Siguen pendientes fotos reales del catálogo, Firefox/Safari/móvil físico, carga/concurrencia, CDN/`nosniff`, purga, recolector destructivo y migración inversa. Producción y el retiro de GitHub Pages no están aprobados por esta revisión.

Nueva evidencia en `.codex/evidencia-servicio-f8a486/`: regresiones, lectura posterior, lista candidata, copia del informe real y sus dos capturas. Solo se crearon este informe y copias QA según la instrucción persistente de guardarlas en `.codex`. No se modificó código/configuración, datos, objetos, credenciales o Git; no se instaló nada ni se publicaron recursos.
