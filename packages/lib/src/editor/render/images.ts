/**
 * HTMLImageElement cache for the 2D editor canvas (which draws to a plain `<canvas>`, not Three.js).
 * Loads are de-duped and cached by source URL; callers poll `getImage` each redraw and redraw from `onLoad`.
 */

const cache = new Map<string, HTMLImageElement>();
const pending = new Map<string, Promise<HTMLImageElement>>();
const failed = new Map<string, { attempts: number; retryAt: number }>();

/** Synchronous cache lookup — returns the decoded image or undefined. */
export function getImage(src: string): HTMLImageElement | undefined {
	return cache.get(src);
}

export function imageFailed(src: string): boolean {
	return (failed.get(src)?.retryAt ?? 0) > Date.now();
}

/** Ensure an image is loading/loaded. `onLoad` fires once when it becomes available. */
export function ensureImage(src: string, onLoad?: () => void): HTMLImageElement | undefined {
	const have = cache.get(src);
	if (have) return have;
	const failure = failed.get(src);
	if (failure && failure.retryAt > Date.now()) return undefined;
	if (!pending.has(src)) {
		const p = new Promise<HTMLImageElement>((resolve, reject) => {
			const img = new Image();
			img.onload = () => {
				cache.set(src, img);
				pending.delete(src);
				failed.delete(src);
				resolve(img);
			};
			img.onerror = (e) => {
				pending.delete(src);
				const attempts = (failed.get(src)?.attempts ?? 0) + 1;
				failed.set(src, { attempts, retryAt: Date.now() + Math.min(30_000, 1000 * 2 ** (attempts - 1)) });
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

/** Forget a transient failure/cache entry so a repaired or replaced asset can be retried now. */
export function invalidateImage(src: string): void {
	cache.delete(src);
	failed.delete(src);
}

/** Drop project-scoped image state between editor mounts. Pending decodes may finish harmlessly. */
export function clearImageCache(): void {
	cache.clear();
	failed.clear();
}

/**
 * Resolve a tileset's image relPath (relative to the `.svlevel` file) to a public URL,
 * URL-encoding path segments so names with spaces (e.g. "Dungeon Tile Set.png") work.
 */
export function tilesetImageUrl(projectDir: string, relPath: string): string {
	const baseDir = projectDir.endsWith('/') ? projectDir : projectDir + '/';
	return new URL(relPath, new URL(baseDir, location.href)).href;
}
