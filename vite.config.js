import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173 },
  build: {
    target: 'es2022',
    rolldownOptions: {
      input: {
        game: resolve(import.meta.dirname, 'index.html'),
        viewer: resolve(import.meta.dirname, 'viewer.html'),
        sfx: resolve(import.meta.dirname, 'sfx.html'),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.js'],
    // Whole-ship simulations take a few seconds each; don't fail them on a busy machine.
    testTimeout: 30000,
  },
});
