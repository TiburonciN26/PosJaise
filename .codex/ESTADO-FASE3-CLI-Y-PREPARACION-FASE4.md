# Estado de Fase 3, revisión del CLI y preparación de Fase 4

Fecha local: 2026-10-10 23:33:26 (America/Lima). Revisión de solo lectura. No se modificaron archivos de implementación, datos, configuración o Git.

## Respuesta al estado del trabajo

Sí: estas últimas rondas han sido mayormente de Fase 3. La fase inicial de nuevas imágenes en R2 se amplió con la decisión de servirlas por Pages sin comprar dominio y con el requisito de bloquear nuevas entregas del enlace antiguo después de borrar.

La configuración tiene funciones concretas:

| Parte | Función |
| --- | --- |
| Cloudflare Pages | Hospeda HTML, JS y CSS del frontend de prueba |
| Supabase | Conserva cuentas, roles, datos, RLS, RPC y metadatos del negocio |
| R2 | Guarda las variantes de fotos públicas incluidas en el alcance |
| Worker de medios | Autoriza subidas/borrados con sesión y rol; valida archivo y decide claves |
| Pages Function /medios | Entrega desde el hostname de Pages, utiliza caché y comprueba R2 con B para impedir nuevas entregas después del borrado |

La mayor duración tuvo dos causas adicionales a esa arquitectura: hubo fallos reales de reintentos/limpieza que podían borrar fotos referenciadas o informar éxito incorrecto, y se mezclaron en el seguimiento el funcionamiento de pruebas con la aprobación final de producción. También quedaron textos históricos que vuelven a listar como pendientes cosas ya realizadas.

R2 y esta configuración sirven para tener un flujo de imágenes verificable antes de la carga masiva. No sustituyen la optimización de React, búsquedas o número de tarjetas. Los videos siguen en la política/contrato de Fase 8; no se certificaron aquí.

## Estado vigente de los hitos de medios

| Hito | Estado y revisión vigente |
| --- | --- |
| Worker y bucket aislados, roles, archivos e idempotencia | Verificaciones de R2 real y aceptación local previas conservadas |
| Lectura /medios por Pages, cabeceras, caché y PWA | Aceptaciones de staging y rondas PWA previas conservadas |
| Interfaz del build 6929c619 | Aceptada 23/23; 18 controles independientes. REVISION-INTERFAZ-6929C61-147B24.md |
| Carga y retirada B | Aceptada 20/20 en alcance acotado, MIA; 29 controles independientes. REVISION-CARGA-6929C61-59D8CB.md |
| Harness del recolector | Aceptado 13/13 para sus UUID ficticios; 38 controles independientes. REVISION-RECOLECTOR-6929C61-73159D.md |
| Paquete mixto v3 y ML-03 compilado | Candidato local de rollback aceptado; las precisiones del verificador ya cerradas. REVISION-PAQUETE-MIXTO-V3-Y-ML03-BUNDLE.md y REVISION-VERIFICADOR-ML03-BUNDLE-V2.md |
| CPU y cuota del panel | Lectura realizada. Consumo bajo observado; reserva de escala/unidades de CPU de Pages sigue pendiente. LECTURA-CPU-CUOTA-B-Y-ALCANCE-CLI.md |
| Código de salida del CLI habitual | Corrección local aceptada en esta revisión, 23/23. Aún sin commit |

Los informes anteriores mantienen su alcance y atribución; no se declara una ejecución distinta ni una ampliación de sus permisos. No hacen falta nuevas corridas de interfaz/carga/recolector para volver a archivar lo ya aprobado, salvo cambios relevantes o defectos nuevos.

**El hito técnico de medios en staging está verificado en los alcances anteriores. La Fase 3 completa y producción siguen sin aprobación.** No se está pidiendo rehacer la infraestructura para continuar con preparación local.

## Corrección nueva del CLI detectada en el árbol

El texto que el usuario pegó decía que Claude aún no había modificado el CLI; al inspeccionar el estado real, ya están presentes:

- [codigoSalida](C:/WedJaiseReact/scripts/lib/huerfanos-medios.mjs:179): errores de borrado o aborto generan código 1; informes sanos y omisiones seguras por referencia tardía generan 0.
- [CLI](C:/WedJaiseReact/scripts/medios-huerfanos.mjs:132): imprime/guarda el informe, incluidos parciales, y termina con codigoSalida(informe). Se conserva la terminación explícita por el temporizador de sesión del SDK.
- [Suite nueva](C:/WedJaiseReact/scripts/verificar-cli-huerfanos.mjs): decisión pura, recolectar real con dobles y CLI real en procesos hijos con fetch simulado.

**Veredicto: corrección del código de salida ACEPTADA LOCALMENTE.** Codex repitió 23/23 casos desde una copia externa del test, con importaciones ajustadas para usar las fuentes reales del proyecto y temporales conservados fuera del repositorio. El test no recibió --env-file ni credenciales reales: los procesos hijos usaron URL/clave/cuentas ficticias y una precarga que simula todas sus solicitudes. No se ejecutó aplicar contra un servidor real ni se eliminó ningún objeto real.

Control negativo: se extrajo por git show el CLI de HEAD anterior a la corrección a un archivo externo, con sus imports ajustados, y se repitieron solo los nueve casos de CLI. Fallan exactamente los tres relativos a error de borrado, aborto parcial y aborto desde el primer candidato, porque la versión antigua devolvía 0. Los seis restantes pasan. Esto acredita que las pruebas detectan el defecto corregido y no solo el helper.

oxlint y node --check de lo revisado pasan sin diagnósticos. No se cambió retención, algoritmo de selección, eliminación, permisos, esquema, backend o cron. La aprobación del código de salida no autoriza automatizar o ejecutar el recolector habitual: permanecen sus condiciones operativas y ventana consulta→DELETE.

Cambios presentes de Claude: dos archivos versionados modificados y una suite nueva sin commit. HEAD sigue en 6929c619 y main en 0dc629e.

## Textos que necesitan sincronizarse, sin otra ronda de infraestructura

La fila 3 del registro de FASES-RENDIMIENTO-CLOUDFLARE.md conserva información histórica: cita r2.dev sin caché, falta de variables, PWA pendiente, fila residual local, sin commit/push, etc. No describe el estado actual, que usa Pages Functions, variables de Preview, nuevas marcas, B activa y las corridas ya aceptadas. El requisito de comprar dominio propio también fue sustituido por la alternativa Pages Functions elegida por el usuario; el dominio propio sigue siendo opcional/futuro.

Claude debería actualizar únicamente el resumen vigente con enlaces a estos veredictos, marcando lo anterior como histórico. Codex no modifica ese documento existente por su rol de solo lectura. No es necesario un push exclusivo para este ajuste documental ni repetir los ensayos por él.

## Pendientes reales, sin convertirlos en trabajo ya aprobado

Antes de dar la Fase 3 por completamente apta para el negocio permanecen:

- Corroborar la escala de CPU de Pages y evaluar B con condiciones representativas; el Worker de subidas es otra métrica.
- Cubrir el requisito de retirada en los accesos alternativos r2.dev y deployments antiguos. El enlace actual con B no modifica automáticamente las otras entregas.
- Fotos reales y la cobertura de Firefox/Safari/móvil pendiente, o decisiones explícitas de alcance cuando no haya dispositivo/muestra. No comprar un dominio o dispositivo como condición inventada.
- Operación del recolector habitual, con condiciones que mitiguen referencias concurrentes; no activar cron por haber cerrado su exit code.
- Rollback/despliegue operativo y compatibilidad del negocio, junto con las preparaciones de Fases 9–10 antes del cambio público.

El registro actual debe distinguir preparación local/staging de habilitación para datos reales. Esta nota no mueve silenciosamente los criterios de V5 ni declara cumplidos esos pendientes. Propone continuar con preparación de Fase 4 en local mientras se mantienen los límites de negocio; la implementación de la fase siguiente necesita la indicación del usuario conforme al plan.

## Preparación de Fase 4: objetivo concreto de rendimiento

Se revisaron fuentes actuales, sin modificar ni medir una nueva traza:

1. [ProductosCliente](C:/WedJaiseReact/src/pages/cliente/ProductosCliente.jsx:92) consulta productos activos sin range/limit de paginación. Sus categorías, cantidades y búsqueda se calculan desde el conjunto descargado. [El render filtrado](C:/WedJaiseReact/src/pages/cliente/ProductosCliente.jsx:555) monta toda listaFiltrada. La auditoría original observó 1000 recibidos de 3245 accesibles; esa cifra es histórica de Supabase Local, no una medición nueva de producción.
2. [ServiciosCliente](C:/WedJaiseReact/src/pages/cliente/ServiciosCliente.jsx:84) llama a leerServicios para descargar el catálogo completo. [leerServicios](C:/WedJaiseReact/src/lib/buscarServicios.js:73) usa leerPaginado para devolver todo. La búsqueda filtra en React y [el render](C:/WedJaiseReact/src/pages/cliente/ServiciosCliente.jsx:562) monta todos los resultados. Leer por bloques evita truncamiento, pero no acota el estado ni el DOM final.
3. CatalogoWeb/Inventario/Servicios administrativos ya utilizan range y tamaños de 50. No confundir esos listados con los dos catálogos públicos ni reescribir indiscriminadamente un helper compartido de lectura completa.

La preparación para Claude debe centrarse en búsquedas/filtros/orden del servidor, páginas o ventana de hasta 40 tarjetas, orden estable e información global de categorías/contadores independiente de una página. Separar hero/ofertas/destacados del listado paginado y cargar imágenes solo de la ventana visible y su margen. Mantener reglas de stock, precios, carrito, detalles, apariencia y reduced-motion.

Pruebas futuras relevantes: resultados más allá del límite histórico de 1000, páginas sin duplicados, filtros rápidos con respuestas fuera de orden, fotos/detalles/carrito y solicitudes de red acotadas. Usar Local verificado o staging autorizado; no activar imágenes del negocio ni publicar como parte de esta preparación.

R2 puede entregar los archivos adecuadamente, pero no evita por sí solo el trabajo de montar miles de tarjetas. Fase 4 es la siguiente optimización del cliente y de consultas prevista por el plan, y sus nuevos cambios deben revisarse contra su propia línea base.

## Regla práctica para las siguientes entregas

Revisar lo que cambia: código de CLI con sus regresiones; código de catálogo con sus interacciones; Function con su contrato HTTP. La actualización de documentación o registro de aprobaciones no exige una nueva prueba completa de todas las fases ni un despliegue por cada nota. La revisión futura de una entrega con los mismos hashes conserva este veredicto; se amplía testing solo por cambios relevantes, fallos o dudas nuevas.

No se creó un objetivo nuevo, no se inició implementación de Fase 4 y no se cambiaron main, GitHub Pages, Cloudflare, Supabase ni datos del negocio. Informe nuevo: .codex/ESTADO-FASE3-CLI-Y-PREPARACION-FASE4.md; evidencia: .codex/evidencia-cierre-fase3-cli.
