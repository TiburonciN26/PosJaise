# Revisión Fase 6 · V1

Fecha: 2026-10-11, America/Lima. Proyecto: C:/WedJaiseReact. Base HEAD: `6929c619e88a91434cb16ee6a8d2de90de94c091`, rama `feat/cloudflare-pages`. Implementación local sin commit. Entrega revisada: `.codex/ENTREGA-FASE6-SESIONES-LARGAS.md`.

## Veredicto

**RECHAZADA para el cierre local de Fase 6.** La reducción de pantallas y la pausa de placeholders están bien encaminadas, pero se reproducen cuatro hallazgos P2 que afectan conservación, aislamiento o el objetivo de animación. No iniciar Fase 7 ni publicar como aprobada.

| Código | Prioridad | Hallazgo |
| --- | --- | --- |
| F6-01 | P2 | La protección de formularios se libera al intentar enviar, aunque falle o siga pendiente; al cancelar un modal editado queda una protección falsa |
| F6-02 | P2 | Un cambio directo de cuenta o rol copia filtros de la identidad anterior al estado nuevo |
| F6-03 | P2 | El mes anterior seleccionado se pierde al desalojar Dashboard y se consulta un día distinto |
| F6-04 | P2 | El conteo de puntos/barra usa otro rAF que no respeta visibilidad ni un cambio dinámico a movimiento reducido |

## Método y alcance

- **9 escenarios de caché en Chromium**: `PestanasCacheadas`, hooks, CSS y configuración de rutas reales. PuntosWeb, Dashboard y ModalPromocion reales; otras pantallas se sustituyen por componentes de relleno para aislar la política. Auth/Supabase simulados. No es una repetición de las 27 pantallas operativas completas ni prueba de permisos del backend.
- **4 escenarios de TarjetaPuntos real** con CSS real, props ficticias e instrumentación de rAF y mutaciones DOM. Un caso simula Page Visibility; fuera del viewport y el cambio de media query son controles reales del navegador.
- Los **13 escenarios finales** terminaron sin errores de página ni del harness. Son reproducciones diagnósticas: «sin error de JavaScript» no significa que cumplan el contrato; los incumplimientos se muestran en los resultados.
- Cero mutaciones de datos por Codex. Los intentos de update de PuntosWeb los atiende un cliente simulado en memoria, sin petición al backend. Los únicos accesos reales a Local fueron SELECT de conteos de prefijos QA, con el puerto 54321 del contenedor Kong de WedJaiseReact verificado.
- Auditoría de los JSON de Claude: Fase 6 registra 11/11 y regresión de Fase 5, 34/34. No se ejecutaron esas suites porque siembran/limpian por SQL mutante. Sus resultados son evidencia de Claude, no una segunda ejecución por Codex.
- Se revisaron `antes.json`/`despues.json`: tres ciclos, mismos 27 recorridos declarados. Las cifras de ciclos 2–3 coinciden con la entrega (26.392→2.856 nodos; heap 24,6/25,05→8,97/9,08 MB; 27→6 pantallas). No se repitió rendimiento de toda la app. No se acredita INP/LCP de campo, GPU ni fuga creciente.
- Lint de JS/JSX del parche exclusivo y archivos nuevos/compartidos revisados: exit 0, sin errores, **11 advertencias** de dependencias de hooks. No se verificó aquí que todas fueran previas; no ocultarlas bajo «todo limpio».
- `git apply -R --check` de `parche-fase6-exclusivos.patch`: correcto, **24 archivos**, sin aplicar. La receta de archivos mixtos se comenta abajo.

## F6-01 · La señal de formulario editado no representa su vida real

Archivos: `src/components/PestanasCacheadas.jsx:113–118`, `150–161`; consumidor reproducido `src/pages/PuntosWeb.jsx:49–81`.

### A. Liberación prematura al enviar

`onSubmitCapture` llama a `alEnviar(ruta)` antes de la validación y del guardado del formulario. Ese callback borra la ruta de `editadas` sin saber si el envío terminó bien.

Tres reproducciones usando **PuntosWeb real**:

1. Valor confirmado ficticio de puntos por visita = 1. Escribir 77, pulsar Guardar; el backend simulado responde error y aparece el toast «No se pudo guardar». Visitar siete pantallas para desalojar: PuntosWeb desaparece. Al volver, otra lectura devuelve **1**, se perdió el borrador 77.
2. Premium = 99, VIP = 30: HTML acepta los números, pero la validación real rechaza que VIP no sea mayor. Hubo **cero updates simulados**. Después del recorrido PuntosWeb se desmonta y Premium vuelve a **10**.
3. Dejar el update sin respuesta (una promesa en vuelo), navegar: PuntosWeb se desmonta **mientras el guardado está pendiente**. Al resolver con error y volver, aparece 1 en vez de 77.

Son pérdidas locales de trabajo sin confirmar; no se afirma una pérdida o cambio de datos de servidor, ya que no se escribió en una base.

### B. Protección falsa al cancelar

Un formulario de un modal también dispara `alEditar(ruta)`. Cerrar con Cancelar/Escape limpia la protección del diálogo, pero no `editadas`.

- **Promociones y ModalPromocion reales:** abrir Nueva promoción, escribir título, Cancelar. Quedan **0 formularios, 0 pendientes del registro global y 0 escrituras simuladas**. Tras otras siete rutas, `/promociones` sigue retenida, aunque ya no hay nada que conservar.
- Ocho pantallas de relleno usan el hook real de Escape/protección y cancelan ocho formularios editados. Al navegar a una novena quedan **9 pantallas montadas**, con **0 formularios y 0 inputs de borrador**. El máximo blando se supera por marcas falsas, no por trabajo vivo.

La ruta puede quedar protegida hasta otro submit posterior, aunque se haya descartado el formulario original. No se denomina esto una fuga de memoria: es retención incorrecta que derrota la política de caché.

### Corrección y aceptación

La protección debe seguir al formulario/borrador y al resultado de su operación. No liberar por el mero evento submit. Conservarla ante validación rechazada, error o resultado pendiente/incierto; liberar por éxito confirmado o descarte explícito. No permitir que el envío de un formulario borre la protección de otros formularios de la misma pantalla. Un modal cancelado/desmontado sin trabajo debe retirar su motivo; hacerlo sin retirar otros motivos vivos de esa ruta.

Regresiones: los tres casos de PuntosWeb; éxito confirmado; Cancelar/Escape después de escribir en un modal real; varias cancelaciones en rutas distintas y regreso a ≤6 sin pendientes; coexistencia de borradores. Conservar los casos sanos de diálogos abiertos y borradores de Recompensas ya declarados.

## F6-02 · El almacén de vista se limpia después de que el nuevo árbol lo lee

Archivos: `src/lib/estadoVista.js:7–24`, `src/components/PestanasCacheadas.jsx:224`, `248–252`.

El almacén es global por clave `ruta:nombre`. El cleanup de Pantallas llama a `reiniciarEstadoVista()`, pero un hook del nuevo árbol puede inicializar su `useState` leyendo el Map viejo durante el render, antes de que se ejecute esa limpieza. Vaciar el Map después no cambia el estado React ya inicializado.

Reproducciones con caché y hook reales, identidad contextual controlada, sin render intermedio de sesión nula:

- A escribe filtro «QA anterior» en Ventas. Cambiar a B: solo queda montada `/ventas`, pero B ve **«QA anterior»**.
- A administrador escribe lo mismo; cambiar su rol a CAJERA: solo queda montada `/ventas`, pero conserva **«QA anterior»**.

La key sí desmonta las pantallas antiguas. No se afirma que una pantalla administrativa no autorizada siga visible ni una fuga de filas por RLS. El fallo probado es la inicialización de filtros nuevos con estado de la cuenta/rol previo, contra la garantía explícita de invalidación.

### Corrección y aceptación

Vincular el almacén y sus lecturas iniciales a la identidad+rol, o reiniciarlo antes de que el árbol nuevo pueda leer valores viejos. El cleanup tardío solo no basta. No guardar el estado de negocio en el almacén de filtros.

Regresiones: A→B y ADMIN→CAJERA con la pantalla montada, sin recarga ni sesión nula; filtros nuevos por defecto y sin valores anteriores, árboles permitidos correctos; logout/login; respuestas tardías no repueblan el estado nuevo; conservación normal dentro de la misma identidad.

## F6-03 · El mes seleccionado se conserva solo a medias

Archivos: `src/pages/Dashboard.jsx:190–195`, `src/components/FiltrosFecha.jsx:78–91`. Patrón similar revisado en Historial (318–323), MiPanel (114–119), Estadísticas (216–221) y Auditoría (135–140); la reproducción operativa independiente es Dashboard.

La modalidad `filtro` se guarda con useEstadoVista, pero el rango `personalizado` sigue en useState. Aunque el botón Personalizado esté oculto, elegir un mes pasado usa precisamente esa modalidad y ese rango.

Reproducción con **Dashboard/FiltrosFecha reales** y RPC simulada registrada:

| Momento | Selector | Parámetros reales enviados por el componente |
| --- | --- | --- |
| Elegir septiembre | Septiembre | desde `2026-09-01T05:00:00Z`, hasta `2026-10-01T05:00:00Z` |
| Desalojar y volver | Octubre | desde `2026-10-11T05:00:00Z`, hasta `2026-10-12T05:00:00Z` |

Dashboard ya no estaba montado antes de volver. El modo guardado sigue siendo personalizado, pero sus fechas se reinician al día actual. El selector vuelve a mostrar el mes actual y la consulta corresponde a **un día**, no al mes elegido ni al mes que parece indicar el botón.

Esto pertenece a filtros y contexto del período, no al límite declarado de filas «ver más» o página paginada que se pierde tras desmontar.

### Corrección y aceptación

Conservar íntegro el filtro compuesto (modalidad y rango/mes seleccionado), por cuenta/rol. Revisar las cinco pantallas con el mismo patrón y cualquier selector de año/mes relacionado. No cambiar las reglas de cálculo de ingresos/comisiones.

Regresión: seleccionar un mes anterior, comprobar etiqueta y desde/hasta, desalojar realmente, volver y comparar ambos exactamente; incluir año anterior, Hoy/semana/mes actual y cambio de cuenta/rol. Verificar parámetros de consulta, no solo que el botón vuelva a aparecer.

## F6-04 · El bucle del contador no está conectado a las pausas

Archivo: `src/components/TarjetaPuntos.jsx:187–217`.

La física 3D usa crearBucle, pero el segundo efecto de número/barra programa su propio rAF durante 2600 ms. Solo consulta reduced-motion al iniciar el efecto, cuyas dependencias son puntos/progresoPct. No usa intersección, visibilidad ni reacciona a un cambio posterior de preferencia.

Resultados sobre la tarjeta real, CSS real, viewport 1440×900 y puntos ficticios 1234:

- **Fuera del viewport** (stage top = 2500 px): al actualizar puntos, en ~1 s hubo **61 nuevas solicitudes rAF y 61 mutaciones del número**. La transformación 3D tuvo 0 cambios: su pausa sí funcionó. Número 119→999 y barra 4,84→40,46 % aun sin poder verse.
- **Movimiento reducido desde el montaje:** control correcto, valor final 1,234 y barra 50 %, delta rAF = 0.
- **Cambiar a reducido durante el conteo:** en ~750 ms hubo **45 rAF y 45 mutaciones del número**; transformación 3D estable (0). La preferencia se aplicó al bucle físico pero no al contador.
- **Visibilitychange simulado con document.hidden=true:** la física se detiene, pero se observan 41 rAF y mutaciones del número. Este caso prueba la respuesta del código a la señal simulada; **no** es una medición de CPU real de una pestaña de navegador en segundo plano. Chromium puede suspender rAF nativamente en ese estado.

No es una fuga ni un bucle eterno: el conteo termina al alcanzar su plazo. Es trabajo innecesario fuera de vista y animación que continúa pese a activar movimiento reducido, dos condiciones explícitas de aceptación.

### Corrección y aceptación

Aplicar las señales de visibilidad y preferencia también al conteo/barra/pop. Se puede mostrar el dato final estático cuando no corresponde animar; no mantener un conteo invisible ni dejar un valor intermedio indefinidamente al volver. Mantener el arrastre y los niveles. No desactivar StrictMode ni forzar will-change masivo.

Regresiones: puntos nuevos estando fuera del viewport, actualización tras volver, ocultación durante conteo, activar reducido mientras cuenta y desactivarlo, desmontaje y cleanup. Medir número/barra y rAF por separado de la transformación 3D, ya que mirar solo la física pasa aunque el contador siga trabajando.

## Lo correcto y los límites de aceptación

- La política LRU sí mantuvo máximo 6 en el recorrido aislado de 27 rutas sin trabajo pendiente. Es una prueba de caché con rellenos, no una segunda QA de todos los flujos de las 27 páginas.
- El tope blando para trabajo REAL abierto es una decisión documentada admisible; el problema son las señales incorrectas de F6-01.
- La reducción informada de memoria/nodos es consistente con las muestras de Claude. La estabilización entre ciclos 2–3 no demuestra una fuga creciente antes ni después. No afirmar fuga o capacidad de producción sin más evidencia.
- El cuerpo de `useTextoEscritura` contempla pantalla activa, Page Visibility y cambios de movimiento reducido. FondoNivel/crearBucle tienen observadores/cleanup y la máscara de Inicio duerme al converger. Su suite de Claude los cubre; esta ronda no repitió de forma independiente todos esos recorridos ni el arrastre completo.
- No se verificó nuevamente el carrito operativo real; Layout mantiene CarritoProvider por encima, y la evidencia 11/11 de Claude contiene ese caso. No confundir eso con una segunda ejecución independiente.
- Las cifras son de la réplica local y de laboratorio. El usuario informa unos 300 productos del negocio; no se volvió a contar producción.

## Rollback y documentación

El parche de 24 archivos exclusivos pasa el check inverso; no revierte por sí solo toda la fase. La receta mixta necesita precisión:

1. Es incorrecto afirmar que no se pueden separar hunks de fases sin commits intermedios: se pueden comparar snapshots o reconstruir un baseline. Preparar los hunks exactos de los archivos compartidos, o un procedimiento completo autocontenido verificable.
2. Para `useRevelarAntes`, la receta remite a §48/parche de Fase 5, pero el cuerpo original no aparece en ese parche (Fase 5 no lo cambió). El cuerpo anterior existe en HEAD; recuperar **solo esa función**, preservando las consultas de Inicio de Fase 5, o adjuntar su fuente exacta. No restaurar el archivo completo a HEAD.
3. Mantener la separación de secciones 47/48/49 y de los cambios locales del CLI; no usar restauraciones globales ni borrar datos.
4. Actualizar el comentario inicial de PaginaActivaContext que todavía dice que nada se desmonta, para distinguir pantallas protegidas de LRU desalojable.

Estas precisiones se entregan junto con los cuatro bloqueos; Codex no implementó ningún parche ni rollback.

## Evidencia y siguiente ronda

Carpeta nueva: `C:/WedJaiseReact/.codex/evidencia-revision-fase6-v1/`:

- `cache-diagnosticos.json`: los nueve escenarios finales de caché, incluidos PuntosWeb, Dashboard y modal real.
- `tarjeta-diagnosticos.json`: cuatro controles del contador, con snapshots/mutaciones/rAF y alcance de Page Visibility indicado.
- `estado-revision.json`: hashes de las fuentes, HEAD, muestras auditadas, suite de Claude, lint/rollback y conteos QA de solo lectura.
- Copias `.txt` de los scripts externos usados para el diagnóstico.

Se corrigieron solo fallos propios del harness externo (llave extra en un relleno, selectores de mes/número/barra, y Page.emulateMedia frente a Context). El intento de validar el relleno con esbuild encontró que esa dependencia no estaba disponible y no se instaló nada; las corridas finales del navegador son las que sustentan el informe. No se atribuyeron esas fallas del diagnóstico al proyecto ni se usan sus resultados inválidos.

Los conteos de clientes/promociones/cupones/reseñas con prefijos QA F5/F6 examinados estaban en 0. Eso no certifica toda la base. No se crearon ni borraron cuentas ni filas por Codex.

Claude debe corregir F6-01…F6-04, agregar las regresiones descritas y entregar evidencia nueva sin sobrescribir la anterior. Repetir el recorrido de estabilidad si cambia la política/protecciones de caché; no es necesario rehacer todas las pruebas de fases anteriores si no cambian sus rutas, pero justificar el alcance. Detenerse para revisión V2, sin Fase 7, commit, push, migración ni hosting.

Codex no modificó código/configuración/dependencias/datos/esquema/Git. Solo generó este informe y evidencia de QA en `.codex` conforme a la instrucción persistente del usuario.
