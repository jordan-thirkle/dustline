import { defineConfig } from 'vite';

// DUSTLINE - static Three.js build, no transform pipeline needed.
// Serve straight; all game assets are procedural (no external files).
export default defineConfig({
  server: {
    port: 4173,
    open: false,
    host: true,
  },
  preview: {
    port: 4173,
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
});
