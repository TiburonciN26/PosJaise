# Pestaña Web — plan de pestañas y relaciones

Guía de diseño para la pestaña "Web": la web pública dentro del sistema, donde
los clientes se registran con correo/contraseña (Supabase Auth) y solo ven
esto — nunca el POS. Este documento reemplaza el borrador anterior (ideas
sueltas) por una estructura concreta: qué pestañas tendrá, de qué se compone
cada una, qué tablas usa/necesita, y cómo se conecta todo entre sí y con el
"Web POS" (la vista de esta misma sección pero para el personal).

## 0. Ya construido (Fase 0)

- `usuarios` (personal) y `clientes_web` (clientes) son tablas separadas.
  `rol_actual()` solo mira `usuarios`, así que un cliente no tiene rol de
  negocio (`null`) y queda bloqueado por RLS de todas las tablas del POS,
  no solo escondido en el menú.
- Registro/login de clientes desde `Login.jsx` (modo "Crear cuenta"),
  confirmación de correo vía Supabase Auth.
- `PortalCliente.jsx`: shell propio para clientes (sin `Layout`/`MenuLateral`
  del POS). Hoy solo muestra un saludo — es donde van a vivir las
  pestañas de este documento.
- Ver `supabase/sql/62_clientes_web.sql`.

## 1. La pieza que falta antes de todo: vincular cliente_web ↔ clientes

Este es el puente que hace posible casi todo lo demás (historial, fidelización,
citas). Son dos conceptos distintos que no hay que confundir — **no hay ni
habrá una tabla `clientes` duplicada para la Web**:

- **`clientes_web`** = identidad de LOGIN (quién puede entrar: id de auth,
  correo, si está activo). No es un registro de negocio.
- **`clientes`** = el registro de NEGOCIO (nombre, teléfono, dni,
  cumpleaños, notas) — el mismo de siempre, usado por Ventas/Citas/Mi
  Panel en el POS y ahora también por la Web.

`clientes.cliente_web_id uuid references clientes_web(id) on delete set
null` (índice único) conecta ambos: una cuenta de login apunta como
máximo a una fila de `clientes`. El dato de "quién es" vive en un solo
lugar — nunca hay dos copias del mismo campo.

Nota: `62_clientes_web.sql` (Fase 0) le agregó `nombre_completo` a
`clientes_web` — eso sí sería el inicio de una duplicación. Al construir
esto se deja `clientes_web` mínima (id, email, activo) y el nombre pasa
a vivir solo en `clientes`.

### Dónde vive cada campo (estado real tras construirlo)

| Campo | Vive en | Quién lo edita | Cuenta en "datos completos" |
|---|---|---|---|
| email (login) | `clientes_web` | Supabase Auth | — |
| activo (cuenta habilitada) | `clientes_web` | Personal (Web POS) | — |
| nombre | `clientes` | Cliente (Mi Perfil) o Personal | — (obligatorio, no opcional) |
| teléfono | `clientes` | Cliente (Mi Perfil) o Personal | Sí |
| dirección | `clientes` | Cliente (Mi Perfil) o Personal — sin uso todavía, es para delivery a futuro | Sí |
| cumpleaños | `clientes` | Cliente (Mi Perfil) o Personal | Sí |
| dni | `clientes` | Solo Personal, y desde 67_ ya ni se muestra en el formulario del POS (columna viva, interfaz oculta) | No |
| notas | `clientes` | Solo Personal (notas internas, nunca visibles para el cliente) | No |
| foto de perfil | `clientes.foto_url` | Cliente | — |

### Algoritmo de vínculo (al completar Mi Perfil por primera vez)

1. Si su `clientes_web.id` ya está vinculado a alguna fila de `clientes`
   → solo actualiza esa fila (idempotente).
2. Si no, busca en `clientes` una fila **sin vincular**
   (`cliente_web_id is null`) con ese mismo teléfono exacto.
   - Una coincidencia → pregunta "Encontramos un registro con este
     teléfono, ¿eres tú?"; si confirma, vincula esa fila (hereda su
     historial de antes de que existiera la Web).
   - Ninguna (o más de una, caso raro) → crea una fila nueva en
     `clientes` con `cliente_web_id` = su cuenta.

Requiere confirmación explícita del cliente antes de vincular — nunca
automático y silencioso — para que nadie reclame el historial de otra
persona sin conocer de verdad su teléfono.

### Permisos: RPC angostas, no INSERT/UPDATE directo

Mismo patrón que ya usa el proyecto para `usuarios.foto_url`
(`actualizar_mi_foto_perfil()`): en vez de abrirle a CLIENTE
INSERT/UPDATE crudo sobre `clientes` (que expondría `dni`/`notas` si no
se cuida por columna), todo pasa por funciones `security definer`
(`supabase/sql/63_` a `67_`):

- `vincular_o_crear_cliente_web(nombre, telefono, direccion, cumpleanos, confirmar_vinculo)`
  — hace el paso 1-2 de arriba tanto la primera vez como en ediciones
  posteriores (si ya está vinculado, solo actualiza esa fila — un único
  RPC idempotente, no dos separados como se había planeado al principio).
  Valida que el teléfono no choque con otro cliente (índice único en
  `clientes.telefono`) antes de escribir.
- `mi_perfil_cliente()` — lectura del propio perfil.
- `existe_cliente_no_vinculado(telefono)` — booleano, sin filtrar datos,
  para decidir si mostrar el diálogo de confirmación antes de guardar.
- `actualizar_mi_foto_cliente(foto_url)` — solo esa columna.

Las 4 tienen `EXECUTE` revocado a `PUBLIC` (Postgres lo concede por
defecto) y otorgado solo a `authenticated` — antes de esto cualquiera
con la anon key, sin haber iniciado sesión, podía llamarlas.

**Protección extra que no estaba en el plan original:** el admin ya NO
puede editar ni borrar (ni por UI ni por RLS) una fila de `clientes` con
`cliente_web_id` distinto de null — esos campos son responsabilidad del
propio cliente desde Mi Perfil. Solo puede seguir editando/borrando las
filas que cargó a mano. Ver `65_restringir_clientes_web.sql`.

## 2. Pestañas del cliente (dentro de `PortalCliente.jsx`)

| # | Pestaña | Depende de | Alimenta a |
|---|---------|-----------|------------|
| 1 | Inicio | 2, 3, 5, 6 | — |
| 2 | Mi Perfil | `clientes_web`, `clientes` (§1) | todas las demás |
| 3 | Citas | `citas`, `cita_servicios`, `servicios`, `asistentes` | 4 (historial), 5 (fidelización) |
| 4 | Historial | `registro_servicios`, `citas` completadas | 5 (fidelización) |
| 5 | Fidelización | `registro_servicios`/`ventas` del cliente | 6 (canje de recompensas) |
| 6 | Descuentos y Promos | tabla nueva `promociones`/`codigos_referido` | 3 (aplicar en cita) |
| 7 | Servicios (catálogo) | `servicios` (ya existe, se reusa) | 3, favoritos |
| 8 | Referidos | tabla nueva `codigos_referido` | 6 |

### 2.1 Inicio
Resumen a un vistazo: próxima cita (si tiene), puntos/sellos actuales,
una promo destacada, accesos rápidos ("Agendar cita", "Ver historial").
No trae datos propios — solo compone lo que ya cargaron las otras
pestañas (evita otra fuente de verdad).

### 2.2 Mi Perfil — ✅ construido
- Datos editables: nombre completo, teléfono, dirección, cumpleaños,
  foto (`clientes.foto_url`, bucket aparte — mismo patrón que
  `usuarios.foto_url`).
- Guardar (primera vez o edición posterior, mismo botón) llama a
  `vincular_o_crear_cliente_web()` — un único RPC idempotente (ver §1).
- Pendiente, no construido en esta fase: cambiar contraseña (Supabase
  Auth `updateUser`) — el formulario de hoy no lo tiene todavía.
- Tabla: `clientes` vía las RPC del §1 — nunca updates directos.

### 2.3 Citas
- Ver próximas citas y agendar una nueva: elegir servicio(s) (carrito,
  mismo patrón que `ModalCita.jsx` ya usa en el POS), asistente
  preferido u "cualquiera", fecha/hora dentro de horarios disponibles.
- Cancelar/reprogramar su propia cita, con límite de horas antes
  (regla nueva — hoy `citas_update` no distingue "es mi cita" de
  "cualquier cita", eso hay que acotarlo para el rol CLIENTE).
- Reusa `citas` y `cita_servicios` tal como están; necesita una vista o
  RPC de "horarios libres por asistente" que hoy no existe (el POS
  agenda a mano, sin chequeo de choques).
- Tablas: `citas`, `cita_servicios`, `servicios`, `asistentes`
  (lectura vía `usuarios_para_citas()`/función equivalente para no
  exponer toda la tabla `asistentes` con datos sensibles si los tuviera).
- RLS nueva: el cliente solo debe ver/editar citas donde
  `citas.cliente_id = (su fila en clientes)`, nunca las de otros —
  las políticas actuales de `citas` (56_rol_cajera_asistente.sql) son
  para personal y no aplican tal cual a CLIENTE.

### 2.4 Historial
- Lista de visitas completadas: fecha, servicio, asistente, precio.
  Se arma con `registro_servicios` (o `citas` en estado `COMPLETADA`)
  filtrado por `cliente_id`.
- Sin escritura, es 100% lectura. Necesita una función `security
  definer` (mismo patrón que `usuarios_para_citas()`) que devuelva
  solo lo del cliente autenticado, sin abrir `registro_servicios`
  entero a `authenticated`.

### 2.5 Fidelización (tarjeta/puntos)
- Progreso visual ("te faltan 2 visitas para tu recompensa") + botón
  de canje cuando corresponde.
- Tabla nueva recomendada: `fidelizacion_movimientos` (cliente_id,
  tipo `GANADO`/`CANJEADO`, puntos, motivo, creado_en) — un log, igual
  de espíritu que `auditoria` o `movimientos_stock`, no un contador
  suelto: permite auditar y corregir sin perder historia.
- Se alimenta sola cuando se completa una cita o venta con servicios
  (trigger o dentro de `completar_cita()`/`confirmar_venta()`).
- El canje (`CANJEADO`) lo aprueba el cliente desde acá, pero el
  descuento real se aplica en la venta desde el POS (el cajero necesita
  ver "este cliente tiene una recompensa disponible" — ida y vuelta con
  Ventas, ver §4).

### 2.6 Descuentos y promociones
- Cupones/ofertas activas visibles solo para clientes registrados.
- Tabla nueva: `promociones` (titulo, descripcion, tipo_descuento,
  valor, vigente_desde, vigente_hasta, activo). Las crea el personal
  desde el Web POS (§4).
- El descuento de cumpleaños que ya existe por WhatsApp (30% por 7
  días) podría duplicarse acá como promo automática — mismo trigger
  de cumpleaños, un canal más.

### 2.7 Servicios (catálogo) — ✅ construido
- Vitrina de servicios activos: nombre, precio, duración, categoría.
  Sin foto por ahora (`servicios.foto_url` no existe; se puede sumar
  después sin romper nada, mismo patrón que `clientes.foto_url`).
- **RLS de `servicios`**: hoy `servicios_select` es
  `rol_actual() is not null` (62_clientes_web.sql la endureció a
  propósito, staff-only) — hay que sumarle una condición para que
  cualquier autenticado vea los servicios ACTIVOS (el catálogo de
  precios es información pública para quien va a agendar), dejando los
  inactivos visibles solo al personal:
  `using (public.rol_actual() is not null or activo = true)`.
- **Favoritos** — tabla nueva:
  ```sql
  create table public.favoritos_servicios (
    cliente_web_id uuid not null references public.clientes_web (id) on delete cascade,
    servicio_id    uuid not null references public.servicios (id) on delete cascade,
    creado_en      timestamptz not null default now(),
    primary key (cliente_web_id, servicio_id)
  );
  ```
  RLS: el cliente lee/inserta/borra solo sus propias filas
  (`cliente_web_id = auth.uid()`) — es una lista personal, el personal
  no necesita verla (a diferencia de `clientes`, no hay razón de
  negocio para que el admin la administre).
- **Pestaña nueva** `/servicios` en `seccionesCliente`
  ([navegacionCliente.js](src/config/navegacionCliente.js)):
  lista de tarjetas con precio/duración + botón de estrella
  (favorito/no favorito).

### 2.8 Referidos
- Código propio para compartir (`codigos_referido`: cliente_id dueño,
  código único, usos_totales, beneficio). Al usarse en un nuevo
  registro, ambos (quien invita y quien se registra) reciben un
  movimiento en `fidelizacion_movimientos` o una promo puntual.
- Depende de que Mi Perfil y Fidelización ya existan (no tiene sentido
  como primera pieza).

## 3. Cómo encajan entre sí (flujo)

```
Registro (Login.jsx) → clientes_web
        │
        ▼
   Mi Perfil (§2.2) ── crea/vincula ──▶ clientes (fila de negocio)
        │                                     │
        ▼                                     ▼
     Citas (§2.3) ──completada──▶ registro_servicios ──▶ Historial (§2.4)
        │                                     │
        ▼                                     ▼
  Descuentos/Promos (§2.6)          Fidelización (§2.5) ──canje──▶ Ventas (POS)
        ▲
        │
   Referidos (§2.8)
```

Todo cuelga de "Mi Perfil" — es la única pestaña sin la cual ninguna otra
tiene datos propios del cliente. Por eso va primero en el roadmap (§5).

## 4. El otro lado: "Web" dentro del POS (personal)

Hoy `/web` (roles ADMINISTRADOR/CAJERA/ASISTENTE) es el placeholder
"Web... Próximamente" ([Web.jsx](src/pages/Web.jsx)). Pasa a ser el panel de
administración de todo lo anterior — no una copia del portal del cliente,
sino las herramientas que el personal necesita para sostenerlo:

| Subpestaña Web POS | Para qué |
|---|---|
| Clientes web | Listado de cuentas registradas; buscar y vincular una cuenta nueva con una fila vieja de `clientes` (fusión manual, ver §1); activar/desactivar una cuenta. |
| Promociones | Crear/editar/desactivar filas de `promociones` (§2.6). |
| Fidelización — ajustes | Definir cuántos puntos otorga cada visita/monto gastado, y el umbral de recompensa. Ver/corregir movimientos puntuales de un cliente. |
| Reseñas (si se construye §2.9 futuro) | Moderar/ocultar comentarios inapropiados. |

Es admin-only casi todo (mismo criterio que `Porcentajes`/`Gastos` hoy),
salvo "Clientes web" en modo lectura que puede convenir abrirlo a CAJERA
(igual que `clientes_select` ya es de lectura general).

## 5. Roadmap sugerido (orden de dependencia, no de facilidad)

> Nota de numeración: `supabase/sql/` es una sola secuencia compartida
> con las mejoras que se hacen del lado POS — no es exclusiva de la
> Web. Antes de crear el próximo archivo, revisar `ls supabase/sql/`
> para el número más alto real (no confiar en el último que aparece
> acá) — ya pasó una vez que dos features en paralelo usaron el mismo
> número (70-73 se repitieron y hubo que renumerar 74-77).

1. ✅ **Mi Perfil + vínculo `clientes.cliente_web_id`** (§1, §2.2) —
   construido (SQL 63 a 67). Funciones básicas: nombre/teléfono/
   dirección/cumpleaños/foto, vínculo con confirmación, teléfono único,
   admin ya no puede tocar clientes de Web.
2. ✅ **Servicios/catálogo + Favoritos** (§2.7) — construido (SQL 68-69).
   Header con logo + "Jaise" (clic → Inicio), hamburguesa en móvil
   (`MenuLateralCliente.jsx`, mismo patrón que el POS) con Inicio/
   Servicios adentro, y un título centrado bajo el header indicando en
   qué pestaña estás (desktop conserva la barra completa). `/servicios`
   en el portal: buscador, chips de categoría, tarjeta
   "iridiscente" (tilt 3D + brillo dorado-rosa siguiendo el cursor,
   estilo replicado de headerYServicios.html), foto real del servicio
   (`servicios.foto_url`, la sube el personal desde `ModalServicio.jsx`),
   corazón de favorito y compartir por WhatsApp. El nombre del negocio en
   el header de la Web usa el mismo degradado dorado-blanco-rosa de esa
   referencia (solo eso del header, no su diseño completo).
3. ✅ **Citas desde la web** (§2.3) — construido (SQL 74-75).
   Confirmado por el usuario funcionando de punta a punta (agendar →
   verla en el propio calendario) después de los dos fixes de abajo.
   - `estado_negocio` gana horario real: lunes a sábado, 10:00-13:00 y
     15:00-20:30 (dos bloques, con el descanso de por medio) — expuesto
     al cliente vía `horario_atencion()`.
   - `citas.creado_por` pasa a ser opcional + `creado_por_cliente_web_id`
     nuevo (mismo patrón que `cliente_id`/`cliente_nombre_referencia`
     que ya convivían en esa tabla) — un cliente Web no tiene fila en
     `usuarios`, no podía ser el autor de la cita como estaba antes.
   - `horarios_disponibles_cita()`: calcula huecos libres de un
     asistente en un día (respeta los 2 bloques — un servicio no puede
     cruzar el descanso — y no se pisa con ninguna cita ya agendada de
     ese asistente ese día). Toda la aritmética de fecha/hora pasa por
     `at time zone 'America/Lima'`, mismo criterio que ya usa
     `es_hoy()` — sin eso, los horarios habrían salido corridos ~5h.
   - `agendar_cita_web()` / `cancelar_mi_cita_web()` /
     `reprogramar_mi_cita_web()`: único punto de escritura, revalidan
     todo en el servidor (nunca confían en lo que ya calculó el
     navegador). Cancelar/reprogramar exige 3 horas de anticipación.
   - **Decisión de alcance**: el cliente elige un asistente específico,
     no hay "cualquiera disponible" — evita resolver auto-asignación en
     esta primera versión.
   - `/citas` en el portal: calendario mensual (mismo espíritu que el
     de Citas del POS, pero solo con las citas propias), agendar nueva,
     cancelar, reprogramar.
   - **Corrección**: en Citas del POS, una cita agendada desde la Web
     ahora muestra una cápsula "Cliente Web" (junto a la hora en las
     listas, y junto al estado en el detalle) — se detecta por
     `citas.creado_por_cliente_web_id`, que el POS nunca escribe.
   - **Bug corregido (calendario)**: la clienta agendaba bien pero no
     aparecía en su propio calendario — el calendario del cliente se
     quedaba en el mes que ya tenía abierto en vez de saltar al mes de
     la cita recién creada/reprogramada.
   - **Bug corregido (RLS, más serio)**: aun mirando el mes correcto,
     la clienta seguía sin ver NINGUNA cita propia — `SQL 76`.
     `citas_select_propio_web`/`cita_servicios_select_propio_web`
     resolvían "cuál es mi cliente" con una subconsulta directa contra
     `clientes`, y esa subconsulta queda sujeta al RLS de `clientes`
     (staff-only) — para la propia clienta siempre devolvía vacío, así
     que la política nunca se cumplía. `agendar_cita_web()` sí
     funcionaba (es `security definer`, se salta el RLS), pero el
     `SELECT` de "mis citas" no. Se agregó `mi_cliente_id()` (mismo
     patrón que `rol_actual()` ya usa para `usuarios`) para resolverlo
     sin tropezar con el RLS de `clientes`. Verificado en vivo
     suplantando la sesión real de la clienta: 0 filas antes del fix,
     1 (la suya) después.
4. ✅ **Historial** (§2.4) — construido (SQL 77). 100% lectura, sin RPC
   de escritura. Fuente: `registro_servicios` (no `citas`) filtrado por
   `mi_cliente_id()` — así aparece tanto lo agendado por la Web como una
   atención registrada directo por el personal. De paso se cerró un
   hueco pre-existente: `registro_servicios_select_disponibles` dejaba
   ver a cualquier autenticado (sin chequeo de rol) los servicios
   "activos y sin vender" de CUALQUIER cliente — ahora exige
   `rol_actual() is not null`, verificado en vivo (staff sigue viendo
   sus 17 registros, la clienta ve solo los suyos). "Tus citas" salió
   del menú del avatar (redundante, Citas ya es pestaña propia) y en su
   lugar quedó "Historial", como subpágina.
5. ✅ **Fidelización** (§2.5) — construido (SQL 78), **alcance
   reducido a propósito**: solo ver progreso, sin canje real todavía
   (decisión del negocio — el canje en caja queda para una fase aparte,
   no se tocó `Ventas.jsx`).
   - Regla real del negocio: 1 sello por VISITA completada (no por
     servicio — una visita con 2 servicios sigue siendo 1 sello). 5
     sellos = 20% de descuento.
   - Sin tabla de movimientos nueva: por ahora no hace falta (no hay
     canjes que registrar todavía) — el progreso se calcula al vuelo en
     `mi_fidelizacion()` a partir de `registro_servicios`, agrupando por
     `(cliente_id, fecha)` distintos — confirmado con datos reales que
     tanto `completar_cita()` como el registro manual de Mi Panel
     insertan todas las líneas de una misma visita con el mismo `fecha`
     (no `now()` por línea), así que ese agrupamiento sí equivale a
     "una visita", verificado simulando 6 visitas (una de 2 líneas) →
     dio 6 sellos totales, no 7.
   - `/fidelizacion` como subpágina (menú del avatar): tarjeta de 5
     sellos, aviso si ya tiene una recompensa disponible.
6. ✅ **Descuentos/Promociones** (§2.6) — construido (SQL 79),
   verificado en vivo (admin puede crear, cliente solo ve activas y
   vigentes). El descuento de cumpleaños se queda solo en WhatsApp por
   ahora — decisión del negocio, no se duplica acá.
   - `/web` (POS) deja de ser el placeholder "Web... Próximamente" y
     pasa a ser admin-only (antes también la veían Cajera/Asistente) —
     panel administrativo de la pestaña Web, con Promociones como su
     primera sección real.
   - Sin agregar pestañas sueltas al menú: `/promociones` cuelga de
     `/web` como "padre" (`navegacion.js`), mismo patrón que ya existe
     entre Deudas y Clientes — en el menú lateral (móvil) se revela con
     la flechita en vez de sumar un ítem más a una lista ya larga.
   - `/ofertas` en el portal del cliente (menú del avatar → "Cupones y
     ofertas", ya no placeholder) — solo lectura.
7. **Referidos** (§2.8) — el que más depende de que todo lo anterior
   ya esté rodando.

Cada fase suma su propia subpestaña en Web POS (§4) cuando corresponde
(Promociones y Fidelización necesitan su panel de admin; Citas/Historial
no, se gestionan igual que hoy desde Citas/Mi Panel del POS).

## 6. Rediseño visual de la Web de clientes (fase aparte del roadmap de features)

Con las 6 pestañas de arriba ya funcionando, el pedido pasó a ser
visual: la Web que ve el cliente (no el POS, que se queda pixel-igual)
necesita un diseño propio de "página web", distinto del resto del
sistema — inspirado en una landing dark tipo SaaS que trajo el usuario
como referencia (fuentes Inter + Instrument Serif itálica, paleta
oscura fija, tarjetas "liquid glass", animaciones con scroll).

**Decisiones confirmadas por el usuario:**
- Stack: JS + Framer Motion. Sin TypeScript (el proyecto entero es JS)
  y sin shadcn/ui (todo el UI del proyecto es hand-rolled) — se instaló
  `framer-motion` (`^13.3.0`) como única dependencia nueva.
- Alcance/orden: empezar por **Inicio** (`InicioCliente.jsx`, antes un
  saludo de texto plano) y después ir pestaña por pestaña (Servicios,
  Citas, Mi Perfil, Historial, Fidelización, Ofertas), confirmando cada
  una antes de seguir con la próxima — mismo ritmo de plan→confirmar
  que el resto de las fases.
- Sin fabricar imágenes/video: la referencia original usaba una captura
  de dashboard + video de fondo; acá no hay fotografía real del salón
  todavía, así que el "showcase" del hero es una composición de vidrio
  + resplandor animado (CSS puro), no un `<img>`/`<video>` con URL
  inventada.

**Arquitectura CSS (`src/index.css`):** todo bajo una clase `.landing-web`
que NO toca los tokens compartidos (`bg-bg`/`text-ink`/ámbar) — paleta
oscura fija propia (`--lw-bg`, `--lw-fg`, `--lw-muted`, `--lw-card`,
`--lw-border`, `--lw-subtitle`, `--lw-gold`, `--lw-rose`), independiente
del switch claro/oscuro del resto de la app. Clases: `.lw-serif`
(Instrument Serif itálica, para la palabra de acento del titular),
`.liquid-glass` (receta de vidrio esmerilado tal cual la trajo el
usuario) y `.lw-glow` (resplandor dorado→rosa pulsante, mismos tonos que
`.catalogo-iridiscente` de Servicios, para que las dos "capas" de diseño
de la Web no se sientan desconectadas entre sí) con su
`prefers-reduced-motion` correspondiente.

- ✅ **Inicio v1** (`InicioCliente.jsx`) — primera versión: hero con
  entrada escalonada (Framer Motion), parallax de scroll, pastilla de
  saludo personalizada, titular con acento serif itálico, CTA "Agendar
  una cita" y una sección de testimonio con revelado de color
  palabra-por-palabra ligado al scroll. El usuario detectó que el header
  compartido (`PortalCliente.jsx`) se veía "raro": seguía con el tema
  claro/oscuro de siempre (`bg-surface`/`border-border`) sobre el fondo
  negro puro de la nueva landing, con una costura visible.
  - **Fix**: `PortalCliente.jsx` ahora calcula `esLanding` (una lista
    `RUTAS_LANDING`, hoy solo `/inicio`) y, cuando la ruta actual está
    ahí, el header + la fila de "dónde estás" (móvil) + el drawer
    (`MenuLateralCliente.jsx`, prop `esLanding`) cambian a
    `.liquid-glass` con `border-white/10` y acentos en `--lw-gold` en
    vez de `bg-surface`/ámbar — se funden con el fondo en vez de flotar
    como una caja aparte. El resto de rutas (`/servicios`, `/citas`,
    etc.) no se tocan hasta que les llegue su turno de rediseño.
- ✅ **Inicio v2** (`InicioCliente.jsx`) — reescritura completa a pedido
  de un segundo "recreation prompt" que trajo el usuario (referencia
  "Asme"): reemplaza el hero-con-showcase-de-vidrio y el testimonio de
  v1 por una landing de una sola página con 4 secciones adicionales de
  scroll, animadas con `useInView` (una vez, `margin: '-100px'`).
  - **Decisiones confirmadas por el usuario** (dos preguntas, dos
    respuestas): (1) la referencia traía navbar propio con "Sign Up" /
    "Login" y un formulario de newsletter — típico de una landing
    pública para visitantes sin cuenta; como Inicio es la pantalla de
    un cliente ya logueado, esos elementos NO se agregaron — se
    mantiene el header real de `PortalCliente.jsx` (login/logout ya
    resuelto ahí) y la pastilla de saludo personalizada en vez de un
    formulario de email. (2) La referencia trae 5 URLs de video de otro
    proyecto de ejemplo ("Asme", contenido genérico sin relación con el
    salón) — el usuario pidió usarlas tal cual, a sabiendas de que no
    muestran nada del negocio; están marcadas con un comentario en el
    código para reemplazarlas por grabaciones reales del salón en
    cuanto existan.
  - Hero: ya no es un showcase de vidrio estático — es el video de
    fondo a pantalla completa, con loop y crossfade a negro manual
    (sin `loop` nativo, que cortaría en seco): fade-in al evento
    `canplay`, fade-out en los últimos ~0.55s de cada vuelta
    (`timeupdate`), reinicio + fade-in de nuevo al terminar (`ended`) —
    todo animando `style.opacity` a mano con `requestAnimationFrame`
    (sin transición CSS ni estado de React), igual que pidió la
    referencia. Mantiene la pastilla de saludo, el titular con acento
    serif (ahora el titular completo usa Instrument Serif recto vía la
    nueva clase `.lw-serif-regular`, reservando `.lw-serif` — itálica —
    solo para la palabra de énfasis) y el CTA a `/citas`, ahora en
    estilo `.liquid-glass` en vez de botón blanco sólido.
  - 4 secciones nuevas, cada una un componente local dentro del mismo
    archivo (uso único, no se repiten en ninguna otra pantalla):
    "Sobre nosotros" (titular en dos tramos serif normal/itálico),
    "Video destacado" (video + tarjeta de vidrio con el enfoque del
    negocio + botón a `/servicios`), "Filosofía" ("Cuidado x Confianza",
    video + dos bloques de texto separados por un divisor) y
    "Qué hacemos" (grid de 2 tarjetas con video, cada una con etiqueta,
    ícono `ArrowUpRight` en círculo de vidrio, título y descripción).
  - Se quitó el footer de íconos sociales de la referencia (Instagram/
    Twitter/Globe): el proyecto no tiene ninguna cuenta social real
    guardada en ningún lado (se revisó — solo existe WhatsApp dinámico
    por cliente/asistente en el POS), así que no había ningún enlace
    real que poner ahí sin inventarlo.
  - Build y lint verificados.
- ✅ **Rollout a toda la Web + 2 bugs de cromo compartido** — a pedido
  del usuario, que además reportó dos bugs concretos tras ver v2:
  1. **Header "raro" / menú del avatar detrás de Inicio**: causa raíz —
     `.liquid-glass` trae `backdrop-filter`, que crea un contexto de
     apilamiento nuevo en cualquier elemento donde se aplique. Puesto
     directo en el `<header>`, ese contexto atrapaba adentro al menú
     desplegable del avatar (que cuelga por `top-full`, fuera de la caja
     del header) — como el header no tenía `z-index` propio, todo ese
     contexto (dropdown incluido) quedaba por detrás de `<main>` en el
     orden normal del documento. `overflow: hidden` (también parte de
     `.liquid-glass`) de paso recortaba lo que lograba desbordarse.
     **Fix**: nueva clase `.lw-bar` (sin `backdrop-filter` — acá no hay
     nada detrás que desenfocar, el header no es sticky/fixed — ni
     `overflow: hidden`) para header, fila de "dónde estás" (móvil),
     dropdown del avatar y sus modales de confirmación; el `<header>`
     ahora suma `relative z-30` explícito. `.liquid-glass` (con blur real)
     se queda para tarjetas/píldoras que si necesitan ese efecto.
  2. **Logo con degradado "raro"**: `.nombre-marca-web` tenía un
     degradado dorado→blanco→rosa recortado al texto (heredado de la
     fase de Servicios/iridiscente) — no encajaba con el lenguaje visual
     nuevo (blanco sólido + dorado puntual, nunca arcoíris). Ahora es
     blanco sólido en Instrument Serif itálica (`.lw-serif`), coherente
     con el resto de acentos tipográficos de la landing. Como esta clase
     solo se usa en el header de la Web (ya siempre oscuro), se pudo
     simplificar directo sin dejar una rama condicional.
  - **El diseño ya no es condicional por ruta**: `PortalCliente.jsx`
    aplica `.landing-web` siempre (se quitó `RUTAS_LANDING`/`esLanding`)
    — el header, la fila móvil y el drawer (`MenuLateralCliente.jsx`) son
    oscuros para cualquier ruta del cliente, presente o futura, sin tocar
    este archivo de nuevo cada vez que se agregue una pestaña.
  - **Se quitó el switch claro/oscuro del menú del avatar**
    (`MenuUsuarioCliente.jsx`): con la Web siempre oscura, ese botón ya
    no hacía nada útil para un cliente — el switch se queda solo para el
    POS. El resto del menú (avatar, opciones, "Cerrar sesión" + su
    confirmación) pasó a estilo `.lw-bar`/dorado.
  - **Se rediseñaron las 6 pestañas que faltaban**, todas con la misma
    paleta (`.liquid-glass`/`.lw-bar`, acentos `--lw-gold`, texto blanco,
    títulos en `.lw-serif-regular`), sin tocar ninguna lógica de negocio:
    `ServiciosCliente.jsx` (buscador y chips oscuros; las tarjetas
    "iridiscentes" ya usaban dorado/rosa, solo hubo que sacarles la
    dependencia de `var(--color-ink)` en `.iri-name`/`.iri-meta`/
    `.iri-img-vacia` — quedaban leyendo el tema global compartido con el
    POS, invisible si un cliente tenía su dispositivo en claro),
    `CitasCliente.jsx` + `ModalAgendarCitaCliente.jsx` +
    `ModalReprogramarCitaCliente.jsx`, `MiPerfil.jsx` +
    `ModalEditarPerfilCliente.jsx`, `HistorialCliente.jsx`,
    `FidelizacionCliente.jsx`, `OfertasCliente.jsx`.
  - **Nota técnica que se repite en los 3 modales de cliente que tenían
    formularios** (perfil, agendar cita, reprogramar cita): dejaron de
    usar la `Etiqueta.jsx` compartida con el POS (usa `text-ink/60`, un
    token atado al switch claro/oscuro global) y pasaron a una
    `EtiquetaCampo` local en blanco fijo — mismo motivo que el punto
    anterior: un cliente con su dispositivo en tema claro habría visto
    esas etiquetas casi invisibles sobre el fondo negro fijo de la Web.
    `ModalCamara.jsx` (compartido con POS, usado para la foto de perfil)
    se dejó sin tocar a propósito: cambiarlo afectaría también al POS.
  - Build y lint verificados en cada archivo tocado.
- ✅ **Header flotante de verdad translúcido** — el usuario reportó que,
  pese al fix anterior (`.lw-bar` con `backdrop-filter`), el header
  seguía viéndose "negro sólido". Causa real: el header vivía como un
  bloque más dentro del flujo (empujaba el contenido hacia abajo), así
  que nunca tenía nada real detrás para desenfocar — un
  `backdrop-filter` sin contenido variable detrás simplemente no se
  nota. Trajo como referencia un segundo prompt de recreación ("Apogee",
  landing de fintech con nav flotante de pastillas de vidrio) —
  confirmado con el usuario: se tomó SOLO la técnica del nav/header
  (pastillas flotantes, blur real, según AskUserQuestion), no el resto
  de ese Hero (video ajeno, dashboard falso "Revenue Growth", ni su
  copy — nada de eso es del salón).
  - **`PortalCliente.jsx`**: el `<header>` pasa a `fixed inset-x-0 top-0
    z-50` (ya no reserva espacio en el flujo) y pierde su fondo propio
    — el vidrio ahora vive en las pastillas de adentro
    (`.liquid-glass`): el logo suelto, una pastilla `rounded-full` con
    las pestañas (activa = pill dorado sólido) en desktop, un botón
    cuadrado de vidrio para la hamburguesa en móvil. El contenedor de
    abajo suma `pt-[76px] sm:pt-[86px]` para compensar el alto real del
    header fijo — con eso, el contenido de cada pestaña sí pasa por
    detrás del header al hacer scroll, y ahí el desenfoque se nota de
    verdad (antes no pasaba nada por detrás, por eso se veía sólido).
  - `.liquid-glass` (index.css) subió su `backdrop-filter` de 4px a
    16px (escala de la referencia Apogee: 17-20px) — con contenido real
    pasando detrás, un blur de 4px era casi imperceptible.
  - El drawer móvil (`MenuLateralCliente`, z-20) queda a propósito por
    debajo del nuevo header (z-50): el botón de hamburguesa se mantiene
    visible/clickeable para cerrarlo con el drawer abierto.
  - Build y lint verificados.

## 7. Contenido de marca (más allá de lo transaccional)

A pedido del usuario ("¿qué pestañas debería tener para ser una web de
salón completa?"): con Inicio/Servicios/Citas/Mi Perfil/Historial/
Fidelización/Ofertas ya resuelta la parte transaccional (agendar,
comprar, acumular), faltaba la parte de marca/confianza — quién es el
negocio, quién atiende, qué dicen otras clientas. Propuestas, en orden
de prioridad:

1. ✅ **Equipo** — construido y aplicado (SQL 83, corrida a mano por el
   usuario). Tarjetas de personal en el portal cliente.
2. **Galería** (antes/después) — único punto pendiente de esta lista.
   Depende 100% de fotos reales del salón, no construir con
   placeholders/stock — sigue como "Próximamente" en
   `NosotrosCliente.jsx` hasta que el usuario las pase.
3. ✅ **Reseñas** — construido (§7.4, SQL 86). Muro público de
   testimonios + "Tus reseñas" para escribir/editar la propia.
4. ✅ **Contacto** — construido (§7.5, SQL 87). Dirección, horario,
   WhatsApp y redes — sin contadores animados (no pedidos después,
   se dejó de lado).
5. ✅ **Referidos** (§2.8) — construido (§7.26/7.27, SQL 94-95).
   Código/link para compartir + cupón de un solo uso, integrado al
   sistema de cupones que después reusó Fidelización (§7.58).

**Decisión de IA (arquitectura de información) — confirmada por el
usuario**: estas 4 páginas de marca (Equipo/Galería/Reseñas/Contacto) NO
van una por una a la barra principal ni al menú del avatar. El usuario
notó que "Equipo" no encajaba en el menú del avatar (eso es "tu cuenta"
— perfil, historial, fidelización — y Equipo es información del
negocio, no del cliente). En vez de sumar una pestaña nueva a la barra
por cada página de este tipo, se agrupan TODAS bajo una única pestaña
**"Nosotros"** en la barra principal (`seccionesCliente`,
`NosotrosCliente.jsx`), con su propia sub-navegación interna (una
píldora de vidrio con Equipo/Galería/Reseñas/Contacto) — la barra
principal se queda corta para siempre (Inicio/Servicios/Citas/Nosotros)
sin importar cuántas páginas de marca se sumen después. Las que todavía
no tienen contenido real muestran un placeholder "Próximamente" inline
(sin navegar a ningún lado), no un toast.

### 7.1 Equipo (SQL 83 — `83_equipo_web.sql`)

- **Decisión confirmada por el usuario**: el admin elige quién aparece
  en la Web con un interruptor "Mostrar en la Web" por asistente (no se
  muestran automáticamente todas las activas) — evita exponer perfiles
  sin foto/bio cargada todavía.
- `asistentes` (tabla interna, nombre/teléfono/comisión) suma 4 columnas
  nuevas pensadas para esto: `foto_url`, `especialidad`, `bio`,
  `mostrar_en_web boolean default false`.
- Bucket nuevo `fotos-asistentes` (público, solo admin sube/reemplaza/
  borra — mismo patrón que `fotos-servicios`, 69_servicios_foto.sql): la
  foto la carga el ADMIN desde `Asistentes.jsx`/`ModalAsistente.jsx`, no
  la propia asistente — muchas no tienen cuenta de login
  (`usuario_id` null), así que el patrón "cada quien sube a su propia
  carpeta" de `fotos-usuarios` no aplica acá.
- RPC nueva `equipo_para_web()` (security definer, mismo patrón que
  `asistentes_para_citas()`): expone `id, nombres_completos, foto_url,
  especialidad, bio` de activos con `mostrar_en_web = true` — la tabla
  `asistentes` sigue bloqueada para un cliente Web
  (`asistentes_select` exige `rol_actual() is not null`).
- `ModalAsistente.jsx`: nuevos campos (especialidad, bio, foto con
  cámara/galería igual que `ModalServicio.jsx`, interruptor "Mostrar en
  la Web" con el componente compartido `Interruptor.jsx`).
  `Asistentes.jsx` suma esos campos a la consulta, al cálculo de
  "datos completos" y una etiqueta "En la Web" junto a "Vinculada a una
  cuenta".
- `NosotrosCliente.jsx` (nuevo — reemplaza al `EquipoCliente.jsx` de la
  primera versión, ver decisión de IA arriba): pestaña de la barra
  principal, ruta `/nosotros`. Sub-navegación interna (píldora de
  vidrio, `useState` local, sin rutas anidadas todavía — se separan en
  rutas reales el día que alguna sub-sección crezca lo suficiente) con 4
  botones: "Equipo" (contenido real, `SeccionEquipo` — grid de tarjetas
  `.liquid-glass` con entrada escalonada, Framer Motion + `useInView`,
  mismo patrón que las secciones de Inicio) y "Galería"/"Reseñas"/
  "Contacto" (placeholders inline "Próximamente", `SeccionProximamente`).
  Sin fotos reales todavía en Equipo — el placeholder por persona es un
  fondo negro con un ícono, no una imagen inventada; el admin las va
  cargando de a poco desde el POS.
- El usuario corrió `83_equipo_web.sql` a mano en el SQL Editor de
  Supabase (el MCP conectado en esta sesión solo mostraba un proyecto
  ajeno, "alquileres-mariluz" — no se aplicó desde acá para no arriesgar
  aplicarla al proyecto equivocado). **Ya aplicada y verificada por el
  usuario.**
- Build y lint verificados (frontend).

### 7.2 Productos (SQL 84 — `84_productos_favoritos.sql`)

A pedido del usuario: la Web también debía ofrecer el catálogo de
productos que vende el salón (no solo servicios) — nueva pestaña
**"Productos"** en la barra principal, al lado de "Servicios"
(`seccionesCliente`: Inicio/Servicios/Productos/Citas/Nosotros).

- Mismo patrón que servicios (§2.7): `productos_select` (endurecida a
  staff-only en `62_clientes_web.sql`) se reabre a
  `rol_actual() is not null or activo = true`; tabla nueva
  `favoritos_productos (cliente_web_id, producto_id)` con las mismas 3
  policies que `favoritos_servicios`. El "costo" del producto sigue
  oculto para todos salvo admin — eso ya lo resolvía `03_rls.sql` a
  nivel de columna/vista (`productos_vista`), sin relación con esta
  política de filas; no se tocó.
- **Diferencia real con servicios — stock**: `productos` tiene
  `stock_actual` (servicios no tiene equivalente). Decisión confirmada
  con el usuario: un producto sin stock SIGUE apareciendo en el
  catálogo (para que la clienta lo vea, lo guarde en favoritos o
  pregunte por él) — no se filtra por stock en la query — pero se marca
  con una etiqueta "Agotado" (`.iri-agotado`, nueva en `index.css`,
  mismo tratamiento de vidrio que `.iri-price` pero en la esquina
  opuesta, para que conviva con el precio en vez de reemplazarlo).
- `ProductosCliente.jsx` (nuevo): clon casi literal de
  `ServiciosCliente.jsx` — mismo buscador, chips de categoría, tarjeta
  iridiscente, corazón de favorito y compartir por WhatsApp — cambiando
  la fuente de datos (`productos`/`favoritos_productos`/bucket
  `fotos-productos`, que ya existía con la política admin-only correcta
  desde `42_storage_fotos_productos.sql`, sin cambios ahí) y agregando
  la etiqueta de agotado. En esta fase todavía no había carrito/checkout
  — eso se construyó después, ver §7.3.
- El usuario corrió `84_productos_favoritos.sql` a mano (mismo caso que
  83 — el MCP conectado en esta sesión nunca mostró el proyecto real,
  solo uno ajeno). **Ya aplicada.**
- Build y lint verificados (frontend).

### 7.3 Carrito + Pedidos Web (SQL 85 — `85_carrito_pedidos_web.sql`)

A pedido del usuario: un ícono de carrito en el header (a la izquierda
del avatar) que lleva a una subpágina `/carrito` con lo que el cliente
fue agregando desde Servicios y Productos. Aclaración explícita e
importante del usuario, repetida dos veces en la conversación: los
servicios **no se venden ni tienen delivery** — solo los productos.

**Estructura acordada con el usuario** (preguntada explícitamente, no
inventada):
- Carrito de **Servicios**: solo una lista de intención, sin cantidad.
  Botón **"Reservar cita"** — el cliente marca cuáles quiere agendar (no
  tiene que ser todos) y eso abre el modal de Agendar Cita YA EXISTENTE
  con esos servicios precargados (sigue pudiendo agregar/quitar ahí
  mismo); al agendar con éxito, esos servicios se sacan solos del
  carrito. No hay "comprar" servicios — no existe ninguna RPC nueva para
  esto, se reusa `agendar_cita_web()` tal cual.
- Carrito de **Productos**: con cantidad, **en su propio bloque, nunca
  mezclado con Servicios** (pedido explícito). Botón **"Confirmar
  compra"** — con los productos marcados. Como NO hay pagos online, el
  botón no cobra nada: crea un pedido real (`pedidos_web` +
  `pedidos_web_items`) que queda `PENDIENTE` para que el personal lo
  gestione. Confirmado con el usuario: sí hace falta un panel nuevo en
  el POS para esto (si no, "Confirmar compra" no llevaría a ningún lado
  accionable para el negocio) — ver `PedidosWeb.jsx` abajo.
- **Delivery — solo para productos**: dentro del bloque de Productos,
  justo antes de "Confirmar compra", un selector "Recojo en tienda" /
  "Delivery". Si elige Delivery, se le pide zona (`zonas_delivery`,
  costo FIJO por zona, confirmado con el usuario: S/10 Nuevo Chimbote,
  S/15 Chimbote — tabla editable en vez de hardcodear el monto, para que
  el admin pueda ajustar precios/sumar zonas sin un despliegue nuevo) y
  dirección (precargada de `perfil.direccion` si ya la tiene cargada, la
  columna que en su momento se agregó "a futuro para
  servicios/ventas a delivery", ver `67_clientes_direccion.sql`).
- Persistencia confirmada con el usuario: el carrito vive EN LA CUENTA
  (tablas nuevas, mismo patrón que `favoritos_servicios`/
  `favoritos_productos`), no en `localStorage` — se ve igual desde
  cualquier dispositivo.

**SQL nuevo:**
- `carrito_servicios (cliente_web_id, servicio_id)` — sin cantidad,
  mismas 3 policies que `favoritos_servicios` (select/insert/delete
  propias).
- `carrito_productos (cliente_web_id, producto_id, cantidad)` — mismas
  policies + `update` (para cambiar cantidad).
- `zonas_delivery (id, nombre, costo, activo)` — lectura abierta a
  cualquier autenticado (staff necesita verla en el panel de pedidos,
  el cliente para elegir al pedir delivery), escritura admin-only.
  Sembrada con Nuevo Chimbote (S/10) y Chimbote (S/15).
- `pedidos_web` (cabecera) + `pedidos_web_items` (detalle, con
  `nombre_producto`/`precio_unitario` "congelados" — un pedido ya
  confirmado no debe cambiar si después se edita o borra el producto).
  `pedidos_web.cliente_id` referencia `clientes` (no `clientes_web`) —
  mismo criterio que `citas`/`registro_servicios`, para que el personal
  vea un cliente unificado POS+Web, resuelto vía `mi_cliente_id()`
  (mismo patrón ya usado y documentado en el bug de Citas, §5 punto 3).
  RLS: el cliente ve solo lo suyo (`cliente_id = mi_cliente_id()`), el
  admin ve y actualiza (cambiar `estado`) todo.
- `confirmar_pedido_productos(p_producto_ids, p_tipo_entrega,
  p_zona_delivery_id, p_direccion)` — único punto de escritura de un
  pedido, mismo criterio que `agendar_cita_web()`: revalida todo en el
  servidor (exige perfil vinculado, valida tipo de entrega, resuelve el
  costo real de la zona en ese momento — nunca confía en un total que ya
  calculó el navegador), arma cabecera + detalle a partir de lo que
  realmente hay en `carrito_productos` (nunca de lo que mandó el
  cliente) y borra del carrito solo los ítems confirmados. No valida
  stock a propósito — mismo criterio que el catálogo (§7.2): un producto
  agotado se puede seguir pidiendo, el negocio decide.

**Frontend:**
- `CarritoClienteContext.jsx` (nuevo, NO confundir con
  `CarritoContext.jsx` — ese es el carrito de venta en caja del POS
  interno, algo completamente distinto): estado compartido de
  servicios/productos en el carrito + contador, para que el header,
  Servicios y Productos se mantengan sincronizados sin recargar.
- `PortalCliente.jsx`: nuevo botón de carrito en el header (píldora de
  vidrio, ícono `ShoppingBag` + insignia con la cantidad), a la
  izquierda del avatar, como pidió el usuario — lleva a `/carrito`
  (subpágina, no una pestaña de la barra principal).
- `ServiciosCliente.jsx`/`ProductosCliente.jsx`: cada tarjeta suma un
  botón de agregar al carrito (Servicios: toggle simple; Productos: un
  selector +/- de cantidad una vez agregado). Además, a pedido del
  usuario, la grilla bajó de `3 → 5` columnas a **`3` en móvil y `4`
  desde tablet/desktop** (antes saltaba a 5 en pantallas grandes).
- `CarritoCliente.jsx` (nuevo, ruta `/carrito`): dos bloques
  `.liquid-glass` separados, Servicios y Productos, cada uno con sus
  casillas (todo viene marcado por defecto, el cliente desmarca lo que
  no quiere resolver todavía) y sus propios botones de acción descritos
  arriba.
- `ModalAgendarCitaCliente.jsx`: ahora acepta un prop opcional
  `serviciosIniciales` (precarga la selección, sigue siendo editable) y
  su `onAgendada` ahora manda también la lista final de servicios
  elegidos, para que `CarritoCliente.jsx` sepa cuáles sacar del carrito
  tras agendar con éxito.

**Lado del POS — `PedidosWeb.jsx`** (nuevo, cuelga de `/web` como
"padre", admin-only, junto a Promociones — mismo patrón que Deudas bajo
Clientes): lista de pedidos con badge de estado (Pendiente/Listo/
Entregado/Cancelado), detalle expandible (ítems, subtotal, zona +
dirección si es delivery, botón directo de WhatsApp al cliente) y
botones para avanzar el estado (Pendiente → Listo → Entregado, o
Cancelado en cualquier punto antes de Entregado) — sin edición de
contenido, el pedido lo arma el cliente, el personal solo lo gestiona.

- El usuario corrió `85_carrito_pedidos_web.sql` a mano (mismo caso que
  83/84). **Ya aplicada.**
- Build y lint verificados (frontend). Sin verificar en vivo contra la
  base de datos real todavía (MCP sin acceso al proyecto correcto en
  esta sesión).

### 7.4 Reseñas (SQL 86 — `86_resenas.sql`) — ✅ aplicada y verificada en vivo

El MCP de Supabase reconectó al proyecto real ("WedJaiseReact", antes
solo mostraba uno ajeno) — a partir de acá se pudo volver a aplicar y
verificar en vivo, como en las fases 1-6 originales.

**Decisiones confirmadas por el usuario** (dos preguntas, ambas por la
opción recomendada):
- **Moderación**: el admin aprueba antes de que se vea pública — nunca
  se publica sola. Editar una reseña ya aprobada la vuelve a mandar a
  `PENDIENTE` (el contenido cambió, hay que revisarlo de nuevo).
- **Una sola reseña por clienta, editable** — no un historial de
  varias. `resenas.cliente_id` es `unique`, `guardar_mi_resena()` hace
  upsert (`on conflict (cliente_id) do update`).

**SQL:**
- `resenas (id, cliente_id → clientes, calificacion 1-5, comentario,
  estado PENDIENTE/APROBADA/RECHAZADA, creado_en, actualizado_en)`.
  `cliente_id` referencia `clientes` (no `clientes_web`), mismo criterio
  que `pedidos_web`/`citas` — el admin necesita ver un cliente unificado
  POS+Web al moderar.
- RLS: la propia clienta ve su reseña en cualquier estado
  (`cliente_id = mi_cliente_id()`); cualquier autenticado ve las ya
  `APROBADA` (el muro público); el admin ve y actualiza (moderar) todo.
- `guardar_mi_resena(calificacion, comentario)` — único punto de
  escritura de la clienta, mismo criterio que el resto de RPC de
  escritura del cliente: valida 1-5 estrellas en el servidor, upsert
  por `cliente_id`, siempre vuelve a `PENDIENTE`.
- `mi_resena()` — la propia reseña (o vacío), para "Tus reseñas".
- `resenas_publicas()` — el muro de Nosotros > Reseñas: solo
  `APROBADA`, con el nombre completo de la clienta (el frontend decide
  truncarlo a "Nombre I." para mostrar — el dato completo solo lo ve el
  admin en su panel de moderación).
- Verificado en vivo suplantando la sesión real de una clienta vinculada
  ("Turqui"): `guardar_mi_resena()` insertó correctamente con
  `estado = 'PENDIENTE'` dentro de una transacción con `rollback` (sin
  dejar datos de prueba reales). `get_advisors` no marcó ninguna función
  nueva como ejecutable por `anon` (las 3 quedaron correctamente
  revocadas de `public`, otorgadas solo a `authenticated`).

**Frontend:**
- `NosotrosCliente.jsx`: la sub-sección "Reseñas" deja de ser
  "Próximamente" — `SeccionResenas` (fuente: `resenas_publicas()`) con
  tarjetas de vidrio, estrellas y un botón "Escribe tu reseña" que
  lleva a `/mis-resenas`.
- `MisResenasCliente.jsx` (nuevo, ruta `/mis-resenas`, ya enlazada desde
  "Tus reseñas" en el menú del avatar — ese ítem ya existía como
  placeholder): selector de estrellas + comentario, muestra el estado
  de la propia reseña (Pendiente/Publicada/No publicada) con una
  explicación corta. **Bug propio detectado y corregido antes de
  terminar esta fase**: la etiqueta "Pendiente" usaba `text-amber`, un
  token que cambia con el switch claro/oscuro global (hay un override
  `[data-tema='claro'] .text-amber` en `index.css`, C1 de una auditoría
  vieja) — en un dispositivo con preferencia clara se habría visto de
  un tono apagado en vez del dorado de la landing. Cambiado a
  `--lw-gold`, mismo criterio que todas las fases anteriores de este
  rediseño.

**Lado del POS — `ResenasWeb.jsx`** (nuevo, cuelga de `/web` como
"padre", admin-only, junto a Promociones y Pedidos Web): lista de
reseñas con badge de estado, detalle expandible (comentario completo,
fecha, botón directo de WhatsApp) y botones Aprobar/Rechazar (o "Quitar
de la Web" si ya estaba aprobada) — sin edición de contenido, el texto
lo escribe la clienta.

- Build y lint verificados. SQL aplicada y verificada en vivo (ver
  arriba) — primera fase desde Fidelización/Promociones con
  verificación real contra la base de datos, no solo a mano por el
  usuario.

### 7.5 Contacto (SQL 87 — `87_contacto_negocio.sql`) — ✅ aplicada y verificada en vivo

Elegida por decisión propia entre las pendientes (Contacto vs.
Referidos) — la más autocontenida: no dependía de definir una regla de
recompensa (eso sí lo necesita Referidos) y reutiliza casi todo lo que
ya existía.

- Investigado antes de escribir nada: **no existía en ningún lado del
  proyecto** una dirección física, teléfono ni redes sociales DEL
  NEGOCIO (solo teléfonos de clientes/asistentes individuales) — nada
  de eso se inventó. Sí existía y se reusó tal cual:
  `horario_atencion()` (74_horario_atencion.sql, de la fase de Citas
  Web, nunca consumida por ningún componente hasta ahora).
- `estado_negocio` (la fila singleton de configuración del negocio, ya
  tenía `dias_atencion`/bloques/`cuenta_transferencia` de fases
  anteriores) suma columnas nuevas, todas nullable y sin sembrar ningún
  valor: `direccion`, `telefono`, `instagram_url`, `facebook_url`,
  `tiktok_url` — las carga el admin, no vienen precargadas.
  `estado_negocio_update_admin` (política existente desde
  44_estado_negocio.sql) ya cubre las columnas nuevas sin cambios, al
  ser una policy de fila, no de columna.
- `datos_contacto()` — mismo patrón que `horario_atencion()`: expone
  dirección/teléfono/redes/`abierto` a `authenticated`, ya que
  `estado_negocio` sigue staff-only por RLS de tabla.
- Verificado en vivo suplantando la sesión de la clienta real: tanto
  `datos_contacto()` como `horario_atencion()` responden sin error.
- **`ContactoWeb.jsx`** (nuevo, cuelga de `/web` como "padre", admin-only,
  junto a Promociones/Pedidos Web/Reseñas): a diferencia de esas tres,
  `estado_negocio` es una fila singleton (id=1), no una lista — por eso
  esta pantalla es un formulario simple (dirección, teléfono, 3 links de
  redes), sin buscador ni tarjetas expandibles.
- **`NosotrosCliente.jsx`**: la sub-sección "Contacto" deja de ser
  "Próximamente" — `SeccionContacto` combina `datos_contacto()` +
  `horario_atencion()`: punto verde/rojo "Abierto ahora"/"Cerrado
  ahora", dirección, horario formateado ("Lunes a Sábado", ambos
  bloques), botón de WhatsApp y chips de redes sociales — cada línea
  solo aparece si el admin cargó ese dato; si no cargó nada todavía,
  se ve el mismo placeholder "Próximamente" de siempre en vez de una
  tarjeta vacía.
- Nota técnica: `lucide-react` (versión instalada en este proyecto) ya
  no incluye íconos de marca (`Instagram`/`Facebook`/`Tiktok` no
  existen) — los chips de redes usan un ícono genérico (`Globe`) más el
  nombre de la red como texto, en vez de fabricar un SVG de marca.
- Deliberadamente NO se agregaron contadores animados ("+X clientas",
  "+Y años") que se habían propuesto en la idea original de esta
  pestaña: son afirmaciones del negocio que requieren un número real, y
  ese número no existe en ningún lado — queda pendiente si el usuario
  quiere darlo más adelante.
- Build y lint verificados. SQL aplicada y verificada en vivo.

### 7.6 Header: logo vertical + indicador de pestaña actual

Tres pedidos puntuales sobre `PortalCliente.jsx`:

- **Logo apilado**: antes era horizontal (foto + "Jaise Beauty Academy"
  en una sola línea, clase `.nombre-marca-web`). Ahora es vertical —
  foto arriba, "Jaise" (texto mediano) debajo, "Beauty Academy" (texto
  chico, mayúsculas, gris) debajo de eso. `.nombre-marca-web` quedó sin
  ningún uso tras el cambio — se borró de `index.css` en vez de dejarla
  muerta.
- **Indicador de pestaña actual junto al logo**: mismo criterio que
  `Header.jsx` del POS — un `<span>` con `key={location.pathname}` y la
  animación ya existente `.animate-deslizar-pestana` (definida en
  `index.css`, global, no específica del POS) se desliza cada vez que
  cambia de ruta, mostrando el ícono (si es una pestaña principal) y el
  nombre de donde está el cliente — funciona igual para pestañas
  principales que para subpáginas (Mi Perfil, Carrito, etc.), a
  diferencia de la pastilla de navegación de escritorio, que solo cubre
  las principales. Separado del logo por una línea vertical sutil.
  Logo + indicador viven dentro de un mismo `<div>` (no como hijos
  sueltos del header) para que el `justify-between` de la fila los trate
  como un solo bloque a la izquierda — si no, el indicador flotaría
  suelto en el medio del header en vez de pegado al logo.
- **Se quitó la fila de "dónde estás" de abajo del header** (la que solo
  se veía en móvil, con la flecha de volver): quedaba redundante ahora
  que el mismo dato vive arriba, en el header — mismo motivo por el que
  el POS tampoco tiene una fila así. Con eso también se fue la flecha de
  volver en subpáginas de móvil; navegar de vuelta ahora es vía el logo
  (siempre lleva a `/inicio`) o el menú hamburguesa, igual que en el POS
  (que tampoco tiene botón de volver).
- Build y lint verificados.

### 7.7 Footer (`PieClienteWeb.jsx`)

A pedido del usuario: Inicio y las 4 pestañas principales de la barra
(Servicios, Productos, Citas, Nosotros) suman un pie de página — las
subpáginas de cuenta (Mi Perfil, Historial, Fidelización, Ofertas,
Carrito, Tus reseñas) NO lo llevan, tal como se pidió.

- Mismas fuentes que `SeccionContacto` (§7.5): `datos_contacto()` +
  `horario_atencion()`. Los helpers de formato (`formatearDias`,
  `formatearHora`, `numeroWhatsapp`) se sacaron de `NosotrosCliente.jsx`
  a un archivo compartido nuevo, `src/lib/contactoNegocio.js`, para que
  el footer no duplicara esa lógica.
- Comportamiento pedido explícitamente: si el admin todavía no cargó
  dirección/teléfono/redes desde `ContactoWeb.jsx`, esas líneas
  simplemente no aparecen — nada de placeholders tipo "Próximamente".
  Lo único que siempre se ve es el nombre de la marca y el "© año Jaise
  Beauty Academy" (no es un dato de negocio inventado, es estructural).
- Se agregó como último elemento DENTRO del contenedor con scroll propio
  de cada una de las 5 páginas (`InicioCliente.jsx`,
  `ServiciosCliente.jsx`, `ProductosCliente.jsx`, `CitasCliente.jsx`,
  `NosotrosCliente.jsx`) — no como un elemento compartido en
  `PortalCliente.jsx`, porque ese contenedor (`<main>`) tiene
  `overflow-hidden` a propósito (cada página maneja su propio scroll
  interno); puesto ahí, el footer habría quedado fuera del área que
  realmente se desplaza.
- Build y lint verificados.

### 7.8 Inputs de formularios sin borde en reposo

A pedido del usuario ("quita el borde de algunos campos de todas las
pestañas") — confirmado por AskUserQuestion: se refería a los inputs de
formularios (no a los chips de categoría ni a los botones, que se
quedan igual). 11 campos en 5 archivos (`CarritoCliente.jsx` —
zona/dirección de delivery, `MisResenasCliente.jsx` — comentario,
`ModalAgendarCitaCliente.jsx`/`ModalReprogramarCitaCliente.jsx` —
asistente/fecha/nota, `ModalEditarPerfilCliente.jsx` — nombre/teléfono/
dirección/cumpleaños): `border-white/15` (visible en reposo) pasó a
`border-transparent` — se mantiene la clase `border` (así el
`border-width` sigue siendo 1px, sin eso el foco dorado no se vería,
`border-color` solo no alcanza) y `focus:border-[var(--lw-gold)]` para
que el campo activo se siga marcando; solo desaparece el borde cuando
el campo NO tiene foco.
- Build y lint verificados.

### 7.9 Borde en degradado de `.liquid-glass` eliminado (toda la Web)

El usuario mandó una captura del Carrito señalando el borde que envuelve
las tarjetas "Servicios"/"Productos" y pidió sacarlo también de las
demás pestañas donde apareciera. Ese borde era el `::before` de
`.liquid-glass` (index.css) — un degradado enmascarado con la técnica
`mask-composite: exclude`, parte de la receta de vidrio original. Al ser
una clase compartida por absolutamente todas las tarjetas/paneles de
vidrio de la Web (Servicios, Productos, Carrito, Nosotros/Equipo,
Fidelización, Ofertas, Mi Perfil, los modales, la barra de navegación de
mes de Citas, etc.), alcanzó con borrar esa única regla CSS — no hubo
que tocar archivo por archivo. `.liquid-glass` se queda con el tinte +
`backdrop-filter` + brillo superior sutil (`box-shadow`), sin el borde.
- Build verificado.

### 7.10 Orden del header + pestañas del navbar sin ícono

A pedido del usuario, nuevo orden de elementos en el header (izquierda a
derecha): hamburguesa — logo (más chico) — pestañas (Inicio, Servicios,
Productos, Citas, Nosotros, sin ícono cada una) — espacio flexible —
carrito — avatar.

- **`PortalCliente.jsx`**: el botón de hamburguesa (antes al final,
  agrupado con carrito/avatar) pasa a ser el primer elemento del header;
  sigue con `lg:hidden`, así que en desktop simplemente no ocupa lugar y
  el logo queda como primer elemento visible ahí. El logo baja de tamaño
  (imagen `h-7 w-7` a `h-6 w-6`, "Jaise" `text-sm` a `text-xs`, "Beauty
  Academy" `text-[8px]` a `text-[7px]`). El `<nav>` de escritorio
  (`lg:flex`) se movió de estar centrado por `justify-between` a quedar
  pegado inmediatamente después del logo (`lg:ml-2`), tal como pidió el
  usuario, y cada pestaña perdió su ícono — solo queda el texto con el
  subrayado dorado animado. Un `<div className="flex-1" />` nuevo
  reemplaza el `justify-between` del contenedor y empuja carrito+avatar
  al extremo derecho.
- El nombre de la pestaña actual junto al logo (con la animación
  `.animate-deslizar-pestana`, agregado en la fase anterior) se
  restringió a `lg:hidden`: en escritorio el propio `<nav>` ya marca en
  dorado cuál pestaña está activa, así que mostrarlo dos veces habría
  sido redundante; en móvil/tablet (donde el `<nav>` sigue oculto, esas
  pestañas viven en el drawer) se mantiene igual que antes, con su ícono.
- Los íconos de `seccionesCliente` no se borraron de la config — los
  sigue usando el drawer móvil (`MenuLateralCliente.jsx`) y la etiqueta
  de pestaña actual junto al logo; el pedido era solo sacarlos "del
  navbar" (la barra de pestañas de escritorio), no de toda la Web.
- Build verificado.

### 7.11 Indicador de ubicación: migaja de pan debajo del header

A pedido del usuario: el indicador de pestaña actual que vivía al lado
del logo (con ícono) se sacó del header por completo. En su lugar, una
nueva fila fija justo debajo del header muestra la ubicación como una
migaja de pan: **"Inicio"** sola cuando la ruta actual es Inicio, o
**"Inicio | <pestaña o subpágina actual>"** en cualquier otra ruta — el
"|" en el dorado del tema (`--lw-gold`), sin ícono. Es otra fila `fixed`
(no `.liquid-glass`, sin caja) que flota sobre el contenido de la
pestaña (el video de Inicio u otro fondo), igual que el propio header;
"Inicio" es un link de vuelta a `/inicio` cuando no es la ruta actual.
- `PortalCliente.jsx`: nueva variable `esInicio`; el contenedor de
  contenido pasa de `pt-16 sm:pt-[72px]` a `pt-[100px] sm:pt-[112px]`
  para compensar la altura del header (64/72px) más esta nueva fila
  (36/40px), ambas fijas. Se mantiene la animación
  `.animate-deslizar-pestana` en la migaja actual al cambiar de ruta.
- Build verificado.

### 7.12 Migaja de pan: separada del header, sin fondo

Ajuste al indicador de §7.11: el usuario aclaró que no debía "pertenecer"
al header — debía ser un elemento propio, separado, flotando debajo de
él con fondo transparente (no una segunda fila pegada a su borde).
- Antes tocaba el borde inferior del header (`top-16`/`top-[72px]`, sin
  espacio). Ahora hay una separación real: `top-[76px]` móvil /
  `top-[88px]` desde `sm:` (12/16px de aire respecto al header), sin
  clase de altura fija (antes `h-9 sm:h-10`) — el alto lo da el propio
  padding vertical del texto (`py-1 sm:py-1.5`), no una caja.
- Ya no tenía fondo antes tampoco, pero de paso: el contenedor exterior
  (`fixed inset-x-0`, ancho completo) pasa a `pointer-events-none` y solo
  el `<nav>` de adentro (ancho real del texto) es `pointer-events-auto`
  — al ser puro texto flotando sin caja, el espacio vacío a la derecha de
  la migaja ya no bloquea clics sobre lo que hay detrás.
- `pt-[104px] sm:pt-[120px]` en el contenedor de contenido (antes
  `pt-[100px] sm:pt-[112px]`) compensa el nuevo espacio total (header +
  separación + migaja).
- Build verificado.

### 7.13 Ícono "chanchito" en el header (base para el sistema de puntos)

A pedido del usuario, que trajo una referencia animada de una alcancía
("Chanchito de puntos"): se agregó un ícono `PiggyBank` (lucide-react) en
el header, a la izquierda del carrito — todavía sin sistema de puntos
real detrás (eso es un sistema distinto de los sellos de Fidelización
existentes, §2.5), así que por ahora es un placeholder quieto (no
navega, no recibe datos), un poco más apagado que el carrito
(`text-white/50` vs `text-white/80`) para no aparentar que ya hace algo.

- **`PortalCliente.jsx`**: nuevo `BotonChanchito`, mismo patrón visual
  que `BotonCarrito` pero sin `Link` (no hay ruta todavía) — un
  `<button>` inerte con `title`/`aria-label` "Tus puntos (próximamente)".
- **`index.css`**: se portaron TODAS las animaciones de la referencia
  del usuario (a pedido explícito, "manteniendo todos sus efectos y
  animaciones"), renombradas con prefijo `chanchito-` para no chocar con
  nada existente: `chanchito-rebote` (bump al sumar puntos),
  `chanchito-estallido` + `chanchito-pulso` (brillo/pulso cuando se llena
  la alcancía), `chanchito-moneda-cae` (moneda cayendo),
  `chanchito-mas-sube` ("+N" flotante), `chanchito-titilar` (destellos) y
  `chanchito-fantasma-pop` (eco al saltar de tamaño). Solo
  `.icono-chanchito` (reposo) se usa hoy en el ícono del header; el
  resto queda listo en CSS para el día que exista una pantalla propia de
  puntos con la alcancía a tamaño grande (mismo espíritu que la
  referencia, que traía además botones de simulación +1/+5/+10/canjear
  que el usuario pidió explícitamente ignorar — no se construyeron).
- **Pendiente, no resuelto en esta fase** (el usuario mencionó que se
  puede "empezar a estructurar" el sistema de puntos, pero no dio
  reglas de negocio todavía): cómo se ganan puntos, cuántos, qué se
  canjea y con qué RPC/tabla — análogo a como se manejó Fidelización
  (§2.5) y Referidos (§2.8), requiere decisiones del negocio antes de
  construir el backend.
- Build verificado.

### 7.14 Ícono del carrito unificado con el POS

A pedido del usuario: el botón de carrito del header (`BotonCarrito`,
`PortalCliente.jsx`) pasó de `ShoppingBag` a `ShoppingCart` — el mismo
ícono que usa la pestaña "Ventas" del POS (`navegacion.js`), para que el
concepto de "carrito" se vea igual en ambos lados del sistema. Los demás
usos de `ShoppingBag` en la Web (encabezado de la sección "Productos"
dentro de Carrito, chip de "producto" en las tarjetas de Servicios/
Productos, ícono de Pedidos Web) no cambiaron — representan "producto",
no el carrito en sí.
- Build verificado.

### 7.15 Sistema de puntos y niveles de tarjeta (SQL 88 — `88_puntos.sql`) — ✅ aplicada y verificada en vivo

A pedido del usuario, que trajo una segunda referencia animada ("Niveles
de Tarjeta Rewards"): el chanchito del header (§7.13) ahora abre una
subpágina nueva **"Mis puntos"** (`/mis-puntos`, fuera de la barra
principal, mismo patrón que Carrito/Mis reseñas) con una tarjeta 3D que
sube de nivel automáticamente — **Básico → Premium → VIP** — según
puntos que el cliente va acumulando. Todo cliente nuevo empieza en
Básico (no hace falta ninguna fila por cliente para eso: "Básico" es
simplemente "menos que el umbral de Premium").

**Decisiones confirmadas por el usuario** (AskUserQuestion):
- **Fuente de puntos**: AMBAS cosas suman — visitas completadas Y monto
  gastado — pero las cantidades exactas de cada una "aun esta por
  definir". Por eso los dos multiplicadores (`puntos_por_visita`,
  `puntos_por_sol_gastado`) viven en una tabla de configuración editable
  (`config_puntos`, panel nuevo "Puntos Web" en el POS) en vez de
  hardcodeados en la función — mismo criterio que `zonas_delivery`
  (§7.3): el negocio los puede ajustar después sin un despliegue nuevo.
  Valores por defecto (provisionales, editables): 1 punto por visita,
  0.05 puntos por sol gastado (≈ 1 punto cada S/20).
- **Umbrales de nivel**: 10 puntos → Premium, 30 puntos → VIP (también
  editables desde el mismo panel).

**SQL (`88_puntos.sql`):**
- `config_puntos` — fila única (`id = 1`, con `check`), mismo patrón que
  `estado_negocio` (singleton). Lectura abierta a cualquier autenticado
  (el cliente necesita ver los umbrales para su propia tarjeta),
  escritura admin-only (`es_admin()`).
- `mis_puntos()` (security definer): calcula `visitas` y `gastado` con
  la MISMA fuente que `mi_fidelizacion()` (78_fidelizacion_web.sql) —
  `count(distinct fecha)` / `sum(precio)` en `registro_servicios` del
  cliente, activo, vía `mi_cliente_id()` — no se creó ninguna bitácora
  nueva. Devuelve `puntos` (fórmula con los multiplicadores vigentes),
  `nivel` (BASICO/PREMIUM/VIP según los umbrales vigentes) y
  `puntos_para_siguiente`. Los pedidos de productos (`pedidos_web`)
  todavía NO suman a "gastado" — queda documentado acá como posible
  ampliación futura, no se construyó en esta fase.
- Verificado en vivo suplantando sesión: cliente sin visitas → 0 puntos,
  BASICO, faltan 10; cálculo a mano con un cliente real de 3 visitas/S/195
  gastado → 12 puntos (PREMIUM), coincide con la fórmula.

**Frontend:**
- `TarjetaPuntos.jsx` (nuevo, `src/components/`) — recreación de la
  referencia animada: tarjeta 3D que gira 360° al arrastrar (física con
  inercia/retorno automático), flotación idle vía `requestAnimationFrame`,
  brillo/destello (glare + sheen) que siguen la rotación, flip a la cara
  de atrás, conteo de puntos animado (ease cúbico) y barra de progreso.
  Todo el "lienzo" se dibuja a tamaño de diseño fijo (1160×800, igual que
  la referencia) y se escala con `ResizeObserver` para caber en su
  contenedor — a diferencia de la referencia (que llenaba toda la
  ventana), acá vive dentro de una subpágina normal. **Diferencia
  deliberada con la demo**: no hay selector manual de nivel (Plata/
  Diamante/Oro) — ahí era solo para previsualizar los 3 estados; un
  cliente real siempre ve SU nivel calculado en el servidor, nunca lo
  elige. Tampoco se copió el número de tarjeta/CVV falsos de la
  referencia (mimetismo de tarjeta bancaria que no aplica acá y sería
  dato inventado) — en su lugar, la esquina inferior derecha muestra
  cuánto falta para el siguiente nivel (dato real) y la izquierda el
  nombre real del cliente (`perfil.nombre`, vacío si no lo cargó
  todavía).
- `MisPuntosCliente.jsx` (nuevo, ruta `/mis-puntos`) — llama a
  `mis_puntos()`, arma el nivel/progreso y le pasa todo a
  `TarjetaPuntos`. Sin footer (es una subpágina de cuenta, mismo criterio
  que Carrito/Mi Perfil — ver §7.7).
- `PortalCliente.jsx`: `BotonChanchito` deja de ser un placeholder inerte
  — ahora es un `Link` a `/mis-puntos`, mismo estilo/opacidad que
  `BotonCarrito`.
- `navegacionCliente.js`: nueva entrada en `titulosSubpaginasCliente`
  para la migaja de pan (§7.11/§7.12).

**Lado del POS — `PuntosWeb.jsx`** (nuevo, cuelga de `/web` como
"padre", admin-only, junto a Contacto Web): formulario simple (mismo
patrón que `ContactoWeb.jsx` — fila singleton, sin buscador ni tarjetas)
para editar los 2 multiplicadores y los 2 umbrales de nivel.

- Build y lint verificados. SQL aplicada y verificada en vivo (MCP
  conectado al proyecto correcto).

### 7.16 Puntos manuales/de cortesía (SQL 89 — `89_puntos_bono.sql`) — ✅ aplicada y verificada en vivo

A pedido del usuario, para ver la tarjeta Premium funcionando sin
depender de visitas/gasto real todavía inexistentes ("dale 10 puntos por
ahora solo para ver el funcionamiento de la segunda tarjeta"): en vez de
insertar una visita o venta falsa en `registro_servicios` (eso habría
ensuciado Historial/Fidelización con datos inventados de esa clienta),
se agregó `clientes.puntos_bono` (entero, default 0) que `mis_puntos()`
suma tal cual al total calculado — no es solo un hack de prueba, sirve
como mecanismo real a futuro (ej. puntos de cortesía por un reclamo).
- El único cliente Web real del proyecto (Turqui) quedó con
  `puntos_bono = 10` → nivel PREMIUM, verificado en vivo suplantando su
  sesión (`puntos: 10, nivel: "PREMIUM", puntos_para_siguiente: 20`).
  Reversible en cualquier momento con un simple `update`.
- Sin UI todavía para editar este campo desde el POS (no se pidió) — hoy
  se ajusta por SQL directo si hace falta cambiarlo.

### 7.17 Direcciones del cliente (SQL 90 — `90_direcciones_cliente.sql`) — ✅ aplicada y verificada en vivo

A pedido del usuario: "Direcciones" (placeholder del menú del avatar
desde §7 en adelante, sin fase asignada) pasa a ser una pantalla real —
el cliente guarda varias direcciones de delivery y elige cuál usar en
cada compra desde el Carrito, con CRUD completo por tarjeta de
dirección.

**SQL:**
- `direcciones_cliente (id, cliente_web_id, etiqueta, direccion,
  referencia, predeterminada, creado_en)` — llave por `cliente_web_id =
  auth.uid()` directo (dato de LOGIN, mismo criterio que
  `favoritos_servicios`/`carrito_productos`), no por `cliente_id`: el
  personal no necesita verla, `pedidos_web` ya congela la dirección
  elegida como texto al confirmar un pedido. CRUD directo desde el
  frontend (sin RPC dedicada) — no hay validación de negocio más allá de
  RLS.
- Trigger `unicidad_direccion_predeterminada()`: al marcar una dirección
  como predeterminada, apaga esa marca en las demás filas del mismo
  cliente — así el frontend nunca tiene que coordinar a mano "solo una
  puede estar marcada". Verificado en vivo suplantando sesión: insertar
  dos direcciones predeterminadas seguidas deja únicamente la última en
  `true`.

**Frontend:**
- `DireccionesCliente.jsx` (nuevo, ruta `/direcciones`, entra desde el
  menú del avatar) — tarjetas de vidrio, una por dirección, cada una con
  Editar/Eliminar (con confirmación, mismo patrón que "Cerrar sesión" de
  `MenuUsuarioCliente.jsx`) y "Usar como predeterminada" si no lo es ya;
  insignia dorada en la que sí lo es. Botón "Agregar" abre el mismo modal
  en modo creación.
- `ModalDireccionCliente.jsx` (nuevo) — formulario crear/editar
  (etiqueta, dirección, referencia opcional, checkbox predeterminada),
  mismo patrón que el resto de modales de cliente (`useModalA11y` +
  `useCerrarConEscape`, sin bordes en reposo en los inputs — ver §7.8).
- `CarritoCliente.jsx`: el campo de dirección de delivery deja de ser
  texto libre precargado desde `clientes.direccion` (Mi Perfil) — ahora
  es un `<select>` de direcciones guardadas (predeterminada primero),
  con un link "Gestionar" a `/direcciones`; si no hay ninguna guardada,
  muestra un botón "Agregar una dirección" en su lugar y bloquea
  "Confirmar compra" hasta que exista al menos una. La dirección elegida
  se sigue mandando como texto plano a `confirmar_pedido_productos()`
  (sin cambios en esa función) — se arma `direccion + " - " + referencia`
  si tiene referencia cargada. `clientes.direccion` (Mi Perfil) no se
  tocó ni se eliminó — queda como dato de contacto general, ya no es la
  fuente del delivery.
- `MenuUsuarioCliente.jsx`: "Direcciones" gana `ruta: '/direcciones'`
  (dejó de ser un placeholder "Próximamente").
- Build y lint verificados. SQL aplicada y verificada en vivo.

### 7.18 Dirección deja de ser un dato de perfil (SQL 91 — `91_direcciones_cliente_admin.sql`)

El usuario notó una inconsistencia real: como admin en Clientes (POS)
solo veía la única `clientes.direccion` que el cliente cargaba en Mi
Perfil — pero desde que existe la pestaña Direcciones (§7.17), un
cliente Web puede guardar varias, y el admin no podía ver ninguna de
esas (la tabla solo tenía policy de lectura para el propio dueño).
Conclusión acordada con el usuario: la dirección deja de ser "un dato
del perfil" para un cliente Web — vive en la pestaña Direcciones, y el
admin debe poder VER (nunca editar — sigue siendo dato del cliente)
todas las que tenga guardadas.

- **`direcciones_cliente_select_admin`** (nueva policy) — lectura
  admin-only (`es_admin()`) sobre `direcciones_cliente`, además de la
  que ya tenía el propio dueño. Solo lectura: el admin nunca crea,
  edita ni borra direcciones de un cliente.
- **`ModalEditarPerfilCliente.jsx`**: se quitó el campo "Dirección" de
  Mi Perfil — ya no tiene sentido pedir UNA dirección ahí cuando el
  cliente maneja varias en su propia pestaña. Se agregó un botón "Mis
  direcciones" en `MiPerfil.jsx` (junto a "Editar") que lleva a
  `/direcciones`.
- **Fix necesario, no opcional**: `vincular_o_crear_cliente_web()`
  hacía `direccion = p_direccion` sin `coalesce` en la rama de
  actualización — al dejar de mandarse ese campo desde el formulario,
  CADA guardado de perfil (nombre, teléfono o cumpleaños) habría puesto
  `direccion = null` y borrado en silencio cualquier valor cargado antes
  de este cambio. Se cambió a `coalesce(p_direccion, c.direccion)`,
  igual que ya hacía la rama de "vincular a un candidato existente" un
  poco más abajo en la misma función — inconsistencia que ya existía
  entre las dos ramas, corregida de paso.
- **`Clientes.jsx`** (admin): `SELECT_CLIENTES` ahora embebe
  `clientes_web(email, direcciones_cliente(...))` — la FK real de
  `direcciones_cliente` es contra `clientes_web`, no contra `clientes`,
  por eso va anidada ahí. En el detalle de cada tarjeta: si el cliente
  tiene una o más direcciones guardadas en la Web, se listan todas
  (etiqueta + dirección, ★ en la predeterminada); si no (clientes
  cargados a mano por el personal, sin cuenta Web — para ellos
  `clientes.direccion` sigue siendo el único lugar donde registrar una),
  se sigue mostrando la columna `direccion` de siempre. La barra de
  "datos completos" ahora cuenta "tiene dirección" como
  `direccion` O al menos una fila en `direcciones_cliente`, no solo la
  columna vieja.
- `clientes.direccion` (la columna) NO se eliminó — sigue siendo la
  única dirección posible para un cliente sin cuenta Web (sin login, sin
  acceso a la pestaña Direcciones).
- Build y lint verificados. SQL aplicada y verificada en vivo (policy
  confirmada en `pg_policies`).

### 7.19 Fix: la migaja de ubicación se veía con fondo negro propio

El usuario mandó una captura: la migaja de ubicación ("Inicio") se veía
con una franja negra propia debajo del header, en vez de flotar
transparente sobre el video de Inicio. Causa raíz — la misma familia de
bug que ya se había resuelto para el header en su momento (§6, "Header
flotante de verdad translúcido"): en §7.12 el contenedor de contenido
había pasado a `pt-[104px] sm:pt-[120px]` para reservarle espacio propio
a la migaja, así que en esa franja (entre el header y donde arrancaba de
verdad el video) no pasaba nada por detrás — ahí cualquier elemento
flotante y transparente (header incluido) se ve como si tuviera fondo
sólido, porque no hay contenido real que desenfocar/mostrar detrás.

- **Fix**: el contenedor de contenido vuelve a `pt-16 sm:pt-[72px]`
  (compensa SOLO el alto del header, como antes de §7.11) — el contenido
  de cada pestaña (el video de Inicio incluido) arranca justo debajo del
  header, sin ningún hueco reservado.
- La migaja pasa a `top-20 sm:top-24` (una franja fija, `z-40`, por
  debajo del header `z-50` pero por encima del contenido/video, que no
  declara z-index propio) — ahora flota DIRECTO sobre el video real, que
  ya está ahí desde el primer frame, en vez de sobre una franja vacía.
  Sigue sin pertenecer al `<header>` (elemento `fixed` propio, sin fondo)
  y sigue siendo `pointer-events-none` por fuera del texto/link.
- Build verificado.

### 7.20 Mi Perfil: edición in-place, sin modal aparte

A pedido del usuario, rediseño completo de Mi Perfil (`MiPerfil.jsx`) —
se eliminó `ModalEditarPerfilCliente.jsx` (ya no se usa desde ningún
lado) y toda su lógica de guardado se movió directo a esta página:

- **Layout**: la foto ya no está centrada arriba — ahora el nombre va al
  lado derecho de la foto, y el correo debajo del nombre (antes el
  correo vivía suelto bajo el círculo de avatar). Se quitó el saludo
  "Hola, {nombre}" — ahora solo se muestra el nombre completo (o
  "Completa tu perfil" si todavía no lo cargó).
- **Edición in-place**: "Editar" ya NO abre un modal — los campos
  (nombre, teléfono, cumpleaños) se vuelven inputs editables en el mismo
  lugar donde se mostraban como texto (`CampoPerfil`, nuevo componente
  local que alterna entre las dos vistas según `editando`). Los botones
  cambian a "Cancelar"/"Guardar" mientras se edita.
- **Foto**: ya no hay botones separados "Galería"/"Cámara" con el modal
  `ModalCamara.jsx` — ahora es un ícono de lápiz dorado sobre la esquina
  superior derecha del avatar que dispara un `<input type="file">`
  nativo oculto directamente (sin cámara propia del proyecto de por
  medio): en PC abre el explorador de archivos, en celular el selector
  del sistema operativo (que ya ofrece "Cámara" como una opción más ahí
  mismo). El resto de la lógica de subida (procesar/redimensionar,
  subir al bucket, `actualizar_mi_foto_cliente()`) no cambió.
- **Mensaje de privacidad** (nuevo): entre los datos y los botones, en
  verde y texto más chico (`text-xs text-green`), con ícono de candado —
  "Jaise protege su información personal y la mantiene privada y
  segura." Se oculta mientras se está editando (solo se ve en modo
  lectura, junto a los botones Editar/Mis direcciones).
- **Esquinas rectas**: las dos tarjetas de esta pantalla (foto+nombre,
  datos) pasaron de `rounded-2xl` a `rounded-none` — cambio acotado a
  Mi Perfil, no a `.liquid-glass` en general (esa clase compartida sigue
  sin `border-radius` propio en `index.css`; el redondeo siempre lo puso
  cada pantalla con su propia clase de Tailwind). Los botones se quedan
  `rounded-full`, como pidió el usuario.
- El diálogo de "¿Es tu registro?" (vincular a un cliente ya cargado por
  el mismo teléfono) se mantiene como overlay — es una decisión puntual
  y poco frecuente, no un campo del formulario — ahora vive en
  `MiPerfil.jsx` en vez del modal eliminado.
- Build y lint verificados.

### 7.21 Títulos grandes eliminados de todas las pestañas de la Web

A pedido del usuario: de ahora en más, ninguna pestaña de la Web repite
su propio nombre en grande arriba del contenido — la migaja de ubicación
debajo del header (§7.11/§7.12/§7.19) ya cumple esa función para
cualquier pestaña nueva o existente. Se quitó el `<h1>` con el nombre de
la pestaña de las 11 pantallas que lo tenían: `ServiciosCliente.jsx`,
`ProductosCliente.jsx`, `CitasCliente.jsx` (el botón "Agendar" que
compartía la fila con el título pasó a `justify-end` solo), `Historial
Cliente.jsx`, `FidelizacionCliente.jsx`, `OfertasCliente.jsx`,
`NosotrosCliente.jsx` (se quedó su bajada "Conoce al salón por dentro"),
`CarritoCliente.jsx`, `MisResenasCliente.jsx`, `MisPuntosCliente.jsx`,
`DireccionesCliente.jsx` (mismo caso que Citas: el botón "Agregar" pasó
a `justify-end` solo).

**No se tocaron a propósito**: el titular de Inicio (`InicioCliente.jsx`,
"Tu belleza, nuestra pasión.") — es copy de marketing del hero, no un
nombre de pestaña repetido; y `MiPerfil.jsx` — ahí el nombre grande es el
del propio cliente (dato personal), no el título "Mi Perfil".
- Build y lint verificados.

### 7.22 Direcciones anidada bajo Mi Perfil (ruta + migaja de 3 niveles)

A pedido del usuario: Direcciones son datos DEL cliente (se editan/
consultan desde Mi Perfil, que además ya tiene su propio botón "Mis
direcciones" a esa misma pantalla, §7.18) — no debía ser una ruta suelta
al mismo nivel que Mi Perfil. Cambios:

- **Ruta**: `/direcciones` → `/mi-perfil/direcciones` (`App.jsx`). Se
  actualizaron los 4 lugares que enlazaban ahí: `MenuUsuarioCliente.jsx`
  (opción "Direcciones" del avatar), `MiPerfil.jsx` (botón "Mis
  direcciones") y los dos links de `CarritoCliente.jsx` ("Gestionar" y
  "Agregar una dirección" en el bloque de delivery).
- **Migaja de varios niveles** (`PortalCliente.jsx`): la migaja ya no
  busca un solo título para la ruta actual — `migajasDeRuta()` parte la
  ruta por segmentos (`/mi-perfil/direcciones` →
  `['/mi-perfil', '/mi-perfil/direcciones']`) y arma una migaja por cada
  prefijo que tenga título declarado en `seccionesCliente`/
  `titulosSubpaginasCliente`. Con `/mi-perfil` ya declarado como "Mi
  Perfil", entrar a Direcciones pinta sola **"Inicio | Mi Perfil |
  Direcciones"**, con "Mi Perfil" como link real (clickeable, lleva de
  vuelta ahí) — sin necesitar una tabla de "padres" aparte ni tocar este
  archivo cada vez que se agregue una subpágina anidada nueva en el
  futuro: alcanza con que su ruta tenga el prefijo correcto y ese prefijo
  ya tenga título en alguna de las dos listas.
- El resto de subpáginas (Historial, Fidelización, Ofertas, Carrito, Tus
  reseñas, Mis puntos) no cambiaron — siguen siendo rutas de un solo
  nivel bajo Inicio, se acceden directo del menú del avatar o del header,
  no están anidadas bajo Mi Perfil.
- Build y lint verificados. Sin cambios de SQL (la tabla
  `direcciones_cliente` no sabe nada de rutas del frontend).

### 7.23 Direcciones: ícono, celular de entrega, sin guía, esquinas rectas

Cuatro cambios pedidos por el usuario sobre la pestaña Direcciones, más
uno de alcance explícitamente extendido a toda la Web:

1. **Ícono de ubicación** junto a la dirección de cada tarjeta (antes
   solo texto plano) — `MapPin` chico y apagado (`text-white/40`), mismo
   tratamiento visual que ya usaba el bloque de Contacto en Nosotros.
2. **Celular de contacto por dirección** (SQL 92 —
   `92_direcciones_celular.sql`, aplicada y verificada en vivo):
   - `direcciones_cliente.celular` (nueva columna) — a propósito
     DISTINTO del teléfono de Mi Perfil: el cliente puede poner un
     número diferente por dirección (ej. alguien más recibe en casa de
     los padres). `ModalDireccionCliente.jsx` lo precarga con
     `perfil.telefono` SOLO al crear una dirección nueva (nunca pisa el
     valor ya guardado de una que se está editando).
   - Se "congela" en el pedido al confirmar la compra, mismo criterio
     que `direccion_entrega`: `pedidos_web.celular_entrega` (columna
     nueva) + `confirmar_pedido_productos()` con el parámetro nuevo
     `p_celular_entrega`. `CarritoCliente.jsx` lo manda desde la
     dirección elegida.
   - `PedidosWeb.jsx` (POS): muestra el celular de entrega en el
     detalle del pedido y suma un botón propio "WhatsApp al celular de
     entrega" (aparte del que ya existía al teléfono de la cuenta) — el
     personal puede necesitar llamar a quien recibe, no a quien compró.
3. **Se quitó el mensaje de guía** ("Guarda las direcciones que más
   usas...") de `DireccionesCliente.jsx`.
4. **Esquinas rectas en las tarjetas contenedoras** — a pedido explícito
   extendido a "otras pestañas que tengan bordes redondeados": todas las
   tarjetas `.liquid-glass` de contenido (paneles, tarjetas de lista,
   mensajes, formularios, estados vacíos) en TODA la Web pasaron de
   `rounded-2xl`/`rounded-3xl`/`rounded-lg` a `rounded-none` —
   Direcciones, Carrito, Citas, Historial, Fidelización, Mis puntos,
   Mis reseñas, Ofertas, Nosotros (tarjetas de equipo/reseñas/contacto/
   estados vacíos) e Inicio (tarjeta de texto sobre video, tarjetas de
   "Qué hacemos"). Quedaron con su redondeo intacto, a propósito:
   - Botones, píldoras, chips y insignias (`rounded-full`) — regla ya
     establecida en Mi Perfil, §7.20.
   - Las dos barras de búsqueda (Servicios/Productos, `rounded-2xl`) —
     son un control de formulario, no una tarjeta de contenido, mismo
     criterio que los `<input>` (nunca se les tocó el redondeo, solo el
     borde en reposo, §7.8).
   - Las tarjetas iridiscentes del catálogo (`.iri-card`, CSS con
     `border-radius: 14px` propio) — sistema visual aparte, replicado de
     una referencia de diseño distinta (headerYServicios.html, ver §5
     roadmap), no `.liquid-glass`.
   - Los paneles de los modales (`.lw-bar`, ej. confirmar eliminar
     dirección, agendar/reprogramar cita) — son diálogos, no tarjetas de
     contenido de una pantalla.
   - La tarjeta de puntos (`TarjetaPuntos.jsx`, `border-radius: 44px`
     propio) — su identidad visual completa es imitar una tarjeta física
     de verdad, a propósito (§7.15).
- Build y lint verificados. SQL aplicada y verificada en vivo (columnas
  confirmadas en `information_schema.columns`).

### 7.24 Notificaciones — bandeja in-app (SQL 93 — `93_notificaciones.sql`) — ✅ aplicada y verificada en vivo

A pedido del usuario, tras evaluar dos caminos (push real al celular vs.
bandeja dentro de la app): confirmó ir por la bandeja in-app, porque
push de verdad no es "de pago" en sí mismo (Web Push es un estándar
gratuito — VAPID, Firebase/Chrome, Apple desde iOS 16.4+ para PWA
agregada a inicio, todos gratis) pero SÍ requiere infraestructura nueva
que hoy no existe: suscripción del navegador por dispositivo + un
backend que dispare cada evento (lo pago suele ser un servicio de
terceros como OneSignal para no montar eso a mano, o SMS/WhatsApp API si
se usara ese canal en vez de push). La bandeja in-app no necesita nada
de eso: se lee al entrar a la pantalla, dentro de la sesión ya
autenticada.

**Decisión de alcance (no fabricar eventos)**: la bandeja se llena SOLO
con eventos reales vía triggers de Postgres, nunca insertada desde el
frontend. Fase 1 — solo eventos que son un cambio de columna claro y
siempre iniciado por el personal (nunca ambiguo si fue el cliente o el
negocio):
- Pedido de productos cambia de estado (Pendiente→Listo/Entregado/
  Cancelado) — siempre admin, `pedidos_web` es admin-only para UPDATE.
- Reseña moderada (Aprobada/Rechazada) — siempre admin.
- Cita cancelada POR EL NEGOCIO (no por la propia clienta) — el trigger
  distingue el actor con `rol_actual()` (no nulo = tiene fila en
  `usuarios`, es personal); `cancelar_mi_cita_web()` la ejecuta la propia
  clienta (sin fila en `usuarios`), así que esa vía nunca notifica.
  Verificado en vivo suplantando ambas sesiones: cancelación de admin →
  1 notificación; cancelación de la propia clienta → 0.

**Deliberadamente fuera de esta fase** (documentado para no perder la
idea): recordatorio de cita próxima (necesita un cron/scheduled job, no
un trigger — no existe todavía en el proyecto) y "subiste de nivel de
puntos" (el nivel de `mis_puntos()` se calcula al vuelo, no es una
columna que cambie sola — detectarlo bien requeriría comparar antes/
después ante cualquiera de sus 3 causas posibles: nueva visita, nuevo
gasto, o el admin cambiando los umbrales para todos a la vez).

**SQL:**
- `notificaciones (id, cliente_id, tipo, titulo, mensaje, ruta, leida,
  creado_en)` — sin INSERT/DELETE otorgado a `authenticated`: la única
  puerta de entrada son los 3 triggers (`security definer`, se saltan
  RLS). El cliente solo puede `select`/`update` (marcar leída) sus
  propias filas.
- `notificar_cambio_pedido_web()`, `notificar_cambio_resena()`,
  `notificar_cita_cancelada_staff()` — un trigger `after update of
  estado` por tabla fuente.
- Verificado en vivo con la cuenta real (Turqui) las 3 rutas: pedido →
  "Tu pedido está listo"; reseña → "Tu reseña fue publicada"
  (`ruta: '/mis-resenas'`); cita cancelada por admin → "Tu cita fue
  cancelada" (`ruta: '/citas'`), todo dentro de transacciones con
  `rollback` (sin dejar datos de prueba).

**Frontend:**
- `NotificacionesClienteContext.jsx` (nuevo) — mismo patrón que
  `CarritoClienteContext`: un solo fetch del conteo de no leídas,
  compartido por el punto dorado del avatar y el número junto a
  "Notificaciones" en el menú, sin que cada uno pida por separado.
- `NotificacionesCliente.jsx` (nuevo, ruta `/mi-perfil/notificaciones` —
  anidada bajo Mi Perfil, mismo criterio que Direcciones, §7.22: es
  información DE LA CUENTA, la migaja pinta "Inicio | Mi Perfil |
  Notificaciones" sola). Lista de tarjetas (esquinas rectas, §7.23), ícono
  por tipo (pedido/reseña/cita), punto dorado + anillo en las no leídas,
  "Marcar todas como leídas". Tocar una la marca leída y navega a su
  `ruta` si tiene (ej. una reseña rechazada lleva directo a "Tus
  reseñas" para corregirla).
- `MenuUsuarioCliente.jsx`: "Notificaciones" gana `ruta`; insignia
  numérica junto a su label en el menú + un punto dorado sobre el propio
  avatar (visible sin abrir el menú) cuando hay no leídas.
- Build y lint verificados.

### 7.25 Seguridad de la cuenta: cambiar contraseña

Última opción pendiente del menú del avatar — "Seguridad de la cuenta"
ahora tiene pantalla real (`SeguridadCuentaCliente.jsx`, ruta
`/mi-perfil/seguridad`, anidada bajo Mi Perfil como Direcciones/
Notificaciones). Cambia la contraseña de la cuenta de Supabase Auth con
la que el cliente inició sesión — es la única contraseña que existe,
no hay una "de negocio" aparte. Usa `supabase.auth.updateUser({
password })` directo: no pide la contraseña actual porque esa función
solo exige una sesión activa y válida (ya la tiene, por estar dentro del
portal) — mismo comportamiento estándar de Supabase Auth con sesión
iniciada, no una omisión de seguridad.
- Formulario simple: nueva contraseña + confirmar (mínimo 6 caracteres,
  el mínimo que exige Supabase Auth por defecto), validación en cliente
  antes de llamar a `updateUser`.
- Con esto, TODAS las opciones del menú del avatar tienen pantalla real
  — no queda ningún placeholder "Próximamente" en `MenuUsuarioCliente.jsx`.
- Build y lint verificados. Sin cambios de SQL (Supabase Auth resuelve
  todo, no hay tabla propia).

### 7.26 Referidos (SQL 94 — `94_referidos.sql`) — ✅ aplicada y verificada en vivo

Último apartado grande del roadmap original (§2.8) — construido tras
revisar datos reales del propio negocio en el POS (no datos de prueba:
se comparó contra `05_datos_prueba.sql`, que tiene un catálogo
completamente distinto de bodega genérica, para confirmarlo):

- **Servicios**: ticket promedio de línea ~S/55.38 (47 registros,
  últimas 4 semanas); los más pedidos son uñas (Pedicure/Rubber/Soff
  Gel/Acrílicas, S/60-75).
- **Productos**: ticket promedio de venta ~S/38.99 (97 ventas, ~2
  meses); el producto más vendido es la Mascarilla de tela Niacinamida
  (S/5 precio, S/1.60 costo, 25 unidades).

**Reglas confirmadas por el usuario** (AskUserQuestion, 3 preguntas):
- **Moneda**: descuento en soles (no puntos, no producto gratis).
- **Cuándo se libera**: solo cuando el referido completa su primera
  visita o compra REAL — nunca al solo registrarse (evita cuentas
  falsas creadas solo para ganar el crédito).
- **Quién gana**: ambos lados — quien invita y quien se registra.
- **Montos** (editables después desde "Referidos Web" en el POS, mismo
  criterio que `config_puntos` — todavía no son definitivos): **S/15**
  para quien invita, **S/10** para quien se registra.
- **Aplicación del crédito**: manual, mismo patrón NO automatizado que
  ya usa la recompensa de Fidelización desde que se construyó ("Ver
  recompensas disponibles" solo, sin canje automático en `Ventas.jsx`)
  — el cliente lo menciona en caja, el cajero lo aplica con el
  descuento manual que `Ventas.jsx` ya tiene.

**SQL:**
- `config_referidos` — fila única (id=1), mismo patrón singleton que
  `config_puntos`/`estado_negocio`.
- `clientes` gana 4 columnas: `codigo_referido` (único, se genera solo
  la primera vez que se pide), `referido_por`, `recompensa_referido_
  aplicada` (evita otorgar el premio dos veces), `credito_referido`
  (saldo acumulado). Sin grant directo a `authenticated` — como toda
  `clientes`, staff-only; el cliente accede vía RPCs.
- `mi_codigo_referido()` / `aplicar_codigo_referido(codigo)` /
  `mi_estado_referidos()` — el código propio, ingresar el de alguien
  más (bloquea código propio, doble registro, y a cualquiera que ya
  tenga una visita activa registrada) y el estado combinado (código,
  crédito, si ya usó uno, cuántos refirió).
- `recompensar_referido_si_corresponde()` + 2 triggers (`after insert`
  en `registro_servicios`, `after update of estado` en `pedidos_web`
  cuando pasa a `ENTREGADO`) — lo que ocurra primero en la vida del
  referido dispara el crédito para ambos y una notificación para cada
  uno (reutiliza el sistema de §7.24, tipo `'REFERIDO'`).
- Verificado en vivo: `mi_estado_referidos()` con la cuenta real
  (Turqui) generó su código real; auto-referido bloqueado
  ("No puedes usar tu propio código"); simulación completa con dos
  clientes de prueba (referente + referido, insertados y revertidos en
  una transacción con `rollback`) confirmó el otorgamiento correcto de
  S/15/S/10 y las 2 notificaciones, ambas exactas a los montos vigentes.

**Frontend:**
- `ReferidosCliente.jsx` (nuevo, ruta `/mi-perfil/referidos`, anidada
  bajo Mi Perfil) — código propio con copiar/compartir por WhatsApp,
  crédito disponible, cuántas personas invitó, y un formulario para
  ingresar un código ajeno (oculto si ya usó uno).
- `MenuUsuarioCliente.jsx`: nueva opción "Referidos".
- **`ReferidosWeb.jsx`** (nuevo, admin, cuelga de `/web`): formulario
  para editar los 2 montos + lista de quién refirió a quién con su
  crédito y si ya completó su primera visita.
- Build y lint verificados. SQL aplicada y verificada en vivo.

### 7.27 Referidos v2: cupones de un solo uso (SQL 95 — `95_cupones_referido.sql`) — ✅ aplicada y verificada en vivo

El usuario, al revisar el flujo de §7.26, notó el hueco real que tenía:
un "crédito neto" que se acumulaba solo, sin ningún botón en Ventas para
aplicarlo NI forma de que el sistema supiera cuándo se gastó — quedaba
como un número que crecía para siempre. Propuso un rediseño completo,
implementado tal cual (se reemplaza §7.26 por completo, sin migrar datos
reales — nunca hubo ninguno, solo pruebas ya revertidas):

1. **Cupones, no saldo**: cada recompensa es un cupón individual con su
   propio código de 6 caracteres y estado (`DISPONIBLE`/`CANJEADO`),
   nunca un monto que se suma a una cuenta.
2. **El cupón de quien invita nace DESPUÉS, no antes**: al ingresar un
   código se crea de una vez el cupón de BIENVENIDA del referido
   (disponible para su primera visita) — pero el cupón de RECOMPENSA de
   quien invitó recién se crea cuando ese cupón de bienvenida se CANJEA
   de verdad en una venta real. Esto resuelve la duda del usuario sobre
   crear cuentas falsas con el mismo código: no alcanza con que existan,
   alguna tiene que pasar por caja y gastar dinero real para que quien
   invitó gane algo.
3. **Canje desde Ventas.jsx, no un monto automático**: el botón de
   descuento (antes alternaba solo %/monto fijo) ahora tiene un tercer
   modo "Cupón" (ícono de ticket) que pide el CÓDIGO a la clienta en vez
   de aplicar un monto — a propósito, para obligarla a abrir la Web y
   familiarizarse con ella (pedido explícito del usuario). Al escribir 6
   caracteres, se busca el cupón en vivo (debounce 400ms) y se muestra de
   quién es y cuánto vale, o el error si es inválido/ya usado — la
   validación real y el canje atómico pasan por el servidor de todos
   modos, esto es solo una vista previa para que la cajera no cobre a
   ciegas.
4. **Niveles con color según el peso**: en la pantalla del cliente, cada
   cupón se pinta Bronce/Plata/Oro según su valor (mismo espíritu que los
   niveles de la tarjeta de puntos, §7.15) — se calcula del valor real
   del cupón, no de su origen, así que sigue funcionando si el negocio
   cambia los montos desde Referidos Web.

**SQL** (reemplaza el mecanismo de trigger + columnas de §7.26):
- Se retiran `clientes.credito_referido`/`recompensa_referido_aplicada`
  y los 2 triggers automáticos de `registro_servicios`/`pedidos_web`.
- `cupones (id, cliente_id, codigo, origen, valor, estado, referido_id,
  venta_id, creado_en, canjeado_en)` — `origen` distingue
  `REFERIDO_BIENVENIDA`/`REFERIDO_RECOMPENSA`. RLS: el dueño ve las
  suyas; CUALQUIER personal (`rol_actual() is not null`, no solo admin)
  puede leer por código — la cajera necesita buscar el cupón de una
  clienta, no solo los propios.
- `ventas.cupon_id` (nueva columna) — trazabilidad: qué cupón se usó en
  qué venta exacta.
- `aplicar_codigo_referido()`: ahora también crea el cupón de bienvenida
  del referido en el mismo paso.
- **`confirmar_venta()` — cambio más delicado de esta fase**: nuevo
  parámetro `p_codigo_cupon`. Reclama el cupón de forma atómica
  (`update ... where estado = 'DISPONIBLE' returning ...`, mismo patrón
  anti-condición-de-carrera que ya usa el descuento de stock) ANTES de
  tocar items/stock, para que dos ventas concurrentes nunca puedan
  gastar el mismo cupón dos veces. Si el cupón canjeado era de
  bienvenida, genera ahí mismo — dentro de la misma transacción — el
  cupón de recompensa de quien invitó + su notificación. **Bug real
  encontrado y corregido en el momento, probando en vivo**: `create or
  replace` no reemplaza una función si cambia la firma (parámetro
  nuevo) — sin el `drop function` de la versión vieja (7 argumentos),
  hubiesen quedado dos versiones de `confirmar_venta` coexistiendo y
  PostgREST no habría podido resolver cuál usar. También se encontró y
  corrigió una ambigüedad de columna (`codigo` es a la vez columna de
  `cupones` y parámetro de salida de la propia función, por el
  `returns table(..., codigo text, ...)`) — se resolvió calificando la
  columna (`cu.codigo`) en vez de dejarla suelta.
- Verificado en vivo, con clientes de prueba insertados y revertidos en
  transacciones con `rollback` (nunca datos reales): canje exitoso de un
  cupón de bienvenida en una venta real de un producto real → el cupón
  quedó `CANJEADO` con su `venta_id`, y se generó el cupón de recompensa
  de quien invitó con el valor vigente en `config_referidos` en ese
  momento (se notó que ese valor ya no era el default de 15 — el admin
  ya lo había ajustado a 5 desde el panel Referidos Web, confirmando que
  ese panel también funciona en vivo); reintentar el mismo código ya
  canjeado devolvió "Cupón inválido o ya usado", como debía.

**Frontend:**
- `CarritoContext.jsx` (POS): `tipoDescuento` gana un tercer valor,
  `'cupon'`, más `codigoCupon`/`setCodigoCupon`.
- `Ventas.jsx`: el botón de descuento rota %→monto→cupón; en modo cupón
  el input cambia a un campo de texto (6 caracteres, mayúsculas) con
  búsqueda en vivo y mensaje de vista previa; `puedeCobrar` exige un
  cupón válido antes de dejar cobrar; se limpia el código al cambiar de
  modo o tras cobrar/cancelar, para que nunca quede un código viejo
  colgado listo para reenviarse por accidente.
- `ReferidosCliente.jsx`: la sección de "crédito disponible" se queda
  (ahora es la suma de los cupones `DISPONIBLE`, calculada en el
  servidor), y se agregó la lista de "Tus cupones" con su código, valor
  y color de nivel.
- `ReferidosWeb.jsx` (admin): la lista pasó de "quién refirió a quién"
  (con las columnas eliminadas) a "cupones emitidos" (código, origen,
  valor, estado, dueño).
- Build y lint verificados en cada archivo. SQL aplicada y verificada en
  vivo, incluyendo los dos bugs encontrados y corregidos en el momento.

### 7.28 Personal que también es clienta: "Mi perfil de clienta"

El usuario notó un caso real sin resolver: una asistente (o cajera/admin)
a veces también es clienta del salón, y quería su perfil en la Web
usando su mismo correo — hoy no podía, por dos motivos distintos:

1. **Supabase Auth no permite dos cuentas con el mismo correo** — "Crear
   cuenta" en el login de clientes con su correo de personal habría
   fallado siempre (correo ya registrado).
2. **`AuthContext.cargarPerfil()` corta camino antes de tiempo**: busca
   primero en `usuarios`; si encuentra una fila (personal), NUNCA llega
   a mirar `clientes_web`, así que aunque el problema 1 se resolviera,
   la app jamás la habría reconocido como clienta con esa sesión.

**Solución** (confirmada con el usuario — el acceso vive en el menú del
usuario del POS, junto a "Cerrar sesión"): la MISMA cuenta, el mismo
correo, sin pasar por `auth.signUp()` nunca — la fila de `clientes_web`
se crea directo con su `auth.uid()` de personal (la policy de INSERT ya
existente, `id = auth.uid()`, alcanza para cualquier usuario
autenticado, sea o no personal). Un flag aparte (`modoVista`, no `rol`)
decide qué árbol de rutas mostrarle, sin que su rol de personal cambie
en ningún momento.

- **`AuthContext.jsx`**: nuevo estado `modoVista` (`'STAFF'` por
  defecto, se reinicia en cada `cerrarSesion()`). `entrarComoClienta()`
  — inserta su fila en `clientes_web` si no la tenía (idempotente: si ya
  existe, el choque de PK (`23505`) se ignora) y cambia `modoVista` a
  `'CLIENTE'`. `volverAlPos()` — la vuelve a `'STAFF'`. `rol` sigue
  siendo SIEMPRE su rol real de personal (`cargarPerfil` no cambió en
  absoluto) — `modoVista` es un flag totalmente aparte.
- **`App.jsx`**: la rama que decide "árbol de cliente vs. árbol de POS"
  pasa de `rol === 'CLIENTE'` a `vistaCliente = rol === 'CLIENTE' ||
  (rol de personal && modoVista === 'CLIENTE')`. Con eso montado, el
  resto de la Web (Mi Perfil, el flujo de vinculación por teléfono,
  Direcciones, Puntos, Referidos, etc.) funciona exactamente igual que
  para cualquier clienta nueva — sin ningún caso especial en ningún otro
  archivo. Si ya tenía historial cargado a mano con su mismo teléfono
  (típico: ya se hizo servicios como clienta antes de esto), el flujo de
  "¿Es tu registro?" de Mi Perfil se lo ofrece vincular, igual que a
  cualquiera.
- **`MenuUsuario.jsx`** (POS): nuevo botón "Mi perfil de clienta" junto
  al switch de tema — llama a `entrarComoClienta()`; al montar el árbol
  de cliente, el router redirige solo a `/inicio` (la ruta actual del
  POS, ej. `/ventas`, no existe en ese árbol → cae en su comodín).
- **`MenuUsuarioCliente.jsx`** (Web): nuevo botón "Volver al POS",
  visible SOLO si `rol` es un rol de personal (nunca para una clienta
  pura, que tiene `rol === 'CLIENTE'`) — llama a `volverAlPos()`.
- Verificado en vivo suplantando a una asistente real: el insert en
  `clientes_web` con su propio `auth.uid()` de personal funcionó sin
  fricción, y `mi_cliente_id()` respondió `null` (correcto — recién
  vincula su registro de negocio al guardar Mi Perfil, mismo paso que
  cualquier clienta nueva), todo dentro de una transacción con
  `rollback` (sin dejar datos de prueba).
- Build y lint verificados. Sin cambios de SQL — la policy de INSERT de
  `clientes_web` que hace esto posible ya existía desde el principio.

### 7.29 Fix: Referidos se rompía para un perfil sin vincular

Bug real reportado por el usuario, reproducido justo con el caso de
§7.28: una asistente que recién activó "Mi perfil de clienta" y todavía
no guardó Mi Perfil ni una vez (sin fila en `clientes` vinculada) entraba
a Referidos y veía la pantalla de error genérica de React — el resto de
pestañas funcionaba bien.

**Causa raíz**: `mi_estado_referidos()` exige un perfil vinculado y
lanza `'Completa tu perfil antes de ver tus referidos.'` si
`mi_cliente_id()` es null (mismo criterio que `agendar_cita_web()`/
`guardar_mi_resena()` para acciones de escritura) — correcto del lado
del servidor. Pero `ReferidosCliente.jsx` nunca revisaba
`estadoRes.error`: guardaba `estado = null` en silencio y seguía
renderizando igual, así que la primera línea que leía `estado.codigo`
(o `.credito_referido`, etc.) reventaba con "Cannot read properties of
null" — cualquier cliente nuevo sin perfil completo (no solo personal en
modo clienta) se habría topado con lo mismo.

- **Fix**: `cargar()` ahora guarda si `mi_estado_referidos()` devolvió
  error (`sinPerfil`) antes de tocar `estado`. Con `sinPerfil` (o sin
  `estado`) la pantalla muestra una tarjeta simple "Completa tu perfil
  (nombre y teléfono) para tener tu código de referidos" con un botón
  directo a Mi Perfil, en vez de intentar pintar código/cupones que
  todavía no pueden existir.
- Se revisó `MisPuntosCliente.jsx` (mismo tipo de dependencia de
  `mi_cliente_id()`) — ya estaba bien defendido (`mis_puntos()` no
  lanza error, y el frontend ya usaba `data?.length > 0 ? data[0] :
  null` + `?? 0` en todos lados), no hacía falta tocarlo.
- Build y lint verificados. Sin cambios de SQL — el error del servidor
  ya era el correcto, faltaba manejarlo en el frontend.

### 7.30 Fix: el cupón "no existía" en Ventas por una relación ambigua

Bug real reportado por el usuario: entró un código de referido en una
cuenta nueva, fue a Ventas, escribió el código del cupón recién creado
en el nuevo modo "Cupón" — y salió "Código no encontrado" (con el botón
de cobrar correctamente bloqueado, como debía ser ante un cupón
inválido — pero el cupón SÍ era válido).

**Causa raíz**: `cupones` tiene DOS foreign keys distintas hacia
`clientes` — `cliente_id` (dueño del cupón) y `referido_id`
(trazabilidad de quién generó el cupón de recompensa). Las consultas de
`Ventas.jsx` (`clientes(nombre)`) y `ReferidosWeb.jsx`
(`cliente:cliente_id(nombre)`, sintaxis incorrecta — le faltaba el
nombre de la tabla antes del hint) no le decían a PostgREST cuál de las
dos relaciones usar para el embed; sin esa desambiguación, PostgREST
rechaza la consulta entera. `Ventas.jsx` ni siquiera revisaba el
`error` de la respuesta — un `.maybeSingle()` fallido y uno que de
verdad no encuentra el código se veían exactamente igual ("Código no
encontrado"), ocultando el problema real.

- **Fix**: `Ventas.jsx` → `clientes!cliente_id(nombre)` (hint explícito
  de la FK). `ReferidosWeb.jsx` → `cliente:clientes!cliente_id(nombre)`
  (mismo hint, con alias). De paso, `Ventas.jsx` ahora sí distingue "no
  se pudo verificar el cupón" (error real) de "código no encontrado"
  (de verdad no existe), en vez de mostrar el mismo mensaje para los
  dos casos.
- Build y lint verificados. Sin cambios de SQL — las relaciones ya
  estaban bien definidas, el problema era solo cómo se las pedía el
  frontend.

### 7.31 Anular una venta también deshace el cupón (SQL 96) — ✅ aplicada y verificada en vivo

Pregunta del usuario ("¿qué es lo ideal que pase si anulo una venta que
usó un cupón?") que reveló un hueco real: `anular_venta()` ya reponía
stock y liberaba la atención al anular, pero **nunca tocaba el cupón**
usado en esa venta.

- El cupón se quedaba `CANJEADO` para siempre, atado a una venta que ya
  no existía — la clienta perdía su cupón sin haber comprado nada real.
- Peor: si era un cupón de bienvenida que ya había generado el cupón de
  recompensa de quien invitó, esa persona se quedaba con su recompensa
  aunque la venta que la originó se deshiciera — abría la puerta a
  "vender y anular" a propósito para farmear cupones de recompensa.

**Fix aplicado**: `anular_venta()` ahora, además de lo que ya hacía,
revierte el cupón como si nunca se hubiera canjeado — vuelve a
`DISPONIBLE` (`canjeado_en`/`venta_id` a null) — y si era de bienvenida
y su cupón de recompensa asociado sigue `DISPONIBLE` (no lo gastó su
dueño en otra venta real), lo pasa a `ANULADO`. Si el referidor ya lo
usó en una venta real distinta, eso no se toca — anular una venta nunca
debe deshacer OTRA venta ya completada.

Verificado en vivo de punta a punta (transacción con `rollback`, sin
datos reales): venta con un cupón de bienvenida → generó el cupón de
recompensa del referidor (estado `DISPONIBLE`) → se anuló esa venta →
el cupón de bienvenida volvió a `DISPONIBLE` y el de recompensa del
referidor pasó a `ANULADO`, ambos sin `venta_id`, exactamente como se
esperaba.

- `ReferidosCliente.jsx`: la etiqueta de un cupón no disponible ahora
  distingue "Anulado" de "Ya canjeado" (antes decía "Ya canjeado" para
  los dos casos).
- Build y lint verificados.

### 7.32 Cupones unificados en "Cupones y ofertas"

A pedido del usuario: los cupones (hoy solo los que genera Referidos,
pero pensados desde el inicio para sumar más formas de obtención sin
tocar esta pantalla) deben verse también desde "Cupones y ofertas"
(`OfertasCliente.jsx`, `/ofertas`) junto a las ofertas generales del
salón — no solo en Referidos. Y si un cupón se canjea, debe quedar
marcado igual en las dos pantallas.

Esto último ya salía gratis con la arquitectura existente: tanto
Referidos como Ofertas leen `mis_cupones()` → la tabla `cupones`
directo, sin ningún estado propio duplicado — no hay nada que
"sincronizar" porque nunca hubo dos copias del dato, solo dos pantallas
mirando la misma fuente. Lo que faltaba era que Ofertas también la
mirara.

- **`src/lib/cupones.js`** (nuevo) — `ETIQUETAS_ORIGEN_CUPON`/
  `nivelCupon()` (antes vivían solo dentro de `ReferidosCliente.jsx`),
  para que agregar un origen de cupón nuevo en el futuro no signifique
  tocar dos archivos.
- **`TarjetaCupon.jsx`** (nuevo, componente compartido) — la tarjeta de
  un cupón (código, origen, nivel/color, "Muéstralo en caja" / "Ya
  canjeado" / "Anulado"), usada tal cual por ambas pantallas.
- **`OfertasCliente.jsx`**: ahora carga `mis_cupones()` además de
  `promociones`, con dos secciones separadas — "Tus cupones" (personal,
  con dueño y código) arriba, "Ofertas del salón" (general, sin dueño,
  se aplican a mano en Ventas — no pasan por el modo "Cupón") abajo.
  Estado vacío combinado solo si de verdad no hay ni cupones ni ofertas.
- **`ReferidosCliente.jsx`**: su lista de cupones pasa a usar
  `TarjetaCupon` (se quitó la definición duplicada de
  `nivelCupon`/`ETIQUETAS_ORIGEN` que tenía adentro) y suma un link "Ver
  todos tus cupones en Cupones y ofertas" — se queda mostrando los
  propios ahí también, en contexto junto al código de invitación, no se
  removió de esa pantalla.
- Build y lint verificados. Sin cambios de SQL — `cupones`/
  `mis_cupones()` ya estaban listos para esto desde que se construyeron.

### 7.33 Dos bugs reportados: modo cliente no sobrevivía a un refresh + pantalla negra para ASISTENTE

Dos problemas reales encontrados por el usuario probando con una cuenta
de asistente:

**1. "Mi perfil de clienta" no persistía al refrescar la página**

`modoVista` (§7.28) vivía en un `useState` normal — al hacer F5, React
vuelve a montar todo desde cero y el estado se perdía, volviendo siempre
al POS aunque la asistente hubiera elegido ver su perfil de clienta.
- **Fix**: `modoVista` ahora se lee de `sessionStorage` al iniciar
  (`leerModoVistaGuardado()`) y un `useEffect` lo mantiene sincronizado
  ahí en cada cambio. `sessionStorage` (no `localStorage`) a propósito:
  sobrevive a un refresh (el bug reportado) pero se borra solo al
  cerrar la pestaña/ventana — nunca deja "modo cliente" pegado para una
  sesión de personal completamente distinta más adelante.

**2. Una ASISTENTE veía pantalla negra al iniciar sesión por primera vez**

Causa real: tanto `App.jsx` (ruta índice del POS) como
`PestanasCacheadas.jsx` (fallback cuando la ruta actual no existe o el
rol no puede verla) tenían `"/ventas"` escrito a mano como destino por
defecto — pero `/ventas` es `ADMINISTRADOR`/`CAJERA` únicamente
(`navegacion.js`), una ASISTENTE nunca estuvo en esa lista. Resultado:
una asistente aterrizaba en `/ventas`, `PestanasCacheadas` detectaba que
no podía verla y la mandaba... de vuelta a `/ventas` — un rebote a sí
mismo que nunca llegaba a mostrar contenido real.
- **Fix**: nueva función `rutaInicialPara(rol)` en `navegacion.js` —
  devuelve la primera pestaña de `secciones` (en su orden real) que ese
  rol sí puede ver. Para `ASISTENTE`, eso es `/mi-panel` (la primera de
  la lista que la incluye), tal como debía ser. Reemplaza el `"/ventas"`
  fijo tanto en `App.jsx` (índice del árbol de POS) como en el fallback
  de `PestanasCacheadas.jsx` — un cambio, un solo lugar de verdad para
  "adónde va cada rol por defecto".
- Build y lint verificados. Sin cambios de SQL — los dos eran bugs de
  frontend puro.

### 7.34 Cupones: fecha de creación y canje, en un acordeón

A pedido del usuario: cada cupón debía mostrar cuándo se creó y cuándo
se canjeó, pero sin sumarlas a la fila compacta actual (ya tenía código/
origen/valor/estado — dos fechas más la saturaban). Se le propuso y
aplicó el mismo patrón que ya usa el resto del proyecto para este
mismo problema (fila resumen + detalle bajo demanda, ver
`PedidosWeb.jsx`/`Historial.jsx`): la tarjeta entera es un acordeón.

- **`TarjetaCupon.jsx`**: la fila de siempre (ícono, código, origen,
  nivel, valor, estado) ahora es un `<button>` que alterna un
  `CampoColapsable` — al tocarla, se despliega una fila chica con
  "Creado: [fecha]" y, si ya se canjeó, "Canjeado: [fecha]". Flecha
  `ArrowBigDown` girando 180° al abrir (convención del proyecto para
  todo acordeón — nunca `ChevronDown`).
- **`src/lib/cupones.js`**: nuevo `formatearFechaCupon()` (día/mes/año,
  zona horaria Lima) — `mis_cupones()` ya devolvía `creado_en`/
  `canjeado_en`, no hizo falta tocar SQL.
- Se actualiza sola en ambas pantallas que usan `TarjetaCupon`
  (Referidos y Cupones y ofertas), sin tocarlas — es el mismo
  componente compartido de §7.32.
- Build y lint verificados.

### 7.35 Diseño de cupones por nivel (referencia HTML) + etiqueta "Nuevo" de un solo uso

El usuario pasó una referencia HTML con 3 niveles de cupón (Bronce/
Plata/Oro, exactamente los mismos umbrales que ya usaba `nivelCupon()`
— valor < S/10 / S/10-20 / ≥S/20) y pidió reemplazar el diseño visual
de la tarjeta en sí (no el resto de la pantalla) por ese estilo.

- **`src/index.css`**: nuevo bloque `.cupon-*` — Plata con borde
  degradado + reflejo sutil + barrido (`cupon-sheen`); Oro con glow
  pulsante (`cupon-glow`), texto degradado animado
  (`.cupon-texto-oro`/`cupon-brillo-texto`) y chispas titilantes
  (`.cupon-chispa`/`cupon-titilar`). Bronce se queda con color plano
  vía Tailwind — no lo necesitaba. Reutiliza `--lw-gold` (ya existe en
  `.landing-web`) y `color-mix()` (ya usado 8 veces antes en este mismo
  archivo, no es una técnica nueva). Guardas de
  `prefers-reduced-motion` en todo lo animado.
- **`src/lib/cupones.js`**: `nivelCupon()` ahora devuelve
  `claseTarjeta`/`claseTexto`/`claseIcono` en vez de clases sueltas de
  borde/fondo — Plata/Oro apuntan a las clases nuevas de `index.css`.
- **`TarjetaCupon.jsx`**: rediseñado con el nuevo esquema por nivel +
  chispas (solo Oro, 3 en vez de las 5 de la referencia — la referencia
  era una tarjeta grande y suelta en una vitrina, acá van en una lista
  angosta). Se dejó fuera a propósito la animación de "flotar" de la
  referencia (ahí tenía sentido con 3 tarjetas sueltas mostrándose una
  vez; varias flotando a la vez en una lista se ve mal) — pedido del
  usuario era "solo el diseño de las tarjetas en sí". Corrección
  encontrada armando esto: la etiqueta "Nuevo" y las chispas quedaban
  recortadas por el `overflow: hidden` que la tarjeta necesita para el
  brillo — se resolvió poniéndolas en un contenedor exterior sin
  recorte (mismo truco que ya usa la referencia: viven afuera de
  `.card`, no adentro).
- **Etiqueta "Nuevo" de un solo uso** (`useCuponesNuevos.js`, nuevo
  hook): se guarda en `localStorage` (por dispositivo, no hace falta
  que viaje al servidor) qué códigos de cupón ya vio el cliente —
  Referidos y Cupones y ofertas comparten la misma lista de "vistos",
  así que un cupón visto en una ya no aparece "Nuevo" en la otra. Al
  salir de la pestaña y volver (la página se desmonta y remonta), el
  hook relee `localStorage` desde cero y ya no encuentra nada nuevo,
  tal como pidió el usuario.
- Build y lint verificados. Sin cambios de SQL.

### 7.36 Nuevo lenguaje visual para el hero de Inicio (referencia HTML, arranca "por ahora" solo ahí)

El usuario trajo una referencia HTML nueva (carpeta "Inicio — oscuro",
un mockup exportado de una herramienta de diseño) y pidió: "antes de
continuar con las implementaciones y futuras páginas establezcamos un
nuevo diseño para la pestaña Web y sus subpestañas [...] quiero que
apliques al inicio por ahora". Es decir: la dirección visual nueva es
para TODA la Web, pero el alcance real de este cambio es solo el hero
de Inicio — el resto (header de `PortalCliente.jsx` incluido, y el
resto de páginas) se queda con el look dorado/liquid-glass hasta que
se migren una por una en el futuro. Por eso nada de esto toca
`--lw-gold` ni las clases `.landing-web` ya existentes — vive aparte
con su propio acento en degradado azul.

- **Fuentes**: `Orbitron` y `Kunaroh` agregadas al mismo `<link>` de
  Google Fonts que ya carga el resto (`index.html`) — el `.ttf` que
  traía la referencia era solo cómo la herramienta de diseño exportó
  una fuente que YA está en Google Fonts, no hacía falta un
  `@font-face` con un archivo local.
- **Fotos antes/después**: las dos fotos de la referencia (mismo
  encuadre/luz, solo cambia el peinado) se copiaron a
  `public/inicio-web/` — son material de stock aprobado por el
  negocio para armar esta primera versión, igual que los videos del
  resto de Inicio (`VIDEO_DESTACADO`, etc.), NO fotos reales de una
  clienta. Mismo pendiente que la Galería de Nosotros: reemplazar
  cuando existan fotos reales. A diferencia de la referencia, no se
  muestra un watermark "Imagen referencial" en pantalla — esa
  referencia es información para el negocio/dev, no algo que una
  clienta real deba ver en un producto en vivo (mismo criterio que ya
  se usaba con los videos: la advertencia vive en comentarios de
  código, nunca en la UI).
- **`InicioCliente.jsx`**: el hero con `<video>` (loop con crossfade
  manual, `useVideoHeroConFundido`) se reemplazó por completo —
  quedaron solo `VIDEO_DESTACADO`/`VIDEO_FILOSOFIA`/`VIDEO_SERVICIO_*`
  para las secciones de más abajo, sin tocarlas. El nuevo hero:
  - Foto "después" de fondo (`object-position: right center`, así el
    lado izquierdo del encuadre —negro en las dos fotos— queda libre
    para el texto) + foto "antes" superpuesta, revelada con
    `mask-image` (radial-gradient) centrado en el cursor.
  - `useRevelarAntes(...)`: hook local que interpola posición/radio a
    mano (mismo espíritu que `useVideoHeroConFundido` que reemplaza) y
    escribe el resultado directo por `ref.current.style` en cada
    `requestAnimationFrame` — no pasa por estado de React, para no
    re-renderizar en cada `pointermove`. Filtra `pointerType ===
    'touch'`: en un dedo, "tocar y arrastrar" es indistinguible de la
    intención de hacer scroll, así que el efecto solo reacciona a
    mouse/lápiz — en touch simplemente no aparece (el hint de abajo
    también se esconde en móvil con `hidden sm:flex`, no se promete un
    gesto que no existe).
  - Título grande en `Kunaroh` (`.lw-titulo-kunaroh`), con
    "Transforma" en degradado azul (`.lw-texto-degradado-azul`,
    mismos tonos que la referencia) y dos acentos de esquina en SVG
    (`EsquinaBracket`) arriba/abajo del bloque de texto.
  - Etiqueta de saludo (`.lw-tag-bracket`) y botón "Reserva tu cita"
    (`.lw-cta-hero`, ghost button que invierte a fondo claro en hover)
    con el mismo lenguaje de corchetes/bordes finos.
  - Se mantuvo el saludo personalizado ("Hola, {nombre}") que ya
    existía — la referencia no lo tenía (es un mockup anónimo/
    marketing), pero es una función real ya construida para un cliente
    ya logueado, no tenía sentido perderla en el rediseño.
- **`src/index.css`**: bloque nuevo al final del archivo con las
  clases `.lw-*` de arriba — igual que `.cupon-*` (§7.35), viven sueltas
  (no anidadas bajo `.landing-web`), mismo patrón ya usado en el
  archivo.
- Probado en vivo con Playwright headless (registro de una cuenta de
  prueba, confirmada por SQL, borrada al terminar): el hover revela la
  foto "antes" y la etiqueta "ANTES" seguía al cursor correctamente en
  desktop; en móvil el hero se ve bien y el hint se esconde como se
  esperaba; scroll a las secciones de abajo sin regresiones. Build y
  lint verificados, sin warnings nuevos. Sin cambios de SQL.
- **Pendiente** (fuera de alcance de este pedido puntual): migrar el
  header de `PortalCliente.jsx` y el resto de páginas de la Web a este
  mismo lenguaje visual — el usuario pidió explícitamente "por ahora"
  solo el Inicio.

### 7.37 Correcciones al hero de §7.36 tras comparar captura a captura contra la referencia

El usuario comparó una captura de la referencia HTML contra el resultado
real en pantalla y encontró varias diferencias — algunas eran bugs, no
diferencias de criterio:

- **El título NO estaba en Kunaroh, pese al CSS correcto.** El
  `@font-face`/Google Fonts que se agregó en §7.36 asumía que "Kunaroh"
  ya estaba en el catálogo de Google Fonts (por eso solo se agregó
  `family=Kunaroh` al `<link>` existente) — falso: se confirmó en vivo
  que `fonts.googleapis.com/css2?family=Kunaroh` devuelve **400 "Font
  family not found"**. Google Fonts ignora en silencio esa familia
  inválida dentro del link combinado (el resto de fuentes sí cargaba,
  por eso pasó desapercibido), así que el navegador caía al fallback
  `'Orbitron'` del `font-family` — de ahí que el título se viera en
  Orbitron en vez de Kunaroh. Fix real: el `.ttf` de la referencia
  (`assets/Kunaroh.ttf`, la fuente de verdad, no un export accesorio)
  se copió a `src/assets/fonts/Kunaroh.ttf` y se declara como
  `@font-face` local en `src/index.css` (referenciada con path relativo
  para que Vite la procese como asset y quede bien con el `base:
  '/PosJaise/'` de producción — un path absoluto tipo `/inicio-web/...`
  se hubiera roto en GitHub Pages). Se quitó `&family=Kunaroh` del
  `<link>` de `index.html` (parámetro muerto).
- **Header "en una sola pieza" con la foto.** La cabeza/hombro de la
  referencia llega hasta el borde real de la pantalla, con el header
  flotando transparente encima (como en el resto del portal). En la
  versión anterior el contenedor padre de todas las rutas del portal
  (`PortalCliente.jsx`) reserva `pt-16 sm:pt-[72px]` para que el
  contenido no arranque tapado por el header fijo — en Inicio eso
  empujaba TODA la sección del hero (imagen incluida) 64-72px hacia
  abajo, dejando una franja de fondo liso entre el header y la foto
  (el "corte" que reportó el usuario). Fix: ese padding-top ahora se
  salta condicionalmente cuando `esInicio` (mismo flag que ya existía
  para la migaja de pan), y `InicioCliente.jsx` compensa con su propio
  `pt-24 sm:pt-28` interno — la foto de fondo llega hasta y=0 real
  (detrás del header), el título queda con el mismo margen visual de
  antes.
- **Paleta celeste del header, solo en Inicio.** El nav activo ("Inicio"
  en texto + su subrayado) usaba `--lw-gold` como el resto del portal.
  Ahora, cuando `esInicio` es true, usa `#a9c6ec` (mismo tono del
  degradado `.lw-texto-degradado-azul` del hero) — en cualquier otra
  pestaña sigue dorado. Sin variable CSS nueva compartida: es un
  condicional directo en `PortalCliente.jsx`, a propósito acotado a
  este único lugar (mismo criterio de alcance de §7.36 — el resto del
  portal no migra todavía).
- **Logo reemplazado.** El logo anterior (ícono `icon-192.png` redondo +
  "Jaise"/"Beauty Academy" en Inter) no tenía relación con la nueva
  dirección visual. Se reemplazó por un wordmark tipográfico en
  Orbitron ("JAISE˚" + "BEAUTY ACADEMY"), sin imagen — a diferencia de
  la paleta celeste, este cambio SÍ es global (aplica en todas las
  pestañas del portal), porque un logo no tiene sentido que cambie
  según la ruta.
- **Sin saludo "Hola, {nombre}".** La referencia no lo tenía — se sacó
  del hero junto con `usePerfilCliente`/`primerNombre`, que quedaron sin
  otro uso en el archivo.
- **Fondo más oscuro y sin grilla.** Se fijó `bg-[#0b0b0c]` explícito en
  la sección del hero (antes dependía solo del degradado + lo que se
  viera detrás) y se quitó la grilla SVG (`.lw-grid-fondo`) que se había
  agregado en §7.36 por iniciativa propia — la referencia no la tiene,
  y sumaba un aclarado sutil de fondo que contribuía a que se viera
  "menos oscuro" que el original. Clase `.lw-grid-fondo` borrada de
  `index.css` (sin otro uso); `.lw-tag-bracket` también, al perder su
  único uso (el saludo).
- **Sin cambios en los íconos del header** (chanchito/carrito/avatar) ni
  en su color — a pedido explícito del usuario, se quedan tal cual ya
  estaban (no son parte de este rediseño).
- Build y lint verificados, sin warnings nuevos en los archivos
  tocados. Verificación visual en vivo (Playwright + cuenta de prueba
  creada y confirmada directo por SQL) fue bloqueada por el
  clasificador de permisos del entorno ("Modify Shared Resources") al
  intentar iniciar sesión contra la app corriendo — la cuenta de
  prueba ya creada se borró igual (auth.users/auth.identities/
  clientes_web, 0 filas restantes). Cambios verificados por lectura de
  código (estructura real del layout de `PortalCliente.jsx`,
  confirmación directa por HTTP de que Kunaroh no existe en Google
  Fonts) pero no con una captura de pantalla final — pendiente que el
  usuario lo confirme visualmente con `npm run dev` (servidor quedó
  corriendo en `http://localhost:5174/` al cierre de esta sesión).

### 7.38 Ajustes finos tras comparar contra referencia.png (render directo del HTML original)

El usuario mandó una captura del propio `index.html`/`styles.css`
original abierto en el navegador (sin tocar, "referencia.png" en su
checklist) y comparó contra el resultado real, más 4 pedidos puntuales:

- **La "R" de TRANSFORMA se cortaba abajo.** Causa: la `<section>` del
  hero tenía `overflow-hidden` propio (para recortar las fotos de
  fondo), y con `line-height:1.05` los floreos/colas de Kunaroh en la
  "R" sobresalían un poco de su caja de línea — la sección los
  recortaba en seco. El layer de fondo (fotos) ya tiene su PROPIO
  `overflow-hidden` en un `<div>` interno aparte, así que sacarlo de la
  `<section>` no afecta a las fotos, solo destrababa el texto.
- **Tope de ancho en pantallas muy grandes (27"+).** La referencia no
  define un max-width (es un mockup pensado a un tamaño fijo), pero sin
  uno la foto/el título se estiran y distorsionan en un monitor ancho de
  verdad. Se agregó `max-w-[1800px] mx-auto` a la `<section>` del
  hero — `.landing-web` ya pinta `#000` detrás (`background: var(--lw-bg)`),
  así que lo que sobra a los costados se ve negro sin agregar nada
  nuevo. Valor elegido a criterio (1800px); el usuario puede pedir otro
  si no le cierra.
- **El celeste del header no tenía "brillo".** Era un color plano
  (`#a9c6ec`). La referencia usa `--metal`, un degradado con una banda
  clara al centro (`86a9d8 → a9c6ec → d3e4f8 → a9c6ec → 86a9d8`) que
  simula acero pulido/reflejo — eso es el "brillo" que faltaba. Se
  declaró como `--lw-metal-azul` en `.landing-web` (mismo valor que
  `.lw-texto-degradado-azul` de §7.36, ahora renombrada
  `.lw-metal-azul-texto` porque dejó de ser exclusiva del título — ver
  abajo) y se aplica con `background-clip:text` al link activo del nav
  y como `background` liso a su subrayado y a la insignia del carrito,
  todo condicionado a `esInicio` (fuera de Inicio, todo sigue dorado —
  mismo criterio de alcance que ya venía).
- **La migaja ("Inicio" suelto bajo el header) se queda** — a pedido
  explícito del usuario, aunque el checklist que pegó (instrucciones
  para replicar el HTML original 1:1) pedía sacarla. Es la única
  diferencia a propósito respecto a la referencia pura.

Del mismo checklist ("usa exactamente los valores de styles.css"),
también se corrigieron sin que el usuario las nombrara una por una:
- `.lw-titulo-kunaroh`: `letter-spacing` de `.06em` a `.08em` (valor
  real de `.hero__title`); tamaño de fuente de los saltos fijos de
  Tailwind (`text-5xl sm:text-6xl md:text-7xl`) al `clamp(40px,5.2vw,74px)`
  exacto de la referencia — al ya estar todo dentro del tope de 1800px
  de arriba, el propio `clamp` satura en 74px bastante antes de esa
  franja, así que no vuelve a crecer sin control ahí.
- Se agregó el ícono "tablero" (`.lw-checker`, el SVG de 4 filas que
  sigue a "TRANSFORMA" en la referencia) — no estaba, y sin él el título
  se veía incompleto contra `referencia.png`. Ya no lleva degradado
  azul (ver arriba): vuelve a ser texto blanco liso, igual que
  "Belleza"/"que".
- Se sacaron las esquinas decorativas (`EsquinaBracket`, componente
  entero borrado — no tenía otro uso) y el párrafo bajo el título
  ("Agenda tu próxima cita…") — ninguno de los dos existe en la
  referencia.
- `.lw-cta-hero`: `border-color` de `rgba(255,255,255,.35)` a `#52525b`
  y `background` de `transparent` a `#0b0b0c` (el botón de la
  referencia tiene un fondo sólido, no deja pasar la foto de atrás).
- `.lw-hint-cursor`: se sacó un `font-family:'Orbitron'` que no estaba
  en el original (el hint hereda la fuente del body, no Orbitron); se
  ajustaron `padding` (20px→24px), `font-size` (11px→13px), `font-weight`
  (700→600), `letter-spacing` (.14em→.18em) y se agregó
  `background:#0b0b0c` — todos los valores reales de `.hint`. El ícono
  del cursor pasó de 40×40 a 46×46 (`.hint svg`).
- Logo (`PortalCliente.jsx`): tamaños ajustados a los reales de
  `.logo__name`/`.logo__sub`/`sup` (22px→26px en desktop, 9px, 11px).
  Nav: `text-sm font-medium` (14px/500) a `text-[15px] font-semibold`
  (valor real de `.nav__link`).
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos del entorno que en §7.37) —
  pendiente que el usuario lo confirme con `npm run dev`.

### 7.39 Zoom en pantallas anchas, color pálido, saca "ANTES" y devuelve los esquineros

El usuario probó §7.38 con DevTools en modo Responsive a un ancho muy
grande (2269px) y encontró un problema real de layout, más 3 pedidos
puntuales — dos de ellos revierten algo que el checklist de §7.38 había
pedido sacar:

- **La cara "crecía" (zoom) al agrandar el ancho.** Causa real:
  `min-h-[85svh]` fija el alto de la sección SOLO en función del alto
  de la ventana, sin relación con el ancho. A medida que el ancho
  crecía (hasta el tope de 1800px de §7.38) con el alto fijo, la caja
  se iba haciendo cada vez más apaisada — y `object-cover` tiene que
  recortar más arriba/abajo de la foto para llenar una caja más ancha
  con la misma altura, lo que se ve como si la cara fuera creciendo/
  haciendo zoom. Fix: se agregó `aspect-[1.9]` a la sección, así el
  alto también crece en proporción al ancho (hasta el tope de 1800px);
  `min-h-[85svh]` se queda como piso para pantallas angostas/altas
  (celular), donde la relación de aspecto por sí sola daría una caja
  más baja de lo razonable.
- **Color "pálido", no 100% fiel a las fotos.** Causa: el degradado
  oscuro (`from-[#0b0b0c] via-[#0b0b0c]/50 to-transparent`) que se
  había agregado sobre las fotos para que el texto contrastara. La
  referencia NO tiene ningún overlay — no le hace falta, porque las dos
  fotos ya traen fondo negro puro del lado izquierdo (donde va el
  texto). El overlay extra solo apagaba el color real de la foto sin
  aportar nada que la foto no diera sola. Se sacó el `<div>` del
  degradado por completo.
- **Sin la etiqueta "ANTES" flotante.** A pedido explícito del usuario
  (aunque SÍ está en la referencia) — el hint de abajo ("Pasa el
  cursor. Mira su antes.") ya explica el gesto, la quedaba redundante.
  Se sacó de `useRevelarAntes` (ya no recibe `etiquetaRef`, solo mueve
  la máscara de la foto "antes") y de `InicioCliente.jsx`; la clase
  `.lw-antes-etiqueta` se borró de `index.css` al quedar sin uso. El
  efecto de revelado en sí (la máscara circular que sigue al cursor)
  sigue igual, solo ya no muestra texto.
- **Esquineros de vuelta.** §7.38 los había sacado por seguir al pie de
  la letra un checklist que pedía replicar el HTML original 1:1 — el
  usuario los quiere de todas formas (mandó una captura recortada
  mostrándolos). Se restauró el componente `EsquinaBracket` completo
  (arriba y abajo del bloque de título, como estaba antes de §7.38) —
  es, junto con la migaja de pan, una diferencia a propósito respecto a
  la referencia pura, no un descuido.
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos del entorno que en
  §7.37-7.38) — pendiente que el usuario lo confirme con `npm run dev`.

### 7.40 aspect-[1.9] no alcanzaba: recorte exacto a la relación de aspecto real de la foto

El usuario probó §7.39 en DevTools a dos anchos (1107px y 1753px, misma
altura 758px) y mandó captura: a 1753px la cara seguía notablemente más
recortada/zoom que a 1107px — el `aspect-[1.9]` de §7.39 mejoró el
problema pero no lo resolvió del todo.

Causa exacta: `hero-despues-referencia.jpg`/`hero-antes-referencia.jpg`
miden **1680×944px** de verdad (relación ≈1.78, prácticamente 16:9) —
`1.9` seguía siendo MÁS ancho que la foto real. Con `object-fit:cover`,
en cuanto la caja es más ancha (relativamente) que la foto, el recorte
pasa a ser vertical (arriba/abajo) para poder llenar el ancho — eso es
literalmente el "zoom en la cara" que reportó. Fix: `aspect-[1680/944]`,
la relación EXACTA en px de los archivos reales (verificada leyendo los
headers JPEG de ambos con un script chico, no a ojo). Con la caja
calzando justo en la relación nativa de la foto, `object-cover` nunca
más necesita recortar verticalmente hasta el tope de 1800px — todo el
recorte que hace falta es horizontal, desde la izquierda (donde las
fotos ya traen fondo negro vacío), nunca sobre la cara. Más allá de
1800px de ancho no hay más recorte posible: la sección deja de crecer
(el `max-w-[1800px]` de §7.38) y se ve negro a los costados, tal cual
pidió el usuario desde el principio.
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos que en §7.37-7.39) —
  pendiente que el usuario lo confirme con `npm run dev`.

### 7.41 Migaja de pan: se desalineaba del logo al cambiar el ancho de pantalla, muy separada del header

El usuario pidió mover la migaja de pan (el "Inicio" / "Inicio |
<pestaña>" bajo el header) para que quede pegada justo debajo del
logo, sin que agrandar/achicar la ventana la desalinee.

Causa: la migaja vivía en un `<div>` totalmente aparte de
`PortalCliente.jsx`, posicionado con `fixed top-20 sm:top-24` — un
offset fijo respecto al VIEWPORT, calculado a mano para "quedar justo
debajo del header" sumando su alto (`h-16 sm:h-[72px]`) más un margen.
Ese cálculo se rompía en el breakpoint `lg` (1024px): el botón de
hamburguesa (`lg:hidden`) corre el logo hacia la derecha en pantallas
angostas pero desaparece en desktop, así que la posición X real del
logo cambia en ese punto — la migaja, al no tener ese mismo offset
condicional, quedaba a veces alineada con el logo y a veces no, según
el ancho.

Fix: la migaja ya no es un elemento `fixed` con coordenadas propias —
ahora vive DENTRO del contenedor del logo (`<div className="relative
flex shrink-0 flex-col ...">`, que envuelve el `<Link>` del wordmark) y
se posiciona con `absolute left-0 top-full mt-1`, es decir, relativa al
logo mismo, no al viewport. Así queda pegada justo debajo y alineada a
la izquierda del logo en cualquier ancho de pantalla, sin ningún cálculo
de píxeles que mantener sincronizado — la posición sale sola de dónde
termina el logo, no de una suposición sobre su alto. Sigue siendo un
elemento visualmente propio (no una fila más del `<nav>` de pestañas —
eso se había pedido evitar explícitamente en una instrucción anterior),
solo que ahora ancla su posición al logo en vez de al viewport. Tamaño
de texto bajado de `text-sm` a `text-xs` para que quede proporcionado
bajo un logo compacto (nadie lo pidió puntualmente, pero a `text-sm`
se veía desbalanceado tan pegado). El resto de la lógica (migajas por
segmento de ruta, animación de deslizamiento, "|" dorado) no cambió.
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos que en §7.37-7.40) —
  pendiente que el usuario lo confirme con `npm run dev`.

### 7.42 Tablero de "TRANSFORMA" sacado

Se sacó el `<svg className="lw-checker">` (las 4 filitas agregadas en
§7.38 replicando la referencia) — vuelve a ser solo texto, igual que
"Belleza"/"que". Clase `.lw-checker` borrada de `index.css` al quedar
sin uso.

(Este mismo pedido incluía además bajar el `max-w` del hero de 1800px
a 1400px para que coincidiera con el del header — se implementó y el
usuario pidió revertirlo enseguida, sin llegar a explicar por qué
distinto de lo que ya se había entendido; el hero quedó de nuevo en
`max-w-[1800px]`, a la espera de que el usuario reexplique qué quiere
ahí.)
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos que en §7.37-7.41) —
  pendiente que el usuario lo confirme con `npm run dev`.

### 7.43 Vuelta a max-w-[1400px] en toda la sección — y otra vez "revertilo" (esta sí, mal entendido)

Primer intento de reexplicación del usuario: capar la `<section>`
entera (foto incluida) a `max-w-[1400px]`, igual que el header. Se
implementó igual que en §7.38/§7.42 y el usuario pidió revertir de
nuevo, aclarando esta vez el motivo real (ver §7.44): no quería que la
FOTO se acotara a 1400px, solo el contenido de texto/botón — la foto
debía seguir creciendo hasta 1800px. Revertido a `max-w-[1800px]` en
la `<section>` tal cual estaba antes de este apartado.

### 7.44 Fix real: columna de contenido propia en max-w-[1400px], la `<section>` de 1800px queda intacta

Aclaración final del usuario, con captura: la `<section>` en 1800px
está bien (ahí la foto puede seguir creciendo libre) — el problema es
que el CONTENIDO (título grande, botón "Reserva tu cita", y el hint del
cursor) se estiraba pegado al ancho de esa sección de 1800px en vez de
quedarse en los 1400px del header, así que a partir de 1400px de ancho
de ventana el texto quedaba corrido a la derecha del logo, ya no
alineado con él.

Fix: se sacó todo el padding (`px-6 pb-8 pt-24...`) y el
`justify-between` de la `<section>` misma, y se movieron a un `<div>`
nuevo adentro de ella — `mx-auto flex w-full max-w-[1400px] flex-1
flex-col justify-between` — que envuelve el bloque de título/botón y el
hint (la foto de fondo, en su propio `absolute inset-0`, queda AFUERA
de este div nuevo, así que sigue llenando toda la sección de 1800px sin
tocarse). La matemática de por qué esto alinea con el logo en cualquier
ancho: centrar una caja de 1400px con `mx-auto` DENTRO de otra caja de
1800px que a su vez está centrada en la pantalla da el mismo borde
izquierdo, para cualquier ancho de ventana, que centrar esos mismos
1400px directo en la pantalla (que es lo que hace la fila del header en
`PortalCliente.jsx`) — centrar es asociativo, no hace falta que las dos
cajas midan lo mismo para que su contenido quede a la par.
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos que en §7.37-7.43) —
  pendiente que el usuario lo confirme con `npm run dev`.

### 7.45 Los 1400px coincidían, pero el padding interno de cada uno no — título corrido del logo

§7.44 alineó los DOS contenedores de 1400px entre sí (mismo borde
izquierdo matemático), pero cada uno tenía su propio padding interno
distinto: adentro de la fila del header el logo arranca pegado al
borde (padding 0, solo `gap-3` con lo que esté antes), mientras que la
columna de contenido nueva tenía `px-6 sm:px-10 md:px-16` propio —
mucho más que el `px-4 sm:px-6 md:px-8` real del `<header>`. El usuario
lo encontró con el inspector (title con padding que, puesto en 0,
alineaba) y agregó un matiz: al ACHICAR la pantalla el desfasaje se
invierte, porque el header tiene un botón de hamburguesa (`-ml-2 h-11
w-11 ... lg:hidden`) que corre el logo hacia la derecha en pantallas
angostas y recién desaparece en `lg` (1024px) — el texto de abajo no
tenía ningún corrimiento equivalente.

Fix: `px-6 sm:px-10 md:px-16` → `pl-*`/`pr-*` separados.
- `pr-4 sm:pr-6 md:pr-8`: copia tal cual el padding propio del
  `<header>` — del lado derecho no hay nada más que compensar.
- `pl-16 sm:pl-[72px] md:pl-20 lg:pl-8`: el mismo padding del header
  MÁS el ancho real que ocupa el botón de hamburguesa + su gap cuando
  está visible — `-ml-2 h-11 w-11` = 36px netos + `gap-3` = 12px = 48px
  extra, sumados al padding del header en cada breakpoint (16+48=64,
  24+48=72, 32+48=80) hasta `lg` (1024px), donde el botón desaparece y
  el valor CAE de vuelta a 32px (`lg:pl-8`, sin los 48px) — no es un
  crecimiento monótono, es literal el mismo salto que da el header.

Advertencia dejada en el comentario del código: estos números están
calculados a mano a partir de los valores actuales del `<header>` de
`PortalCliente.jsx` (padding, tamaño del botón, gap, breakpoint
`lg:hidden`) — si alguno de esos cambia ahí, hay que recalcular acá
también. No hay forma de derivarlo automáticamente sin tocar el
`<header>`, que el usuario pidió explícitamente no tocar en esta
tanda de cambios.
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos que en §7.37-7.44) —
  pendiente que el usuario lo confirme con `npm run dev`.

### 7.46 Simplificado a un padding fijo de 32px en la sección, no en la columna

El usuario pidió simplificar §7.45: en vez del padding responsivo
(distinto por breakpoint, sumando el ancho del botón de hamburguesa)
en la columna de contenido de 1400px, mover un padding fijo de 32px
(`px-8`, sin variar) a la `<section>` de 1800px de afuera, y dejar la
columna de 1400px sin padding propio (pegada a sus propios bordes).

La columna de contenido perdió `pl-16 pr-4 sm:pl-[72px] sm:pr-6
md:pl-20 md:pr-8 lg:pl-8` (mantiene `pb-8 pt-24 sm:pb-10 sm:pt-28`, el
padding vertical no cambió) y la `<section>` de 1800px sumó `px-8`.
Verificado que el padding nuevo en la sección no afecta a la foto de
fondo: esa vive en un `<div>` `absolute inset-0` — el padding de un
elemento no reduce el área de sus hijos posicionados en absoluto, así
que la foto sigue llenando los 1800px enteros.
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos que en §7.37-7.45) —
  pendiente que el usuario lo confirme con `npm run dev`.

### 7.47 Mismo bug de zoom pero por alto de ventana; unificar el fondo a #0b0b0c

**Zoom vertical pasados ~1190px de alto.** Mismo mecanismo que
§7.39-7.40 (recorte de `object-cover` cuando la caja no respeta la
relación de aspecto nativa de la foto), esta vez por el eje que no se
había cubierto: `min-h-[85svh]` no tenía condición de breakpoint, así
que en una ventana ancha Y alta a la vez, ese piso podía pedir más alto
del que `aspect-[1680/944]` da a los 1800px de ancho tope
(1800×944/1680 ≈ 1011px) — a partir de ~1190px de alto de ventana
(1011/0.85), el piso ganaba y estiraba la sección más alta que su
relación de aspecto nativa, volviendo el mismo recorte/zoom pero
vertical. Fix: `md:min-h-0` — el piso de 85svh sigue existiendo SOLO
por debajo de `md` (768px), que es donde de verdad hace falta (celular,
donde aspect-ratio solo daría una caja demasiado baja); de `md` para
arriba se confía 100% en `aspect-[1680/944]`, sin piso que lo
sobrepase.

**Fondo unificado a #0b0b0c.** El usuario pidió "reemplazar el negro
gris por #0B0B0C" — interpretado como: unificar el `--lw-bg` de TODO
`.landing-web` (antes `#000000` puro, usado por defecto en el resto de
secciones de Inicio — Sobre nosotros, Video destacado, Filosofía,
Servicios — y en el resto del portal cliente) al mismo tono que ya
tenía el hero (`bg-[#0b0b0c]`, InicioCliente.jsx) — antes había una
costura sutil entre el hero y el resto de las secciones al hacer
scroll, cada uno en un negro ligeramente distinto. Si la intención real
era otra (por ejemplo, solo el color de algún elemento puntual del
hero), avisar para corregir — el hero ya usaba `#0b0b0c` en todos sus
elementos desde §7.36-7.39, no había ningún "negro gris" distinto ahí
para reemplazar.
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos que en §7.37-7.46) —
  pendiente que el usuario lo confirme con `npm run dev`.

### 7.48 El hint ("Pasa el cursor...") a position:absolute, esquina de la foto

El `justify-center` de §7.47 tenía un efecto secundario: el hint vivía
como hermano del bloque de título dentro del mismo `flex-col
justify-center` — con los dos en flujo, "centrar" centraba el PAR
completo (título + hint apilados), no el título solo, así que el título
quedaba corrido hacia arriba en vez de centrado de verdad. El usuario
dio dos salidas (sacarlo del todo, o pasarlo a `position:absolute` en
la esquina de la foto) — se tomó la segunda: el hint sigue estando,
ahora como hermano de la columna de 1400px (no adentro de ella), con
`absolute bottom-8 right-8` clavado a la esquina inferior derecha de la
`<section>` de 1800px (la foto), fuera del flujo — ya no participa del
cálculo de centrado de nada, así que el título ahora sí centra solo.
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos que en §7.37-7.47) —
  pendiente que el usuario lo confirme con `npm run dev`.

### 7.49 Sin piso de alto en ningún ancho (celular incluido); título ya escalaba fluido

Dos pedidos, uno ya estaba resuelto:

- **Que el celular tenga el mismo formato que desktop.** Se sacó
  `min-h-[85svh] md:min-h-0` (§7.47) del todo — ya no hay ningún piso de
  alto en ningún ancho, `aspect-[1680/944]` manda siempre, celular
  incluido, así que la sección mantiene la MISMA proporción que la foto
  en cualquier tamaño de pantalla.
  ⚠️ Aviso importante: `pt-24 sm:pt-28`/`pb-8 sm:pb-10`/`gap-[28px]`
  dentro del hero son valores FIJOS en px, no escalan con el ancho. En
  un celular angosto (375px de ancho, por ejemplo), `aspect-[1680/944]`
  solo da ~210px de alto — pero el título (aunque sea al piso mínimo de
  40px del `clamp`, 3 líneas) más el botón más esos paddings/gaps fijos
  necesitan bastante más que eso para entrar. El navegador no recorta
  contenido visible por las suyas: si no entra, la sección termina más
  alta que lo que el aspect-ratio puro pediría (el contenido "gana"),
  no es que el aspect-ratio se ignore, es que hay un mínimo de espacio
  que el título+botón necesitan y eso pone un piso de facto aunque ya
  no haya un `min-h` explícito. Si en el celular real se ve más alto de
  lo esperado (la foto un poco más recortada de lo ideal), es por esto
  — para que la sección respete el aspect-ratio también ahí, habría que
  además reducir esos paddings/gaps fijos en pantallas angostas (no
  pedido explícitamente esta vez, así que no se tocó).
- **Escala automática de la letra del título, sin saltos de
  breakpoint.** Ya estaba así desde §7.44 —
  `text-[clamp(40px,5.2vw,74px)]` en `.lw-titulo-kunaroh` (no clases
  `text-5xl sm:text-6xl md:text-7xl` con saltos fijos) — el tamaño baja
  de forma continua con el ancho de la ventana entre 40px y 74px, sin
  ningún salto. No hizo falta cambiar nada ahí.
- El usuario también notó (sin pedir cambio) que el hint "Pasa el
  cursor..." ya está oculto en celular (`hidden sm:flex`) — correcto,
  tiene sentido porque no hay mouse; eso ya estaba así desde §7.38 y
  sigue igual.
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos que en §7.37-7.48) —
  pendiente que el usuario lo confirme con `npm run dev`, ESPECIALMENTE
  en un celular real o el emulador de DevTools, por el aviso de arriba.

### 7.50 Se cumplió el aviso de §7.49: layout roto en celular — todo el bloque a clamp()

Exactamente lo que se avisó en §7.49: en celular (captura del usuario)
el título a 40px + el padding/gap fijos no entraban en la sección, ya
mucho más baja sin `min-h` — el hero terminaba mucho más alto que la
foto, con una franja negra enorme debajo del botón. El usuario pidió
dos cosas: bajar el piso mínimo del título (se veía "muy grande" en
celular) y que el celular se vea como el MISMO formato de desktop "en
miniatura", no roto.

Fix: se extendió el mecanismo `clamp()` que ya tenía el título
(§7.44) a TODO lo demás del bloque de contenido, para que achique junto
con el título en vez de quedarse fijo:
- Título: `clamp(24px,5.2vw,74px)` (antes `40px` de piso).
- Gap entre título/botón: `clamp(12px,3vw,28px)` (antes `28px` fijo).
- Padding vertical de la columna: `pt-[clamp(28px,8vw,112px)]
  pb-[clamp(16px,3vw,40px)]` (antes `pt-24 pb-8 sm:pt-28 sm:pb-10`,
  saltos de breakpoint).
- Botón "Reserva tu cita" (`.lw-cta-hero` en `index.css`): `padding:
  clamp(10px,2.5vw,14px) clamp(16px,4vw,26px)`, `font-size:
  clamp(11px,2vw,13px)`, `gap: clamp(8px,2vw,14px)` (antes `14px 26px`/
  `13px`/`14px` fijos).

Todos comparten el mismo patrón: un piso chico (celular), un techo
igual al valor desktop que ya existía (sin cambiar cómo se ve en
pantallas grandes), y una pendiente en `vw` en el medio sin saltos —
mismo criterio que pidió el usuario para el título, aplicado en
consistencia a todo lo que antes tenía un tamaño fijo. `EsquinaBracket`
(14×14px) se dejó fijo, es un acento decorativo chico, no aporta al
problema de espacio.
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos que en §7.37-7.49) —
  pendiente que el usuario lo confirme con `npm run dev` en celular.

### 7.51 Header con fondo sólido — deshace el bleed de la foto de Inicio bajo el header

El usuario notó que el header transparente/flotante (diseño desde
§7.36) "se mezcla con todo" al hacer scroll, y pidió fondo negro —
pero avisando de entrada que eso NO debía tapar la punta de la cabeza
de la clienta en el hero de Inicio.

Eso hizo falta deshacer una pieza clave de §7.37: la foto de Inicio
llegaba hasta atrás del header (bleed) PORQUE el header era
transparente — con fondo sólido, "detrás del header" pasa a ser
"tapado por el header", literal la franja negra que el usuario quería
evitar. Cambios:
- `<header>`: `bg-[#0b0b0c]` agregado (antes sin fondo propio).
- El `<div>` que envuelve `<Outlet/>` en `PortalCliente.jsx` (el que
  reserva `pt-16 sm:pt-[72px]` para compensar el alto del header) ya NO
  se salta ese padding en `/inicio` — antes era condicional
  (`esInicio ? '' : 'pt-16 sm:pt-[72px]'`), ahora es fijo, igual que el
  resto de la Web. Toda la estructura (hero incluido) vuelve a arrancar
  debajo del header, no detrás.
- `InicioCliente.jsx`: la columna de contenido tenía `pt-[clamp(28px,
  8vw,112px)] max-[640px]:pt-28` — mucho más grande que su `pb`, a
  propósito, para compensar el alto del header que antes quedaba
  flotando ENCIMA de la foto (necesitaba empujar el título hacia abajo
  para que no quedara tapado). Con el header ahora reservando su propio
  espacio afuera, ese padding extra ya no hace falta — mantenerlo
  hubiera sumado el hueco del header DOS veces y descentrado el título
  para abajo. Se igualó a `pb`: `py-[clamp(16px,3vw,40px)]` simétrico,
  sin el override de celular (tampoco hace falta: el wrapper ya
  garantiza el espacio del header en cualquier ancho).
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos que en §7.37-7.50) —
  pendiente que el usuario lo confirme con `npm run dev`, especialmente
  que el header ya no deje ver nada detrás al hacer scroll y que la
  cabeza de la foto de Inicio no quede cortada por el header.

### 7.53 El ícono del carrito, parado en /carrito, vuelve a la pestaña anterior (no a Inicio)

Pedido: al tocar el carrito se abre `/carrito` (comportamiento de
siempre); si YA estás en `/carrito` y lo volvés a tocar, tiene que
volver a la página desde la que entraste (ej. Productos → carrito →
tocar de nuevo → Productos), no a Inicio.

`BotonCarrito` ahora recibe `estaEnCarrito` (calculado en
`PortalCliente.jsx` igual que `esInicio`: `location.pathname ===
'/carrito'`). Fuera de `/carrito` sigue siendo un `<Link to="/carrito">`
normal, sin cambios. Parado en `/carrito`, se renderiza como `<button
onClick={() => navigate(-1)}>` en vez del Link — un paso atrás en el
historial del navegador, que es justo la página desde la que se llegó
al carrito. Mismo ícono/insignia en los dos casos (`contenido`
compartido, solo cambia el elemento que lo envuelve). No se guarda la
ruta "anterior" en ningún estado propio: se apoya 100% en el historial
del navegador (`react-router`'s `navigate(-1)`), así que si alguien
entra a `/carrito` directo por URL (sin historial previo dentro de la
app), "volver" hace lo que el navegador haría con su botón atrás —
caso borde no pedido, no se resolvió aparte.
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual/funcional en vivo (mismo bloqueo de permisos que en
  §7.37-7.51) — pendiente que el usuario lo pruebe con `npm run dev`.

### 7.54 Mismo "volver" en el ícono del chanchito

Mismo patrón que §7.53, aplicado a `BotonChanchito`: recibe
`estaEnPuntos` (`location.pathname === '/mis-puntos'`, calculado en
`PortalCliente.jsx`). Fuera de `/mis-puntos` sigue siendo `<Link
to="/mis-puntos">` normal; parado ahí, se renderiza como `<button
onClick={() => navigate(-1)}>`. Mismas salvedades que §7.53 (depende
del historial del navegador, no de un estado propio de "página
anterior").
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual/funcional en vivo (mismo bloqueo de permisos que en
  §7.37-7.53) — pendiente que el usuario lo pruebe con `npm run dev`.

### 7.55 Ícono de chanchito propio (SVG del usuario), espejado hacia el logo

El usuario trajo dos SVG a `public/icons/` (`chanchitoActivo.svg`,
`chanchitoBloqueado.svg` — un chancho tipo alcancía y la misma versión
con una barra diagonal encima) y pidió reemplazar el `PiggyBank` de
lucide-react por el activo, mirando hacia el logo (a la izquierda del
grupo de íconos del header). El bloqueado queda reservado sin usar
todavía, para el día que algún producto/servicio puntual no sume
puntos.

No se referenció el archivo con `<img src=".../chanchitoActivo.svg">`:
un `<img>` de un SVG externo no hereda `currentColor` de sus estilos
(el navegador lo pinta con el color que declare el propio archivo, o
negro por defecto) — se hubiera visto siempre negro sólido, sin
reaccionar al hover/tema como el resto de íconos del header. Se
inlineó como componente `IconoChanchito` (mismo `d` del archivo, cambia dueño de
formato attrs SVG→JSX) — mismo patrón que `EsquinaBracket`/`.lw-checker`
del hero, que ya vive en este codebase.

El dibujo original mira hacia la derecha (hocico del lado del carrito/
avatar) — se agregó `-scale-x-100` (espejado horizontal) para que mire
hacia la izquierda, hacia el logo. `PiggyBank` se sacó del import de
`PortalCliente.jsx` (sigue usándose en `Web.jsx`, `PuntosWeb.jsx` y
`navegacion.js` del POS — archivos aparte, no se tocaron).
- Build y lint verificados (incluida una comprobación directa de que
  Tailwind generó la clase `-scale-x-100` en el CSS final, no quedó
  como texto sin efecto). Sin verificación visual en vivo (mismo
  bloqueo de permisos que en §7.37-7.54) — pendiente que el usuario lo
  confirme con `npm run dev`.

### 7.56 Menú lateral (drawer móvil): migaja se oculta al abrirlo, pestaña seleccionada en azul metálico

Cierre del bloque header/hero, arranca el drawer móvil
(`MenuLateralCliente.jsx`). Dos pedidos:

- **La migaja se oculta con el drawer abierto.** Se agregó `!menuAbierto`
  a la condición que ya decidía si mostrarla (`PortalCliente.jsx`) —
  reutiliza el mismo estado `menuAbierto` que ya maneja el botón de
  hamburguesa, sin estado nuevo. Al cerrar el drawer, la migaja
  reaparece sola (la condición vuelve a ser verdadera).
- **Azul metálico en la pestaña seleccionada + el ícono X.** En
  `MenuLateralCliente.jsx`, la pestaña activa del drawer pasa de
  `border-[var(--lw-gold)]`/dorado a `#a9c6ec` sólido (borde + ícono,
  vía `currentColor`) con el label en degradado real
  (`.lw-metal-azul-texto`, convertido el `NavLink` a render-prop para
  poder separar el ícono — mismo motivo que el botón "Reserva tu cita"
  del hero: `background-clip:text` no recorta un `<svg>`, solo texto de
  verdad, así que el degradado va aparte en un `<span>`, no en todo el
  link). El ícono `<X>` del botón de hamburguesa (`PortalCliente.jsx`)
  también pasa a `#a9c6ec` cuando el menú está abierto.
  **A diferencia del resto del header** (nav, migaja, carrito — azul
  SOLO cuando `esInicio`, dorado en cualquier otra pestaña), acá el
  usuario no condicionó el pedido a la ruta, así que el azul metálico
  del drawer queda fijo siempre, sin importar en qué pestaña esté
  parado — el drawer mismo se puede abrir desde cualquier página.
  Si la intención real era la misma regla condicional de siempre,
  avisar — se resuelve pasando `esInicio` como prop.
- Build y lint verificados, sin warnings nuevos. Sin verificación
  visual en vivo (mismo bloqueo de permisos que en §7.37-7.55) —
  pendiente que el usuario lo confirme con `npm run dev`.

### 7.57 El azul metálico se retira de "solo Inicio" y pasa a ser el acento de TODO el portal cliente

Cambio grande, confirmado explícitamente por el usuario ("efectivamente
quería llegar a ese punto"): el dorado (`--lw-gold`) deja de ser el
acento del portal cliente — el azul metálico, que venía "por ahora
solo en Inicio" desde §7.36, pasa a ser el color estándar en todas las
pestañas. Se investigó el alcance primero con un agente de exploración
antes de tocar nada, para no romper 20+ archivos a ciegas.

**Hallazgo clave que definió el enfoque**: `--lw-gold` está declarada
UNA sola vez, dentro de `.landing-web { }` en `src/index.css` — es una
custom property scoped, y el POS usa su propia variable separada
(`--gold-1`), sin overlap. Eso significa que cambiar el VALOR de
`--lw-gold` (no su nombre) recolorea automáticamente los ~130 usos que
ya existían en ~20 archivos del portal cliente — textos, bordes,
íconos, focus rings, degradados de fondo tenues (`/10`, `/15`), sin
tocar esos archivos uno por uno. Se cambió `#ffd700` → `#a9c6ec` (el
tono sólido del degradado `--lw-metal-azul`, ya usado en el hero) en
`src/index.css:973`. El NOMBRE de la variable se dejó igual a
propósito — renombrarla implicaría tocar cada uno de esos ~130 usos
por un beneficio puramente cosmético; queda documentado como deuda
técnica en el comentario de la declaración, no como bug.

**Lo que el cambio de variable NO resuelve solo — dos categorías aparte**:

1. **Botones sólidos tipo "Agregar" → estilo fantasma** (borde + letra
   azul, sin fondo, mismo lenguaje que el botón "Reserva tu cita" del
   hero — aunque sin la técnica de máscara/border-radius del hero, que
   sería excesiva para ~17 botones repartidos en toda la app: acá alcanza
   con un borde plano `border-[var(--lw-gold)]`, ya que la variable dejó
   de ser dorada). El patrón `bg-[var(--lw-gold)] ... text-black` no se
   arregla solo con el cambio de variable — hubiera quedado un botón
   RELLENO de azul con letra negra, no "sin fondo" como se pidió. Se
   convirtió cada uno a `border border-[var(--lw-gold)] bg-transparent
   ... text-[var(--lw-gold)]`:
   - `DireccionesCliente.jsx:97` "Agregar"
   - `SeguridadCuentaCliente.jsx:112` "Cambiar contraseña"
   - `ReferidosCliente.jsx:110` "Ir a Mi Perfil", `159` "Compartir por
     WhatsApp", `215` "Aplicar" (código de referido — no estaba en el
     relevamiento inicial del agente, apareció en un barrido final)
   - `CitasCliente.jsx:185` "Agendar"
   - `CarritoCliente.jsx:264` "Reservar cita", `444` botón de confirmar
     pedido de productos
   - `MisResenasCliente.jsx:157` "Publicar reseña"/"Guardar cambios"
   - `NosotrosCliente.jsx:275` "Escríbenos por WhatsApp"
   - `MiPerfil.jsx:245` botón circular de editar foto (con
     `bg-[#0b0b0c]` en vez de transparente del todo — es un ícono
     chico superpuesto en la esquina del avatar; transparente ahí
     dejaba la foto de la clienta bleeding detrás del lápiz, poco
     legible — desviación a criterio, avisar si se prefiere
     transparencia literal igual), `326` "Guardar", `336` "Editar",
     `384` "Sí, es mi registro"
   - `ModalAgendarCitaCliente.jsx:333` "Confirmar cita"
   - `ModalDireccionCliente.jsx:187` "Guardar"
   - `ModalReprogramarCitaCliente.jsx:176` "Confirmar"
2. **`PortalCliente.jsx`**: se sacaron los condicionales `esInicio ?
   azul : dorado` que ya existían (nav activo + subrayado, migaja
   "Inicio"/"|", insignia del carrito) — ahora usan azul metálico
   siempre, sin condicional. `BotonCarrito` perdió la prop `esInicio`
   (ya no la necesita). `MenuLateralCliente.jsx` no necesitó cambios de
   código (ya usaba azul fijo desde §7.56), solo se actualizó un
   comentario que había quedado desactualizado.

**Lo que se dejó SIN convertir a "fantasma" a propósito** (quedan
rellenos, solo cambian de dorado a azul automáticamente vía la
variable): indicadores de selección/estado, no botones de acción —
día de calendario seleccionado (`CitasCliente.jsx:246/257`,
`ModalAgendarCitaCliente.jsx:290`, `ModalReprogramarCitaCliente.jsx:148`),
chip de categoría activa (`ServiciosCliente.jsx:200`,
`ProductosCliente.jsx:203`), pestaña activa de Nosotros
(`NosotrosCliente.jsx:336`), insignias de conteo (carrito, notificaciones
sin leer en `MenuUsuarioCliente.jsx`/`NotificacionesCliente.jsx`),
etiqueta "NEW" de ofertas (`OfertasCliente.jsx:95`), pills de estado
("Pendiente", "Predeterminada", etc.). Si alguno de estos también
debería pasar a fantasma, avisar puntualmente — se decidió mantenerlos
rellenos porque son indicadores de estado/selección, no llamados a la
acción, y un relleno sólido cumple mejor esa función que un contorno.
- Build y lint verificados en cada archivo tocado, sin warnings nuevos.
  Verificado con grep que no queda ningún `bg-[var(--lw-gold)]
  ... text-black` (patrón de botón sólido) sin convertir en el portal
  cliente. Sin verificación visual en vivo (mismo bloqueo de permisos
  que en §7.37-7.56) — pendiente que el usuario lo confirme con
  `npm run dev`, revisando varias pestañas (no solo Inicio) dado lo
  amplio del cambio.
- Ajuste chico posterior, sin sección propia: en la migaja de pan
  (`PortalCliente.jsx`), el segmento de la SUBPÁGINA actual (ej.
  "Productos" en "Inicio | Productos") se quedó en blanco liso — el "|"
  ya estaba en azul metálico desde este mismo §7.57, pero el usuario
  notó que el título de la página activa también debía llevarlo. Pasó
  de `text-white` a `lw-metal-azul-texto`, igual que el "|". "Inicio"
  (cuando NO es la página actual) se queda atenuado — es el ancestro
  del breadcrumb, no lo activo.

### 7.58 Fidelización: canje real (cupón de %) + historial de visitas; historial de cupones en Referidos

El usuario probó el flujo end-to-end (reserva → completar cita → sello;
registro manual en Mi Panel → sello) y preguntó qué pasaba al cancelar
en cada caso y al completar los 5 sellos — investigado en el SQL real
antes de tocar nada (sin suponer):
- Cancelar una cita ya COMPLETADA está bloqueado tanto en el lado
  cliente (`cancelar_mi_cita_web`) como en el POS (`Citas.jsx`) — nunca
  se puede perder un sello ya ganado cancelando después.
- Cancelar un registro manual de Mi Panel ya funcionaba bien desde
  antes (`23_registro_servicios_estado.sql`, "cancelar, no eliminar"):
  pasa a `estado='CANCELADO'` y `mi_fidelizacion()` ya filtraba por
  `estado='ACTIVO'`, así que el sello se resta solo, sin tocar nada.
- Al llegar a 5 sellos, `sellos_actuales = visitas % 5` (da 0, "tarjeta
  vacía" de nuevo) y `recompensas_disponibles = visitas / 5` — pero
  hasta este punto NO había forma real de canjear esa recompensa, solo
  un cartel pidiendo que se mencione de palabra en caja.

A partir de esa conversación, el usuario propuso el canje real:
generar un cupón de verdad al completar la tarjeta, reutilizando el
sistema de cupones que ya existe para Referidos (mismo `cupones` +
`mis_cupones()` + modo "Cupón" en Ventas), con niveles Bronce/Plata/Oro
(que también ya existían, §7.35 — el usuario los estaba re-proponiendo
sin saber que ya estaban hechos) y un historial en cada pestaña.

**Gap real encontrado antes de escribir nada** (por eso no alcanzaba
con solo conectar lo que ya había): `cupones.valor` siempre se trataba
como monto fijo en soles — `confirmar_venta()` lo restaba directo del
total, así que un cupón de 20% se hubiera cobrado como "S/20 de
descuento" en vez de "20% de descuento". Y `recompensas_disponibles`
se calculaba 100% al vuelo desde las visitas, sin ningún registro de
cuántas ya se reclamaron — sin eso, "Generar cupón" se podía tocar
infinitas veces con las mismas 5 visitas.

**SQL (`97_cupones_fidelizacion.sql`, aplicada y verificada en vivo —
firmas de las 4 funciones confirmadas con `pg_get_function_result`):**
- `cupones.tipo_descuento` (`MONTO_FIJO` default | `PORCENTAJE`) — mismo
  patrón que ya usaba `promociones.tipo_descuento` (79_promociones.sql).
  `origen` suma `'FIDELIZACION'` a su check.
- `mis_cupones()` recibió un `drop function` (Postgres no deja cambiar
  el tipo de retorno con `create or replace`, solo el body — mismo tipo
  de hueco que ya había documentado 95_ sobre `confirmar_venta`, acá se
  encontró aplicando esto en vivo y se corrigió ahí mismo) para sumar
  `tipo_descuento` a lo que devuelve — sin esto el frontend no tenía
  forma de saber si un cupón es % o monto fijo.
- `config_fidelizacion` (singleton id=1, mismo patrón que
  `config_puntos`/`config_referidos`): `porcentaje_recompensa`, default
  20 (la regla de negocio original, "5 sellos = 20%", no un número
  inventado). Editable por admin — falta el panel del POS para
  tocarlo desde la UI (hoy solo vía SQL directo), igual que pasó al
  principio con `puntos_bono` en §7.16 — no se armó por no haberlo
  pedido explícitamente, mismo criterio.
- `clientes.fidelizacion_recompensas_reclamadas` (int, default 0) —
  el contador que faltaba. `mi_fidelizacion()` ahora resta esto de
  `visitas/5` (con `greatest(...,0)`, nunca negativo).
- `generar_cupon_fidelizacion()` (nueva): recalcula TODO en el
  servidor (visitas, reclamadas, disponibles) sin confiar en nada del
  navegador, con `for update` sobre la fila de `clientes` para que dos
  taps rápidos no reclamen la misma recompensa dos veces. Si hay
  disponible, +1 al contador y crea el cupón (`origen='FIDELIZACION'`,
  `tipo_descuento='PORCENTAJE'`, `valor` = el % vigente de
  `config_fidelizacion`) + notificación.
- `mi_historial_fidelizacion()` (nueva): fechas distintas de
  `registro_servicios` activos del cliente — mismo criterio de
  "visita" que ya usaba `mi_fidelizacion()`. Sirve como historial de
  sellos Y de visitas a la vez (van ligados 1 a 1, pedido del usuario).
- `confirmar_venta()`: el canje de un cupón ahora mira su
  `tipo_descuento` — porcentaje aplica `% sobre el total` (mismo
  cálculo que el descuento manual por %), monto fijo sigue restando
  soles como siempre (cupones de Referidos sin cambios de
  comportamiento). `ventas.descuento_pct`/`descuento_monto` también
  reflejan el tipo real canjeado, para que los reportes de ventas no
  queden mintiendo un descuento en soles cuando en realidad fue un %.
  Misma firma de siempre (mismos parámetros) — no hizo falta `drop`
  esta vez, `create or replace` alcanzaba.

**Frontend:**
- `src/lib/cupones.js`: `nivelCupon(valor, tipoDescuento)` ahora tiene
  DOS escalas de umbrales independientes (Bronce/Plata/Oro) — una para
  soles, otra para puntos de %, porque un cupón de 20% y uno de S/20
  no son comparables en la misma regla (decisión del usuario, con
  pregunta explícita de por medio). Mismos números hoy (10/20) en las
  dos escalas, pero son dos objetos separados — pueden divergir a
  futuro sin tocarse entre sí. Nueva `formatearValorCupon(cupon)`
  (antes vivía a medias, duplicada, como `formatearValor()` local en
  `OfertasCliente.jsx` solo para `promociones`) — ahora la usa también
  `TarjetaCupon.jsx`, que dejó de asumir siempre soles.
- `FidelizacionCliente.jsx`: botón "Generar cupón" (llama a
  `generar_cupon_fidelizacion()`, refetch completo al terminar — nunca
  un ajuste optimista a mano, para que `recompensas_disponibles` quede
  exactamente lo que el servidor validó) dentro del cartel de
  recompensa disponible. Nueva sección "Ver historial de visitas"
  (`mi_historial_fidelizacion()`), cerrada por defecto, mismo patrón
  acordeón que ya usa `TarjetaCupon` (`CampoColapsable` + `ArrowBigDown`
  girando 180°).
- `ReferidosCliente.jsx`: la lista "Tus cupones" ahora filtra a
  `ORIGENES_REFERIDOS` (antes mostraba TODOS los cupones de la
  clienta sin filtrar — con Fidelización generando los suyos, se
  hubieran mezclado ahí) — Fidelización tiene su propio historial
  aparte, no comparten pantalla aunque lean la misma tabla. Nueva
  sección "Ver historial" (fecha de generación de cada cupón de
  Referidos), cerrada por defecto, mismo patrón acordeón — distinta
  del acordeón individual que ya tenía cada `TarjetaCupon` (ese es por
  cupón, este es la lista completa de una sola vez).
- `/ofertas` ("Cupones y ofertas") NO se tocó — sigue mostrando TODOS
  los cupones de cualquier origen sin filtrar (su rol ya era ser la
  vista combinada), ahora con el valor/nivel bien mostrado también
  para los de Fidelización gracias a los cambios de arriba.
- Build y lint verificados en cada archivo, sin warnings nuevos. SQL
  aplicada y verificada en vivo (firmas confirmadas, `config_
  fidelizacion` con su fila default, ningún cliente real con 5+
  visitas todavía así que no se pudo probar el camino feliz completo
  del botón — sí se verificó que el cálculo no rompió nada para los
  clientes reales existentes, `fidelizacion_recompensas_reclamadas=0`
  en todos). Sin verificación visual en vivo del frontend (mismo
  bloqueo de permisos que en §7.37-7.57) — pendiente que el usuario lo
  pruebe con `npm run dev` cuando algún cliente llegue a 5 visitas.

### 7.59 Dos bugs del §7.58: cupón de % cobrado como monto fijo en Ventas, "Fidelización Web" invisible en el panel

El usuario probó de verdad (Turqui llegó a 5 visitas, generó su cupón
de 20%) y encontró dos problemas al canjearlo en el POS y al buscar el
panel nuevo.

**"Fidelización Web" no aparecía en el panel de admin.** Causa: agregar
la pestaña a `navegacion.js` (§7.58) solo controla el menú lateral
móvil — el panel de escritorio (`Web.jsx`) tiene su PROPIA lista de
tarjetas/links a cada subpestaña, a mano, separada de `navegacion.js`
(mismo patrón que ya usan Promociones/Pedidos Web/Reseñas/Contacto
Web/Puntos Web/Referidos Web ahí). Se me pasó agregarla ahí también —
agregado el link que faltaba.

**El cupón de 20% se cobraba como si fuera S/20 fijos.** Investigado
antes de tocar nada: el cupón de Turqui seguía `estado='DISPONIBLE'`
en la base (nunca llegó a canjearse de verdad, así que esto era 100%
un bug del lado del cliente/POS, no del RPC `confirmar_venta()` que
ya distinguía % de monto fijo desde §7.58). Encontrados DOS lugares en
`Ventas.jsx` que databan por sentado que un cupón siempre es monto fijo
en soles, ninguno tocado en §7.58 porque en ese momento no existían
cupones de % todavía:
- El preview al escribir el código (`"Cupón de X — S/20.00"`) usaba
  `formatearSoles(cuponPreview.valor)` siempre — la consulta que arma
  ese preview ni siquiera pedía `tipo_descuento` a la base. Se agregó
  esa columna al `select` y el texto ahora dice "20%" cuando corresponde.
- Más grave: el cálculo de `montoDescuento` (el que arma el "Total" y
  el "Vuelto" que ve la cajera en pantalla ANTES de confirmar) hacía
  `Math.min(cuponPreview.valor, subtotal)` sin mirar el tipo — un cupón
  de 20% restaba 20 soles planos en vez de calcular el 20% del
  subtotal. Esto no afectaba lo que se termina cobrando de verdad
  (`confirmar_venta()` ya lo hacía bien, valida todo de nuevo en el
  servidor sin confiar en el total del navegador), pero la cajera veía
  un número de cobro y de vuelto incorrectos en pantalla antes de
  confirmar — se corrigió con el mismo cálculo que ya usa el descuento
  manual por %.
- El cupón de Turqui (`C36673`, todavía `DISPONIBLE`) queda intacto —
  no se tocó nada en la base, el usuario puede reintentar el canje
  real ahora que el POS calcula bien los dos casos.
- Build y lint verificados, sin warnings nuevos. Verificado en la base
  que el cupón no se había consumido (por eso se pudo confirmar que
  era un bug de frontend, no de datos). Sin verificación visual en
  vivo (mismo bloqueo de permisos que en §7.37-7.58) — pendiente que
  el usuario reintente el canje con `npm run dev`.

### 7.60 React Bits ShinyText, agregado y aplicado al botón "Reserva tu cita"

Nuevo componente `src/components/ShinyText.jsx` — puerto fiel de la
versión JS + CSS de [React Bits ShinyText](https://reactbits.dev/text-animations/shiny-text):
un `<div>` con un degradado recortado al texto (`background-clip:
text`) y `background-size:200%`, animando `background-position` de
100% a -100% — la banda clara del degradado, al desplazarse, se lee
como un brillo recorriendo el texto. Mismas props que el original
(`text`, `disabled`, `speed`, `className`). El CSS (`.shiny-text` +
`@keyframes shiny-text-recorrido`) vive en `src/index.css`, no en un
`.css` propio — mismo criterio que ya usa el resto del CSS a medida
del proyecto (un solo archivo, no uno por componente).

Aplicado en `InicioCliente.jsx`, botón "Reserva tu cita" del hero —
`<ShinyText text="Reserva tu cita" speed={4} className="lw-cta-shiny" />`
en vez del `<span className="lw-metal-azul-texto">` que tenía antes.
El gris/blanco por defecto de React Bits queda intacto para cualquier
otro uso futuro del componente — el botón usa `.lw-cta-shiny`
(selector compuesto `.shiny-text.lw-cta-shiny`, gana por especificidad
sin depender del orden en el archivo) que reemplaza el degradado por
`var(--lw-metal-azul)` en vez de gris — pedido explícito del usuario
("no modifiques los colores azul metálico"). No es un color nuevo: es
el MISMO degradado que ya usan el nav activo/migaja/insignia del
carrito (§7.57) — su propia banda clara (`#d3e4f8`) es la que hace de
brillo al desplazarse, con `background-size:250%` (más ancho que el
200% default) para que el recorrido se note más en un botón chico.
También se agregó el apagado en hover (`.lw-cta-hero:hover
.shiny-text.lw-cta-shiny`, reemplaza al `.lw-metal-azul-texto` viejo
que quedó sin uso y se borró) — el botón se invierte a fondo claro/
texto oscuro sólido ahí, un brillo animado no tendría sentido.
- Build y lint verificados, sin warnings nuevos. Confirmado en el CSS
  compilado que `.shiny-text`, `.shiny-text.lw-cta-shiny` y el
  `@keyframes` quedaron bien generados. Sin verificación visual en
  vivo (mismo bloqueo de permisos que en §7.37-7.59) — pendiente que
  el usuario lo confirme con `npm run dev`.

### 7.61 ShinyText: el bucle se cortaba a mitad de texto cada dos vueltas — causa real

El usuario reportó el patrón exacto: primera vuelta completa bien,
segunda vuelta se corta a la mitad, tercera vuelta completa de nuevo,
así siempre — y pidió `speed={3}` + un `delay` de 1s (no existía ese
prop).

**Causa real**: §7.60 hizo que `.lw-cta-shiny` animara `background-
position` sobre TODO `--lw-metal-azul` — un degradado 100% opaco de
punta a punta, sin ninguna transparencia. El bucle de ShinyText solo
es continuo porque el degradado ORIGINAL de React Bits es transparente
en sus dos puntas (`rgba(255,255,255,0)` a los costados): al llegar a
`background-position:-100%` y la animación saltar de vuelta a `100%`
(el salto instantáneo que hace cualquier `animation: ... infinite`
lineal al reiniciar), las dos puntas transparentes muestran lo mismo
(el `color` de base asomando) — el ojo no nota el salto. Con
`--lw-metal-azul` completo (sin transparencia), cada punta del
degradado es un tramo de AZUL DISTINTO — ese salto se ve como un corte
real cada vez que la animación reinicia, es decir, cada dos "vueltas"
visuales del brillo (una vuelta = el recorrido completo; el corte pasa
en el instante del reinicio, en el medio del texto porque ahí es donde
estaba la banda clara en ese momento del ciclo).

**Fix**: se volvió al mecanismo real de ShinyText — color de base
SÓLIDO (`#a9c6ec`, ya un tono propio de `--lw-metal-azul`, no uno
nuevo) + un degradado de brillo con las puntas de verdad transparentes,
tomando el tono más claro del mismo degradado (`#d3e4f8`) con alfa en
vez de blanco. `--lw-metal-azul` completo ya NO se usa como fondo
animado en ningún lado del botón — solo sus dos colores por separado,
que es lo que en realidad pedía "no modifiques los colores azul
metálico" (mismos colores, mecanismo correcto).

También: `delay` (prop nueva en `ShinyText.jsx`, no existe en el
original de React Bits — se agregó porque hacía falta acá) vía
`animation-delay` inline, mismo patrón que `speed`/`animation-
duration`. Uso final: `speed={3} delay={1}`.
- Build y lint verificados. Confirmado en el CSS compilado que el
  degradado de `.lw-cta-shiny` quedó con alfa 0 en las dos puntas
  (`#d3e4f800 ... #d3e4f8e6 ... #d3e4f800`). Sin verificación visual en
  vivo (mismo bloqueo de permisos que en §7.37-7.60) — pendiente que
  el usuario lo confirme con `npm run dev`.

### 7.62 ShinyText: el efecto no se veía — bug real, `color` opaco tapaba el degradado animado

El usuario pidió más intensidad y avisó que en la Web no se notaba el
efecto para nada.

**Causa real:** `.lw-cta-shiny` tenía `color: #a9c6ec` — SÓLIDO, alfa
100%. `background-clip: text` pinta el degradado animado clipeado a la
forma del texto, pero el relleno propio del texto (`color`) se pinta
ENCIMA — si es 100% opaco, tapa el degradado por completo, sin
importar cuánto brille. Por eso el ShinyText original de React Bits
NUNCA usa un color sólido de base: usa `#b5b5b5a4` (gris con alfa
~64%) — a propósito, para que el degradado de atrás sí se alcance a
ver a través. Mi versión anterior copió el color pero sin el alfa, lo
que apagaba el efecto entero sin que se notara en el CSS a simple
vista (compilaba bien, no tiraba ningún error, simplemente no se veía).

**Fix:** `color` pasa a `rgba(169, 198, 236, 0.78)` (el mismo
`#a9c6ec` de siempre, con alfa) — dejando pasar el brillo del centro,
que además ya quedó en alfa 1 (pedido anterior) para que se note
fuerte al cruzar. Ancho de la banda vuelto a 40%/60% (el usuario pidió
explícitamente no ensancharla, solo más intensidad — el ensanche de
§7.61 quedó revertido).
- Build y lint verificados. Confirmado en el CSS compilado
  (`color:#a9c6ecc7`, alfa real aplicada). Sin verificación visual en
  vivo (mismo bloqueo de permisos que en §7.37-7.61) — pendiente que
  el usuario lo confirme con `npm run dev`.

### 7.63 Galería construida (SQL 98) — cierra el último punto pendiente del §7

El usuario destrabó el único punto que quedaba de la guía (§7.2 de esta
sección, la lista de "contenido de marca"): usar las mismas dos fotos
del hero de Inicio como prueba (nunca hubo fotos reales del salón
disponibles) y armar el formato como el comparison-slider de ReactBits
Pro — un slider horizontal arrastrable, no el círculo que revela con el
cursor que ya tenía el hero. Además pidió su propio panel de control en
Web POS para poder cargar más fotos.

**`98_galeria_web.sql`** (aplicada en vivo vía Supabase MCP,
verificada: tabla + RPC + fila de prueba confirmadas con SQL directo):
- Tabla nueva `galeria_web` (titulo, antes_url, despues_url, orden,
  activo, creado_en). RLS mismo patrón que `asistentes`
  (`rol_actual() is not null` para leer, admin-only para escribir) +
  el GRANT explícito que este proyecto siempre necesita a mano (ver
  nota de memoria "Grants no automáticos en Supabase" — RLS sin GRANT
  no alcanza).
- Bucket nuevo `fotos-galeria` (público, solo admin escribe) — mismo
  patrón que `fotos-asistentes` (83_equipo_web.sql).
- `galeria_para_web()`: recorte security definer con solo lo activo,
  mismo patrón que `equipo_para_web()` — único canal de lectura para
  el cliente, la tabla entera sigue bloqueada para el rol CLIENTE.
- **Decisión de diseño no trivial**: a diferencia de
  `asistentes.foto_url`/`servicios.foto_url` (que guardan solo la RUTA
  dentro de su bucket, resuelta con `urlPublicaFoto()` al leer),
  `antes_url`/`despues_url` guardan la URL ya resuelta completa. Motivo:
  esta tabla tiene que poder mostrar tanto una foto real subida a
  Storage (URL pública completa) como la fila de prueba pedida por el
  usuario, que apunta a las fotos que YA existían en `public/inicio-web/`
  (nunca estuvieron en Storage, no tienen bucket) — no hay un único
  bucket al que asumirle la ruta en todos los casos. El front distingue
  los dos casos por si la URL empieza con `http` o no (`resolverUrlGaleria()`
  en `NosotrosCliente.jsx`, `urlDeItem()` duplicado en el panel admin):
  si no, se resuelve contra `import.meta.env.BASE_URL`, mismo criterio
  que ya usa `InicioCliente.jsx` para esas mismas fotos.
- Fila de prueba insertada en la misma migración: título "Foto de
  prueba (Inicio)", con las rutas relativas de esas dos fotos.

**`src/components/ComparadorAntesDespues.jsx`** (nuevo, genérico): el
slider pedido — reconstruido a mano siguiendo el patrón general de este
tipo de componente (no es el código de ReactBits Pro, que es de pago;
se armó el mecanismo estándar: "después" de fondo a ancho completo,
"antes" encima recortado con `clip-path: inset()` hasta la posición del
handle, arrastrable con mouse/táctil vía `setPointerCapture` en vez de
listeners en `window` — el arrastre no se corta si el cursor sale del
contenedor a media pasada). Handle: línea vertical + círculo blanco con
ícono `MoveHorizontal`; etiquetas "Antes"/"Después" en las esquinas.
Deliberadamente DISTINTO del mecanismo de Inicio (círculo que revela
con el cursor, `useRevelarAntes`): son dos formatos a propósito, cada
uno pensado para su contexto (un hero grande vs. una grilla de varias
fotos chicas donde arrastrar con el dedo es más natural que pasar el
cursor sobre cada una).

**`NosotrosCliente.jsx`**: `SeccionGaleria` reemplaza el placeholder
"Próximamente" de esa sub-sección — mismo patrón de fetch que
`SeccionEquipo` (`supabase.rpc('galeria_para_web')`), grilla de
`ComparadorAntesDespues` (2 columnas en `sm:`, 1 en móvil).
`SeccionProximamente` se queda en el código como el estado vacío (si el
admin borra todas las fotos) en vez de borrarse.

**Panel admin nuevo — "Galería Web"** (cuelga de `/web`, admin-only,
mismo patrón que Fidelización/Referidos/Puntos Web):
- `src/pages/GaleriaWeb.jsx`: lista + botón "Agregar foto" + editar/
  eliminar por fila (con confirmación, mismo modal de
  `Asistentes.jsx`) — al eliminar, borra también los 2 archivos del
  bucket (si la fila era una foto real subida, no la de prueba).
- `src/components/ModalGaleriaWeb.jsx`: formulario con DOS fotos
  (antes/después, cada una obligatoria solo al crear), título opcional,
  orden y el switch "Visible en la Web" — mismo patrón de
  "se procesa al elegir, se sube recién al guardar" que
  `ModalAsistente.jsx`/`ModalServicio.jsx`, duplicado para las dos
  fotos (hook local `useFoto()` por cada una). Al reemplazar una foto
  ya subida, borra la vieja del bucket tras guardar (si tenía una ruta
  de Storage real).
- Registrado en `Web.jsx` (tarjeta nueva), `navegacion.js`
  (`/galeria-web`, `padre: '/web'`) y `PestanasCacheadas.jsx` (lazy +
  mapa de rutas) — mismo trío de archivos que hay que tocar por cada
  subpestaña nueva de Web (ya eran 3 puntos de registro antes de esta
  fase, no algo nuevo que se agregó acá).
- Se actualizó el checklist del §7 (arriba en este mismo archivo,
  estaba desactualizado: solo marcaba "Equipo" como ✅ cuando Reseñas/
  Contacto/Referidos también ya estaban construidos desde §7.4/7.5/
  7.26) para reflejar que ya no queda ningún punto pendiente de esa
  lista.
- Build y lint verificados (un bug de lint real encontrado y corregido
  en el camino: el hook local se había nombrada `usarFoto`, que NO pasa
  la regla `react-hooks/rules-of-hooks` — el nombre tiene que empezar
  literal con "use", no "usar"; renombrado a `useFoto`). Sin
  verificación visual en vivo (mismo bloqueo de permisos que en
  §7.37-7.62) — pendiente que el usuario lo confirme con `npm run dev`,
  tanto el slider en Nosotros → Galería como el panel nuevo en Web →
  Galería Web.

### 7.64 ComparadorAntesDespues: reconstruido contra la tabla de props real del componente de pago

El usuario aclaró §7.63: nunca hubo acceso al código del
comparison-slider de ReactBits Pro (está detrás de un paywall) — lo de
§7.63 fue el patrón genérico de este tipo de slider, no una réplica de
ese componente. Pasó una captura de la tabla de props real de esa
documentación (30 props) y pidió aplicarlas.

**`ComparadorAntesDespues.jsx` reescrito** contra esa tabla —sigue sin
ser su código fuente, ahora es su API/comportamiento documentado,
traducido a props en español con los mismos defaults de la captura:
- `orientacion` ('horizontal' | 'vertical'): el clip-path y la barra
  divisoria cambian de eje según cuál.
- `inercia` (true por default): al soltar el arrastre, la posición
  sigue moviéndose y frena sola (fricción 0.94/frame) en vez de
  quedarse clavada donde soltó el mouse — se mide la velocidad real
  del arrastre (Δposición/Δtiempo) en los últimos `pointermove`.
- `arrastrarEnHover` (false por default): si se prende, mover el
  cursor por encima ya corre el slider sin necesidad de click —mismo
  concepto que `useRevelarAntes` del hero de Inicio, pero como prop
  opcional acá en vez de ser el único modo.
- `animarAutomatico` (false por default): sin interacción, el slider
  se mueve solo entre posiciones aleatorias suavizadas (mismo lerp que
  ya usa `useRevelarAntes`) — arranca solo si no hay inercia corriendo,
  se corta apenas el usuario agarra el handle.
- `grosorDivisor`/`colorDivisor`/`mostrarHandle`/`tamanoHandle`/
  `colorHandle`/`iconoHandle`: todo lo visual de la línea y el handle
  configurable — el ícono por default cambia solo entre
  `MoveHorizontal`/`MoveVertical` según `orientacion`.
- `mostrarEtiquetas`/`textoEtiquetas`/`posicionEtiquetas` (+ 3 props de
  className) y `mostrarPorcentaje`/`posicionPorcentaje`: apagados por
  default (igual que la captura) — la Galería del cliente los prende a
  mano (`mostrarEtiquetas`) para mantener las píldoras "Antes"/
  "Después" que ya tenía.
- `alCambiarPosicion`/`alIniciarArrastre`/`alTerminarArrastre`
  (`onPositionChange`/`onDragStart`/`onDragEnd`), `ariaLabel` (+ ahora
  `role="slider"`, `aria-valuenow/min/max` reales y flechas de teclado
  para mover el divisor — no estaba en la tabla de props explícitamente
  pero es lo que un `ariaLabel` en un slider real necesita para no
  quedar solo decorativo) y `movimientoReducido` (apaga inercia/
  auto-animación cuando está en true).
- `titulo` sigue siendo la única prop sin equivalente en esa tabla — el
  pie de foto con el dato real de `galeria_web.titulo`, ajeno al
  componente de referencia.
- `NosotrosCliente.jsx` actualizado al nuevo nombre de props
  (`alt` → `altAntes`/`altDespues`) + `mostrarEtiquetas` explícito.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario compare
  el resultado contra la demo interactiva de la captura.

### 7.65 Divisor invisible + vaivén determinístico en vez del autoAnimate random

El usuario pidió no poder ver un video (esta sesión no puede reproducir
video, solo imágenes/PDF — se ofreció extraer frames con `ffmpeg`, que
sí está instalado en la máquina, pero el usuario prefirió describirlo en
palabras) y describió dos cambios puntuales sobre §7.64:

1. La raya divisora no debe ser visible nunca.
2. Esa raya (invisible) tiene que animarse sola en bucle: arranca en el
   centro, se mueve un poco a la derecha con "cambios de velocidad
   irregulares pero suaves", vuelve al centro, sigue un poco a la
   izquierda, y el bucle se repite.

**`mostrarDivisor` (prop nueva) + `mostrarHandle`**: ambas pasan a
`false` por default — el divisor sigue existiendo y moviendo el
clip-path exactamente igual, solo que ya no se pinta (`background:
'transparent'` en vez de `colorDivisor`) ni se renderiza el círculo del
handle. Quien quiera el look "slider visible" de §7.64 los puede
prender a mano — la Galería del cliente no los toca, así que hereda el
nuevo default invisible.

**`iniciarVaiven()` reemplaza a `iniciarAutoAnimacion()`** (que eligía un
destino al azar cada ~2s y hacía *ease* hacia él — "irregular" pero
saltado, no lo que se pidió). La nueva versión es una función matemática
determinística, no aleatoria: `50 + 9·sen(2πt/8) + 3·sen(2πt/4)` (`t` en
segundos, reloj real desde que se montó el componente). Por qué esta
fórmula cumple el pedido punto por punto:
- En `t=0` ambos senos valen 0 → arranca siempre en el centro (50%).
- La derivada en `t=0` es positiva (la suma de las dos pendientes en el
  origen) → arranca moviéndose a la derecha, como se pidió.
- Al ser periódica (período de 8s), cruza el centro de vuelta, sigue
  hacia la izquierda y se repite — el "bucle" que se pidió, en un ciclo
  matemáticamente exacto, no aproximado.
- "Velocidad irregular PERO suave": la SUMA de dos senos de distinta
  frecuencia da una velocidad instantánea que cambia todo el tiempo (eso
  es lo irregular), pero cada seno por separado es infinitamente
  derivable — nunca hay un salto ni un quiebre (eso es lo suave). Un
  `Math.random()` habría dado la parte irregular pero nunca la suave —
  por eso no se usó, a pesar de que la v1 de este archivo (§7.63) sí
  tiraba de random para el autoAnimate.
- Amplitud total ±12 (9+3) alrededor del 50%, o sea el rango 38%-62% —
  "un poco" a cada lado, no un barrido completo de la foto.
- `animarAutomatico` pasa a `true` por default (antes `false`): sin
  nada visible que arrastrar, el vaivén es ahora el único motivo por el
  que la comparación se nota — dejarlo apagado por default habría
  dejado la foto de "después" fija sin razón de ser.
- El reloj (`inicioRelojRef`) nunca se reinicia (ni al arrastrar ni al
  soltar): al retomar tras una interacción, la posición hace *ease*
  (factor 0.05) hacia dondequiera que esté la curva EN ESE MOMENTO del
  reloj real, no desde cero — así el bucle sigue "vivo" en el tiempo de
  fondo aunque se interrumpa, en vez de reiniciarse cada vez que alguien
  toca el slider.
- La función de teclado (flechas, agregada en §7.64 para accesibilidad)
  ahora también retoma el vaivén después de mover con el teclado, cosa
  que se había quedado sin encadenar en la versión anterior.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que el movimiento se ve como lo describió.

### 7.66 §7.65 fue un malentendido — el divisor vuelve, ahora como "rayo de luz" tenue

El usuario aclaró que nunca quiso que la línea fuera invisible — dijo
mal "invisible" queriendo decir "muy tenue" (poco notoria). Pasó una
captura de referencia (colores exagerados a propósito, rosa/rojo fuerte,
"solo para que veas la forma, no el color real") de una línea vertical
que se ve como un rayo de luz: delgada en las puntas de arriba/abajo,
más "gordita" (con resplandor difuminado) en el medio, con el handle
emitiendo su propio halo de luz alrededor.

**`mostrarDivisor`/`mostrarHandle` vuelven a `true`** (estaban en `false`
desde §7.65, ese default quedó mal apenas un mensaje).

**Divisor rediseñado** (`ComparadorAntesDespues.jsx`): dejó de ser una
sola barra de ancho constante — ahora son dos capas dentro del mismo
punto de anclaje:
1. Una línea delgada de punta a punta (`grosorDivisor`, opacity 0.35 —
   el "tenue" real que pidió, en blanco, no en el rojo de la captura,
   que era solo para mostrar la forma).
2. Un bulto centrado en el medio del eje perpendicular: un rectángulo
   angosto y largo con `rounded-full` (da forma de cápsula) + `blur-md`,
   más opaco (0.75) — es lo que da el efecto "más gordito al centro, se
   afina hacia los costados" sin necesitar un SVG a medida.

**Handle con halo**: además del círculo sólido de siempre, ahora tiene
detrás un círculo más grande (2.4× su tamaño), mismo `colorHandle`,
difuminado (`blur-lg`) y semi-transparente (opacity 0.5) — el "emite una
especie de luz a su alrededor" pedido.

Ambas capas nuevas reusan `colorDivisor`/`colorHandle` (sin agregar
props nuevas): la opacidad de cada capa está fija en el código, no
expuesta como prop — es un ajuste de estética puntual, no parte de la
tabla de props original, así que no había necesidad de hacerlo
configurable todavía.

`animarAutomatico` se queda en `true` (sin cambios de §7.65) — con la
línea otra vez visible, el vaivén ahora se ve literalmente como el rayo
de luz moviéndose solo, que es el efecto final que se buscaba desde el
principio.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que la forma/opacidad del rayo de luz calza con lo
  que tenía en mente (son valores a ojo, fáciles de ajustar si no).

### 7.67 El "bulto" de §7.66 se veía como una mancha blanca, comparado contra la referencia real

El usuario mandó captura comparando lado a lado su referencia real
(línea roja delgada y nítida sobre la pantalla del Macintosh) contra el
resultado de §7.66 en la Galería del cliente: la cápsula ancha con
`blur-md` que se agregó ahí se veía sobredimensionada — gigante, muy
opaca, más una mancha blanca que un brillo.

**Causa real**: la cápsula medía `grosorDivisor * 14` (42px) de ancho ×
55% del alto del contenedor, a opacity 0.75 — sumado al halo del handle
(2.4× su tamaño, `blur-lg`/16px, opacity 0.5) justo encima, las dos
capas difuminadas se superponían y se leían como un solo bloque blanco
borroso. La referencia real no tiene nada de eso: es una línea delgada
y NÍTIDA casi de punta a punta, con el único brillo real concentrado
muy cerca del handle, no una forma aparte que ocupe más de medio alto
de la imagen.

**Fix**: se sacó la cápsula por completo. Ahora solo hay dos capas,
mucho más chicas:
- La línea: sin cambios de tamaño, pero de opacity 0.35 a 0.4, sin
  ningún blur — nítida en toda su extensión, igual que la referencia.
- El halo del handle: de 2.4× a 1.6× su tamaño, de `blur-lg` (16px) a
  `blur-sm` (4px), de opacity 0.5 a 0.25 — un brillo apagado y
  contenido, no un bloque sólido. Como el halo está clavado en el mismo
  centro por donde pasa la línea, esa combinación ya alcanza para leerse
  como "más grueso justo ahí" sin necesitar la segunda forma que se
  sacó — mismo efecto visual, con mucho menos peso.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que ya no se ve como mancha.

### 7.68 Línea con degradado de transparencia real, no opacity fija — "raya rectangular cruda"

El usuario mandó una referencia real de una línea de luz horizontal
(fondo negro transparente, checkerboard de por medio): se APAGA por
completo en las dos puntas y se ve más ancha/brillante solo cerca del
centro, un degradado continuo a lo largo de todo su largo — nada que
ver con lo de §7.67, que seguía siendo "una raya rectangular cruda"
(ancho y opacity CONSTANTES de punta a punta, sin ningún desvanecido).

**Causa real**: opacity fija (0.4) aplicada sobre un `background` de
color sólido cambia cuánto se ve la línea, pero no CÓMO se ve a lo largo
de su largo — sigue siendo la misma línea, uniforme, del principio al
final. Para el efecto "se apaga en las puntas" hace falta que la
transparencia varíe punto por punto a lo largo del eje, no un multiplicador
único para toda la capa.

**Fix**: la línea pasó a usar `linear-gradient(transparent → color →
transparent)` a lo largo de su eje (vertical → degradado de arriba a
abajo; horizontal → de izquierda a derecha) en vez de un `background`
sólido + opacity plana, en dos capas que comparten el MISMO degradado:
- Núcleo: fino (`grosorDivisor`), sin blur, opacity 0.9 — nítido, se
  apaga solo en las puntas por el degradado.
- Resplandor: más ancho (`grosorDivisor * 9`), con `blur-md`, opacity
  0.55 — al compartir el mismo degradado, en las puntas ya vale ~0 (no
  se nota ahí, no hay riesgo de que vuelva a verse como mancha) y solo
  "florece" cerca del centro, que es donde el degradado está en su pico
  — de ahí sale el "más ancha/brillante al medio" sin necesitar una
  forma aparte.

El halo del handle (§7.67, sin cambios de tamaño/blur/opacity) queda
clavado en el mismo punto donde el degradado de la línea ya está en su
pico, así que las dos cosas refuerzan el mismo lugar en vez de competir.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que el degradado se parece a la referencia (valores
  de ancho/blur/opacity a ojo, fáciles de ajustar).

Ajuste inmediato: el usuario pidió disminuir un poco el ancho de la capa
de resplandor — bajó de `grosorDivisor * 9` a `grosorDivisor * 6` (el
núcleo fino y el halo del handle quedaron igual). Build y lint
verificados.

Segundo ajuste: mismo problema en el halo del handle que ya se había
corregido en la línea (§7.68) — era un círculo de color sólido + blur,
con la misma intensidad hasta cerca del borde y ahí sí se apagaba de
golpe, no un degradado real. Se pasó a `radial-gradient(circle,
colorHandle 0%, colorHandle 15%, transparent 68%)` (sin blur, ya no
hace falta): notable solo en un radio chico al centro, se extiende y se
apaga solo hasta desaparecer, tal como se pidió. De paso subió un poco
de tamaño (1.6× → 2× el handle) para que el degradado tenga más recorrido
donde desvanecerse. Build y lint verificados.

Tercer ajuste: pidió que en los extremos del halo "casi no se note" el
brillo, para que se sienta como un emisor de luz tenue. El stop
`transparent` bajó de 68% a 45% del radio (se apaga del todo mucho antes
de llegar al borde del círculo de 2× el handle) y la opacidad general de
0.28 a 0.2 — mismo core chico al centro (10% en vez de 15%), caída más
rápida hacia afuera. Build y lint verificados.

Cuarto ajuste: la opacidad 0.2 del paso anterior se pasó de tenue — el
usuario reportó que el handle "casi no brilla" (en general, no solo en
las puntas como se buscaba). Subida a 0.4 — el radio de caída (45%)
queda igual, solo el núcleo del centro vuelve a notarse. De paso, en la
línea vertical: el resplandor bajó de `grosorDivisor * 6` a `* 4`
(menos ancho) y de opacity 0.55 a 0.4 (menos intensidad) — el núcleo
fino (opacity 0.9) no se tocó, es el resplandor ancho el que se pidió
atenuar. Build y lint verificados.

Quinto ajuste: núcleo de la línea ("un poquito" más delgado) —
`grosorDivisor` default bajó de 3 a 2. Como el resplandor se calcula
como `grosorDivisor * 4`, también se achica en la misma proporción
(12px → 8px), efecto colateral esperado y correcto (todo el rayo se ve
un poco más fino, no solo el núcleo). Build y lint verificados.

Sexto ajuste: "radio mayor de luz, bien difuminado y sutil" en el
handle — tamaño del halo de 2× a 3× el handle, stop `transparent`
corrido de 45% a 60% (con la caja más grande, ese tramo de caída es más
largo en píxeles reales → se siente más difuminado/gradual) y opacidad
bajada de 0.4 a 0.32 para compensar que un radio más grande no se
sienta más intenso, solo más amplio y sutil. Build y lint verificados.

### 7.71 El halo del handle igual se notaba "cortado" sobre fondo oscuro — gradiente de 2 stops no alcanza

El usuario mandó dos capturas comparando su resultado en vivo (el halo
del §7.70) contra una referencia real: sobre un fondo bien oscuro, el
borde del círculo de luz se notaba clarísimo en la suya, mientras que en
la referencia se pierde del todo en el negro, sin ningún borde
perceptible.

**Causa real**: un `radial-gradient(color 0%, color 8%, transparent
60%)` solo tiene DOS puntos de control para toda la caída (de "color
sólido" a "nada"), interpolados linealmente — matemáticamente sí llega a
0 opacidad en el 60%, pero el ojo humano no percibe el brillo de forma
lineal: es mucho más sensible a diferencias pequeñas de luz cerca del
negro que cerca del blanco (por eso una caída lineal, sobre fondo
oscuro, "se corta" antes de tiempo a la vista aunque el número siga
bajando). Una referencia real de un brillo perdiéndose en la oscuridad
tiene una caída MUCHO más lenta al principio y un final larguísimo casi
imperceptible, no una rampa recta.

**Fix**: el halo pasó a un `radial-gradient` de 6 stops usando
`color-mix(in srgb, colorHandle X%, transparent)` para los tramos
intermedios (en vez de saltar directo de color sólido a `transparent`),
aproximando esa curva de apagado lenta-luego-larga — y se sumó
`blur-md` encima de todo el elemento para que no quede ni un pixel de
borde nítido en ningún punto de la transición. Tamaño subido de 3× a
3.5× el handle (más lugar donde diluirse), opacidad general sin cambios
(0.32).

Nota técnica: `color-mix()` es una función CSS relativamente moderna
(Chrome 111+/Firefox 113+/Safari 16.2+) — consistente con otras técnicas
ya usadas en este mismo componente/proyecto (`mask-composite`,
`backdrop-filter`), ninguna soportada en navegadores muy viejos.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que ya no se nota el borde sobre fondo oscuro.

### 7.72 El regreso al centro al soltar arrancaba rápido — era un lerp (ease-out), no un ease-in

El usuario describió el comportamiento exacto que quería al soltar el
arrastre en cualquier punto de la foto: "que comience a regresar lento y
al llegar casi al centro un poquito más rápido" — un ease-IN. Lo que
había (desde §7.65) era lo opuesto.

**Causa real**: soltar el arrastre encadenaba directo a `iniciarVaiven()`,
que persigue su objetivo con un lerp por frame
(`pos += (objetivo - pos) * 0.05`). Un lerp así es matemáticamente una
curva EASE-OUT: el salto por frame es proporcional a la distancia que
falta, así que es más grande cuanto más lejos está (arranca "rápido") y
se va achicando a medida que se acerca (se siente "lento" cerca del
destino) — exactamente al revés de lo pedido.

**Fix**: se separó el regreso al soltar del vaivén continuo. Nueva
función `iniciarRegresoOrganico()`: un tween de duración FIJA (900ms,
`DURACION_REGRESO_MS`) que interpola desde la posición donde se soltó
hacia un objetivo, usando `facilEntrada(t) = t³` (ease-in cúbico: arranca
lento, acelera hacia el final — la curva que se pidió). El objetivo no
es simplemente "50": es `valorVaiven()` (la misma fórmula del vaivén,
extraída a su propia función reusable) evaluado en el FUTURO —
exactamente en el instante en que el tween va a terminar, no en el
presente— así que al cabo de los 900ms el tween entrega el control a
`iniciarVaiven()` (el loop continuo de siempre) sin ningún salto, porque
ya está parado justo donde esa curva continúa. Se aplica en los 3 puntos
donde antes se llamaba directo a `iniciarVaiven()` tras soltar: el
arrastre normal, el fin de la inercia (flick rápido) y el movimiento por
teclado.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que el regreso ahora se siente orgánico (lento →
  acelera cerca del centro), no el salto inicial de antes.

### 7.73 §7.72 fue ease-in puro (acelera todo el recorrido) — el usuario pedía ease-in-out

Aclaró la curva exacta: "comienza lento y aumenta gradualmente en su
centro [el punto medio de la animación] y cuando casi llega al centro
[el destino] nuevamente se hace lento" — lento al empezar, más rápido a
la mitad, lento otra vez al llegar. `facilEntrada(t) = t³` de §7.72 es
un ease-IN: sí arranca lento, pero sigue acelerando hasta el final —
llega rápido, no lento. Pidió además que todo el tween sea "más
despacio" en general.

**Fix**: `facilEntrada` → `facilEntradaSalida`, un ease-in-out cúbico
estándar (`t<0.5 ? 4t³ : 1-(-2t+2)³/2`) — simétrico: lento-rápido-lento.
`DURACION_REGRESO_MS` subido de 900 a 1400ms ("más despacio"). Nada más
cambió: sigue siendo el mismo tween de duración fija que apunta a
`valorVaiven()` evaluado en el futuro para empalmar sin saltos con el
vaivén continuo, en los mismos 3 puntos de siempre (arrastre normal, fin
de inercia, teclado).
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que ahora sí es lento-rápido-lento, no solo lento-
  cada-vez-más-rápido.

### 7.74 "Efecto pelota": un toque chico mandaba el divisor disparado hasta el extremo

El usuario describió el bug con una analogía exacta: mover el handle con
el mouse y soltar con solo "un toque" hacía que se fuera disparado hasta
el extremo (0% o 100%) y de ahí recién volviera — como empujar una
pelota, no como soltar algo donde lo dejaste.

**Causa real**: `iniciarInercia()` (la rama de `continuarTrasSoltar()`
para arrastres rápidos) tomaba `velocidadRef.current` (%/ms, medida
entre los últimos dos `pointermove`) sin ningún tope, la escalaba ×16 y
la dejaba decaer con fricción 0.94/frame. La distancia TOTAL que
recorre una fricción geométrica así es `v0 / (1 - fricción)` ≈ 16.7×
`v0` — con `v0` ya escalado ×16, el multiplicador real sobre la
velocidad medida es ≈267×. El problema de fondo: `dt` (el tiempo entre
dos `pointermove`) a veces es de solo 1-2ms (el piso duro es
`Math.max(1, dt)`) — un movimiento de mouse de apenas unos px en esos
1-2ms da una velocidad instantánea gigante, que multiplicada por 267
manda el divisor a un extremo casi seguro, sin importar de dónde se
soltó. Eso es literalmente "un toque" con un resultado exagerado — el
reporte del usuario fue exacto.

**Fix, dos partes**:
1. Tope real a la velocidad MEDIDA en `alMover` (±0.3 %/ms, antes sin
   límite) — corrige la causa de fondo, para cualquiera que use
   `inercia` en el futuro.
2. `inercia` pasa de `true` a `false` por default: más allá del bug ya
   corregido, un "fling físico" al soltar no es lo que se pidió en
   ningún momento de esta conversación — lo único que debe pasar al
   soltar es el regreso orgánico (§7.72-7.73), nunca un envión hacia un
   extremo. La prop se queda (paridad con `enableInertia` de la tabla de
   referencia), pero ya no se ejerce en la Galería del cliente al no
   pasarla explícita.

También, mismo pedido de siempre: `DURACION_REGRESO_MS` subió de 1400 a
1900ms ("disminuye más las velocidades de regreso").
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que ya no se dispara hacia los extremos al soltar.

Ajuste inmediato: radio del halo del handle de 3.5× a 3× su tamaño
("disminuye un poquito"). Build y lint verificados.

Otro más: halo de 3× a 2.5× + el círculo del handle en sí (`tamanoHandle`
default) de 48 a 40px — se achica dos veces (el círculo directo, y el
halo indirectamente al ser un múltiplo de `tamanoHandle`). Build y lint
verificados.

### 7.75 La línea todavía se sentía "en bloque" sobre fondos muy oscuros — mismo bug del handle, sin corregir ahí

El usuario reportó que, aun con los ajustes anteriores, tanto el handle
como la raya vertical seguían sintiéndose como "un bloque de luz" en vez
de luz natural sobre fondos muy oscuros — pidió aumentar más el
difuminado de los dos.

**Causa real (línea)**: el degradado de la línea (núcleo y resplandor,
§7.68) seguía siendo de 3 stops simples (`transparent 0%, color 50%,
transparent 100%`) — el MISMO problema de caída lineal que ya se había
diagnosticado y corregido en el halo del handle en §7.71 (el ojo percibe
un borde duro cerca del negro aunque el número matemático sí llegue a 0)
nunca se le aplicó a la línea, que se quedó con la versión vieja.

**Fix**:
- Nueva función reusable `paradasDesvanecidas(color)` — la misma
  técnica de `color-mix()` en varios stops intermedios del halo del
  handle, extraída para no duplicarla, aplicada ahora TANTO al núcleo
  como al resplandor de la línea (antes solo el handle la tenía).
- Blur del resplandor de la línea: `blur-md` (12px) → `blur-xl` (24px).
- Blur del halo del handle: `blur-md` (12px) → `blur-xl` (24px), más un
  stop extra (80%, alfa muy baja) para alargar todavía más la cola final.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que ya no se siente "en bloque" sobre fondos oscuros.

Ajuste inmediato: línea vertical confirmada al 100% por el usuario, sin
más cambios ahí. Halo del handle de 2.5× a 2.3× ("casi nada"). Build y
lint verificados.

### 7.76 Handle: cola del degradado extendida — que se pierda del todo en negro puro

El usuario pidió, otra vez, que el halo del handle se difumine "aún más"
en sus extremos, específicamente para que se pierda en fondos negros —
la ronda anterior (§7.75) ya había mejorado esto pero seguía sin ser
suficiente contra negro puro.

**Ajuste**: la caída de 6 stops pasó a 7, todos más espaciados y con
porcentajes de color más bajos desde antes (a partir del 34% del radio
ya está en 22% de color, no 45%) — una cola mucho más larga y gradual.
Blur de `blur-xl` (24px) a `blur-2xl` (40px, confirmado en el CSS
compilado: `--blur-2xl:40px`). Radio de 2.3× a 2.6× el handle, para que
esa cola más larga tenga espacio real donde disolverse antes de tocar el
borde de la caja (si no, el blur la recortaría de golpe justo ahí,
reintroduciendo el mismo borde que se quiere evitar).
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` sobre un fondo bien oscuro.

### 7.77 El radio de §7.76 sobraba — `blur()` no se recorta en el borde de su propia caja

El usuario prefería el radio de 2.3× (§7.74) y preguntó si la cola larga
del degradado de §7.76 podía mantenerse sin el radio más grande (2.6×)
que esa ronda había agregado "para darle espacio a la cola".

Respuesta corta: sí, esa suposición era innecesaria. El filtro CSS
`blur()` no recorta su propio resultado en el borde del elemento al que
se aplica — solo lo recorta un ANCESTRO con `overflow: hidden` (acá, el
borde de la foto en sí, no la cajita del halo). Una cola de degradado
más larga sigue difuminándose bien aunque la caja donde vive el
`radial-gradient` sea más chica; el radio extra de §7.76 no aportaba
nada real, era una precaución de más.

**Fix**: radio de vuelta a 2.3× (era 2.6×) — los 7 stops y el `blur-2xl`
de §7.76 se quedan sin cambios.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que la cola larga se sigue viendo igual de difuminada
  con el radio más chico.

### 7.78 Etiquetas "Antes"/"Después" — una en cada extremo de la foto, no juntas arriba

Con `posicionEtiquetas` default (`'top-left'`), las dos píldoras
comparten la misma franja vertical (`top-3`), diferenciadas solo por
`left-3`/`right-3` — en una captura se veían pegadas/superpuestas cerca
de la esquina superior en vez de leerse como "una en cada punta de la
foto".

**Fix**: nuevo valor `'centro'` en `ETIQUETA_POSICION_CLASES` (`top-1/2
-translate-y-1/2`, sin equivalente en la tabla de props real) — cada
etiqueta sigue clavada en su propio extremo horizontal (eso ya estaba
bien, `left-3`/`right-3` fijos en el JSX de cada una) pero ahora
centrada verticalmente, no arriba — "Antes" en la punta izquierda de la
foto, "Después" en la punta derecha, a la misma altura. `NosotrosCliente.jsx`
pasa `posicionEtiquetas="centro"` en la Galería; los 4 valores de esquina
originales (`top-left`, etc.) se quedan intactos para quien los quiera.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev`.

### 7.79 Bug real encontrado: `.liquid-glass` pisaba el `position: absolute` de las 3 etiquetas — CSS, no JSX

El usuario mandó captura de §7.78: las píldoras seguían viéndose
pegadas una junto a otra, ahora además aclaró que nunca quiso
centrado vertical — quería cada una en SU esquina (antes en el lado
donde se ve la foto de antes, después en el lado de después), como ya
estaba antes de §7.78.

**Causa real (no era el `posicionEtiquetas` de §7.78, ni un typo de
`left-3`/`right-3`)**: `.liquid-glass` (`index.css`) define su propio
`position: relative` bajo el selector `.landing-web .liquid-glass` —
especificidad (0,2,0), MÁS ALTA que la clase `.absolute` de Tailwind
(0,1,0) — así que gana y pisa silenciosamente el `position: absolute`
de cualquier elemento que combine ambas clases. Sin `position: absolute`
real, un elemento no se posiciona contra su contenedor: pasa a flujo
normal del documento, donde `left`/`right`/`top` ya no son coordenadas
absolutas sino OFFSETS relativos a la posición que hubiera tenido en
ese flujo — por eso las dos etiquetas (y también el indicador de %,
mismo combo `liquid-glass` + `absolute`) terminaban juntas cerca de
donde arranca el contenido, sin importar qué digan sus clases de
posición. Ningún cambio de §7.78 (ni antes) podía arreglar esto: el
problema nunca estuvo en qué valor de posición se pedía, sino en que
NINGÚN valor de posición se estaba aplicando de verdad.

**Fix**: `style={{ position: 'absolute' }}` inline en los 3 elementos
(etiqueta "Antes", etiqueta "Después", indicador de %) — un estilo en
línea gana por especificidad a cualquier selector de clase, sin tener
que tocar `.liquid-glass` (compartido con decenas de otros lugares del
proyecto). Se sacó el value `'centro'` agregado en §7.78 (ya no hace
falta, era una respuesta a un síntoma que en realidad era este bug) y
`NosotrosCliente.jsx` vuelve a su llamada simple sin `posicionEtiquetas`
(default `'top-left'`: "Antes" arriba-izquierda, "Después"
arriba-derecha — la esquina de cada foto, como se pidió).

Nota para el futuro: cualquier otro lugar del proyecto que combine
`.liquid-glass` con `absolute`/`fixed` de Tailwind tiene el mismo riesgo
latente — no se auditó el resto del código por estar fuera del alcance
de este pedido puntual.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que ahora sí quedan cada una en su esquina.

## 8. Rediseño del Carrito (docs/diseno-carrito/)

Diseño aprobado por el usuario en un lienzo aparte (`Main.dc.html`
escritorio, `Movil.dc.html` móvil, más las variantes con el panel de
cupones abierto) — ver `docs/diseno-carrito/README.md` para el detalle
completo y las reglas de estilo. Antes de tocar código se acordaron dos
cambios sobre ese diseño (conversación previa a esta sección, resumida
en el propio README):
1. El carrito queda SOLO para productos — el bloque "Servicios para
   reservar" que traía el diseño (ya sacado en el mock de escritorio,
   todavía en el de móvil) se elimina por completo. Reservar servicios
   pasa a un mini-carrito propio dentro de Citas, alimentado desde una
   vista rica de Servicios (fotos/reseñas) — tarea aparte, futura, no
   parte de este rediseño.
2. Sin "Efectivo" como método de pago — el diseño lo traía como 4ta
   opción sin exigir captura ("pagas al recibir"), pero ya se había
   acordado que el pago es 100% obligatorio y verificado (Yape/Plin/
   Transferencia) para cualquier pedido web, sin excepción por
   modalidad de entrega.

También se acordó el plan en 4 fases (frontend puro → conectar a datos
que ya existen → backend nuevo, una migración a la vez con aprobación
previa → conectar cada pieza) — separado explícitamente de "tocar
Supabase" porque el usuario pidió poder ver y ajustar el diseño antes de
comprometerse a ninguna migración.

### 8.1 Fase 1 — Layout puro, sin Supabase (`CarritoCliente.jsx` reescrito)

Reescritura completa de `CarritoCliente.jsx`, calcado de
`Main.dc.html`/`Movil.dc.html` en un solo árbol responsive (quiebre
`lg:`, mismo criterio que el resto del proyecto — no dos archivos
separados por ancho como el mock). Todo con datos de ejemplo locales
(`PRODUCTOS_EJEMPLO`, `DIRECCIONES_EJEMPLO`, `CUPONES_EJEMPLO`,
`ZONAS_EJEMPLO`, `DIAS_EJEMPLO`/`HORAS_EJEMPLO`, `METODOS_PAGO`) — CERO
llamadas a Supabase en esta fase, a propósito (eso es lo que pidió el
usuario: "es posible primero hacer el diseño sin funcionalidades").

**Fuente Heavitas**: la memoria del usuario (`feedback_tipografias_web.md`)
ya tenía decidido "Heavitas para títulos importantes en blanco sólido",
pero el archivo de fuente nunca había llegado al proyecto — el primer
intento de encontrarlo en Descargas solo encontró `heavitas.zip` con la
licencia en PDF, sin el `.ttf` real adentro. El usuario subió
`Heavitas.ttf` directo a `src/assets/fonts/`. Mismo patrón exacto que
Kunaroh (§7.37): `@font-face` local en `index.css` (`.lw-titulo-heavitas`,
sin cursiva ni degradado — a diferencia de Kunaroh, que sí lleva
`--lw-metal-azul`) + excepción nueva en `.gitignore`
(`!src/assets/fonts/Heavitas.ttf`, `src/assets/*` sigue ignorando todo
lo demás suelto). Confirmado en el CSS compilado que el `.ttf` se
empaquetó de verdad (`Heavitas-BE4TTxyk.ttf`), no solo que compiló sin
error.

**CSS nuevo, reusable** (`index.css`, sección "Carrito"): se portaron las
clases del `<style>` del mock a clases propias con prefijo `lw-`
(`.lw-panel`, `.lw-seg`, `.lw-campo`, `.lw-stepper`, `.lw-chip`,
`.lw-chip-pred`, `.lw-tarjeta-direccion`, `.lw-etq-stock`, `.lw-etq-desc`,
`.lw-capsula-agotado`, `.lw-precio-antes`, `.lw-pago-opcion`,
`.lw-comprobante-opcion`, `.lw-subir-captura`, `.lw-cuponrow`, `.lw-plus`,
`.lw-wa-ayuda`, más las animaciones de entrada del panel de cupones) —
mismo criterio que `.liquid-glass`/`.lw-bar`: una clase compartida en vez
de repetir un string larguísimo de Tailwind arbitrario en cada bloque.
Nombres genéricos del mock (`.field`, `.chip`, `.seg`) NO se usaron tal
cual — son demasiado genéricos para vivir sueltos en un CSS compartido
por toda la app, de ahí el prefijo.

**Estructura construida**: título "Tu carrito" (Heavitas) + contador de
artículos; columna izquierda (Dirección de entrega — solo si Delivery,
con "Cambiar" desplegando las demás con radio; Comprobante Boleta/
Factura con RUC+razón social obligatorios en Factura; Productos con
checkbox, miniatura con etiqueta de stock y "−N%" si hay descuento,
stepper de cantidad, agotados al final con la cápsula "Producto no
disponible" y sin poder marcarse; "Seguir comprando"); columna derecha
(barra de puntos Básico→Premium, Entrega Recojo/Delivery con día/hora
obligatorios y zona solo en Delivery, fila de cupón o `TarjetaCupon.jsx`
aplicado con "Cambiar"/"Quitar" debajo, desglose de totales con
"Descuento en productos" y cupón restando aparte, Total con el precio
sin descuentos tachado cuando hay ahorro, botón verde "Confirmar
pedido" — único uso de `#3ECF6A` en esta pantalla, memoria
`feedback_boton_verde_exclusivo.md` — con aviso de qué falta, Método de
pago Yape/Plin/Transferencia con panel de QR + "Subir captura" que
bloquea el botón hasta adjuntar algo, debajo el enlace de WhatsApp y las
3 garantías). Panel "Tus cupones": hoja inferior en móvil, panel lateral
derecho en escritorio (mismo componente, cambia de posición vía
Tailwind responsive — no dos implementaciones separadas), con código
manual, disponibles (reusando `TarjetaCupon.jsx` + "Ahorras/Usar"
debajo) y ya usados.

**Nota técnica — por qué el panel de cupones NO usa `useModalA11y`**: ese
hook (usado en los otros ~22 modales del proyecto) asume el patrón
"overlay `fixed inset-0` + panel centrado que escala/desvanece" y le
suma su propia animación de entrada — el panel de cupones necesita un
slide lateral/hacia arriba distinto (`.lw-panel-cupones`, con `sube` en
móvil y `entra desde la derecha` en escritorio, respetando
`prefers-reduced-motion`), y las dos animaciones a la vez se hubieran
pisado. Se armó a mano en su lugar: `role="dialog"`/`aria-modal`/
`aria-labelledby` puestos directo en el JSX, más `useCerrarConEscape()`
(que sí es independiente de cualquier animación) para que Esc cierre el
panel — cumple la convención del proyecto sin arrastrar el conflicto.

**Pendiente confirmar con el usuario** (igual que dejó pendiente el
propio README del diseño): el copy de las 3 garantías se deja tal cual
(confirmado — "solo es estético"); el número de WhatsApp, el nombre del
titular de Yape/Plin, el número de cuenta de Transferencia y el QR
siguen siendo placeholders literales (`[NOMBRE DEL DUEÑO]`, `[QR ...]`)
hasta que existan las columnas reales de la Fase 3.
- Build y lint verificados (un warning real de lint encontrado y
  corregido en el camino: `formatearValorCupon` importado sin usarse —
  ya lo usa `TarjetaCupon.jsx` internamente, no hacía falta importarlo
  acá también). Confirmado en el CSS compilado que `Heavitas.ttf` se
  empaquetó de verdad. Sin verificación visual en vivo (mismo bloqueo de
  permisos de siempre) — pendiente que el usuario lo confirme con
  `npm run dev` antes de pasar a la Fase 2.

### 8.2 Ajustes tras la primera revisión de la Fase 1

Ronda de retoques puntuales pedidos por el usuario después de ver el
layout de la Fase 1, todos siguiendo dentro de "solo frontend, sin
Supabase":

- **Ancho de columnas**: el resumen del pedido pasó de 420px a 500px
  fijos (`lg:grid-cols-[1fr_500px]`) — la columna izquierda, al ser
  `1fr`, se angosta sola en proporción.
- **Borde azulado de la dirección**: `.lw-tarjeta-direccion.on` (borde
  `--lw-gold`) solo tiene sentido cuando hay varias direcciones para
  elegir — mostrando solo la predeterminada (cerrado) no hay nada que
  resaltar contra. Ahora esa clase solo se aplica cuando `mostrarRadio`
  (el desplegable de "Cambiar" está abierto) Y está seleccionada; cerrado
  se ve como una tarjeta de info plana, borde gris igual que el panel.
- **Selector de día → mini-calendario real**: se investigó el patrón ya
  usado en `CitasCliente.jsx` (grilla de 42 celdas / 6 semanas, helpers
  de zona horaria de `src/lib/fechas.js`, colores dorado para
  seleccionado/hoy) y se copió/adaptó como `SelectorDia` dentro del mismo
  archivo — con una diferencia a propósito: acá los días PASADOS quedan
  deshabilitados (no tiene sentido pedir un delivery para ayer), algo que
  el calendario de Citas no hace porque ahí se navegan citas ya
  agendadas, pasadas incluidas. Bug evitado a propósito: `claveDiaLima()`
  devuelve una clave tipo `"2026-8-26"` (mes sin padding) pensada solo
  para IGUALDAD, nunca para comparar con `<` como string (compararía mal
  cruzando decenas: `"...-9-10"` sale "menor" que `"...-9-2"`) — el chequeo
  de "es un día pasado" compara los timestamps reales
  (`dia.getTime() < iniciarDia(new Date()).getTime()`), no las claves.
- **Selector de hora → grilla de horarios reales**: reemplaza el
  `<select>` de rangos inventados por botones generados a partir de los
  2 bloques reales del horario del negocio (10:00-13:00 y 15:00-20:30,
  mismo horario que ya expone `horario_atencion()`) vía una función
  `generarHorasDelDia()` nueva — de ejemplo todavía (Fase 3 conecta el
  RPC real), pero ya con la forma real de 2 bloques con descanso, no una
  lista plana inventada.
- **Texto "elige el día y hora" bajo el botón Confirmar**: se sacó por
  completo junto con todo el cálculo `avisoCta` que lo alimentaba — el
  usuario lo consideró innecesario ahí.
- **Métodos de pago**: se sumaron los íconos reales de `public/icons/`
  (`yape.svg`, `transferencia.svg`) a la izquierda del texto de cada
  botón — Plin no tiene ícono propio en esa carpeta todavía, así que se
  quedó con un ícono genérico de repuesto (`Wallet` de lucide) hasta que
  exista uno real. `.lw-pago-opcion` bajó de columna a fila (`flex-direction:
  row`) para que el ícono quede al lado del texto, con menos alto/padding
  (56px/8px → 46px/4px×10px).
- **Nuevo componente reusable `CampoSubirArchivo.jsx`**: reemplaza el
  "subir captura" que tenía el carrito armado a mano — agrega una
  animación de carga (spinner, puramente estética por ahora vía
  `setTimeout`, ya que no hay upload real todavía) entre elegir el
  archivo y mostrarlo como adjunto. Pensado desde el nombre para
  reusarse en cualquier otro campo del proyecto que pida subir un
  archivo — el propio usuario pidió que los que ya existen en otras
  pantallas se migren a este mismo componente más adelante (no se tocó
  ninguno de esos otros lugares todavía, fuera del alcance de este
  pedido puntual sobre el carrito).
- **Barra de puntos**: se sacó del resumen del pedido — el usuario la
  consideró que no aportaba nada ahí.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev`, en particular el calendario/horario nuevos y el
  ícono de repuesto de Plin.

### 8.3 Día/hora: calendario y grilla de horas pasan a desplegables

El calendario y la grilla de horas de §8.2 quedaban siempre abiertos —
el usuario pidió que cada uno se abra recién al hacer clic en su campo,
y se cierre solo al elegir un día/hora (no con un botón "Cancelar"
aparte).

Cada campo pasó a un botón tipo `.lw-campo` (mismo look que un `<select>`
del resto del carrito) que muestra el valor elegido o un placeholder
("Elige el día"/"Elige la hora"), con una flecha `ArrowBigDown` que rota
180° al abrir — ícono de desplegable obligatorio en todo el proyecto,
memoria `feedback_icono_desplegables.md` (no `ChevronDown`, que había
usado por descuido en el plan inicial y se corrigió antes de escribir el
código). Al tocar el botón se despliega el calendario/la grilla debajo;
elegir un día o una hora corre `onElegir`/`onClick` Y cierra el
desplegable en el mismo gesto (`setDia(clave); setDiaAbierto(false)`,
mismo patrón para hora) — un solo clic para elegir y cerrar, sin paso
extra.

Nuevo helper `formatearClaveDia(clave)`: la `claveDiaLima` que ya usa
`SelectorDia` internamente (ej. `"2026-8-26"`) no es un texto pensado
para mostrarse — se reconstruye un `Date` en UTC directo con esos mismos
3 números (año/mes/día) y se formatea con `timeZone: 'UTC'`, no con
`'America/Lima'`: esa clave YA está corregida a Lima (ver el comentario
de `claveDiaLima` en `fechas.js`), así que formatear de nuevo con
`America/Lima` la desplazaría una segunda vez.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que abren/cierran como se pidió.

### 8.4 Fase 2 — Carrito conectado a datos reales (sin migraciones)

Se reemplazaron los 4 arreglos de ejemplo (`PRODUCTOS_EJEMPLO`,
`DIRECCIONES_EJEMPLO`, `ZONAS_EJEMPLO`, `CUPONES_EJEMPLO`) por datos
reales, todos de tablas/RPCs que YA existían — cero migraciones nuevas,
tal como estaba planeado:
- **Productos**: `carrito_productos` join `productos(nombre, precio,
  stock_actual, categoria, foto_url)` — mismo query que ya usaba el
  `CarritoCliente.jsx` viejo. `categoria` hace de "detalle" (no hay un
  campo de presentación/tamaño en `productos` — se verificó el esquema
  real antes de asumirlo). `foto_url` se resuelve con `urlPublicaFoto()`
  contra el bucket `fotos-productos` (el mismo que ya usa
  `ModalProducto.jsx` en Inventario) — si el producto no tiene foto,
  sigue cayendo al ícono `ShoppingBag` de antes.
- **Direcciones**: `direcciones_cliente`, mismo select/orden que ya
  usaba el carrito viejo. `SeccionDireccion` suma un estado nuevo para
  cuando la clienta no tiene ninguna guardada todavía: un enlace a Mis
  direcciones en vez de una lista vacía.
- **Zonas de delivery**: `zonas_delivery` — se confirmó que la RLS ya
  filtra `activo = true` del lado del servidor (`zonas_delivery_select`,
  85_carrito_pedidos_web.sql), así que el select del cliente no necesita
  repetir ese filtro.
- **Cupones**: `mis_cupones()` — se leyó su definición real en la base
  para confirmar las columnas exactas (`id, codigo, origen, valor,
  tipo_descuento, estado, creado_en, canjeado_en`) antes de mapear,
  coincide 1:1 con la forma que ya esperaba `TarjetaCupon.jsx`.
- **Cantidad/quitar**: vuelven a escribir de verdad en
  `carrito_productos` (`update`/`delete`, filtrado por
  `cliente_web_id = usuario.id`) y llaman a `recargarCarrito()`
  (`CarritoClienteContext`) para que el contador del header se
  mantenga sincronizado — "marcar/desmarcar" sigue siendo puramente
  local (nunca se persistía, ni en el carrito viejo).
- **`confirmar()` sigue sin llamar a ningún RPC** — a propósito:
  `confirmar_pedido_productos()` todavía no acepta día/hora/pago/
  comprobante/cupón, eso es exactamente lo que trae la Fase 3.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` con datos reales de su cuenta.

### 8.5 Efecto "Counter" (reactbits.dev) en cantidades y montos del carrito

El usuario pidió conectarse por MCP a reactbits.dev y aplicar su
componente "Counter" (dígitos que ruedan al cambiar el número) a los
botones de cantidad de productos y a cualquier monto que cambie por
esa cantidad (precio de la línea, subtotal, delivery, descuentos,
total).

**No existe ningún MCP de reactbits configurado** en este entorno (se
buscó antes de descartarlo, no se asumió). Se intentó además traer la
página real con WebFetch — sin éxito: reactbits.dev es una SPA que se
renderiza en el navegador, así que WebFetch solo trae el cascarón HTML
vacío (el `<title>`, nada del componente en sí). Mismo bloqueo que ya
se había encontrado antes con el comparison-slider (§7.66) y con
ShinyText en su momento — sin código fuente real disponible.

**Fix**: reconstrucción a mano del efecto que describe el nombre
"Counter" — un odómetro de dígitos — usando `framer-motion` (ya
instalado en el proyecto, `^13.3.0`). Nuevo componente
`Contador.jsx`: cada dígito es una columna de 0-9 apilada verticalmente
(10 filas de 1em), trasladada con `animate={{ y: '-Nem' }}` (spring)
para que el dígito correcto quede en la ventana visible de 1em — el
mecanismo real de cualquier "rolling counter"/odómetro, con o sin
código de referencia de por medio. Recibe el texto YA formateado (ej.
`"S/ 45.00"`, `"3"`) y solo anima los caracteres que son dígitos —
`S/`, el punto decimal y los espacios quedan estáticos, sin animación.

Aplicado en: el número de cantidad del stepper, el precio de línea de
cada producto (precio × cantidad), y en el resumen — Subtotal,
Delivery, Descuento en productos, Cupón y Total — todos los montos que
de verdad cambian cuando se toca `+`/`−` o se marca/desmarca un
producto.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que el efecto se parece a lo que tenía en mente
  (sin el componente real de referencia, es una reconstrucción
  razonada, no una copia).

### 8.6 Contador reescrito con el código REAL de React Bits (registro @react-bits)

El usuario insistió en que sí había una vía MCP — resultó tener razón a
medias: no existe un MCP dedicado de reactbits.dev, pero el proyecto ya
tenía configurado un registro `@react-bits` en `components.json` (el
mismo protocolo que usa shadcn/ui para distribuir componentes) — el MCP
de shadcn, que sí está conectado, lo puede consultar. Con
`search_items_in_registries`/`view_items_in_registries` se encontró
`Counter-JS-TW` (la variante JS+Tailwind, la que calza con este
proyecto) y, al no traer el contenido completo esas herramientas,
`npx shadcn view @react-bits/Counter-JS-TW` sí devolvió el código fuente
real completo.

**Diferencia real con la reconstrucción de §8.5**: el Counter de
verdad NO recorta un texto ya formateado — recibe un número crudo y
arma sus propias "posiciones" (unidades, decenas, centenas, decimales)
como potencias de 10, con un resorte (`useSpring`) independiente POR
DÍGITO y un truco de "camino más corto" al dar la vuelta (pasar de 9 a
0 gira 1 paso hacia adelante, no 9 hacia atrás) — mecánica bastante más
prolija que el "saltar directo a la posición" que tenía la v1.

`Contador.jsx` se reescribió como port fiel de ese código real, con
tres cambios deliberados:
- `motion/react` → `framer-motion` (el paquete que ya está instalado en
  este proyecto; mismos hooks `useSpring`/`useTransform`, incompatible
  en el nombre del paquete nada más).
- `value` (número) se queda igual, pero se sumó `decimales` — el
  original calcula sus posiciones por default a partir de
  `value.toString()`, que en JS recorta ceros finales
  (`(45).toString()` da `"45"`, nunca `"45.00"`) — para montos en soles
  eso daba un ancho inconsistente según el valor. `calcularPlaces()`
  fuerza siempre la misma cantidad de decimales.
- Se sacaron las props de estilo que no hacían falta (gradientes de
  desvanecido arriba/abajo, estilos de contenedor a medida) — se
  mantuvo intacta la mecánica del resorte/camino-corto, que es la parte
  que de verdad valía la pena traer fiel.

**Bug propio encontrado y corregido antes de terminar**: la v1 de este
port usaba `alto = '1em'` (string) pensando en que calzara solo con el
tamaño de letra de alrededor — pero la animación multiplica
`numero * alto` en JS (aritmética real, no CSS), así que multiplicar
por un string rompía la cuenta en silencio. Se volvió al criterio del
original: `tamano` es un número en px (como su `fontSize`), pasado a
mano en cada lugar donde se usa `Contador` según el tamaño real del
texto que lo rodea (14px en la mayoría de montos del resumen, 26px en
el Total grande). El símbolo `S/` ya no vive dentro del componente
(el real tampoco lo hacía) — se escribe aparte, como texto plano, antes
de cada `<Contador>`.
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` que ahora sí se parece al Counter real.

### 8.7 Campana de notificaciones (BellToggle de React Bits) en los dos headers

El usuario pidió aplicar el componente "Bell Toggle" de React Bits al
ícono de notificaciones que "todavía no está en el header del POS ni en
el de la Web" — con el mismo criterio de §8.6 (buscar el código real en
el registro `@react-bits` antes de construir nada).

**Aclaración importante antes de tocar código**: el `BellToggle` real
(visto con `npx shadcn view @react-bits/BellToggle-JS-TW`) NO es un
ícono que abre una lista — es una píldora interruptor de encendido/
apagado ("Notify me" / "You'll be notified") que se ensancha con un
`clip-path` al tocarla. Se le preguntó al usuario cómo quería usarlo;
confirmó: solo el ícono + el repique + el badge de conteo, sin la
píldora ni el estado on/off — el clic debe abrir el panel de
notificaciones, no alternar una preferencia.

**`IconoCampana.jsx`** (nuevo, en `src/components/`): recorte del
`BellToggle` real con esa forma. Dos detalles técnicos que valen la
pena anotar:
- El repique de la campana en el componente real NO usa `framer-motion`
  ni ninguna librería de animación — usa `element.animate()` nativo del
  navegador (Web Animations API) con keyframes calculados a mano
  (`ringKeyframes`, con un "camino más corto" para que la campana
  siempre gire hacia el lado más rápido de volver a cero). Se portó tal
  cual, así que este ícono no suma ninguna dependencia nueva.
- El original trae su ícono por default desde `@hugeicons/react` +
  `@hugeicons/core-free-icons` (dos paquetes que el proyecto no tiene) —
  pero también trae una variante `clapper` con un SVG de campana propio
  (sin esa dependencia). Se usó esa variante siempre, así que tampoco
  hacía falta instalar nada para el ícono en sí.
- `estiloBadge` es una prop nueva (no existía en el original, que traía
  colores fijos) para poder pintar el badge distinto en cada header sin
  duplicar el componente — ver más abajo.

**Header del POS** (`src/components/Header.jsx`): campana agregada
entre la etiqueta de la pestaña actual y `<MenuUsuario />`, con
`contador={0}` (badge apagado) y el clic mostrando un toast
"próximamente" — a propósito: hoy NO existe ningún sistema de
notificaciones para el personal (eso es la campanita de staff que se
diseñó en una conversación anterior de esta misma sesión, pendiente,
necesita tablas/triggers nuevos), así que sería falso mostrar un ícono
"funcional" sin datos reales detrás. Badge en rojo (default del
componente), que ya es el color de alerta que usa el resto del POS.

**Header de la Web** (`src/pages/PortalCliente.jsx`): acá SÍ hay datos
reales — se investigó primero (agente de exploración) y se confirmó que
`NotificacionesClienteContext.jsx` (contador de no leídas),
`NotificacionesCliente.jsx` (la bandeja completa, ruta
`/mi-perfil/notificaciones`) y el marcado de leída YA existían desde
antes — lo único que faltaba era el ícono en el header en sí (hoy la
campana solo vivía adentro del menú del avatar). Nuevo componente
`BotonNotificaciones`, mismo patrón "se vuelve botón de volver si ya
estás en su propia página" que ya usan `BotonChanchito`/`BotonCarrito`
en este mismo archivo — clic navega a `/mi-perfil/notificaciones` (o
`navigate(-1)` si ya estás ahí), contador real desde
`useNotificacionesCliente()`. Badge con `estiloBadge` en
`--lw-metal-azul`/texto negro, igual que la insignia del carrito
(§7.57: el azul metálico es el acento único de todo el portal cliente,
no rojo).

Queda tal cual sin tocar el bell que ya vivía dentro de
`MenuUsuarioCliente.jsx` (mismo dato, dos lugares donde se ve — no es
un error, es el mismo criterio que ya usan otras apps: un ícono en el
header y además la entrada resaltada en el menú).
- Build y lint verificados. Sin verificación visual en vivo (mismo
  bloqueo de permisos de siempre) — pendiente que el usuario confirme
  con `npm run dev` en las dos apps (POS y Web).

### 8.8 Migración 2 de Fase 3 — pago, comprobante y verificación (`100_pedidos_web_pago.sql`)

Segunda migración del rediseño del carrito (`docs/diseno-carrito/`),
aplicada en vivo vía MCP de Supabase por pedido explícito del usuario
("escribelo y ejecutalo"). Antes de escribir una sola línea se leyó el
cuerpo completo real de `confirmar_venta()` (con `pg_get_functiondef`,
no de memoria) — descubrir que esa función YA validaba y redimía
cupones de punta a punta permitió simplificar de entrada lo que se
tenía planeado para la futura Migración 4 (cupones en pedidos web), en
vez de duplicar esa lógica en `confirmar_pedido_productos()`.

**Contenido de la migración**:
- Bucket privado `comprobantes-pedidos-web` (RLS: cada clienta solo
  puede subir/ver los suyos, por carpeta `auth.uid()`; admin ve todos).
- Bucket público `qr-pagos` (lectura pública, escritura solo admin) —
  para los QR de Yape/Plin que el negocio suba desde el panel.
- `estado_negocio` gana `yape_numero/titular/qr_url` y
  `plin_numero/titular/qr_url` (Transferencia reutiliza el
  `cuenta_transferencia` que ya existía).
- `pedidos_web` gana `metodo_pago`, `comprobante_url`, `cupon_codigo`,
  `pago_verificado` (default `false`), `pago_verificado_en/por`,
  `venta_id`.
- `confirmar_pedido_productos()` cambia de firma otra vez — de 7 a 10
  parámetros (`p_metodo_pago, p_comprobante_url, p_codigo_cupon`
  nuevos) — mismo `drop function` obligatorio antes del `create or
  replace` (§99, ya documentado como regla). Valida método de pago,
  exige comprobante, y si hay cupón solo verifica que EXISTA y esté
  `DISPONIBLE` — a propósito NO lo redime todavía: eso pasa recién al
  verificar el pago (ver abajo). Ningún efecto financiero real (stock,
  cupón, puntos) puede ocurrir antes de que un admin confirme que el
  comprobante es válido — regla de negocio ya establecida en una
  conversación anterior de esta sesión.
- `confirmar_venta()` también cambia de firma (8 → 9 parámetros,
  `p_costo_delivery` al final) — mismo `drop function` obligatorio. Se
  mantuvo su cuerpo original intacto y se agregó una sola línea
  (`v_total := v_total + p_costo_delivery`) justo después del bloque de
  cupón/descuento y antes de la validación de Efectivo — así el
  delivery nunca se descuenta con un cupón. Decisión deliberada: el
  delivery NO es una línea propia en `venta_items` (esa tabla solo
  entiende PRODUCTO/SERVICIO) — para ventas que vienen de un pedido
  web, `ventas.total` puede superar la suma de `venta_items.subtotal`
  en exactamente el costo de delivery, reconciliable vía
  `pedidos_web.costo_delivery` a través de `pedidos_web.venta_id`.
- Nueva `verificar_pago_pedido_web(p_pedido_id)` — solo admin, bloquea
  la fila del pedido (`for update`), rechaza si ya estaba verificado o
  cancelado, arma el arreglo de items desde `pedidos_web_items` y llama
  a `confirmar_venta()` por dentro con el método de pago, cliente,
  cupón y costo de delivery del pedido — ahí sí se redime el cupón y se
  descuenta el stock, todo dentro de la misma transacción. Al terminar
  marca `pago_verificado=true`, guarda quién y cuándo, enlaza
  `venta_id` y pone el pedido en `LISTO`. Caso límite documentado a
  propósito sin resolver: si un producto se borra entre que se crea el
  pedido y se verifica el pago, `producto_id` queda en null (`on delete
  set null`) y esa línea se excluye en silencio de la venta —
  aceptable por lo raro que sería, no vale la pena más lógica para eso.

**Verificación post-aplicación** (no se asumió éxito solo por el
`{"success":true}` del MCP): se consultó `pg_proc` por nombre y
`pronargs` — `confirmar_pedido_productos` quedó en 10 argumentos,
`confirmar_venta` en 9, `verificar_pago_pedido_web` en 1, cada nombre
una sola vez (sin overload viejo colgando). Se revisaron también los
advisors de seguridad del proyecto después de aplicar — sin hallazgos
nuevos atribuibles a esta migración (los `SECURITY DEFINER` marcados
como ejecutables por `authenticated` son el patrón ya usado en todo el
proyecto para estas funciones, no una regresión).

Pendiente (Fase 4, frontend): `CarritoCliente.jsx` todavía no llama a
la función real — su `confirmar()` sigue siendo un placeholder que solo
muestra un toast ("Diseño en construcción"). Falta además que
`alSubirCaptura` retenga el `File` real (hoy solo guarda el nombre y
una preview local) antes de poder subirlo de verdad al bucket.

### 8.9 Migración 3 de Fase 3 — comprobante fiscal (`101_pedidos_web_comprobante.sql`)

Tercera migración del rediseño del carrito. El toggle Boleta/Factura
con RUC y razón social ya existía en el carrito desde la Fase 1
(`SeccionComprobante`, con la validación `facturaCompleta` en el
navegador) pero esos datos se perdían al confirmar — el servidor no los
guardaba ni los volvía a validar. **Aclaración importante, porque el
nombre puede sonar a más de lo que es**: esto NO es facturación
electrónica de verdad — no hay integración con SUNAT, series ni
números correlativos. Solo se guarda la elección de la clienta para
que el negocio emita el comprobante real por fuera del sistema, como
ya lo hace hoy. Se confirmó primero que `ventas`/`confirmar_venta()` no
tiene ningún concepto de comprobante fiscal — por eso esto vive
enteramente en `pedidos_web`, sin tocar esa función.

- `pedidos_web` gana `tipo_comprobante` (`BOLETA`/`FACTURA`, `not null
  default 'BOLETA'` — la tabla seguía vacía, sin backfill necesario),
  `ruc`, `razon_social`.
- `confirmar_pedido_productos()` cambia de firma otra vez — de 10 a 13
  parámetros (`p_tipo_comprobante, p_ruc, p_razon_social`, los 3 con
  default al final) — mismo `drop function` obligatorio de siempre.
  Valida server-side lo mismo que ya validaba el navegador: con
  `FACTURA` exige `p_ruc` de exactamente 11 dígitos (`~ '^\d{11}$'`,
  algo más estricto que el `length === 11` del frontend, a propósito —
  un RUC real siempre es numérico) y `razon_social` no vacía.
- Verificado post-aplicación: `confirmar_pedido_productos` con 13
  argumentos (una sola función), columnas nuevas presentes con el
  default esperado.

Con esta migración, las 3 primeras de las 5 planeadas en Fase 3 están
aplicadas. Se revisó de cerca la Migración 4 (cupones) antes de
escribirla — resultó no necesitar SQL nuevo: `pedidos_web.cupon_codigo`
ya existe desde §8.8, `confirmar_pedido_productos()` ya valida que el
cupón exista y esté `DISPONIBLE`, y `verificar_pago_pedido_web()` ya le
pasa ese código a `confirmar_venta()`, que redime el cupón, aplica el
descuento y hasta dispara la recompensa de referido — todo ya
construido de fondo en la Migración 2. Queda solo Migración 5
(`precio_antes` en productos, no bloquea nada de esto).

### 8.10 Fase 4 — `CarritoCliente.jsx` conectado al RPC real

Con las migraciones 1-3 de Fase 3 ya aplicadas, `confirmar()` deja de
ser el placeholder que solo mostraba un toast ("Diseño en
construcción") y pasa a llamar de verdad a
`confirmar_pedido_productos()` (los 13 parámetros vigentes tras
§8.9), subiendo antes el comprobante real a Storage.

**Gap cerrado**: `alSubirCaptura` solo guardaba `archivo.name` + una
preview local (`URL.createObjectURL`) — nunca el `File` en sí, así que
no había nada que subir de verdad. Se agregó el estado
`capturaArchivo` (guarda el `File` real) junto a los ya existentes
`captura`/`capturaPreview`; `faltaPago` (que habilita el botón
Confirmar) ahora se calcula sobre `capturaArchivo`, no sobre el string
del nombre.

**`confirmar()`**, con el mismo patrón que ya usan `MiPerfil.jsx` /
`MenuUsuario.jsx` para fotos de perfil (`procesarImagen` +
`subirFoto`, ambos de `src/lib/imagenes.js`, ruta
`{usuario.id}/{crypto.randomUUID()}.{extension}`):
1. Comprime la captura a webp/jpg (`ladoMaximo: 1400, calidad: 0.9` —
   más alto que el default de 600px/0.8 de las fotos de perfil, porque
   acá lo que importa es que el monto y la hora de la operación se
   sigan leyendo bien en la captura).
2. La sube al bucket privado `comprobantes-pedidos-web` (de §8.8) —
   nunca a uno público, es un comprobante de pago.
3. Llama a `supabase.rpc('confirmar_pedido_productos', {...})` con los
   13 parámetros: productos marcados, entrega, fecha (convertida de
   la clave `claveDiaLima` del calendario a un ISO real con el nuevo
   helper local `claveDiaAISO` — la clave nunca debe viajar tal cual a
   un campo `date`, ver el comentario ya existente sobre
   `claveDiaLima` en `src/lib/fechas.js`), hora, método de pago, la
   ruta del comprobante recién subido, zona/dirección/celular (solo si
   `DELIVERY`), el código del cupón aplicado, y tipo de comprobante +
   RUC/razón social (solo si `FACTURA`).
4. Si el RPC lanza una excepción (cualquiera de las validaciones del
   servidor — día/hora fuera de horario, RUC inválido, cupón ya usado,
   etc.), se muestra tal cual en un toast de error — el servidor ya
   redacta esos mensajes en español, pensados para mostrarse directo.
5. Si sale bien: toast de éxito, `recargarCarrito()` (refresca el
   contador del header) y `navigate('/inicio')`.

**Pendiente, fuera de esta tarea a propósito**: no existe todavía
ninguna pantalla de "mis pedidos" en el portal cliente — hoy
`confirmar()` no tiene a dónde más mandar a la clienta a seguir su
pedido más que Inicio. `HistorialCliente.jsx` es de atenciones/citas,
no de pedidos de productos. Construir esa pantalla es tarea aparte, no
pedida todavía.
- Build y lint verificados (`npm run build`, `npm run lint` — oxlint,
  sin advertencias nuevas). Sin verificación visual en vivo de un
  pedido real de punta a punta (mismo bloqueo de permisos de siempre)
  — pendiente que el usuario confirme con `npm run dev` que el flujo
  completo (subir captura → Confirmar pedido) funciona y que el pedido
  aparece bien en "Pedidos Web" del POS.

### 8.11 Fix: el panel admin no mostraba la captura ni el cupón del pedido

El usuario reportó dos pedidos de prueba reales (con cupón C36673, 20%
PORCENTAJE) donde el panel admin de "Pedidos Web" no dejaba ver la
captura de pago ni reflejaba el descuento del cupón. Investigando con
datos reales de esos 2 pedidos se encontraron dos problemas distintos,
uno de cada lado:

**1. Bug real en el servidor, no solo de pantalla**: `confirmar_pedido_
productos()` (desde §8.8) valida que el cupón exista y esté
`DISPONIBLE`, pero nunca restaba su descuento del `total` — guardaba
`total = subtotal + costo_delivery` sin tocar el cupón para nada. Los
2 pedidos de prueba lo confirmaron: subtotal 12.00 con cupón de 20%
tenían `total` en 22.00 y 12.00 (sin descuento), en vez de 19.60 y
9.60. La redención real del cupón (marcarlo `CANJEADO`, aplicarlo a la
`venta`) sigue pasando recién en `verificar_pago_pedido_web()` — eso
está bien, es la regla de "nada financiero real antes de verificar el
pago" ya establecida. Lo que faltaba era calcular ese mismo descuento
por ADELANTADO (sin redimir el cupón todavía) para que el total que ve
la clienta en el carrito, el monto que se le pide pagar, y lo que ve
el admin, coincidan los tres.

**`102_pedidos_web_descuento_cupon.sql`** (aplicada en vivo): agrega
`pedidos_web.descuento_cupon numeric(10,2) default 0`, y reescribe
`confirmar_pedido_productos()` (mismos 13 parámetros, sin `drop
function` esta vez porque la firma no cambia) para calcular el
descuento con la misma fórmula que ya usa `confirmar_venta()`
(PORCENTAJE sobre el subtotal de productos, nunca sobre el delivery;
MONTO_FIJO topado al subtotal, con excepción si el cupón vale más que
el pedido) y restarlo del `total`. Se corrigieron también con un
`update` los 2 pedidos de prueba ya existentes (seguían `PENDIENTE`,
sin `venta_id`, sin ningún efecto financiero real que se viera
afectado por corregirlos).

**2. El panel admin nunca mostraba la captura, y "Marcar listo" nunca
pasaba por la verificación de pago real**: revisando `PedidosWeb.jsx`
para agregar el botón de ver la captura salió un problema más de
fondo — el comentario del archivo seguía hablando de una versión vieja
sin pago online (`85_carrito_pedidos_web.sql`, migración que ya no
existe con ese número) y el botón "Marcar listo" hacía un `update`
crudo de `estado` a `LISTO`, sin llamar nunca a
`verificar_pago_pedido_web()`. Eso significa que CUALQUIER pedido
marcado "Listo" hasta ahora nunca generó una venta real: nunca se
descontó el stock, nunca se redimió el cupón, nunca existió una fila
en `ventas` detrás — el admin solo estaba cambiando una etiqueta, no
confirmando el pago de verdad. Confirmado con los 2 pedidos de prueba:
ambos con `venta_id` y `pago_verificado` en null/false porque nunca se
verificaron.

Fix en `PedidosWeb.jsx`:
- El botón "Marcar listo" (solo visible en `PENDIENTE`) se reemplaza
  por "Verificar pago", que llama a
  `supabase.rpc('verificar_pago_pedido_web', { p_pedido_id })` — el
  único camino real de ahí en adelante para pasar a `LISTO`. "Listo →
  Entregado" y "Cancelar" siguen siendo un `update` simple, sin efecto
  financiero, tal cual estaban.
- Nueva función `verComprobante(pedido)` + helper `urlFirmadaFoto()`
  (nuevo, en `src/lib/imagenes.js`) — el bucket `comprobantes-pedidos-
  web` es privado (§8.8), así que `getPublicUrl()` no sirve; hace
  falta firmar la URL cada vez que se abre (`createSignedUrl`, 5
  minutos de vigencia). Botón "Ver comprobante" abre esa URL firmada
  en una pestaña nueva — mismo patrón que los links de WhatsApp que ya
  existían en este panel (abrir hacia afuera, sin preview inline, para
  no complicar el panel con estado de imágenes cacheadas).
- Se agregó al desglose del pedido: la línea del cupón aplicado (con
  su descuento real, ahora que el fix de arriba lo calcula bien),
  método de pago, insignia de "verificado" cuando `pago_verificado` es
  `true`, y los datos de factura (RUC/razón social) cuando
  `tipo_comprobante = 'FACTURA'` — nada de esto se mostraba antes.
- Build y lint verificados. Sin verificación visual en vivo — pendiente
  que el usuario confirme con `npm run dev` que "Verificar pago" sobre
  los 2 pedidos de prueba efectivamente descuenta el stock, redime el
  cupón y crea la venta.

### 8.12 Nueva pestaña "Pedidos" en el portal cliente

Pedido del usuario: la clienta no tenía dónde ver el estado de sus
pedidos de productos ni forma de cancelarlos — hasta ahora ese lado
del flujo solo existía en el panel admin (`PedidosWeb.jsx`, §8.11).
Regla de cancelación explícita del usuario: solo se puede cancelar
mientras el admin NO haya confirmado (verificado) el pago todavía; una
vez que ya se generó la venta, hay que hablar directo con el negocio
para pedir la devolución — la app no la revierte sola.

**`103_cancelar_pedido_web.sql`** (aplicada en vivo): nuevo RPC
`cancelar_mi_pedido_web(p_pedido_id)`, mismo patrón que
`cancelar_mi_cita_web()` (security definer, valida dueño vía
`mi_cliente_id()`, `for update` antes de tocar la fila). No existía
ninguna policy de UPDATE para el cliente sobre `pedidos_web` (solo
`pedidos_web_update_admin`) — a propósito: la regla de "solo si
`pago_verificado = false`" se valida en un solo lugar controlado
(el RPC), no en una policy de RLS ni solo en el botón del frontend.
Si el pago ya fue verificado, la función lanza una excepción con el
mismo mensaje que se le muestra a la clienta ("comunícate
directamente con el negocio para solicitar la devolución") — nunca
confía en que el botón ya esté deshabilitado del lado del cliente.

**`PedidosCliente.jsx`** (nuevo, en `src/pages/cliente/`), ruta
`/mi-perfil/pedidos` — mismo patrón anidado bajo Mi Perfil que
Direcciones/Notificaciones/Seguridad/Referidos (`titulosSubpaginasCliente`
para la migaja, entrada nueva en el menú del avatar
`MenuUsuarioCliente.jsx` junto a "Direcciones", y un segundo botón
rápido "Mis pedidos" en `MiPerfil.jsx` al lado de "Mis direcciones").
Cada pedido muestra: estado (mismas 4 etiquetas de color que ya usa
`PedidosWeb.jsx` admin — Pendiente/ámbar, Listo/azul, Entregado/verde,
Cancelado/gris — los tokens `--color-amber/blue/green` son globales,
no exclusivos del tema POS, así que funcionan igual acá), los
productos, el desglose con cupón si aplica (ahora correcto gracias al
fix de §8.11), día/hora de entrega o recojo, método de pago, y el
total.

- Si el pedido sigue `PENDIENTE` y `pago_verificado` es `false`:
  botón "Cancelar pedido" con confirmación (mismo modal `lw-bar` que ya
  usa `DireccionesCliente.jsx` al eliminar una dirección) → llama a
  `cancelar_mi_pedido_web()`.
- Si `pago_verificado` es `true` (y el pedido no está ya Entregado o
  Cancelado): en vez del botón, un aviso + link de WhatsApp real al
  negocio (mismo `datos_contacto()`/`numeroWhatsapp()` que ya usan
  `NosotrosCliente.jsx`/`PieClienteWeb.jsx`, no un número de relleno)
  para pedir la devolución directamente.
- Build y lint verificados. Sin verificación visual en vivo — pendiente
  que el usuario confirme con `npm run dev` que la pestaña se ve bien y
  que cancelar un pedido `PENDIENTE` (como los 2 de prueba, todavía sin
  verificar) funciona de punta a punta.

### 8.13 Migración 5 de Fase 3 — `precio_antes` en productos (última de las 5)

Última migración planeada del rediseño del carrito.
`CarritoCliente.jsx` ya tenía TODA la lógica visual lista desde la
Fase 1 (etiqueta de % de descuento, precio tachado, línea de
"Descuento en productos" en el resumen) pero la traía hardcodeada en
`null` porque la columna no existía.

**`104_precio_antes_productos.sql`** (aplicada en vivo):
`productos.precio_antes numeric(10,2)`, opcional, con
`check (precio_antes is null or precio_antes > 0)`. `productos_vista`
(la vista que lee Inventario, con columnas explícitas — no
`select *`) necesitó su propio `create or replace view` para sumar la
columna — **error real encontrado al aplicarlo**: Postgres compara las
columnas de una vista por POSICIÓN, no por nombre, así que insertarla
entre `precio` y `costo` corrió a `costo` un lugar y Postgres lo leyó
como "le cambiaste el nombre a la columna costo" (`cannot change name
of view column`) — se resolvió agregando `precio_antes` al FINAL de la
lista de columnas en vez de junto a `precio` (donde iría por lógica).
Sin ningún `grant` nuevo: `authenticated` ya tenía `SELECT` a nivel de
tabla completa desde antes, una columna nueva queda cubierta sola.

Frontend:
- `ModalProducto.jsx` (crear/editar producto, usado por
  `Inventario.jsx`): nuevo campo "Precio antes (oferta)", opcional.
  Valida que si se llena sea mayor a 0 y mayor al precio de venta
  actual (si no, no sería un descuento).
- `Inventario.jsx`: suma `precio_antes` a su `SELECT_PRODUCTOS`.
- `CarritoCliente.jsx`: el `select` de `carrito_productos` ahora pide
  `productos(...,precio_antes,...)` y `precioAntes` deja de ser
  `null` fijo — lee el valor real.

**Fuera de esta migración a propósito**: el catálogo público
(`ProductosCliente.jsx`) sigue mostrando solo el precio actual, sin la
etiqueta de "% off" — el precio que se cobra ya es el correcto (nunca
dependió de esta columna), es solo que el badge visual de descuento no
se agregó ahí. La tarjeta iridiscente tiene el `.iri-share`
(28×28, esquina superior izquierda) y `.iri-heart` (32×32, superior
derecha) ya ocupando las dos esquinas de arriba — sumar la etiqueta
`.lw-etq-desc` (pensada para la tarjeta rectangular del carrito, no
para esta tarjeta con esquinas ya ocupadas) habría necesitado una
posición nueva a medida, y no era parte de lo pedido. Se deja anotado
como pulido opcional a futuro, no como pendiente bloqueante.
- Build y lint verificados. Sin verificación visual en vivo — pendiente
  que el usuario pruebe con `npm run dev` poniéndole un precio de
  oferta a un producto real y viéndolo reflejado en el carrito.

### 8.14 Datos reales de pago (Yape/Plin/Transferencia) en el carrito

Último punto pendiente de todo el rediseño del carrito, y el más
urgente de los que quedaban: `CarritoCliente.jsx` mostraba literalmente
`"[QR Yape]"` como texto y una instrucción con `"[NOMBRE DEL DUEÑO]"` y
un número de cuenta/celular inventado — las columnas reales
(`estado_negocio.yape_numero/titular/qr_url`, `plin_*`,
`cuenta_transferencia`) ya existían desde la Migración 2 (§8.8) pero
nadie las llenaba ni el carrito las leía. Sin esto, ningún pedido real
podía probarse de punta a punta: la clienta habría visto instrucciones
falsas.

**`ContactoWeb.jsx`** (panel admin, ya editaba dirección/teléfono/
redes de `estado_negocio`) gana una sección nueva "Métodos de pago del
carrito web": número + titular + subir QR para Yape y Plin (nuevo
componente interno `CampoMetodoPago`, mismo patrón de foto que
`ModalProducto.jsx` — sube primero a Storage, borra la anterior recién
cuando el guardado en BD ya fue exitoso, para no dejar huérfanos), más
el campo de cuenta de Transferencia (reutiliza `cuenta_transferencia`,
la misma columna que ya se edita rápido desde Ventas.jsx al cobrar en
el mostrador — un aviso en el propio campo aclara que es el mismo
dato, para que no parezca un tercer lugar desincronizado). Los QR se
suben al bucket público `qr-pagos` (de §8.8).

**`EstadoNegocioContext.jsx`** (ya existía, ya leía `abierto` +
`cuenta_transferencia` con Realtime) se extendió para traer también
`yape_numero/titular/qr_url` y `plin_numero/titular/qr_url`,
agrupados en un solo objeto `pagos` — se eligió extender este context
en vez de que `CarritoCliente.jsx` hiciera su propio fetch aparte,
porque ya está montado en toda la app (`main.jsx`) y ya mantiene estos
datos al día con Realtime sin código nuevo.

**`CarritoCliente.jsx`**: `instruccionPago` y el bloque del QR ya no
tienen ningún dato inventado — usan `pagos`/`cuentaTransferencia` del
context. Si el admin todavía no configuró un método (número vacío),
se avisa explícitamente ("El negocio todavía no configuró Yape —
escríbenos por WhatsApp antes de pagar.") en vez de mostrar un campo
vacío o un placeholder que pudiera confundirse con un dato real.
- Confirmado en la base antes de tocar código: la policy de SELECT de
  `estado_negocio` es `rol_actual() is not null` (cualquier sesión con
  rol resuelto, incluida una clienta) — a nivel de FILA, así que las
  columnas nuevas quedan cubiertas solas, sin policy ni grant nuevo.
  El bucket `qr-pagos` es público (`storage.buckets.public = true`),
  confirmado con una consulta antes de asumirlo — por eso el QR se
  puede mostrar con `urlPublicaFoto()` directo, sin firmar ninguna URL
  (a diferencia del comprobante de pago, que sí es privado).
- Build y lint verificados. Sin verificación visual en vivo — pendiente
  que el usuario configure un Yape/Plin real desde `ContactoWeb.jsx`
  con `npm run dev` y confirme que el carrito los muestra bien.

Con esto, las 5 migraciones de Fase 3, la Fase 4 (frontend), los fixes
de §8.11 (comprobante + verificación real en el panel admin) y la
nueva pestaña de pedidos del cliente (§8.12) quedan completos — el
flujo de compra de productos por la Web queda de punta a punta con
datos reales, sin ningún placeholder pendiente. Lo que sigue, fuera de
este roadmap (ver conversación): notificaciones push reales para el
personal, y el mini-carrito de servicios dentro de Citas.

## 9. Mini-carrito de servicios en Citas

Pedido del usuario, ya anticipado desde el inicio del rediseño del
carrito (§8, decisión "servicios pasan a un mini-carrito propio dentro
de Citas — tarea aparte, futura"). Antes de tocar código se investigó
el estado real: **la mitad de esto ya existía y estaba huérfano**.
`ServiciosCliente.jsx` ya tenía un botón "Agregar" por servicio,
respaldado por una tabla real `carrito_servicios` y
`CarritoClienteContext.jsx` (`serviciosCarrito`, un `Set` de IDs,
`agregarServicio`/`quitarServicio`) — nada de esto se tocó nunca
durante el rediseño del carrito de productos, solo dejó de tener
dónde mostrarse cuando se sacó el bloque "Servicios para reservar" del
carrito viejo. `ModalAgendarCitaCliente.jsx` incluso ya tenía una prop
`serviciosIniciales` con un comentario que describía exactamente ese
flujo removido ("Precargados desde el carrito... → 'Reservar cita'").

Se confirmaron 3 decisiones de diseño con el usuario antes de escribir
nada:
1. El ícono de carrito del header (arriba de toda la Web) — **bug
   real encontrado de paso**: contaba `serviciosCarrito.size +
   productosCarrito.size` pero siempre lleva a `/carrito`, que es
   solo-productos desde el rediseño — el número mostrado nunca
   coincidía con lo que esa pantalla mostraba. Se corrigió para que
   cuente solo productos.
2. El mini-carrito vive al lado derecho del calendario en Citas (no
   un panel deslizante).
3. Al confirmar una cita con esos servicios, se quitan del
   mini-carrito — ya se convirtieron en algo real, dejarlos ahí sería
   como un carrito de compras que no se vacía al pagar.

**`CarritoClienteContext.jsx`**: `totalItems` (servicios+productos) se
reemplaza por `totalItemsProductos` (solo productos) — único
consumidor era `BotonCarrito` en `PortalCliente.jsx`, corregido para
usar el nuevo valor. Nueva función `vaciarServiciosReservados(ids)` —
un solo `delete ... in()`, no un `quitarServicio()` por servicio.

**`MiniCarritoServiciosCitas.jsx`** (nuevo, en `src/components/`):
lee `serviciosCarrito` del context y pide nombre/precio/duración solo
de esos IDs (no el catálogo completo, eso lo sigue haciendo
`ModalAgendarCitaCliente` al abrirse). Lista con botón de quitar por
servicio, total de precio y duración, botón "Reservar cita" que
entrega la lista completa (no solo IDs) al llamador. Estado vacío con
link a "Ver servicios".

**`CitasCliente.jsx`**: pasa de una sola columna (`max-w-md`) a una
grilla de 2 columnas en `lg+` (`420px` calendario + `360px`
mini-carrito, centradas como par) — en móvil se apilan, mini-carrito
después de las citas del día. Nuevo estado `serviciosParaReservar`:
se llena con los IDs al tocar "Reservar cita" desde el mini-carrito, se
vacía (`[]`) al tocar el botón "Agendar" de siempre (agendado en
blanco, como ya funcionaba) — ambos casos abren el mismo modal, la
única diferencia es qué le llega en `serviciosIniciales`. Al agendar
con éxito, se llama a `vaciarServiciosReservados()` con los servicios
que `ModalAgendarCitaCliente` ya devolvía en su callback
`onAgendada(fechaHora, serviciosReservados)` — ese segundo argumento
ya existía, `CitasCliente.jsx` simplemente no lo usaba todavía.

**`ServiciosCliente.jsx`**: el botón decía "En tu carrito" una vez
agregado — confuso ahora que el destino real es Citas, no `/carrito`.
Cambiado a "Agregado" + un toast nuevo solo al agregar ("Agregado —
resérvalo desde Citas."), nada al quitar.

- Build y lint verificados (`npm run build`, `npm run lint`). Sin
  verificación visual en vivo — pendiente que el usuario confirme con
  `npm run dev` que el mini-carrito se ve bien al lado del calendario
  en desktop, se apila bien en móvil, y que agregar en Servicios →
  reservar desde Citas → la cita se agenda y el servicio desaparece
  del mini-carrito, todo de punta a punta.

## 10. Fix: Mi Panel en blanco ("Algo salió mal") para cualquier admin/asistente con atenciones propias

Reportado por el usuario: Mi Panel no cargaba para la admin Claudia
("Algo salió mal"), pero sí para el admin Miguel Jesús. Con la
consola del navegador (captura del usuario) se vio el error real:
`RangeError: Invalid time value` en `formatearTituloDia`, disparado
desde `agruparPorDia` dentro de `MiPanel.jsx` — un bug **preexistente**,
no introducido en esta sesión (no se había tocado `MiPanel.jsx` ni
nada de lo que usa, hasta ahora).

**Causa real**: `agruparPorDia` llamaba a `parsearFechaISOLima(registro.
fecha)`, una función pensada para columnas `date` puras
("YYYY-MM-DD", ver su doc en `src/lib/fechas.js`) — pero se confirmó
en la base que `registro_servicios.fecha` es en realidad `timestamp
with time zone` (un valor real tipo
`"2026-09-27T06:14:00+00:00"`). Al partir ESE string por guiones, el
"día" quedaba como `"27T06:14:00+00:00"` → `Number(...)` da `NaN` →
`Date.UTC` con `NaN` da una fecha inválida → recién explota más tarde,
al intentar formatearla con `Intl.DateTimeFormat` en
`formatearTituloDia`. El comentario que justificaba ese código decía
literalmente "registro.fecha es una columna `date` de Postgres" — dato
falso, nunca verificado contra el esquema real; lo más probable es que
se copió de un fix parecido y válido para otra pantalla (`deudas.fecha`
y `mobiliario_compras.fecha` sí son `date` de verdad — se confirmaron
los 6 usos de una columna "fecha" en todo el proyecto antes de tocar
nada, para no repetir el mismo error de suposición).

**Por qué solo le pasaba a Claudia**: un admin ve por defecto SU
PROPIO panel filtrado (línea ~131, "el admin ve su propio panel por
defecto"). Miguel Jesús no tiene ninguna atención propia registrada
este período, así que `grupos` quedaba vacío y el `.map()` que dispara
el bug nunca llegaba a ejecutarse — Claudia sí tenía atenciones reales,
así que para ella siempre fallaba, desde que se cargaba la pantalla.

**Fix**: en las 2 líneas donde se usaba mal (`agruparPorDia` y el
cálculo de `puedeCancelar`, que hacía lo mismo para revisar si una
atención es de hoy), se cambió `parsearFechaISOLima(registro.fecha)`
por `new Date(registro.fecha)` — lo correcto para un timestamp real,
mismo criterio que ya usaba correctamente `formatearHora(registro.
fecha)` unas líneas más abajo en el mismo archivo (nunca se tocó,
porque nunca estuvo mal). Import de `parsearFechaISOLima` retirado del
archivo, ya no se usa ahí.

- Build y lint verificados. Sin verificación visual en vivo — pendiente
  que el usuario confirme con la cuenta de Claudia que Mi Panel ahora
  carga bien.

## 11. Fix: el carrito web no mostraba el QR de Yape/Plin recién subido

Reportado por el usuario justo después de subir un QR real desde
`ContactoWeb.jsx` (§8.14) y guardar: en el carrito web las fotos no
cargaban. Se verificó paso a paso antes de tocar nada:
- El archivo SÍ quedó bien subido a Storage (`storage.objects`
  confirmado, tamaño y `mimetype: image/webp` correctos).
- La URL pública responde `200 OK` real (probado con `curl` directo,
  `Content-Type: image/webp`, `Access-Control-Allow-Origin: *`) — el
  archivo en sí nunca fue el problema.
- La fila en `estado_negocio` tenía los valores correctos guardados
  (`yape_qr_url`, `plin_qr_url`, etc.).

Con la subida y los datos descartados, quedaba la lectura del lado del
cliente. Causa real: la policy de `SELECT` de `estado_negocio` era
`rol_actual() is not null` — y `rol_actual()` busca la sesión en
`usuarios` (personal del POS: admin/cajera/asistente). Una clienta real
vive en `clientes`, nunca en `usuarios`, así que para ella
`rol_actual()` siempre daba `null` y la policy bloqueaba TODA la fila
completa (no solo el QR — también `yape_numero`, `cuenta_
transferencia`, todo). Este hueco nunca se había notado porque el
único componente que antes leía algo de `EstadoNegocioContext.jsx`
(`AvisoNegocioCerrado.jsx`, el aviso de "negocio cerrado") solo vive
en `Layout.jsx`, el shell del POS — nunca se montó en el portal
cliente hasta que `CarritoCliente.jsx` empezó a usar este mismo
context en la Fase 4 (§8.14). Fue la primera vez que una sesión de
clienta de verdad intentaba leer esta tabla.

**`105_estado_negocio_select_clientes.sql`** (aplicada en vivo):
`alter policy estado_negocio_select ... using (rol_actual() is not
null or mi_cliente_id() is not null)` — mismo helper `mi_cliente_id()`
que ya usan las policies de `pedidos_web`/`carrito_productos`/etc.
Verificado post-aplicación con `pg_policy`.

No fue necesario tocar nada del frontend — `EstadoNegocioContext.jsx`
y `CarritoCliente.jsx` ya estaban bien escritos, simplemente nunca
recibían la fila porque RLS la bloqueaba antes de llegar al cliente.
- Pendiente que el usuario confirme con `npm run dev` (sesión de
  clienta real, no de personal) que el QR ahora sí se ve en el
  carrito.

## 12. Fix: el botón "Agregar" de Productos quedaba persistente

Reportado por el usuario: en `ProductosCliente.jsx` (catálogo web),
tocar "Agregar" convertía el botón en un stepper que reflejaba la
cantidad REAL del carrito y se quedaba así mientras el producto
siguiera ahí — "persistente para siempre". Pedido explícito: dos
controles separados — un selector de cantidad (para elegir cuántas) y
un botón "Agregar" aparte que mande esa cantidad de una vez; después
de agregar, la tarjeta vuelve sola a su estado normal (cantidad 1,
botón "Agregar"), aunque el carrito de verdad ya tenga esas unidades.

**`CarritoClienteContext.jsx`**: `agregarProducto(productoId, cantidad
= 1)` gana un segundo parámetro — sigue funcionando igual si no se
pasa nada (default 1), pero ahora puede sumar varias unidades de una
sola vez en vez de siempre +1.

**`ProductosCliente.jsx`**: la tarjeta de cada producto se extrajo a
su propio componente `TarjetaProducto` — necesitaba su propio
`useState` de cantidad LOCAL (independiente del carrito), algo que no
se puede hacer bien dentro de un `.map()` inline. Ya no lee
`productosCarrito` en absoluto: el selector +/− cambia solo la
cantidad local (tope en `stock_actual`, igual que el stepper del
carrito), y "Agregar" llama a `agregarProducto(id, cantidad)` — si
sale bien, resetea la cantidad local a 1 (el "regreso a la normalidad"
pedido) y muestra un toast confirmando cuántos se agregaron, ya que la
tarjeta ya no tiene ninguna señal visual persistente de "esto está en
tu carrito" (antes lo era el stepper mismo).
- Build y lint verificados. Sin verificación visual en vivo — pendiente
  que el usuario confirme con `npm run dev` que poner cantidad 2 y
  tocar Agregar dos veces deja 2 unidades reales en el carrito, con la
  tarjeta volviendo a cantidad 1 cada vez.

## 13. Fixes tras probar el nuevo flujo de "Agregar" en Productos

El usuario probó el cambio de §12 con un producto real (Anillo  A-013,
stock real 2) y reportó 3 problemas. Se investigó cada uno contra la
base de datos real antes de tocar nada (fila de `carrito_productos`,
policies de RLS de `productos`/`carrito_productos`) para no adivinar.

**1. El badge del header mostraba "1" en vez de "2"** — confirmado,
bug real: `totalItemsProductos` contaba `productosCarrito.size`
(líneas de producto distintas), no la suma de cantidades. Con 1
producto en cantidad 2, el tamaño del Map es 1. Fix: suma las
cantidades de verdad (`[...productosCarrito.values()].reduce(...)`).

**2. El producto no se veía en `/carrito`** — se investigó a fondo
(fila real en `carrito_productos`, policies de RLS de esa tabla y de
`productos`, todas permisivas y correctas para este caso) sin
encontrar ningún bloqueo del lado del servidor. La fila sí existía en
la base. Quedó pendiente confirmar con el usuario si sigue
reproduciéndose después del fix del punto 3 (la explicación más
probable, dado lo que sí se encontró ahí: ver abajo).

**3. Volver a Productos dejaba agregar más del stock real** — este sí
se confirmó con datos reales: el producto (stock 2) terminó con
`cantidad: 4` en `carrito_productos` — el selector de cantidad de la
tarjeta topaba en `stock_actual` a secas, sin descontar lo que ya
estaba en el carrito de esa misma clienta. Muy probablemente esto
también explica el punto 2: el segundo "Agregar" (que llevó la
cantidad a 4) pudo haber sido parte de la misma sesión de prueba antes
de mirar el carrito.

**Fix (frontend + defensa en el servidor)**:
- `ProductosCliente.jsx`: `TarjetaProducto` ahora recibe
  `cantidadEnCarrito` (de `productosCarrito`, el mismo Map del
  context) y calcula `disponibleParaAgregar = stock_actual -
  cantidadEnCarrito` — el selector +/− y el botón "Agregar" topan ahí,
  no en el stock total. Si ya no queda nada para agregar (pero el
  producto no está agotado del todo), la tarjeta muestra "Ya tienes
  todo el stock (N) en tu carrito" en vez del selector.
- `CarritoClienteContext.jsx`: `agregarProducto()` ahora vuelve a
  pedir `stock_actual` real antes de escribir (no confía en el tope
  que ya aplicó la tarjeta — nunca confiar solo en lo que ya validó el
  navegador) y recorta la cantidad a lo que en verdad quepa. Cambió su
  valor de retorno de `boolean` a la cantidad REAL agregada (`0` si no
  se pudo nada) — así el toast de `ProductosCliente.jsx` puede avisar
  "Solo se agregaron N — es lo que quedaba disponible" en vez de
  mentir sobre cuánto se agregó.
- Se corrigió a mano la fila de prueba que quedó en `cantidad: 4`
  (ahora en 2, igual al stock real) para no arrastrar el dato viejo a
  la siguiente prueba.

**Decisión de diseño confirmada con el usuario**: el comportamiento
actual ya es el que quiere — `confirmar_pedido_productos()` no valida
stock al crear el pedido; el único chequeo real (con bloqueo de fila
`for update`, a prueba de condiciones de carrera entre 2 clientes
comprando lo último que queda) vive en `confirmar_venta()`, al momento
en que el admin verifica el pago (§8.8). No hace falta ningún cambio
ahí.

### 13.1 Dos causas más detrás de "sigue sin verse en el carrito"

El usuario reportó que, incluso después del fix de arriba, el
problema de no ver productos en `/carrito` seguía. Se investigaron dos
causas reales, una en cada lado:

**A. Estado de React desincronizado por HMR** (explica el contador que
"ya no sube" y volver a poder agregar de más): `CarritoClienteContext.jsx`
se editó varias veces con la pestaña del navegador abierta — el hot
reload de React en modo desarrollo no siempre logra aplicar bien
cambios a un *contexto*, dejando el estado en memoria de esa sesión
desincronizado del código real ya corregido. Confirmado con la base:
el carrito real tenía `cantidad: 6` para un producto con `stock_actual:
2`, mostrando que el tope nuevo nunca se llegó a ejecutar en esa
sesión. Un refresco completo (Ctrl+Shift+R) lo resolvió — el contador
del header volvió a mostrar el número real.

**B. 403 real en la consulta del carrito** (la causa de fondo de
"no se ven los productos", con consola del navegador confirmándolo):
`productos` en este proyecto otorga `SELECT` **por columna**, no por
tabla completa (para esconder `costo` de quien no sea admin, visible
solo a través de `productos_vista`). `INSERT`/`UPDATE`/`REFERENCES` sí
están a nivel de tabla completa. La migración 104 (`precio_antes`)
agregó la columna y automáticamente heredó esos 3 privilegios de
tabla, pero **nunca un `SELECT` explícito** — confirmado con
`information_schema.column_privileges`. Cualquier consulta que pidiera
`precio_antes` (como el `productos(...)` embebido de
`CarritoCliente.jsx`) fallaba con 403 real, tumbando la consulta
COMPLETA — por eso "0 artículos" aunque el producto sí estuviera
guardado. El catálogo de Productos nunca pide esa columna, por eso
esa pantalla siempre cargó bien y solo el carrito se veía afectado.

**`106_grant_select_precio_antes.sql`** (aplicada en vivo):
`grant select (precio_antes) on public.productos to authenticated;` —
un grant aditivo por columna, no reemplaza nada de lo que ya existía.
Verificado post-aplicación con `information_schema.column_privileges`.

Se corrige también, con esto, la memoria del proyecto "Grants no
automáticos en Supabase" — el hueco esta vez no fue una TABLA nueva
sin grant (el caso ya documentado ahí), fue una COLUMNA nueva en una
tabla cuyo `SELECT` ya era por columna en vez de por tabla completa —
un caso más específico a tener en cuenta la próxima vez que se agregue
una columna a `productos` (o a cualquier otra tabla con el mismo
patrón de columnas escondidas).

## 14. Rediseño de Servicios/Detalle del servicio (docs/diseno-servicios/) + sus 10 migraciones

Aplicado el diseño aprobado (`docs/diseno-servicios/README.md`):
reescritura completa de `ServiciosCliente.jsx` (hero con carrusel de
foto+texto cada 5s, filtros sticky, catálogo agrupado por categoría o
grilla plana, "Cómo reservar", ayuda, barra flotante "Tu cita") y
pestaña nueva `DetalleServicioCliente.jsx` (ruta `servicios/:id`) —
galería, información, adelanto y pago, cómo es el servicio, cuidados,
especificaciones/herramientas/materiales, reseñas, combo sugerido y
"también te puede interesar". Salió la tarjeta iridiscente 3D y el
corazón/"Agregar"/compartir de la tarjeta de Servicios (se fueron al
Detalle); esas técnicas siguen intactas en `ProductosCliente.jsx`.

Nuevos archivos: `src/lib/serviciosVisual.js` (degradado de respaldo +
`formatearDuracion`), `src/components/TarjetaServicioCliente.jsx`
(tarjeta compartida), `src/components/BarraTuCitaFlotante.jsx` (dock
"Tu cita" compartido — ver bug de `overflow-hidden` más abajo),
`src/components/EditorListaJson.jsx` (editor de listas jsonb genérico,
usado por 6 campos de `ModalServicio.jsx`).

**Bug real encontrado y corregido de paso**: `servicios.id` es `uuid`,
no un entero secuencial — el primer intento de `degradadoServicio()`
hacía `id * 29` (da `NaN` con un uuid, rompía el gradiente de respaldo
entero) y el hero ordenaba "más recientes" con `b.id - a.id` (resta de
uuids, no hace nada). Se corrigió hasheando el string del id en vez de
tratarlo como número.

**Bug real de CSS encontrado y corregido**: `BarraTuCitaFlotante`
(`position: fixed`) vivía dentro del `<main overflow-hidden>` de
`PortalCliente.jsx` — un ancestro con `overflow-hidden` recorta a sus
descendientes `fixed` aunque el containing block sea el viewport (gotcha
real de CSS, no de React). Se resolvió con un portal (`createPortal`)
directo a `.landing-web` (no a `document.body`, para seguir heredando
`--lw-gold`, declarada ahí).

Las 10 migraciones del "Backend que falta" del README, aplicadas en
vivo vía el MCP de Supabase (reconectado a mitad de esta tanda; mientras
estuvo desconectado se escribieron los `.sql` igual, para correr a mano):

1. **`107_servicios_descripcion.sql`** — `servicios.descripcion` (text).
2. **`108_servicios_en_tendencia.sql`** + **`109_servicios_mas_pedidos.sql`**
   — `en_tendencia` (bool, manual desde `ModalServicio.jsx`) y la función
   `servicios_mas_pedidos(dias)` (security definer, cuenta
   `cita_servicios` de los últimos N días excluyendo `CANCELADA`) para
   "Lo más pedido" sin columna nueva. De paso resolvió también el
   "Pendiente de decidir" del orden dentro de cada fila de categoría:
   se usa ese mismo ranking en vez de sumar `servicios.orden`.
3. **`110_servicio_fotos.sql`** — tabla `servicio_fotos` (varias fotos
   por servicio, etiqueta Resultado/Antes/Después/orden), mismo bucket
   `fotos-servicios`. Editor de galería nuevo en `ModalServicio.jsx`;
   carrusel + miniaturas reales en el Detalle.
4. **`111_servicios_a_domicilio.sql`** — `a_domicilio` (bool) +
   `costo_domicilio`.
5. **`112_servicios_precio_variable.sql`** — `precio_variable` (bool) +
   `nota_precio` + `duracion_resultado`.
6. **`113_servicios_pasos_specs_cuidados.sql`** — 6 columnas `jsonb`
   (`pasos`, `especificaciones`, `herramientas`, `materiales`,
   `cuidados_antes`, `cuidados_despues`), editadas fila por fila con el
   nuevo `EditorListaJson.jsx` (decisión confirmada con el usuario:
   editor de filas, no texto libre por línea).
7. **`114_servicios_combo.sql`** — `combo_con` (override manual) +
   `servicios_combo_sugerido()` (calcula el servicio más reservado junto
   a este, security definer sobre `cita_servicios`).
8. **`115_estado_negocio_adelanto.sql`** — `adelanto_minimo` y
   `cancelacion_plazo_horas` en `estado_negocio` (config del negocio, no
   por servicio) — editables desde `ContactoWeb.jsx`, expuestos por
   `EstadoNegocioContext.jsx`.
9. **`116_resenas_servicio.sql`** — tabla `resenas_servicio` +
   `guardar_mi_resena_servicio()` / `mi_resena_servicio()` /
   `resenas_servicio_publicas()` / `resenas_servicio_resumen()`. A
   propósito NO se tocó `resenas` (86_resenas.sql): tiene
   `unique(cliente_id)`, una sola reseña general de por vida para el
   muro de Nosotros — forzar `servicio_id` ahí arriesgaba esa función ya
   en producción. La regla pendiente ("¿quién puede reseñar?") quedó
   resuelta dentro de `guardar_mi_resena_servicio()`: solo clientas con
   una cita `COMPLETADA` que incluyó ese servicio.

Todas siguen el patrón ya documentado en las memorias del proyecto:
`servicios` y `estado_negocio` otorgan `SELECT/INSERT/UPDATE` a nivel de
TABLA completa a `authenticated` (a diferencia de `productos`), así que
un `ALTER TABLE ADD COLUMN` alcanzó solo, sin un `GRANT` explícito
aparte — confirmado con `information_schema.column_privileges` después
de cada una. Las funciones nuevas son todas `security definer` (mismo
criterio que `resenas_publicas()`/`mis_puntos()`): necesitan ver datos
de TODAS las clientas (conteos agregados, nunca filas identificables) o
validar algo que el cliente no puede autoevaluar solo (que de verdad se
hizo el servicio).

Pendiente real (no se inventó): "cupos de la semana" sigue mostrando un
texto genérico ("Consulta en Citas") — calcularlo de verdad necesita
cruzar `horario_atencion()` con las citas ya agendadas, una feature de
disponibilidad aparte, no una columna.

## 15. Rediseño de Productos/Detalle del producto (docs/diseno-productos/) + sus 8 migraciones

Aplicado el diseño aprobado (`docs/diseno-productos/README.md`), en 3
fases:

**Fase 1 — `ProductosCliente.jsx` reescrito**: inicio "Novedades y lo
más vendido" (mismo carrusel foto+texto cada 5s que el hero de
Servicios), dos cintas continuas "Ofertas"/"Destacados" con indicador de
posición y flechas, filtros sticky + catálogo agrupado por categoría
(idéntico a Servicios), "Cómo comprar", ayuda y barra flotante "Tu
carrito". Salieron la tarjeta iridiscente 3D y el corazón/cantidad/
Agregar de la tarjeta (se fueron al Detalle); esas técnicas quedaron sin
tocar en `index.css` (`.iri-*`) por si algo más las usa.

Nuevo: `src/components/TarjetaProductoCliente.jsx` (nace de
`TarjetaServicioCliente.jsx`, le suma etiqueta "−X%", precio anterior
tachado y línea de stock), `src/components/BarraTuCarritoFlotante.jsx`
(mismo patrón de portal que `BarraTuCitaFlotante.jsx`, pero sobre
`productosCarrito`) y `src/hooks/useCintaContinua.js`.

**Cinta continua, la parte no trivial**: el lienzo aprobado simulaba el
movimiento con `@keyframes` + un truco de `animation-delay` para que las
flechas "saltaran" a la tarjeta siguiente — el README pedía explícito
que en la app esto se sintiera real ("debe deslizarse"). Se resolvió con
`useCintaContinua.js`: un solo offset en px llevado por
`requestAnimationFrame`, mutado directo por ref sobre `style.transform`
(mismo truco que ya usaba el tilt de la tarjeta iridiscente — pasar esto
por React state a 60fps re-renderizaría la fila entera en cada frame).
`mover(±1)` (las flechas) desplaza ese mismo offset, así que el
indicador de posición siempre refleja dónde está la fila de verdad, sin
importar si se movió sola o a mano. Pausa por fila (no ambas a la vez)
vía `onMouseOver`/`onMouseOut`/`onFocus`/`onBlur` con delegación en el
contenedor, revisando `closest('.cinta-tarjeta')` — sin depender de
`:has()` en CSS, que hubiera exigido volver a animación pura por CSS.

**Fase 2 — `DetalleProductoCliente.jsx` nuevo** (ruta `productos/:id`,
igual patrón que `servicios/:id`): galería, información (precio, ahorro,
datos clave, cantidad + Agregar), franja de pago/entrega/cambios, cómo
se usa, ¿es para ti?, especificaciones/ingredientes/libre de, reseñas,
combo sugerido y "también te puede interesar". El carrito mantiene EXACTO
el comportamiento que ya vivía en `ProductosCliente.jsx` antes del
rediseño: tope `stock_actual − cantidadEnCarrito`, se recorta solo,
vuelve a 1 al agregar, mismos mensajes de `useToast`.

En esta fase, sin las migraciones todavía aplicadas, las secciones que
dependían de columnas inexistentes se ocultaron con `// TODO backend` en
vez de inventar contenido (regla del CLAUDE.md) — corregido en la Fase 3.

**Fase 3 — 8 migraciones (`117` a `124`)**, aplicadas en vivo vía el MCP
de Supabase, con las decisiones que confirmó el usuario primero:

1. **`117_productos_destacado_nuevo_inicio.sql`** — `destacado`, `nuevo`,
   `en_inicio` (bool, los 3 a mano desde `ModalProducto.jsx` — decisión
   confirmada, mismo criterio que `servicios.en_tendencia`) y
   `subcategoria` (text, etiqueta de la tarjeta).
2. **`118_productos_descripcion_datos_clave.sql`** — `descripcion`,
   `contenido`, `rinde`, `frecuencia`, `oferta_hasta`.
3. **`119_producto_fotos.sql`** — tabla `producto_fotos` (varias fotos,
   etiqueta Frente/Textura/En uso/Detrás), mismo patrón que
   `servicio_fotos`. Editor de galería nuevo en `ModalProducto.jsx`;
   carrusel + miniaturas reales en el Detalle.
4. **`120_producto_variantes.sql`** — presentaciones (ej. 250 ml/500 ml)
   en tabla aparte, decisión confirmada con el usuario sobre las dos
   opciones del README. **Solo el esquema**: no toca `carrito_productos`
   ni `pedidos_web_items` (siguen referenciando `producto_id` a secas) ni
   el flujo de cantidad/Agregar del Detalle — esa integración (elegir
   presentación, tope de stock por variante,
   `confirmar_pedido_productos()` con variante) queda como tarea aparte.
5. **`121_productos_contenido_editorial.sql`** — 6 columnas `jsonb`
   (`especificaciones`, `modo_uso`, `ideal_para`, `tips`, `ingredientes`,
   `libre_de`), editadas fila por fila con el `EditorListaJson.jsx` que
   ya existía de Servicios.
6. **`122_productos_combo.sql`** — `combo_con` (override manual) +
   `productos_combo_sugerido()` (calcula el producto más comprado junto
   a este, security definer sobre `pedidos_web_items`).
7. **`123_resenas_producto.sql`** — tabla `resenas_producto` +
   `guardar_mi_resena_producto()` / `mi_resena_producto()` /
   `resenas_producto_publicas()` / `resenas_producto_resumen()`. Decisión
   confirmada con el usuario: solo puede reseñar quien tiene un
   `pedidos_web` en estado `ENTREGADO` con ese producto (validado dentro
   de la función, no confiando en el cliente). No se tocó `resenas`
   (86_resenas.sql), misma razón que en Servicios.
8. **`124_productos_vista_completa.sql`** — reconstruye `productos_vista`
   con todas las columnas nuevas, para que `Inventario.jsx` las siga
   viendo (lee de la vista, no de la tabla cruda).

A diferencia de `servicios`, `productos` da `SELECT` **por columna** (para
ocultar `costo`, ver `03_rls.sql`) — cada una de las migraciones 117/118/
121/122 incluye su propio `grant select (...) on productos to
authenticated`, si no la primera consulta que pidiera esa columna
respondía 403 la request entera (memoria del proyecto). Después de
aplicar las 8, `get_advisors` no mostró ningún hallazgo nuevo (los
`security_definer` que aparecen son el mismo patrón ya aceptado en todo
el proyecto para RPCs que necesitan ver datos agregados de todas las
clientas).

Con las migraciones aplicadas, se volvió a `ProductosCliente.jsx` (fila
"Destacados" real, inicio usando `en_inicio`, etiqueta del hero con
prioridad oferta > Nuevo > Destacado, `TarjetaProductoCliente.jsx` usando
`subcategoria`) y `DetalleProductoCliente.jsx` (todas las secciones que
tenían `// TODO backend` ahora leen datos reales y se ocultan solas si
el admin todavía no las llenó) para que dejaran de ocultar contenido.
`ModalProducto.jsx` del POS se actualizó con todos los campos/editores
nuevos (reusando `EditorListaJson.jsx`) y `Inventario.jsx` pasa
`productosExistentes` para el selector de combo y pide las columnas
nuevas en su `SELECT_PRODUCTOS` (si no, el modal de edición no las
precargaba).

**Aclaración de UX, sin cambio de esquema**: el usuario reportó que
"Precio antes de la oferta" en `ModalProducto.jsx` parecía "al revés"
(pedía un monto MAYOR al precio de venta, cuando esperaba poner ahí el
precio CON descuento). Se confirmó que el modelo actual es correcto
(`precio` = lo que de verdad se cobra; `precio_antes` = solo la
referencia tachada, más alta) y coincide con el diseño aprobado — se
dejó solo una nota aclaratoria en el campo, sin tocar la validación.
Quedó una idea de rediseño (precio "normal" fijo + precio de oferta que
al vencer vuelve solo al normal) explícitamente pospuesta por el usuario
para una tarea aparte, porque toca `Ventas.jsx`/`Inventario.jsx`, no solo
la Web de clientes.

## 16. Rediseño de Citas (docs/diseno-citas/) — 2026-09-28

Aplicado el diseño aprobado (`docs/diseno-citas/README.md`) a
`src/pages/cliente/CitasCliente.jsx`, sin migraciones (todo lo que usa ya
existía en la base):

- **Calendario**: idéntico al anterior (grilla de 42 días, navegación por
  mes, puntito en días con citas). Lo que cambió es qué significa
  seleccionar un día: `diaSeleccionado` ahora empieza en `null` y es
  puramente un *filtro* — "Próximas citas" se ve siempre, con su propia
  consulta aparte (`fecha_hora >= now()`, `estado in
  (PENDIENTE,CONFIRMADA)`, sin límite de mes). Tocar un día filtra la
  lista a las citas de ese día (de cualquier estado, salen de la consulta
  por mes que ya existía para los puntitos); tocarlo de nuevo, o el chip
  "Ver todas las próximas", quita el filtro.
- **Historial**: bloque plegable nuevo (abierto por defecto), consulta
  propia (`fecha_hora < now()` o estado en
  COMPLETADA/CANCELADA/NO_ASISTIO, sin límite de mes ni paginación —
  mismo criterio sin límite que ya usa `HistorialCliente.jsx`).
- **Puntos y sellos**: 1 sello y 1 "punto por visita" por día — solo la
  primera cita no cancelada/no-asistió de cada día (cronológicamente)
  cuenta, igual que hace el servidor en `mis_puntos()`/
  `mi_fidelizacion()` (`count(distinct fecha)`); el resto de las citas
  de ese mismo día muestran "Sello ya contado ese día". El estimado de
  puntos por cita usa `config_puntos` (no números fijos), igual que los
  textos de "Cómo ganas puntos y sellos" (S/X por punto, umbrales de
  nivel, sellos por recompensa). Solo cuentan las citas COMPLETADAS —
  confirmar una cita no suma nada, solo completarla en caja.
- **Calificar**: reseñas por servicio (`resenas_servicio`,
  116_resenas_servicio.sql) — una cita completada muestra "Calificar" si
  algún servicio suyo todavía no tiene reseña propia (se reusa la RPC
  `mi_resena_servicio()` del Detalle de servicio, sin reinventar el
  formulario) y lleva a `/servicios/:id#resenas`; si ya los reseñó todos,
  muestra "Calificada".
- **Carrito de servicios**: se quitó `MiniCarritoServiciosCitas` de esta
  pestaña (el componente queda sin uso, sin borrar — es del alcance del
  carrito de servicios aparte). En su lugar, el botón circular con
  ícono de carrito (con contador de `serviciosCarrito.size`) a la
  izquierda de "Agendar cita" — como la ruta `/citas/carrito`
  (`docs/diseno-carrito-servicios/README.md`) todavía no existe, apunta a
  `/servicios` por ahora; solo hay que cambiar ese `to` cuando se
  implemente esa pestaña. "Volver a reservar" (en una tarjeta de la
  lista o en Historial) agrega los servicios de esa cita al carrito
  (`CarritoClienteContext`) y abre `ModalAgendarCitaCliente` con esos
  servicios precargados, mismo criterio.
- **Plazo de cancelación**: `puedeModificar()` y el texto "hasta N horas
  antes" ahora leen `estado_negocio.cancelacion_plazo_horas` (vía
  `useEstadoNegocio()`), con `3` como respaldo si el negocio no lo
  configuró — antes estaba fijo en 3.
- **Animación de entrada**: patrón estándar
  (`docs/patrones/animacion-entrada.md`). El bloque "Puntos + Antes de tu
  cita" se anima como una sola pieza en escritorio (aparecen juntos,
  `aside`) pero como dos bloques independientes en móvil (delays
  distintos) — se resolvió con dos copias del mismo contenido (funciones
  `bloquePuntos()`/`bloqueAntes()` llamadas dos veces) mostradas/
  ocultadas por CSS (`hidden lg:flex` / `lg:hidden`), no por JS, para que
  la estructura responda de verdad al viewport en vivo y no solo al
  ancho que había al montar. El listado "Próximas citas"/día filtrado
  solo anima la primera vez que se pinta con datos reales (un `ref` que
  se apaga con `requestAnimationFrame` apenas `cargandoInicial` pasa a
  `false`) — cambiar de día después no la repite.

`npm run build` y `npm run lint` sin errores ni advertencias nuevas.
**No se pudo probar en navegador en esta sesión** (sin herramienta de
automatización) — pendiente de revisar en `npm run dev`:

- El layout de "Tu próxima cita" (3 columnas), el calendario, y que
  Calendario/Próximas/Puntos+Antes queden bien distribuidos en 3
  columnas en escritorio y apilados en el orden correcto en móvil
  (Próximas → Calendario → Historial → Puntos → Antes de tu cita).
- Que el sello/los puntos estimados de cada tarjeta coincidan con lo que
  ya sabías de esas citas (en especial un día con 2+ citas tuyas).
- El botón "Calificar" navegando a `/servicios/:id#resenas` (el scroll
  automático al ancla depende del navegador con react-router, no hay
  manejo explícito — si no salta a la sección, decime y le agrego un
  `scrollIntoView`).
- Cancelar/reprogramar/agendar desde las tarjetas nuevas (que
  "Próximas"/Historial se actualicen solos después).
- El botón de carrito (círculo con contador) yendo a `/servicios` — y
  confirmar si esto se deja así hasta que exista `/citas/carrito` o
  preferís otra cosa mientras tanto.

**Ajuste post-revisión (mismo día)**: el chip "+1 sello" de la cita que
de verdad gana el sello del día se perdía cuando esa cita ya estaba
COMPLETADA (`calcularChipsSello()` la excluía a propósito, copiando
demasiado literal un caso raro del lienzo de referencia) — ahora se
muestra en cualquier estado relevante (vigente o completada), y solo se
oculta del todo para una cita cancelada/no-asistió. También se movió el
chip de sello a la misma fila que el de puntos (antes iba en una fila
aparte debajo) y se le dio el mismo color dorado que el chip de puntos
en su estado "ganado" (el chip "Sello ya contado ese día" sigue gris).

## 17. Reprogramar cita: ahora se pueden editar todos los campos, no solo fecha/hora — 2026-09-28

A pedido del usuario, el botón "Reprogramar" del portal cliente dejó de
ser solo un cambio de fecha/hora: ahora abre el mismo tipo de flujo que
"Agendar" (servicios, asistente, fecha, horario y nota), precargado con
lo que la cita ya tenía, y guarda todo junto.

**Backend — `supabase/sql/125_reprogramar_cita_web_completa.sql`**
(aplicada con el MCP de Supabase al proyecto `WedJaiseReact`): la
función vieja `reprogramar_mi_cita_web(p_cita_id, p_nueva_fecha_hora)`
solo tocaba `fecha_hora`. Se hizo `drop function` de esa firma y se creó
una nueva con `(p_cita_id, p_asistente_id, p_nueva_fecha_hora,
p_servicio_ids, p_nota)`:

- Revalida todo lo que ya validaba `agendar_cita_web` (asistente
  activo/no-cajera, servicios activos, horario realmente libre vía
  `horarios_disponibles_cita(..., p_excluir_cita_id)`), más las reglas
  que ya tenía reprogramar (dueña de la cita, no cancelada/completada,
  ≥3 h de anticipación, nueva fecha futura).
- **Decisión confirmada con el usuario (AskUserQuestion)**: el precio de
  cada servicio de la cita se actualiza al precio ACTUAL del catálogo al
  guardar — no queda congelado al precio con el que se agendó
  originalmente. Se implementó reemplazando `cita_servicios` entero
  (`delete` + `insert`, mismo patrón que `agendar_cita_web`) en vez de
  un diff fila por fila; seguro porque nada fuera de la función mira
  `cita_servicios.id` (`guardar_mi_resena_servicio()` solo usa
  `cita_id`/`servicio_id`/`estado`) y solo puede pasar con la cita
  todavía no COMPLETADA (ya validado arriba), así que nunca se pisa el
  historial de una cita ya cerrada.
- **Decisión confirmada con el usuario**: también se puede cambiar de
  asistente (no solo servicios/fecha), así que el flujo de horarios se
  recalcula igual que en Agendar cada vez que cambian servicios o
  asistente.

**Frontend — `src/components/ModalReprogramarCitaCliente.jsx`
reescrito**: mismo layout/checklist que `ModalAgendarCitaCliente.jsx`
(checkboxes de servicios con precio/duración actual, select de
asistente, fecha, grilla de horarios, nota), pero con los tres primeros
campos precargados desde la cita (`cita.cita_servicios[].servicio_id`,
`cita.asistente_id`, `cita.nota`) — el horario sigue sin precargarse a
propósito, para obligar a re-elegir con la duración/asistente que
queden después de editar. `CitasCliente.jsx` no necesitó cambios: ya le
pasaba el objeto `cita` completo (con `cita_servicios` y `servicio_id`
desde el rediseño de la sección 16) y el callback `onReprogramada`
sigue recibiendo solo la fecha/hora nueva.

`npm run build` y `npm run lint` sin errores ni advertencias nuevas. No
se pudo probar en navegador en esta sesión — pendiente de revisar en
`npm run dev`: abrir "Reprogramar" desde una cita, quitar/agregar
servicios y también cambiar de asistente, confirmar que el horario se
recalcula bien y que la cita queda con los servicios/precio nuevos al
volver a Citas.

## 18. Nueva pestaña: Carrito de servicios (`/citas/carrito`) — 2026-09-28

Implementado `docs/diseno-carrito-servicios/README.md`: copia adaptada
de `CarritoCliente.jsx` (carrito de productos) para reservar los
servicios que la clienta ya agregó desde Servicios/Detalle. Antes de
tocar la base de datos se resolvieron con el usuario (AskUserQuestion)
las 4 "Decisiones abiertas" del README, y se le pidió confirmación
explícita de la migración antes de aplicarla:

- **"Agendar cita" reemplaza al modal**: el botón de Citas y el de la
  tarjeta vacía llevan directo a `/citas/carrito` en vez de abrir
  `ModalAgendarCitaCliente.jsx` — ese componente quedó sin ningún
  llamador y se borró (junto con `MiniCarritoServiciosCitas.jsx`, ya sin
  uso desde el rediseño de Citas de la sección 16).
- **Adelanto siempre obligatorio**: `estado_negocio.adelanto_minimo`, o
  el 100% del total si el negocio no configuró un mínimo. No hay forma
  de reservar sin adelanto ni de elegir pagar menos del mínimo exigido.
- **Sin cupones** en esta versión (queda para una tarea aparte).
- **Sin "cualquier asistente disponible"** — se sigue eligiendo uno
  específico, como en Agendar/Reprogramar.

**Backend — `supabase/sql/126_citas_web_pago_adelanto.sql`** (aplicada
con el MCP de Supabase, confirmada por el usuario antes de correrla):

- Bucket privado `comprobantes-citas-web` (mismo patrón que
  `comprobantes-pedidos-web`: solo la dueña y el admin lo leen).
- Columnas en `citas`: `metodo_pago`, `comprobante_url`,
  `pago_verificado` (default `false`), `pago_verificado_en`,
  `pago_verificado_por` — sin GRANT extra porque `citas` ya da
  SELECT/INSERT/UPDATE a nivel de tabla completa (no es como
  `productos`, que da por columna).
- `agendar_cita_web` cambia de firma: se le suman `p_metodo_pago`,
  `p_comprobante_url` y `p_adelanto` (antes de `p_nota`, que sigue
  opcional). Valida método/comprobante obligatorios y
  `p_adelanto >= coalesce(adelanto_minimo, precio_total_servicios)`. Se
  hizo `drop function` de la firma vieja de 4 parámetros porque su único
  llamador se borró en este mismo cambio.
- Mismo patrón que `pedidos_web` (100_pedidos_web_pago.sql): esto solo
  guarda la INTENCIÓN de pago (comprobante subido, sin verificar) — la
  cita entra como PENDIENTE igual que siempre. Un botón "Verificar
  pago" en el POS (como en Pedidos Web) queda **fuera de esta tarea**
  (no fue pedido) — las columnas ya están listas para esa función
  futura.

**Frontend — `src/pages/cliente/CarritoServiciosCliente.jsx`** (nuevo):
mismo layout de 2 columnas, mismas clases `.lw-panel`/`.lw-campo`/
`.lw-seg`/`.lw-pago-opcion`/`.lw-chip`/`.lw-wa-ayuda` y el mismo flujo de
captura (`CampoSubirArchivo`, `procesarImagen`/`subirFoto` de
`lib/imagenes.js`) que `CarritoCliente.jsx`, con lo propio de un
servicio:

- **Servicios**: fila con checkbox (incluir en esta reserva, todos
  marcados por defecto), foto o degradado de `degradadoServicio()`
  (mismo fallback que `TarjetaServicioCliente`), duración, precio y
  basurero para quitar del carrito. Sin cantidad/stock — un servicio no
  se pide en cantidad.
- **Asistente**: tarjetas seleccionables desde `asistentes_para_citas()`
  (obligatorio).
- **Día y hora**: fila de chips con los próximos 14 días (deshabilita
  los que el negocio no atiende, según `horario_atencion()`), y al
  elegir asistente+día se llama `horarios_disponibles_cita()` con la
  duración total de los servicios MARCADOS, mostrada en chips agrupados
  Mañana/Tarde. Cambiar servicios, asistente o día limpia la hora
  elegida (se recalcula sola vía el `useEffect` de horarios).
- **Resumen de tu reserva**: cuándo (inicio–fin calculado con la
  duración total), con quién, servicios marcados + duración total +
  total, barra de nivel + "Ganarás +N pts · +1 sello" (o "sello ya
  contado ese día" si la clienta ya tiene otra cita — vigente o
  completada — ese mismo día calendario, consultado aparte al elegir el
  día), adelanto ahora / saldo en el local, método de pago con QR +
  captura, botón verde "Confirmar reserva" (deshabilitado con un aviso
  de qué falta) y política de cancelación con
  `cancelacionPlazoHoras`.
- **Simplificación consciente**: no hay un chip de puntos por cada fila
  de servicio — los puntos se ganan por VISITA completa, no por
  servicio individual, así que solo se muestra el estimado agregado de
  la reserva completa (evita inventar una fórmula "por servicio" que no
  existe en el backend).
- **Barra fija móvil** ("Total · +N pts" + "Confirmar") portaleada a
  `.landing-web` (no a `document.body`), mismo motivo que
  `BarraTuCitaFlotante.jsx`: el `<main overflow-hidden>` de
  `PortalCliente.jsx` recorta cualquier `fixed` de adentro.
- **Al confirmar**: `agendar_cita_web` con los nuevos parámetros →
  toast "Cita reservada." → `vaciarServiciosReservados()` (solo los
  servicios reservados; los desmarcados se quedan en el carrito) →
  navega a `/citas`.
- **Carrito vacío**: ícono, "Todavía no agregaste servicios", botón "Ver
  servicios" → `/servicios`. Sin resumen.

**Entradas reconectadas**: botón carrito de `CitasCliente.jsx` (antes
apuntaba a `/servicios` como respaldo temporal), "Volver a reservar" de
la lista y del Historial de Citas, y `BarraTuCitaFlotante.jsx` — las
tres ahora llevan a `/citas/carrito`. Ruta agregada en `App.jsx`
(`citas/carrito`, dentro del árbol del portal cliente) y título en
`src/config/navegacionCliente.js`.

`npm run build` y `npm run lint` sin errores ni advertencias nuevas. No
se pudo probar en navegador en esta sesión — pendiente de revisar en
`npm run dev`:

- El flujo completo: agregar servicios desde Servicios, ir al carrito,
  elegir asistente/día/hora, subir una captura y confirmar — que la
  cita aparezca en Citas con el adelanto correcto.
- Que el adelanto mostrado/exigido sea el correcto según
  `adelanto_minimo` esté o no configurado en Contacto Web/estado del
  negocio.
- "Sello ya contado ese día" en el resumen cuando ya hay otra cita ese
  día.
- Los tres puntos de entrada (botón carrito de Citas, "Volver a
  reservar", barra flotante de Servicios) llegando todos a
  `/citas/carrito` con los servicios correctos ya marcados.
- El carrito vacío al entrar sin haber agregado nada.
- La barra fija de "Confirmar" en móvil (portaleada, no debería
  recortarse ni superponerse mal con el contenido).

**Ajustes post-revisión (mismo día):**

1. **"Agendar cita" ya no manda siempre al carrito**: si el carrito
   está vacío, mandaba a una página que solo decía "andá a Servicios" —
   un redirect inútil (bug reportado por el usuario). Ahora
   `destinoAgendar` en `CitasCliente.jsx` es condicional:
   `serviciosCarrito.size > 0` → `/citas/carrito` (ya hay algo que
   reservar); si no → `/servicios` (a elegir primero). Mismo criterio en
   los dos lugares donde aparece el botón (encabezado y estado "sin
   citas").
2. **Elegir entre adelanto mínimo o pagar todo ahora**: el usuario notó
   que el carrito daba por sentado que la captura era siempre de un
   adelanto parcial, sin dejar pagar el total de una vez.
   `agendar_cita_web` ya aceptaba cualquier `p_adelanto` mayor o igual
   al mínimo exigido — **no hizo falta tocar el backend**, era pura
   limitación de la pantalla. Se agregó un selector "Adelanto · S/X /
   Todo ahora · S/Y" (mismas `.lw-seg` del carrito de productos) que
   solo aparece cuando de verdad hay una diferencia real entre ambos
   montos (`adelanto_minimo` configurado y menor al total — si es null o
   ya es el total, no hay nada que elegir). Los textos de "adelanto
   exacto"/"captura de tu adelanto" se volvieron neutros ("monto
   exacto"/"captura de tu pago") porque ahora pueden ser el pago
   completo, y el aviso de "el saldo se paga en el local" cambia a
   "quedas con todo pagado" cuando el saldo llega a S/ 0.

`npm run build` y `npm run lint` siguen sin errores ni advertencias
nuevas tras estos dos ajustes.

## 19. Rediseño de Inicio (`docs/diseno-inicio/`) — 2026-09-28

Implementado `docs/diseno-inicio/README.md` (`Main.dc.html`/`Movil.dc.html`
como referencia de estructura/estilo). `InicioCliente.jsx` quedó
reescrito de punta a punta — se fue el hero full-bleed con foto de fondo
+ las 4 secciones de video/filosofía genéricas (stock sin relación con
el salón), reemplazadas por el orden aprobado: Hero (grid texto|foto,
ya no full-bleed) → Tira personal → Promoción activa → Lo más pedido →
Resultados reales → Reseñas → Sobre nosotros (un solo bloque) →
Visítanos → Pie. "Explora por categoría" se quitó a pedido del usuario.
Se quitó también la migaja "Inicio" bajo el menú (`PortalCliente.jsx`:
antes se mostraba sola en esa ruta, ahora no se pinta nada ahí) y la
banda negra vacía que quedaba tras el hero viejo (resuelta sola al
pasar a un hero compacto seguido directo de la tira personal).

**Hero**: conserva el mecanismo existente (`useRevelarAntes`, círculo
bajo el cursor, mismas fotos de referencia) pero pasa de foto de fondo
+ texto superpuesto a un grid de 2 columnas (texto | foto en caja,
apilado con la foto arriba en móvil) — cambio de layout, no solo de
contenido, siguiendo la estructura real de `Main.dc.html`/`Movil.dc.html`
(el propio dc.html fusiona lo que el README llama "Hero" dentro de su
sección "2. TIRA PERSONAL"; la migaja de comentario del export no
coincide 1:1 con la numeración del README). Se sumó la etiqueta
("Uñas · Pestañas · Cejas · Micropigmentación", copy fijo del negocio,
no un dato de BD), el subtítulo, el botón "Ver servicios" y la línea de
confianza (★ promedio + N reseñas de `resenas_publicas()` agregadas en
el cliente, horario de `horario_atencion()`, "Abierto ahora" de
`EstadoNegocioContext` — cada dato se oculta solo si falta).

**Animación de entrada**: patrón estándar
(`docs/patrones/animacion-entrada.md`) con los delays exactos de
Main.dc.html/Movil.dc.html, aplicado solo al contenido fijo del primer
pantallazo (Hero, tira personal, promoción) — el resto de secciones
(Lo más pedido, Resultados reales, Reseñas, Sobre nosotros, Visítanos)
no lleva clases `in-*` porque el dc.html tampoco las define ahí.

**"Resultados reales" — animación por scroll** (la pieza más delicada
del encargo): sacada a `src/hooks/useSecuenciaScroll.js`, documentado
en el propio hook. 6 fotos (antes1→después1→antes2…), cada una cae como
un meteorito (clases `.foto.espera`/`.foto.cae` + `@keyframes lw-caer/
lw-destello/lw-onda/lw-sacudirA/lw-sacudirB`, agregadas en `index.css`
antes del marcador `---break---`, prefijadas `lw-` como el resto de
keyframes de la Web para no chocar con otras animaciones). La foto 1
arranca sola al verse completa (`IntersectionObserver` threshold 1);
cuando la fila queda centrada (otro `IntersectionObserver`, `rootMargin`
negativo simétrico) la página se fija bloqueando `wheel`/`touchmove` del
propio contenedor con scroll (`overflow-y-auto` de `.landing-web`, no
`window` ni `overflow:hidden` en `body` — este proyecto no tiene ese
`<body>` fijo del lienzo, el scroll real vive en ese div); cada gesto
nuevo (pausa >220ms en rueda, o dirección detectada por umbral en touch)
dispara la siguiente foto, uno a la vez, sin cortar una que ya empezó.
Scroll hacia arriba mientras está fijada libera sin animar (con un
"cooldown" hasta que la fila salga del centro, para no volver a atraparla
de inmediato). Al caer la 6ª foto se libera para siempre — se repite en
cada montaje de la ruta (estado en memoria de React, sin
`sessionStorage`, tal como pidió el usuario). Fuente de las 3 parejas:
se decidió reusar `galeria_para_web()` (`98_galeria_web.sql`, ya
existía con la forma antes_url/después_url exacta que hacía falta) en
vez de crear una tabla nueva — hoy solo tiene la fila de prueba con las
fotos de referencia del hero, así que la sección queda oculta en la
práctica hasta que el admin cargue al menos 3 parejas reales desde el
panel Galería Web ya existente. `prefers-reduced-motion`: todo visible,
sin fijar nada (cubierto tanto en el hook como en el CSS).

**Backend — `supabase/sql/127_reclamar_cupon_promocion.sql`** (aplicada
con el MCP de Supabase al proyecto `WedJaiseReact`, con el plan
confirmado por el usuario antes de correrla): `cupones.promocion_id` +
índice único parcial `(cliente_id, promocion_id) where promocion_id is
not null` (un cupón por clienta por promoción; no afecta a los cupones
de Referidos/Fidelización, que no tienen `promocion_id`), nuevo origen
`'PROMOCION'` en `cupones_origen_check`, `mis_cupones()` recreada (drop
+ create, cambia el tipo de retorno) para exponer `promocion_id` —así
el Inicio sabe si la clienta ya reclamó el cupón de la promoción activa
sin necesitar una función de consulta aparte—, y
`reclamar_cupon_promocion(p_promocion_id)` security definer, idempotente
(revalida en el servidor que la promoción sigue activa/vigente con la
misma condición que la policy `promociones_select_web`; si ya existe un
cupón para esa clienta+promoción, lo devuelve tal cual en vez de
duplicar o fallar). Se sumó `PROMOCION: 'Cupón de promoción'` a
`ETIQUETAS_ORIGEN_CUPON` (`lib/cupones.js`) para que se vea bien en Mis
cupones/Ofertas, que ya reusan `TarjetaCupon.jsx` sin cambios.

**Dirección corregida** (confirmado con el usuario): `estado_negocio.
direccion` pasó de "Av. Argentina H_ 12" a "Av. Argentina H-12" —
aplicado directo en la base de datos (no en el frontend, que solo
muestra el dato tal cual viene de `datos_contacto()`), se refleja solo
en Inicio/Visítanos/el pie.

**Otros datos reales usados** (todos con su fallback de "sección/línea
oculta si falta"): `servicios_mas_pedidos()` + `servicios` para "Lo más
pedido" (usa `TarjetaServicioCliente.jsx` tal cual, sin el badge de
ranking del mockup — el README pidió explícitamente reusar esa tarjeta,
no crear una variante); consulta directa a `citas` (mismo patrón que
`CitasCliente.jsx`) para la próxima cita pendiente de la tira personal;
`mis_puntos()` para los puntos; "Visítanos" con WhatsApp
(`numeroWhatsapp()`) y un mapa embebido de Google (`maps?q=...&output=
embed`, sin API key) armado con la dirección real — sin dirección, ni
botón "Cómo llegar" ni mapa. "Sobre nosotros" no tiene una fuente clara
de foto real del equipo/local en la base (no se inventó una relación
con `equipo_para_web()`), así que ese bloque muestra un placeholder
visual neutro en vez de una imagen — pendiente de una foto real más
adelante.

**Refactor menor**: `nombrePublico()` (trunca "María López" → "María
L.", criterio de privacidad ya usado en el muro de Nosotros) y
`resolverUrlGaleria()` (resuelve `antes_url`/`despues_url` de
`galeria_web`, ruta relativa a `/public` o URL completa de Storage)
vivían solo dentro de `NosotrosCliente.jsx`; con Inicio como segundo
consumidor real se sacaron a `src/lib/resenas.js` y
`src/lib/imagenes.js` respectivamente, y `Estrellas` (fila de 5
estrellas) a `src/components/Estrellas.jsx` — `NosotrosCliente.jsx`
ahora importa las tres en vez de redefinirlas.

`npm run build` y `npm run lint` sin errores ni advertencias nuevas.
**No se pudo probar en navegador en esta sesión** (sin herramienta de
automatización) — pendiente de revisar en `npm run dev`:

- El hero nuevo (grid texto|foto) en varios anchos, que el efecto
  antes/después con el cursor se siga viendo bien dentro de la caja más
  chica, y que el hint "Pasa el cursor..." quede bien ubicado.
- La tira personal con y sin cita próxima, y con/sin puntos.
- La promoción activa: "Reclamar cupón" de verdad guarda el cupón (ya
  aplicado el backend), el toast, el cambio a "Guardado en Mis cupones"
  sin recargar, y que aparezca en Ofertas/Mis cupones con la etiqueta
  correcta. Probar también tocarlo dos veces seguidas (no debería
  duplicar nada) y entrar de nuevo al Inicio ya habiéndolo reclamado
  antes (debería partir directo en "Guardado").
- **Lo más importante de revisar**: la animación de "Resultados reales"
  con datos reales cargados en Galería Web (hoy con 1 sola fila de
  prueba queda oculta) — cargar al menos 3 parejas desde ese panel y
  probar el scroll completo: que la foto 1 dispare sola, que la página
  se fije al centrar la fila, que cada gesto (rueda, trackpad, touch)
  dispare una sola foto, que un gesto a mitad de animación se ignore,
  que scrollear hacia arriba libere sin animar y sin quedar atrapada, y
  que se libere sola al terminar la 6ª. Probar también con
  `prefers-reduced-motion` activado (debería verse todo fijo, sin
  fijar el scroll).
- Que "Lo más pedido"/"Resultados reales"/"Reseñas" se oculten bien
  cuando no hay datos suficientes (hoy: reseñas hay más de 3, así que
  esa sección debería verse; Resultados reales debería estar oculta).
- El mapa embebido de Visítanos (sin API key — puede mostrar una marca
  de agua de Google, es una limitación conocida del embed simple) y el
  botón "Cómo llegar".
- Que la migaja "Inicio" ya no aparezca en esa pestaña, y que siga
  apareciendo normal en el resto (Servicios, Productos, Citas,
  Nosotros, subpáginas).

**Ajustes post-revisión (mismo día)**: el usuario probó en `npm run dev`
y reportó tres problemas reales:

1. **"Resultados reales" no aparecía** pese a tener ya una pareja real
   cargada en Galería Web — la condición exigía mínimo 3 parejas (lectura
   demasiado literal del "diseño aprobado son 3"). Se relajó: la sección
   se muestra con 1 o 2 parejas (`useSecuenciaScroll.js` ahora recibe
   `totalFotos` dinámico = 2 × parejas reales, en vez de la constante fija
   `TOTAL_FOTOS = 6`, y el grid usa `lg:grid-cols-1/2/3` según cuántas
   haya) — sigue mostrando hasta 3 (el tope del diseño), pero ya no exige
   las 3 completas para aparecer.
2. **El hero se veía como "dos bloques" con un corte de color** (la caja
   de la foto en `#111113` junto al fondo `#0b0b0c` del texto) — el grid
   de 2 columnas (texto | foto en caja separada) que se armó siguiendo
   *Main.dc.html* literal rompía la composición real: las fotos de
   referencia ya traen una franja negra natural del lado izquierdo,
   pensada para que el texto flote encima de la MISMA foto, no al lado en
   una caja aparte. Se volvió al layout full-bleed original (foto como
   fondo absoluto de toda la sección, `aspect-[1680/944]`, texto
   superpuesto con `z-10` sobre esa franja negra) — mismo mecanismo que
   ya existía antes del rediseño, con los elementos nuevos (etiqueta,
   subtítulo, botón "Ver servicios", línea de confianza) agregados
   adentro del mismo bloque de texto.
3. **El efecto antes/después dejó de reaccionar al cursor** (solo se veía
   la foto "después") — causado por el mismo cambio de estructura: el
   `contenedorHeroRef` que usa `useRevelarAntes` para calcular la
   posición del mouse pasó a apuntar a una caja más chica y separada. Se
   resolvió solo al volver el `ref` a la `<section>` completa (como
   estaba originalmente), que es sobre la que el efecto siempre calculó
   coordenadas correctamente.

De paso, la **tira personal** y la **promoción activa** tenían un bug de
ancho real (reportado por el usuario): usaban `mx-4`/`sm:mx-8` (margen
fijo en píxeles) en vez de `mx-auto max-w-[1700px]` (mismo ancho de
columna que el resto de secciones de la página) — se separó el margen
exterior (ahora un `<div>` wrapper con `max-w-[1700px]`, igual que "Lo
más pedido"/"Resultados reales"/etc.) del padding interno de cada caja.

`npm run build` y `npm run lint` siguen sin errores ni advertencias
nuevas tras estos ajustes.

**Segunda ronda de ajustes (mismo día)**: probado de nuevo en
`npm run dev`, el usuario reportó que el hero seguía mostrando la foto
"antes" fija (sin reaccionar al cursor) y que "Resultados reales" solo
mostraba una de las dos fotos de su única pareja cargada. Diagnóstico
real de cada uno (confirmado comparando los archivos de
`public/inicio-web/` con `Read`, no a simple prueba y error):

1. **Hero — bug real en `useRevelarAntes`**: el hook recibía
   `contenedorRef`/`imagenAntesRef` como objetos de `useRef` y su
   `useEffect` tenía esos objetos como dependencias. El problema: un
   objeto de `useRef` NUNCA cambia de identidad entre renders — así que
   ese efecto corre UNA sola vez. Como `InicioCliente` muestra un
   `if (cargando) return <p>Cargando...</p>` mientras llegan los datos,
   el PRIMER render real (el único que ejecuta el efecto) es ese
   placeholder, no el hero — en ese momento ambos refs son `null`, el
   efecto no hace nada y nunca se vuelve a disparar cuando el hero de
   verdad se monta (tras `cargando = false`). Resultado: el
   `mask-image` que oculta la foto "antes" nunca se aplicaba, así que
   esa foto (que va arriba en el DOM, sin mask) tapaba a "después" para
   siempre, sin reaccionar al mouse. Se resolvió cambiando el hook a
   **callback refs con `useState`** (`contenedorHeroRef`/`imagenAntesRef`
   ahora son `setContenedor`/`setImagenAntes`, no objetos `useRef`): una
   función de callback ref SÍ se re-invoca cada vez que React monta un
   nodo real, así que guardarla en estado hace que el `useEffect` (con
   ese estado como dependencia) se vuelva a ejecutar en cuanto el hero
   real aparece.
2. **"Resultados reales" con 1 sola pareja**: no era un bug de datos
   (revisado `ModalGaleriaWeb.jsx` — cada foto usa su propio estado e
   input, sin duplicación) sino de la propia animación: con el layout
   compacto, la sección ya queda completamente visible al cargar la
   página, así que el `IntersectionObserver` de "foto 1 completa"
   dispara solo, sin que la clienta scrollee nada — "antes 1" cae de
   inmediato, y "después 1" (la única foto que falta con 1 sola pareja)
   queda esperando el gesto exacto de "la fila se centra en pantalla",
   que con tan poco contenido es fácil que nunca ocurra — se ve como una
   foto perdida, no como una animación. `useSecuenciaScroll.js` ahora
   solo activa la secuencia completa con `totalFotos >= 4` (2+ parejas);
   con menos, todas las fotos se muestran directo, sin fijar el scroll.

`npm run build` y `npm run lint` siguen sin errores ni advertencias
nuevas.

**Tercera ronda (mismo día)**: el hero ya reaccionaba bien al cursor,
pero "Resultados reales" seguía mostrando solo 1 foto pese a que el
usuario había cargado (según él) 2 parejas reales en Galería Web —
"no es la falta de scroll", aclaró. Antes de seguir ajustando umbrales a
ciegas se consultó la base de datos directo (`execute_sql`): la tabla
`galeria_web` tenía solo **2 filas en total**, no 3 — la fila de prueba
original (`"Foto de prueba (Inicio)"`, con las fotos de stock del hero,
`orden = 0`) más **una sola** fila real del usuario (título vacío,
subida el 28-sep). El usuario no había cargado 2 parejas propias, había
cargado 1 — la segunda que "faltaba" era, sin que él lo supiera, la fila
de prueba contando como si fuera una pareja más.

Con eso confirmado, el bug de UX quedó claro: con esas 2 filas
(`totalFotos = 4`), el umbral de la ronda anterior SÍ activaba la
secuencia animada — y con una sección tan corta, la fila entera ya
quedaba centrada en el viewport inicial junto con la primera foto, así
que la página se fijaba SOLA al cargar, sin que el usuario hiciera
ningún gesto. Eso disparaba la primera pareja (la de prueba) de una,
dejando la pareja real del usuario (la segunda fila) con sus fotos en
`opacity:0` esperando un gesto que nadie sabía que hacía falta — se veía
como "solo una foto" y, como la fila real no tiene título, su link
"Reservar este servicio" quedaba pegado justo debajo del de la fila de
prueba (dos links seguidos, sin nada entre medio, otro síntoma reportado
por el usuario).

Dos correcciones, ninguna más un ajuste de umbral a ciegas:

1. `useSecuenciaScroll.js`: la secuencia animada ahora exige las **3
   parejas completas** del diseño (`totalFotos >= 6`), no 2. Con menos
   (el caso normal mientras el negocio va cargando fotos de a poco), se
   muestran todas directo, sin fijar el scroll — una sección corta es
   justamente el caso con más riesgo de fijarse sola sin que la clienta
   haga nada.
2. **Fila de prueba desactivada** en la base de datos (`update
   galeria_web set activo = false where titulo = 'Foto de prueba
   (Inicio)'`, confirmado con el usuario antes de tocarla — no se borró,
   solo se desactivó, reversible desde el panel Galería Web): ya no
   tiene sentido mezclar fotos de stock genéricas con la primera foto
   real del negocio, y hoy contaba como una pareja más "invisible" a los
   ojos del usuario, empujando el conteo real sin que se notara.

`npm run build` sin errores tras el ajuste.

**Cuarta ronda (mismo día)**: el usuario cargó 4 parejas reales más en
Galería Web (llegando a las 3+ que activan la secuencia animada) y
reportó que solo la primera foto se animaba — "las demás ni aparecen".
El diseño del hook tenía dos debilidades REALES de fondo (no un umbral
mal puesto esta vez), diagnosticadas por inspección de código, no por
prueba y error, y corregidas ambas en `useSecuenciaScroll.js`:

1. **El detector de "fila centrada" se disparaba demasiado pronto.**
   Usaba un `IntersectionObserver` con una banda fija (`rootMargin` del
   16% del alto del viewport) y `threshold: 0` — dispara con la mínima
   intersección, no con estar realmente centrado. Con 3+ parejas el
   bloque de fotos (170-360px por fila, en 1-2 filas de grid según el
   ancho) mide más que esa banda, así que bastaba con que el borde del
   bloque la rozara para fijar la página — mucho antes de que estuviera
   centrada de verdad, y sin que el usuario hubiera scrolleado lo
   suficiente para notarlo. Reemplazado por una comparación directa:
   `getBoundingClientRect()` del bloque y del contenedor en cada evento
   de `scroll` real (con throttle de un cálculo por frame vía
   `requestAnimationFrame`), fijando quando el CENTRO del bloque está a
   menos de 80px del centro del contenedor — funciona igual sin importar
   cuántas parejas haya ni en cuántas filas de grid caigan.
2. **Un scroll continuo contaba como un solo gesto.** La regla de "gesto
   nuevo" agrupaba eventos de rueda por PAUSA de tiempo (>220ms sin
   eventos = gesto nuevo) — pero un scroll normal, sin soltar la rueda
   del mouse ni el dedo, no deja pausas de 220ms entre eventos: TODO ese
   scroll contaba como un único gesto, revelando una sola foto sin
   importar cuánto se siguiera scrolleando después. Reemplazado por
   distancia ACUMULADA: se suma el `deltaY` de cada evento de rueda (o
   los px de cada `touchmove`), y cada 90px acumulados dispara un
   avance — funciona igual con scroll continuo o a los saltos, y sigue
   respetando que un avance bloqueado por una animación en curso no
   hace nada (hay que seguir scrolleando para la siguiente, tal como
   pide el README).

De paso, el `touchmove` pasó del mismo criterio "una resolución por
touch" (con umbral de 12px) al mismo acumulador de distancia que la
rueda, por consistencia entre ambos caminos de entrada.

`npm run build` y `npm run lint` sin errores ni advertencias nuevas.
Con `.slice(0, 3)` en `InicioCliente.jsx`, si el usuario cargó 4
parejas solo las primeras 3 (por `orden`, luego `creado_en`) se
muestran y animan — la 4ª queda fuera del tope del diseño, no es un bug.

**Quinta ronda (mismo día)**: con las 3 parejas cargadas, el usuario
reportó que la página NUNCA se fijaba ("sigue el scroll") y que solo la
foto 1 se animaba. Causa raíz real, no otro ajuste de umbral: tanto el
`IntersectionObserver` de centrado como los listeners de
`wheel`/`touchmove` dependían de `contenedorRef` (el div con
`overflow-y-auto` de la página) — pero el ÚNICO mecanismo de esta
pantalla que el usuario había confirmado que SÍ funciona (la foto 1
cayendo sola) usa un `IntersectionObserver` **sin** `root` en absoluto,
o sea, el viewport real del navegador, no ningún contenedor puntual.
Nunca se verificó que `contenedorRef` fuera de verdad el elemento que
recibe el scroll real de la página — evidentemente no lo era (o el
`root` de un `IntersectionObserver` que no es un verdadero ancestro de
scroll del elemento observado simplemente no dispara como se espera), y
por eso ni el centrado ni el bloqueo del scroll se activaban nunca.

Se unificó TODO al mismo criterio que ya se sabía que funcionaba:
- El `IntersectionObserver` de centrado dejó de especificar `root`
  (usa el viewport, como el de la foto 1) y ahora usa un `threshold`
  de 21 pasos (cada 5% de intersección) en vez de uno solo — el
  navegador garantiza disparar el callback en cada cruce, así que no se
  salta el momento exacto del centrado aunque el scroll avance en
  saltos grandes (rueda de mouse, trackpad rápido).
- Los listeners de `wheel`/`touchmove` se movieron de `contenedorRef` a
  `window` — esos eventos hacen bubble hasta `window` sin importar en
  qué elemento anidado ocurra el scroll real, así que `preventDefault()`
  ahí bloquea la acción sin depender de acertar cuál es "el" contenedor.
- `contenedorRef` ya no es un parámetro de `useSecuenciaScroll` (se quitó
  también de la llamada en `InicioCliente.jsx`) — dejó de hacer falta.

`npm run build` y `npm run lint` sin errores ni advertencias nuevas.

**Sexta ronda — diagnóstico con Playwright, causa raíz real (mismo
día)**: el usuario reportó que seguía sin funcionar ("no se bloquea al
llegar al medio, sigue el scroll") y, ante una quinta ronda de hipótesis
sin poder verificar nada, autorizó instalar Playwright (`npm i -D
playwright` + `npx playwright install chromium`) para probar de verdad
en un navegador — dejó de ser "ajustar y esperar el siguiente reporte".
Se creó una cuenta de cliente de prueba (`playwright.test.inicio@
gmail.com`, email confirmado a mano vía SQL, `clientes_web`/`clientes`
insertados directo) para poder loguearse en el portal y llegar a Inicio
sin depender de una cuenta ajena.

Instrumentando `IntersectionObserver` y los listeners de scroll desde
afuera (interceptando el constructor global, contando eventos
recibidos) se encontraron DOS bugs reales, no otro ajuste de umbral:

1. **El detector de centrado (con 21 `threshold`, de la ronda
   anterior) nunca detectaba el centro.** Un `IntersectionObserver` solo
   dispara su callback cuando el RATIO de intersección cambia — y como
   el bloque de fotos es más chico que el viewport, apenas entra
   completo (ratio=1.0) el ratio queda CONSTANTE mientras el bloque se
   mueve libremente dentro del viewport (confirmado con logs: el
   observer se disparó en `rectTop=416`, después en `rectTop=56`, y el
   punto centrado quedó justo en el medio, sin ningún disparo ahí). Un
   `IntersectionObserver` sirve para detectar cruces de visibilidad, no
   para medir posición continua. Reemplazado por `getBoundingClientRect()`
   directo sobre la fila en cada evento de scroll real — escuchado en
   `document` con `capture: true` (confirmado con Playwright que SÍ
   dispara, a diferencia de un listener normal sin capture: el scroll de
   un elemento con overflow interno no burbujea, pero sí pasa por la
   fase de captura de cualquier ancestro).
2. **El bug real de fondo: `const terminadoRef = useRef(!listo)`.**
   Mismo patrón que ya había roto el hero (`useRevelarAntes`) en una
   ronda anterior — un `useRef` fija su valor en el PRIMER render y
   nunca se resincroniza. Como `InicioCliente` monta un placeholder
   "Cargando..." mientras llegan los datos, ese primer render tenía
   `listo = false`, así que `terminadoRef.current` quedaba en `true`
   PARA SIEMPRE — la condición `if (terminadoRef.current || ...) return`
   bloqueaba el fijado desde el principio, sin importar cuánto se
   scrolleara. Confirmado con un log temporal (`terminado=true` en
   TODOS los chequeos, desde el primero). Se eliminó `terminadoRef` por
   completo: "ya terminó" se deriva de `visto < totalFotos` en el propio
   chequeo, que sí está siempre sincronizado (es un `useRef` que se
   reescribe en cada render, no uno que se lee sin reescribir).

Un tercer ajuste menor encontrado en el mismo diagnóstico: `alRueda`
llamaba `evento.preventDefault()` ANTES de mirar la dirección, así que
el primer gesto de "liberar hacia arriba" quedaba cancelado igual —
la página no se movía hasta el SEGUNDO scroll hacia arriba. Reordenado
para no prevenir ese gesto específico, dejándolo pasar de inmediato.

Verificado de punta a punta con Playwright (no solo "compila"): login
real, scroll simulado con `page.mouse.wheel()`, y lectura directa del
DOM en cada paso — la fila se fija exactamente cuando el cálculo cruza
el centro, cada gesto adicional revela una foto respetando la animación
en curso (900 ms), se libera sola al completar las 6, y un scroll hacia
arriba libera y mueve la página en el mismo gesto. Captura de la
secuencia completa enviada al usuario como evidencia.

Limpieza tras la sesión de debugging: servidor de desarrollo de prueba
(puerto 5199) detenido, scripts sueltos de Playwright borrados,
`.pw-scratch/` agregado a `.gitignore` (no hay test suite configurado en
este proyecto, ver CLAUDE.md — esto fue una sesión de debugging puntual,
no una suite que quede corriendo). `playwright` queda instalado como
devDependency por si hace falta reproducir otro bug de UI así. La cuenta
de prueba `playwright.test.inicio@gmail.com` se conserva a pedido del
usuario, para reusarla en la próxima sesión de debugging.

`npm run build` y `npm run lint` sin errores ni advertencias nuevas.

---

## 20. Correcciones QA — Grupo 1: integridad de datos (QA-004, QA-003, QA-012) — 2026-10-02

Rama `fix/qa-correcciones`. Trabajo solo contra Supabase Local TEST con datos
ficticios; nada aplicado a producción. Evidencia de cada hallazgo: base
Notion "QA — Sistema Jaise Pos y Wed". Estado en Notion sin tocar: todos
quedan para Re-test de Codex (Verificado = defecto confirmado por el
usuario, no corregido).

**QA-004 — editar una cita podía dejarla sin servicios.** `ModalCita.jsx`
guardaba una edición en 3 llamadas HTTP (UPDATE citas, DELETE
cita_servicios, INSERT cita_servicios). Una recarga o corte de red entre
el DELETE y el INSERT dejaba la cita persistida sin ningún servicio.
Corrección: migración `20261002000001_guardar_cita_pos.sql` con el RPC
`guardar_cita_pos` (SECURITY DEFINER, mismo gate `rol_actual() is not
null` que las políticas RLS vigentes) que crea/edita la cita y reemplaza
sus líneas en una sola transacción; `ModalCita.jsx` lo llama en vez de las
3 llamadas. Precio y duración por línea siguen siendo editables en POS
(no se recalculan del catálogo, a diferencia de `reprogramar_mi_cita_web`).
Verificado por RPC contra Local: crear, editar, y un guardado inválido
(servicio inexistente) falla sin borrar las líneas ni cambiar la nota
(rollback). **Aviso para Re-test:** el caso Playwright QA-004 retiene el
POST REST a `cita_servicios`; esa llamada ya no existe, así que el caso
debe adaptarse (ahora el guardado es `POST /rest/v1/rpc/guardar_cita_pos`).

**QA-003 — stock fraccionario se truncaba en silencio.** La columna
`stock_actual` es `integer` (correcto), pero `validar()` de
`ModalProducto.jsx` usaba `parseInt`, que descarta el resto sin avisar
("2.7" → 2, "5abc" → 5). Ahora compara contra `Number()` del mismo texto
y rechaza con mensaje claro. Sin migración.

**QA-012 — dos atenciones el mismo día duplicaban visitas, puntos y
sellos.** `registro_servicios.fecha` es `timestamptz` (hora exacta) y
`mis_puntos()`, `mi_fidelizacion()`, `generar_cupon_fidelizacion()` y
`mi_historial_fidelizacion()` contaban `count(distinct fecha)`: instantes
distintos, no días distintos. Migración
`20261002000002_fidelizacion_dia_lima.sql` trunca a día en hora de Perú
(mismo criterio que `es_hoy()`); fórmulas y umbrales intactos.
`mi_historial_fidelizacion()` además podía devolver el mismo día dos
veces. Comprobado en SQL (08:00 y 19:00 del mismo día: antes 2, ahora 1);
falta el Re-test end-to-end con un CLIENTE (la suite exige rama `testing`).

`npm run build` sin errores.

---

## 21. Correcciones QA — Grupo 2: cálculos financieros (QA-024) — 2026-10-02

Rama `fix/qa-correcciones`, solo Supabase Local TEST, sin migración.

**QA-024 — Dashboard calculaba la ganancia antes de descuentos.** El
Dashboard partía de `ingreso_productos + ingreso_servicios`
(`venta_items.subtotal`, previo al descuento de la venta) y nunca restaba
`descuentos`; Estadísticas parte de `sum(ventas.total)`, ya descontado.
Para el mismo período con ventas descontadas la "Ganancia final" difería
(también el 10% operativo, el diezmo y la meta de equilibrio, que se
calculan sobre ese ingreso). Corrección en `Dashboard.jsx`: la cascada y la
barra de equilibrio parten del ingreso neto (`bruto − descuentos`); se
añadió el paso "Descuentos" a la cascada para que los números cuadren a la
vista. Se conserva "Ingreso bruto" antes de descuentos en el resumen. No se
tocaron `finanzas.js` ni las RPC (siguen siendo la única fuente de la
cascada). Comprobado contra Local con una venta ficticia con 20% de
descuento (anulada después): antes Dashboard −50.98 vs Estadísticas −52.12;
ahora ambos −52.12. Pendiente: Re-test de Codex en UI.

---

## 22. Correcciones QA — Grupo 3: separación de roles e interfaz (QA-011, QA-001) — 2026-10-02

Rama `fix/qa-correcciones`, solo Supabase Local TEST, sin migración y sin
tocar RLS/GRANTs (las restricciones del backend se conservan).

**QA-011 — "Mi perfil de clienta" del personal mostraba datos de otros
clientes.** Alcance real (medido en Local): ADMINISTRADOR, CAJERA y
ASISTENTE leen TODAS las filas de `citas` (32) y `registro_servicios`
(65-70) por su RLS de personal, que es correcta para el POS; ADMINISTRADOR
además lee todos los `pedidos_web` (11). El ticket citaba solo CAJERA, pero
el defecto es de las pantallas del portal, que dependían solo de la RLS para
acotar a "lo mío". Corrección: nuevo `src/lib/clienteWeb.js`
(`obtenerMiClienteId()` → RPC `mi_cliente_id()`); `CitasCliente` (mes,
próximas, historial), `HistorialCliente`, `InicioCliente` (próxima cita),
`CarritoServiciosCliente` ("ya tienes cita ese día") y `PedidosCliente`
filtran por esa clienta; sin perfil vinculado muestran vacío, nunca sin
filtro. Para un CLIENTE real no cambia nada (su RLS ya lo acotaba).
Comprobado en Local: con el filtro, un cliente con 4 citas devuelve 4 y 0
ajenas. Fuera de alcance: `mis_puntos`/`mis_cupones`/etc. ya son RPC por
`mi_cliente_id()`.

**QA-001 — «Crear servicio» visible sin permiso.** La RLS
(`servicios_insert_admin`) solo deja insertar al ADMINISTRADOR. Se oculta la
opción en `ModalCita` y `ModalRegistroAtencion` salvo para ADMINISTRADOR (con
un "No hay servicios que coincidan." para el resto). Comprobado en Local que
CAJERA y ASISTENTE siguen rechazados por el servidor (RLS), es decir el
defecto era solo de interfaz.

`npm run build` y lint sin avisos nuevos. Pendiente: Re-test de Codex en UI.

---

## 23. Correcciones QA — Grupo 4: pedidos y cupones (QA-009, QA-005, QA-019) — 2026-10-02

Rama `fix/qa-correcciones`, solo Supabase Local TEST. Una migración:
`20261002000003_pedidos_cupones_ambiguedades_pago.sql` (sin aplicar a producción).
Los tres defectos se reprodujeron antes de corregir (transacción con
rollback, sesión simulada vía `request.jwt.claims`).

- **QA-005** `reclamar_cupon_promocion()`: "column reference id is
  ambiguous". `RETURNS TABLE(id, codigo, ...)` crea variables OUT que chocan
  con `where id = p_promocion_id`; se califica `public.promociones.id`.
- **QA-019** `confirmar_venta()` con cupón: "column reference codigo is
  ambiguous" (mismo patrón, otro origen: `RETURNS TABLE(venta_id, codigo,
  ...)` vs `where codigo = ...` del UPDATE a `cupones`). Se califica con la
  tabla; cuerpo restante idéntico a la versión viva.
- **QA-009** `verificar_pago_pedido_web()`: `pedidos_web.metodo_pago` guarda
  `YAPE/PLIN/TRANSFERENCIA` y se pasaba tal cual a `confirmar_venta`;
  `ventas_metodo_pago_check` solo acepta `Efectivo/Tarjeta/Transferencia/Yape`
  (fallaban los tres medios, no solo Yape). Se traduce (YAPE→Yape,
  TRANSFERENCIA→Transferencia) y, como Plin no tiene equivalente, se agrega
  `'Plin'` al CHECK de ventas en lugar de registrarlo como otro medio;
  `Estadisticas.jsx` e `Historial.jsx` ganan su color/filtro "Plin".

Comprobado en Local (todo con rollback): reclamar una promoción es
idempotente (mismo cupón, 1 solo cupón); venta POS con cupón del 20% →
cupón CANJEADO y ligado a la venta, stock −1, `descuento_pct` 20; anular →
cupón DISPONIBLE sin venta y stock restaurado. Verificar pago de pedidos
YAPE, PLIN y TRANSFERENCIA (este último con cupón): venta con el medio
correcto, pedido LISTO y ligado, stock descontado en los 3 productos;
anular las tres ventas → stock restaurado y cupón DISPONIBLE. No se abordó la
entrega del pedido ni la reseña de compra (ver ENTREGA-CLAUDE.md).
`npm run build` sin errores. Pendiente: Re-test de Codex en UI.

---

## 24. Correcciones QA — Grupo 5: validaciones y funcionamiento de interfaz (QA-014, 006, 015, 013, 010, 008, 007) — 2026-10-02

Rama `fix/qa-correcciones`, solo frontend (sin migración). Cada causa se
confirmó leyendo el código y, donde aplicaba, contra Supabase Local.

- **QA-014** `ModalGasto.jsx`: `parseFloat("12abc")` daba 12. Ahora se valida
  y guarda con `Number()` del texto completo (rechaza "12abc"; "1,5" con coma
  también se rechaza en vez de guardarse como 1). Mismo patrón existe en
  precio/costo de `ModalProducto.jsx`; fuera de este ticket, sin tocar.
- **QA-006** `MiPerfil.jsx` + `clienteWeb.js#telefonoValido`: solo se admiten
  dígitos con separadores habituales y "+" inicial, 7 a 15 dígitos. Validación
  de interfaz; la RPC `vincular_o_crear_cliente_web` no se modificó.
- **QA-015** `MiPerfil.jsx`: "Editar" quedaba habilitado mientras
  `PerfilClienteContext` aún cargaba (formulario con Nombre vacío). Ahora se
  deshabilita y `empezarEdicion` no hace nada hasta que termina la carga.
- **QA-013** `Historial.jsx`: la búsqueda comparaba solo contra `VEN019`, pero
  la pantalla muestra `V019`. Ahora también compara contra el código corto.
- **QA-010** `HistorialCliente.jsx`: `registro_servicios.fecha` es
  `timestamptz` pero se pasaba a `formatearFechaSoloDia` (pensada para `date`),
  que daba "NaN de septiembre". Se convierte antes a día de Lima con
  `formatearFechaISO`.
- **QA-008** `DetalleProductoCliente.jsx` y `DetalleServicioCliente.jsx`:
  `mi_resena_*()` devuelve una fila con todo nulo cuando no hay reseña (objeto
  truthy) y el botón decía "Editar tu reseña". Solo cuenta si trae `id`
  (el detalle de servicio tenía el mismo defecto; `CitasCliente` ya lo
  resolvía así).
- **QA-007** marcadores sin completar: `[ZONA]`, `[S/ X]`, `[7 días]`,
  `[1–2 días]` en `ProductosCliente.jsx` y `DetalleProductoCliente.jsx`. El
  envío ahora muestra "desde S/ {costo más bajo de `zonas_delivery` activas}"
  (nuevo `src/lib/zonasDelivery.js`). **Decisión de negocio pendiente:** no
  existe configuración de plazo de cambios; en vez de inventar "7 días" se
  dejó "Solo con el producto sellado y sin usar. Consulta el plazo con el
  negocio." Queda un fallback `[S/ X]` en `DetalleServicioCliente.jsx:553`
  (adelanto mínimo, solo si el negocio no lo cargó) fuera del alcance del
  ticket.

Comprobado con casos concretos (montos, teléfonos, fechas con hora cerca de
medianoche UTC, búsqueda V019/v019/VEN019/019, y la RPC de reseña vacía contra
Local). `npm run build` sin errores. QA-015, QA-008 y QA-007 son de interfaz:
pendientes de Re-test de Codex en pantalla.
