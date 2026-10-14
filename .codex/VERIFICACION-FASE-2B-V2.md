# Segunda revisión de la preparación de Fase 2B

Fecha: 9 de octubre de 2026. Proyecto: C:/WedJaiseReact.

**Veredicto: B1 y B2 APROBADAS. La preparación B3–B5 avanzó, pero la Fase 2B sigue pendiente de ejecución y aceptación.** Las correcciones permiten preparar el hosting Git con staging; todavía no hay un commit reproducible aprobado, proyecto Git conectado ni prueba PWA online entre dos versiones.

Las aprobaciones anteriores se mantienen: Fase 1 aprobada y Fase 2 aprobada con observaciones para el preview publicado. No se modificaron archivos del proyecto, dependencias, Git, datos ni recursos externos. Se generó esta evidencia fuera del repositorio.

## Comprobaciones ejecutadas por Codex

| Comprobación | Resultado |
| --- | --- |
| Script existente de salvaguardas, salida dirigida fuera del proyecto | 43/43 pasan: 31 build Cloudflare y 12 preview manual |
| Comprobaciones adicionales independientes del módulo compartido | 18/18 pasan |
| JWT service_role y authenticated, sb_secret_, claves rotas/discordantes | Rechazadas por las guardas |
| Host por entorno y rama explícita | Comprobados; cruces y host ajeno rechazados |
| Escáner de salida: secreto, JWT privilegiado y ref ajeno | Detectados en texto ficticio; anon correcto permitido |
| Sintaxis de los cinco módulos/scripts principales | node --check pasa |
| Tres parches de rollback | git apply -R --check pasa; no se aplicaron |
| Artefacto dist-preview frente al publicado | 178 hashes iguales; cero cambios y ausencias |
| Credenciales privilegiadas en los textos de ese artefacto | Cero coincidencias en el escaneo ejecutado |
| Regeneración del listado de commit fuera del repositorio | 188 entradas: 98 modificadas, 89 nuevas, 1 eliminada; 9 exclusiones propuestas |
| Imagen del login | Existe, 121.254 bytes, importada por Login.jsx, ignorada y no rastreada por Git |

Las pruebas de claves usan valores ficticios; no validan firmas ni autenticidad contra Supabase. El script de guardas se ejecutó con --solo-validar: no arrancó Vite ni hizo peticiones remotas. No se instalaron dependencias ni se reprodujo aquí el ensayo de clon limpio o la actualización PWA de Claude.

## B1 y B2: cerradas dentro del alcance revisado

La clasificación compartida elimina los dos fallos anteriores: rechaza sb_secret_ y examina role/ref del JWT. Ambos scripts la usan antes de Vite. La selección exige el host aprobado para preview o producción y rama explícita, sin override de los refs por entorno.

La rama cloudflare-produccion es una estrategia válida para separar el hosting final de previews. Antes de conectar el proyecto deben comprobarse los valores reales en el panel: rama de producción, RAMA_PRODUCCION en ambos entornos, variables y ramas que pueden generar preview. La rama por sí sola no es una barrera de permisos: lo que evita publicar antes es no crear/subir esa rama ni cargar variables del negocio hasta el paso autorizado.

El plan debe aclarar que “Production vacías” se refiere a las variables del backend y pago: RAMA_PRODUCCION debe estar definida allí, como ya exige el propio plan. No dar por hecho que el asistente de creación admitirá una rama inexistente; verificarlo en el momento y ajustar la secuencia sin apuntar un build QA al backend del negocio. Pages permite configurar la rama de producción y sus despliegues automáticos. [Controles de ramas de Cloudflare](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).

## B3: marcas exactas preparadas; dos ajustes antes de usar el verificador online

El nuevo script recibe un origen y marcas exactas A/B. La evidencia local de Claude contiene el recorrido positivo y otro con B esperado erróneo que termina FALLA. Esto corrige la comparación anterior por “marca presente”. La prueba online O1 sigue abierta y no se publicó B en esta revisión.

Todavía hay dos condiciones prácticas en scripts/verificar-actualizacion-pwa-online.cjs:

1. **Restringir el entorno ANTES del login.** hostStaging se obtiene del .env, sin exigir el ref aprobado; las peticiones solo se registran y se comparan al final. El script rellena credenciales en el origen recibido antes de esa comprobación. Validar previamente el Supabase exacto de staging y un origen QA permitido; bloquear tráfico a otro backend antes de enviarlo, no únicamente detectar después. Para el ensayo local, permitir explícitamente el origen local de prueba.
2. **Detenerse antes de la publicación si falla A.** paso(...) solo anota el error. Si A tiene una marca incorrecta, falta controlador o falla la lectura autenticada, el script sigue hasta --publicar-cmd. Debe abortar el recorrido antes de ejecutar ese comando o solicitar la publicación manual. Añadir caso negativo de A incorrecta que compruebe que no se publica ni se continúa con la actualización.

Estos puntos se identificaron leyendo el código; no se ejecutó contra un origen incorrecto ni se envió ninguna credencial. Son condiciones para usar ese verificador, no fallos de las guardas del build ya aprobadas.

Mejoras de precisión, sin abrir un cambio de producto: filtrar usuarios por el id devuelto por /auth/v1/user si se afirma comprobar “su propio usuario”; hoy limit=1 puede ser otra fila accesible al administrador. Limitar la comprobación del producto a la fila del carrito, pues getByText en toda la página puede coincidir con un resultado de búsqueda.

## B4: evidencia corregida; protección operativa pendiente

La evidencia de Claude distingue autenticación, una clave ficticia local y carrito real. Registra antes=true y despues=false para el carrito. Su resultado global OK representa que el recorrido de actualización funcionó, **no que el carrito se conservó**. El código existente es coherente con ese hallazgo: el carrito POS está en useState y Actualizar solicita recargar.

**Recomendación concreta:** mientras exista una venta en curso, impedir la actualización con un mensaje visible para terminarla o cancelarla primero. Considerar también otros estados pendientes que se perderían, no solo una fila en el carrito. Con el POS sin trabajo pendiente, mantener la actualización normal. Es una protección más acotada que añadir persistencia del carrito sin diseñar expiración, roles, stock y restauración.

Claude puede preparar esa corrección; Codex verificará que una actualización pendiente no borre una operación y que siga funcionando al finalizarla. No cambiar cobros, cupones ni stock por esta protección. La confirmación de una venta no es necesaria para comprobar el bloqueo en QA.

Este riesgo no impide preparar un preview con datos ficticios. Debe resolverse o aceptarse explícitamente con una medida concreta antes de ofrecer el nuevo hosting al personal; una instrucción en la documentación no equivale a protección dentro de la app.

## B5: listado disponible; decisiones recomendadas

### Imagen del login

El bloqueo de empaquetado está confirmado: Login.jsx:9 importa foto-login.jpeg y .gitignore:55 excluye src/assets/*; git ls-files no devuelve esa imagen. El build remoto no dispondría de ella. En HEAD no existía ese import.

**Recomiendo versionar únicamente src/assets/login/foto-login.jpeg**, con las excepciones necesarias para que Git descienda a su carpeta. Mantiene la pantalla actual y su import; no hace falta moverla a public ni descartar todos los cambios de Login.jsx. No abrir como excepción todo src/assets ni incluir otros archivos ignorados.

Claude debe mostrar que la imagen aparece en el listado candidato y que el build del snapshot/clon limpio pasa con los archivos que realmente se subirán. No se cambió .gitignore ni se añadió la imagen al índice en esta revisión.

### Rama y alcance del commit

**Recomiendo una rama de preparación feat/cloudflare-pages**, como propone Claude, conservando main mientras se verifica el preview. No hace falta subir primero a main; el workflow actual despliega GitHub Pages cuando se actualiza main.

El listado tiene 188 entradas, no un commit exclusivamente de hosting. Incluye cambios de 110 archivos de la app, seis migraciones y dos Edge Functions. Aprobar la estrategia de rama no aprueba esos cambios funcionales ni su despliegue a producción. Confirmar una migración como archivo tampoco autoriza aplicarla al negocio.

Las nueve exclusiones están identificadas. El escaneo por patrones vuelve a dar dos correos para revisar y cuatro binarios sin inspección; es una comprobación acotada, no garantía de ausencia de todo secreto. Resolver y registrar esos casos, añadir la imagen y regenerar el listado antes de presentar el diff final.

Corrección menor de documentación: el plan dice 88 archivos nuevos, pero el listado actual contiene 89; 98+89+1=188.

## Orden recomendado para continuar

1. Claude incorpora solo la imagen necesaria al empaquetado, corrige el preflight/parada del verificador y prepara la protección de actualización del POS.
2. Entrega diff, listado final con exclusiones y build reproducible desde los archivos candidatos, sin usar archivos ignorados ni secretos locales ocultos.
3. Codex verifica esos cambios. El usuario decide el commit/push de Claude a la rama de preparación y el nombre definitivo del Pages; pos-jaise sigue siendo una propuesta sin verificar.
4. Conectar solo ese repo, comprobar rama/variables y publicar el preview Git con staging. Probar dos versiones distintas bajo el mismo alias.
5. Preparar el hosting del negocio conservando el Supabase actual, después de validar la transición. R2 permanece en su fase; no se crea otro backend.

No se hizo ninguna publicación, conexión GitHub, cambio de producción ni limpieza de recursos.

## Mensaje para Claude

> Codex cerró B1 y B2: repitió 43 casos y agregó 18 comprobaciones, todos pasan; el artefacto publicado sigue idéntico. Antes de ejecutar 2B, prepara el empaquetado versionando solo foto-login.jpeg, sin mover el login ni abrir todo assets. Ajusta el verificador PWA para validar origen/backend QA antes del login, bloquear tráfico ajeno y abortar antes de publicar si falla A. Agrega negativo de A incorrecta sin publicación. Prepara protección de Actualizar cuando haya trabajo POS pendiente y prueba ambos estados. Regenera el listado, corrige 89 nuevos y entrega el diff/build reproducible para QA. La estrategia recomendada es feat/cloudflare-pages; esto aún no autoriza commit/push, conectar GitHub, publicar B, cambiar producción ni iniciar R2.

## Archivos de evidencia de esta revisión

- salvaguardas-43-codex.json
- comprobaciones-adicionales.json
- comprobar-v2.mjs
- artefacto-publicado-comparado.json
- comparar-publicado.cjs
- COMMIT-ACTUAL-CODEX.md

Todos están en esta carpeta externa al proyecto.
