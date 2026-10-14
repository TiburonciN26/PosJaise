# Revisión de Fase 5 · V1

Fecha: 2026-10-11, America/Lima. Proyecto: C:/WedJaiseReact. Base HEAD: `6929c619e88a91434cb16ee6a8d2de90de94c091`, rama `feat/cloudflare-pages`. Revisión del árbol sin commit, entrega `ENTREGA-FASE5-LISTAS-ADMIN.md`.

## Veredicto

**RECHAZADA para el cierre de implementación y QA LOCAL.** La dirección de la optimización es adecuada y las consultas paginadas tienen límites y orden estable, pero hay cinco hallazgos P2 que requieren corrección o, para el cambio deliberado de búsqueda, una decisión explícita del usuario. No avanzar a la Fase 6 ni publicar esta entrega como aprobada.

No se modificó código del proyecto, configuración, dependencias, Git, datos o esquema. No se hizo commit, push, migración ni despliegue. Los únicos archivos nuevos del proyecto son este informe y sus evidencias de QA en `.codex`, conforme a la instrucción persistente del usuario.

| Código | Prioridad | Problema confirmado | Alcance |
| --- | --- | --- | --- |
| F5-01 | P2 | Un fallo de página/búsqueda conserva datos viejos y los etiqueta como resultados nuevos, sin error ni Reintentar | Hook compartido por las listas administrativas |
| F5-02 | P2 | Protección conserva el borrador al plegar, pero lo pierde al cambiar de subpestaña | Servicios y productos |
| F5-03 | P2 | Cambiar la identidad A→B con saldo lento/fallido no inicia los recursos de B | Recompensas de la clienta, pantalla montada |
| F5-04 | P2 | La búsqueda de cupones pierde la equivalencia con y sin tildes existente antes | Referidos y Fidelización |
| F5-05 | P2 | El catálogo público queda cargando bajo el replay de efectos de StrictMode | Desarrollo local, entrada directa a Canjear puntos |

## Método y evidencia

- Lectura de los archivos modificados/nuevos y comparación contra HEAD. Las modificaciones de Fase 4 y del CLI de Fase 3 siguen aparte; esta revisión no las revierte.
- **11 escenarios en Chromium** con componentes reales servidos por Vite en `http://localhost:5173`, BrowserRouter, contextos y Supabase simulados. No son la suite completa de Claude ni un recorrido autenticado de extremo a extremo. El cambio de cuenta es una actualización controlada de identidad del contexto; no un segundo login real. Se bloquearon los service workers y todos los orígenes fuera de Vite. Los once escenarios válidos terminaron sin `pageerror`.
- **9/9 controles con el SDK real de Supabase**: siete usan fetch simulado para verificar consultas, rangos, filtros, orden y conteos. Los otros dos son SELECT anónimos a Supabase Local: ambas vistas deniegan con `42501`, HTTP 401. No se usan claves privilegiadas ni se registra la anon key.
- Inspección SQL **solo SELECT** de metadatos, políticas y conteos. El contenedor Kong del proyecto se verificó en el puerto `127.0.0.1:54321`; no se usó la pila JaiseEnsayo. Vistas presentes con `security_invoker=true`, SELECT denegado a anon y concedido a authenticated. Conteos observados: 429 pedidos, 208 promociones, 218 reseñas en la vista, 3067 cupones en la vista. No quedaban clientes/promociones/cupones/reseñas con los prefijos de siembra QA F5 examinados; esto no demuestra una igualdad de toda la base.
- Lint acotado a 19 archivos de aplicación de Fase 5: exit 0, dos advertencias `react/only-export-components` en AuthContext y EstadoNegocioContext, sin errores. No se ejecutó el lint global ni un build que sobrescribiera `dist`.
- Se auditaron las mediciones de Claude: 20 escenarios, tres muestras por escenario, y el JSON de su suite registra 24/24 y `falloGlobal:null`. Las mejoras de bytes/DOM siguen siendo **medidas de Claude**, no una repetición independiente de rendimiento por Codex. No son INP ni LCP de campo.
- No se ejecutó `scripts/verificar-fase5.cjs`: su preparación/limpieza escribe mediante SQL y cambia `session_replication_role`. Eso queda fuera del rol de Codex; por ello se usaron fixtures en navegador y SELECTs.

Evidencia nueva: `C:/WedJaiseReact/.codex/evidencia-revision-fase5-v1/`. Contiene `diagnosticos.json` (7 escenarios), `diagnosticos-adicionales.json` (4), `sdk-listas.json`, `base-solo-lectura.json`, `auditoria-evidencias.json` y copias de los diagnósticos como `.txt`. Los hashes de los archivos revisados se incluyen en `auditoria-evidencias.json`.

## F5-01 · La lista fallida se presenta como una página o filtro que no se cargó

**Archivo:** `src/hooks/useListaPaginada.js:39–43` (en particular `error: !yaCargo.current`); consumidores Pedidos, Promociones, Reseñas, cupones y Protección.

**Reproducción:**

1. La lista de Promociones carga correctamente 81 resultados; página 1 muestra los primeros 40.
2. La petición de la página 2 devuelve un error simulado `{error:...}` equivalente al error entregado por el SDK ante un 5xx.
3. La interfaz dice **«Página 2 de 3 · 41–80 de 81 promociones»**, pero sigue mostrando `Promo 1` y no `Promo 41`. Hay cero alertas y cero botones Reintentar.
4. Otra corrida carga la primera página y luego falla al buscar `nada coincide`: se conservan las promociones sin filtro, total 81, sin aviso ni reintento.

La paginación sana sí pasó 40/40/1 con rangos 0–39, 40–79 y 80–119. El problema está en el manejo de fallo: `yaCargo` permanece true y oculta el error de cualquier actualización posterior, mientras `pagina`/`clave` ya cambiaron. La misma rama recibe conteos ausentes o inválidos.

**Corrección recomendada:** separar una actualización de fondo del mismo snapshot de una lectura de otra página/filtro. Registrar la identidad del resultado confirmado y exponer el error y Reintentar aunque ya existan filas. Se pueden conservar los datos anteriores si se identifican como anteriores; no cambiar sus etiquetas a la página/filtro fallidos ni tratarlos como respuesta actual.

**Regresión requerida:** carga sana → error de página 2, búsqueda, filtro y conteo ausente → aviso/reintento y etiquetas coherentes → reintento sano con los resultados exactos. Añadir también respuestas fuera de orden y reducción del total al borrar la última fila.

## F5-02 · Borrador de Protección perdido al cambiar de subpestaña

**Archivos:** `src/pages/RecompensasWeb.jsx:856–867`, llamadas en 870/945 y montaje condicional en 1235–1236.

**Reproducción, servicios y productos:**

1. Abrir la primera fila de Protección y escribir `77` en materiales (servicio) o transporte (producto).
2. Plegar y reabrir: el valor sigue siendo `77`, control positivo.
3. Ir a Programa, volver a Protección y reabrir la misma fila: el valor vuelve a vacío. No hubo guardado ni mutación.

Los borradores viven en `useBorradoresPorId`, dentro de Proteccion/ProteccionProductos. Al cambiar `pestana` se desmonta ese padre y también su almacén. Conservarlos fuera de la fila resuelve plegado/paginación, pero no este cambio de sección.

**Corrección recomendada:** mantener el almacén de borradores en un propietario que sobreviva al cambio de subpestaña, con claves de cuenta/tipo/id. Conservar solo datos, sin volver a montar miles de detalles. Invalidarlos al salir/cambiar de cuenta. El mismo análisis debe abarcar los formularios de Programa y cualquier modal que pueda descartarse al cambiar de pestaña. No afirmo que HEAD ya garantizara este caso: es un requisito de conservación de esta fase todavía no cumplido.

**Regresión requerida:** ambos tipos de Protección, plegado, página siguiente/anterior, búsqueda/limpieza, cambio de subpestaña y vuelta, guardado confirmado y logout/cambio de cuenta sin mezclar borradores.

## F5-03 · La identidad cambia, pero no se solicitan los recursos de la nueva clienta

**Archivo:** `src/pages/cliente/RecompensasCliente.jsx:168–172`, junto con la invalidación de `useRecursosRecompensas.js:112–130`.

**Reproducción válida:** pantalla Mis cupones montada, identidad A, saldo de A con error o todavía pendiente. Se cambia el contexto a B **sin desmontar ni pasar por un render intermedio con sesión nula**.

- Antes: consultas personales de A a `mi_saldo_recompensas` y `mis_cupones`.
- Después del cambio, con B activa y el servidor disponible: **cero consultas de B**. La respuesta tardía de A se descarta, pero B se queda sin sus recursos.
- Al cambiar manualmente a Mi tarjeta y volver a Mis cupones, aparecen las consultas de B y la sección se recupera.

`sesion` sigue siendo true; `programaReal` sigue null; `asegurar` tiene identidad estable. El efecto de la página no depende de `userId`, por lo que olvidar `pedidas` dentro del hook no vuelve a ejecutar la solicitud de la sección. Esta reproducción verifica la carga por identidad; no demuestra una filtración de datos ni sustituye la prueba de dos logins reales de Claude.

**Corrección recomendada:** hacer que el disparo de recursos dependa también de la identidad y sea coherente con el reinicio del almacén, conservando la protección contra respuestas antiguas y la deduplicación por cuenta.

**Regresión requerida:** A→B con saldo sano, lento y fallido; saldo de A resuelto después del cambio; B solicita los recursos de su sección sin tocar pestañas, no ve A y conserva estados de error/reintento propios. Cubrir también logout y login.

## F5-04 · La búsqueda dejó de ignorar diacríticos

**Archivo:** `src/lib/listasAdmin.js:66–77` y las vistas/consumidores de Referidos y Fidelización.

Claude declaró este cambio, pero declararlo no autoriza perder una función existente. HEAD normalizaba NFD y eliminaba `Diacritic` tanto del término como del código/nombre. Ahora el helper usa `ilike` sobre las columnas originales.

**Reproducción:** fixture con clienta `José`, código neutro `QA-CUPON-001` (sin coincidencia accidental por código): inicialmente 1 cupón; buscar `jose` → 0; buscar `josé` → 1, en las dos pantallas. Además, un SELECT de constantes en Postgres Local confirma `José ILIKE '%jose%' = false` y `José ILIKE '%josé%' = true`; `Peña ILIKE '%pena%' = false`. El normalizador anterior sí encuentra José/jose y Peña/pena.

**Corrección recomendada:** conservar la equivalencia anterior en la búsqueda del servidor, sin descargar toda la tabla ni ampliar permisos. Revisar la solución bajo RLS, el conteo y el escape literal de comodines. No se prescribe instalar una extensión o añadir un índice sin medir. Alternativamente, el usuario debe aceptar expresamente la pérdida; la aprobación local anterior no la incluyó.

**Regresión requerida:** código y nombre, mayúsculas, tildes en ambos sentidos y ñ/n conforme al comportamiento anterior, `%`, `_`, comas, paréntesis y comillas, paginación y contador del filtro.

## F5-05 · El catálogo público no termina de cargar bajo StrictMode

**Archivo:** `src/pages/cliente/recompensas/useRecursosRecompensas.js:139–163`; StrictMode está habilitado en `src/main.jsx`.

**Reproducción:** entrada directa pública a `/recompensas?seccion=canje`, con una respuesta correcta e inmediata de `catalogo_recompensas_publico`.

- Sin replay StrictMode: una consulta, estado terminado, cero nodos con `aria-label="Cargando tus datos"`.
- Con StrictMode en desarrollo: una consulta que responde correctamente, pero permanece el nodo `aria-busy=true` / `Cargando tus datos`; el contenido de canje no aparece. Cero errores de página.

La primera ejecución marca `pedido.current=true`; la limpieza incrementa `generacion` e invalida su respuesta. En la segunda ejecución del efecto, `pedido` sigue true y no se inicia ni se comparte una lectura válida. No es prueba de un fallo de producción, donde ese replay inicial no se ejecuta; sí rompe el entorno local normal `npm run dev` utilizado por este proyecto.

**Corrección recomendada:** hacer la deduplicación compatible con cleanup/reinicio (reiniciar el estado de pedido o compartir/reenganchar una promesa y una generación válida). **No desactivar StrictMode** para esconderlo.

**Regresión requerida:** entrada directa pública en canje bajo StrictMode, entrada desde Cómo funciona, respuesta lenta, desmontaje/remontaje, fallo y reintento. Debe salir de cargando, sin consultas personales del visitante.

## Observaciones y límites

1. Las nuevas vistas están instaladas solo en Local. Su uso de `security_invoker` es apropiado y coincide con la [guía oficial de RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security#views). No se ha certificado su matriz con sesiones reales de cajera/asistente/clienta ni el backend del negocio. La política inspeccionada de reseñas permite también las propias, incluso pendientes: corregir la frase documental «una clienta ve solo aprobadas», sin cambiar políticas para ajustarlas a una frase.
2. La consulta de Inicio limita las tarjetas, pero el promedio usa hasta 1000 calificaciones; eso sigue siendo una muestra, no un promedio global con más reseñas. Está declarado por Claude, pero debe rotularse correctamente o agregarse en servidor si se muestra como global. El total de Inicio tiene aún un fallback a longitud si falta el count; evitar presentarlo como exacto en ese caso.
3. Las latencias atribuidas a RLS no se aislaron en esta revisión; se revisarán con planes y roles en Fase 7. Las mediciones de transferencia/DOM no prueban esa causa ni una capacidad de producción.
4. El rollback de esta entrega es una receta general. Antes de un futuro commit, generar un parche o lista de hunks exclusiva de Fase 5, especialmente para `implementacionesWed.md`, preservando Fases 3 y 4 y sin `git checkout -- src` ni restauraciones globales. Codex no ejecutó un rollback.
5. La suite de Claude cubre muchos recorridos sanos, pero no los fallos aquí reproducidos. No basta conservar su 24/24: incorporar estas regresiones y repetir las suites afectadas. No es necesario repetir todo el laboratorio de rendimiento si las correcciones no alteran su ruta; justificar el alcance.
6. Las cifras grandes pertenecen a la réplica local. El usuario informa unos 300 productos reales; no se volvió a contar producción. Los tests usan fixtures y no certifican móvil, Safari, Firefox ni usuarios reales.

## Siguiente entrega de Claude

Corregir F5-01…F5-05 en local y entregar archivos, pruebas de cada reproducción, límites y rollback exclusivo. Para F5-04, conservar el comportamiento previo salvo una decisión humana explícita. Mantener los informes nuevos en `.codex`. Detenerse para la revisión V2; sin commit, push, migraciones remotas, cambio de hosting ni Fase 6.

## Validez de los diagnósticos

Los primeros intentos del harness tuvieron problemas propios: preámbulo React/imports evaluados antes de los mocks, selector con espacios distinto del nombre accesible, contexto ficticio que notificaba solo a un consumidor, MemoryRouter en un componente que consulta `window.location`, y charset ausente para un fixture con tilde. Se corrigieron solo en los scripts externos. Las conclusiones usan únicamente las corridas finales `diagnosticos.json` y `diagnosticos-adicionales.json`, con BrowserRouter, UTF-8 y notificación de todos los consumidores, sin `pageerror`. No se atribuyeron esos fallos del harness al proyecto. Los diagnósticos son funcionales de componentes reales con dependencias simuladas; no son capturas de toda la aplicación ni mediciones de rendimiento.
