/**
 * Pure grid math shared by the renderer, the colliders and the nav grid — no pixi, no Rapier,
 * so it runs (and self-checks) under plain node.
 */

import {
	getTileCollider,
	getTileset,
	type SvLayerInstance,
	type SvLevel,
	type SvLevelProject,
	type SvTile,
	type SvTileCollider,
	type SvTileset
} from '../format/types.ts';

export interface TileBatch {
	tileset: SvTileset;
	tiles: SvTile[];
}

/** Tiles = the layer's own tileset; IdGrid/AutoLayer = one batch per auto-tile group tileset. */
export function tileBatches(project: SvLevelProject, layer: SvLayerInstance): TileBatch[] {
	const out: TileBatch[] = [];
	const own = getTileset(project, layer.tilesetDefUid);
	if (own && layer.gridTiles.length) out.push({ tileset: own, tiles: layer.gridTiles });
	for (const b of layer.autoTiles) {
		const ts = getTileset(project, b.tilesetDefUid);
		if (ts && b.tiles.length) out.push({ tileset: ts, tiles: b.tiles });
	}
	return out;
}

/** One authored tile collider, resolved to a level-local pixel rect. */
export interface CellRect {
	x: number;
	y: number;
	w: number;
	h: number;
	config: SvTileCollider;
	/** Enum-tag value ids on the source tile (`SvTileset.enumTags`), sorted. */
	tags: string[];
}

const tagIndexes = new WeakMap<SvTileset, Map<number, string[]>>();

/** Tile id -> enum-tag value ids, from the tileset tag editor. Built once per tileset. */
export function tileTagIndex(tileset: SvTileset): Map<number, string[]> {
	let idx = tagIndexes.get(tileset);
	if (!idx) {
		idx = new Map();
		for (const tag of tileset.enumTags ?? [])
			for (const id of tag.tileIds) idx.set(id, [...(idx.get(id) ?? []), tag.enumValueId].sort());
		tagIndexes.set(tileset, idx);
	}
	return idx;
}

// Tags ride the merge key: two tiles that differ only by tag must stay separate colliders.
const key = (c: SvTileCollider, tags: string[]): string =>
	`${c.group ?? ''}|${c.sensor ? 1 : 0}|${tags.join(',')}`;

/**
 * Greedy rect merge over a cell set: grow right along the row, then down while every column of
 * the run stays filled. Same coverage as one cuboid per tile, a fraction of the colliders.
 */
interface Rect {
	cx: number;
	cy: number;
	w: number;
	h: number;
}

function mergeCells(cells: Set<string>): Rect[] {
	const used = new Set<string>();
	const out: Rect[] = [];
	const sorted = [...cells].map((k) => k.split(',').map(Number) as [number, number]);
	sorted.sort((a, b) => a[1] - b[1] || a[0] - b[0]);

	for (const [cx, cy] of sorted) {
		if (used.has(`${cx},${cy}`)) continue;
		let w = 1;
		while (cells.has(`${cx + w},${cy}`) && !used.has(`${cx + w},${cy}`)) w++;
		let h = 1;
		grow: while (true) {
			for (let x = cx; x < cx + w; x++) {
				const k = `${x},${cy + h}`;
				if (!cells.has(k) || used.has(k)) break grow;
			}
			h++;
		}
		for (let y = cy; y < cy + h; y++) for (let x = cx; x < cx + w; x++) used.add(`${x},${y}`);
		out.push({ cx, cy, w, h });
	}
	return out;
}

/**
 * Tile-local opaque mask for a `pixel`-shaped tile: `tileGridSize²` bytes, 1 = solid.
 * `runtime/mask` builds one from the tileset image; without it `pixel` degrades to `rect`.
 */
export type TileMask = (tilesetUid: number, tileId: number) => Uint8Array | undefined;

/**
 * ponytail: a `pixel` tile merges only within its own cell, never with the neighbour beside it.
 * Merging across cells would need one level-wide pixel grid — do that if the collider count bites.
 */
function maskRects(
	mask: TileMask | undefined,
	tileset: SvTileset,
	tileId: number,
	cache: Map<string, Rect[]>
): Rect[] | undefined {
	const k = `${tileset.uid}:${tileId}`;
	let rects = cache.get(k);
	if (!rects) {
		const size = tileset.tileGridSize;
		const m = mask?.(tileset.uid, tileId);
		if (!m) return undefined;
		const cells = new Set<string>();
		for (let y = 0; y < size; y++)
			for (let x = 0; x < size; x++) if (m[y * size + x]) cells.add(`${x},${y}`);
		rects = mergeCells(cells);
		cache.set(k, rects);
	}
	return rects;
}

/** Merged collider rects for a level, in level-local pixels (top-left origin, Y-down). */
export function tileColliderRects(
	project: SvLevelProject,
	level: SvLevel,
	mask?: TileMask
): CellRect[] {
	const out: CellRect[] = [];
	const maskCache = new Map<string, Rect[]>();
	for (const layer of level.layers) {
		// A hidden layer is hidden everywhere: no tiles, no colliders, no entities.
		if (layer.type === 'Entities' || !layer.visible) continue;
		const byKind = new Map<string, { config: SvTileCollider; tags: string[]; cells: Set<string> }>();
		for (const batch of tileBatches(project, layer)) {
			const tagsOf = tileTagIndex(batch.tileset);
			for (const tile of batch.tiles) {
				const config = getTileCollider(batch.tileset, tile.t);
				if (!config) continue;
				const tags = tagsOf.get(tile.t) ?? [];
				if (config.shape === 'pixel') {
					const sub = maskRects(mask, batch.tileset, tile.t, maskCache);
					if (sub) {
						const scale = layer.gridSize / batch.tileset.tileGridSize;
						for (const r of sub) {
							out.push({
								x: tile.px[0] + r.cx * scale + layer.pxOffsetX,
								y: tile.px[1] + r.cy * scale + layer.pxOffsetY,
								w: r.w * scale,
								h: r.h * scale,
								config,
								tags
							});
						}
						continue;
					}
				}
				const k = key(config, tags);
				const bucket = byKind.get(k) ?? { config, tags, cells: new Set<string>() };
				bucket.cells.add(
					`${Math.round(tile.px[0] / layer.gridSize)},${Math.round(tile.px[1] / layer.gridSize)}`
				);
				byKind.set(k, bucket);
			}
		}
		for (const { config, tags, cells } of byKind.values()) {
			for (const r of mergeCells(cells)) {
				out.push({
					x: r.cx * layer.gridSize + layer.pxOffsetX,
					y: r.cy * layer.gridSize + layer.pxOffsetY,
					w: r.w * layer.gridSize,
					h: r.h * layer.gridSize,
					config,
					tags
				});
			}
		}
	}
	return out;
}

export interface NavGrid {
	width: number;
	height: number;
	/** Cell size in level pixels. */
	cell: number;
	/** 1 where a character can stand (empty, solid below, empty above). */
	walkable: Uint8Array;
	/** Connected-component id per cell, -1 when not walkable. */
	component: Int32Array;
	/** Level-local pixel -> cell index, or -1 outside the level. */
	cellAt(px: number, py: number): number;
	/** Can a walker get from one cell to the other without leaving the ground? */
	connected(a: number, b: number): boolean;
}

/**
 * Walkability grid at the project's default grid size. A cell is walkable when it is empty, the
 * cell below it is solid, and the cell above is empty (headroom). 4-neighbour components answer
 * reachability without scanning the tilemap per frame.
 */
export function buildNavGrid(project: SvLevelProject, level: SvLevel, mask?: TileMask): NavGrid {
	const cell = project.defaultGridSize;
	const width = Math.round(level.pxWid / cell);
	const height = Math.round(level.pxHei / cell);
	const solid = new Uint8Array(width * height);

	for (const r of tileColliderRects(project, level, mask)) {
		if (r.config.sensor) continue;
		for (let y = Math.floor(r.y / cell); y < Math.ceil((r.y + r.h) / cell); y++) {
			for (let x = Math.floor(r.x / cell); x < Math.ceil((r.x + r.w) / cell); x++) {
				if (0 <= x && x < width && 0 <= y && y < height) solid[y * width + x] = 1;
			}
		}
	}

	const at = (x: number, y: number): number =>
		0 <= x && x < width && 0 <= y && y < height ? solid[y * width + x]! : 0;

	const walkable = new Uint8Array(width * height);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!at(x, y) && at(x, y + 1) && !at(x, y - 1)) walkable[y * width + x] = 1;
		}
	}

	const component = new Int32Array(width * height).fill(-1);
	let next = 0;
	for (let start = 0; start < walkable.length; start++) {
		if (!walkable[start] || component[start] !== -1) continue;
		const queue = [start];
		component[start] = next;
		for (let head = 0; head < queue.length; head++) {
			const i = queue[head]!;
			const x = i % width;
			const y = (i - x) / width;
			for (const [nx, ny] of [
				[x - 1, y],
				[x + 1, y],
				[x, y - 1],
				[x, y + 1]
			] as [number, number][]) {
				if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
				const j = ny * width + nx;
				if (!walkable[j] || component[j] !== -1) continue;
				component[j] = next;
				queue.push(j);
			}
		}
		next++;
	}

	return {
		width,
		height,
		cell,
		walkable,
		component,
		cellAt(px, py) {
			const x = Math.floor(px / cell);
			const y = Math.floor(py / cell);
			return 0 <= x && x < width && 0 <= y && y < height ? y * width + x : -1;
		},
		connected: (a, b) => a >= 0 && b >= 0 && component[a] !== -1 && component[a] === component[b]
	};
}
