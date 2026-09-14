import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

function buildStamp(): string {
  let sha = 'dev';
  try { sha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { /* no git */ }
  const t = new Date();
  return `${sha} · ${t.toISOString().slice(0, 16).replace('T', ' ')}`;
}

export default defineConfig({
  // GitHub Pages serves the app under /<repo>/; set BASE_PATH in CI. Local dev/preview stay at '/'.
  base: process.env.BASE_PATH ?? '/',
  define: { __BUILD__: JSON.stringify(buildStamp()) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: "Hunter's Ledger",
        short_name: 'Ledger',
        description: 'D&D 3.5e battle assistant',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png}'], maximumFileSizeToCacheInBytes: 6 * 1024 * 1024 },
      devOptions: { enabled: false },
    }),
  ],
  server: { host: true },
  preview: { host: true, port: 4173 },
});
