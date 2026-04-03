import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/auth': 'http://localhost:4000',
      '/catalog': 'http://localhost:4000',
      '/salons': 'http://localhost:4000',
      '/tables': 'http://localhost:4000',
      '/orders': 'http://localhost:4000',
      '/kitchen': 'http://localhost:4000',
      '/cash': 'http://localhost:4000',
      '/kpis': 'http://localhost:4000',
      '/inventory': 'http://localhost:4000',
      '/health': 'http://localhost:4000',
    },
  },
})
