import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

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
        injectRegister: false,
        // Solo precachea el shell estático (JS/CSS/HTML/íconos) generado por
        // el build. Nunca intercepta las consultas a Supabase — esas siguen
        // yendo siempre a la red, para no arriesgar mostrar datos viejos del
        // negocio (stock, ventas, etc.) al usuario.
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
          globIgnores: esRaiz ? ['**/404.html'] : [],
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
