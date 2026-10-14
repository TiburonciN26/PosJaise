# Revisión independiente de la preparación de Fase 2B

Fecha: 9 de octubre de 2026. Proyecto: C:/WedJaiseReact.

**Veredicto: REQUIERE CORRECCIONES antes de ejecutar la integración Git.** El objetivo del plan es correcto: Cloudflare Pages conectado al repositorio privado y el Supabase actual del negocio. La nueva validación de claves permite valores que deberían abortar; el verificador de actualización todavía no sirve para el recorrido online entre commits descrito en el plan.

Las aprobaciones anteriores se mantienen: Fase 1 aprobada; Fase 2 aprobada con observaciones para el artefacto de staging publicado. No se detectó aquí una filtración en ese artefacto. Esta revisión identifica fallos en las salvaguardas que se usarían para publicaciones futuras.

Codex no modificó archivos del proyecto, instaló dependencias, hizo commits/push, publicó deployments, cambió datos/configuración remota ni utilizó claves reales en las pruebas de salvaguardas. Los diagnósticos y este informe están fuera del repositorio.

## Qué quedó comprobado

| Comprobación independiente | Resultado |
| --- | --- |
| Los tres parches: git apply -R --check | Pasan con código de salida 0; ningún parche aplicado |
| dist-preview frente a dist-preview-a, SHA-256 de todos los archivos | 178 archivos en cada uno, cero diferencias |
| dist-preview-a frente a dist-preview-b | Solo cambian index.html y sw.js; B contiene fase2b-ensayo-b |
| Sintaxis de scripts de build, verificador PWA y vite.config.js | Comprobada con node --check |
| Guardas del build Git, 19 escenarios ficticios | 10 cumplen la expectativa; 9 aceptan entradas que deben rechazarse |
| Guarda del build de preview manual | Rechaza JWT service_role, pero acepta sb_secret_ |
| README y registro de fases | Estado vigente al principio y veredictos anteriores registrados |
| HEAD y origin/main almacenado localmente | 0dc629e430ed07eeaccec273d31de93e9717d9bf |
| Git status en esta revisión | 157 entradas; no equivale a 157 archivos individuales por carpetas agrupadas |
| Actualización PWA local | Evidencia de Claude revisada; no se volvió a ejecutar en este turno |
| Actualización PWA online entre dos versiones | Sigue pendiente |

Se intentó consultar GitHub con git ls-remote, pero falló por resolución/red del entorno (getaddrinfo() thread failed to start). Por ello origin/main es una referencia local, no una comprobación actual del servidor. Claude debe refrescar/consultar el remoto antes de preparar el commit definitivo.

No se volvió a compilar en este turno ni se repitió la comparación byte a byte del build GitHub: la nueva afirmación de paridad corresponde a la entrega de Claude. Las pruebas de guardas se ejecutaron leyendo los fragmentos literales, en VM dentro de procesos Node separados con process.exit real. No ejecutaron Vite ni llamadas a Supabase. Los JWT tienen firma ficticia: se prueba la clasificación de la entrada, no la autenticidad de credenciales.

## B1 · Claves privilegiadas aceptadas por el build — bloqueo

**Severidad:** alta, P1. **Prioridad:** corregir antes del primer build Git.

**Descripción:** scripts/build-cloudflare.mjs:27 solo busca /service_role/i en la cadena completa. Un JWT codifica role en base64url: el texto literal no aparece en la clave. La prueba jwt_service_role alcanzó el final de las guardas sin abortar. También pasan sb_secret_, un JWT authenticated, un JWT roto y la cadena x.

scripts/build-preview-staging.mjs:43–47 sí decodifica JWT y rechaza service_role, pero trata cualquier error de parseo como si fuera una clave publishable. Una sb_secret_ ficticia de más de 40 caracteres pasa.

**Por qué importa y consecuencias:** src/lib/supabase.js:9 consume VITE_SUPABASE_ANON_KEY, que se incorpora al frontend al compilar. Si alguien coloca por error una clave privilegiada, estas guardas permitirían enviarla al bundle. Supabase distingue publishable/anon para clientes y secret/service_role para componentes de servidor; las privilegiadas pueden omitir RLS. Las sb_secret_ tienen protección contra uso directo desde navegador, pero publicarlas sigue siendo una exposición porque pueden extraerse y usarse fuera de él. [Documentación oficial de claves](https://supabase.com/docs/guides/getting-started/api-keys).

**Corrección para Claude:**

- Aplicar la misma clasificación explícita a ambos scripts.
- Rechazar sb_secret_ antes de cualquier parseo.
- Aceptar únicamente una publishable con formato válido o un JWT legacy correctamente estructurado con role exactamente anon.
- Un error de parseo de JWT debe abortar; no convertir automáticamente una cadena desconocida en publishable.
- Rechazar roles ausentes, authenticated, service_role, tipos desconocidos, cadenas vacías y valores rotos.
- Cuando el JWT incluya ref, comprobar que coincide con el proyecto elegido. Esto detecta errores de configuración; decodificar no valida criptográficamente una firma.
- No imprimir claves en mensajes o resultados. Verificar el artefacto final para impedir secretos privilegiados en la salida, antes de subirlo.

**Aceptación:** ejecutar casos anon y publishable permitidos; service_role JWT, sb_secret_, authenticated, JWT roto, cadena arbitraria y ref discordante rechazados ANTES de iniciar Vite. Repetir en ambos entrypoints. No hace falta usar secretos reales.

## B2 · Separación de backend y rama incompleta

**Severidad:** media, P2. **Prioridad:** corregir junto con B1 antes de desplegar.

**Descripción:** scripts/build-cloudflare.mjs:21–26 rechaza dos combinaciones específicas, pero no exige el backend aprobado para cada entorno. Preview acepta cualquier otro proyecto Supabase; producción acepta cualquier otro proyecto que no sea el staging conocido. CF_PAGES_BRANCH vacío se interpreta como preview. Los escenarios de host desconocido y rama ausente pasan.

**Consecuencias:** una variable errónea puede producir una web que opera con un backend no revisado o falla al iniciar sesión. La guarda no garantiza la correspondencia declarada en el plan.

**Corrección:** parsear la URL y exigir igualdad exacta del hostname/ref esperado: preview→staging aprobado y producción→negocio aprobado. Validar refs y rama no vacíos, mantenerlos distintos y comprobar claves legacy con ref consistente. Si se permiten otros entornos, deben configurarse explícitamente y revisarse; no permitirlos por descarte.

El plan FASE-2B-PAGES-GIT.md:27 dice elegir main como producción solo al cambiar públicamente, pero el script presupone main desde ahora. Debe fijar la rama de producción desde la creación y documentar cómo se evita su publicación anticipada, manteniendo RAMA_PRODUCCION sincronizada con Pages. No colocar una rama QA como producción con staging mientras la guarda la considera preview. Cloudflare informa la rama del deployment y permite configurar producción y sus despliegues automáticos; la guarda no puede adivinar esa configuración. [Variables de Pages](https://developers.cloudflare.com/pages/configuration/build-configuration/), [controles de ramas](https://developers.cloudflare.com/pages/configuration/branch-build-controls/).

**Aceptación:** probar preview correcto, producción correcta, cruces, tercer host, refs vacías/iguales, rama ausente y rama de producción configurada distinta de main; comprobar los valores efectivos en Pages antes del primer build.

## B3 · El verificador PWA no cubre aún el recorrido Git online

**Severidad:** media, P2. **Prioridad:** preparar antes de cerrar O1.

**Descripción:** scripts/verificar-actualizacion-pwa.cjs recibe carpetas A/B y un puerto; copia archivos a una carpeta temporal y sirve http://127.0.0.1. No acepta una URL pública ni espera una publicación real.

Además, las líneas 39 y 46 exigen que A no tenga build-id. En Git, A ya tendrá la marca del commit. La línea 53 solo comprueba que B tenga alguna marca; no que sea exactamente el commit B esperado. Por tanto no se puede repetir el script tal cual entre dos commits online como dice el plan.

**Corrección:** preparar un recorrido online específico con origen, identificador A e identificador B esperados. Abrir A y verificar su controlador; publicar B en el mismo origen manteniendo la pestaña abierta; verificar aviso, igualdad exacta con A mientras espera e igualdad exacta con B tras aceptar. Comprobar tráfico solo a staging, errores HTTP, requestfailed, pageerror y sesión con una lectura protegida o identidad autenticada, no solo la existencia de una clave auth-token.

**Aceptación:** evidencia del deployment/commit N y N+1 distintos bajo el mismo alias, marcas exactas y un resultado fallido si se observa una versión inesperada. Los endpoints inmutables con orígenes distintos no sustituyen esta prueba.

O1 sigue abierta. No se publicó B ni se alteró el preview en esta revisión.

## B4 · “Borrador conservado” solo prueba una clave artificial

**Severidad:** media, P2. **Prioridad:** corregir la evidencia antes del cambio del hosting del negocio.

**Descripción:** el ensayo guarda qa-borrador-pwa=conservar-esto en localStorage y comprueba que esa clave permanece. No crea un borrador operativo en la UI ni verifica el carrito del POS.

CarritoContext.jsx:6–20 mantiene carrito, cliente, pago y descuento mediante useState, sin persistencia en ese proveedor. AvisoActualizacionPWA.jsx:22 llama updateServiceWorker(true), que solicita actualizar y recargar. Esa evidencia no demuestra que el estado operativo en memoria sobreviva. No se ejecutó aquí una prueba de pérdida de carrito y no se atribuye este comportamiento a un cambio nuevo de Fase 2B.

**Corrección:** describir el resultado local como “clave ficticia de localStorage conservada”. En la validación funcional comprobar un borrador/carrito real, sin confirmar venta ni enviar un pago. Si hay operaciones en memoria que se reinician al recargar, documentar y gestionar la actualización para que el usuario no pierda trabajo inadvertidamente; no declarar conservación general a partir de esta clave.

Distinguir el carrito POS en memoria, datos locales por origen y el carrito de cliente que se consulta en Supabase. Cambiar el origen no borra por sí mismo datos del backend.

## B5 · El alcance del commit debe ser revisable antes de aprobarlo

**Severidad:** media, P2. **Prioridad:** antes de commit/push por Claude.

Es razonable preparar una rama que compile completa, pero las aprobaciones de Fases 1 y 2 no aprueban automáticamente las 157 entradas actuales. El árbol incluye cambios en muchos flujos, configuración Supabase, funciones y migraciones fuera del hosting.

Claude debe presentar una lista concreta de archivos/cambios propuestos, dependencias necesarias y exclusiones. Revisar secretos y datos en documentos/scripts/evidencias, no únicamente .env. .gitignore no protege archivos ya rastreados ni autoriza subir todo el árbol. Esta revisión solo comprobó que .env.example es el único .env* rastreado; no es una auditoría de secretos de todo el commit.

Recomendación: rama de preparación separada de main, snapshot revisado y reproducible en clon limpio, con diff claro y lockfile coherente. No exigir un commit parcial que quede roto, ni asumir que la solución es git add . de todo. La elección final se hace sobre ese listado, no sobre una aprobación genérica.

El workflow de GitHub Pages existente despliega al hacer push a main. Por tanto subir el nuevo código a main puede actualizar la web actual aunque todavía no se haya cambiado el dominio a Cloudflare. Ese efecto debe figurar en el plan.

No se ejecutó npm ci ni se instalaron dependencias: el clon limpio y sus pruebas pertenecen a la implementación de Claude.

## Observaciones anteriores y documentación

- O3: los parches son aplicables al árbol actual sin modificarlo y limitan los cambios a las fases indicadas. Esto acredita aplicabilidad; al revertir, Claude debe revisar el diff y conservar las copias de evidencia. Sigue sin existir un commit exclusivo de las fases.
- O4: README vigente primero y registro actualizado, comprobados. Debe distinguir cifras de Claude (94–98,7 %) de la medición independiente de Codex (91,3–96,5 %); ambas superan el mínimo del 80 %.
- El informe de Fase 1 sí existe fuera del repositorio, por el rol de solo lectura de Codex: [VERIFICACION-FASE-1.md](C:/Users/jdeos/.codex/visualizations/2026/10/09/01a11ea8-be2a-7611-8e67-4ded5cca3f25/fase1-verificacion/VERIFICACION-FASE-1.md). Claude puede enlazarlo o copiarlo al proyecto si corresponde a su entrega; Codex no lo ha copiado allí.
- O2 caché HTML sigue sin bloquear el preview ya aprobado. Pagos, correos reales, CSP, hardware móvil y comparación con GitHub Pages siguen siendo límites declarados, no resultados aprobados.
- No crear otro Supabase para el negocio: conservar el actual. El staging existente sirve para QA y no obliga a migrar datos.
- pos-jaise sigue siendo una propuesta de nombre; no se verificó disponibilidad ni se creó el proyecto. R2 continúa fuera de esta etapa.

## Entrega para Claude

> Revisión Codex: la preparación 2B requiere correcciones, sin cambiar los veredictos de Fases 1 y 2. Corrige primero la clasificación de claves en build-cloudflare y build-preview-staging: sb_secret_ y JWT service_role deben abortar antes de Vite, y formatos desconocidos no deben pasar. Exige backend aprobado por entorno y rama de producción consistente con Pages. Prepara un verificador online con IDs exactos A/B y separa la prueba de una clave localStorage de la conservación de borradores operativos. Entrega un listado revisable del commit completo y sus exclusiones antes de pedir aprobación de Git. Usa la ruta externa del informe de Fase 1 y diferencia tus mediciones de las de Codex. No hagas commit/push, conectes GitHub, publiques B, cambies producción ni inicies R2 como parte de estas correcciones. Entrega pruebas ficticias, diff y plan actualizado para nueva revisión.

## Evidencia adjunta

- salvaguardas.json: resultados de 19 escenarios del build Git y cuatro del build manual.
- probar-salvaguardas.cjs: reproducción externa; solo lectura de scripts y ejecución aislada de guardas.
- artefactos-a-b.json: comparación de todos los archivos.
- comparar-artefactos.cjs: reproducción de los hashes.

Este informe documenta correcciones para Claude. No autoriza acciones externas ni sustituye la aprobación concreta del usuario para publicar el hosting definitivo.
