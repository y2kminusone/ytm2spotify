import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Dev: `npm run dev` on 5179 proxies the API to the Python server (`ytm2spotify serve --no-browser`).
// Prod: `npm run build` → web/dist, served by the Python server itself.
export default defineConfig({
  plugins: [react()],
  server: { port: 5179, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8765' } },
})
