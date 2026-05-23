import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import base44 from '@base44/vite-plugin'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    base44(),
    react(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Force a single copy of React — prevents the
    // "Cannot read properties of null (reading 'useState')" error
    // that occurs when Vite's module cache splits React into two instances.
    dedupe: ['react', 'react-dom'],
  },
})