import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, '../../'), '')
  const port = env.PORT || '7000'

  return {
    plugins: [vue()],
    server: {
      port: 5173,
      proxy: {
        '/api': `http://localhost:${port}`,
        '/encrypt': `http://localhost:${port}`,
        // Vite proxy uses string prefix matching — it cannot proxy /:token/* dynamically.
        // Token-based routes (/manifest.json, /catalog, /stream) are handled via
        // the import.meta.env.DEV workaround in useManifestPoll.ts (see below).
      }
    },
    define: {
      __BACKEND_PORT__: JSON.stringify(port)
    },
    build: {
      outDir: 'dist',
    }
  }
})
