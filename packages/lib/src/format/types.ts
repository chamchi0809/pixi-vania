/**
 * `.svlevel` — native level format (LDtk-feature-compatible). Coords match LDtk: pixels are
 * level-local, top-left origin, Y-down. The runtime keeps Y-down and only divides by grid size to
 * reach physics units (1 grid cell == 1 unit), so gravity's Y is positive. Entity types live in
 * the file itself (`project.entities`), so a project is self-describing.
 */

export const SVLEVEL_FORMAT = 'svlevel' as const;
export const SVLEVEL_VERSION = 1 as const;

/** Default per-pixel UV-warp amplitude in texels; tiles without an explicit warp use this. */
export const TILE_WARP_DEFAULT = 2;

export type SvLayerType = 'IdGrid' | 'Tiles' | 'AutoLayer' | 'Entities';

export type WorldLayout = 'Free' | 'GridVania' | 'LinearHorizontal' | 'LinearVertical';

/** Flip bits, identical to LDtk: bit 0 = X flip, bit 1 = Y flip. */
export type FlipBits = 0 | 1 | 2 | 3;

export interface SvEnumValue {
	id: string;
	/** `#rrggbb`, optional UI color. */
	color?: string;
	/** Optional tile preview: `[tilesetUid, x, y, w, h]` in tileset pixels. */
	tile?: SvTileRect | null;
}

export interface SvEnum {
	uid: number;
	identifier: string;
	values: SvEnumValue[];
}

/** A rectangular slice of a tileset, in tileset pixel space. */
export interface SvTileRect {
	tilesetUid: number;
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface SvEnumTag {
	enumValueId: string;
	/** Tile ids (cell index, row-major within the tileset grid) carrying this tag. */
	tileIds: number[];
}

export interface SvTileCustomData {
	tileId: number;
	data: string;
}

/** Per-tile random UV-mirror config (drives the runtime tile-flip shader). Probabilities in 0..1. */
export interface SvTileFlip {
	/** Tileset cell index (row-major within the tileset grid). */
	tileId: number;
	chanceX: number;
	chanceY: number;
}

/** Per-tile pixel-warp override in texels (0 = off). Tiles without one use `TILE_WARP_DEFAULT`. */
export interface SvTileWarp {
	/** Tileset cell index (row-major within the tileset grid). */
	tileId: number;
	warp: number;
}

/**
 * User-definable collision layer (interaction group). Order in `collisionLayers` sets each layer's
 * Rapier group bit (index 0 = bit 0). See `./collisionLayers`.
 */
export interface SvCollisionLayer {
	/** Stable id referenced by `SvTileCollider.group` and the player ('DEFAULT'/'WHITE'/'BLACK'). */
	id: string;
	name: string;
	/** `#rrggbb` swatch used in the editor. */
	color: string;
	/**
	 * Layers this collides with (symmetric matrix row), including own id for self-collision. When
	 * omitted, runtime falls back to: DEFAULT collides with all; any other only with DEFAULT + self.
	 */
	collidesWith?: string[];
}

/**
 * Collider shape for a tileset tile. `rect` = one full-cell cuboid. `pixel` = cuboids merged from
 * the tile's opaque pixels (needs a `TileMask`; `createLevelRuntime` builds one from the tileset).
 */
export type TileColliderShape = 'rect' | 'pixel';

/** Per-tile collider configuration. Tiles without an entry get no collider. */
export interface SvTileCollider {
	/** Tileset cell index (row-major within the tileset grid). */
	tileId: number;
	shape: TileColliderShape;
	/** Sensor colliders report overlaps but never resolve contacts (no push-back). */
	sensor: boolean;
	/**
	 * Collision layer id (references `collisionLayers`), drives the Rapier group bitmask. Missing or
	 * unknown id falls back to `'DEFAULT'` (collides with everything). See `./collisionLayers`.
	 */
	group?: string;
}

export interface SvTileset {
	uid: number;
	identifier: string;
	/** Path to the image, relative to the `.svlevel` file. */
	relPath: string;
	/** Full image dimensions in pixels. */
	pxWid: number;
	pxHei: number;
	tileGridSize: number;
	spacing: number;
	padding: number;
	/** Cached grid dimensions in tiles (`floor((px - padding*2 + spacing) / (grid + spacing))`). */
	cWid: number;
	cHei: number;
	/** Enum whose values can tag tiles (drives runtime collider selection). */
	tagsEnumId?: string | null;
	enumTags: SvEnumTag[];
	customData: SvTileCustomData[];
	/** Per-tile collider config. Optional for older files / LDtk converter; missing = empty. */
	tileColliders?: SvTileCollider[];
	/** Per-tile random-flip config (UV mirror). Missing/empty = no flipping. */
	tileFlips?: SvTileFlip[];
	/** Per-tile pixel-warp overrides. Missing/empty = every tile warps at `TILE_WARP_DEFAULT`. */
	tileWarps?: SvTileWarp[];
	/** Fixed seed for the per-tile flip hash; same seed → same pattern. Default 0. */
	flipSeed?: number;
}

/**
 * Pattern cell semantics (row-major, length = size*size): `''` = wildcard; a group id = must equal
 * it; `'!'+id` = must NOT equal it; `'*'` = any filled; `'!*'` = empty. OOB cells use
 * `outOfBoundsValue` (null = the evaluated cell's own value).
 */
export interface SvAutoRule {
	uid: number;
	active: boolean;
	/** Odd pattern size: 1, 3, 5 or 7. */
	size: number;
	pattern: string[];
	/** Candidate tile ids; one is chosen (seeded-random) per matching cell. */
	tileIds: number[];
	/** 0..1 probability the rule fires on a matching cell. */
	chance: number;
	/** Stop evaluating further rules in the group once this one matches a cell. */
	breakOnMatch: boolean;
	/** Auto-generate X / Y mirrored variants of the pattern. */
	flipX: boolean;
	flipY: boolean;
	xModulo: number;
	yModulo: number;
	xOffset: number;
	yOffset: number;
	tileXOffset: number;
	tileYOffset: number;
	checker: 'None' | 'Horizontal' | 'Vertical';
	/**
	 * `computeAutoTiles` renders only `'Single'` (one tile/cell). `'Stamp'` + pivot are carried for
	 * LDtk round-trip but render as a single tile, not expanded. Editor only authors `'Single'`.
	 */
	tileMode: 'Single' | 'Stamp';
	pivotX: number;
	pivotY: number;
	outOfBoundsValue: string | null;
	perlinActive: boolean;
	perlinSeed: number;
	perlinScale: number;
	perlinOctaves: number;
}

/**
 * A self-contained auto-tile brush, stored globally on the project. Its `name` is its id: painting
 * that id into any IdGrid layer makes its rules stamp tiles from its own `tilesetDefUid`. Rules key
 * off the id as the "self" value and may reference other groups' ids as neighbours. Names are unique.
 */
export interface SvAutoRuleGroup {
	uid: number;
	/** Unique id this group paints into IdGrid cells (also its display label). */
	name: string;
	active: boolean;
	/** `#rrggbb` swatch + IdGrid-overlay colour. */
	color: string;
	/** Tileset the group's rule tiles index into; null = no tiles until assigned. */
	tilesetDefUid?: number | null;
	rules: SvAutoRule[];
}

/** A reusable rule-group layout (rules + tileset) you can stamp into new groups. */
export interface SvAutoRulePreset {
	name: string;
	tilesetDefUid: number | null;
	rules: SvAutoRule[];
}

export interface SvLayerDef {
	uid: number;
	identifier: string;
	type: SvLayerType;
	gridSize: number;
	/** 0..1 render opacity. */
	opacity: number;
	pxOffsetX: number;
	pxOffsetY: number;
	/** Tiles layers: tileset for manual painting. IdGrid/AutoLayer draw per-group tilesets. */
	tilesetDefUid?: number | null;
	/** AutoLayer only: IdGrid layer (by def uid) feeding the rules; null for IdGrid (reads own grid). */
	autoSourceLayerDefUid?: number | null;
}

export type SvFieldType =
	| 'Int'
	| 'Float'
	| 'String'
	| 'MultiLines'
	| 'Bool'
	| 'Color'
	| 'Point'
	| 'Enum'
	| 'FilePath'
	/** Script edited by the dialogue editor, stored as a JSON string (see `./dialogue`). */
	| 'Dialogue';

export interface SvFieldDef {
	uid: number;
	identifier: string;
	type: SvFieldType;
	isArray: boolean;
	canBeNull: boolean;
	/** For `Enum` fields, the enum identifier. */
	enumId?: string | null;
	defaultValue?: unknown;
	min?: number | null;
	max?: number | null;
}

/** A concrete value for a field on a level or entity instance. */
export type SvFieldValue = unknown;

export interface SvTile {
	/** Top-left position in layer pixels (Y-down). */
	px: [number, number];
	/** Top-left source position in tileset pixels. */
	src: [number, number];
	/** Tile id (cell index in the tileset grid). */
	t: number;
	/** Flip bits. */
	f: FlipBits;
	/** Alpha 0..1. */
	a: number;
}

/** Auto-tiles grouped by the tileset they index into; one layer can mix several tilesets. */
export interface SvAutoTileBatch {
	tilesetDefUid: number;
	tiles: SvTile[];
}

export type EntityRenderMode = 'rect' | 'ellipse' | 'cross' | 'tile';

/** One field on an entity type. Simpler than `SvFieldDef` — no uid, defaults are inline. */
export interface SvEntityFieldDef {
	id: string;
	type: SvFieldType;
	default: SvFieldValue;
	/** For `Enum` fields, the project enum identifier this field draws from. */
	enumId?: string;
	/** Fixed choices for a `String` field — rendered as a dropdown, no project enum needed. */
	options?: string[];
	min?: number;
	max?: number;
	/** Feeds the string into the localization table (`String`/`MultiLines`/`Dialogue` only). */
	localized?: boolean;
	doc?: string;
}

/** A placeable entity type. Stored on the project, edited in the editor's Entities dialog. */
export interface SvEntityTypeDef {
	/** Stable id, referenced by `SvEntityInstance.type` and by the runtime spawner. */
	id: string;
	name: string;
	/** Default footprint in pixels (snapped to the grid in the editor). */
	width: number;
	height: number;
	/** `#rrggbb` — editor gizmo colour, also handed to the runtime spawner. */
	color: string;
	renderMode: EntityRenderMode;
	/** Pivot in 0..1 of the footprint. `[0,0]` = top-left (LDtk default). */
	pivot: [number, number];
	resizableX?: boolean;
	resizableY?: boolean;
	fields: SvEntityFieldDef[];
	/** Groups the palette. */
	category?: string;
	doc?: string;
}

export interface SvEntityInstance {
	iid: string;
	/** `SvEntityTypeDef.id`. */
	type: string;
	/** Top-left position in level pixels (Y-down). */
	px: [number, number];
	width: number;
	height: number;
	/** field id -> value (keyed by the type's `fields`). */
	fields: Record<string, SvFieldValue>;
}

export interface SvLayerInstance {
	layerDefUid: number;
	/** Denormalised from the def for convenient runtime access. */
	identifier: string;
	type: SvLayerType;
	gridSize: number;
	/** Grid dimensions in cells. */
	cWid: number;
	cHei: number;
	visible: boolean;
	opacity: number;
	pxOffsetX: number;
	pxOffsetY: number;
	tilesetDefUid?: number | null;
	/** IdGrid layers: row-major group ids, `''` = empty. Length = cWid*cHei. */
	idGrid: string[];
	/** Tiles layers: manually painted tiles. */
	gridTiles: SvTile[];
	/** IdGrid / AutoLayer: cached tiles from the rules, split into per-tileset batches. */
	autoTiles: SvAutoTileBatch[];
	/** Entities layers: placed entity instances. */
	entities: SvEntityInstance[];
}

export interface SvLevel {
	uid: number;
	iid: string;
	identifier: string;
	worldX: number;
	worldY: number;
	pxWid: number;
	pxHei: number;
	bgColor?: string | null;
	fields: Record<string, SvFieldValue>;
	/** One instance per layer def, ordered top (front) -> bottom (back). */
	layers: SvLayerInstance[];
}

export interface SvWorld {
	layout: WorldLayout;
	gridWidth: number;
	gridHeight: number;
}

/**
 * One localizable string. The source text IS the lookup `key`; `values` holds per-locale
 * translations keyed by locale code (e.g. `ko`). Base locale = the key; a missing locale falls back to it.
 */
export interface SvLocalizationEntry {
	key: string;
	values: Record<string, string>;
}

export interface SvLocalization {
	/** Translation columns, e.g. `['ko','ja']`. The base locale is the key itself. */
	locales?: string[];
	entries: SvLocalizationEntry[];
}

export interface SvLevelProject {
	format: typeof SVLEVEL_FORMAT;
	version: number;
	iid: string;
	/** Monotonic uid allocator; bump on every new def/level. */
	nextUid: number;
	defaultGridSize: number;
	bgColor: string;
	defaultLevelBgColor: string;
	world: SvWorld;
	tilesets: SvTileset[];
	enums: SvEnum[];
	/** User-definable collision layers; absent falls back to seeded DEFAULT/WHITE/BLACK. */
	collisionLayers?: SvCollisionLayer[];
	/** Placeable entity types. Absent in older files -> nothing to place. */
	entities?: SvEntityTypeDef[];
	/** Layer definitions, ordered top (front) -> bottom (back). */
	layers: SvLayerDef[];
	/** Global auto-tile brushes; each owns its unique id (name), colour, tileset, and rules. */
	autoRuleGroups: SvAutoRuleGroup[];
	/** Saved group layouts reusable as templates; absent in older files. */
	autoRulePresets?: SvAutoRulePreset[];
	/** Fields present on every level. */
	levelFields: SvFieldDef[];
	levels: SvLevel[];
	/** Translation table for entity text (Sign/Dialogue); absent in older files (shows authored text). */
	localization?: SvLocalization;
}

export const getLayerDef = (project: SvLevelProject, uid: number): SvLayerDef | undefined =>
	project.layers.find((l) => l.uid === uid);

export const getTileset = (
	project: SvLevelProject,
	uid: number | null | undefined
): SvTileset | undefined => (uid == null ? undefined : project.tilesets.find((t) => t.uid === uid));

export const getEnum = (
	project: SvLevelProject,
	id: string | null | undefined
): SvEnum | undefined => (id == null ? undefined : project.enums.find((e) => e.identifier === id));

/** Per-tile collider config for one tileset cell, or undefined when the tile has none. */
export const getTileCollider = (tileset: SvTileset, tileId: number): SvTileCollider | undefined =>
	tileset.tileColliders?.find((c) => c.tileId === tileId);

/** Tileset cell index -> top-left source pixel. */
export const tileIdToSrc = (tileset: SvTileset, tileId: number): [number, number] => {
	const col = tileId % tileset.cWid;
	const row = Math.floor(tileId / tileset.cWid);
	return [
		tileset.padding + col * (tileset.tileGridSize + tileset.spacing),
		tileset.padding + row * (tileset.tileGridSize + tileset.spacing)
	];
};

/** Top-left source pixel -> tileset cell index. */
export const srcToTileId = (tileset: SvTileset, src: [number, number]): number => {
	const col = Math.round((src[0] - tileset.padding) / (tileset.tileGridSize + tileset.spacing));
	const row = Math.round((src[1] - tileset.padding) / (tileset.tileGridSize + tileset.spacing));
	return row * tileset.cWid + col;
};

export const getEntityTypeDef = (
	project: SvLevelProject,
	id: string
): SvEntityTypeDef | undefined => project.entities?.find((t) => t.id === id);
