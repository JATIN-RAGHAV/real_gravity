// Static build: `npm run build` writes dist/ (what Vercel deploys).
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2020' },
  server: { port: 5173 },
});
