# Pages Functions: revisión del diseño v2

Fecha: 10 de octubre de 2026, America/Lima. Codex: revisión de solo lectura.

## Veredicto

**Diseño aprobado técnicamente para pasar a implementación local, con las precisiones de abajo.** No se requiere otra entrega exclusivamente documental. Esta aprobación no autoriza a Codex a implementar ni constituye permiso del usuario para commit, push, configuración de Cloudflare o publicación. Claude implementa cuando el usuario lo autorice; Codex revisa el paquete resultante.

PF-01 a PF-04 quedan atendidos en el diseño. Los defectos del código actual y el funcionamiento de la Function no se dan por corregidos: todavía no hay implementación ni pruebas nuevas que lo demuestren. El siguiente control es sobre código y evidencia, no sobre otra reformulación del documento.

## Comprobación contra la revisión anterior

| Punto | Resultado de la v2 |
| --- | --- |
| PF-01: Galería antigua se desvía a Storage | Lista cerrada de bases, validación exacta de origen/prefijo/destino/UUID/variante y regresiones del reconocimiento y borrado. Resuelto en el diseño. |
| PF-02: rollback rompe URLs absolutas | Prohíbe retirar Function/binding con filas vivas que usen Pages; exige restauración acotada de URLs ficticias y ensayo de lectura/gestión. Resuelto en el diseño. |
| PF-03: TTL de 404 no limita un 200 cacheado | Separa navegador, edge y errores, reconoce retención de positivos y adapta la prueba de borrado. No promete purga global de pages.dev. Resuelto en el diseño. |
| PF-04: HTTP y caché | Clave GET canónica, HEAD sin contaminar GET, Range ignorado, httpEtag/304 en HIT y MISS, diagnóstico con conteo R2 y fallos diferenciados. Contrato suficiente para implementarlo y probarlo. |

También recoge salida de `_routes.json` en dist, aislamiento del SW, cabeceras de la propia Function, configuración exclusiva de Preview y cuota compartida. Comprar dominio permanece como decisión futura, sin impedir esta implementación.

## Precisiones que Claude debe incorporar al implementar

1. **Atender `/medios` sin barra, además de `/medios/*`.** El documento promete 404 para ambos, pero su `_routes.json` incluye solo `/medios/*`. No asumir que ese patrón cubre la ruta sin barra ni que el catch-all procesa una ruta sin segmentos. Añadir la ruta exacta al control de invocación y asegurar un handler para la raíz, o definir otra solución equivalente que cumpla el 404. La exclusión de navegación del SW debe cubrir `^/medios(?:/|$)`, sin excluir por accidente rutas como `/medios-extra`. Probar esas rutas con GET/HEAD y navegación controlada por el SW. Sin esa cobertura puede intervenir el fallback SPA. La documentación distingue las rutas de invocación del enrutamiento por archivos y su fallback estático. [Routing Pages Functions](https://developers.cloudflare.com/pages/functions/routing/).

2. **TTL concreto y sobrescritura de metadatos.** Fijar el valor de staging, por ejemplo 300 segundos, en vez de dejarlo como ejemplo. La Function debe reemplazar el Cache-Control de un año que traen los objetos R2 por la política corta, tanto en la respuesta enviada como en la copia almacenada en Cache API. Para probar expiración en local usar reloj/caché simulados; no es necesario esperar cinco minutos por caso. Registrar aparte lo observado en el entorno real.

3. **Rechazos del reconocedor no deben entrar al fallback de Storage.** La lista cerrada resuelve las dos bases aprobadas, pero las regresiones deben comprobar el resultado final de `rutaDeUrlGaleria`, no solo el `null` de `referenciaDeUrlR2`, para hosts engañosos con `/fotos-galeria/` en la ruta. Una URL ajena no debe producir una eliminación en ninguno de los dos proveedores. Conservar el reconocimiento de las fotos legítimas de Supabase.

4. **Distinguir lectura de reconocimiento.** `resolverUrlGaleria` hoy devuelve directamente una URL HTTP(S); no depende de `referenciaDeUrlR2`, aunque §7 los relaciona. Mantener explícitas las dos garantías: reconocer para administrar/borrar y mantener disponible la URL para leer. Esa distinción es la que sostiene el rollback acordado.

Estas precisiones pueden quedar directamente en el código y sus pruebas; no piden otra revisión documental previa.

## Paquete esperado para la próxima revisión

Function y enrutamiento generado, cambios de cliente acotados, exclusión del SW, pruebas de HTTP/caché/rutas y reconocimiento de ambas bases, ensayo de rollback ficticio y build reproducible. Debe conservar subidas/borrados protegidos del Worker, fotos antiguas de Storage y separación entre staging y negocio.

Primero se revisa y prueba localmente con dobles/R2 simulado. Después de aceptar el paquete se evalúa el binding y la variable de Preview con la autorización humana correspondiente. No cambiar la variable ahora, porque no existe aún la ruta implementada. Las pruebas con escrituras en staging o R2 real requieren la autorización aplicable a ese recorrido.

## Alcance de esta revisión

Leí el documento v2 completo y lo comparé con el informe v1. Confirmé que no existe `functions/` y que el build/PWA actuales aún no contienen los controles propuestos. Consulté las reglas oficiales de routing. No ejecuté suites nuevas: no hay implementación para ellas. No repetí las pruebas históricas de la aplicación.

No hubo cambios de código, variables, bindings, datos, dependencias o Git. Solo se crea este nuevo informe en `.codex`, según la instrucción persistente del usuario. Fase 3 completa y producción siguen pendientes de sus criterios; esta aprobación se limita al diseño para implementación local.
