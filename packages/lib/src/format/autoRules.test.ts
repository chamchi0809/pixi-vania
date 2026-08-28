/**
 * Self-check for the per-tileset batching in `computeAutoTiles`.
 * Run: `node --experimental-strip-types src/lib/level/autoRules.test.ts`
 */
import assert from 'node:assert';
import { ANYTHING, computeAutoTiles, type TilesetGridInfo } from './autoRules.ts';
import type { SvAutoRule, SvAutoRuleGroup } from './types';

const ts: TilesetGridInfo = { cWid: 16, tileGridSize: 16, padding: 0, spacing: 0 };
const tilesets = new Map<number, TilesetGridInfo>([
	[100, ts],
	[200, ts]
]);

const rule = (uid: number, pattern: string[], tileIds: number[], breakOnMatch = true): SvAutoRule => ({
	uid,
	active: true,
	size: 1,
	pattern,
	tileIds,
	chance: 1,
	breakOnMatch,
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
	outOfBoundsValue: null,
	perlinActive: false,
	perlinSeed: 0,
	perlinScale: 0.2,
	perlinOctaves: 2
});

const group = (uid: number, tilesetDefUid: number, rules: SvAutoRule[]): SvAutoRuleGroup => ({
	uid,
	name: `g${uid}`,
	active: true,
	color: '#fff',
	tilesetDefUid,
	rules
});

// 1) Two groups, two tilesets -> two batches, ordered by group order.
{
	const batches = computeAutoTiles({
		grid: ['a', 'b'],
		cWid: 2,
		cHei: 1,
		gridSize: 16,
		tilesets,
		groups: [group(1, 100, [rule(10, ['a'], [0])]), group(2, 200, [rule(11, ['b'], [5])])]
	});
	assert.deepStrictEqual(
		batches.map((b) => b.tilesetDefUid),
		[100, 200]
	);
	assert.strictEqual(batches[0]!.tiles.length, 1);
	assert.strictEqual(batches[1]!.tiles.length, 1);
	assert.strictEqual(batches[1]!.tiles[0]!.t, 5);
}

// 2) breakOnMatch is group-local: independent groups may both emit on the same cell.
{
	const batches = computeAutoTiles({
		grid: ['a'],
		cWid: 1,
		cHei: 1,
		gridSize: 16,
		tilesets,
		groups: [
			group(1, 100, [rule(10, [ANYTHING], [0], true)]),
			group(2, 200, [rule(11, [ANYTHING], [9], true)])
		]
	});
	assert.strictEqual(batches.length, 2);
	assert.strictEqual(batches[0]!.tilesetDefUid, 100);
	assert.strictEqual(batches[1]!.tilesetDefUid, 200);
}

// 5) chance 0 never fires, including the hash's exact-zero cell/seed boundary.
{
	const never = rule(0, [ANYTHING], [7]);
	never.chance = 0;
	const batches = computeAutoTiles({
		grid: ['a'], cWid: 1, cHei: 1, gridSize: 16, tilesets,
		groups: [group(0, 100, [never])], seed: 0
	});
	assert.strictEqual(batches.length, 0);
}

// 3) Group whose tileset is missing from the map emits nothing.
{
	const batches = computeAutoTiles({
		grid: ['a'],
		cWid: 1,
		cHei: 1,
		gridSize: 16,
		tilesets,
		groups: [group(1, 999, [rule(10, [ANYTHING], [0])])]
	});
	assert.strictEqual(batches.length, 0);
}

// 4) String pattern sentinels: require id, '!*' (empty) and '*' (any filled) on one row.
{
	const batches = computeAutoTiles({
		grid: ['a', 'b', ''],
		cWid: 3,
		cHei: 1,
		gridSize: 16,
		tilesets,
		groups: [
			group(1, 100, [
				rule(20, ['a'], [1]), // require exactly 'a' -> cell 0
				rule(21, ['!*'], [2]), // empty cell -> cell 2
				rule(22, ['*'], [3]) // any remaining filled -> cell 1
			])
		]
	});
	const byCell = new Map(batches[0]!.tiles.map((t) => [t.px[0] / 16, t.t] as const));
	assert.deepStrictEqual(
		[byCell.get(0), byCell.get(1), byCell.get(2)],
		[1, 3, 2]
	);
}

console.log('autoRules batching: OK');
