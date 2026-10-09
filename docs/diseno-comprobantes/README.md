# Diseño: Boleta y Factura electrónica (POS)

Estado: **diseño aprobado, sin implementar**. No se ha tocado `src/` ni `supabase/`.

## Decisiones
- El comprobante se elige **al cobrar y también después** (desde Historial).
- Régimen: **RER / MYPE / General** → se pueden emitir boleta y factura, con IGV 18%.
- Los precios se asumen **con IGV incluido**: el total que paga la clienta no cambia; el comprobante desglosa base e IGV. Confirmar con el contador.
- El comprobante nunca bloquea el cobro: si el proveedor falla, la venta queda cobrada y se reintenta.

## Dónde van los botones

| Pantalla | Qué aparece | Cuándo |
|---|---|---|
| Ventas (panel de cobro) | Selector **Sin comprobante / Boleta / Factura**, entre método de pago y "Confirmar venta" | Siempre que la facturación esté activa. Por defecto: Sin comprobante |
| Ventas, modal de Factura | RUC (11 dígitos), razón social y dirección fiscal, con consulta de RUC | Al elegir Factura |
| Ventas, boleta | DNI obligatorio | Solo si el total es de S/ 700 o más |
| Modal "Venta confirmada" | Imprimir, Descargar PDF, WhatsApp, o Reintentar / Emitir comprobante | Según el estado del comprobante |
| Historial, fila y detalle | Estado (Sin comprobante / B001-000123 Aceptada / Pendiente / Rechazada) y botones Emitir boleta, Emitir factura, Ver PDF, Reimprimir, WhatsApp | Siempre, sobre ventas no anuladas |
| Historial, anular | "Anular con nota de crédito" | Si el comprobante está aceptado. La cajera sigue limitada a ventas de hoy |
| Pedidos web | Mismo estado y botones. Emisión automática al verificar el pago, con el tipo, RUC y razón social que la clienta ya eligió en el carrito | Al verificar el pago |
| Configuración (solo ADMINISTRADOR) | Sección "Facturación electrónica": RUC, razón social, dirección fiscal, ubigeo, series, proveedor, interruptor de activación | Una sola vez |

## Comprobante imprimible
Evoluciona `TicketImprimible.jsx` (58 mm): RUC y razón social, serie-número, receptor, ítems, op. gravada, IGV 18%, total, QR y hash.

## Para implementar después
- Migración en `supabase/migrations/`: tabla `comprobantes` (1 a 1 con `ventas`), columnas de emisor en `estado_negocio`, RUC y razón social en `clientes`. RLS y GRANT explícitos.
- Edge Function de emisión (patrón de `crear-cargo`) y webhook idempotente (patrón de `webhook-pasarela`).
- `anular_venta` con nota de crédito. Cambiar `confirmar_venta` exige `drop function` previo.
- Probar en local; producción solo con confirmación explícita.
