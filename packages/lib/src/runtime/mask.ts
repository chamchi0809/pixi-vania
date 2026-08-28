/**
 * Opaque-pixel masks for `pixel`-shaped tile colliders, read back from the tileset image (a texel
 * counts as solid when alpha > 0 — the same rule the editor's Collision preview draws).
 */

import type { Texture } from 'pixi.js';
import { getTileset, type SvLevelProject } from '../format/types';
import type { TileMask } from './grid';

interface Atlas {
	data: Uint8ClampedArray;
	w: number;
}

const atlasCache = new WeakMap<Texture, Atlas | null>();
const tileCache = new WeakMap<Texture, Map<string, Uint8Array>>();

function readPixels(texture: Texture | undefined): Atlas | null {
	if (texture && atlasCache.has(texture)) return atlasCache.get(texture) ?? null;
	const source = texture?.source;
	const image = source?.resource as CanvasImageSource | undefined;
	if (!source || !image) return null;
	const canvas = document.createElement('canvas');
	canvas.width = source.pixelWidth;
	canvas.height = source.pixelHeight;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return null;
	ctx.drawImage(image, 0, 0);
	try {
		const atlas = { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, w: canvas.width };
		atlasCache.set(texture!, atlas);
		return atlas;
	} catch {
		// Tainted canvas (cross-origin tileset) — callers fall back to full-cell rects.
		atlasCache.set(texture!, null);
		return null;
	}
}

/** Mask lookup backed by the loaded tileset textures. Each atlas is decoded at most once. */
export function tileMaskFromTextures(
	project: SvLevelProject,
	textures: ReadonlyMap<number, Texture>
): TileMask {
	const atlases = new Map<number, Atlas | null>();

	return (tilesetUid, tileId) => {
		const tileset = getTileset(project, tilesetUid);
		if (!tileset) return undefined;
		const texture = textures.get(tilesetUid);
		if (!texture) return undefined;
		if (!atlases.has(tilesetUid)) atlases.set(tilesetUid, readPixels(texture));
		const atlas = atlases.get(tilesetUid);
		if (!atlas) return undefined;

		const size = tileset.tileGridSize;
		const cacheKey = `${tileId}:${size}:${tileset.spacing}:${tileset.padding}:${tileset.cWid}`;
		let cachedTiles = tileCache.get(texture);
		if (!cachedTiles) tileCache.set(texture, (cachedTiles = new Map()));
		const cached = cachedTiles.get(cacheKey);
		if (cached) return cached;
		const stride = size + tileset.spacing;
		const sx = tileset.padding + (tileId % tileset.cWid) * stride;
		const sy = tileset.padding + Math.floor(tileId / tileset.cWid) * stride;
		const out = new Uint8Array(size * size);
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				out[y * size + x] = (atlas.data[((sy + y) * atlas.w + sx + x) * 4 + 3] ?? 0) > 0 ? 1 : 0;
			}
		}
		cachedTiles.set(cacheKey, out);
		return out;
	};
}
