# Entrega QA para Claude Code (actualizado 2026-10-04)

Codex audita y Claude corrige. Esta rama `testing` contiene la suite, sus fixtures y la documentación; la aplicación se corrige en `fix/qa-correcciones` y se fusiona aquí para ejecutar. Referencia vigente: COBERTURA.md (matriz y brechas) y README.md (cómo ejecutar e interpretar). Los informes CAMPANA-AMPLIADA, RESULTADOS y BASELINE son históricos.

## Último resultado independiente (Codex, 2026-10-04)

`testing` 02a9f17, solo Supabase Local TEST, una única suite completa con fixture nuevo (sin `QA_REUSE_FIXTURES`), retries=0, 24,1 min: **213 aprobados de 214, 1 omisión conocida (crear servicio como ASISTENTE; no cuenta como aprobado), 0 fallos, 0 intermitentes**. Cinco casos específicos previos (QA-050 y QA-051) aprobados; son parte de los 214, no escenarios adicionales. QA-051 quedó Verificado en Notion y QA-050 incluye sus mediciones; programa y parámetros restaurados (`actualizado_en` avanzó normalmente). No queda corrección pendiente en este lote.

Historial que se conserva: la corrida anterior (208 aprobados, 1 fallo de selector del arnés en COMISIÓN, 1 omisión) y los fallos de QA-049/QA-050/QA-051 detectados en rondas previas están en los informes de Codex y en Notion; no se borran. Limitaciones: la capa `node --test` (SQL, claims simulados) no se repitió en la corrida de Codex; la suite verde no cierra Fase 2 (ver COBERTURA.md, «Brechas de Fase 2», y `docs/recompensas-fase2/PLAN-LOTE-SIGUIENTE.md`). Este cierre no leyó el INFORME.md de Codex directamente (ruta fuera del directorio de trabajo): las cifras vienen del resumen entregado por el usuario.

## Entorno

Exclusivamente `localhost:5173` con Supabase Local `http://127.0.0.1:54321`. La suite exige la rama `testing`, comprueba la URL efectiva de Supabase y bloquea orígenes externos antes de cada test; no se debilita. No instalar dependencias ni editar `.env`. La contraseña de las cuentas QA se entrega por `QA_TEST_PASSWORD`.

```powershell
$env:QA_TEST_PASSWORD='<contraseña de las cuentas ficticias>'
node node_modules/playwright/cli.js test --config=playwright.qa.config.mjs
node tests/e2e/archive-run.mjs nuevo-corte
```

Cada ejecución completa prepara un CLIENTE y productos/servicio/promoción aislados. Antes de una regresión completa, desactivar las promociones `TEST …` sobrantes de ejecuciones parciales (ver README, «Higiene de preparación»).

## Cómo interpretar

1. «Verificado» en Notion es una marca de revisión del propietario; no controla expectativas. `expectedFailureIDs` es una lista explícita (hoy vacía; QA-035 se corrigió en Local y sus pruebas pasan de verdad). Vacía no significa «todo resuelto».
2. Un fallo esperado es una incidencia reproducida, no funcionalidad aprobada. Un unexpected pass exige re-test y retirar el ID. Una omisión no cuenta como aprobado.
3. Separar siempre: defectos de la aplicación, errores del arnés/preparación, casos omitidos (con su motivo) y fallos esperados.
4. No volver a registrar la impresión nativa automática como incidencia: tras confirmar una venta se recarga.

## Decisiones de negocio pendientes

- QA-035 quedó resuelto con la regla aprobada (solo ADMINISTRADOR y CAJERA agregan stock; el historial solo lo escribe la RPC); pendiente solo el re-test de Codex y la autorización aparte para producción (migración 20261002000008).
- Privilegios por defecto TRUNCATE/REFERENCES/TRIGGER de `anon` y `authenticated` (ver COBERTURA.md): decidir si se revocan.

(QA-033 quedó resuelto con la regla aprobada: solo ADMINISTRADOR y CAJERA crean y anulan ventas, en pantalla y en el backend.)

- Estado de un pedido web cuya venta se anula (hoy `CANCELADO`; ¿`DEVUELTO`? ¿devolución de dinero?), incluido el pedido ya ENTREGADO.
- Plazo de cancelación por defecto mostrado en el detalle de servicio (QA-029) y coma decimal en importes (QA-028).
