/**
 * Tile rendering: one pixi `Mesh` per (layer, tileset) pair. The shader reproduces the editor's
 * two tile tricks — per-tile random mirroring (hashed from the cell, `tileFlips` chances) and a
 * per-pixel UV shove clamped to the tile's atlas cell (`tileWarps`) — so a repeated fill doesn't
 * read as a grid.
 */

import { Container, Geometry, Mesh, Shader, Texture, UniformGroup } from 'pixi.js';
import { tileBatches, type TileBatch } from './grid';
import {
	TILE_WARP_DEFAULT,
	tileIdToSrc,
	type SvLevel,
	type SvLevelProject
} from '../format/types';

const VERTEX = /* glsl */ `#version 300 es
in vec2 aPosition;
in vec2 aUV;
in vec4 aBounds;
in vec3 aFlip;
in vec2 aCell;
in float aAlpha;

out vec2 vUV;
out vec4 vBounds;
out vec3 vFlip;
out vec2 vPx;
out float vAlpha;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform float uFlipSeed;

void main() {
	mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
	gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
	vUV = aUV;
	vBounds = aBounds;
	vPx = aPosition;
	vAlpha = aAlpha;
	// Decorrelated 0..1 per tile cell; mirror when it lands inside the tile's authored chance band.
	float hx = fract(sin(dot(aCell, vec2(127.1, 311.7)) + uFlipSeed) * 43758.5453);
	float hy = fract(sin(dot(aCell, vec2(269.5, 183.3)) + uFlipSeed) * 43758.5453);
	vFlip = vec3(step(1.0 - aFlip.x, hx), step(1.0 - aFlip.y, hy), aFlip.z);
}
`;

const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUV;
in vec4 vBounds;
in vec3 vFlip;
in vec2 vPx;
in float vAlpha;

out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec2 uTexel;
uniform float uNoiseFreq;
uniform vec4 uColor;
uniform vec4 uWorldColorAlpha;

float hash21(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// ponytail: value noise, not the editor's Perlin -- at +-2 texels of shove they look the same.
float vnoise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
	           mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x), u.y) * 2.0 - 1.0;
}

void main() {
	vec2 uv = vec2(
		mix(vUV.x, vBounds.x + vBounds.z - vUV.x, vFlip.x),
		mix(vUV.y, vBounds.y + vBounds.w - vUV.y, vFlip.y)
	);
	// Whole-texel shove only -- fractional offsets shimmer when the camera moves.
	vec2 n = floor(vPx) * uNoiseFreq;
	uv += floor(vec2(vnoise(n), vnoise(n + 19.7)) * vFlip.z + 0.5) * uTexel;
	// Quarter-texel inset keeps the sample (and the quad's own edge) inside this atlas cell.
	uv = clamp(uv, vBounds.xy + uTexel * 0.25, vBounds.zw - uTexel * 0.25);

	vec4 tex = texture(uTexture, uv);
	if (tex.a < 0.01) discard;
	finalColor = tex * uColor * uWorldColorAlpha * vAlpha;
}
`;

const num = (m: Map<number, number>, id: number, fallback: number): number => m.get(id) ?? fallback;

function batchGeometry(batch: TileBatch, tileSize: number): Geometry {
	const { tileset, tiles } = batch;
	const chanceX = new Map((tileset.tileFlips ?? []).map((f) => [f.tileId, f.chanceX]));
	const chanceY = new Map((tileset.tileFlips ?? []).map((f) => [f.tileId, f.chanceY]));
	const warps = new Map((tileset.tileWarps ?? []).map((w) => [w.tileId, w.warp]));

	const pos: number[] = [];
	const uv: number[] = [];
	const bounds: number[] = [];
	const flip: number[] = [];
	const cell: number[] = [];
	const alpha: number[] = [];
	const index: number[] = [];

	for (const t of tiles) {
		const [x, y] = t.px;
		const [sx, sy] = t.src ?? tileIdToSrc(tileset, t.t);
		const g = tileset.tileGridSize;
		const u0 = sx / tileset.pxWid;
		const v0 = sy / tileset.pxHei;
		const u1 = (sx + g) / tileset.pxWid;
		const v1 = (sy + g) / tileset.pxHei;
		// Authored per-tile flip (`t.f` bit 0 = X, bit 1 = Y) swaps the quad's own UV corners.
		const [a0, a1] = t.f & 1 ? [u1, u0] : [u0, u1];
		const [b0, b1] = t.f & 2 ? [v1, v0] : [v0, v1];

		const base = pos.length / 2;
		pos.push(x, y, x + tileSize, y, x + tileSize, y + tileSize, x, y + tileSize);
		uv.push(a0, b0, a1, b0, a1, b1, a0, b1);
		const cx = Math.floor(x / tileSize);
		const cy = Math.floor(y / tileSize);
		const f: [number, number, number] = [
			num(chanceX, t.t, 0),
			num(chanceY, t.t, 0),
			num(warps, t.t, TILE_WARP_DEFAULT)
		];
		for (let i = 0; i < 4; i++) {
			bounds.push(u0, v0, u1, v1);
			flip.push(f[0], f[1], f[2]);
			cell.push(cx, cy);
			alpha.push(t.a ?? 1);
		}
		index.push(base, base + 1, base + 2, base, base + 2, base + 3);
	}

	return new Geometry({
		attributes: {
			aPosition: { buffer: new Float32Array(pos), format: 'float32x2' },
			aUV: { buffer: new Float32Array(uv), format: 'float32x2' },
			aBounds: { buffer: new Float32Array(bounds), format: 'float32x4' },
			aFlip: { buffer: new Float32Array(flip), format: 'float32x3' },
			aCell: { buffer: new Float32Array(cell), format: 'float32x2' },
			aAlpha: { buffer: new Float32Array(alpha), format: 'float32' }
		},
		indexBuffer: new Uint32Array(index)
	});
}

/** Grain of the warp noise, in cycles per source pixel. Matches the editor's preview. */
export const TILE_NOISE_FREQ = 0.2;

function batchMesh(batch: TileBatch, tileSize: number, texture: Texture): Mesh<Geometry, Shader> {
	texture.source.scaleMode = 'nearest';
	const shader = Shader.from({
		gl: { vertex: VERTEX, fragment: FRAGMENT },
		resources: {
			uTexture: texture.source,
			uSampler: texture.source.style,
			tileUniforms: new UniformGroup({
				uTexel: { value: [1 / batch.tileset.pxWid, 1 / batch.tileset.pxHei], type: 'vec2<f32>' },
				uFlipSeed: { value: batch.tileset.flipSeed ?? 0, type: 'f32' },
				uNoiseFreq: { value: TILE_NOISE_FREQ, type: 'f32' }
			})
		}
	});
	return new Mesh({ geometry: batchGeometry(batch, tileSize), shader });
}

/**
 * Container of tile meshes for one level, in level-local pixels (top-left origin, Y-down).
 * `textures` is keyed by tileset uid; a batch whose texture is missing is skipped.
 */
export function buildTileLayers(
	project: SvLevelProject,
	level: SvLevel,
	textures: ReadonlyMap<number, Texture>
): Container {
	const root = new Container({ label: `level:${level.identifier}` });
	// Reverse: the editor lists layers top-first, pixi draws in child order.
	for (const layer of [...level.layers].reverse()) {
		if (layer.type === 'Entities' || !layer.visible) continue;
		const group = new Container({ label: layer.identifier });
		group.position.set(layer.pxOffsetX, layer.pxOffsetY);
		group.alpha = layer.opacity;
		for (const batch of tileBatches(project, layer)) {
			const texture = textures.get(batch.tileset.uid);
			if (texture) group.addChild(batchMesh(batch, layer.gridSize, texture));
		}
		if (group.children.length) root.addChild(group);
	}
	return root;
}
