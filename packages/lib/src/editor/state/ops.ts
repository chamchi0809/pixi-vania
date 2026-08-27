/**
 * Pure in-place mutation + query operations on a `.svlevel` document (no reactivity, no DOM).
 * Auto-tiling reuses the shared engine in `$lib/level/autoRules` so the editor matches the game.
 */

import {
	getLayerDef,
	getTileset,
	tileIdToSrc,
	type FlipBits,
	type SvLayerInstance,
	type SvLevel,
	type SvLevelProject,
	type SvTile,
	type SvTileset
} from '../../format/types';
import { computeAutoTiles, type TilesetGridInfo } from '../../format/autoRules';

export const inBounds = (li: SvLayerInstance, cx: number, cy: number): boolean =>
	cx >= 0 && cy >= 0 && cx < li.cWid && cy < li.cHei;

export const cellIdx = (li: SvLayerInstance, cx: number, cy: number): number => cy * li.cWid + cx;

/** Layer pixel -> cell coords (floor). */
export const pxToCell = (li: SvLayerInstance, px: number, py: number): [number, number] => [
	Math.floor(px / li.gridSize),
	Math.floor(py / li.gridSize)
];

const tilesetGridInfo = (ts: SvTileset): TilesetGridInfo => ({
	cWid: ts.cWid,
	tileGridSize: ts.tileGridSize,
	padding: ts.padding,
	spacing: ts.spacing
});

/** Set one IdGrid cell (group id, `''` = empty). Returns true if the value actually changed. */
export function setIdGridCell(li: SvLayerInstance, cx: number, cy: number, value: string): boolean {
	if (li.type !== 'IdGrid' || !inBounds(li, cx, cy)) return false;
	const i = cellIdx(li, cx, cy);
	if (li.idGrid[i] === value) return false;
	li.idGrid[i] = value;
	return true;
}

export const getIdGridCell = (li: SvLayerInstance, cx: number, cy: number): string =>
	inBounds(li, cx, cy) ? (li.idGrid[cellIdx(li, cx, cy)] ?? '') : '';

/** Flood fill contiguous cells equal to the start value (4-connected). */
export function floodFillIdGrid(
	li: SvLayerInstance,
	cx: number,
	cy: number,
	value: string
): boolean {
	if (li.type !== 'IdGrid' || !inBounds(li, cx, cy)) return false;
	const target = getIdGridCell(li, cx, cy);
	if (target === value) return false;
	const stack: Array<[number, number]> = [[cx, cy]];
	let changed = false;
	while (stack.length) {
		const [x, y] = stack.pop()!;
		if (!inBounds(li, x, y)) continue;
		if (getIdGridCell(li, x, y) !== target) continue;
		li.idGrid[cellIdx(li, x, y)] = value;
		changed = true;
		stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
	}
	return changed;
}

/** Migrate every grid cell + rule-pattern reference from one group id to another (rename cascade). */
export function renameGroupReferences(
	project: SvLevelProject,
	oldName: string,
	newName: string
): void {
	if (oldName === newName) return;
	const oldForbid = '!' + oldName;
	const newForbid = '!' + newName;
	for (const level of project.levels)
		for (const li of level.layers)
			if (li.type === 'IdGrid')
				for (let i = 0; i < li.idGrid.length; i++)
					if (li.idGrid[i] === oldName) li.idGrid[i] = newName;
	for (const g of project.autoRuleGroups ?? [])
		for (const r of g.rules) {
			for (let i = 0; i < r.pattern.length; i++) {
				if (r.pattern[i] === oldName) r.pattern[i] = newName;
				else if (r.pattern[i] === oldForbid) r.pattern[i] = newForbid;
			}
			if (r.outOfBoundsValue === oldName) r.outOfBoundsValue = newName;
		}
}

const tileEq = (t: SvTile, px: number, py: number): boolean => t.px[0] === px && t.px[1] === py;

/** Index of a manually-placed tile occupying the given top-left layer px (or -1). */
export const findTileIndex = (li: SvLayerInstance, px: number, py: number): number =>
	li.gridTiles.findIndex((t) => tileEq(t, px, py));

/** Stamp a tile (by tileset cell id) at a cell. Overwrites any existing tile in that cell. */
export function setGridTile(
	li: SvLayerInstance,
	tileset: SvTileset,
	cx: number,
	cy: number,
	tileId: number,
	flip: FlipBits = 0
): boolean {
	if (li.type !== 'Tiles' || !inBounds(li, cx, cy)) return false;
	const px = cx * li.gridSize;
	const py = cy * li.gridSize;
	const tile: SvTile = { px: [px, py], src: tileIdToSrc(tileset, tileId), t: tileId, f: flip, a: 1 };
	const existing = findTileIndex(li, px, py);
	if (existing >= 0) li.gridTiles[existing] = tile;
	else li.gridTiles.push(tile);
	return true;
}

/** Remove any manually-placed tile in the given cell. */
export function eraseGridTile(li: SvLayerInstance, cx: number, cy: number): boolean {
	if (li.type !== 'Tiles' || !inBounds(li, cx, cy)) return false;
	const px = cx * li.gridSize;
	const py = cy * li.gridSize;
	const i = findTileIndex(li, px, py);
	if (i < 0) return false;
	li.gridTiles.splice(i, 1);
	return true;
}

/**
 * Recompute the cached auto-tiles for one IdGrid/AutoLayer instance.
 * IdGrid layers read their own grid; AutoLayers read their source layer's grid.
 */
export function recomputeAutoTiles(
	project: SvLevelProject,
	level: SvLevel,
	li: SvLayerInstance
): void {
	const def = getLayerDef(project, li.layerDefUid);
	if (!def || (def.type !== 'IdGrid' && def.type !== 'AutoLayer')) return;

	const groups = project.autoRuleGroups ?? [];
	if (groups.length === 0) {
		li.autoTiles = [];
		return;
	}

	let grid: string[];
	let cWid: number;
	let cHei: number;
	if (def.type === 'AutoLayer' && def.autoSourceLayerDefUid != null) {
		const src = level.layers.find((l) => l.layerDefUid === def.autoSourceLayerDefUid);
		if (!src) {
			li.autoTiles = [];
			return;
		}
		grid = src.idGrid;
		cWid = src.cWid;
		cHei = src.cHei;
	} else {
		grid = li.idGrid;
		cWid = li.cWid;
		cHei = li.cHei;
	}

	// One TilesetGridInfo per distinct tileset referenced by the groups.
	const tilesets = new Map<number, TilesetGridInfo>();
	for (const g of groups) {
		if (g.tilesetDefUid == null || tilesets.has(g.tilesetDefUid)) continue;
		const ts = getTileset(project, g.tilesetDefUid);
		if (ts) tilesets.set(g.tilesetDefUid, tilesetGridInfo(ts));
	}

	li.autoTiles = computeAutoTiles({
		grid,
		cWid,
		cHei,
		groups,
		gridSize: def.gridSize,
		tilesets,
		seed: level.uid
	});
}

/**
 * After an IdGrid layer's values change, recompute every auto-layer that depends on it:
 * the layer itself (if it carries rules) plus any AutoLayer sourced from it.
 */
export function recomputeAutoTilesAffectedBy(
	project: SvLevelProject,
	level: SvLevel,
	changedLayerDefUid: number
): void {
	for (const li of level.layers) {
		const def = getLayerDef(project, li.layerDefUid);
		if (!def) continue;
		if (def.type === 'IdGrid' && li.layerDefUid === changedLayerDefUid) {
			recomputeAutoTiles(project, level, li);
		} else if (def.type === 'AutoLayer' && def.autoSourceLayerDefUid === changedLayerDefUid) {
			recomputeAutoTiles(project, level, li);
		}
	}
}

/** Recompute every auto-layer in a level (used after load / rule edits). */
export function recomputeAllAutoTiles(project: SvLevelProject, level: SvLevel): void {
	for (const li of level.layers) recomputeAutoTiles(project, level, li);
}

/** Recompute every auto-layer across every level — global rule/group edits affect all levels. */
export function recomputeAllAutoTilesAllLevels(project: SvLevelProject): void {
	for (const level of project.levels) recomputeAllAutoTiles(project, level);
}

/** Topmost entity (search front->back layers) whose footprint contains a layer px. */
export function entityAt(
	level: SvLevel,
	lpx: number,
	lpy: number
): { layerDefUid: number; iid: string } | null {
	for (const li of level.layers) {
		if (li.type !== 'Entities' || !li.visible) continue;
		// Search reverse so the most-recently-added wins.
		for (let i = li.entities.length - 1; i >= 0; i--) {
			const e = li.entities[i]!;
			if (
				lpx >= e.px[0] &&
				lpx < e.px[0] + e.width &&
				lpy >= e.px[1] &&
				lpy < e.px[1] + e.height
			) {
				return { layerDefUid: li.layerDefUid, iid: e.iid };
			}
		}
	}
	return null;
}

export function findEntity(level: SvLevel, iid: string) {
	for (const li of level.layers) {
		if (li.type !== 'Entities') continue;
		const e = li.entities.find((x) => x.iid === iid);
		if (e) return { layer: li, entity: e };
	}
	return null;
}

export function removeEntity(level: SvLevel, iid: string): boolean {
	for (const li of level.layers) {
		if (li.type !== 'Entities') continue;
		const i = li.entities.findIndex((x) => x.iid === iid);
		if (i >= 0) {
			li.entities.splice(i, 1);
			return true;
		}
	}
	return false;
}
