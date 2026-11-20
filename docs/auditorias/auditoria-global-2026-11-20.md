# Auditoría global — Pos Jaise Beauty Academy

**Fecha:** 2026-11-20 · **Rama:** `main` (`a894a67` + cambios sin commitear) · **Alcance:** frontend completo (`src/`, 219 `.jsx`, ~74 k líneas), build de Vite, PWA, cabeceras de Cloudflare Pages, Pages Functions de medios y base de datos **Local** (RLS, GRANTs, funciones `security definer`, Storage). Producción no se consultó (regla "solo local"); Local y prod se sincronizaron el 2026-11-20, así que lo de la base debería valer para ambos, pero confírmalo con `huella_esquema.sql` antes de corregir.

**Qué NO se pudo verificar:** no hay herramienta de navegador en esta sesión, así que no hay medición real de LCP/INP/CLS, ni revisión visual de diseño/responsive, ni prueba con lector de pantalla. Las notas de UI, responsive y contraste salen del código y de los tokens, no de ver la app. La Edge Function / backend de Culqi tampoco se auditó (está bloqueada, ver memoria).

### Evidencia ejecutada

| Comando / consulta | Resultado |
|---|---|
| `npm run build` | ✅ compila (1,9 s). Entrada `index` 272 kB (88 kB gzip), `supabase` 203 kB (52 kB gzip), CSS único 207 kB, precaché PWA 101 entradas / 1,0 MB |
| `npm run lint` (oxlint) | 0 errores, ~40 avisos (14 `exhaustive-deps` en `src/`, 10 `only-export-components`, resto en `.codex/` y `tests/`) |
| `npm audit --omit=dev` | 3 altas: `react-router` 7.12–7.18.1 (GHSA-qwww-vcr4-c8h2, modo RSC) y `vite` 8.0–8.1.5 (servidor de desarrollo) |
| `npm outdated` | Todo dentro de la misma mayor salvo `vite-plugin-pwa` 2.0 y `supabase` CLI 3.x |
| Base Local | 68 tablas, **todas con RLS**, 156 políticas, 133 funciones `security definer`, **todas con `search_path` fijado** |
| Grep de secretos | Ningún JWT ni `service_role`/`sb_secret_` en archivos versionados. El repo es **público** en GitHub |

---

## 1. Arquitectura del proyecto

**Lo que está bien.** Hay dos árboles de rutas separados (POS / portal) elegidos una sola vez en `App.jsx`. Las pestañas del POS se mantienen montadas (`PestanasCacheadas`). La carga diferida es propia, con reintento (`lib/moduloDiferido.js` + `LimiteCargaDiferida`). Los contextos están bien acotados (`AuthContext`, `CarritoClienteContext`, `ToastContext`…). Las búsquedas y la paginación viven en `lib/` y `hooks/` (`leerPaginado`, `useListaPaginada`, `useBusqueda*`). Las migraciones son disciplinadas y los documentos de patrones están en `docs/patrones/`. Para una pyme es una arquitectura por encima de la media.

#### 1.1 Componentes-página monolíticos
- **Severidad:** 🟠 Alto
- **Descripción:** 12 archivos superan las 1 000 líneas: `Ventas.jsx` (1 860 líneas, 30 `useState`, 12 `useEffect`), `Historial.jsx` (1 626), `CarritoCliente.jsx` (1 578, 35 `useState`), `Citas.jsx` / `CitasCliente.jsx` (1 391), `RecompensasWeb.jsx` (1 290), `ModalProducto.jsx` (1 189), `ModalRegistroAtencion.jsx` (1 146)…
- **Por qué es un problema:** mezclan acceso a datos, reglas de negocio (montos, cupones, comisiones), estado de UI y marcado. Un cambio en el cobro obliga a entender 1 800 líneas, y sin tipos ni tests unitarios el riesgo de regresión es alto.
- **Consecuencias:** cada corrección tarda más, aparecen efectos con dependencias incompletas (ver 3.1) y los diffs son difíciles de revisar.
- **Cómo solucionarlo:** extraer por capas, empezando por `Ventas.jsx`: (1) un hook de dominio `useCobro()` con `useReducer` para montos, métodos de pago y vuelto; (2) funciones puras en `lib/cobro.js` (totales, redondeos, validaciones) que se puedan probar; (3) subcomponentes de presentación (`PanelCobro`, `ListaItemsVenta`, `ResumenVenta`).
- **Ejemplo:**
  ```jsx
  // lib/cobro.js — puro, testeable
  export function calcularVuelto({ total, recibido }) {
    const r = Math.round((recibido - total) * 100) / 100
    return r > 0 ? r : 0
  }
  // hooks/useCobro.js
  export function useCobro(total) {
    const [estado, despachar] = useReducer(reductorCobro, total, estadoInicialCobro)
    return { ...estado, vuelto: calcularVuelto({ total, recibido: estado.recibido }), despachar }
  }
  ```
- **Prioridad:** corto plazo (empezar por Ventas y CarritoCliente, que manejan dinero).

#### 1.2 Acceso a Supabase disperso en la UI
- **Severidad:** 🟡 Medio
- **Descripción:** 75 llamadas `supabase.from(` están en `pages/` y `components/`, frente a 26 en `lib/` y `hooks/`.
- **Por qué es un problema:** las columnas que se piden, los filtros y el manejo de errores se repiten. Ya pasó en este repo: el perfil pedía `clientes.ruc`, que solo existía en Local (commit `769ca6f`).
- **Cómo solucionarlo:** una capa `lib/repos/<entidad>.js` por tabla, con las columnas centralizadas (`COLUMNAS_PRODUCTO`), que sea la única que importa `supabase`.
- **Prioridad:** medio plazo, de forma oportunista (al tocar cada pantalla).

#### 1.3 Repositorio público con ~600 archivos de evidencia interna
- **Severidad:** 🟡 Medio
- **Descripción:** se versionan `.codex/` (135+ carpetas de evidencia y rollbacks con copias de `src/`), `docs/evidencia-*`, `_ver.cjs`, `implementacionesWed.md` (7 967 líneas) y `notaswed.md`, en un repo **PUBLIC**.
- **Por qué es un problema:** no se filtran secretos (verificado), pero sí se publica el mapa completo de la defensa: políticas, guardas y nombres de funciones. Además el lint recorre `.codex/` y salen avisos de código muerto que no es de la app.
- **Cómo solucionarlo:** pasar el repo a privado (Cloudflare Pages funciona igual con repos privados; GitHub Pages ya se retiró) o sacar `.codex/` a otro repo. Añadir `"ignorePatterns": [".codex/**", "dist*/**"]` a `.oxlintrc.json`.
- **Prioridad:** corto plazo.

**¿Soportaría un proyecto grande?** Sí en estructura de carpetas y despliegue. No en el tamaño de los componentes ni sin tipado: con 2 o 3 personas más, el cuello de botella serían los monolitos.

---

## 2. Calidad del código

**Lo que está bien:** los nombres son descriptivos y consistentes en español, no hay `console.log` (solo 4 `console.error` intencionales), no hay `alert` ni `confirm` nativos, y los "TODO" que aparecen al buscar son en realidad la palabra "TODOS". Los comentarios explican el *porqué*.

#### 2.1 Comentarios convertidos en bitácora
- **Severidad:** 🟢 Bajo
- **Descripción:** muchos comentarios narran la historia ("Fase 8 V2 (F8-01): …antes compartía…") en vez de explicar el estado actual (ver `vite.config.js`, `main.jsx`, `index.html`).
- **Consecuencias:** se desactualizan y hacen ruido. Lo histórico ya está en `implementacionesWed.md` y en git.
- **Cómo solucionarlo:** dejar en el código solo el invariante ("no precargar dependencias diferidas: un modulepreload fallido sin red bloquea el reintento") y mover la historia al changelog.
- **Prioridad:** opcional.

#### 2.2 Valores mágicos de estilo repetidos
- **Severidad:** 🟡 Medio
- **Descripción:** hay 356 colores hex en JSX y 502 tamaños arbitrarios `text-[Npx]` (188 de ellos de 9–11 px).
- **Por qué es un problema:** se salta el sistema de tokens que ya existe en `index.css`, así que cambiar la marca o el contraste obliga a buscar y reemplazar a mano.
- **Cómo solucionarlo:** ver 14.1.
- **Prioridad:** medio plazo.

---

## 3. React

**Lo que está bien:** `Suspense` con límites de error locales, `useMemo`/`useCallback` usados con criterio (60/71), cancelación de efectos con banderas `vigente`, `StrictMode` activo, `ErrorBoundary` doble (el aviso de PWA queda fuera del límite de la app), y las keys por índice solo están en listas estáticas (estrellas), lo cual es correcto.

#### 3.1 `useEffect` con dependencias incompletas
- **Severidad:** 🟡 Medio
- **Descripción:** hay 14 avisos de `exhaustive-deps` en `src/`: `Inventario.jsx:220`, `MiPanel.jsx:347`, `Estadisticas.jsx:315`, `Deudas.jsx:165`, `Historial.jsx:1211`, `Ventas.jsx:625,639`, `Dashboard.jsx:77`, `Auditoria.jsx:292`, `Gastos.jsx:251`, `Almacen.jsx:152`, `CajaChica.jsx:153`, `ModalRegistroAtencion.jsx:284` y `SelectorProductoBuscable.jsx:58` (este depende de un objeto que se recrea en cada render).
- **Por qué es un problema:** la mayoría son `cargarX` declarados en el cuerpo del componente. Hoy funcionan porque los filtros se leen por otra vía, pero son *closures* obsoletos en potencia. Los de `Ventas.jsx` (montos recibidos) son los delicados, porque tocan el cobro.
- **Cómo solucionarlo:** usar `useCallback` con sus dependencias reales, o `useEffectEvent` (estable en React 19.2) para la función de carga.
  ```jsx
  import { useEffect, useEffectEvent } from 'react'
  const alCargar = useEffectEvent((vigente, silencioso) => cargarProductos(vigente, silencioso))
  useEffect(() => {
    if (!activo) return
    const vigente = { actual: true }
    alCargar(vigente, primeraCargaHecha.current)
    primeraCargaHecha.current = true
    return () => { vigente.actual = false }
  }, [activo])
  ```
  Para `SelectorProductoBuscable.jsx:58`, envolver `opcionesBusqueda` en `useMemo`.
- **Prioridad:** corto plazo para Ventas y el selector; el resto, medio plazo.

#### 3.2 Contextos que exportan algo más que componentes
- **Severidad:** 🟢 Bajo
- **Descripción:** `AuthContext`, `CarritoClienteContext`, `EstadoNegocioContext`, `NotificacionesClienteContext`, `CarritoContext`, `TarjetaProductoCliente`, `ModalGasto` y `ModalMobiliario` exportan hooks o constantes junto al componente.
- **Consecuencia:** Fast Refresh recarga el árbol completo en desarrollo y se pierde el estado del carrito o de la venta al editar.
- **Cómo solucionarlo:** mover `useAuth`, `useCarritoCliente`, etc. a `context/useAuth.js`.
- **Prioridad:** opcional.

#### 3.3 Exceso de estado local en las páginas
- **Severidad:** 🟡 Medio (parte de 1.1)
- **Descripción:** hay 30–35 `useState` por página en Ventas y CarritoCliente; estado derivado y estado fuente conviven.
- **Cómo solucionarlo:** usar `useReducer` por subdominio y derivar en el render lo que sea derivable.
- **Prioridad:** corto plazo, junto con 1.1.

---

## 4. Tipado

#### 4.1 JavaScript sin tipos ni contratos
- **Severidad:** 🟠 Alto
- **Descripción:** hay 0 archivos `.ts`, no hay PropTypes ni JSDoc sistemático, y `jsconfig.json` no activa `checkJs`. Las respuestas de Supabase (`data`) se usan sin forma conocida.
- **Por qué es un problema:** un POS que cobra dinero, con 133 RPC y 68 tablas, depende de que los nombres de columnas y parámetros (`p_venta_id`, `p_items`…) coincidan, y hoy eso solo se descubre en tiempo de ejecución.
- **Cómo solucionarlo (gradual, sin migrar todo):**
  1. `supabase gen types typescript --local > src/types/supabase.d.ts`.
  2. En `jsconfig.json` activar `"checkJs": true` solo para `src/lib/**` y añadir JSDoc:
     ```js
     /** @typedef {import('../types/supabase').Database['public']['Tables']['productos']['Row']} Producto */
     /** @param {Producto[]} productos */
     export function totalStock(productos) { … }
     ```
  3. Crear `createClient<Database>()` en un `supabase.ts` cuando se decida pasar a TS.
- **Prioridad:** medio plazo (alto valor, coste incremental).

---

## 5. Rendimiento

**Lo que está bien (destacable):** división de código por pantalla (cada página es su propio chunk de 10–57 kB), escáner de códigos (481 kB) cargado solo al usarse, precaché PWA limitado al *shell*, precarga del hero con `fetchpriority=high` y variante de 1 280 px para móvil, fuentes autoalojadas, paginación a la base en bloques de 1 000 y medición documentada (`docs/evidencia-rendimiento/`).

#### 5.1 CSS único de 207 kB para POS y portal
- **Severidad:** 🟡 Medio
- **Descripción:** `index.css` (4 155 líneas, 55 `@keyframes`) se compila en un solo `index-*.css` que bloquea el render en ambos árboles. El POS descarga los estilos `.landing-web`, `.iri-*` y las animaciones del portal, y viceversa.
- **Consecuencias:** más bytes en el primer pintado del portal público, que es donde importa el LCP.
- **Cómo solucionarlo:** pasar los bloques exclusivos del portal a `src/styles/portal.css`, importado desde `PortalCliente.jsx` (Vite lo convierte en CSS del chunk diferido), y los del POS a `ArmazonPos.jsx`. En `index.css` quedan los tokens y la base.
- **Prioridad:** medio plazo.

#### 5.2 Sin medición de campo (RUM)
- **Severidad:** 🟢 Bajo
- **Descripción:** las mediciones son de laboratorio (scripts `medir-fase*.cjs`). No se reportan Web Vitals reales.
- **Cómo solucionarlo:** usar `web-vitals` (≈2 kB) con envío a Cloudflare Web Analytics o a una tabla `metricas_web` vía RPC con límite de frecuencia.
- **Prioridad:** opcional.

---

## 6. Optimización de recursos

#### 6.1 Fuentes en TTF
- **Severidad:** 🟡 Medio
- **Descripción:** `Heavitas.ttf` (122 kB) y `Kunaroh.ttf` se sirven en TTF.
- **Cómo solucionarlo:** convertir a WOFF2 con subconjunto latino (`pyftsubset Heavitas.ttf --unicodes="U+0000-00FF,U+2013-201F" --flavor=woff2`). Suele bajar entre un 60 y un 75 %. Mantener `font-display: swap`.
- **Prioridad:** corto plazo (es rápido).

#### 6.2 Imágenes del hero y del login
- **Severidad:** 🟢 Bajo
- **Descripción:** los 4 heros WebP pesan 430–500 kB cada uno (en escritorio). `manicure-detalle.jpeg` (220 kB), `manicure-diseno.jpeg` (165 kB) y `foto-login.jpeg` (121 kB) siguen en JPEG. `icon-512.png` pesa 162 kB.
- **Cómo solucionarlo:** AVIF con WebP de respaldo (`<picture>`) para los heros, con objetivo de ≤250 kB; convertir los JPEG del login a WebP/AVIF; pasar `icon-512.png` por `oxipng -o 4` o `pngquant`.
- **Prioridad:** opcional / corto plazo.

#### 6.3 Dependencias muertas
- **Severidad:** 🟢 Bajo
- **Descripción:** `src/components/ui/button.jsx` y `src/lib/utils.js` no se importan en ningún sitio, así que `@base-ui/react`, `class-variance-authority` y `cn` son dependencias sin uso (restos de `shadcn init`). Además `@tailwindcss/vite` y `tailwindcss` están en `dependencies` cuando son de build.
- **Cómo solucionarlo:** borrar esos dos archivos, `npm rm @base-ui/react class-variance-authority cn`, y mover tailwind a `devDependencies`.
- **Prioridad:** corto plazo.

---

## 7. Seguridad

**Lo que está bien (muy por encima de la media):** RLS en el 100 % de las tablas; ninguna política de escritura con `true`; las 133 funciones `security definer` tienen `search_path` fijado; las RPC sensibles (`anular_venta`, `eliminar_*`, `completar_cita`) validan `rol_actual()`/`es_admin()` dentro y fallan para `anon`; las cuentas del personal se crean en el servidor (`lib/personal.js`); el build de Cloudflare se detiene si encuentra `service_role`/`sb_secret_`; no hay `dangerouslySetInnerHTML` ni `eval`; los buckets de comprobantes son privados y van por carpeta `auth.uid()`; la escritura de reseñas está validada en el servidor.

#### 7.1 Sin Content-Security-Policy ni protección anti-iframe; sesión en localStorage
- **Severidad:** 🟠 Alto
- **Descripción:** `cloudflare/_headers` solo envía `X-Content-Type-Options` y `Referrer-Policy`. No hay `Content-Security-Policy`, `frame-ancestors`/`X-Frame-Options`, `Strict-Transport-Security` ni `Permissions-Policy`. supabase-js guarda el token de sesión en `localStorage` (comportamiento por defecto).
- **Por qué es un problema:** hoy no se encontró ningún sink de XSS, pero si llegara a colarse uno (una dependencia comprometida o un futuro `innerHTML`), no hay segunda barrera: el script leería el token del POS (rol administrador) y operaría como la dueña. Sin `frame-ancestors`, el POS puede cargarse en un iframe ajeno (clickjacking sobre "Anular venta").
- **Cómo solucionarlo:** empezar en modo *Report-Only* para no romper Google Maps ni Culqi, y endurecer después:
  ```
  /*
    X-Frame-Options: DENY
    Strict-Transport-Security: max-age=31536000; includeSubDomains
    Permissions-Policy: camera=(self), microphone=(self), geolocation=()
    Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self' https://checkout.culqi.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.culqi.com; img-src 'self' data: blob: https://*.supabase.co https://maps.gstatic.com https://maps.googleapis.com; frame-src https://www.google.com https://checkout.culqi.com; style-src 'self' 'unsafe-inline'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  ```
  `index.html` tiene dos `<script>` inline (tema y precarga del hero): sacarlos a `public/arranque.js` o permitirlos por hash `'sha256-…'`. `camera` y `microphone` hacen falta para el escáner y `BotonVoz`.
- **Prioridad:** inmediata para `X-Frame-Options`, HSTS y `Permissions-Policy` (no rompen nada); corto plazo para la CSP.

#### 7.2 Buckets públicos que se pueden listar, sin límites de tamaño ni de tipo
- **Severidad:** 🟠 Alto
- **Descripción:** `fotos-clientes`, `fotos-usuarios`, `fotos-productos`, `fotos-servicios`, `fotos-asistentes`, `fotos-galeria` y `qr-pagos` son `public=true`, **sin `file_size_limit` ni `allowed_mime_types`**, y además tienen una política `SELECT` sobre `storage.objects` para `{anon, authenticated}`.
- **Por qué es un problema:**
  1. En un bucket público la URL ya sirve el archivo sin política; la política `SELECT` para `anon` solo añade que **cualquiera con la anon key puede listar** el bucket con `storage.from('fotos-clientes').list()`. Eso enumera los UUID de todas las clientas (sus carpetas) y sus fotos de perfil.
  2. Una clienta autenticada puede subir a su carpeta un archivo de cualquier tipo y tamaño (HTML, SVG con script, un video de 500 MB), que queda servido públicamente bajo el dominio de Supabase del proyecto: alojamiento de malware o phishing a nombre del salón, y consumo de cuota.
- **Cómo solucionarlo (migración nueva, primero en Local):**
  ```sql
  begin;
  -- Por qué: los buckets públicos se sirven por URL sin política; el SELECT para anon solo habilitaba
  -- LISTAR (enumerar UUIDs de clientas). Y sin límites, una sesión de clienta podía alojar cualquier archivo.
  update storage.buckets
     set file_size_limit = 5242880,
         allowed_mime_types = array['image/webp','image/jpeg','image/png']
   where id in ('fotos-productos','fotos-usuarios','fotos-clientes','fotos-servicios',
                'fotos-asistentes','fotos-galeria','qr-pagos');
  drop policy if exists fotos_clientes_select  on storage.objects;
  drop policy if exists fotos_usuarios_select  on storage.objects;
  -- (repetir para los buckets cuyo listado no use la app; verificar antes con grep de `.list(`)
  commit;
  ```
  Antes de aplicarla, comprobar con `grep -rn "\.list(" src` qué buckets lista la app de verdad (la galería quizá sí). Pensar también si las fotos de perfil de clientas deberían ir a un bucket privado con URLs firmadas.
- **Prioridad:** inmediata (límites de tamaño y tipo) / corto plazo (listado).

#### 7.3 `descripcion_de_fila()` ejecutable por `anon`
- **Severidad:** 🟡 Medio
- **Descripción:** es una función `security definer` sin guarda, con EXECUTE para PUBLIC/`anon`. Con `rpc('descripcion_de_fila', { p_tabla: 'citas', p_fila: { cliente_id: '<uuid>' } })` devuelve el **nombre de la clienta** (y con `porcentajes`, el nombre de la asistente) sin sesión.
- **Por qué es un problema:** requiere conocer un UUID, pero 7.2 permite enumerarlos. Es una fuga de datos personales encadenable.
- **Cómo solucionarlo:** solo la usan los triggers de auditoría (que corren como dueño), así que:
  ```sql
  revoke execute on function public.descripcion_de_fila(text, jsonb) from public, anon, authenticated;
  ```
  Aprovechar para revocar EXECUTE a `anon` en las funciones de trigger (`registrar_auditoria`, `notificar_*`, `unicidad_direccion_predeterminada`…). PostgREST no las expone, pero es buena higiene.
- **Prioridad:** inmediata.

#### 7.4 Privilegios residuales de `anon` sobre tablas
- **Severidad:** 🟢 Bajo
- **Descripción:** `anon` conserva `TRUNCATE, TRIGGER, REFERENCES` sobre 40 tablas (herencia de los grants por defecto de Supabase). PostgREST no expone TRUNCATE, así que no es explotable por la API.
- **Cómo solucionarlo:** `revoke truncate, trigger, references on all tables in schema public from anon;` y lo mismo para `authenticated`.
- **Prioridad:** opcional.

#### 7.5 Privilegio mínimo en `clientes`
- **Severidad:** 🟡 Medio
- **Descripción:** `clientes_select` permite leer **todas** las fichas (DNI, teléfono, cumpleaños, dirección, notas) a cualquier rol del personal, incluidas `ASISTENTE` y `PERSONAL_APOYO`.
- **Por qué es un problema:** la Ley 29733 de Perú exige limitar el acceso a datos personales a quien lo necesita. Una asistente necesita nombre y teléfono para atender, no el DNI ni las notas.
- **Cómo solucionarlo:** decisión de negocio. Si se restringe, aplicar el mismo patrón que `productos` (grant por columna + vista `security definer` para admin/cajera).
- **Prioridad:** medio plazo (confírmalo con la dueña).

#### 7.6 Vulnerabilidades en dependencias
- **Severidad:** 🟡 Medio
- **Descripción:** `react-router-dom@7.18.1`: el aviso afecta al modo RSC, que esta SPA no usa, así que el riesgo real es bajo. `vite@8.1.3`: los avisos afectan al servidor de desarrollo, que importa porque `dev:movil` lo expone con `--host` por ngrok.
- **Cómo solucionarlo:** `npm audit fix` (sube a react-router 7.18.6 y vite 8.3.8, sin cambio de mayor), después `npm run build:cloudflare`.
- **Prioridad:** inmediata (5 minutos).

#### 7.7 Otros puntos verificados sin hallazgo
Las tablas con RLS y sin políticas (`almacen_movimientos`, `caja_chica_*`, `horario_*`, `pasarela_eventos`, `gastos_fijos_generados`) son intencionales: solo se accede por RPC. `productos_vista` y `proveedores_nombres` sin `security_invoker` también son intencionales (ocultan `costo`). Las rutas protegidas en el cliente (`RutaProtegida`) son solo para la UX; la autorización real está en RLS, que es lo correcto.

---

## 8. Accesibilidad (WCAG 2.2)

**Lo que está bien:** `lang="es"`, regla global `:focus-visible` con anillo de 2 px en `index.css:959`, 534 atributos `aria-*`, 132 `role=`, 209 `htmlFor`, 155 `autoComplete`, `useModalA11y` con trampa de foco y cierre con Esc en todos los modales, 45 bloques `prefers-reduced-motion`, solo 6 `onClick` en elementos que no son botones, y una suite `a11y-modales.spec.mjs`.

#### 8.1 Contraste de texto secundario por debajo de AA
- **Severidad:** 🟠 Alto
- **Descripción:** hay 144 usos de `text-ink/40` o menos (y `text-white/40`, `/30`…). Calculado sobre los tokens: `#fff` al 40 % sobre `--color-bg #0a0a0a` da ≈ **3,8:1**; `#000` al 40 % sobre `#f8fafc` (tema claro) da ≈ **2,9:1**. WCAG 1.4.3 exige 4,5:1 en texto normal.
- **Agravante:** 188 textos de 9–11 px. Con ese tamaño, un contraste bajo es casi ilegible para una persona mayor o en el celular a pleno sol.
- **Cómo solucionarlo:** definir tokens semánticos y reemplazar las opacidades sueltas:
  ```css
  :root { --color-ink-suave: rgb(255 255 255 / 0.62); }  /* ≈ 7:1 sobre #0a0a0a */
  :root[data-tema='claro'] { --color-ink-suave: rgb(0 0 0 / 0.62); }  /* ≈ 5,6:1 */
  ```
  `/40` queda reservado para texto deshabilitado o decorativo. Mínimo 12 px para texto que se tiene que leer.
- **Prioridad:** corto plazo.

#### 8.2 `img` sin `alt`
- **Severidad:** 🟢 Bajo
- **Descripción:** 3 casos: `IconoFlechaDesplegable.jsx`, `MenuUsuario.jsx`, `InicioCliente.jsx`.
- **Cómo solucionarlo:** usar `alt=""` en las decorativas (la flecha) y un alt descriptivo en el resto.
- **Prioridad:** corto plazo.

#### 8.3 `outline-none` sin estilo de foco alternativo
- **Severidad:** 🟢 Bajo
- **Descripción:** 16 casos con `outline-none` y sin `focus:` en la misma clase (`BarraBusqueda.jsx:60`, `BarraCatalogo.jsx:142`, `ComparadorAntesDespues.jsx:329`…). La regla global `:where(input…):focus-visible { outline: none }` (`index.css:967`) depende de que el contenedor pinte el foco. Hay que revisar uno por uno que el contenedor tenga `focus-within:`.
- **Prioridad:** corto plazo.

**Cumplimiento estimado:** ≈ **75 % de los criterios A/AA** aplicables. Los fallos principales están en 1.4.3 (contraste) y en 1.4.4/1.4.12 (texto muy pequeño). Teclado, foco, nombres accesibles y movimiento están bien. No verificado con lector de pantalla real.

---

## 9. Responsive

No se verificó visualmente. En el código: `min-h-svh`, safe-areas en el toast, `usePantallaAncha`, una variante de imagen para móvil, `dev:movil` para probar en un celular real, y tablas con encabezado fijo (`useEncabezadoTablaPegado`). No se ven anchos fijos peligrosos. **Pendiente:** recorrer las pestañas del POS a 360 px de ancho (Ventas, Historial e Inventario tienen tablas anchas) y revisar que no haya scroll horizontal en el `body`.

#### 9.1 Texto de 9–10 px en móvil
- **Severidad:** 🟡 Medio
- **Descripción:** ver 8.1. Por debajo de 12 px, iOS no hace zoom, pero la legibilidad sufre. En los `input`, menos de 16 px **provoca** zoom automático en iOS Safari.
- **Cómo solucionarlo:** `text-base` (16 px) en todos los `input`/`select` en pantallas `< sm`.
- **Prioridad:** corto plazo.

---

## 10. Diseño UI

No se pudo evaluar visualmente. Lo que sale del código: hay un sistema propio coherente (tokens `--color-*`, `--lw-*`, chevron unificado, `Etiqueta obligatorio`, `BotonCerrarModal`, `Esqueleto`, `EstadoVacio`) y convenciones documentadas (verde reservado, X en la cabecera de cada modal). El riesgo de inconsistencia está en los 356 hex y los 502 tamaños arbitrarios (ver 14.1).

| Apartado | Nota (por código) | Comentario |
|---|---|---|
| Botones | 80 | Patrón claro; verde reservado documentado |
| Inputs / formularios | 80 | Asterisco, `AyudaCampo`, `IndicadorValidez` |
| Modales | 88 | X, Esc, aviso de descarte, trampa de foco |
| Tablas | 72 | Paginador y encabezado fijo; revisar móvil |
| Cards | 75 | Dos estilos (`iri-*` y plano) documentados para no mezclarse |
| Navegación | 80 | Menú lateral con secciones, migas extra |
| Tipografía / tamaños | 60 | Demasiados tamaños sueltos (ver 13) |

---

## 11. Experiencia de usuario (UX)

**Lo que está bien:** toast global no intrusivo, esqueletos de carga, estados vacíos, aviso de descarte en formularios, aviso de actualización de PWA que respeta el trabajo pendiente, POS que cobra sin red, pantalla "Sin conexión / Reintentar" al fallar el perfil, y aviso de negocio cerrado.

#### 11.1 Pantalla de carga genérica
- **Severidad:** 🟢 Bajo
- **Descripción:** `CargandoPantalla` en `App.jsx` es un "Cargando..." en texto plano, sin marca ni `aria-live`.
- **Cómo solucionarlo:** poner el logo con un spinner suave y `role="status" aria-live="polite"`.
- **Prioridad:** opcional.

#### 11.2 El ErrorBoundary pierde el contexto
- **Severidad:** 🟡 Medio
- **Descripción:** ante un error de render se muestra "Algo salió mal" y solo se ofrece "Recargar". El error se va a `console.error` y nadie se entera (ver 20.1).
- **Prioridad:** corto plazo, junto con la observabilidad.

---

## 12. Paleta de colores

Base oscura `#0a0a0a`, acento ámbar `#f5a623`, tokens `--lw-gold`, `--lw-rose` y `--lw-metal-azul` para el portal, y tema claro completo. Es coherente con un salón de belleza premium. El ámbar sobre negro da ≈ 10:1, bien. **Problema:** el contraste del texto secundario (8.1) y los colores de estado repartidos como hex en el JSX en lugar de usar tokens `--color-exito`, `--color-error`, `--color-aviso` e `--color-info`. **Recomendación:** centralizar los estados en tokens y validar cada combinación en los dos temas con un script de contraste (por ejemplo, ampliar `huella` con un test de tokens).

## 13. Tipografía

Geist como base, Space Mono, Inter, Instrument Serif y Orbitron autoalojadas, y Kunaroh/Heavitas para títulos (según la convención de la memoria). **Problemas:** más de 6 familias es mucho peso y mucha dispersión visual; hay 188 textos de 9–11 px; no hay una escala tipográfica definida (`--texto-xs…--texto-2xl`). **Recomendación:** una escala modular (12/14/16/20/24/32), límite de 4 familias en la ruta crítica del portal y `max-width: 65ch` en los párrafos de Nosotros y Términos.

## 14. CSS

#### 14.1 `index.css` monolítico y tokens que no se usan
- **Severidad:** 🟡 Medio
- **Descripción:** son 4 155 líneas en un archivo (tokens, utilidades del portal, 55 keyframes, componentes y el bloque shadcn al final). En paralelo, el JSX usa 356 hex y 502 `text-[Npx]`.
- **Cómo solucionarlo:**
  1. Separar en `styles/tokens.css`, `styles/portal.css`, `styles/pos.css` y `styles/animaciones.css` (ayuda también con 5.1).
  2. Registrar los tokens en el `@theme` de Tailwind v4 para usar `text-ink-suave`, `bg-exito`, `text-xs2` en lugar de valores arbitrarios:
     ```css
     @theme {
       --color-exito: #22c55e;
       --color-error: #ef4444;
       --text-xxs: 0.6875rem; /* 11px: solo etiquetas, nunca párrafos */
     }
     ```
  3. Regla de lint o grep en `build-cloudflare.mjs` que avise cuando un JSX nuevo use `#[0-9a-f]{6}`.
- **Prioridad:** medio plazo.

## 15. Animaciones

Muy bien resueltas: patrón documentado (`useEntornoAnimacion`, `useRevelarEnPantalla`, `docs/patrones/animacion-entrada.md`), `bucleAnimacion.js` centralizado, 45 respetos a `prefers-reduced-motion` y un hook `usePreferenciasMovimiento`. **Riesgo menor:** 55 keyframes globales cargados también en el POS (ver 5.1) y efectos 3D (`iri-*` con tilt, `StarBorder` de 569 líneas) que en gama baja Android pueden bajar de 60 fps. Hay que verificarlo con el *Performance panel* en un equipo modesto. Nota 82.

## 16. Formularios

**Lo que está bien:** `<Etiqueta obligatorio>`, `ErrorCampo`, `IndicadorValidez`, `autoComplete` extenso, `lib/formulariosProtegidos.js`, y la validación crítica en el servidor (reclamos con `registrar_reclamo`, reseñas, ventas por RPC).

#### 16.1 Formulario público del Libro de Reclamaciones sin límite de frecuencia
- **Severidad:** 🟡 Medio
- **Descripción:** `registrar_reclamo(p_datos)` es ejecutable por `anon`. Valida los campos, pero no hay CAPTCHA ni límite por IP, así que un bot puede llenar la tabla de reclamos (que la ley obliga a conservar y atender).
- **Cómo solucionarlo:** Cloudflare Turnstile (gratis, sin fricción) en el formulario y verificación del token en una Pages Function antes de llamar a la RPC, o como mínimo una regla de *rate limiting* de Cloudflare sobre la ruta.
- **Prioridad:** corto plazo.

## 17. Datos asíncronos y estado del servidor

Se usa `useEffect` manual con banderas `vigente` y `leerPaginado`, más Realtime en 3 suscripciones (todas con `removeChannel`). Es consistente y está pensado (las pestañas del POS cargan una vez por sesión). **Limitaciones:** no hay caché compartida entre pantallas (el portal vuelve a pedir el catálogo al volver de un detalle, porque sus rutas se desmontan), ni reintentos automáticos, ni deduplicación, y cada página reimplementa los estados `cargando`/`error`. Además hay 6 usos de `AbortController` frente a ~100 consultas.
- **Severidad:** 🟡 Medio
- **Cómo solucionarlo:** adoptar **TanStack Query** primero solo en el portal (catálogos, detalle, reseñas): `staleTime` de 5 min, la vuelta desde el detalle es instantánea y se obtiene `retry` con *backoff*. El POS puede quedarse como está, porque su modelo de "montado una vez" ya cumple esa función.
  ```jsx
  const { data: servicios = [], isPending, error } = useQuery({
    queryKey: ['servicios-publicos'],
    queryFn: () => leerPaginado(() => supabase.from('servicios').select(COLUMNAS_SERVICIO).eq('activo', true)),
    staleTime: 5 * 60_000,
  })
  ```
- **Prioridad:** medio plazo.

## 18. Testing y calidad automatizada

#### 18.1 Hay suite, pero no está integrada
- **Severidad:** 🟠 Alto
- **Descripción:** `tests/e2e/` tiene **129 archivos** (Playwright: `auth-roles.spec.mjs`, `a11y-modales.spec.mjs`, `expanded-access.spec.mjs`, tests `node:test` de cupones, catálogo y destino de login…) y tres configs (`playwright.qa/ensayo/lanzamiento.config.mjs`), pero `package.json` **no tiene ningún script `test`** y **no hay CI**: cada push a `main` despliega directo a producción sin ejecutar nada. `CLAUDE.md` además dice "no test framework installed", lo cual ya no es cierto, y desalienta usarla.
- **Consecuencias:** la inversión en tests no protege nada de forma automática, y una regresión en el cobro llega a la tienda en el siguiente push.
- **Cómo solucionarlo:**
  ```json
  "scripts": {
    "test": "node --test tests/e2e/*.test.mjs",
    "test:e2e": "playwright test -c playwright.qa.config.mjs",
    "verificar": "npm run lint && npm test && npm run build:cloudflare"
  }
  ```
  Añadir un workflow `.github/workflows/verificar.yml` (lint + `node --test` + build de Cloudflare) en cada PR, y la rama `main` protegida para que Cloudflare solo publique lo que pasó. Los e2e que necesitan Supabase local pueden correr en CI con `supabase start` (Docker) o quedarse como paso local obligatorio. Añadir **Vitest** para las funciones puras de `lib/` (finanzas, cupones, moneda, fechas): ahí están los cálculos de dinero. Actualizar `CLAUDE.md`.
- **Prioridad:** inmediata (scripts + CI mínimo) / corto plazo (Vitest en `lib/`).

#### 18.2 Lint mínimo
- **Severidad:** 🟢 Bajo
- **Descripción:** `.oxlintrc.json` solo activa 2 reglas propias (más las de por defecto de oxlint). No hay Prettier ni `jsx-a11y`.
- **Cómo solucionarlo:** activar los plugins `jsx-a11y` e `import` de oxlint, pasar `exhaustive-deps` a `error` cuando se limpien los 14 avisos, e ignorar `.codex/`.
- **Prioridad:** corto plazo.

## 19. SEO

#### 19.1 El portal público no tiene SEO básico
- **Severidad:** 🟠 Alto (el portal es la vitrina comercial del salón)
- **Descripción:** `index.html` no tiene `<meta name="description">`, Open Graph ni Twitter Card, ni `canonical`. No existen `robots.txt` ni `sitemap.xml`. Ninguna ruta cambia `document.title` (0 usos), así que todas las páginas se llaman "Pos Jaise Beauty Academy" (un nombre de POS, no de salón). Al compartir el enlace por WhatsApp se ve una vista previa vacía.
- **Cómo solucionarlo:**
  1. En `index.html`: description, `og:title`, `og:description`, `og:image` (1 200×630 en `public/og.jpg`), `og:locale=es_PE`.
  2. React 19 renderiza `<title>` y `<meta>` dentro de componentes y los sube al `<head>`:
     ```jsx
     export default function ServiciosCliente() {
       return (<>
         <title>Servicios de manicure y belleza | Jaise Beauty</title>
         <meta name="description" content="Manicure, pedicure, uñas acrílicas… Reserva tu cita en línea." />
         {/* … */}
       </>)
     }
     ```
  3. `public/robots.txt` (con `Disallow` para las rutas del POS) y `sitemap.xml` estático con las rutas públicas.
  4. JSON-LD `BeautySalon` (dirección, horario, teléfono, `aggregateRating` a partir de `resenas_publicas()`). Es lo que más ayuda en búsquedas locales ("manicure cerca de mí").
  5. Opcional: prerender estático de `/inicio`, `/servicios` y `/nosotros` con `vite-plugin-prerender` o un Pages Function, porque los bots de redes sociales no ejecutan JS (los OG del punto 1 son estáticos, así que esos sí funcionan).
- **Prioridad:** corto plazo.

## 20. PWA, offline y observabilidad

**PWA: excelente.** Shell calculado del grafo real de chunks, caché "por uso" con reglas probadas aparte (`sw-reglas-cache.js`), aviso de actualización que respeta la venta en curso, POS operativo sin red, `no-cache` en `sw.js` y `index.html`, `immutable` en `/assets/*`. Es nivel profesional.

#### 20.1 Sin observabilidad de errores en producción
- **Severidad:** 🟠 Alto
- **Descripción:** `ErrorBoundary.componentDidCatch` solo hace `console.error`. No hay Sentry ni equivalente, ni `window.onerror`/`unhandledrejection` centralizados. Los fallos de RPC se muestran con un toast y se pierden.
- **Consecuencias:** cuando la clienta dice "no me deja pagar", no hay nada que revisar. Hoy el diagnóstico depende de copiar los datos de prod a Local y reproducir a mano.
- **Cómo solucionarlo:** Sentry plan gratuito (`@sentry/react`, ≈ 25 kB gzip cargado de forma diferida) con `beforeSend` que elimine correos y DNI, o una RPC `registrar_error_cliente(p_mensaje, p_ruta, p_version)` con límite por usuario y una tabla con retención de 30 días.
  ```jsx
  componentDidCatch(error, info) {
    reportarError(error, { componente: info.componentStack?.slice(0, 2000), ruta: location.pathname })
  }
  ```
- **Prioridad:** corto plazo.

#### 20.2 Manifest con descripción de POS
- **Severidad:** 🟢 Bajo
- **Descripción:** el manifest es único (`"Sistema de punto de venta para el negocio."`), y quien instala el portal como clienta ve el nombre "Pos Jaise".
- **Cómo solucionarlo:** valorar un nombre neutro ("Jaise Beauty") o dos manifests según el árbol.
- **Prioridad:** opcional.

## 21. Dependencias

Las dependencias de runtime son pocas y ligeras (React, router, supabase-js, lucide, zxing de forma diferida); está bien. Acciones: `npm audit fix` (7.6), quitar `@base-ui/react`, `class-variance-authority` y `cn` (6.3), mover tailwind a `devDependencies`, y planificar `vite-plugin-pwa` 2.0 (cambio de mayor, probar con `verificar-actualizacion-pwa*.cjs`). `lucide-react` 1.23 → 1.77 se puede actualizar sin riesgo. Peso de JS inicial: ≈ 140 kB gzip (index + supabase), razonable.

## 22. Calidad profesional

**Lo que transmitiría a un revisor senior:** mucha madurez **operativa**, poco común en un proyecto de este tamaño: disciplina de migraciones con QA local, paridad Local/prod auditable por huella, RLS completo, guardas en el build contra fugas de claves, PWA offline pensada para un POS real, rollback documentado y mediciones de rendimiento. También vería **deuda de código** clásica de un producto que creció rápido: componentes de 1 000–1 800 líneas, ningún tipado, tests que existen pero no protegen el despliegue, y una vitrina pública sin SEO ni monitoreo.

**¿Listo para producción?** Ya está en producción y funciona. Para considerarse "production-grade" faltan tres cosas no negociables: **CI que bloquee el despliegue**, **observabilidad** y **endurecer Storage y las cabeceras**.

---

## Roadmap de mejoras

### 🔴 Críticas (antes del próximo push a producción)
No se encontró ninguna vulnerabilidad crítica explotable hoy. Lo más urgente es de nivel alto y se resuelve en pocas horas:
1. ✅ `npm audit fix` y build de Cloudflare (7.6). *Hecho el 2026-11-20 (§98 de implementacionesWed.md).*
2. ✅ Revocar `descripcion_de_fila` a `anon`/`authenticated` (7.3). *Migración `20261120000001`, aplicada en Local; pendiente en prod.*
3. ✅ `file_size_limit` + `allowed_mime_types` en los buckets de fotos, y SELECT sin `anon` (7.2, incluye el ítem 8). *Misma migración.*
4. ✅ `X-Frame-Options: DENY`, `frame-ancestors 'none'`, HSTS y `Permissions-Policy` en `_headers` (7.1). *Se publica con el próximo push a `main`.*

### 🟠 Altas
5. ✅ Scripts `test`/`verificar` + workflow de CI (18.1); `CLAUDE.md` actualizado. *Hecho el 2026-11-20 (§99). Despliegue bloqueado desde `build-cloudflare.mjs`: en Cloudflare corre lint + tests antes de compilar (§101). De paso se corrigieron 3 tests desactualizados y el lint dejó de recorrer `.codex/`.*
6. ✅ Observabilidad de errores (20.1). *Tabla propia `errores_cliente` + `lib/reportarError.js`, sin Sentry (§100). Migración `20261120000002` aplicada en Local; pendiente en prod. Opcional: una pestaña en el POS para leerlos.*
7. 🟡 CSP en *Report-Only* ✅ (§102: generada al compilar, avisos a `errores_cliente`, 0 avisos en Local incluso forzada). Falta pasarla a obligatoria (`MODO = 'bloquear'` en `scripts/lib/csp.mjs`) tras vigilar Culqi y los medios R2 en prod.
8. ✅ Quitar el listado anónimo de buckets (hecho junto con el ítem 3). Pendiente: decidir si `fotos-clientes` debe ser privado (7.2).
9. ✅ SEO del portal: meta/OG, títulos por ruta, robots, sitemap, JSON-LD (19.1). *§103. Pendiente fuera del código: alta en Google Search Console y envío del sitemap.*
10. Contraste del texto secundario y tamaño mínimo de 12 px (8.1, 9.1).
11. Partir `Ventas.jsx` y `CarritoCliente.jsx` en hook de dominio + lógica pura + subcomponentes (1.1).
12. Tipos generados de Supabase + `checkJs` en `lib/` (4.1).
13. Turnstile en el Libro de Reclamaciones (16.1).

### 🟡 Medias
14. Corregir los 14 `exhaustive-deps` (3.1), empezando por Ventas y `SelectorProductoBuscable`.
15. Separar `index.css` por árbol y registrar los tokens en `@theme` (5.1, 14.1).
16. Fuentes a WOFF2 con subconjunto (6.1).
17. TanStack Query en el portal (17).
18. Capa `lib/repos/` para las consultas (1.2).
19. Privilegio mínimo en `clientes` para ASISTENTE/PERSONAL_APOYO (7.5), decisión de negocio.
20. Repo privado o `.codex/` fuera del repo; el lint debe ignorarlo (1.3).

### 🟢 Bajas
21. Eliminar las dependencias muertas y `ui/button.jsx` (6.3).
22. `alt` en 3 imágenes y revisar 16 `outline-none` (8.2, 8.3).
23. Imágenes AVIF y PNG optimizados (6.2).
24. Revocar los privilegios residuales de `anon` (7.4).
25. Separar los hooks de los contextos para Fast Refresh (3.2).
26. Pantalla de carga con marca, manifest neutro, Web Vitals de campo (11.1, 20.2, 5.2).
27. Comentarios-bitácora a changelog (2.1).

---

## Calificación final

| Área | Nota | Justificación breve |
|---|---:|---|
| Arquitectura | 78 | Árboles separados, carga diferida propia, contextos acotados; monolitos de página |
| Código | 66 | Legible y bien nombrado; archivos enormes y valores mágicos |
| React | 74 | Suspense, cancelación, StrictMode; 14 deps incompletas, exceso de `useState` |
| Tipado | 25 | JS puro sin PropTypes, JSDoc ni tipos de Supabase |
| Performance | 82 | Code splitting, shell PWA, hero priorizado; CSS monolítico |
| Optimización | 72 | WebP y variantes; TTF, JPEG, PNG pesados, dependencias muertas |
| Seguridad | 78 | RLS al 100 %, definer bien hecho; sin CSP ni anti-frame, Storage abierto, 1 RPC con fuga |
| Responsive | 72* | Bien en el código; sin verificación visual, textos de 9–11 px |
| Accesibilidad | 74 | Foco, teclado, ARIA y movimiento bien; contraste y tamaños fallan AA |
| UI | 76* | Sistema de componentes coherente y documentado; dispersión de tokens |
| UX | 80 | Toasts, esqueletos, descarte, offline, actualización segura |
| CSS | 62 | Tokens existentes pero eludidos; 4 155 líneas en un archivo |
| Animaciones | 82 | Patrón documentado y `reduced-motion` amplio |
| Testing | 40 | Suite rica pero sin script ni CI: no protege el despliegue |
| SEO | 20 | Sin description/OG/robots/sitemap/títulos por ruta |
| PWA / Observabilidad | 62 | PWA ≈ 92; observabilidad ≈ 15 |
| Escalabilidad | 70 | Base de datos y despliegue escalan; el código frontend no sin tipado y tests |
| Mantenibilidad | 64 | Documentación excelente pero voluminosa; monolitos y sin tipos |
| Preparación para producción | 72 | Funciona y es seguro en lo esencial; falta CI, monitoreo y cabeceras |

\* Estimado desde el código, sin verificación visual.

**Nota global ponderada: 66 / 100.**

Criterio de ponderación: para un POS que maneja dinero y datos personales, más un portal comercial, pesan doble **Seguridad, Preparación para producción, Mantenibilidad y Testing** (suman 508 de 8 pesos); ×1,5 **Arquitectura, Código, React, Accesibilidad y UX** (558 de 7,5); ×1 las otras 10 áreas (623 de 10). Total: 1 689 / 25,5 = **66,2**. La media simple sin pesos sería 65,7. Testing y SEO bajan la nota tanto como Seguridad la sube.

**Esfuerzo estimado para llegar a 90/100** (una persona con asistencia de IA):

| Bloque | Esfuerzo |
|---|---|
| Rápidos de seguridad (ítems 1–4) | 0,5 día |
| CI + scripts + Vitest en `lib/` (dinero) | 2–3 días |
| Observabilidad + CSP | 1,5 días |
| SEO del portal | 1–1,5 días |
| Contraste / escala tipográfica / tokens | 2–3 días |
| Tipos de Supabase + `checkJs` en `lib/` | 1–2 días |
| Partir Ventas, CarritoCliente, Citas y Historial | 5–8 días |
| CSS por árbol + TanStack Query en el portal | 3–4 días |
| **Total** | **≈ 3–4 semanas (2 sprints)** |

El orden recomendado es el del roadmap: los primeros 4–5 días (seguridad rápida, CI, observabilidad y SEO) llevan la nota de 66 a ~78 con poco riesgo. Partir los monolitos y tipar es lo que lleva de 80 a 90.
