import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative assets keep the app portable across GitHub Pages project sites.
  base: './',
  plugins: [react()],
});
