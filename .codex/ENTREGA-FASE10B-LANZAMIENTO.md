# Entrega 10B · lanzamiento a producción ejecutado

Fecha: 2026-10-13, America/Lima. Autorización: el usuario pidió expresamente que Claude ejecutara el lanzamiento («hazlo tú», «haz lo que mejor creas»). El lote no pasó por una revisión previa de Codex: esta entrega es para la revisión posterior.

## 1. Migraciones (21:03 UTC)

**Aplicador:** `aplicar-lote-10b.ps1` de `9c83f23`, sin modificar.
- Host: Session pooler `aws-1-us-west-2`.
- Contraseña: tomada de `.env.produccion.local`, ignorado por Git, sin mostrarse.
- Confirmación: `-LeerTexto` devolvió `APLICAR` solo a la pregunta de confirmación.

**Ensayo previo (21:02):** con la confirmación `ENSAYO-NO-APLICAR` validó lo siguiente y se detuvo sin aplicar nada:
- SHA-256 de los 12 archivos;
- respaldo `corrida_20261013T201324Z`;
- las 23 versiones previas;
- 82 migraciones, que coinciden con el respaldo, y su última venta;
- plan de 11 transacciones.

**Aplicación:** 11/11 transacciones OK. La 06 es el par `20261010000001` + `20261013000001`.
- `Comprobar-Final`: 35 versiones, 2 triggers y 0 incoherentes.

**Inventario posterior:** [inventario-produccion-despues.txt](evidencia-fase10b/inventario-produccion-despues.txt), COMPLETO, `solo_lectura|on`.
- 94 migraciones; todos los objetos y funciones nuevos; triggers `deudas_compat_antes` y `deudas_compat_despues`.
- `deuda_pagos` = 1; `deudas_incoherentes` = 0; `cobradas_sin_pagos` = 0.
- `recompensas_activo` = false.
- Conteos de negocio idénticos a los previos: 270 productos, 33 servicios, 70 clientes, 130 ventas, 50 citas, 2 pedidos, 6 usuarios, 3 asistentes y 4 de galería.

## 2. Frontend

**`main`:** fast-forward de `0dc629e` a `9c83f23` (34 commits). Revisión de secretos sobre el diff: solo hay menciones en la documentación.
- GitHub Pages no se ejecutó, porque el workflow ya es solo manual. github.io conserva el `index.html` con SHA-256 `9ade57fe755dc95b…`.

**Variables de Production de Pages (API):**
- `VITE_SUPABASE_URL` del negocio;
- `VITE_SUPABASE_ANON_KEY` (secret_text), validada antes de enviarla: es publishable o anon y del ref del negocio;
- `RAMA_PRODUCCION=main`;
- sin `VITE_CULQI_*`, sin `VITE_MEDIOS_*` y sin binding R2.

**Despliegues:**
- El push a `main` creó el despliegue `c5549be9` (github:push), que quedó en cola sin construirse porque `production_deployments_enabled=false`. Es inofensivo.
- Despliegue manual por la API: **`dbd856ee-eb89-430b-831f-0d2eac8a5be8`**, commit `9c83f23`. Registro del build: `entorno=produccion rama=main backend=negocio clave=publishable` y `build-cloudflare: OK`. Es el canónico de `pos-jaise.pages.dev`.

**Contenido publicado:**
- `index.html` con SHA-256 `edeb6f7c4eb1a1e1…` y bundle `assets/index-BqbEu1Zg.js`.
- En los 29 chunks del precache: ref del negocio presente, ref de staging 0, `pk_test`/`pk_live` 0, `sb_secret_` 0, `127.0.0.1:54321` 0 y URL de medios R2 0.

**Prueba de humo anónima (Playwright, sin sesión ni escrituras):**
- `/`, `/productos` y `/servicios` con contenido;
- hosts: solo el Supabase del negocio y Google Fonts;
- 0 respuestas de Supabase ≥ 400 y 0 errores de consola.

## 3. Supabase Auth (Management API)

Estado previo: `site_url = http://localhost:3000` (valor por defecto) y `uri_allow_list` vacía. `signUp` no pasa `emailRedirectTo`, así que los correos de confirmación ya enlazaban a localhost antes del lanzamiento.

Ahora:
- `site_url = https://pos-jaise.pages.dev`;
- `uri_allow_list = https://pos-jaise.pages.dev/**,https://tiburoncin26.github.io/PosJaise/**`, este último durante la transición.

## 4. No verificado o pendiente

- No se probó el login ni ninguna operación con sesión en producción: no hay cuentas QA en producción y no se crearon datos. Lo verifica el usuario con su cuenta.
- Culqi queda deshabilitado: sin llave, la tarjeta no se ofrece.
- No se borró nada: GitHub Pages, los originales de Storage y los recursos siguen igual.
- El recolector destructivo sigue sin automatizar.
- La lista posterior al lanzamiento sigue la de la entrega V1, §5, con los 18 presupuestos de rendimiento sin cumplir y sin excepción permanente.
- Seguridad: el usuario debe borrar `.env.produccion.local` y revocar el token de Supabase usado.
