# Revisión V2 de verificar-ml03-bundle.cjs

Fecha local: 10 de octubre de 2026 (America/Lima). Evidencia UTC del 11 de octubre. QA de solo lectura, sin cambios de implementación o recursos remotos.

## Veredicto

**Aceptados los tres ajustes del verificador.** El paquete v3 y ML-03 en el bundle compilado conservan la aprobación local anterior. No encontré nuevos bloqueos en este alcance. La herramienta revisada puede incorporarse al siguiente paquete útil de cambios, sujeto a la autorización de commit/push que corresponda; este informe no la otorga.

Codex repitió en Chromium el caso positivo 8/8 con código 0 y el control negativo con tres fallos esperados y código 1. Además verificó tres errores simulados: lanzamiento, navegación e interacción; los tres terminaron con código 2 y registraron servidor no escuchando y navegador desconectado.

## Cambios comprobados

1. **Service Workers bloqueados.** El contexto de navegador incluye serviceWorkers:block antes de instalar las rutas de simulación. Mantiene las solicitudes a Supabase cumplidas con datos ficticios, las imágenes externas simuladas y los demás terceros abortados. Ninguna conexión a staging se usó para esta auditoría.
2. **Peticiones y DOM separados.** pedidas se construye únicamente con las solicitudes de imagen interceptadas; ahora también se registran las locales. srcsEnDom queda separado y tiene su propia aserción. Las variantes g/m antiguas se verifican como peticiones efectivamente interceptadas hacia /medios, además de su coherencia en el DOM. El control negativo ahora falla también en esa nueva aserción, coherentemente con la versión anterior a ML-03.
3. **Cierre en finally.** Se cierra el navegador inicializado, se cierran las conexiones HTTP locales y se espera el cierre del servidor. Los fallos del navegador anteriores al camino sano dejan de mantener abierto el servidor.

Fuente revisada: [verificar-ml03-bundle.cjs](C:/WedJaiseReact/scripts/verificar-ml03-bundle.cjs).

## Repetición independiente

Se ejecutó una copia externa de la herramienta, con el único cambio de resolución de require para cargar el Playwright instalado desde el repositorio. Para probar finally se inyectaron tres errores solo en esa copia; no se alteró el archivo del proyecto.

| Escenario | Resultado | Código | Cierre |
| --- | --- | --- | --- |
| Paquete v3 de 6929c619 | 8/8, sin fallos | 0 | Camino sano completado |
| Control ec2a3b6 | Fallan g antigua, m antigua y coherencia DOM; el resto pasa | 1 | Camino sano completado |
| Error simulado de lanzamiento | Detectado | 2 | Servidor cerrado, navegador no conectado |
| Error simulado de navegación | Detectado | 2 | Servidor cerrado, navegador desconectado |
| Error simulado de interacción | Detectado | 2 | Servidor cerrado, navegador desconectado |

Los cinco escenarios terminaron normalmente dentro del timeout del harness (15 s), sin matar procesos por timeout. Los dos recorridos de navegador duran aproximadamente 2,3 s cada uno; los errores simulados terminan en menos de un segundo. Son duraciones locales de la prueba, no métricas de CPU, cuota o latencia de Cloudflare.

La evidencia original v3b se auditó y se conserva con hashes. El script fue comprobado con node --check y oxlint, sin diagnósticos. No se repitieron las seis pruebas del paquete porque el paquete no cambió: el manifiesto v3 mantiene el hash de la revisión anterior, y el frontend se ejercitó nuevamente en los ocho casos.

## Identidad y límites

HEAD leído: 6929c619e88a91434cb16ee6a8d2de90de94c091. main local: 0dc629e430ed07eeaccec273d31de93e9717d9bf. No hay modificaciones de archivos versionados. El verificador continúa como archivo nuevo sin commit.

Estos resultados son de Chromium con imágenes y red externa simuladas. No acreditan entrega real por Pages, un rollback desplegado, la cuota o CPU de B, cierre de r2.dev, Safari/Firefox/móvil, calidad de imágenes o carga. Los errores simulados prueban que el finally funciona al lanzar excepciones en tres etapas; no cubren todos los modos posibles de fallo del proceso o sistema operativo.

La aprobación de la corrida de interfaz 147b24 y la del paquete v3 permanecen vigentes en sus respectivos alcances. La Fase 3 completa no está aprobada para producción.

## Siguiente frente recomendado

**Primero el ensayo de carga**, porque no necesita escribir filas de base de datos. El alcance preparado y revisado localmente es:

- Alias de Preview y marca exacta 6929c619, entrega Pages con B; preflight antes del login.
- Dos grupos ficticios propios de fotos-galeria, cuatro PUT en total.
- Concurrencias 1, 5 y 10, tres muestras por nivel; tope de 450 lecturas de carga y 10 simultáneas. El flujo sano del núcleo hace 302 lecturas.
- Paradas y veredictos ya revisados; no aumentar carga o reintentos por cuenta propia.
- Borrado selectivo y control de retirada por POP conforme a contrato B; limpieza solo de UUID propios y comprobación de inventario inicial/final.
- Evidencia nueva en .codex; sin commit/push o producción como parte de ese permiso.

Esto es una recomendación de orden y alcance, no una autorización. Claude debe recibir la autorización humana explícita de ese ensayo antes de escribir en staging. El del recolector conserva su autorización separada, porque además crea y borra una fila ficticia para proteger un grupo. No ejecutar el recolector habitual ni programarlo con el permiso del harness.

No hacer un push exclusivo para archivar este informe. Informe nuevo: .codex/REVISION-VERIFICADOR-ML03-BUNDLE-V2.md. Evidencia independiente: .codex/evidencia-revision-verificador-ml03-v2. Se conservan intactas las revisiones y evidencias anteriores.
