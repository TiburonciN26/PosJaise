# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Pos Jaise Beauty Academy" — a POS + booking + client web portal for a
hair/beauty salon. React 19 + Vite + Tailwind v4 (CSS-first, no config
file — tokens/utilities live in `src/index.css` + `src/styles/`) + Supabase (Postgres,
Auth, Storage, Realtime) + react-router-dom v7. Tests use the built-in
`node --test` runner (plus Playwright for the local QA suite) — there's
no Jest/Vitest; don't add one unless asked. Two layers, see
`tests/e2e/README.md`: `npm test` runs only the **self-contained**
tests (pure logic + SSR-rendered components, no DB/browser/passwords),
listed explicitly in `scripts/probar-unitarios.mjs`; everything else
in `tests/e2e/` needs the `testing` branch + Supabase Local and fails
on purpose elsewhere. A new self-contained test must be added to that
list or it never runs.

## Commands

```bash
npm run dev       # Vite dev server (this is how the app is actually tested — see below)
npm run build     # production build (vite build) — run this after any change to confirm no compile errors
npm run lint      # oxlint
npm test          # self-contained node --test suite (~10 s) — run after touching src/lib, cupones, navegación or TarjetaCupon
npm run verificar # lint + test + build:cloudflare (build-cloudflare.mjs --verificar) — the same gate Cloudflare runs; run before pushing
npm run preview   # serve the production build locally
```

**Deploys are gated**: on Cloudflare (`CF_PAGES`), `scripts/build-cloudflare.mjs`
runs oxlint + `npm test` *before* building and aborts if either fails — so a
broken self-contained test means nothing gets published (the previous
version stays live). Escape hatch for an urgent fix: `SALTAR_VERIFICACION=1`
in Pages' env vars, removed right after. A failing test after an
intentional UI/behavior change means the *test* must be updated in the
same commit. CI (`.github/workflows/verificar.yml`, no secrets) runs the
same `npm run verificar` on every push/PR for a visible ✓/✗. There's no deployed
environment the user tests against day to day — they test exclusively
via `npm run dev` locally. Production
is **Cloudflare Pages**: every push to `main` auto-deploys with
`npm run build:cloudflare` (`scripts/build-cloudflare.mjs`), which
fails the deploy if the built `index.html` mentions `/PosJaise/`, if a
`404.html` ends up in the output, or if privileged keys leak. Run that
script locally before pushing anything that touches `index.html`,
`vite.config.js` or `public/`. GitHub Pages was retired (2026-11-18):
no workflow publishes there anymore. Never push front-end code that
depends on a migration that isn't applied in production yet.

**This session's environment has no browser automation tool** (no
Playwright/chromium-cli configured). After changing UI, run `npm run
build` to catch compile errors, review the diff carefully, and tell the
user you couldn't visually verify it — ask them to check `npm run dev`
themselves rather than claiming it "works" from a build pass alone.

## Big-picture architecture

### Two completely separate app trees, chosen once in `App.jsx`

`App.jsx` picks between two entirely different route trees based on
role, via `vistaCliente = rol === 'CLIENTE' || (personal en "modo
cliente")`:

- **Staff/POS** (`rol` is admin/cajera/asistente, not viewing as
  client): `<Layout>` + `<PestanasCacheadas>`. `PestanasCacheadas.jsx`
  keeps every POS tab mounted simultaneously and toggles
  `display:none`/`contents` to switch between them — so a POS tab's
  `useEffect(() => { load() }, [])` really does run only once per
  *session*, not once per visit.
- **Client web portal** (`rol === 'CLIENTE'`, or staff who switched to
  "Mi perfil de clienta" — same session, `modoVista` state in
  `AuthContext`): `<PortalCliente>` + plain `react-router-dom` routes
  (`servicios`, `servicios/:id`, `productos`, `citas`, `carrito`, …).
  **These are NOT cached** — navigating from `/servicios` to
  `/servicios/:id` and back genuinely unmounts and remounts
  `ServiciosCliente`. Don't assume `PestanasCacheadas` semantics apply
  to client routes; they don't. This matters for anything that should
  "run once per mount" (e.g. entrance animations) — a fresh mount is a
  legitimate replay trigger there, not a bug.

Staff viewing "as a client" keeps their real `rol` (never actually
becomes a `CLIENTE`) — `MenuUsuarioCliente.jsx` gives them a way back.

### Client web portal visual system

Everything under the client portal lives inside a single `.landing-web`
wrapper class (`PortalCliente.jsx`), which is where the CSS custom
properties `--lw-gold`, `--lw-rose`, `--lw-metal-azul` are declared
(`src/styles/08-portal-base.css`, `13-portal-titulos-y-cta.css`). Anything that needs those vars — including anything
rendered via `createPortal` — must be inserted as a *descendant* of the
`.landing-web` node, not `document.body`.

**Real CSS gotcha hit in this repo**: `position: fixed` descendants
*are* clipped by an ancestor with `overflow: hidden`, even though their
containing block is the viewport. `PortalCliente.jsx`'s `<main>` has
`overflow-hidden`, so any fixed floating UI rendered inside a client
page (e.g. `BarraTuCitaFlotante.jsx`) must be portaled out — see that
component for the pattern (`document.querySelector('.landing-web')` as
the portal target, not `document.body`).

**Real React gotcha hit in this repo**: switching an element's tag name
based on state (e.g. `h1` when active, `p` when not) makes React
unmount/remount the DOM node on every toggle, which kills any CSS
`transition` running on it (no continuous element to interpolate from —
it jumps instead of animating). Keep the tag stable; vary only
className/style.

`src/index.css` is only the list of `@import`s: Tailwind/shadcn/fonts, then
the hand-written CSS split by topic into `src/styles/01-…css` … `21-…css`
(2026-11-20, byte-identical build output). **The numeric order IS the
cascade order** — put a new rule in the part it belongs to; if it must
beat a rule from another part, it goes in a later part. Custom rules stay
unlayered; shadcn's `@layer base` lives in `20-shadcn-base.css`. Font
`url()`s in `12-fuentes.css` are relative to `src/styles/` (`../assets/…`).

Reusable UI patterns for this portal, factored out so they don't get
re-derived per tab:
- `src/hooks/useEntornoAnimacion.js` + `src/hooks/useRevelarEnPantalla.js`
  + `docs/patrones/animacion-entrada.md` — the "page assembles itself"
  entrance-animation pattern, standard for every client-web tab. Read
  the pattern doc before reimplementing this for a new tab.
- `.iri-*` classes in `src/styles/07-portal-catalogo-iridiscente.css` — the iridescent 3D-tilt card, used by
  `ProductosCliente.jsx` (superseded by the flat card
  `TarjetaServicioCliente.jsx` for Servicios — don't mix the two
  styles).

### Supabase conventions (the sharp edges)

- Migrations live in `supabase/migrations/YYYYMMDDHHMMSS_description.sql`
  (Supabase CLI convention), each wrapped in `begin; ... commit;`,
  documenting *why*, not just *what*, in comments — keep that up when
  adding one. **This folder is the source of truth as of migration 128.**
  `supabase/sql/NNN_description.sql` is the historical/legacy record of
  migrations 001–127, from before the local QA environment existed —
  frozen, readable for context, never appended to. Don't create new files
  there and don't duplicate a new migration into both folders.
- Creating a new migration: run `supabase migration new <description>`
  (or hand-name the file with the same `YYYYMMDDHHMMSS_` pattern)
  directly inside `supabase/migrations/`. That file is what gets applied
  to both environments — never draft it in `sql/` first.
- QA loop before touching production: apply the migration to the local
  Supabase test project with `supabase migration up` (applies only what's
  pending, keeps whatever test data is already loaded in local Studio).
  If a migration fails or local state gets messy, `supabase db reset`
  rebuilds everything from scratch (all migrations + `seed.sql`) as a
  reproducibility check, not a routine step. Verify with `npm run dev`
  pointed at the local instance before moving on.
  **If the migration fails locally, or any related local verification
  fails, it must NOT be applied to production via MCP** until the
  problem is fixed and the migration passes cleanly in local — never use
  prod as the place to debug a migration that hasn't proven out locally.
- Applying to production: passing locally is necessary but never
  sufficient — it does NOT auto-authorize applying to prod. Once verified
  locally, always ask the user for explicit confirmation before using MCP
  to apply that migration to production; don't treat a prior approval
  (of this or any other migration) as blanket authorization. **When the
  user's message itself says to commit/push and upload the migration(s)
  ("has el commit, push y sube la migración"), that IS the confirmation**:
  apply the pending ones via MCP, register their file version, then
  commit and push — without asking again or re-auditing the whole schema. Only after
  that confirmation, apply the *same* SQL to prod via the Supabase MCP
  tools (`apply_migration` / `execute_sql` / `list_projects`, project
  `WedJaiseReact`). The MCP talks directly to the remote project and
  doesn't read local files — paste the exact SQL from the `migrations/`
  file so the repo and what's applied to prod never drift apart. If the
  MCP is disconnected, still write the file to `migrations/` (never to
  `sql/`) and tell the user to run it manually (SQL Editor in prod, or
  `migration up` locally).
- The local project isn't linked (`supabase link`) to the remote one —
  `db push`/`db pull` aren't part of the flow today.
- **Local and prod were synchronized on 2026-11-20** (schema, function
  bodies, permissions, cron, and both migration histories list exactly the
  repo's files). Keep it that way:
  - *Pending in prod* = repo files whose version isn't in prod's
    `supabase_migrations.schema_migrations`. MCP `apply_migration` records
    the migration under the *current timestamp*, not the file's — so right
    after applying, `insert into supabase_migrations.schema_migrations
    (version, name) values ('<file version>', '<file name>') on conflict do
    nothing`. Prod also keeps 63 legacy rows with old numbering (pre-repo);
    they're harmless.
  - Never apply an experimental branch's migrations to the local DB and
    then abandon the branch (that's how `wip/comprobantes` left
    `clientes.ruc` etc. only in Local and broke the client profile in
    prod). If you do, revert them in Local before switching back.
  - Local now has prod's permission defaults (no automatic grants to
    `anon`/`authenticated`), so a missing GRANT fails in Local too. After
    `supabase db reset`, run `supabase/scripts/permisos_produccion.sql`.
  - To audit parity, run `supabase/scripts/huella_esquema.sql` in both
    (Local via `docker exec -i supabase_db_WedJaiseReact psql -U postgres
    -d postgres -t -A -q < file`, prod via MCP `execute_sql`): the one-line
    output must be identical.
  - The prod MCP tool blocks `DELETE` statements; DDL via
    `apply_migration` and `INSERT` via `execute_sql` go through.
  - To reproduce a bug the client reports in prod, copy prod's DATA into
    Local (prod is only read): the user runs
    `powershell -ExecutionPolicy Bypass -File scripts\copiar-datos-prod-a-local.ps1`
    in their own terminal (it asks for the Session pooler string and the DB
    password — never ask for them in chat). It backs up Local's data to
    `%TEMP%` first; `-DesdeRespaldo <folder>` restores that backup. Storage
    files (photos, PDFs) aren't copied.
- **RLS and GRANTs are two separate, independently-enforced gates.**
  RLS row-filtering returns HTTP 200 with fewer/no rows. A missing
  column/table GRANT returns HTTP 403 for the *entire* request —
  including any embedded/joined resource in that same PostgREST call —
  which looks like "nothing loads" and is easy to misdiagnose as an RLS
  problem. Always check both `pg_policies` and
  `information_schema.column_privileges` when a query mysteriously
  returns nothing or fails outright.
- Most tables grant `SELECT/INSERT/UPDATE(/DELETE)` to `authenticated`
  at the **table level**, so `ALTER TABLE ... ADD COLUMN` automatically
  inherits those. **`productos` is a deliberate exception**: it grants
  `SELECT` per-column (to hide `costo` from non-admins, exposed only via
  the security-definer `productos_vista`), while `INSERT/UPDATE/
  REFERENCES` stay table-wide. Adding a column to `productos` needs an
  explicit `grant select (col) on productos to authenticated` or it
  will 403 the first query that requests it. Check
  `information_schema.column_privileges` for the target table before
  assuming a plain `ADD COLUMN` is enough. **`clientes` follows the same
  pattern** (2026-11-20, migration `20261120000004`): `authenticated` can't
  SELECT `dni`, `direccion` or `notas`; the admin reads the full record via
  the `clientes_admin` view (owner-rights, `where es_admin()`). So: a new
  `clientes` column needs its own column grant (or to be added to the view),
  never `.select()`/`select('*')` on `clientes` (403, even for the admin —
  name the columns), and admin screens that need those three fields read
  `clientes_admin`.
- `fotos-clientes` is a **private** bucket: show client photos with
  `useUrlFotoCliente(ruta)` (`src/hooks/useUrlFotoCliente.js`, signed URL,
  shared cache), never `urlPublicaFoto('fotos-clientes', …)`. Readable by the
  client herself (own folder) and the admin.
- The Libro de Reclamaciones is written ONLY through the Edge Function
  `registrar-reclamo` (Cloudflare Turnstile verified server-side, then
  `registrar_reclamo_verificado()` as service_role); anon/authenticated
  can't call the RPCs. Needs `VITE_TURNSTILE_SITE_KEY` (Pages env — the
  production build fails without it) and the `TURNSTILE_SECRET_KEY` Supabase
  secret. Local uses Cloudflare's public test keys (`.env.local`,
  `supabase/functions/.env`); run `supabase functions serve` to test it.
- Primary keys on business tables (`servicios`, `productos`, `citas`,
  …) are `uuid` (`gen_random_uuid()`), not sequential integers. Don't
  write code that does arithmetic on `.id` (sorting by "recency",
  hashing) assuming it's a number — it silently produces `NaN`/garbage.
- Cross-client aggregates (counts/averages over *all* clients' data,
  which RLS would otherwise restrict to the caller's own rows) go
  through a `security definer` SQL function — `set search_path =
  public, pg_temp`, `grant execute ... to authenticated`, `revoke
  execute ... from public`. Examples: `resenas_publicas()`,
  `servicios_mas_pedidos()`, `servicios_combo_sugerido()`,
  `resenas_servicio_*()`, `mis_puntos()`, `datos_contacto()`,
  `horario_atencion()`. Any write that needs server-side validation the
  client can't self-report (e.g. "you may only review a service you
  actually had done") also goes through one of these instead of a raw
  table insert policy — see `guardar_mi_resena_servicio()`.
- Photo uploads follow one pattern everywhere (`lib/imagenes.js`):
  process/resize into a local blob on selection, upload only on Save,
  delete the *old* file only after the DB write for the new one
  succeeds (avoids orphaned files if the user cancels or a later step
  fails).

### UI conventions (repo-wide, not just client portal)

- Confirmations: the global `useToast()` (fixed banner, fades), never a
  layout-shifting inline banner.
- SEO: every public client page calls `useMetaPagina({ titulo, descripcion })`
  (`src/hooks/useMetaPagina.js`) — don't render `<title>`/`<meta>` with React 19
  (index.html already has them; you'd get two titles). A NEW public route must
  also be added to `RUTAS_PUBLICAS` in `scripts/lib/seo.mjs` (sitemap); POS
  screens are blocked in robots.txt automatically from `navegacion.js`. SEO
  copy only states facts from the DB/catalog or confirmed by the business (no
  courses). Location, confirmed 2026-11-20: Av. Argentina H-12, **Nuevo
  Chimbote** (Áncash, PE) — the city isn't in the DB, it lives in
  `UBICACION_NEGOCIO` (`src/lib/datosEstructurados.js`) and in index.html's
  SEO copy; change both if the salon moves.
  `public/google31688c444909e427.html` is the Google Search Console
  ownership verification (property `https://pos-jaise.pages.dev/`) — never
  delete or rename it, or Google drops the verification.
- CSP is generated at build time by `scripts/lib/csp.mjs` (env origins +
  SHA-256 of index.html's inline scripts, CRLF-normalized) and appended to
  `dist/_headers` — never hand-write one in `cloudflare/_headers` (the build
  fails). Currently Report-Only; violations land in `errores_cliente` with
  origen `csp`. A new external origin (script, iframe, API, image host) must be
  added in `csp.mjs`; no inline `<script>` in HTML written at runtime
  (`window.open` + `document.write` inherits the CSP — print from the opener).
- Production errors go to `public.errores_cliente` (admin-only, read it
  in Studio) via `src/lib/reportarError.js`: render/boundary errors, window
  errors and unhandled rejections are captured automatically (wired in
  `main.jsx`). Only call `reportarError(error, { origen: 'manual' })` for
  an error you *catch and swallow* that someone should still see — never
  pass form/cart/sale data in it. Disabled in `npm run dev` unless
  `VITE_REPORTAR_ERRORES_DEV=1`.
- Every modal closes on Esc via `useCerrarConEscape()` (it manages a
  shared stack so only the top-most modal responds).
- Required form fields: label + red `*`, via `<Etiqueta obligatorio>`.
- Dropdown/accordion carets: `<IconoFlechaDesplegable />`
  (`src/components/IconoFlechaDesplegable.jsx`, the filled chevron from
  `public/icons/nuevaFlecha.svg`), 12×12 (`h-3 w-3`), rotated with
  `rotate-180` + `transition-transform`. Not lucide's `ArrowBigDown` (replaced
  everywhere on 2026-11-20) nor `ChevronDown`.
- `#3ECF6A` green is reserved for a handful of final commit-style CTAs
  (e.g. confirm an order) — not a general-purpose accent.

### Documentation trail in this repo

- `implementacionesWed.md` — the running, dated changelog of what's
  been built and why. Add a new numbered section for substantial work;
  it's the first place to look for "why does this code do that" before
  asking the user.
- `docs/diseno-<feature>/` — approved design specs per feature
  (`README.md` is the real spec; the `.dc.html` files are a design
  tool's export format — structure/style/behavior *reference*, never
  paste them into React as-is).
- `docs/patrones/` — cross-feature implementation patterns meant to be
  reused verbatim (not re-derived) the next time a similar tab needs
  the same behavior.
