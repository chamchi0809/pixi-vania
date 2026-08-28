import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	// `css: 'injected'` inlines the editor styles, so consumers need no CSS import or Svelte setup.
	plugins: [svelte({ compilerOptions: { css: 'injected' } })],
	build: {
		target: 'es2022',
		lib: {
			entry: {
				index: 'src/index.ts',
				format: 'src/format.ts',
				runtime: 'src/runtime.ts',
				editor: 'src/editor.ts',
				vite: 'src/vite.ts'
			},
			formats: ['es']
		},
		rollupOptions: { external: [/^pixi\.js/, /^@dimforge\//, 'vite', /^node:/] },
		sourcemap: true
	}
});
