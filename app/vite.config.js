import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // OPENAI_API_KEY lives in .env.local. No VITE_ prefix, so it never ends up in the code sent to the browser:
  // the page calls /api/openai/... and the dev server adds the key on its way to OpenAI.
  const env = loadEnv(mode, import.meta.dirname, '')
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
    server: {
      port: 5174,
      proxy: env.OPENAI_API_KEY ? {
        '/api/openai': {
          target: 'https://api.openai.com',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/openai/, ''),
          headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        },
      } : undefined,
    },
  }
})
