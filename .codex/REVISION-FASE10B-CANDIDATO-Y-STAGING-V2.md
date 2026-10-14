# Revisión QA Fase 10B · candidato y staging · V2

Fecha: 2026-10-13, America/Lima. Commit revisado: `464f41be0c7d49803fde8035d1911f9a46f4f7f6`. Codex actúa solo como QA.

**Resultado:** F10B-01, F10B-02 y F10B-03 quedan cerrados. El cambio del workflow de GitHub Pages queda aceptado para el lanzamiento previsto. F10B-04 mejora y pasa sus controles principales, pero queda la variante **F10B-04b (P2): un fallo al arrancar el inventario deja un informe antiguo rotulado COMPLETO**.

Se puede avanzar con el respaldo actualizado, que es de lectura y corresponde al usuario. Para usar el inventario como evidencia del estado actual debe resolverse la variante indicada o garantizar una salida nueva por corrida, sin aceptar un archivo anterior tras una ejecución fallida. El lote de producción y la publicación siguen pendientes del inventario real y de su revisión. No se autoriza una aplicación a ciegas.

## Comprobaciones repetidas por Codex

- HEAD = `464f41b`; `main` sigue en `0dc629e`. `main` es ancestro. No hay cambios del producto ni de las migraciones frente a `05b7be34`; el alcance de staging aceptado en V1 conserva su identidad.
- Repetí `probar-guardas-10b.ps1` sin `-ConLocal`, con salida en la carpeta QA externa: **33/33, código 0**. Revisa los scripts originales, con psql ficticio y sin conexiones remotas.
- La evidencia de Claude tiene **35 casos en total = 33 sin red + 2 Local**, no 35 más 2. Es una precisión del informe, no un fallo del producto.
- Ejecuté el inventario sobre **Supabase Local WedJaiseReact**, identificado por sus contenedores y gateway `127.0.0.1:54321`. Exclusivamente SELECT con `default_transaction_read_only=on`: COMPLETO, política de lectura confirmada, funciones de vitrina presentes, compatibilidad instalada y cero deudas incoherentes. No creé ni borré la base antigua temporal del harness; ese segundo caso Local no lo repetí, porque implica DDL.
- `-SoloGenerar`, con carpeta de salida externa: las **11 transacciones coinciden byte a byte con V1**, incluido el par atómico de deudas. No se ejecutó ese SQL.
- Inspección del workflow: `on` contiene únicamente `workflow_dispatch`; no queda `push` en el workflow de Pages. Los comentarios iniciales sobre despliegue automático son históricos. No se ejecutó ni se editó el workflow.
- GET del HTML público de GitHub Pages, sin ejecutar la app ni consultar Supabase: HTTP 200, SHA-256 `9ade57fe755dc95babab5f0b18a5d1a1445dea69b8fe86391c3e10e0c1346353`, bundle `/PosJaise/assets/index-BYFcUGaT.js`. Confirma la identidad del HTML que Claude propone conservar. No confirma por sí mismo todos los archivos o las PWA instaladas.

Evidencia: `evidencia-revision-fase10b-v2/guardas-repetidas-codex.json`, `inventario-local-verificado.json`, `comparacion-sql-v1-v2.json`, `identidad-y-workflow.json`, `github-pages-actual.json`.

## Cierre de los hallazgos anteriores

**F10B-01:** el aplicador utiliza la estructura del procedimiento real, comprueba pasos, proyecto declarado, finalización y antigüedad, y recalcula hashes de dump, roles, definiciones y huella antes de pedir credenciales. Los controles de marcador vacío, archivo ausente/alterado y respaldo incompleto rechazan. La conexión posterior verifica cantidad de versiones y existencia de la venta registrada. Eso no demuestra equivalencia íntegra de datos, definiciones SQL o contenido de Storage; no se debe describir como una huella completa de la base actual ni como una restauración real comprobada.

**F10B-02:** lecturas de autorización con código y formato estrictos; versiones con cierre y cardinalidad, conteos con un entero único. Las lecturas inciertas ya no generan un plan. La relectura fallida después de una transacción tampoco informa COMPLETO. Se exige `APLICAR` con mayúsculas.

**F10B-03:** se exige el conjunto exacto de las 23 versiones anteriores, admitiendo adicionales. Las 23 sustituciones con el mismo total se rechazan.

**F10B-04:** los errores devueltos por psql, las secciones faltantes y la falta de solo lectura generan INCOMPLETO y fallo. Las funciones se nombran correctamente y las tablas opcionales se consultan sin resolverlas cuando faltan. Subsiste la excepción de arranque descrita abajo.

## F10B-04b · P2 · informe antiguo COMPLETO después de un arranque fallido

Archivo: `docs/lanzamiento/aplicar-produccion/inventario-produccion-10b.ps1`, bloque que llama a `Ejecutar` y escribe el informe (aproximadamente líneas 67–91).

**Secuencia reproducida:**

1. Existe un archivo de salida con `ESTADO|COMPLETO` de una ejecución previa.
2. La siguiente ejecución no consigue resolver/iniciar Docker.
3. `Ejecutar` lanza una excepción antes de devolver `$r`. Se sale por `finally` sin escribir el estado de la corrida actual.
4. El comando falla, pero el archivo que Claude debe leer **permanece intacto y sigue empezando con `ESTADO|COMPLETO`**.

Lo reproduje con el script original y una salida ficticia externa, tanto con el adaptador de prueba que lanza como con el adaptador original: un alias temporal de `docker` apuntaba a un ejecutable inexistente en la carpeta QA. No se lanzó Docker ni se abrió ninguna conexión en esas reproducciones. El archivo conservó exactamente su hash anterior.

El harness actual no detecta esta variante: para «proceso inexistente» permite que no exista informe (`... -or $c.n -eq 'proceso inexistente'`) y utiliza un nombre de salida nuevo, nunca un archivo COMPLETO anterior. Por eso las 33 pruebas pasan sin acreditar que todos los fallos de arranque invaliden la evidencia anterior.

**Impacto:** quien recibe únicamente `inventario-produccion.txt` puede interpretar un inventario antiguo como resultado actual. No es una escritura indebida ni una ejecución falsamente exitosa: el comando sí falla. El defecto es la evidencia reutilizable que conserva su apariencia de válida.

**Corrección recomendada para Claude:** asegurar un informe de la corrida actual INCOMPLETO ante una excepción de lanzamiento/ejecución; o usar archivos únicos por corrida con una identificación explícita de cuál es la última y de su estado. Se pueden conservar los informes históricos, pero no presentarlos como salida válida del último intento fallido. No registrar contraseñas en los diagnósticos.

**Regresión de cierre:** sembrar una salida COMPLETO, provocar un fallo de arranque con el adaptador original y comprobar: código no cero, la corrida actual queda INCOMPLETO y el histórico no se puede confundir con ella. Repetir el caso sin archivo anterior y conservar el control sano y el error de psql.

Evidencia: `casos-adicionales-codex.json`, `inventario-adaptador-real-fallido.json` e `inventario-comando-inexistente.json`.

## Observaciones de recuperación y documentación

**Repetir después de un lote parcial requiere un respaldo nuevo.** Lo comprobé con los helpers originales del harness, extraídos por AST, y el aplicador original. Tras fallar la transacción 7, la base ficticia tenía 32 versiones y el respaldo original registraba 25. Reutilizar esa misma corrida se detuvo con cero transacciones por la guarda del respaldo. Con una corrida nueva que registraba 32 versiones, se aplicaron las 5 pendientes y se completó.

La regresión de Claude también crea `Nueva-Corrida` entre ambos intentos. Su éxito es correcto, pero «volver a ejecutar continúa donde quedó» debe indicar ese requisito. No recomiendo debilitar la comprobación del respaldo para conseguir una repetición automática.

**Workflow manual:** el cambio está preparado en la rama, todavía no en `main`. Acepto ese diff para el paso previsto; no significa que haya ocurrido el push ni que el workflow del `main` actual haya cambiado ya. Conservar GitHub Pages no resuelve por sí mismo la retirada de las PWA antiguas, que sigue fuera de este paso.

## Próximo paso acotado

Claude corrige únicamente F10B-04b y precisa las dos frases documentales (33+2 y respaldo nuevo para repetir). No necesita cambiar la app o las migraciones ni repetir las fases anteriores. Mientras tanto el usuario puede hacer el respaldo actualizado con sus credenciales exclusivamente en su terminal.

Después corresponde ejecutar un inventario fresco y exitoso, revisar su resultado y el lote exacto que derive de él. La ausencia de las 23 migraciones anteriores detiene el aplicador; si el inventario acredita que faltan, el plan para ese lote anterior tendrá que revisarse separadamente. Esta revisión no autoriza usar a ciegas el script antiguo de `main`.

D11-A se mantiene. Las excepciones/pendientes de rendimiento no cambian. Production, Auth y Cloudflare requieren su configuración real y la verificación del deployment exacto antes de dar por terminado el lanzamiento. No se introducen nuevos requisitos de dominio o R2 para la publicación acordada.

## Integridad del proyecto

Los **2.156 archivos preexistentes** examinados conservan sus SHA-256; ninguno fue editado o eliminado, incluido el registro de fases. HEAD, `main` y el estado Git no cambiaron durante las pruebas. No hice commit, push, cambios remotos, DDL ni escrituras de datos.

Solo genero este informe y evidencia QA nueva. Las pruebas sin red crearon y limpiaron sus propios fixtures temporales; la lectura Local no modificó schema ni filas. Los hashes antes/después están en `archivos-antes.json`, `archivos-despues.json` e `integridad-proyecto.json`.