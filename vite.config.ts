import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serverar sidan under /matpref/. Lokalt körs den på /.
const base = process.env.BASE_PATH ?? '/'
// Sätts när en PR-förhandsvisning byggs, se .github/workflows/preview.yml.
const preview = process.env.VITE_PREVIEW_LABEL

// Appens version: commitens korta hash (GitHub Actions sätter GITHUB_SHA), annars den lokala, annars "dev".
function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(commit()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: base,
        name: preview ? `Matpref (${preview})` : 'Matpref – vad ska vi äta?',
        short_name: preview ? `Matpref ${preview}` : 'Matpref',
        description: 'Slumpa fram middag utifrån era recept, favoriter och preferenser.',
        lang: 'sv',
        theme_color: '#e8590c',
        background_color: '#fff8f0',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Den riktiga appens service worker täcker hela /matpref/. Låt förhandsvisningarna gå till nätet.
        navigateFallbackDenylist: [/\/pr-preview\//],
      },
    }),
  ],
})
