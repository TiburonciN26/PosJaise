# Texto preparado para Notion — coherencia de Recompensas en el portal (NO escrito en Notion)

El conector de Notion no estaba disponible en esta sesión (requiere autorización y la sesión no es interactiva): **no se pudo buscar duplicados ni registrar las incidencias nuevas, ni actualizar ninguna ficha**. Antes de crearlas hay que **buscar duplicados** (títulos como «Citas», «puntos», «monedas», «Cómo funciona», «Detalle de servicio»). Los hallazgos no tienen número de ticket: no se inventó ninguno. Los tickets ya Verificados (QA-056 a QA-061) no se tocan. Cuando se creen, pasarlos a **Re-test** (nunca Verificado) con este texto.

Commit: el del mensaje «Coherencia de Recompensas en el portal…» en `testing` (ver el informe de entrega). Detalle completo: `docs/recompensas-fase2/COHERENCIA-PORTAL.md`.

## Incidencias nuevas (una por fila; todas **Re-test**)

1. **La barra de Citas baja al gastar monedas (programa activo).** Con 40 monedas y 40 de clasificación la barra marcaba 80 %; tras canjear 30 monedas marcó 20 % aunque el nivel y el «10 pts para Premium» no cambiaron. Causa: `mis_puntos().puntos` es el saldo gastable con el programa activo y la barra lo comparaba con los umbrales. Corrección: la barra y el «faltan N» salen de la clasificación (`mi_saldo_recompensas`); monedas disponibles aparte. *Reproducido en UI (instancia desechable).*
2. **Citas: etiquetas y promesas del programa antiguo con el programa activo.** «pts» para monedas; «2 para tu 20%» fijo (el catálogo administrado tenía 25 %, máx. S/ 8); «Próximamente/Muy pronto» para una sección que ya existe; «se suman tus puntos y tu sello» al completar la atención (con el programa activo suma la venta confirmada). *Reproducido en UI, salvo «Próximamente» y la línea de «Completada» (código).*
3. **Detalle de servicio: «+5 puntos aprox. por esta visita»** con la fórmula antigua para un servicio de S/ 100 (con 5/20 corresponde un estimado de ≈ 25 monedas, identificado como estimado). *Reproducido en UI.*
4. **Detalle de producto: «+4 puntos con esta compra»** (S/ 80). Con el programa apagado los productos no dan puntos (`mis_puntos()` solo cuenta servicios): la promesa era falsa también en lo heredado. Con el programa activo ≈ 10 monedas (5/40). *Reproducido en UI; hecho heredado confirmado leyendo la función.*
5. **«Cómo funciona»: atribución y cifras escritas en el código.** «Los sellos, de tus visitas reservadas en la web» (el sello sale de una venta confirmada con servicios, venga o no de una cita web); tasas «propuestas» 5/20 y 5/40, umbrales y cifras de sellos fijos; regla de protección de servicios anterior a la regla global. Corrección: todo sale de `recompensas_reglas_publicas()` (lectura mínima y pública) y la regla de protección se explica sin cifras internas. *Reproducido en UI.*
6. **Inicio: «Mis puntos» muestra monedas** y **la tarjeta de Recompensas muestra «PTS» junto a «MONEDAS DISPONIBLES»** (y su dorso mezcla puntos y compras). *Reproducido en UI.*
7. **Carrito de servicios: «Nivel · N pts» con monedas y «Ganarás +N pts»/«+1 sello» con la fórmula antigua.** *Por lectura de código; verificado después en verde.*
8. **Un error de carga se convertía en cifras** (0,05 puntos por sol en detalle de servicio y de producto; 1 punto por día, S/ 20 por punto, 5 sellos y umbrales 10/30 en Citas y carrito; «+0 pts»). Corrección: sin lectura no hay cifra; aviso con reintento. *Por lectura de código; verificado después con lecturas lentas y fallidas.*
9. **Mis sellos heredado: «20% de descuento» fijo** aunque `config_fidelizacion.porcentaje_recompensa` se edita en administración, y «una cita que reservaste en la web genera un sello». Corrección: porcentaje leído de la configuración (sin cifra si no se lee) y texto del sello por día con atención registrada. *Por lectura de código; verificado con 30 % configurado.*

Propuesta de seguridad (para decidir): `recompensas_reglas_publicas()` — lectura de solo lectura para `anon` y `authenticated`, con el programa apagado todo nulo; no expone costos, protección, asistentes, corte ni saldos. Migración `20261005000004`, **solo Local**; producción requiere autorización aparte.

## Evidencia (por capa)

- Lógica pura (memoria): `programa-recompensas.test.mjs`, 18 casos.
- SQL en Local TEST (claims/roles simulados, transacciones con ROLLBACK; **no** E2E): `recompensas-reglas-publicas.test.mjs`, 6 casos.
- HTTP + interfaz con sesiones reales, **solo en la instancia desechable**: `ensayo-ui/coherencia-recompensas.ensayo.spec.mjs`, 23 casos (programa activo y apagado, saldo ≠ clasificación, canje real, tasas 3/25 y 3/16, umbrales 30/90 y sellos 12/4, lectura lenta y fallida, reserva y atención sin cobro frente a venta confirmada, público sin datos personales, responsive 390/1280, capas de la tarjeta).
- QA local (sin sesión, solo lectura): «Cómo funciona» público consulta únicamente reglas y catálogo públicos y dice que el programa no está activo.

## Límites

Sin `QA_TEST_PASSWORD`: no se ejecutó ninguna prueba con sesión contra Supabase Local QA ni la suite completa de Playwright. Las capturas se revisaron a mano; no se probó con teléfono físico ni lector de pantalla. No se declara terminada la Fase 2 ni cobertura del 100 %. Recompensas sigue apagado en QA; la apertura no se ejecutó; producción intacta.
