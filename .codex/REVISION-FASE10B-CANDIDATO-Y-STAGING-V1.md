# Revisión QA de la Fase 10B: candidato y staging · V1

Fecha: 2026-10-13, America/Lima. Revisor: Codex, exclusivamente QA y auditoría de lectura.

**Veredicto:** acepto las evidencias del candidato `05b7be34` en sus alcances de staging. **No doy el visto bueno para ejecutar el aplicador en producción todavía:** hay cuatro hallazgos en las herramientas de preparación/aplicación, tres P1 y uno P2. No encontré en esta revisión un nuevo defecto funcional del producto. Los pendientes menores de rendimiento no se convierten en obstáculos nuevos para el lanzamiento, conforme a la prioridad del usuario.

Claude debe corregir las herramientas y entregar sus regresiones. El respaldo real, el inventario de producción y la revisión de su resultado siguen siendo necesarios; staging no acredita el estado de la base del negocio. No ejecuté ninguno de esos pasos remotos.

## Candidato e inspección independiente

- Producto: `05b7be34`. HEAD de la rama: `b308b1ffc2ff1afd0e8d61d0b2c6c220474cfd26`; `main`: `0dc629e430ed07eeaccec273d31de93e9717d9bf`. `main` es ancestro del candidato.
- El diff candidato→HEAD de `src`, `public`, `index.html`, Vite, Functions, Worker, dependencias, migraciones y workflows está vacío. Los commits posteriores añaden herramientas de QA/lanzamiento.
- Los 152 hashes del manifiesto coinciden con el árbol examinado. Comparados con los blobs del commit exacto, 62 archivos difieren solo por CRLF/LF; ninguno difiere en contenido. Esto es comparación de fuentes, no un build repetido por Codex.
- La migración de compatibilidad de deudas tiene el mismo cuerpo que el borrador V3 revisado, excluyendo comentarios y el envoltorio de transacción. Mantengo la decisión del usuario **D11-A** y la regla operativa sobre deudas con abonos.
- GET independiente del deployment inmutable `https://43d3eeb4.pos-jaise.pages.dev`: marca `05b7be34`, 143 módulos y backend efectivo de staging aprobado. SHA-256 de `sw.js`: `b9ab824a604facadac8d27e41712e28c5165c9905f648fb37f0beafe2057a61d`, igual al A de la evidencia PWA.
- `/medios` responde 404 `no-store`, `nosniff`, `noindex`; `/ventas` y `/productos` conservan el documento SPA del candidato.
- Chromium, visitante sin login: Inicio, Productos, Servicios y Nosotros montan con contenido, sin aviso de carga fallida, errores de página ni violaciones de la guarda. Service workers bloqueados para este smoke; terceros neutralizados. No es una repetición de los recorridos con cuentas.
- Barrido básico de secretos sobre los archivos textuales del manifiesto del commit: sin coincidencias de conexiones con contraseña, `sb_secret_`, llaves privadas Culqi ni JWT literales. No se leyeron `.env` y no es una garantía universal sobre el historial del repositorio.

Evidencia nueva: `evidencia-revision-fase10b-v1/identidad-candidato.json`, `preflight-staging-independiente.json`, `smoke-publico-staging.json`, `auditoria-evidencias.json`.

## Hallazgos que debe corregir Claude

| ID | Prioridad | Archivo y línea | Problema |
| --- | --- | --- | --- |
| F10B-01 | P1 | `docs/lanzamiento/aplicar-produccion/aplicar-lote-10b.ps1:108` | La guarda de respaldo acepta un marcador vacío sin dump y no reconoce la salida del procedimiento indicado. |
| F10B-02 | P1 | `docs/lanzamiento/aplicar-produccion/aplicar-lote-10b.ps1:124` | Una lectura fallida de versiones se interpreta como ninguna aplicada y permite enviar todas las transacciones. |
| F10B-03 | P1 | `docs/lanzamiento/aplicar-produccion/aplicar-lote-10b.ps1:121` | Contar 23 migraciones dentro de un rango no acredita las 23 versiones requeridas. |
| F10B-04 | P2 | `docs/lanzamiento/aplicar-produccion/inventario-produccion-10b.ps1:38` | El inventario informa «Listo» aunque falle la conexión; tampoco distingue un informe parcial de uno completo. |

### F10B-01 · respaldo no acreditado e incompatibilidad de formatos

La guarda únicamente busca `prod_*.dump.verificacion.txt` en la raíz y mira su fecha de modificación. No comprueba contenido, existencia del dump, hash, estado del respaldo ni identidad del proyecto. En la simulación, un archivo de cero bytes, recién creado, sin ningún dump, produjo **«OK Respaldo verificado reciente»** y permitió consultar la base simulada.

El procedimiento que el lanzamiento manda seguir utiliza otra estructura: `01-preflight.ps1:30` crea `corrida_<UTC>/`; el paso 2 guarda ahí el dump y registra su hash; `06-verificar-y-manifiesto.ps1:35` genera `manifiesto.json` y el paso 6 termina con `metadatos-para-compartir.txt`. Ninguno de esos pasos crea el marcador exigido. Un fixture con esa estructura quedó rechazado antes de conectar. La simulación acredita el desacuerdo de formatos, no una restauración de un respaldo real.

**Corrección recomendada:** integrar el aplicador con el manifiesto real y su corrida; validar proyecto, finalización correcta, antigüedad del respaldo y existencia/hashes de los archivos requeridos. Usar la fecha de la corrida completada, no la fecha editable de un marcador. No resolverlo creando manualmente el archivo vacío.

**Regresiones mínimas:** salida sana del procedimiento aceptada; marcador vacío, dump ausente, dump alterado, respaldo fallido, proyecto distinto y respaldo vencido rechazados antes de conectar o escribir.

### F10B-02 · error al leer versiones autoriza la aplicación

La primera consulta comprueba `Codigo`; la segunda, que determina todas las pendientes, no lo comprueba. Una salida `ERROR: ...` se añade a `$hechas`, no coincide con ninguna versión y se convierte en «faltan las doce».

Reproducción con el código original en memoria y `docker` ficticio: conteo histórico sano, lectura de versiones con código 2 y texto de error. El script llegó a pedir `APLICAR`, envió **11 transacciones simuladas** y terminó con **«COMPLETO»**. No se ejecutó SQL real. Este es un riesgo de repetición de migraciones existentes, especialmente porque el relleno de `20261010000001` no es idempotente.

**Corrección recomendada:** cualquier lectura utilizada para autorizar cambios debe exigir código 0 y respuesta válida y completa, antes de construir el plan. Validar formato/cardinalidad de las versiones; no interpretar una lectura incierta como ausencia. Aplicar también ese criterio al conteo de deudas, a las relecturas de registro y a la comprobación final.

**Regresiones mínimas:** fallo de la segunda consulta, salida malformada y error del proceso → cero transacciones y cero confirmaciones de aplicación; lista sana → plan esperado.

### F10B-03 · histórico incompleto con el conteo correcto

La condición es `count >= 23` en el rango de fechas. No compara las identidades con la lista explícita de `aplicar-23-migraciones.ps1`. Es posible tener el mismo número y carecer de una función o corrección requerida por el frontend.

Reproducción: se quitó de la respuesta ficticia `20261002000001` y se agregó `20261007009999`. El total siguió siendo 23. El aplicador pasó la guarda, pidió confirmación, envió las 11 transacciones simuladas y declaró «COMPLETO».

**Corrección recomendada:** comparar las 23 versiones exactas requeridas, admitiendo versiones adicionales sin que sustituyan a ninguna requerida. Detallar las ausentes y abortar antes de aplicar. La revisión del inventario deberá verificar los objetos y funciones críticos; el historial por sí solo no demuestra sus definiciones actuales.

**Regresiones mínimas:** sustituir cada requerida por una ajena manteniendo el total debe rechazar; las 23 exactas y las 23 más versiones adicionales deben aceptar.

### F10B-04 · inventario aparentemente listo tras un fallo

El inventario captura la salida de `docker/psql`, la escribe y siempre imprime el aviso verde, sin comprobar `$LASTEXITCODE`. Además utiliza `ON_ERROR_STOP=0` y no valida la presencia de los registros obligatorios.

Reproducción: proceso ficticio con código 2 y `FATAL: fallo de conexion ficticio`. Se generó `inventario-produccion.txt` que solo contenía la cabecera y el error; se imprimió **«Listo ... Avise a Claude»**, sin excepción.

También hay incongruencias de cobertura que conviene resolver en el mismo cambio: el inventario busca `catalogo_publico_productos` y `libro_reclamaciones_registrar`, pero las migraciones crean `productos_categorias_publicas`, `productos_vitrina_publica`, sus equivalentes de Servicios y `registrar_reclamo`. La consulta de `recompensas_config` referencia directamente la relación aun cuando la cláusula pretende comprobar si existe; no es una consulta segura para un esquema que carezca de esa tabla.

**Corrección recomendada:** distinguir explícitamente inventario completo e incompleto, conservar los errores como diagnóstico, salir con error en una corrida incompleta y no presentar sus ausencias como datos confirmados. Alinear los nombres con los objetos reales y consultar las tablas opcionales sin referenciarlas antes de comprobar su existencia.

**Regresiones mínimas:** conexión fallida, proceso inexistente, SQL fallido y sección obligatoria ausente → incompleto y código no cero; esquema antiguo conocido → ausencias explícitas verificadas; esquema sano → informe completo.

## Cómo se reprodujo, sin tocar el proyecto ni una base

Se evaluaron los dos scripts originales como bloques de PowerShell en memoria. Solo se redirigieron sus carpetas de evidencia a una carpeta QA externa; las migraciones se leyeron desde el repositorio para conservar las comprobaciones de hash y construcción del lote. `docker` y `Read-Host` se sustituyeron por dobles. El host fue `qa.invalid` y la contraseña una cadena ficticia. Nunca se lanzó Docker, nunca se abrió una conexión y nunca se ejecutó SQL.

`simulacion-guardas-produccion-r2.json` contiene los seis escenarios, entradas, mensajes y número de llamadas/transacciones simuladas. La primera preparación del doble no recogía bien el input de la tubería y abortó; no se cuenta como evidencia de los hallazgos. La reejecución R2 corrigió únicamente el doble, sin modificar los scripts revisados.

## Evidencias de staging aceptadas y sus límites

La inspección de los JSON confirma los resultados aportados: roles 14/14; deudas con ambos frontends 8/8; operaciones 10/10; reversión de ventas con `main` 4/4; medios 23/23. Compatibilidad SQL tiene 19 casos más la comparación del estado final, es decir 20/20, tanto en Local como en staging. La PWA tiene 37 pasos correctos y service workers diferentes para A y B.

La foto RLS tiene **55 relaciones antes y 57 después**, para cuatro roles. Las 55 existentes mantienen sus resultados; solo se agregan `cupones_gestion` y `resenas_moderacion`. Las vistas se declaran `security_invoker`. Esto compara conteos y errores, no los ids ni el contenido de las filas. No acredita toda la base ni suplanta la verificación más fuerte de la Fase 7 Local.

No repetí las escrituras en staging ni las transacciones SQL de Claude. Acepto los informes dentro de sus alcances, junto con el smoke público y la identidad que comprobé independientemente. La asistente no está cubierta en staging, solo en Local. La intermitencia de la cita continúa como observación. La prueba R2 tampoco acredita una subida nueva a Supabase en el futuro deployment de producción: la selección por defecto se confirmó por código, y debe verificarse la configuración efectiva de ese build.

La entrega admite datos QA que permanecen en staging (ventas anuladas, pedido cancelado, perfil y capturas ficticias); no se afirma que toda esa base haya vuelto a su estado anterior. La igualdad de medios queda limitada al snapshot y las claves seleccionadas.

## Observaciones y controles restantes del lanzamiento

1. Si ya aparecen las doce versiones, el aplicador retorna antes de las comprobaciones finales (`aplicar-lote-10b.ps1:131`). El backend debe pasar la comprobación de triggers e invariantes incluso en esa ruta; «nada pendiente» no sustituye esa verificación.
2. La instalación conjunta de deudas registra la versión del día 13 antes de las del 11 y 12. Si falla una transacción posterior, una repetición quedará rechazada por «huecos». La parada es segura y el script avisa de no repetir; documentar una recuperación basada en el plan atómico real, sin quitar esa guarda a ciegas.
3. El workflow actual aún contiene `push: branches: [main]`. El cambio a solo manual es un paso pendiente correctamente declarado, no ya realizado. Revisar el commit que lo desactive **antes del push a main**, y conservar la identidad del deployment antiguo de GitHub Pages para la reversión.
4. La configuración real de Production, Auth, el respaldo y el inventario del negocio siguen sin verificarse. No se leyeron credenciales ni se inspeccionó la base de producción. El futuro deployment debe demostrar backend del negocio, proveedor Supabase y tarjeta desactivada.
5. Mantener D11-A y comunicarla al personal antes de convivir con las dos versiones. Los 18 presupuestos de rendimiento siguen incumplidos; esta revisión no los rebautiza como aprobados ni concede excepción permanente. Dominio propio, migración de fotos a R2 y refinamientos posteriores no se añaden como requisitos nuevos para este lanzamiento acordado.

## Próxima entrega solicitada a Claude

Corregir **solo los cuatro hallazgos en las herramientas de lanzamiento**, añadir regresiones sin red y remitir una V2. No hace falta repetir todas las fases ni modificar el producto para subsanarlos. No aplicar producción durante esa corrección. Después se revisará el respaldo/inventario real y el lote exacto que resulte, y el commit del workflow manual, antes de publicar.

## Integridad y archivos creados por Codex

Se compararon por SHA-256 los **2.143 archivos preexistentes** examinados, incluido el registro de fases: ninguno cambió ni desapareció; HEAD y el estado Git tampoco cambiaron durante las comprobaciones. No se editó fuente, configuración, migración, `.env`, registro de fases ni evidencia anterior. No hubo commit, push, cambios de schema/datos ni despliegue.

Solo se generan este informe y evidencia QA nueva. Las huellas antes/después están en `archivos-antes.json`, `archivos-despues.json` e `integridad-proyecto.json`. No incluyen el contenido de los archivos ni de credenciales.