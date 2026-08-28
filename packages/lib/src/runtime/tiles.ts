/**
 * Tile rendering: one pixi `Mesh` per (layer, tileset) pair. The shader reproduces the editor's
 * two tile tricks — per-tile random mirroring (hashed from the cell, `tileFlips` chances) and a
 * per-pixel UV shove clamped to the tile's atlas cell (`tileWarps`) — so a repeated fill doesn't
 * read as a grid.
 */

import { Container, Geometry, Mesh, Shader, UniformGroup, type Texture } from 'pixi.js';
import { resolvedTileFlip, tileBatches, type TileBatch } from './grid';
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

void main() {
	mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
	gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
	vUV = aUV;
	vBounds = aBounds;
	vPx = aPosition;
	vAlpha = aAlpha;
	vFlip = aFlip;
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

/** WebGPU equivalent of the WebGL shader above. Resource names intentionally match both paths. */
const WGSL = /* wgsl */ `
struct GlobalUniforms {
	uProjectionMatrix: mat3x3<f32>,
	uWorldTransformMatrix: mat3x3<f32>,
	uWorldColorAlpha: vec4<f32>,
	uResolution: vec2<f32>,
}

struct LocalUniforms {
	uTransformMatrix: mat3x3<f32>,
	uColor: vec4<f32>,
	uRound: f32,
}

struct TileUniforms {
	uTexel: vec2<f32>,
	uNoiseFreq: f32,
}

@group(0) @binding(0) var<uniform> globalUniforms: GlobalUniforms;
@group(1) @binding(0) var<uniform> localUniforms: LocalUniforms;
@group(2) @binding(0) var uTexture: texture_2d<f32>;
@group(2) @binding(1) var uSampler: sampler;
@group(2) @binding(2) var<uniform> tileUniforms: TileUniforms;

struct VertexOutput {
	@builtin(position) position: vec4<f32>,
	@location(0) uv: vec2<f32>,
	@location(1) bounds: vec4<f32>,
	@location(2) flip: vec3<f32>,
	@location(3) px: vec2<f32>,
	@location(4) alpha: f32,
}

@vertex
fn mainVertex(
	@location(0) aPosition: vec2<f32>,
	@location(1) aUV: vec2<f32>,
	@location(2) aBounds: vec4<f32>,
	@location(3) aFlip: vec3<f32>,
	@location(4) aCell: vec2<f32>,
	@location(5) aAlpha: f32,
) -> VertexOutput {
	let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
	let projected = mvp * vec3<f32>(aPosition, 1.0);
	return VertexOutput(
		vec4<f32>(projected.xy, 0.0, 1.0),
		aUV,
		aBounds,
		aFlip,
		aPosition,
		aAlpha,
	);
}

fn hash21(p: vec2<f32>) -> f32 {
	return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn valueNoise(p: vec2<f32>) -> f32 {
	let i = floor(p);
	let f = fract(p);
	let u = f * f * (vec2<f32>(3.0) - 2.0 * f);
	return mix(
		mix(hash21(i), hash21(i + vec2<f32>(1.0, 0.0)), u.x),
		mix(hash21(i + vec2<f32>(0.0, 1.0)), hash21(i + vec2<f32>(1.0, 1.0)), u.x),
		u.y,
	) * 2.0 - 1.0;
}

@fragment
fn mainFragment(input: VertexOutput) -> @location(0) vec4<f32> {
	var uv = vec2<f32>(
		mix(input.uv.x, input.bounds.x + input.bounds.z - input.uv.x, input.flip.x),
		mix(input.uv.y, input.bounds.y + input.bounds.w - input.uv.y, input.flip.y),
	);
	let n = floor(input.px) * tileUniforms.uNoiseFreq;
	uv += floor(vec2<f32>(valueNoise(n), valueNoise(n + vec2<f32>(19.7))) * input.flip.z + vec2<f32>(0.5)) * tileUniforms.uTexel;
	uv = clamp(uv, input.bounds.xy + tileUniforms.uTexel * 0.25, input.bounds.zw - tileUniforms.uTexel * 0.25);
	let tex = textureSample(uTexture, uSampler, uv);
	if (tex.a < 0.01) { discard; }
	return tex * localUniforms.uColor * globalUniforms.uWorldColorAlpha * input.alpha;
}
`;

const num = (m: Map<number, number>, id: number, fallback: number): number => m.get(id) ?? fallback;

function batchGeometry(batch: TileBatch, tileSize: number): Geometry {
	const { tileset, tiles } = batch;
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
		const finalFlip = resolvedTileFlip(tileset, t, tileSize);
		const [a0, a1] = finalFlip & 1 ? [u1, u0] : [u0, u1];
		const [b0, b1] = finalFlip & 2 ? [v1, v0] : [v0, v1];

		const base = pos.length / 2;
		pos.push(x, y, x + tileSize, y, x + tileSize, y + tileSize, x, y + tileSize);
		uv.push(a0, b0, a1, b0, a1, b1, a0, b1);
		const cx = Math.floor(x / tileSize);
		const cy = Math.floor(y / tileSize);
		const f: [number, number, number] = [0, 0, num(warps, t.t, TILE_WARP_DEFAULT)];
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
		gpu: {
			vertex: { source: WGSL, entryPoint: 'mainVertex' },
			fragment: { source: WGSL, entryPoint: 'mainFragment' }
		},
		resources: {
			uTexture: texture.source,
			uSampler: texture.source.style,
			tileUniforms: new UniformGroup({
				uTexel: { value: [1 / batch.tileset.pxWid, 1 / batch.tileset.pxHei], type: 'vec2<f32>' },
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
