/**
 * Pure data builders for new `.svlevel` documents, levels, layers and values.
 * No reactivity or DOM — called inside the store's undo-tracked mutations, never touch `$state`.
 */

import {
	SVLEVEL_FORMAT,
	SVLEVEL_VERSION,
	type SvAutoRule,
	type SvAutoRuleGroup,
	type SvAutoRulePreset,
	type SvEntityInstance,
	type SvEnum,
	type SvLayerDef,
	type SvLayerInstance,
	type SvLayerType,
	type SvLevel,
	type SvLevelProject,
	type SvTile,
	type SvTileset,
	getLayerDef
} from '../../format/types';
import { cloneDefaultLayers } from '../../format/collisionLayers';
import { defaultEntityFields, getEntityType } from '../../format/entities';

/** Allocate the next monotonic uid for a def/level. */
export function allocUid(project: SvLevelProject): number {
	return project.nextUid++;
}

/** Stable instance id. */
export function uuid(): string {
	if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
	// Fallback (non-secure contexts / old runtimes).
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/** Cells across / down for a given pixel size + grid size. */
export const gridCells = (px: number, gridSize: number): number =>
	Math.max(1, Math.ceil(px / gridSize));

/** Build the per-level instance for a single layer def, sized to the level. */
export function makeLayerInstance(def: SvLayerDef, pxWid: number, pxHei: number): SvLayerInstance {
	const cWid = gridCells(pxWid, def.gridSize);
	const cHei = gridCells(pxHei, def.gridSize);
	return {
		layerDefUid: def.uid,
		identifier: def.identifier,
		type: def.type,
		gridSize: def.gridSize,
		cWid,
		cHei,
		visible: true,
		opacity: def.opacity,
		pxOffsetX: def.pxOffsetX,
		pxOffsetY: def.pxOffsetY,
		tilesetDefUid: def.tilesetDefUid ?? null,
		idGrid: def.type === 'IdGrid' ? new Array(cWid * cHei).fill('') : [],
		gridTiles: [],
		autoTiles: [],
		entities: []
	};
}

/** Build a fresh level with one instance per existing layer def. */
export function makeLevel(
	project: SvLevelProject,
	opts: {
		identifier: string;
		pxWid?: number;
		pxHei?: number;
		worldX?: number;
		worldY?: number;
	}
): SvLevel {
	const pxWid = opts.pxWid ?? 256;
	const pxHei = opts.pxHei ?? 256;
	return {
		uid: allocUid(project),
		iid: uuid(),
		identifier: opts.identifier,
		worldX: opts.worldX ?? 0,
		worldY: opts.worldY ?? 0,
		pxWid,
		pxHei,
		bgColor: null,
		fields: {},
		// Mirror the project's front->back layer ordering.
		layers: project.layers.map((def) => makeLayerInstance(def, pxWid, pxHei))
	};
}

/** Recompute cWid/cHei + resize storage for one instance after a level resize. */
export function resizeLayerInstance(li: SvLayerInstance, pxWid: number, pxHei: number): void {
	resizeLayerInstanceShifted(li, pxWid, pxHei, 0, 0);
}

/**
 * Resize one instance and shift existing content by (shiftPxX, shiftPxY) local px — needed when a
 * left/top edge moves the origin so content stays put. Zero shift = plain top-left-anchored resize.
 */
export function resizeLayerInstanceShifted(
	li: SvLayerInstance,
	pxWid: number,
	pxHei: number,
	shiftPxX = 0,
	shiftPxY = 0
): void {
	const cWid = gridCells(pxWid, li.gridSize);
	const cHei = gridCells(pxHei, li.gridSize);
	if (li.type === 'IdGrid') {
		const shiftCx = Math.round(shiftPxX / li.gridSize);
		const shiftCy = Math.round(shiftPxY / li.gridSize);
		const next = new Array(cWid * cHei).fill('');
		for (let y = 0; y < li.cHei; y++) {
			const ny = y + shiftCy;
			if (ny < 0 || ny >= cHei) continue;
			for (let x = 0; x < li.cWid; x++) {
				const nx = x + shiftCx;
				if (nx < 0 || nx >= cWid) continue;
				next[ny * cWid + nx] = li.idGrid[y * li.cWid + x] ?? '';
			}
		}
		li.idGrid = next;
	}
	// Shift then drop out-of-bounds tiles.
	const maxX = cWid * li.gridSize;
	const maxY = cHei * li.gridSize;
	const shiftTiles = (tiles: SvTile[]): SvTile[] =>
		tiles
			.map((t): SvTile => ({ ...t, px: [t.px[0] + shiftPxX, t.px[1] + shiftPxY] }))
			.filter((t) => t.px[0] >= 0 && t.px[1] >= 0 && t.px[0] < maxX && t.px[1] < maxY);
	li.gridTiles = shiftTiles(li.gridTiles);
	li.autoTiles = []; // recomputed by every caller after resize
	if (shiftPxX || shiftPxY) {
		for (const e of li.entities) e.px = [e.px[0] + shiftPxX, e.px[1] + shiftPxY];
	}
	li.cWid = cWid;
	li.cHei = cHei;
}

export const PALETTE = [
	'#ff6b6b',
	'#4dabf7',
	'#69db7c',
	'#ffd43b',
	'#da77f2',
	'#ff922b',
	'#3bc9db'
];

/** A new pattern rule (default 3×3 all-wildcard, single tile). */
export function makeAutoRule(project: SvLevelProject, size = 3): SvAutoRule {
	return {
		uid: allocUid(project),
		active: true,
		size,
		pattern: new Array(size * size).fill(''),
		tileIds: [],
		chance: 1,
		breakOnMatch: true,
		flipX: false,
		flipY: false,
		xModulo: 1,
		yModulo: 1,
		xOffset: 0,
		yOffset: 0,
		tileXOffset: 0,
		tileYOffset: 0,
		checker: 'None',
		tileMode: 'Single',
		pivotX: 0,
		pivotY: 0,
		outOfBoundsValue: null,
		perlinActive: false,
		perlinSeed: 0,
		perlinScale: 0.2,
		perlinOctaves: 2
	};
}

/**
 * Coerce a raw string into a legal group id (the name *is* the id): trim, drop a leading `!`
 * (forbid prefix) and the lone `*` sentinel, fall back to `'group'` if nothing legal remains.
 */
export function sanitizeGroupName(s: string): string {
	let n = s.trim();
	while (n.startsWith('!')) n = n.slice(1).trim();
	if (n === '' || n === '*') return 'group';
	return n;
}

/** A unique group id: `base`, else `base_2`, `base_3`… skipping the group at `exceptUid`. */
export function uniqueGroupName(
	groups: SvAutoRuleGroup[],
	base: string,
	exceptUid?: number
): string {
	const taken = new Set(groups.filter((g) => g.uid !== exceptUid).map((g) => g.name));
	if (!taken.has(base)) return base;
	for (let i = 2; ; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
}

/** A new, empty global brush group: unique name as its id, palette colour, first tileset. */
export function makeAutoRuleGroup(project: SvLevelProject, name = 'New group'): SvAutoRuleGroup {
	const groups = project.autoRuleGroups ?? [];
	return {
		uid: allocUid(project),
		name: uniqueGroupName(groups, sanitizeGroupName(name)),
		active: true,
		color: PALETTE[groups.length % PALETTE.length]!,
		tilesetDefUid: project.tilesets[0]?.uid ?? null,
		rules: []
	};
}

/**
 * New group cloning a preset's full rule layout: fresh uids, unique name + palette colour.
 * `selfValue` = the id the preset's patterns reference as "self" (the source group's original name,
 * which the caller may have overridden in `preset.name`); rebound to the new group's id.
 */
export function makeGroupFromPreset(
	project: SvLevelProject,
	preset: SvAutoRulePreset,
	selfValue: string = preset.name
): SvAutoRuleGroup {
	const g = makeAutoRuleGroup(project, preset.name);
	g.tilesetDefUid = preset.tilesetDefUid;
	const oldForbid = '!' + selfValue;
	const newForbid = '!' + g.name;
	g.rules = preset.rules.map((r) => ({
		...r,
		uid: allocUid(project),
		pattern: r.pattern.map((c) => (c === selfValue ? g.name : c === oldForbid ? newForbid : c)),
		tileIds: [...r.tileIds],
		outOfBoundsValue: r.outOfBoundsValue === selfValue ? g.name : r.outOfBoundsValue
	}));
	return g;
}

/** A new, empty enum (caller fills in a unique identifier). */
export function makeEnum(project: SvLevelProject, identifier: string): SvEnum {
	return {
		uid: allocUid(project),
		identifier,
		values: []
	};
}

/** A new tileset def; cWid/cHei are derived from the image size + grid metrics. */
export function makeTileset(
	project: SvLevelProject,
	opts: {
		identifier: string;
		relPath: string;
		pxWid: number;
		pxHei: number;
		tileGridSize?: number;
		spacing?: number;
		padding?: number;
	}
): SvTileset {
	const tileGridSize = opts.tileGridSize ?? project.defaultGridSize;
	const spacing = opts.spacing ?? 0;
	const padding = opts.padding ?? 0;
	const cWid = Math.max(
		0,
		Math.floor((opts.pxWid - padding * 2 + spacing) / (tileGridSize + spacing))
	);
	const cHei = Math.max(
		0,
		Math.floor((opts.pxHei - padding * 2 + spacing) / (tileGridSize + spacing))
	);
	return {
		uid: allocUid(project),
		identifier: opts.identifier,
		relPath: opts.relPath,
		pxWid: opts.pxWid,
		pxHei: opts.pxHei,
		tileGridSize,
		spacing,
		padding,
		cWid,
		cHei,
		tagsEnumId: null,
		enumTags: [],
		customData: [],
		tileColliders: []
	};
}

/** A new, empty layer def of the given type. */
export function makeLayerDef(
	project: SvLevelProject,
	type: SvLayerType,
	identifier: string
): SvLayerDef {
	return {
		uid: allocUid(project),
		identifier,
		type,
		gridSize: project.defaultGridSize,
		opacity: 1,
		pxOffsetX: 0,
		pxOffsetY: 0,
		// IdGrid/AutoLayer draw per-group tilesets; only Tiles layers own a layer tileset.
		tilesetDefUid: type === 'Tiles' ? (project.tilesets[0]?.uid ?? null) : null,
		autoSourceLayerDefUid: null
	};
}

/** A placed entity instance, filled with its type's default field values. */
export function makeEntity(
	project: SvLevelProject,
	typeId: string,
	px: [number, number]
): SvEntityInstance {
	const def = getEntityType(project, typeId);
	return {
		iid: uuid(),
		type: typeId,
		px,
		width: def?.width ?? 16,
		height: def?.height ?? 16,
		fields: defaultEntityFields(project, typeId)
	};
}

/** A brand-new, empty project (used by "New project"). */
export function emptyProject(gridSize = 16): SvLevelProject {
	const project: SvLevelProject = {
		format: SVLEVEL_FORMAT,
		version: SVLEVEL_VERSION,
		iid: uuid(),
		nextUid: 1,
		defaultGridSize: gridSize,
		bgColor: '#1a1a22',
		defaultLevelBgColor: '#2b2b3a',
		world: { layout: 'Free', gridWidth: gridSize, gridHeight: gridSize },
		tilesets: [],
		enums: [],
		entities: [],
		collisionLayers: cloneDefaultLayers(),
		layers: [],
		autoRuleGroups: [],
		levelFields: [],
		levels: []
	};
	// One IdGrid + one Entities layer to start.
	project.layers.push(makeLayerDef(project, 'IdGrid', 'IdGrid'));
	project.layers.push(makeLayerDef(project, 'Entities', 'Entities'));
	project.levels.push(makeLevel(project, { identifier: 'Level_0', pxWid: 16 * 16, pxHei: 16 * 9 }));
	return project;
}

/** Re-sync a level's layer instances with the project layer defs (add/remove/reorder). */
export function reconcileLevelLayers(project: SvLevelProject, level: SvLevel): void {
	const byDef = new Map(level.layers.map((li) => [li.layerDefUid, li]));
	level.layers = project.layers.map((def) => {
		const existing = byDef.get(def.uid);
		if (existing) {
			// Keep stored content but refresh denormalised def fields.
			existing.identifier = def.identifier;
			existing.type = def.type;
			existing.gridSize = def.gridSize;
			existing.tilesetDefUid = def.tilesetDefUid ?? null;
			return existing;
		}
		return makeLayerInstance(def, level.pxWid, level.pxHei);
	});
}

export { getLayerDef };
