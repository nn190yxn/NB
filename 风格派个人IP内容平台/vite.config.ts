import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

const apiProxyTarget = process.env.API_PROXY_TARGET || 'http://localhost:3001'

export default defineConfig({
  plugins: [react(), legacy({ targets: ['defaults', 'not IE 11'] })],
  server: {
    allowedHosts: ['.monkeycode-ai.online'],
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
})
