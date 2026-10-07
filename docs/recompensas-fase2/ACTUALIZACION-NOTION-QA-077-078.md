# Actualización de Notion — QA-077 y QA-078 (texto preparado; NO se escribió en Notion)

El conector de Notion no estaba autorizado en esta sesión no interactiva. Estado propuesto para ambos: **Re-test** (Codex hace la verificación independiente). Detalle y evidencia: `docs/recompensas-fase2/QA-077-QA-078.md`. Solo Supabase Local TEST; producción no tocada; Recompensas apagado y restaurado; apertura no ejecutada.

## QA-077 — Re-test
Causa: una aserción por botón (643 botones ≈ 55 s de 60 s). Corrección de arnés: una sola lectura conjunta del DOM tras esperar el conteo EXACTO de filas MONEDAS de la consulta pública (sin falsos positivos por lista vacía o parcial), con falla si un solo botón está habilitado; se conservan el premio propio, el conteo de MONEDAS sin SELLOS, cero consultas personales y la consulta al catálogo público. Sin subir timeouts, sin reducir ni desactivar premios, sin esperas, reintentos ni fallos esperados. Evidencia: prueba aislada 7/7 (falla con un botón habilitado); navegador real sin sesión con el catálogo grande de Local: 742 filas (645 MONEDAS / 97 SELLOS), 645 botones deshabilitados, 0 habilitados, comprobación conjunta ≈ 1,6 s. **Límite:** el caso con sesión de la suite no se ejecutó (sin `QA_TEST_PASSWORD`).

## QA-078 — Re-test
Corrección solo de interfaz (sin nuevo estado persistido ni cambios de reglas, fechas o los 66 cupones antiguos): disponibilidad efectiva = estado + vencimiento (`vigente_hasta` nulo = sin vencimiento legítimo; campo no consultado o ilegible = desconocido, nunca válido). Mis cupones/Referidos/Carrito: «Vencido», sin «Mostrar en caja», nivel y efectos conservados; selector del carrito y aplicar por código rechazan el vencido, sin total pagable; Caja lee `vigente_hasta` y, si venció, no anuncia descuento ni habilita el cobro con ese cupón (y reinicia la vista previa al cambiar el código); lectura fallida ≠ cupón válido ni «sin cupones». Evidencia: lógica/dobles 18/18, tarjeta real renderizada 11/11, SQL con identidad simulada 4/4 (lectura de Caja por rol), capa `node --test` completa 356/356. **Límites:** sin sesión real no se probaron por interfaz Mis cupones → Vencidos, Caja ni Carrito (lista de casos en el documento); lenta/fallida/tardía solo con dobles.

## Aparte
Paleta verde (Diamante verde de `public/diseñosPropios`) para cupones de bienvenida, referido y fidelización: aplicada; verificada solo por clase renderizada, sin revisión visual con sesión.

QA-062, QA-063, QA-064, QA-075 y QA-076 siguen Verificado; no se reabren ni se marcan otros tickets. Fase 2 no se declara terminada.
