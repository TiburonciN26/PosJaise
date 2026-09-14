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
