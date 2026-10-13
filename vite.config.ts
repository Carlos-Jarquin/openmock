import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// /comfyui-api proxies to a local ComfyUI (default port 8188) for "Make hands photoreal". The Origin header is dropped
// so ComfyUI's same-origin check accepts the request without starting it with CORS enabled.
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const COMFY = env.COMFY_URL ?? 'http://127.0.0.1:8188'
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/comfyui-api': {
        target: COMFY, changeOrigin: true, ws: true, rewrite: p => p.replace(/^\/comfyui-api/, ''),
        configure: (proxy: unknown) => {
          const p = proxy as { on: (e: string, f: (req: { removeHeader: (h: string) => void }) => void) => void }
          p.on('proxyReq', req => req.removeHeader('origin')); p.on('proxyReqWs', req => req.removeHeader('origin')) // ws: step progress
        },
      },
    },
  },
})
