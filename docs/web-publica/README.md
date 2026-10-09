# Web pública para visitantes (sin sesión)

El enlace principal de GitHub Pages abre la **web de clientas** en `/inicio`, no el formulario de login. El login se pide solo cuando una acción de verdad lo requiere.

## Flujo

| Quién | Qué ve / a dónde va |
|---|---|
| **Visitante** (sin sesión) | Explora Inicio, Servicios (+ detalle), Productos (+ detalle), Nosotros (+ equipo) y Recompensas (catálogo y «Cómo funciona»). En el encabezado: «Iniciar sesión» y «Crear cuenta» (en móvil, «Crear cuenta» está en el menú). Sin carrito, notificaciones ni menú de cuenta. |
| **Cliente** | La misma web, con perfil, historial, citas, carrito, pedidos, direcciones, notificaciones, seguridad y reseñas. |
| **Personal** | Entra a su panel del POS según su rol; puede abrir «Mi perfil de clienta» y volver al POS (sin cambios). |
| **Cerrar sesión** | Desde cualquier menú vuelve al **inicio público** (navegación completa: descarta de la memoria lo cargado por la sesión). |

### Qué pide login

- **Rutas privadas** (`RutaPrivada`): `/mi-perfil` (+ direcciones, pedidos, notificaciones, seguridad, referidos), `/historial`, `/citas`, `/citas/carrito`, `/carrito`, `/mis-resenas`. El visitante nunca monta la pantalla, así que tampoco dispara sus consultas.
- **Pantallas del POS** (`/ventas`, `/dashboard`, …): un visitante que las abre recibe el login; si es personal con permiso, entra directo a esa pantalla.
- **Acciones** (`useRequerirSesion`): agregar al carrito o a la cita, comprar, favoritos, escribir reseña, reclamar cupón. Muestra un aviso y lleva al login.
- Cualquier otra ruta desconocida vuelve a `/inicio`.

### Destino tras el login (`src/lib/destinoLogin.js`)

El destino se guarda en `location.state.desde` (solo rutas internas absolutas; nunca `//` ni URLs externas) y se resuelve con el **rol real**:

- CLIENTE → `desde` o `/inicio`.
- Personal → `desde` solo si es una pantalla del POS que su rol puede abrir; si no, la pantalla inicial de su rol (`rutaInicialPara`).

Cuentas inactivas, errores de perfil («Sin conexión / Reintentar») y negocio cerrado funcionan como antes.

## Cambios de código

`App.jsx` (un solo árbol de rutas para visitante, cliente y personal en «modo clienta»; el árbol del POS solo con personal en sesión), `RutaPrivada`, `useRequerirSesion`, `useSalir`, `AccionesVisitante`, `PortalCliente` y `MenuLateralCliente` (controles de visitante), proveedores del portal sensibles a la sesión (`PerfilCliente`, `CarritoCliente`, `NotificacionesCliente`: sin sesión no consultan y se vacían al salir; `EstadoNegocio` carga solo las políticas públicas), páginas de Inicio, Servicios, Productos y sus detalles (sin consultas personales para visitantes) y `Login` (destino por rol, `?modo=registro`, aviso y «Seguir explorando sin cuenta»). `RecompensasPublica.jsx` se eliminó: `/recompensas` usa `RecompensasCliente publico={!usuario}` dentro del portal.

## Migración `20261009000001_web_publica_visitantes.sql` — **no aplicada en producción**

Aplicada solo en Supabase Local. Concede a `anon` lo mínimo, por columna y fila:

1. **Catálogo**: `servicios`, `servicio_fotos`, `productos`, `producto_fotos` y `promociones` vigentes. Solo filas activas; `productos` **sin** `costo`, `codigo_barras`, `stock_minimo` ni `proveedor`. Antes un visitante veía 0 filas.
2. **EXECUTE explícito** a `anon` solo de las funciones públicas que usa la web (contacto, horario, equipo, galería, reseñas, más pedidos, combos, reglas y catálogo de Recompensas).
3. **`politicas_cita_publicas()`**: adelanto mínimo y plazo de cancelación (no expone las cuentas de Yape/Plin).
4. **Reseñas con nombre abreviado en el servidor** («María G.»): `resenas_publicas`, `resenas_inicio`, `resenas_servicio_publicas` y `resenas_producto_publicas` devolvían el **nombre completo** de la clienta (la pantalla solo lo recortaba). Mismas columnas y orden; cambia el valor.
5. **Cierra fugas previas hacia `anon`** (existían antes de este cambio: cualquiera con la clave pública podía usarlas, comprobado en la base local): `productos_vista` (todas las filas, activas o no, con proveedor y stock mínimo) y `usuarios_para_citas()` / `asistentes_para_citas()` (nombres e ids del personal).

No toca datos, no cambia el cuerpo de ninguna función salvo las 4 de reseñas (solo la expresión del nombre) y es idempotente.

### Antes de aplicarla en producción (consulta de SOLO LECTURA, ejecutar primero)

```sql
-- ¿Qué puede hacer hoy `anon` en producción? (no lee datos de negocio)
select 'tabla' tipo, c.relname objeto
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm')
   and (has_table_privilege('anon', c.oid, 'SELECT')
        or exists (select 1 from pg_attribute a
                    where a.attrelid = c.oid and a.attnum > 0
                      and has_column_privilege('anon', c.oid, a.attnum, 'SELECT')))
union all
select 'funcion', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
   and has_function_privilege('anon', p.oid, 'EXECUTE')
order by 1, 2;
```

Sirve para (a) saber si la fuga de `productos_vista` y de las listas de personal existe también en producción y (b) confirmar, tras la migración, que `anon` solo conserva lo listado arriba. Aplicar según `docs/lanzamiento/PLAN-PUBLICACION.md` (respaldo, autorización explícita, verificación).

## Verificación

- `node tests/e2e/web-publica-verificacion.mjs` (Vite en :5173 + Supabase Local): 29 comprobaciones — visitante, rutas privadas, acción que pide login, cliente (registro, recarga, destino, cierre de sesión) y los tres roles de personal (panel, destino permitido, «Mi perfil de clienta», cierre de sesión). Comprueba que el visitante no hace consultas privadas ni recibe errores HTTP o de consola. Con `WEB_PUBLICA_APP=http://localhost:4173/PosJaise` se repite sobre el build servido bajo el prefijo de GitHub Pages (con un servidor que imita su `404.html`).
- `node --test tests/e2e/destino-login.test.mjs`: lógica pura del destino.

## Pendientes y límites

- **No probado en el Pages real**: el redirector `public/404.html` (sin cambios) se probó con un simulador local, no con GitHub.
- Un visitante ve las **existencias** (`stock_actual`) de los productos, igual que una clienta; es lo que muestra la tienda.
- Las promociones vigentes se ven sin sesión; reclamar el cupón pide cuenta.
- Sin sesión no se muestra el estimado de puntos de las fichas basado en `config_puntos` (sigue siendo solo para sesiones); el del programa de Recompensas sí.
