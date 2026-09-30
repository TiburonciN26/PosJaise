-- =========================================================
-- estado_negocio: permitir lectura también a clientes web
-- Ejecutar en Supabase → SQL Editor → New query
-- Fix reportado por el usuario: subió el QR de Yape/Plin desde
-- ContactoWeb.jsx, pero el carrito web no mostraba las fotos.
--
-- Causa real: la policy de SELECT de estado_negocio era
-- `rol_actual() is not null` — y rol_actual() busca en `usuarios`
-- (personal del POS: admin/cajera/asistente). Una clienta real vive en
-- `clientes`, nunca en `usuarios`, así que para ella siempre daba
-- null y la policy bloqueaba TODA la fila (no solo el QR: también
-- yape_numero/titular, plin_*, cuenta_transferencia). Nunca se había
-- notado porque el único consumidor de este dato en el portal cliente
-- hasta ahora era EstadoNegocioContext, y el único componente que
-- realmente leía algo de ahí (AvisoNegocioCerrado) solo vive en
-- Layout.jsx — el shell del POS, nunca el del cliente. CarritoCliente.jsx
-- (Fase 4, §8.14 de implementacionesWed.md) fue la primera pantalla de
-- clienta que de verdad necesitaba estos datos.
--
-- Se confirmó el archivo en Storage está bien (200 OK real, probado con
-- curl) y la fila en la tabla tiene los valores correctos — el problema
-- era 100% de RLS, nunca de la subida.
-- =========================================================

begin;

alter policy estado_negocio_select on public.estado_negocio
  using (rol_actual() is not null or mi_cliente_id() is not null);

commit;
