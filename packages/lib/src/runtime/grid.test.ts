/** Self-check for the collider merge + nav grid. Run: `node --experimental-strip-types check.ts` */
import assert from 'node:assert';
import type { SvLayerInstance, SvLevel, SvLevelProject, SvTileset } from '../format/types.ts';
import { buildNavGrid, tileColliderRects, type TileMask } from './grid.ts';

const tileset = {
	uid: 1,
	identifier: 'T',
	relPath: 't.png',
	pxWid: 16,
	pxHei: 16,
	tileGridSize: 16,
	spacing: 0,
	padding: 0,
	cWid: 1,
	cHei: 1,
	enumTags: [{ enumValueId: 'spike', tileIds: [3] }],
	customData: [],
	tileColliders: [
		{ tileId: 0, shape: 'rect', sensor: false, group: 'DEFAULT' },
		{ tileId: 1, shape: 'rect', sensor: true, group: 'DEFAULT' },
		{ tileId: 2, shape: 'pixel', sensor: false, group: 'DEFAULT' },
		{ tileId: 3, shape: 'rect', sensor: false, group: 'DEFAULT' }
	]
} satisfies SvTileset;

const TILE_ID: Record<string, number> = { '#': 0, '!': 1, p: 2, s: 3 };

/** Bottom half of tile 2 is opaque; every other tile is empty (never asked for). */
const halfMask: TileMask = (_uid, tileId) => {
	const m = new Uint8Array(16 * 16);
	if (tileId === 2) m.fill(1, 8 * 16);
	return m;
};

/** `#` = solid, `!` = sensor, `p` = pixel-shaped, `s` = spike-tagged solid, `.` = empty. */
function level(rows: string[]): { project: SvLevelProject; level: SvLevel } {
	const layer = {
		layerDefUid: 1,
		identifier: 'Tiles',
		type: 'Tiles',
		gridSize: 16,
		cWid: rows[0]!.length,
		cHei: rows.length,
		visible: true,
		opacity: 1,
		pxOffsetX: 0,
		pxOffsetY: 0,
		tilesetDefUid: 1,
		idGrid: [],
		gridTiles: rows.flatMap((row, y) =>
			[...row].flatMap((c, x) =>
				c === '.' ? [] : [{ px: [x * 16, y * 16] as [number, number], src: [0, 0] as [number, number], t: TILE_ID[c]!, f: 0 as const, a: 1 }]
			)
		),
		autoTiles: [],
		entities: []
	} satisfies SvLayerInstance;
	const lvl: SvLevel = {
		uid: 0,
		iid: 'l',
		identifier: 'L',
		worldX: 0,
		worldY: 0,
		pxWid: layer.cWid * 16,
		pxHei: layer.cHei * 16,
		fields: {},
		layers: [layer]
	};
	const project: SvLevelProject = {
		format: 'svlevel',
		version: 1,
		iid: 'p',
		nextUid: 2,
		defaultGridSize: 16,
		bgColor: '#000',
		defaultLevelBgColor: '#000',
		world: { layout: 'Free', gridWidth: 16, gridHeight: 16 },
		tilesets: [tileset],
		enums: [],
		layers: [{ uid: 1, identifier: 'Tiles', type: 'Tiles', gridSize: 16, opacity: 1, pxOffsetX: 0, pxOffsetY: 0, tilesetDefUid: 1 }],
		autoRuleGroups: [],
		levelFields: [],
		levels: [lvl]
	};
	return { project, level: lvl };
}

{
	// A 4x2 solid block merges into ONE cuboid, not eight.
	const { project, level: lvl } = level(['####', '####']);
	const rects = tileColliderRects(project, lvl);
	assert.equal(rects.length, 1);
	assert.deepEqual({ ...rects[0]!, config: undefined, tags: undefined }, { x: 0, y: 0, w: 64, h: 32, config: undefined, tags: undefined });
}

{
	// Sensors never merge into solids.
	const rects = tileColliderRects(...Object.values(level(['##!!'])) as [SvLevelProject, SvLevel]);
	assert.equal(rects.length, 2);
	assert.deepEqual(rects.map((r) => r.w).sort(), [32, 32]);
}

{
	// An L: the greedy pass can't cover it with one rect, but must not overlap either.
	const { project, level: lvl } = level(['#..', '###']);
	const rects = tileColliderRects(project, lvl);
	assert.equal(rects.length, 2);
	assert.equal(rects.reduce((a, r) => a + (r.w / 16) * (r.h / 16), 0), 4);
}

{
	//  row 0 empty (headroom), row 1 empty = walkable, row 2 solid ground; the pit at x=2 is not.
	const { project, level: lvl } = level(['.....', '.....', '##.##']);
	const nav = buildNavGrid(project, lvl);
	assert.deepEqual([...nav.walkable], [0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 0]);
	// The pit splits the floor into two components.
	assert.ok(!nav.connected(nav.cellAt(16, 16), nav.cellAt(3 * 16, 16)));
	assert.ok(nav.connected(nav.cellAt(0, 16), nav.cellAt(16, 16)));
}

{
	// `pixel` shape follows the tile's opaque mask (bottom half), one rect per cell.
	const { project, level: lvl } = level(['pp']);
	const rects = tileColliderRects(project, lvl, halfMask);
	assert.equal(rects.length, 2);
	assert.deepEqual(
		rects.map((r) => [r.x, r.y, r.w, r.h]),
		[
			[0, 8, 16, 8],
			[16, 8, 16, 8]
		]
	);
	// Without a mask a `pixel` tile degrades to the full cell (and merges like a `rect`).
	const plain = tileColliderRects(project, lvl);
	assert.deepEqual(plain.map((r) => [r.x, r.y, r.w, r.h]), [[0, 0, 32, 16]]);
}

{
	// Same collider config, different enum tag -> separate colliders, tags preserved.
	const { project, level: lvl } = level(['#s']);
	const rects = tileColliderRects(project, lvl);
	assert.equal(rects.length, 2);
	assert.deepEqual(rects.find((r) => r.x === 16)!.tags, ['spike']);
	assert.deepEqual(rects.find((r) => r.x === 0)!.tags, []);
}

console.log('grid: OK');
