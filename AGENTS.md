# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

"Pos Jaise Beauty Academy" — a POS + booking + client web portal for a
hair/beauty salon. React 19 + Vite + Tailwind v4 (CSS-first, no config
file — tokens/utilities live in `src/index.css`) + Supabase (Postgres,
Auth, Storage, Realtime) + react-router-dom v7. No test runner is set
up (no `test` script, no test framework installed) — don't invent one
unless asked.

## Commands

```bash
npm run dev       # Vite dev server (this is how the app is actually tested — see below)
npm run build     # production build (vite build) — run this after any change to confirm no compile errors
npm run lint      # oxlint
npm run preview   # serve the production build locally
```

There is no CI and no deployed environment the user tests against day
to day — they test exclusively via `npm run dev` locally. A GitHub
Actions workflow for GitHub Pages exists but isn't the feedback loop
to rely on.

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
properties `--lw-gold`, `--lw-rose`, `--lw-metal-azul` are declared in
`index.css`. Anything that needs those vars — including anything
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

`src/index.css` has a large hand-written section (design tokens,
`.landing-web` utilities, animation keyframes) followed by a
`/* ---break--- */` marker and then the shadcn/Tailwind `@layer base`
block appended by `shadcn init`. Add new custom CSS **above** that
marker, not after.

Reusable UI patterns for this portal, factored out so they don't get
re-derived per tab:
- `src/hooks/useEntornoAnimacion.js` + `src/hooks/useRevelarEnPantalla.js`
  + `docs/patrones/animacion-entrada.md` — the "page assembles itself"
  entrance-animation pattern, standard for every client-web tab. Read
  the pattern doc before reimplementing this for a new tab.
- `.iri-*` classes in `index.css` — the iridescent 3D-tilt card, used by
  `ProductosCliente.jsx` (superseded by the flat card
  `TarjetaServicioCliente.jsx` for Servicios — don't mix the two
  styles).

### Supabase conventions (the sharp edges)

- Migrations live in `supabase/sql/NNN_description.sql`, numbered
  sequentially, each wrapped in `begin; ... commit;`. They document
  *why*, not just *what*, in comments — keep that up when adding one.
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
  assuming a plain `ADD COLUMN` is enough.
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
- Applying migrations: the Supabase MCP tools
  (`mcp__claude_ai_Supabase__apply_migration` / `execute_sql` /
  `list_projects`) are the normal path when connected — the project is
  `WedJaiseReact` (list projects to get the current id, it has changed
  connection state mid-session before). If that MCP server is
  disconnected, still write the numbered `.sql` file and tell the user
  to run it in the Supabase SQL Editor; don't skip writing it.
- Photo uploads follow one pattern everywhere (`lib/imagenes.js`):
  process/resize into a local blob on selection, upload only on Save,
  delete the *old* file only after the DB write for the new one
  succeeds (avoids orphaned files if the user cancels or a later step
  fails).

### UI conventions (repo-wide, not just client portal)

- Confirmations: the global `useToast()` (fixed banner, fades), never a
  layout-shifting inline banner.
- Every modal closes on Esc via `useCerrarConEscape()` (it manages a
  shared stack so only the top-most modal responds).
- Required form fields: label + red `*`, via `<Etiqueta obligatorio>`.
- Dropdown/accordion carets: `ArrowBigDown` from lucide, rotated with
  `rotate-180`, not `ChevronDown`.
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
