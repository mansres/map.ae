import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative assets keep the app portable across GitHub Pages project sites.
  root: 'src',
  base: './',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsDir: 'site-assets',
  },
});
