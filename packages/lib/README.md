# pixi-vania

Tilemap level format, Svelte editor, and optional PixiJS/Rapier2D runtime.

```ts
import { parseProject } from 'pixi-vania';
import { createLevelRuntime } from 'pixi-vania/runtime';
import { mountEditor } from 'pixi-vania/editor';
```

The root and `pixi-vania/format` entrypoints do not import PixiJS or Rapier. Install
`@dimforge/rapier2d-compat` and `pixi.js` when using `pixi-vania/runtime` or the editor.

Runtime loading supports referenced-only or eager loading, synchronous cache-only startup,
preloaded texture maps, bounded async concurrency, cancellation, progress events, custom loaders,
and per-asset fallback/skip policies. See the exported `TilesetLoadingOptions`,
`loadTilesetTexturesSync`, and `createLevelRuntimeSync` types/functions.

```ts
import { Assets, Texture } from 'pixi.js';
import { createLevelRuntime, createLevelRuntimeSync } from 'pixi-vania/runtime';

const runtime = await createLevelRuntime(project, levelUid, {
	world,
	basePath: projectUrl,
	basePathKind: 'project-file',
	loading: {
		concurrency: 4,
		signal,
		getCached: ({ tileset }) => cache.get(tileset.uid),
		load: ({ url }) => Assets.load<Texture>(url),
		onProgress: ({ loaded, total, status }) => updateProgress(loaded, total, status),
		onError: 'skip'
	}
});

const synchronous = createLevelRuntimeSync(project, levelUid, { world, textures: cache });
```

Supported peers: PixiJS `^8.6.0`, Rapier2D compat `>=0.20 <0.21`. The runtime tile shader has
equivalent WebGPU/WGSL and WebGL/GLSL paths. The Vite storage plugin is exported separately from
`pixi-vania/vite`; preview writes are disabled by default.
