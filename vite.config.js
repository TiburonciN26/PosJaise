import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  // GitHub Pages sirve este proyecto bajo /PosJaise/ (Pages de proyecto, no
  // de usuario), así que el build necesita ese prefijo en assets, rutas y
  // manifest. En dev queda "/" porque Vite lo sirve desde la raíz.
  const base = command === 'build' ? '/PosJaise/' : '/'

  return {
    base,
    plugins: [
      react(),
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
        },
        manifest: {
          name: 'Pos Jaise',
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
    },
  }
})
