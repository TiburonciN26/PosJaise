# Revisión IP-R1/IP-R2: guardas corregidas, corrida real incompleta

Fecha: 10 de octubre de 2026, America/Lima. Codex: QA de solo lectura.

## Veredicto

**31/31 regresiones repetidas por Codex, sin fallos. Las correcciones centrales de IP-R1 e IP-R2 están implementadas. La entrega del verificador queda pendiente por dos variantes adicionales P2 reproducidas de forma independiente: redirecciones en `fetch` y limpieza con rechazo del DELETE de la base de datos.** No son fallos nuevos encontrados en la aplicación ni reabren F3-07.

La corrida real del script corregido no acredita un recorrido completo: el §13 declara 13 casos OK y parada en Galería. El JSON de 21/21 sigue siendo el de la versión anterior. Se mantiene la aceptación de aquella evidencia con su alcance original; no puede rotularse como evidencia del script corregido.

No recomiendo todavía el commit del paquete completo con el verificador. Corregir IP-R1b/IP-R2b y aportar las regresiones antes de revisar ese paquete para publicación. Una entrega separada de documentación histórica puede distinguirse, pero no equivale a cerrar la prueba real.

## Revisado y ejecutado

- HEAD sigue en `ba07a32a78bcbad12f594e9fc842b49640d42b61`. Sin commit, push, fetch ni cambios de fuentes/configuración por Codex.
- Leídos `scripts/verificar-interfaz-r2-preview.cjs`, `scripts/lib/guardas-interfaz-r2.cjs`, las regresiones, el clasificador compartido de claves y las adiciones del runbook/changelog.
- Ejecutado `node scripts/verificar-guardas-interfaz-r2.cjs`: **31 casos, cero fallos**. Todo en memoria; no escribe evidencia en el proyecto ni usa cuentas reales.
- `node --check` pasa para el verificador y la librería.
- Reproducciones adicionales en una carpeta de diagnóstico externa: servidores HTTP efímeros exclusivamente locales con valores inventados, Chromium con dependencias ya instaladas y limpieza simulada en memoria. No se instalaron dependencias.
- Lecturas de staging con la cuenta QA existente y del inventario del Worker. No se ejecutó el verificador real ni ningún PUT/DELETE contra staging/R2.
- Escaneo de diez candidatos actuales: sin coincidencias de valores sensibles locales de staging, cadenas de conexión o contraseñas derivadas de URL ni formatos de secretos examinados. No se imprimieron esos valores. El escaneo no garantiza ausencia universal de datos sensibles ni verifica otros transcripts.

## Correcciones confirmadas

IP-R1 ahora exige alias y backend de staging exactos, cuenta QA, clave pública clasificada y marca esperada de ocho caracteres. `preflight` compara el HTML antes de llamar al login. Una marca incorrecta lanza un error. ADMIN y CLIENTE instalan la guarda y el observador antes de navegar; destinos sensibles incorrectos se abortan.

IP-R2 ahora toma snapshots, exige fixtures sin fotos/galería, usa título por ejecución y compara diferencias de claves completas. Las lecturas ilegibles lanzan; la selección normal de limpieza usa el ID propio. Se corrigieron las precisiones de cobertura y se compara explícitamente la URL de «después» en Galería.

Esto resuelve las reproducciones originales de alias/ref en query y del borrado indiscriminado por título compartido. Las variantes siguientes están en el transporte y la ejecución del cleanup, no en aquellas comparaciones.

## IP-R1b — P2: la redirección automática sale de la lista de orígenes

Archivo: `scripts/lib/guardas-interfaz-r2.cjs`, función `crearFetchSeguro` (líneas 81–87); integración `scripts/verificar-interfaz-r2-preview.cjs`, líneas 59–65 y 106–108.

La guarda valida únicamente el URL inicial y llama a `fetchReal(url, opciones)` sin controlar redirecciones. El `fetch` real sigue las redirecciones por defecto. Por ello la lista cerrada no se aplica al siguiente destino; validar `response.url` después no evita que ya haya salido la petición.

**Reproducción real, exclusivamente local:** origen A incluido en el Set aprobado responde 307 hacia origen B no aprobado. Se llamó a la librería original con un POST y cabecera/cuerpo ficticios. B recibió una petición, la cabecera `apikey` ficticia y la contraseña ficticia del cuerpo; la respuesta terminó en 200. `diagnosticos.json` registra `destinoFinalAprobado: false` y `recibioPasswordFicticio: true`. No se usaron credenciales reales ni servidores externos.

No afirma que staging haya redirigido o filtrado credenciales en la corrida existente: demuestra que el mecanismo no garantiza la restricción que declara.

Corrección recomendada: rechazar redirecciones (`redirect: 'error'`, impuesto por la guarda) o usar redirecciones manuales validando cada salto antes de enviarlo, sin reenviar credenciales a otro origen. La opción no puede quedar anulable por el llamador. Probar 307/308 con POST y un destino no aprobado, verificando cero peticiones al segundo origen; cubrir también el preflight del HTML.

## IP-R2b — P2: eliminar objetos antes de confirmar el DELETE deja referencias rotas

Archivo: `scripts/verificar-interfaz-r2-preview.cjs`, líneas 328–340 (limpieza del `finally`).

El cleanup elimina primero los grupos R2 de la fila propia y después llama al DELETE de `galeria_web`. No inspecciona el estado de esa respuesta. Un 403/500 deja la fila referenciando archivos que el script ya borró, y el aviso cuenta como eliminada la fila aunque solo se intentó borrarla.

**Reproducción sin red:** ejecuté el bloque original con una fila propia, Worker DELETE 200 y REST DELETE 403. El resultado conserva la fila y elimina su objeto; el texto informa «Filas propias eliminadas: 1». Ver `limpieza-rechazada.json`. REST y Worker estaban sustituidos por memoria: no hubo DELETE real.

Corrección recomendada: confirmar primero la eliminación de la fila propia, incluyendo los resultados inciertos con una lectura de reconciliación, y solo entonces eliminar sus objetos. Ante rechazo o lectura desconocida, conservar los archivos e informar pendiente. Si la fila se borró pero el Worker falla, registrar el objeto pendiente sin presentar limpieza completa. Los contadores deben reflejar resultados confirmados. Añadir regresiones para DELETE 403/500, respuesta perdida con y sin commit y lectura caída; ninguna fila existente debe quedar apuntando a objetos borrados.

## Otras observaciones, sin nuevo bloqueo

- El endpoint del Worker lista hasta 500 objetos por llamada y devuelve `cursor`. `leerInventario` no lo recorre ni aborta si existe. El bucket actualmente vacío no supera ese límite, pero el verificador no debe declarar un snapshot completo al reutilizarse con inventarios paginados. Recomendación: paginar o rechazar `cursor` no vacío antes de escribir/limpiar; añadir una regresión.
- La salida JSON está después del `try/finally`; si el recorrido lanza, no se escribe un informe nuevo. Eso explica que siga allí el 21/21 antiguo. Guardar el resultado de la corrida fallida en su propia carpeta con versión del script, marca, error y limpieza confirmada; no mezclar las capturas que se van sobrescribiendo con el JSON histórico.
- Revisé también la advertencia de [Playwright sobre routing y Service Workers](https://playwright.dev/docs/api/class-browsercontext#browser-context-route). En el navegador instalado, mi caso local con SW controlador **sí fue bloqueado** (cero peticiones recibidas), igual que el control con `serviceWorkers: 'block'`. No lo reporto como fallo reproducido. Si se opta por bloquear SW en este verificador para simplificar el aislamiento, documentar que esa corrida no valida la PWA.
- La lista de destinos del navegador permite terceros fuera de las familias sensibles, por ejemplo fuentes. Las notas no deben describirla como una lista estrictamente cerrada de todos los orígenes. La del `fetch` sí pretende ser cerrada y requiere IP-R1b.

## Estado actual y decisiones del usuario

La lectura independiente de hoy confirma producto y servicio con `foto_url = null`, cero filas de sus galerías y cero objetos en los tres inventarios. `galeria_web` conserva «Foto de prueba (Inicio)» y la residual `5bb670df-db45-4c70-a6aa-40b856fbf8a6` («QA fase 3 (borrar)»). No modifiqué ni borré esa fila.

La guarda bloqueando la URL local de la residual es el resultado esperado; no debe relajarse para terminar la corrida. Mi recomendación es retirar ese fixture obsoleto de staging tras autorización explícita del usuario, conservando el otro registro. No implica tocar producción. Dejarlo solo inactivo puede no bastar si el listado ADMIN sigue cargando la miniatura; la fila no puede conservar URLs locales que el recorrido intente solicitar.

El aviso de contraseña debe tratarse por separado: recomiendo **rotar únicamente la contraseña de BD de staging** expuesta y actualizar privadamente los consumidores que la utilicen. Un archivo ignorado por Git no elimina lo ya impreso en el transcript y no permite afirmar que «no salió de la máquina». No es necesario copiarla al chat ni al informe; Codex no la leyó en el transcript ni ejecutó la rotación. Esta revisión no verifica que el incidente se haya contenido ni que producción haya cambiado.

Después: corregir las dos variantes del verificador, resolver la fila residual con autorización, repetir el recorrido real con evidencia separada, revisar el listado actualizado y validar el commit exacto desde checkout limpio antes del push autorizado a `feat/cloudflare-pages`. No retirar GitHub Pages ni escribir referencias R2 en el negocio por esta entrega.

## Archivos y evidencia

Diez candidatos: los dos documentos modificados, `clon-limpio-commit.json`, verificador, librería de guardas, suite de regresiones y cuatro archivos de `interfaz-preview/` (JSON + tres PNG). Lista y hashes en `publicacion-candidata.json`. Excluir `.codex/**`, `.env*` y las capturas antiguas no versionadas de Fase 1.

Evidencia nueva en `.codex/evidencia-interfaz-preview-r2-v2/`: `regresiones-31.txt`, `diagnosticos.json`, `diagnosticos.txt`, `limpieza-rechazada.json`, `limpieza-rechazada.txt`, `estado-actual-lectura.json` y `publicacion-candidata.json`. Los códigos son copias de diagnóstico como texto para no incorporarlos al lint del proyecto.

Se creó únicamente el informe y la evidencia de QA bajo la autorización persistente de guardarlos en `.codex`. No se cambió la aplicación, configuración, Git, credenciales, usuarios, base de datos ni objetos reales.
