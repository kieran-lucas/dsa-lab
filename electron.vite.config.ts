import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { randomBytes } from 'node:crypto'
const nonce = randomBytes(24).toString('base64')

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    html: { cspNonce: nonce },
    plugins: [
      react(),
      {
        name: 'local-csp-nonce',
        transformIndexHtml: (html) =>
          html.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`)
      }
    ],
    // Keep even small font subsets as local files, compatible with font-src 'self'.
    build: { minify: 'esbuild', chunkSizeWarningLimit: 4000, assetsInlineLimit: 0 }
  }
})
