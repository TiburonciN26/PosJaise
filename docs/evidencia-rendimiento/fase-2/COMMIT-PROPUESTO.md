# Commit propuesto (listado para revisión) — NO ejecutado

Generado por `scripts/listar-commit-propuesto.mjs` el 2026-10-09T20:22:57.748Z. **No se ha hecho add, commit ni push.** La elección final se hace sobre este listado, no sobre una aprobación genérica; no es `git add .` ciego.

Base: `HEAD` 0dc629e (rama `testing`). Entradas: **200** (101 modificadas, 98 nuevas, 1 eliminadas).

> **El repositorio es PÚBLICO** (verificado en GitHub): todo lo que se suba a cualquier rama, no solo `main`, es visible para cualquiera. Esta revisión es también una revisión de publicación.

> Efecto a tener en cuenta: el workflow `deploy-pages.yml` despliega GitHub Pages en **cada push a `main`**. Subir este código a `main` actualizaría la web actual aunque no se cambie el dominio. Por eso se propone una rama de preparación (p. ej. `feat/cloudflare-pages`) y fusionar a `main` solo con autorización.

## Resumen por categoría

| Categoría | Archivos |
|---|---|
| Otros | 1 |
| Otra documentación (docs/, guias/, *.md) | 6 |
| Cloudflare / hosting | 6 |
| Código de la app (src/) | 115 |
| Otros de Supabase (config/seed/sql) | 1 |
| Pruebas (tests/) | 6 |
| Carpeta de Codex (.codex/) | 9 |
| Evidencia de rendimiento (docs/evidencia-rendimiento) | 27 |
| Recursos públicos (public/) | 6 |
| Scripts (scripts/) | 15 |
| Edge Functions (supabase/functions) | 2 |
| Migraciones SQL (supabase/migrations) | 6 |

## Dependencias del commit
- `package.json` (líneas cambiadas): `+    "build:cloudflare": "node scripts/build-cloudflare.mjs",`, `+    "supabase": "^2.120.0",`
- `package-lock.json`: 1 file changed, 224 insertions(+); `npm ci --dry-run` coherente (verificado aparte).
- Las migraciones nuevas ya están aplicadas en staging (153) y, según las instrucciones del repo, deben probarse en Local antes de producción; este commit **no** aplica nada a producción.

## Exclusiones propuestas (no deberían entrar al commit)

- `.codex/AUDITORIA-RENDIMIENTO.md` — Carpeta de trabajo de Codex (informes de revisión): no es código del producto
- `.codex/FASES-RENDIMIENTO-CLOUDFLARE.md` — Carpeta de trabajo de Codex (informes de revisión): no es código del producto
- `.codex/PAGES-CREADO-PARA-CLAUDE.md` — Carpeta de trabajo de Codex (informes de revisión): no es código del producto
- `.codex/PAGES-PUBLICADO-PARA-CLAUDE.md` — Carpeta de trabajo de Codex (informes de revisión): no es código del producto
- `.codex/VERIFICACION-FASE-2B-V2.md` — Carpeta de trabajo de Codex (informes de revisión): no es código del producto
- `.codex/VERIFICACION-FASE-2B-V3-1.md` — Carpeta de trabajo de Codex (informes de revisión): no es código del producto
- `.codex/VERIFICACION-FASE-2B-V3.md` — Carpeta de trabajo de Codex (informes de revisión): no es código del producto
- `.codex/VERIFICACION-FORMAL-FASE-2.md` — Carpeta de trabajo de Codex (informes de revisión): no es código del producto
- `.codex/VERIFICACION-PREPARACION-FASE-2B.md` — Carpeta de trabajo de Codex (informes de revisión): no es código del producto
- `docs/evidencia-rendimiento/fase-1/capturas/antes-referidos-oscuro.png` — Capturas de evidencia (binarios): decidir si se versionan
- `docs/evidencia-rendimiento/fase-1/capturas/despues-referidos-claro.png` — Capturas de evidencia (binarios): decidir si se versionan
- `docs/evidencia-rendimiento/fase-1/capturas/despues-referidos-oscuro.png` — Capturas de evidencia (binarios): decidir si se versionan

Ya excluidos por `.gitignore` (no se versionan): `.agents/`, `.claude/`, `.env`, `.env.local`, `.env.movil`, `.env.staging.local`, `.pw-scratch/`, `.vscode/`, `.vscode/mcp.json`, `debug.log`, `dist-preview/`, `dist/`, `headerYServicios.html`, `skills-lock.json`, `src/assets/manual_programador (1).pdf`, `supabase/.branches/`, `supabase/.temp/`, `supabase/functions/.env`, `supabase/sql/RESET_DATOS_PARA_ENTREGA_CLIENTE.sql`, `tests/e2e/BASELINE-20260930.md`, `tests/e2e/CAMPANA-AMPLIADA.md`, `tests/e2e/RENDIMIENTO-20261001.md`, `tests/e2e/RESULTADOS.md`, `tests/e2e/artifacts-ensayo/`, `tests/e2e/artifacts/`, `tests/e2e/fixtures/ensayo-coherencia-runtime.json`, `tests/e2e/fixtures/ensayo-cupon-runtime.json`, `tests/e2e/fixtures/ensayo-lanzamiento-runtime.json`, `tests/e2e/fixtures/ensayo-runtime.json`, `tests/e2e/fixtures/runtime.json`, `tests/e2e/results-ensayo/`, `tests/e2e/results/`, `videos/`.

Archivos `.env*` rastreados por Git: `.env.example` (`.env.staging.local` y `.env.local` NO están rastreados). `.gitignore` no protege archivos ya rastreados.

## Revisión de secretos en el contenido de los candidatos

Patrones buscados en los 200 archivos candidatos (texto ≤5 MB; binarios no inspeccionados). Se reporta ubicación y tipo, nunca el valor.

**Sin hallazgos que requieran revisión** (solo claves anon públicas, si las hay).

**Coincidencias ya revisadas (2):**

- `implementacionesWed.md:5718` — correo no ficticio: Mención ya presente en HEAD/origin (git show HEAD:implementacionesWed.md la contiene): el commit no la introduce. Si el usuario quiere redactarla es una decisión aparte. Revisado 2026-10-09.
- `src/pages/Login.jsx:220` — correo no ficticio: Placeholder genérico de ejemplo («Ej. maria@…») del campo de correo; no es una cuenta real. Revisado 2026-10-09.

## Identificadores de infraestructura que quedarían públicos (el repo es PÚBLICO)

No son secretos, pero hay que saberlo antes de autorizar el push (excluye `.codex/**`, ya propuesto como exclusión). Este análisis no busca contraseñas: eso lo hace la sección de secretos de arriba.

- **repositorio de backups privado (nombre)** — 2 archivo(s): `.gitignore`, `scripts/listar-commit-propuesto.mjs`
- **ref del Supabase de staging** — 10 archivo(s): `implementacionesWed.md`, `docs/evidencia-rendimiento/fase-2/FASE-2B-PAGES-GIT.md`, `docs/evidencia-rendimiento/fase-2/README.md`, `docs/evidencia-rendimiento/fase-2/STAGING-SUPABASE.md`, `docs/evidencia-rendimiento/fase-2/control-negativo-hook-antiguo-atras.json`, `docs/evidencia-rendimiento/fase-2/preview-staging-online.json`, …
- **proyecto de Cloudflare Pages de QA** — 8 archivo(s): `implementacionesWed.md`, `docs/evidencia-rendimiento/fase-2/FASE-2B-PAGES-GIT.md`, `docs/evidencia-rendimiento/fase-2/README.md`, `docs/evidencia-rendimiento/fase-2/STAGING-SUPABASE.md`, `docs/evidencia-rendimiento/fase-2/preview-staging-online.json`, `scripts/build-preview-staging.mjs`, …
- **ref del Supabase del negocio (ya público en el bundle del sitio)** — 5 archivo(s): `docs/evidencia-rendimiento/fase-2/FASE-2B-PAGES-GIT.md`, `docs/evidencia-rendimiento/fase-2/STAGING-SUPABASE.md`, `scripts/aplicar-migraciones-staging.mjs`, `scripts/lib/entornos-supabase.mjs`, `scripts/listar-commit-propuesto.mjs`
- **correos QA ficticios (@staging.test)** — 2 archivo(s): `docs/evidencia-rendimiento/fase-2/STAGING-SUPABASE.md`, `scripts/probar-verificador-pwa.mjs`
- **ID de cuenta de Cloudflare** — 1 archivo(s): `scripts/listar-commit-propuesto.mjs`

### Binarios (5) — no inspeccionados
- `docs/evidencia-rendimiento/fase-1/capturas/antes-referidos-oscuro.png`
- `docs/evidencia-rendimiento/fase-1/capturas/despues-referidos-claro.png`
- `docs/evidencia-rendimiento/fase-1/capturas/despues-referidos-oscuro.png`
- `public/icons/plinColor.png`
- `src/assets/login/foto-login.jpeg`

## Listado completo

### Otros (1)

- ✏️ `.gitignore` — modificado

### Otra documentación (docs/, guias/, *.md) (6)

- ✏️ `AGENTS.md` — modificado
- ✏️ `implementacionesWed.md` — modificado
- 🆕 `docs/diseno-comprobantes/README.md` — nuevo (sin seguimiento)
- 🆕 `docs/web-publica/README.md` — nuevo (sin seguimiento)
- 🆕 `guias/pasarela-pago-culqi.md` — nuevo (sin seguimiento)
- 🆕 `guias/terminosYCondiciones.md` — nuevo (sin seguimiento)

### Cloudflare / hosting (6)

- ✏️ `index.html` — modificado
- ✏️ `package-lock.json` — modificado
- ✏️ `package.json` — modificado
- ✏️ `vite.config.js` — modificado
- 🆕 `.node-version` — nuevo (sin seguimiento)
- 🆕 `cloudflare/_headers` — nuevo (sin seguimiento)

### Código de la app (src/) (115)

- ✏️ `src/App.jsx` — modificado
- ✏️ `src/components/AvisoActualizacionPWA.jsx` — modificado
- ✏️ `src/components/AvisoNegocioCerrado.jsx` — modificado
- ✏️ `src/components/BarraBusqueda.jsx` — modificado
- ✏️ `src/components/BarraCatalogo.jsx` — modificado
- ✏️ `src/components/EnvolturaCupon.jsx` — modificado
- ✏️ `src/components/Etiqueta.jsx` — modificado
- ✏️ `src/components/FiltrosFecha.jsx` — modificado
- ✏️ `src/components/FondoNivel.jsx` — modificado
- ✏️ `src/components/Header.jsx` — modificado
- ✏️ `src/components/IconoCampana.jsx` — modificado
- ✏️ `src/components/MenuLateral.jsx` — modificado
- ✏️ `src/components/MenuLateralCliente.jsx` — modificado
- ✏️ `src/components/MenuUsuario.jsx` — modificado
- ✏️ `src/components/MenuUsuarioCliente.jsx` — modificado
- ✏️ `src/components/ModalAgregarStock.jsx` — modificado
- ✏️ `src/components/ModalAsistente.jsx` — modificado
- ✏️ `src/components/ModalBuscarAtencion.jsx` — modificado
- ✏️ `src/components/ModalBuscarCliente.jsx` — modificado
- ✏️ `src/components/ModalCita.jsx` — modificado
- ✏️ `src/components/ModalCliente.jsx` — modificado
- ✏️ `src/components/ModalCompraMobiliario.jsx` — modificado
- ✏️ `src/components/ModalDetalleProducto.jsx` — modificado
- ✏️ `src/components/ModalDeuda.jsx` — modificado
- ✏️ `src/components/ModalEscanerCodigoBarras.jsx` — modificado
- ✏️ `src/components/ModalGaleriaWeb.jsx` — modificado
- ✏️ `src/components/ModalGasto.jsx` — modificado
- ✏️ `src/components/ModalMobiliario.jsx` — modificado
- ✏️ `src/components/ModalPlantillasGasto.jsx` — modificado
- ✏️ `src/components/ModalProducto.jsx` — modificado
- ✏️ `src/components/ModalPromocion.jsx` — modificado
- ✏️ `src/components/ModalRegistroAtencion.jsx` — modificado
- ✏️ `src/components/ModalReprogramarCitaCliente.jsx` — modificado
- ✏️ `src/components/ModalServicio.jsx` — modificado
- ✏️ `src/components/PestanasCacheadas.jsx` — modificado
- ✏️ `src/components/SelectorOrden.jsx` — modificado
- ✏️ `src/components/SelectorProductoBuscable.jsx` — modificado
- ✏️ `src/components/SelectorServicioBuscable.jsx` — modificado
- ✏️ `src/components/SwitchTema.jsx` — modificado
- ✏️ `src/components/TarjetaCupon.jsx` — modificado
- ✏️ `src/components/TarjetaPuntos.jsx` — modificado
- ✏️ `src/config/navegacion.js` — modificado
- ✏️ `src/config/navegacionCliente.js` — modificado
- ✏️ `src/config/paginasCliente.js` — modificado
- ✏️ `src/context/CarritoClienteContext.jsx` — modificado
- ✏️ `src/context/CarritoContext.jsx` — modificado
- ✏️ `src/context/EstadoNegocioContext.jsx` — modificado
- ✏️ `src/context/NotificacionesClienteContext.jsx` — modificado
- ✏️ `src/context/PerfilClienteContext.jsx` — modificado
- ✏️ `src/hooks/useCerrarConEscape.js` — modificado
- ✏️ `src/index.css` — modificado
- ✏️ `src/lib/buscarAtenciones.js` — modificado
- ✏️ `src/pages/Asistentes.jsx` — modificado
- ✏️ `src/pages/Auditoria.jsx` — modificado
- ✏️ `src/pages/CatalogoWeb.jsx` — modificado
- ✏️ `src/pages/Citas.jsx` — modificado
- ✏️ `src/pages/Clientes.jsx` — modificado
- ✏️ `src/pages/ContactoWeb.jsx` — modificado
- ✏️ `src/pages/Dashboard.jsx` — modificado
- ✏️ `src/pages/Deudas.jsx` — modificado
- ✏️ `src/pages/Estadisticas.jsx` — modificado
- ✏️ `src/pages/FidelizacionWeb.jsx` — modificado
- ✏️ `src/pages/GaleriaWeb.jsx` — modificado
- ✏️ `src/pages/Gastos.jsx` — modificado
- ✏️ `src/pages/Historial.jsx` — modificado
- ✏️ `src/pages/Inventario.jsx` — modificado
- ✏️ `src/pages/Login.jsx` — modificado
- ✏️ `src/pages/MiPanel.jsx` — modificado
- ✏️ `src/pages/Mobiliario.jsx` — modificado
- ✏️ `src/pages/PedidosWeb.jsx` — modificado
- ✏️ `src/pages/Porcentajes.jsx` — modificado
- ✏️ `src/pages/PortalCliente.jsx` — modificado
- ✏️ `src/pages/Promociones.jsx` — modificado
- ✏️ `src/pages/PuntosWeb.jsx` — modificado
- ✏️ `src/pages/RecompensasWeb.jsx` — modificado
- ✏️ `src/pages/ReferidosWeb.jsx` — modificado
- ✏️ `src/pages/ResenasWeb.jsx` — modificado
- ✏️ `src/pages/Servicios.jsx` — modificado
- ✏️ `src/pages/Ventas.jsx` — modificado
- ✏️ `src/pages/Web.jsx` — modificado
- ✏️ `src/pages/cliente/CarritoCliente.jsx` — modificado
- ✏️ `src/pages/cliente/CarritoServiciosCliente.jsx` — modificado
- ✏️ `src/pages/cliente/DetalleProductoCliente.jsx` — modificado
- ✏️ `src/pages/cliente/DetalleServicioCliente.jsx` — modificado
- ✏️ `src/pages/cliente/InicioCliente.jsx` — modificado
- ✏️ `src/pages/cliente/PieClienteWeb.jsx` — modificado
- ✏️ `src/pages/cliente/ProductosCliente.jsx` — modificado
- ✏️ `src/pages/cliente/RecompensasCliente.jsx` — modificado
- 🗑️ `src/pages/cliente/RecompensasPublica.jsx` — eliminado
- ✏️ `src/pages/cliente/ServiciosCliente.jsx` — modificado
- 🆕 `src/assets/login/foto-login.jpeg` — nuevo (sin seguimiento)
- 🆕 `src/components/AccionesVisitante.jsx` — nuevo (sin seguimiento)
- 🆕 `src/components/AceptoTerminos.jsx` — nuevo (sin seguimiento)
- 🆕 `src/components/AyudaCampo.jsx` — nuevo (sin seguimiento)
- 🆕 `src/components/BotonVoz.jsx` — nuevo (sin seguimiento)
- 🆕 `src/components/ErrorCampo.jsx` — nuevo (sin seguimiento)
- 🆕 `src/components/GuiaPestana.jsx` — nuevo (sin seguimiento)
- 🆕 `src/components/IndicadorValidez.jsx` — nuevo (sin seguimiento)
- 🆕 `src/components/ModalDatosComprobante.jsx` — nuevo (sin seguimiento)
- 🆕 `src/components/ModalPagoDeuda.jsx` — nuevo (sin seguimiento)
- 🆕 `src/components/RutaPrivada.jsx` — nuevo (sin seguimiento)
- 🆕 `src/config/legal.js` — nuevo (sin seguimiento)
- 🆕 `src/hooks/useDatosNegocioLegal.js` — nuevo (sin seguimiento)
- 🆕 `src/hooks/useRequerirSesion.js` — nuevo (sin seguimiento)
- 🆕 `src/hooks/useSalir.js` — nuevo (sin seguimiento)
- 🆕 `src/lib/comprobante.js` — nuevo (sin seguimiento)
- 🆕 `src/lib/culqi.js` — nuevo (sin seguimiento)
- 🆕 `src/lib/destinoLogin.js` — nuevo (sin seguimiento)
- 🆕 `src/lib/trabajoPendiente.js` — nuevo (sin seguimiento)
- 🆕 `src/pages/LibroReclamacionesWeb.jsx` — nuevo (sin seguimiento)
- 🆕 `src/pages/cliente/DocumentoLegal.jsx` — nuevo (sin seguimiento)
- 🆕 `src/pages/cliente/LibroReclamacionesCliente.jsx` — nuevo (sin seguimiento)
- 🆕 `src/pages/cliente/PoliticaCambiosCliente.jsx` — nuevo (sin seguimiento)
- 🆕 `src/pages/cliente/PrivacidadCliente.jsx` — nuevo (sin seguimiento)
- 🆕 `src/pages/cliente/TerminosCliente.jsx` — nuevo (sin seguimiento)

### Otros de Supabase (config/seed/sql) (1)

- ✏️ `supabase/config.toml` — modificado

### Pruebas (tests/) (6)

- ✏️ `tests/e2e/auth-roles.spec.mjs` — modificado
- ✏️ `tests/e2e/expanded-access.spec.mjs` — modificado
- ✏️ `tests/e2e/helpers.mjs` — modificado
- ✏️ `tests/e2e/niveles-visuales-helpers.mjs` — modificado
- 🆕 `tests/e2e/destino-login.test.mjs` — nuevo (sin seguimiento)
- 🆕 `tests/e2e/web-publica-verificacion.mjs` — nuevo (sin seguimiento)

### Carpeta de Codex (.codex/) (9)

- 🆕 `.codex/AUDITORIA-RENDIMIENTO.md` — nuevo (sin seguimiento) **[EXCLUIR]**
- 🆕 `.codex/FASES-RENDIMIENTO-CLOUDFLARE.md` — nuevo (sin seguimiento) **[EXCLUIR]**
- 🆕 `.codex/PAGES-CREADO-PARA-CLAUDE.md` — nuevo (sin seguimiento) **[EXCLUIR]**
- 🆕 `.codex/PAGES-PUBLICADO-PARA-CLAUDE.md` — nuevo (sin seguimiento) **[EXCLUIR]**
- 🆕 `.codex/VERIFICACION-FASE-2B-V2.md` — nuevo (sin seguimiento) **[EXCLUIR]**
- 🆕 `.codex/VERIFICACION-FASE-2B-V3-1.md` — nuevo (sin seguimiento) **[EXCLUIR]**
- 🆕 `.codex/VERIFICACION-FASE-2B-V3.md` — nuevo (sin seguimiento) **[EXCLUIR]**
- 🆕 `.codex/VERIFICACION-FORMAL-FASE-2.md` — nuevo (sin seguimiento) **[EXCLUIR]**
- 🆕 `.codex/VERIFICACION-PREPARACION-FASE-2B.md` — nuevo (sin seguimiento) **[EXCLUIR]**

### Evidencia de rendimiento (docs/evidencia-rendimiento) (27)

- 🆕 `docs/evidencia-rendimiento/fase-1/README.md` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-1/antes-fuentes/EnvolturaCupon.jsx.antes` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-1/antes-fuentes/index.css.antes` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-1/antes.json` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-1/capturas/antes-referidos-oscuro.png` — nuevo (sin seguimiento) **[EXCLUIR]**
- 🆕 `docs/evidencia-rendimiento/fase-1/capturas/antes-verificacion.json` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-1/capturas/despues-referidos-claro.png` — nuevo (sin seguimiento) **[EXCLUIR]**
- 🆕 `docs/evidencia-rendimiento/fase-1/capturas/despues-referidos-oscuro.png` — nuevo (sin seguimiento) **[EXCLUIR]**
- 🆕 `docs/evidencia-rendimiento/fase-1/capturas/despues-verificacion.json` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-1/despues.json` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-1/tabla.md` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/COMMIT-PROPUESTO.md` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/FASE-2B-PAGES-GIT.md` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/README.md` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/STAGING-SUPABASE.md` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/clon-limpio.json` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/cloudflare.json` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/control-negativo-hook-antiguo-atras.json` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/github.json` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/preview-staging-online.json` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/preview-staging.json` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/rollback/fase1.patch` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/rollback/fase2-package-json.patch` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/rollback/fase2-tracked.patch` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/rollback/fase2b-proteccion-actualizar.patch` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/salvaguardas-entornos.json` — nuevo (sin seguimiento)
- 🆕 `docs/evidencia-rendimiento/fase-2/verificador-pwa-escenarios.json` — nuevo (sin seguimiento)

### Recursos públicos (public/) (6)

- 🆕 `public/diseñosPropios/Login.html` — nuevo (sin seguimiento)
- 🆕 `public/icons/InstagramColor.svg` — nuevo (sin seguimiento)
- 🆕 `public/icons/facebookColor.svg` — nuevo (sin seguimiento)
- 🆕 `public/icons/plinColor.png` — nuevo (sin seguimiento)
- 🆕 `public/icons/tiktokColor.svg` — nuevo (sin seguimiento)
- 🆕 `public/icons/whatsappColor.svg` — nuevo (sin seguimiento)

### Scripts (scripts/) (15)

- 🆕 `scripts/aplicar-migraciones-staging.mjs` — nuevo (sin seguimiento)
- 🆕 `scripts/build-cloudflare.mjs` — nuevo (sin seguimiento)
- 🆕 `scripts/build-preview-staging.mjs` — nuevo (sin seguimiento)
- 🆕 `scripts/lib/entornos-supabase.mjs` — nuevo (sin seguimiento)
- 🆕 `scripts/listar-commit-propuesto.mjs` — nuevo (sin seguimiento)
- 🆕 `scripts/medir-cupones-reposo.cjs` — nuevo (sin seguimiento)
- 🆕 `scripts/probar-clon-limpio.mjs` — nuevo (sin seguimiento)
- 🆕 `scripts/probar-salvaguardas-entornos.mjs` — nuevo (sin seguimiento)
- 🆕 `scripts/probar-verificador-pwa.mjs` — nuevo (sin seguimiento)
- 🆕 `scripts/servir-dist-base.cjs` — nuevo (sin seguimiento)
- 🆕 `scripts/verificar-actualizacion-pwa-online.cjs` — nuevo (sin seguimiento)
- 🆕 `scripts/verificar-actualizacion-pwa.cjs` — nuevo (sin seguimiento)
- 🆕 `scripts/verificar-cupones-fase1.cjs` — nuevo (sin seguimiento)
- 🆕 `scripts/verificar-pages-fase2.cjs` — nuevo (sin seguimiento)
- 🆕 `scripts/verificar-preview-staging.cjs` — nuevo (sin seguimiento)

### Edge Functions (supabase/functions) (2)

- 🆕 `supabase/functions/crear-cargo/index.ts` — nuevo (sin seguimiento)
- 🆕 `supabase/functions/webhook-pasarela/index.ts` — nuevo (sin seguimiento)

### Migraciones SQL (supabase/migrations) (6)

- 🆕 `supabase/migrations/20261009000001_web_publica_visitantes.sql` — nuevo (sin seguimiento)
- 🆕 `supabase/migrations/20261009000002_pasarela_tarjeta.sql` — nuevo (sin seguimiento)
- 🆕 `supabase/migrations/20261009000003_confirmar_pago_pasarela.sql` — nuevo (sin seguimiento)
- 🆕 `supabase/migrations/20261009000004_libro_reclamaciones.sql` — nuevo (sin seguimiento)
- 🆕 `supabase/migrations/20261009000005_confirmar_pedido_tarjeta.sql` — nuevo (sin seguimiento)
- 🆕 `supabase/migrations/20261010000001_deuda_pagos.sql` — nuevo (sin seguimiento)
