import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['dh133zzs2y30r.cloudfront.net'],
    proxy: {
      '/api': 'http://localhost:8081',
    },
  },
})