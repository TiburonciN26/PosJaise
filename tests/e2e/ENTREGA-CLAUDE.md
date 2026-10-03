# Entrega QA para Claude Code (actualizado 2026-10-03)

Codex audita y Claude corrige. Esta rama `testing` contiene la suite, sus fixtures y la documentación; la aplicación se corrige en `fix/qa-correcciones` y se fusiona aquí para ejecutar. Referencia vigente: COBERTURA.md (matriz y brechas) y README.md (cómo ejecutar e interpretar). Los informes CAMPANA-AMPLIADA, RESULTADOS y BASELINE son históricos.

## Entorno

Exclusivamente `localhost:5173` con Supabase Local `http://127.0.0.1:54321`. La suite exige la rama `testing`, comprueba la URL efectiva de Supabase y bloquea orígenes externos antes de cada test; no se debilita. No instalar dependencias ni editar `.env`. La contraseña de las cuentas QA se entrega por `QA_TEST_PASSWORD`.

```powershell
$env:QA_TEST_PASSWORD='<contraseña de las cuentas ficticias>'
node node_modules/playwright/cli.js test --config=playwright.qa.config.mjs
node tests/e2e/archive-run.mjs nuevo-corte
```

Cada ejecución completa prepara un CLIENTE y productos/servicio/promoción aislados. Antes de una regresión completa, desactivar las promociones `TEST …` sobrantes de ejecuciones parciales (ver README, «Higiene de preparación»).

## Cómo interpretar

1. «Verificado» en Notion es una marca de revisión del propietario; no controla expectativas. `expectedFailureIDs` es una lista explícita (hoy solo QA-035, pendiente de confirmar la regla de roles). Vacía no significa «todo resuelto».
2. Un fallo esperado es una incidencia reproducida, no funcionalidad aprobada. Un unexpected pass exige re-test y retirar el ID. Una omisión no cuenta como aprobado.
3. Separar siempre: defectos de la aplicación, errores del arnés/preparación, casos omitidos (con su motivo) y fallos esperados.
4. No volver a registrar la impresión nativa automática como incidencia: tras confirmar una venta se recarga.

## Decisiones de negocio pendientes

- QA-035: roles que pueden agregar stock (hoy cualquier personal por la RPC; Inventario es ADMIN/CAJERA) y si el personal puede insertar movimientos de stock directamente.
- Privilegios por defecto TRUNCATE/REFERENCES/TRIGGER de `anon` y `authenticated` (ver COBERTURA.md): decidir si se revocan.

(QA-033 quedó resuelto con la regla aprobada: solo ADMINISTRADOR y CAJERA crean y anulan ventas, en pantalla y en el backend.)

- Estado de un pedido web cuya venta se anula (hoy `CANCELADO`; ¿`DEVUELTO`? ¿devolución de dinero?), incluido el pedido ya ENTREGADO.
- Plazo de cancelación por defecto mostrado en el detalle de servicio (QA-029) y coma decimal en importes (QA-028).
