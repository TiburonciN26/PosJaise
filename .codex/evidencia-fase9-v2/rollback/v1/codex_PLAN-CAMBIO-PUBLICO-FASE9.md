# Plan del cambio público · Fase 9

Fecha: 2026-10-12. **Solo plan: no se cambió hosting, DNS, Auth, GitHub Pages ni ningún recurso remoto.** El dominio propio sigue siendo futuro (decisión vigente del usuario). GitHub Pages sigue disponible hasta que se apruebe el cambio. La ejecución corresponde a la Fase 10 (10A aprobación y 10B publicación), con autorización explícita de cada paso.

## 0. Hechos comprobados en el código

| Tema | Estado |
| --- | --- |
| Frontend publicado hoy | GitHub Pages en `https://<usuario>.github.io/PosJaise/`, construido desde `main` (`deploy-pages.yml`, secretos `VITE_SUPABASE_*`). `main` **no tiene** el código de la Fase 3 que lee R2 (`lib/medios.js`). |
| Rutas | `BrowserRouter basename={BASE_URL}`. En GitHub Pages las rutas profundas dependen del truco `public/404.html`. En Cloudflare Pages (`VITE_BASE_PATH=/`) se usa el fallback de SPA sin 404.html. |
| Enlaces que dependen del origen | Ninguno compartible: «compartir» producto/servicio envía texto por WhatsApp (sin URL), los referidos funcionan por **código** y no hay QR generados por la app. Los `wa.me` no dependen del dominio. |
| Auth | Sin `redirectTo`, sin OAuth ni recuperación de contraseña en el código. `signUp` usa la **Site URL** del proyecto para el correo de confirmación (si está activa). |
| Sesión | Supabase guarda la sesión en `localStorage`, que es **por origen**. |
| Carritos | El de la clienta vive en la base (`carrito_servicios`, `carrito_productos`) y sobrevive al cambio. La venta del POS vive en memoria. |
| PWA | Manifest con `scope`/`start_url` = base. El SW y su caché son por origen. `registerType: 'prompt'` con aviso protegido por trabajo pendiente (Fase 8). |
| Canonical / sitemap / robots | **No existen** (ni en `index.html` ni en `public/`). |
| Medios | La Function `/medios` se sirve en el **mismo origen** que la app en Cloudflare Pages: la base pública de medios será `https://<dominio final>/medios`. |

## 1. Orden recomendado (encadena con la migración de medios)

1. **10A:** QA completa del build de Cloudflare Pages contra el negocio, en solo lectura y con lo autorizado (Fase 10).
2. **Infraestructura de medios de producción** (bucket, Worker y Function con B) y copia a R2 de los medios existentes (Fase 9, pasos 3–5 del diseño). Sin cambiar referencias.
3. **10B, publicación:** dominio final y frontend nuevo; GitHub Pages pasa a ser página de redirección (§3).
4. **Observación** (periodo a acordar). Solo entonces se **actualizan las referencias** de medios (puerta 0 del diseño). Antes, cualquier bundle viejo (GitHub Pages o una PWA desactualizada) rompería las fotos migradas.
5. Al cerrar el periodo de reversión, y si el usuario lo decide: retirar GitHub Pages y limpiar originales/huérfanos con retención.

**Decisión pendiente del usuario:** publicar sobre `*.pages.dev` mientras no haya dominio propio, o esperar al dominio. Publicar antes implica **dos** cambios de origen (pages.dev y luego el dominio): dos inicios de sesión, dos instalaciones de la PWA y la base de medios de galería en transición. Recomendación: un solo cambio público, con el dominio definitivo.

## 2. Dominio, DNS y TLS (cuando exista el dominio)

- **Subdominio** (p. ej. `app.<dominio>`): `CNAME` al proyecto de Pages y alta como dominio personalizado en Pages. **Apex**: requiere que la zona esté en Cloudflare. TLS lo emite Cloudflare automáticamente; comprobar registros CAA si existen.
- Verificar: certificado válido, redirección http → https, rutas profundas (`/productos/<id>`, `/ventas`), `sw.js`/`manifest` con `no-cache` (ya en `cloudflare/_headers`), `/medios/*` solo por la Function (`_routes.json`).
- Añadir el nuevo origen a `ORIGENES_PERMITIDOS` del Worker de medios de producción.
- HSTS: no activarlo hasta comprobar todos los subdominios de la zona.

## 3. URLs antiguas `/PosJaise/` en github.io

Límites: `github.io` es de GitHub. No hay control de DNS ni de cabeceras, ni redirecciones HTTP 301 del lado del servidor. Solo se puede publicar contenido estático.

Propuesta: un **build de redirección** para GitHub Pages, publicado por el mismo workflow solo cuando se apruebe el cambio:

- `index.html` y `404.html` calculan el destino conservando la ruta, la query y el hash (`/PosJaise/productos/x?y#z` → `https://<dominio>/productos/x?y#z`) y hacen `location.replace`. Llevan `<meta http-equiv="refresh">` de respaldo, `<link rel="canonical">` al dominio nuevo y `noindex`.
- **`sw.js` de retiro** para las PWA instaladas en github.io: se activa de inmediato, borra las cachés y se **des-registra**, **sin forzar la navegación**. Así una venta abierta en ese momento no se pierde; la siguiente recarga ya cae en la redirección. Probarlo antes en un repositorio de prueba con una PWA instalada.
- Mantenerlo publicado **indefinidamente**: no cuesta y conserva enlaces viejos, accesos directos e iconos instalados.
- Reversión: volver a publicar el build normal de `main` desde el workflow (§7).

## 4. Canonical, sitemap y robots

Se añadirán en la Fase 10 sobre el dominio final:

- `<link rel="canonical">` a la raíz;
- `robots.txt` con `Sitemap:`;
- `sitemap.xml` con las rutas públicas estables: inicio, servicios, productos, recompensas, nosotros y las páginas legales.

Las rutas del POS no se indexan. Las fichas de producto y servicio son dinámicas y quedan para una mejora posterior. Hasta entonces, la redirección de github.io lleva canonical al nuevo dominio.

## 5. Auth y pagos

- Supabase (proyecto del negocio, panel **Authentication → URL Configuration**):
  - añadir el nuevo origen a **Redirect URLs** antes del cambio;
  - cambiar la **Site URL** en el momento del cambio;
  - mantener el origen de github.io en la lista durante la transición, por correos de confirmación ya enviados.
  - Comprobar si la confirmación de correo está activa: si lo está, sus enlaces llevan la Site URL.
- Culqi: sigue pendiente (llaves 401, cuenta sin validar). Al activarlo, registrar el dominio final si Culqi lo exige y probar en sandbox; sin cobros reales para QA.

## 6. Sesiones, carritos y comunicación

- Todas las personas **volverán a iniciar sesión** en el nuevo origen (las sesiones no pasan de un origen a otro). Las preferencias guardadas en el navegador (tema y similares) vuelven a sus valores por defecto. Los carritos y favoritos de clientas están en la base: se conservan.
- POS: hacer el cambio fuera del horario de atención. Pedir que las ventas en curso se terminen antes, porque la venta vive en memoria. Instalar la PWA nueva en cada dispositivo de caja y retirar el acceso viejo.
- Diario local de borrados pendientes de R2 (Fase 3): lo que haya quedado en el navegador del origen viejo lo cubre el recolector de huérfanos con retención.
- **Mensajes propuestos.** Personal: un día antes, el día y al día siguiente, con la nueva dirección, el reingreso y la reinstalación de la app. Clientas: aviso en redes y WhatsApp con la nueva dirección; los enlaces viejos siguen funcionando por la redirección.

## 7. Reversión del cambio público

- Frontend: republicar el build normal en GitHub Pages (workflow existente) y devolver la Site URL. El dominio de Pages puede quedar activo.
- **Compatibilidad de datos:** después de actualizar las referencias de medios (paso 4 de §1), el build de `main` **no puede** mostrar esas fotos (`r2:` → 400). La reversión necesita un **build de reversión preparado de antemano**: el código actual compilado para GitHub Pages (`/PosJaise/`) con `VITE_MEDIOS_PUBLIC_URL`. Otra opción es revertir antes las referencias (`medios-migracion.mjs revertir --aplicar`); los originales siguen en Supabase durante todo el periodo de reversión.
- Cambiar solo el DNS no revierte datos ni medios (lo advierte el plan).

## 8. Pendientes para decidir

1. Fecha y forma del dominio propio; publicar sobre pages.dev o esperar.
2. Periodo de reversión de los medios (propuesta: al menos 30 días tras actualizar referencias y nunca antes de cerrar la observación de 10B).
3. Perfiles (usuarios, clientas, equipo) y QR: ¿se migran más adelante o se quedan en Supabase?
4. Horario y comunicación del cambio para el personal.
