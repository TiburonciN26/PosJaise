# Entrega 10B · V3: F10B-04b y precisiones documentales

Fecha: 2026-10-13, America/Lima. Responde a [REVISION-FASE10B-CANDIDATO-Y-STAGING-V2.md](REVISION-FASE10B-CANDIDATO-Y-STAGING-V2.md).

**Alcance:** solo `inventario-produccion-10b.ps1` y su arnés `probar-guardas-10b.ps1`. Commit `539ca88` en `feat/cloudflare-pages`; `main` sigue en `0dc629e`. No cambian el producto (`05b7be34`), las migraciones, el aplicador ni el workflow. **Nada se ejecutó en producción.**

## F10B-04b · corregido

El archivo de salida corresponde siempre a la corrida actual:

1. **Al empezar**, antes de validar el usuario y de pedir el host o la contraseña, el script:
   - mueve el informe anterior, si existe, a `historico\inventario-produccion.anterior-<fecha de escritura UTC>-<id>.txt`, sin cambiar su contenido;
   - escribe `ESTADO|INCOMPLETO` y `CORRIDA|<id>` con el diagnóstico «corrida en curso o interrumpida antes de terminar».
2. **Si falla el arranque o la ejecución**, el script vuelve a escribir el INCOMPLETO de esa corrida con el motivo y termina con error. Se cubren:
   - excepción al lanzar `docker` o `psql`;
   - usuario de otro proyecto;
   - código de salida distinto de 0;
   - secciones ausentes;
   - sesión que no es de solo lectura.
   Si el script se interrumpe con Ctrl+C o se cancela la petición de contraseña, el archivo conserva el INCOMPLETO «en curso».
3. **Solo si todo es correcto** escribe `ESTADO|COMPLETO` y `CORRIDA|<id>` con la salida. El id es nuevo en cada corrida.
4. **Contraseña:** si `PGPASSWORD` aparece en un mensaje de error o en la salida de diagnóstico, se escribe como `***`. Antes la contraseña no se escribía nunca; ahora se oculta también si un mensaje la incluyera.

Lectura de la evidencia: solo se toma como válido el archivo `inventario-produccion.txt` cuya primera línea sea `ESTADO|COMPLETO`. Su línea `CORRIDA|` debe coincidir con la que muestra la consola de esa corrida. Los archivos de `historico\` nunca se toman como resultado actual.

## Regresiones

Evidencia: [guardas-lote-10b-v3.json](evidencia-fase10b/guardas-lote-10b-v3.json). Resultado: **40/40 = 38 sin red + 2 contra Local** (solo lectura, más la base antigua temporal del arnés).

Casos nuevos (F10B-04b):

| Escenario | Resultado esperado |
| --- | --- |
| Informe COMPLETO anterior y `docker` apuntando a un ejecutable inexistente (alias temporal), con el **adaptador original** | Error. La corrida actual queda INCOMPLETO con un id nuevo. El anterior está en `historico\*.anterior-*` con el **mismo SHA-256**. La clave de prueba no aparece en el informe. |
| Sin informe anterior, mismo fallo de arranque | Error y un INCOMPLETO de la corrida actual. No se crea `historico\`. |
| Informe COMPLETO anterior y una excepción del ejecutor que incluye la clave en el mensaje | INCOMPLETO actual, con la clave sustituida por `***`. |
| Informe COMPLETO anterior y error de psql (código 2) | INCOMPLETO actual. El anterior pasa al histórico. |
| Control: informe COMPLETO anterior y corrida sana | COMPLETO con un id de corrida distinto. El anterior pasa al histórico. |

- Ya no existe la excepción del caso «proceso inexistente»: los 5 casos de F10B-04 exigen ahora `ESTADO|INCOMPLETO` y `CORRIDA|` en el archivo.
- **Contraprueba:** con el inventario de `464f41b` el arnés da 27/38. Fallan los 5 casos nuevos y los 6 de F10B-04 que ahora exigen `CORRIDA|`. El aplicador sigue en 27/27.

## Precisiones documentales (en la entrega V2)

1. Regresiones de la V2: **35 en total = 33 sin red + 2 contra Local**. No eran 35 más 2.
2. La repetición después de un lote parcial necesita un **respaldo nuevo**, hecho después del fallo. El respaldo anterior registra otro número de migraciones y el aplicador lo rechaza, que es el comportamiento correcto. La guarda no se debilitó.

Precisión de F10B-01, aceptada: las comprobaciones posteriores a la conexión (número de versiones y última venta) muestran que el respaldo corresponde a esa base. No son una huella completa ni demuestran una restauración.

## Pasos siguientes

Los ejecuta el usuario, con sus credenciales solo en su terminal:

1. Respaldo real, pasos 0–6, con el `01-preflight` actualizado.
2. Inventario fresco y COMPLETO.
3. Claude lee el inventario y propone el lote exacto. Codex lo revisa. Si faltan las 23 migraciones anteriores, ese lote se revisa por separado.
