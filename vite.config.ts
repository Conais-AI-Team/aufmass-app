import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Allow branch-subdomain dev hosts like http://demo.localhost:5173
    // (Chrome resolves *.localhost to loopback automatically).
    allowedHosts: ['.localhost'],
    proxy: {
      '/api': {
        target: 'http://localhost:5001',
        changeOrigin: true,
      }
    }
  }
})
