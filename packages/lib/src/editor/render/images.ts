/**
 * HTMLImageElement cache for the 2D editor canvas (which draws to a plain `<canvas>`, not Three.js).
 * Loads are de-duped and cached by source URL; callers poll `getImage` each redraw and redraw from `onLoad`.
 */

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();
const failed = new Set<string>();

/** Synchronous cache lookup — returns the decoded image or undefined. */
export function getImage(src: string): HTMLImageElement | undefined {
	return cache.get(src);
}

export function imageFailed(src: string): boolean {
	return failed.has(src);
}

/** Ensure an image is loading/loaded. `onLoad` fires once when it becomes available. */
export function ensureImage(src: string, onLoad?: () => void): HTMLImageElement | undefined {
	const have = cache.get(src);
	if (have) return have;
	if (failed.has(src)) return undefined;
	if (!pending.has(src)) {
		const p = new Promise<HTMLImageElement>((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				cache.set(src, img);
				pending.delete(src);
				resolve(img);
			};
			img.onerror = (e) => {
				pending.delete(src);
				failed.add(src);
				reject(e);
			};
			img.src = src;
		});
		pending.set(src, p);
		if (onLoad) p.then(onLoad).catch(() => {});
	} else if (onLoad) {
		pending.get(src)!.then(onLoad).catch(() => {});
	}
	return undefined;
}

/**
 * Resolve a tileset's image relPath (relative to the `.svlevel` file) to a public URL,
 * URL-encoding path segments so names with spaces (e.g. "Dungeon Tile Set.png") work.
 */
export function tilesetImageUrl(projectDir: string, relPath: string): string {
	const baseDir = projectDir.endsWith('/') ? projectDir : projectDir + '/';
	return new URL(relPath, new URL(baseDir, location.href)).href;
}
