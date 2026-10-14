# Cierre Fase 9 · Observaciones de la revisión V2.1

Fecha: 2026-10-12. Veredicto de Codex ([REVISION-FASE9-MEDIOS-V2.1.md](REVISION-FASE9-MEDIOS-V2.1.md)): **APROBADA CON OBSERVACIONES, solo para implementación y preparación/QA LOCAL**. F9-01…F9-06 y F9-03b cerrados. No aprueba una migración de medios del negocio ni la aplicación en staging o producción de `20261012000003`.

| Obs. | Qué dice | Qué se hizo / qué queda |
| --- | --- | --- |
| O1 · ACL reales | La migración no revoca EXECUTE a `service_role`, que lo hereda por defecto, y el propietario `postgres` también lo tiene. El helper `migracion_medios_columna_permitida` no exige `es_admin()` (solo devuelve si un nombre está en la lista). | Corregidas las frases de la entrega V2.1, de `implementacionesWed.md` §55 y del comentario de la migración, que no cambia SQL ejecutable. Hash nuevo del archivo: `764c50b2…`. **Decisión antes de cualquier despliegue remoto:** si la política es excluir también `service_role`, añadir `revoke execute … from service_role` en las dos funciones que escriben. No se implementó. |
| O2 · Reloj del cliente | La CLI calcula `vence` con `Date.now()` del equipo operador, y el servidor lo compara con su `clock_timestamp()`. Un desfase acorta el plazo (cambio `vencida`, definitivo y reintentable) o alarga la espera. | Antes de usarla en remoto: sincronizar el reloj (NTP) del equipo operador y ensayar en staging un desfase controlado (plan de staging, `PLAN-VALIDACION-STAGING-FASE10.md` §4). Alternativa a valorar: pedir la hora al servidor y fijar `vence` con ella. No se implementó. |
| O3 · `--espera-max-ms` | Limita la espera programada por `faltan_ms`, pero no es un timeout duro de cada petición a la barrera: una RPC bloqueada o una red colgada puede excederlo. | Documentado. La intención se conserva ante una interrupción. Validar timeouts y recuperación en staging antes de operar en remoto. |
| O4 · Retirada de las funciones | No retirarlas con operaciones abiertas o ejecuciones activas. Las operaciones sin plazo requieren revisión manual. Volver a V2 reabre F9-03b. | Ya estaba en `evidencia-fase9-v2.1/rollback/rollback-fase9-v2.1.md`. Se mantiene. |

**Alcance acreditado (Codex):** casos ensayados y operación serial de la herramienta. No cubre varios manifiestos independientes sobre las mismas filas, otras configuraciones de aislamiento ni una infraestructura remota distinta.

**Se mantienen como puertas del plan:**
- inventario real del negocio;
- despliegue y ensayo de la SQL en staging con fixtures y permisos normales;
- compatibilidad de lectores antiguos y PWA;
- elección de origen;
- periodo de reversión;
- perfiles y QR;
- comunicación pública.
