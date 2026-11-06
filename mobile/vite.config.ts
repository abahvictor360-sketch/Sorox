import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build loads from the Capacitor web view's local files.
// The build records which GitHub Actions run made it, so the app can tell
// when a newer release is out (src/lib/updates.ts). Local builds have none.
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __BUILD_RUN__: JSON.stringify(process.env.GITHUB_RUN_ID ?? ''),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 2500 },
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
} as any);
