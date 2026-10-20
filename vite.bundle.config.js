// Single-file bundle: `npm run bundle` writes bundle/index.html with all CSS and JS inlined.
// It opens straight from disk (double-click), no server of any kind.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: { outDir: 'bundle', emptyOutDir: true, target: 'es2020', cssCodeSplit: false, assetsInlineLimit: 100000000 },
});
