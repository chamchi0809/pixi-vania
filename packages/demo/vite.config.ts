import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import levelEditor from '../lib/src/vite.ts';

export default defineConfig({
	base: './',
	build: {
		target: 'es2022',
		// Rapier is deliberately a large Play-only lazy chunk; the gzip budget script enforces its limit.
		chunkSizeWarningLimit: 2200
	},
	// The editor saves through this middleware; without it it falls back to Import/Export.
	plugins: [svelte({ compilerOptions: { css: 'injected' } }), levelEditor()],
	// Use the library source directly so `pnpm dev` hot-reloads library edits.
	resolve: {
		alias: {
			'pixi-vania/editor': new URL('../lib/src/editor.ts', import.meta.url).pathname,
			'pixi-vania/runtime': new URL('../lib/src/runtime.ts', import.meta.url).pathname,
			'pixi-vania': new URL('../lib/src/index.ts', import.meta.url).pathname
		}
	},
	server: { port: 8383 }
});
