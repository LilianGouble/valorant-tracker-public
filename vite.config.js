import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Sur Windows, Hyper-V/WSL réserve parfois certaines plages de ports en IPv6,
  // ce qui provoque "EACCES ::1:5173". On force l'IPv4 et on autorise un fallback.
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // Met à jour l'app automatiquement en arrière-plan
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'mask-icon.svg'],
      manifest: {
        name: 'KSL Tracker',
        short_name: 'KSL Tracker',
        description: 'Le Tracker Valorant privé du groupe KSL',
        theme_color: '#0f1923', // La couleur de fond de Valorant (noir/bleu foncé)
        background_color: '#0f1923',
        display: 'standalone', // "standalone" retire la barre d'URL du navigateur !
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
  build: {
    // Vendor chunks séparés : meilleurs cache hits (libs changent rarement),
    // téléchargement parallèle, et le bundle initial reste petit.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-charts': ['recharts'],
          'vendor-motion': ['framer-motion'],
          'vendor-icons': ['lucide-react'],
        }
      }
    }
  }
});