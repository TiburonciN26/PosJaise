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
2. **Galería** (antes/después) — depende 100% de fotos reales del
   salón, no construir con placeholders/stock.
3. **Reseñas** — testimonios públicos de clientas; reutilizaría el
   componente de revelado palabra-por-palabra de Inicio.
4. **Contacto** — historia corta, dirección+mapa, horario, contadores
   animados (count-up al hacer scroll).
5. **Referidos** (§2.8, ya estaba en el roadmap desde antes) — código/
   link para compartir, recompensa ligada a Fidelización.

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
