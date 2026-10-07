# Actualización de Notion — QA-064, QA-075, QA-062, QA-063, QA-076 (texto preparado)

El conector de Notion no estaba autorizado en esta sesión no interactiva: **no se leyó ni se modificó Notion**. Texto listo para pegar. Estado propuesto para todos: **Re-test** (Codex hace la verificación independiente). Evidencia y detalle: `docs/recompensas-fase2/COHERENCIA-NIVELES-Y-VIGENCIA.md`. Entorno: solo Supabase Local TEST, HEAD `d99df1e` más el diseño aprobado sin confirmar. Producción no tocada; Recompensas apagado; apertura no ejecutada.

## QA-064 — Re-test
Causa: tres criterios independientes (costo para el color del premio, valor del descuento para el color del cupón, `nivel_minimo` para el permiso). El backend ya autorizaba por `nivel_minimo`; el defecto era de presentación. Corrección: el nivel visual es el nivel de negocio (`nivel_minimo`: BASICO=Plata, PREMIUM=Oro, VIP=Diamante; promociones por fechas = Especial), igual en catálogo, cupón emitido y permiso; el costo por nivel de la clienta no lo cambia. Sin umbrales nuevos ni cambios de costos o fórmulas. Pruebas: matriz 3×3 con rechazo del backend, nivel coherente con costos distintos, canje que conserva clasificación y nivel (SQL, 14/14); tarjeta de cupón real renderizada para todos los orígenes (5/5); lógica pura (8/8); interfaz sin sesión (3/3). **Límite:** sin sesión real (`QA_TEST_PASSWORD`): no se probó por UI con tres clientas ni el color del cupón emitido en «Mis cupones». Decisión por confirmar: los cupones de bienvenida/referido/fidelización (sin nivel propio) ahora se ven Plata.

## QA-075 — Re-test
Corrección: el cupón de una campaña nace con `vigente_hasta` = inicio del día siguiente al último día, hora de Lima (todo el último día cuenta). Validación compartida sin cambios (bloquea antes de anunciar un importe pagable). Idempotencia reforzada: 6 reclamos simultáneos devolvían `duplicate key`; ahora devuelven el mismo cupón. Anular una venta no reactiva un cupón vencido (probado). Probado para los tres niveles: campaña futura, vigente y vencida (reclamo y uso), límite del último día, reintento y doble clic, verificación de pago. **Límites:** sin sesión real; el reloj no se adelantó (se simuló el paso del tiempo moviendo `vigente_hasta` en la capa SQL; el valor emitido se verifica exacto). **Cupones antiguos sin vencimiento: no se actualizaron;** tratamiento propuesto, con cifras de Local, en el documento (requiere decisión y autorización).

## QA-062 — Re-test
Anclas adaptadas al diseño Plata/Oro/Diamante/Especial (`.cupon-n-*`, `cupon-sheen`, iridiscencia, chispas de Diamante), conservando las comprobaciones de efectos y sin tocar el diseño. El brillo animado del texto Oro y `cupon-glow` ya no existen en el diseño aprobado (ver tabla en el documento). Verificado sin sesión (3/3, con prueba de mutación). **Límite:** el caso de la suite con sesión no se ejecutó.

## QA-063 — Re-test
La expectativa ahora cita el texto aprobado (regla global y «sin mínimo configurado») y que la frase antigua no aparezca; se conservan cancelación sin débito, doble clic, saldo e idempotencia. **Límite:** el caso con sesión no se ejecutó; sí se comprobó sin sesión que cada fragmento está en el texto que muestra el diálogo.

## QA-076 — Re-test
El control `migrar-local-con-respaldo.mjs` impide migrar si el respaldo previo falla o no es verificable (código de salida, `pg_restore --list`, firma, SHA-256, fecha de esta ejecución; no acepta uno existente ni uno posterior). Probado con dobles (21 casos, incluida la falla de `docker cp` del incidente). Usado de verdad para las dos migraciones de este lote, con respaldo previo verificado. No se reaplicó ninguna migración para demostrarlo.

## No se marca
QA-065 ya está Verificado. QA-066 a QA-074 no se tocan ni se marcan en bloque. Fase 2 no se declara terminada.
