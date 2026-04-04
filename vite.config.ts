import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: ['react-pdf'],
  },
  server: {
    proxy: {
      '/desktop-files': {
        target: 'http://127.0.0.1:8899',
        rewrite: (path) => path.replace(/^\/desktop-files/, ''),
        changeOrigin: true,
      },
    },
  },
})
