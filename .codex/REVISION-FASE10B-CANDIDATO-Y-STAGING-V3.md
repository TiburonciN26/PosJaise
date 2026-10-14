# Revisión QA Fase 10B · V3 · cierre de F10B-04b

Fecha: 2026-10-13, America/Lima. Commit revisado: `539ca880484eba041b96dce8dbe0f0ee904060aa`.

**Veredicto:** F10B-04b queda cerrado. F10B-01, 02 y 03 mantienen su cierre; el workflow manual sigue aceptado. No quedan hallazgos bloqueantes de estas revisiones en las herramientas preparadas. Se puede continuar con el respaldo actualizado y el inventario real de producción, ejecutados por el usuario con las credenciales únicamente en su terminal. La aplicación del lote y la publicación quedan condicionadas a la revisión de ese inventario y del lote exacto: no se acredita el estado de producción por las pruebas ficticias.

## Comprobaciones

- Repetí las **38 regresiones sin red**, sin `-ConLocal`: **38/38, código 0**. Los cinco casos nuevos y los anteriores pasan. El harness usa psql ficticio; no conectó con ninguna base.
- Primer intento en sandbox: 34/38, con «Acceso denegado» al mover cuatro informes ficticios a histórico. La repetición con permisos suficientes y temporales dentro de una carpeta QA propia pasó 38/38. Es una limitación del primer entorno de ejecución, no un hallazgo del script. Se conserva la evidencia de ambas corridas.
- La versión anterior se conserva en `historico`; la salida actual empieza INCOMPLETO con CORRIDA antes de pedir credenciales. Las excepciones de lanzamiento, los códigos de error y los fallos de validación dejan la corrida actual incompleta. El control sano obtiene un id nuevo y COMPLETO. La prueba de error que incluye una contraseña ficticia acredita su redacción.
- La evidencia de Claude declara 40/40 = 38 sin red + 2 Local. No repetí el modo `-ConLocal`, porque también crea y elimina una base temporal. El inventario Local de solo lectura se había corroborado en V2; esta revisión no modifica schema ni datos.
- `src`, `public`, `index.html`, Vite, Worker, Functions, dependencias y migraciones no cambian frente al producto `05b7be34`. El aplicador y el workflow no cambian frente a `464f41b`. El SQL y la evidencia de staging aceptados conservan su alcance anterior. No repetí builds ni todas las fases.
- `main` permanece en `0dc629e`; Codex no hizo commit, push ni publicación.

## Alcance del siguiente paso

El respaldo se realiza con los scripts vigentes de `docs/lanzamiento/respaldo-real`, con el negocio sin movimiento y en una única ventana de PowerShell. Primero sesión y preflight; después los pasos restantes, comprobando cada COMPLETO. El usuario solo comparte los metadatos aptos para compartir, nunca el dump, las claves ni las contraseñas.

El inventario debe ser de la corrida actual, comenzar por `ESTADO|COMPLETO` y tener CORRIDA igual a la de su consola. Si falta alguna de las 23 versiones anteriores, el aplicador se detiene: habrá que revisar ese lote anterior separadamente. No se autoriza usar automáticamente el script antiguo de main.

Tras un lote parcial se requiere un respaldo nuevo, como ya precisó Claude. Se mantiene D11-A. El deployment real, su backend, Auth y configuración de medios/pagos se verificarán antes de dar el lanzamiento por terminado.

## Integridad

Los 2.171 archivos preexistentes examinados mantienen sus SHA-256. No se editaron archivos existentes ni el registro de fases; no hubo DDL ni escrituras de datos. Solo se generan este informe y nueva evidencia QA. Archivos: `guardas-repetidas-sin-restriccion.json`, `guardas-repetidas-sin-restriccion.log`, `integridad-proyecto.json`; la corrida inicial figura en `guardas-repetidas-codex.json`.