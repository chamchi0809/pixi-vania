/**
 * Auto-layer rule engine: deterministically computes tiles from an IdGrid + rules. Pure (no
 * DOM/Three.js). Pattern cells are group ids (strings): `''` = wildcard; `id` = equal id;
 * `'!'+id` = not id; `'*'` (ANYTHING) = any filled; `'!*'` = empty. Grid cells: `''` = empty.
 */

import type { FlipBits, SvAutoRule, SvAutoRuleGroup, SvAutoTileBatch, SvTile } from './types';

/** Pattern sentinel matching any non-empty cell. `'!'+ANYTHING` (`'!*'`) means "empty". */
export const ANYTHING = '*';

export interface TilesetGridInfo {
	cWid: number;
	tileGridSize: number;
	padding: number;
	spacing: number;
}

/** Stable hash -> [0,1). */
function rand01(x: number, y: number, seed: number): number {
	let h = seed | 0;
	h = Math.imul(h ^ Math.imul(x | 0, 0x1656667b), 0x9e3779b1);
	h = Math.imul(h ^ Math.imul(y | 0, 0x4c957f2d), 0x85ebca6b);
	h ^= h >>> 13;
	h = Math.imul(h, 0xc2b2ae35);
	h ^= h >>> 16;
	return (h >>> 0) / 4294967296;
}

/** Cheap value-noise "perlin" in [0,1], good enough for thinning rules. */
function valueNoise(x: number, y: number, seed: number): number {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const xf = x - xi;
	const yf = y - yi;
	const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
	const n00 = rand01(xi, yi, seed);
	const n10 = rand01(xi + 1, yi, seed);
	const n01 = rand01(xi, yi + 1, seed);
	const n11 = rand01(xi + 1, yi + 1, seed);
	const u = fade(xf);
	const v = fade(yf);
	return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

function fractalNoise(
	x: number,
	y: number,
	seed: number,
	scale: number,
	octaves: number
): number {
	let amp = 1;
	let freq = scale;
	let sum = 0;
	let norm = 0;
	for (let o = 0; o < Math.max(1, octaves); o++) {
		sum += amp * valueNoise(x * freq, y * freq, seed + o * 1013);
		norm += amp;
		amp *= 0.5;
		freq *= 2;
	}
	return sum / norm; // 0..1
}

interface FlipVariant {
	pattern: string[];
	flip: FlipBits;
}

function mirrorPattern(pattern: string[], size: number, fx: boolean, fy: boolean): string[] {
	const out = new Array<string>(pattern.length);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const sx = fx ? size - 1 - x : x;
			const sy = fy ? size - 1 - y : y;
			out[y * size + x] = pattern[sy * size + sx]!;
		}
	}
	return out;
}

/** All pattern orientations the rule should be tried in (LDtk auto-mirroring). */
function flipVariants(rule: SvAutoRule): FlipVariant[] {
	const variants: FlipVariant[] = [{ pattern: rule.pattern, flip: 0 }];
	if (rule.flipX) variants.push({ pattern: mirrorPattern(rule.pattern, rule.size, true, false), flip: 1 });
	if (rule.flipY) variants.push({ pattern: mirrorPattern(rule.pattern, rule.size, false, true), flip: 2 });
	if (rule.flipX && rule.flipY)
		variants.push({ pattern: mirrorPattern(rule.pattern, rule.size, true, true), flip: 3 });
	return variants;
}

function cellValue(
	grid: string[],
	cWid: number,
	cHei: number,
	x: number,
	y: number,
	oob: string | null,
	centerVal: string
): string {
	// Border outside the level is assumed to hold the same tile as the cell being
	// evaluated, so edge tiles pass "fully surrounded" conditions (explicit oob wins).
	if (x < 0 || y < 0 || x >= cWid || y >= cHei) return oob ?? centerVal;
	return grid[y * cWid + x] ?? '';
}

function matchOne(patternVal: string, gridVal: string): boolean {
	if (patternVal === '') return true; // wildcard
	if (patternVal[0] === '!') {
		const t = patternVal.slice(1);
		return t === ANYTHING ? gridVal === '' : gridVal !== t;
	}
	return patternVal === ANYTHING ? gridVal !== '' : gridVal === patternVal;
}

function patternMatches(
	pattern: string[],
	size: number,
	grid: string[],
	cWid: number,
	cHei: number,
	cx: number,
	cy: number,
	oob: string | null
): boolean {
	const radius = (size - 1) >> 1;
	const centerVal = grid[cy * cWid + cx] ?? '';
	let i = 0;
	for (let dy = -radius; dy <= radius; dy++) {
		for (let dx = -radius; dx <= radius; dx++) {
			const pv = pattern[i++]!;
			if (pv === '') continue;
			const gv = cellValue(grid, cWid, cHei, cx + dx, cy + dy, oob, centerVal);
			if (!matchOne(pv, gv)) return false;
		}
	}
	return true;
}

export interface ComputeAutoTilesOptions {
	grid: string[];
	cWid: number;
	cHei: number;
	groups: SvAutoRuleGroup[];
	/** Layer grid size in px (where tiles are placed). */
	gridSize: number;
	/** Per-group tileset metrics, keyed by tileset uid. Groups whose tileset is missing emit nothing. */
	tilesets: Map<number, TilesetGridInfo>;
	/** Extra seed (e.g. level seed) mixed into randomness. */
	seed?: number;
}

function tileSrc(tileset: TilesetGridInfo, tileId: number): [number, number] {
	const col = tileId % tileset.cWid;
	const row = Math.floor(tileId / tileset.cWid);
	return [
		tileset.padding + col * (tileset.tileGridSize + tileset.spacing),
		tileset.padding + row * (tileset.tileGridSize + tileset.spacing)
	];
}

function passesModulo(rule: SvAutoRule, cx: number, cy: number): boolean {
	const mod = (a: number, m: number) => (m <= 1 ? 0 : ((a % m) + m) % m);
	if (mod(cx - rule.xOffset, rule.xModulo) !== 0) return false;
	if (mod(cy - rule.yOffset, rule.yModulo) !== 0) return false;
	return true;
}

function passesChecker(rule: SvAutoRule, cx: number, cy: number): boolean {
	if (rule.checker === 'None') return true;
	if (rule.checker === 'Horizontal') return (cx + (cy % 2)) % 2 === 0;
	return (cy + (cx % 2)) % 2 === 0; // Vertical
}

/**
 * Compute auto-tiles for one IdGrid/AutoLayer, split into one batch per group tileset (insertion
 * order = group order, so later groups draw on top). `breakOnMatch` only stops later rules in the
 * same group, matching the format contract.
 */
export function computeAutoTiles(opts: ComputeAutoTilesOptions): SvAutoTileBatch[] {
	const { grid, cWid, cHei, groups, gridSize, tilesets, seed = 0 } = opts;
	// Per-tileset tile lists; insertion order preserved by Map.
	const batches = new Map<number, SvTile[]>();

	for (const group of groups) {
		if (!group.active) continue;
		const tsUid = group.tilesetDefUid;
		const tileset = tsUid != null ? tilesets.get(tsUid) : undefined;
		if (tsUid == null || !tileset) continue;
		let tiles = batches.get(tsUid);
		if (!tiles) batches.set(tsUid, (tiles = []));
		// A group is an independent rule stack. Other groups may still emit a tile at this cell.
		const stopped = new Uint8Array(cWid * cHei);
		for (const rule of group.rules) {
			if (!rule.active || rule.tileIds.length === 0) continue;
			const variants = flipVariants(rule);
			for (let cy = 0; cy < cHei; cy++) {
				for (let cx = 0; cx < cWid; cx++) {
					const cellIdx = cy * cWid + cx;
					if (stopped[cellIdx]) continue;
					if (!passesModulo(rule, cx, cy)) continue;
					if (!passesChecker(rule, cx, cy)) continue;

					// Try each orientation; first match wins.
					let matched: FlipVariant | undefined;
					for (const v of variants) {
						if (
							patternMatches(v.pattern, rule.size, grid, cWid, cHei, cx, cy, rule.outOfBoundsValue)
						) {
							matched = v;
							break;
						}
					}
					if (!matched || rule.chance <= 0) continue;

					// Probabilistic gates.
					if (rule.chance < 1 && rand01(cx, cy, rule.uid ^ seed) >= rule.chance) continue;
					if (rule.perlinActive) {
						const n = fractalNoise(
							cx,
							cy,
							rule.perlinSeed ^ seed,
							rule.perlinScale,
							rule.perlinOctaves
						);
						if (n < 0.5) continue;
					}

					// Pick a tile (seeded) from the candidate list.
					const pick =
						rule.tileIds.length === 1
							? 0
							: Math.min(
									rule.tileIds.length - 1,
									Math.floor(rand01(cx, cy, (rule.uid ^ seed) + 7) * rule.tileIds.length)
								);
					const tileId = rule.tileIds[pick]!;

					tiles.push({
						px: [cx * gridSize + rule.tileXOffset, cy * gridSize + rule.tileYOffset],
						src: tileSrc(tileset, tileId),
						t: tileId,
						f: matched.flip,
						a: 1
					});

					if (rule.breakOnMatch) stopped[cellIdx] = 1;
				}
			}
		}
	}

	return [...batches]
		.filter(([, tiles]) => tiles.length > 0)
		.map(([tilesetDefUid, tiles]) => ({ tilesetDefUid, tiles }));
}
