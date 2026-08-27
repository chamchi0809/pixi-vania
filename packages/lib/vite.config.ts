import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  // `css: 'injected'` inlines the editor's styles into the bundle, so consumers import no CSS
  // and need no Svelte setup of their own -- the runtime is bundled in too.
  plugins: [svelte({ compilerOptions: { css: 'injected' } })],
  build: {
    target: 'es2022',
    lib: {
      entry: { index: 'src/index.ts', editor: 'src/editor.ts', vite: 'src/vite.ts' },
      formats: ['es'],
    },
    rollupOptions: { external: [/^pixi\.js/, /^@dimforge\//, 'vite', /^node:/] },
    sourcemap: true,
  },
});
