# Matriz de cobertura QA (corte 2026-10-03)

Supabase Local TEST, rama `testing`, 98 casos en 17 archivos. **No es cobertura total**: lista lo que cada
caso comprueba y las brechas que siguen abiertas. Un caso «omitido» no cuenta como aprobado. Una fila
«expected» en un caso de defecto conocido (`expectedFailureIDs`, hoy solo QA-033) significa defecto
reproducido, no funcionalidad aprobada.

| Área | Cubierto (archivo) | Brecha / pendiente |
|---|---|---|
| Rutas y roles | Matriz de rutas por rol, login/logout, contraseña incorrecta (`auth-roles`, `expanded-access`) | Una redirección correcta no prueba cada acción |
| **Autorización del backend** | **Nuevo:** CAJERA, ASISTENTE y CLIENTE con sesión real: PATCH/DELETE/POST de productos, servicios, estado del negocio, promociones, fichas, gastos y autoascenso de rol rechazados; RPC `verificar_pago_pedido_web`, `confirmar_venta`, `anular_venta`, `guardar_cita_pos` y límite «solo ventas de hoy» de CAJERA (`qa-cobertura-adicional`). **QA-034** (CLIENTE ejecutaba RPC de administración). **QA-033** (ASISTENTE vende/anula por API) como defecto conocido | No es una matriz exhaustiva: faltan clientes, deudas, mobiliario, citas (cualquier personal las actualiza por diseño), `ventas` insertables por cualquier personal, `cupones` legibles por todo el personal y los buckets de Storage |
| Sesión | **Nuevo:** sin token, token alterado (401), sesión eliminada del navegador → `/login`, refresh token inválido tras cerrar sesión | No se prueba la expiración natural del access token ni el refresh automático (no se manipula reloj ni configuración JWT), ni sesiones simultáneas |
| Referidos | **Nuevo:** código propio/inexistente/repetido, cupón de bienvenida de S/10, la referente no recibe nada antes del canje | No se prueba «solo antes de tu primera visita», ni el cambio de montos de `config_referidos` |
| Cupones | **Nuevo:** ajeno, combinado con descuento, inválido, reutilizado, **uso simultáneo desde dos sesiones (solo una venta lo consume, stock una vez)**, recompensa única de S/15 al canjear, anulación devuelve el cupón y anula la recompensa (`qa-cobertura-adicional`); QA-005/QA-019 (`known-issues`, `phase2-flows`) | Cupón mayor al total, cupones de promoción/fidelización en concurrencia, canje con porcentaje 100 |
| Comisión ASISTENTE | **Nuevo:** % asignado por UI a la ficha `asistenteTest01` (33,33 → 0,67; 100 → 2,00; 0 → 0), el % aplicado queda guardado al cambiarlo; sin % queda pendiente (`phase2-flows`); ADMIN 100 % | La ASISTENTE modifica su % por API: rechazado (comprobado). Rango fuera de 0–100 solo por CHECK, sin prueba |
| Pedidos | Pedido pendiente/cancelado/verificado/entregado, QA-009, QA-027; **Nuevo:** pedido **ya ENTREGADO** y venta anulada → `CANCELADO`, pago sigue verificado, stock repuesto, no se puede volver a ENTREGADO | **Decisión de negocio pendiente**: qué estado debe tener un pedido entregado cuya venta se anula (¿DEVUELTO?), si hay devolución de dinero. No se implementó |
| Ventas, inventario, gastos, citas, clientes | CRUD y límites por UI (`expanded-*`, `phase2-*`, `known-issues`) | Compras/garantías de mobiliario, pagos completos de atención, notificaciones |
| Reseñas | QA-008, QA-026, QA-032 (producto y servicio) | Reseñas generales (`resenas`) de punta a punta |
| Finanzas | QA-024/025/031: Dashboard ↔ Estadísticas, descuentos, envío | Delivery con cupón solo verificado por SQL; descuento de monto fijo con envío |
| Accesibilidad | Foco de 4 diálogos, nombres accesibles de la galería (QA-016/017/018/030) | ~40 usos del hook `useModalA11y` sin prueba propia; lectores de pantalla |
| Rendimiento | Scripts `performance-grupo7-*.mjs` (dev y build, N=5) y capturas para revisión visual; no forman parte de la suite | Teléfono físico, INP, PWA/Service Worker, GitHub Pages |

Fuera de la matriz por no ser automatizable aquí: impresión nativa (comportamiento esperado, se recarga),
cámara física, otros navegadores/dispositivos.
