import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build loads from the Capacitor web view's local files.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 2500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
} as any);
