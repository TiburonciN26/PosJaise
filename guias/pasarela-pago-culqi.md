# Guía: pasarela de pago con tarjeta (Culqi)

Estado al 2026-10-07: **hecho y probado solo en Local; nada en producción.** La cuenta de Culqi está creada y en revisión. Mientras no la validen, las llaves de prueba devuelven 401 ("llave no válida"). No es un fallo del código.

## 1. Cómo funciona
1. La clienta elige **Tarjeta** en el carrito (`src/pages/cliente/CarritoCliente.jsx`). El botón queda oculto si falta `VITE_CULQI_PUBLIC_KEY`.
2. El navegador abre el formulario de Culqi (`src/lib/culqi.js`). Los datos de la tarjeta van de la clienta a Culqi; nunca pasan por nuestro código ni por Supabase. Solo vuelve un token de un solo uso (`tkn_…`).
3. El navegador llama a la Edge Function `crear-cargo` con `{ pedido_id, token_id }`.
4. `crear-cargo` lee el **monto desde `pedidos_web.total`** en el servidor (lo que mande el navegador no decide cuánto se cobra), reserva el intento para evitar doble cobro y crea el cargo en Culqi con la llave privada.
5. Si el cargo sale bien, llama a `confirmar_pago_pasarela_pedido`, que verifica el pedido y crea la venta.
6. Culqi también avisa por webhook a `webhook-pasarela`. Esta función no confía en el aviso: consulta el cargo directo a Culqi, compara el monto con el pedido y es idempotente (cada evento queda en `pasarela_eventos` con id único).

## 2. Qué existe en el repo
| Pieza | Ruta |
|---|---|
| Cliente (formulario y llamada) | `src/lib/culqi.js` |
| Botón Tarjeta | `src/pages/cliente/CarritoCliente.jsx` |
| Edge Function de cobro | `supabase/functions/crear-cargo/index.ts` |
| Edge Function del webhook | `supabase/functions/webhook-pasarela/index.ts` |
| `verify_jwt = false` del webhook | `supabase/config.toml` (`[functions.webhook-pasarela]`) |
| Esquema (`TARJETA`, cargo y estado, `pasarela_eventos`) | `supabase/migrations/20261009000002_pasarela_tarjeta.sql` |
| Confirmación del pago y creación de la venta | `supabase/migrations/20261009000003_confirmar_pago_pasarela.sql` |
| `confirmar_pedido_productos` acepta `TARJETA` | `supabase/migrations/20261009000005_confirmar_pedido_tarjeta.sql` |

## 3. Llaves y secretos
| Variable | Dónde vive | Notas |
|---|---|---|
| `VITE_CULQI_PUBLIC_KEY` | `.env.local` del front | Llave pública (`pk_test_…`). No puede cobrar |
| `CULQI_SECRET_KEY` | `supabase/functions/.env` (Local) y secrets de Supabase (producción) | Llave privada (`sk_test_…`). Nunca en el repo ni en `VITE_*`. Está ignorado por git |
| `CULQI_WEBHOOK_SECRET` | igual que la anterior | Clave inventada por nosotros; va en la URL del webhook como `?clave=…` |

No pegues la llave privada en chats ni en archivos del repo.

## 4. Cuando Culqi valide la cuenta
1. **Reprueba las llaves antes de tocar código.** Un 200 indica que ya funcionan; un 401, que sigue sin validar:
   `curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer <sk>" "https://api.culqi.com/v2/charges?limit=1"`
2. Levanta las funciones en Local:
   `npx supabase functions serve --env-file supabase/functions/.env`
3. Prueba con la tarjeta de prueba: `4111 1111 1111 1111`, vencimiento `09/30`, CVV `123`.
4. Recorridos a probar: pago exitoso; tarjeta rechazada (se puede reintentar); doble clic (solo cobra una vez); pedido ya cancelado (409); cierre del formulario sin pagar (no pasa nada).
5. Confirma que el pedido queda PAGADO, que se crea la venta y que el stock baja.

## 5. Pendiente
- **Adelanto de citas:** falta `TARJETA` en `agendar_cita_web` y el botón en `CarritoServiciosCliente.jsx`.
- **Panel de admin:** mostrar en `PedidosWeb.jsx` el estado de la pasarela (PAGADO, RECHAZADO, REEMBOLSADO).
- **Comisión de Culqi:** decidir si se absorbe o se traslada a la clienta.
- **Requisitos de Culqi para pasar a producción:** URL con términos y condiciones, política de cambios y devoluciones, y Libro de Reclamaciones integrado en la web.
- **Llaves de producción:** crear las `pk_live_` y `sk_live_` cuando Culqi apruebe, y guardarlas como secrets de Supabase.
- **Quitar el log de depuración** `console.error('Culqi error')` en `src/lib/culqi.js` antes de salir.

## 6. Llevarlo a producción
Orden recomendado, siempre con confirmación explícita antes de cada paso en producción:
1. Aplicar las migraciones `20261009000002`, `…03` y `…05` (primero comprobadas en Local).
2. Cargar los secrets: `npx supabase secrets set CULQI_SECRET_KEY=… CULQI_WEBHOOK_SECRET=…`.
3. Desplegar las funciones: `npx supabase functions deploy crear-cargo` y `npx supabase functions deploy webhook-pasarela --no-verify-jwt`.
4. En el panel de Culqi, registrar el webhook con la URL `https://<proyecto>.supabase.co/functions/v1/webhook-pasarela?clave=<CULQI_WEBHOOK_SECRET>` y los eventos `charge.creation.succeeded` y `refund.creation.succeeded` (los nombres exactos están sin confirmar).
5. Poner `VITE_CULQI_PUBLIC_KEY` con la llave pública de producción en el build.
6. Hacer un pago real de monto mínimo y verificar pedido, venta y webhook.

## 7. Notas de seguridad
- `service_role` no recibe grants automáticos en este proyecto; la migración `…02` los otorga explícitos.
- El navegador nunca decide que un pago está PAGADO: solo las Edge Functions (service_role) escriben ese estado.
- Si Culqi no responde al crear el cargo, el pedido queda en PENDIENTE y no se permite reintentar a ciegas; el webhook lo concilia.
