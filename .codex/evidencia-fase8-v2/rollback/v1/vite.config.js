import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Fase 8 (PERF-10): el precaché ya no incluye TODO el build (176 entradas, ~3,5 MB: POS completo, escáner de 480 kB, maquetas HTML de
// public/…). Solo el SHELL: lo que el navegador necesita para arrancar la app y pintar la ruta de aterrizaje (/inicio) sin red.
// La lista se calcula del grafo REAL de chunks de Rollup (no por nombres con hash): chunks de entrada + sus importaciones estáticas + su CSS,
// más los chunks de PortalCliente e InicioCliente con las suyas. El resto (páginas del POS, escáner, páginas del portal, modales) se guarda
// «por uso» (runtimeCaching CacheFirst: son archivos con hash inmutable) la primera vez que se piden con el service worker activo.
// Los datos operativos (Supabase) NO pasan por ninguna regla: siempre red.
const RAICES_DE_ATERRIZAJE = ['/pages/PortalCliente.jsx', '/pages/cliente/InicioCliente.jsx']
// Los íconos de la PWA (192/512 y maskable) NO se precachean: el navegador los pide por su cuenta al instalar la app desde el manifest.
const SHELL_FIJO = new Set(['index.html', 'manifest.webmanifest'])
function cierreDelShell() {
  const permitidos = new Set()
  return {
    name: 'cierre-del-shell-pwa',
    apply: 'build',
    generateBundle(_opciones, bundle) {
      const chunks = Object.values(bundle).filter((x) => x.type === 'chunk')
      const porNombre = new Map(chunks.map((c) => [c.fileName, c]))
      const visitar = (nombre) => {
        if (permitidos.has(nombre) || !porNombre.has(nombre)) return
        const c = porNombre.get(nombre)
        permitidos.add(nombre)
        for (const css of c.viteMetadata?.importedCss ?? []) permitidos.add(css)
        for (const imp of c.imports ?? []) visitar(imp)
      }
      for (const c of chunks) {
        const id = (c.facadeModuleId ?? '').replace(/\\/g, '/')
        if (c.isEntry || RAICES_DE_ATERRIZAJE.some((r) => id.endsWith(r))) visitar(c.fileName)
      }
      if (permitidos.size < 3) throw new Error('cierre-del-shell-pwa: no se pudo calcular el shell del precaché (grafo vacío)')
    },
    incluye: (url) => SHELL_FIJO.has(url) || permitidos.has(url) || /^assets\/geist-latin-wght-normal-[\w-]+\.woff2$/.test(url),
  }
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // GitHub Pages sirve este proyecto bajo /PosJaise/ (Pages de proyecto, no
  // de usuario), así que el build necesita ese prefijo en assets, rutas y
  // manifest. En dev queda "/" porque Vite lo sirve desde la raíz.
  //
  // Fase 2 (Cloudflare Pages): el mismo código también se publica en la raíz de
  // un dominio (`*.pages.dev` o dominio propio). `VITE_BASE_PATH=/` en ese build
  // (ver scripts/build-cloudflare.mjs) cambia el prefijo; sin la variable el
  // resultado es idéntico al de siempre (/PosJaise/), así que GitHub Pages no cambia.
  const baseConfigurada = (process.env.VITE_BASE_PATH ?? '/PosJaise/').trim()
  const baseNormalizada = `/${baseConfigurada.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/')
  const base = command === 'build' ? baseNormalizada : '/'
  // 404.html es el truco de SPA de GitHub Pages; en la raíz de Cloudflare Pages su
  // sola presencia DESACTIVA el fallback de SPA, así que ese build lo excluye (y del precache).
  const esRaiz = base === '/'

  const shell = cierreDelShell()

  return {
    base,
    // Alias @/ -> src/ (lo exige shadcn; también sirve para imports cortos)
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    plugins: [
      react(),
      // Marca opcional de versión (Fase 2B, prueba de actualización PWA entre dos builds):
      // solo si VITE_BUILD_ID está definido añade <meta name="build-id"> al index.html (entra al
      // precache y cambia sw.js). Sin la variable el build es idéntico al de siempre.
      {
        name: 'marca-build-id',
        transformIndexHtml: (html) => (process.env.VITE_BUILD_ID ? html.replace('</head>', `<meta name="build-id" content="${process.env.VITE_BUILD_ID.replace(/[^\w.-]/g, '')}" /></head>`) : html),
      },
      tailwindcss(),
      shell,
      VitePWA({
        // A2 de la 4ª auditoría: con 'autoUpdate' la versión nueva se activa
        // recién al recargar, sin avisar — un POS suele quedar abierto todo
        // el día, y una migración de RPC que cambia de firma (como pasó con
        // resumen_estadisticas en el ciclo anterior) rompe la pantalla en
        // cualquier celular que siga con el bundle viejo hasta que alguien
        // recargue por su cuenta. 'prompt' + injectRegister:false entrega el
        // control a AvisoActualizacionPWA (src/components), que muestra un
        // aviso explícito con botón "Actualizar" en vez de actualizar solo.
        registerType: 'prompt',
        // Fase 8: sin esto el plugin añade al precaché los íconos del manifest (≈275 kB, con entradas duplicadas).
        includeManifestIcons: false,
        injectRegister: false,
        // Solo precachea el shell estático (JS/CSS/HTML/íconos) generado por
        // el build. Nunca intercepta las consultas a Supabase — esas siguen
        // yendo siempre a la red, para no arriesgar mostrar datos viejos del
        // negocio (stock, ventas, etc.) al usuario.
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          // Fase 8: del glob completo solo se precachea el shell (ver cierreDelShell arriba).
          manifestTransforms: [(entradas) => ({ manifest: entradas.filter((e) => shell.incluye(e.url)), warnings: [] })],
          runtimeCaching: [
            {
              // Chunks/CSS/fuentes con hash del propio build que NO están en el shell: se guardan al pedirse por primera vez.
              // Las funciones de urlPattern se serializan tal cual dentro de sw.js: NO pueden usar variables de este archivo.
              urlPattern: ({ url, sameOrigin }) => sameOrigin && /\/assets\/[^/]+\.(?:js|css|woff2|ttf)$/.test(url.pathname),
              handler: 'CacheFirst',
              options: { cacheName: 'assets-por-uso', expiration: { maxEntries: 160, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true }, cacheableResponse: { statuses: [200] } },
            },
            {
              // Imágenes estáticas del sitio (hero, íconos). Nunca /medios (fotos del negocio vía Pages Function/R2).
              urlPattern: ({ url, sameOrigin }) => sameOrigin && !/\/medios(?:\/|$)/.test(url.pathname) && /\.(?:png|jpe?g|webp|avif|svg)$/.test(url.pathname),
              handler: 'StaleWhileRevalidate',
              options: { cacheName: 'imagenes-del-sitio', expiration: { maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30, purgeOnQuotaError: true }, cacheableResponse: { statuses: [200] } },
            },
          ],
          globIgnores: esRaiz ? ['**/404.html'] : [],
          // Build de Cloudflare (base /): /medios y /medios/* los sirve una Pages Function (fotos), nunca la SPA.
          // El SW no debe devolver index.html a una navegación a una foto. `/medios-extra` NO queda excluido.
          // GitHub Pages (base /PosJaise/) no cambia.
          ...(esRaiz ? { navigateFallbackDenylist: [/^\/medios(?:\/|$)/] } : {}),
        },
        manifest: {
          name: 'Pos Jaise Beauty Academy',
          short_name: 'Pos Jaise',
          description: 'Sistema de punto de venta para el negocio.',
          lang: 'es',
          theme_color: '#0d0d0d',
          background_color: '#0d0d0d',
          display: 'standalone',
          start_url: base,
          scope: base,
          // "any" es el logo tal cual (sin recortes, se ve completo en el
          // launcher/instalador). "maskable" es una versión aparte con el
          // logo al 60% del lienzo sobre fondo sólido — el logo original no
          // tenía margen (tocaba el borde en los 4 lados), así que un
          // launcher que recorta a círculo/squircle (Android) le cortaba la
          // chispa o la cola de la "J" si se reusaba la misma imagen.
          icons: [
            { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: `${base}icon-192-maskable.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'maskable',
            },
            {
              src: `${base}icon-512-maskable.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
      }),
    ],
    server: {
      // Permite acceder desde túneles temporales (localtunnel/ngrok) para
      // probar en celular por HTTPS — Vite bloquea por defecto cualquier
      // Host header que no reconozca, y estos túneles usan un dominio
      // público aleatorio cada vez.
      allowedHosts: true,
      // Solo en `vite --mode movil` (npm run dev:movil): el celular entra por UN túnel (ngrok al
      // puerto de Vite) y /__supabase reenvía al Supabase local (Docker, 127.0.0.1:54321),
      // incluidos los websockets de Realtime. Sin esto, 127.0.0.1 en el celular es el propio celular.
      proxy:
        mode === 'movil'
          ? { '/__supabase': { target: 'http://127.0.0.1:54321', changeOrigin: true, ws: true, rewrite: (path) => path.replace(/^\/__supabase/, '') } }
          : undefined,
    },
  }
})
