import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Permite acceder desde túneles temporales (localtunnel/ngrok) para
    // probar en celular por HTTPS — Vite bloquea por defecto cualquier
    // Host header que no reconozca, y estos túneles usan un dominio
    // público aleatorio cada vez.
    allowedHosts: true,
  },
})
