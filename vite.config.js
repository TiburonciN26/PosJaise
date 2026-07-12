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
        registerType: 'autoUpdate',
        // Solo precachea el shell estático (JS/CSS/HTML/íconos) generado por
        // el build. Nunca intercepta las consultas a Supabase — esas siguen
        // yendo siempre a la red, para no arriesgar mostrar datos viejos del
        // negocio (stock, ventas, etc.) al usuario.
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        },
        manifest: {
          name: 'POS Negocio 2',
          short_name: 'POS Negocio',
          description: 'Sistema de punto de venta para el negocio.',
          lang: 'es',
          theme_color: '#0d0d0d',
          background_color: '#0d0d0d',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' },
            { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
