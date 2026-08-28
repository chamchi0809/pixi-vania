/**
 * Loads one `.svlevel` level into a Pixi `Container` + Rapier colliders. Asset selection/loading is
 * injectable: hosts may use Pixi, a synchronous cache, progress UI, cancellation, placeholders, or
 * their own streaming layer without changing runtime creation.
 */
import { Assets, Container, Graphics, Mesh, type Texture } from 'pixi.js';
import type { RigidBody, World } from '@dimforge/rapier2d-compat';
import {
	getEntityTypeDef,
	type SvEntityInstance,
	type SvEntityTypeDef,
	type SvFieldValue,
	type SvLevel,
	type SvLevelProject,
	type SvTileset
} from '../format/types';
import { defaultEntityFields } from '../format/entities';
import { resolveAssetUrl, type BasePathKind } from './assetUrl.ts';
import { createLevelBody, createTileColliders, type TileCollider } from './collision';
import { buildNavGrid, tileBatches, type NavGrid } from './grid';
import { tileMaskFromTextures } from './mask';
import { buildTileLayers } from './tiles';

export interface PlacedEntity {
	instance: SvEntityInstance;
	def: SvEntityTypeDef | undefined;
	px: [number, number];
	world: [number, number];
	fields: Record<string, SvFieldValue>;
}

export type TilesetLoadStrategy = 'referenced' | 'all';
export type { BasePathKind } from './assetUrl.ts';
export type LoadProgressStatus = 'cached' | 'loading' | 'loaded' | 'fallback' | 'skipped' | 'failed';

export interface TilesetLoadProgress {
	loaded: number;
	total: number;
	status: LoadProgressStatus;
	tileset: SvTileset;
	url: string;
	error?: unknown;
}

export interface TilesetLoadContext {
	project: SvLevelProject;
	tileset: SvTileset;
	url: string;
	index: number;
	total: number;
	signal?: AbortSignal;
}

export type TilesetTextureLoader = (context: TilesetLoadContext) => Texture | Promise<Texture>;
export type TilesetTextureCache = (context: TilesetLoadContext) => Texture | undefined;
export type TilesetLoadErrorHandler = (
	error: unknown,
	context: TilesetLoadContext
) => Texture | undefined | Promise<Texture | undefined>;

export interface TilesetLoadingOptions {
	strategy?: TilesetLoadStrategy;
	/** Required with `strategy:'referenced'` when using `loadTilesetTextures` directly. */
	level?: SvLevel | number | string;
	basePath?: string;
	basePathKind?: BasePathKind;
	getCached?: TilesetTextureCache;
	load?: TilesetTextureLoader;
	onProgress?: (progress: TilesetLoadProgress) => void;
	/** Return a fallback texture, or undefined to skip. Default: throw. */
	onError?: TilesetLoadErrorHandler | 'skip' | 'throw';
	signal?: AbortSignal;
	concurrency?: number;
}

export interface SyncTilesetLoadingOptions
	extends Omit<TilesetLoadingOptions, 'load' | 'onError'> {
	getCached: TilesetTextureCache;
	onError?: ((error: unknown, context: TilesetLoadContext) => Texture | undefined) | 'skip' | 'throw';
}

export interface LevelRuntimeOptions {
	world: World;
	stage?: Container;
	pixelsPerUnit?: number;
	/** Directory containing tilesets. Set `basePathKind:'project-file'` for a project file URL. */
	basePath?: string;
	basePathKind?: BasePathKind;
	textures?: ReadonlyMap<number, Texture>;
	loading?: Omit<TilesetLoadingOptions, 'level'>;
	navGrid?: boolean;
	/** A returned disposer is called during rollback/destroy. */
	onEntity?: (entity: PlacedEntity) => void | (() => void);
}

export interface SyncLevelRuntimeOptions extends Omit<LevelRuntimeOptions, 'loading'> {
	textures: ReadonlyMap<number, Texture>;
}

export interface LevelRuntime {
	level: SvLevel;
	container: Container;
	body: RigidBody;
	colliders: TileCollider[];
	navGrid: NavGrid | undefined;
	entities: PlacedEntity[];
	pixelsPerUnit: number;
	stats: {
		textures: number;
		colliders: number;
		entities: number;
	};
	/** Idempotent. */
	destroy(): void;
}

export { resolveAssetUrl } from './assetUrl.ts';

const findLevel = (project: SvLevelProject, id: number | string): SvLevel | undefined =>
	typeof id === 'number'
		? project.levels.find((level) => level.uid === id)
		: project.levels.find((level) => level.identifier === id);

function resolveLevel(
	project: SvLevelProject,
	level: SvLevel | number | string | undefined
): SvLevel | undefined {
	if (typeof level === 'object') return level;
	if (level == null) return undefined;
	return findLevel(project, level);
}

/** Tilesets used by visible tile/auto layers in one level, in stable project order. */
export function referencedTilesets(project: SvLevelProject, level: SvLevel): SvTileset[] {
	const used = new Set<number>();
	for (const layer of level.layers) {
		if (!layer.visible || layer.type === 'Entities') continue;
		for (const batch of tileBatches(project, layer)) used.add(batch.tileset.uid);
	}
	return project.tilesets.filter((tileset) => used.has(tileset.uid));
}

function selectedTilesets(project: SvLevelProject, opts: TilesetLoadingOptions): SvTileset[] {
	if ((opts.strategy ?? 'referenced') === 'all') return project.tilesets;
	const level = resolveLevel(project, opts.level);
	if (!level) throw new Error('referenced tileset loading requires a valid level');
	return referencedTilesets(project, level);
}

const abortIfNeeded = (signal?: AbortSignal): void => {
	if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
};

const contextFor = (
	project: SvLevelProject,
	tileset: SvTileset,
	index: number,
	total: number,
	opts: TilesetLoadingOptions
): TilesetLoadContext => ({
	project,
	tileset,
	url: resolveAssetUrl(opts.basePath ?? '', tileset.relPath, opts.basePathKind),
	index,
	total,
	...(opts.signal ? { signal: opts.signal } : {})
});

/** Cache-only loading for callers that require a fully synchronous startup path. */
export function loadTilesetTexturesSync(
	project: SvLevelProject,
	opts: SyncTilesetLoadingOptions
): Map<number, Texture> {
	const tilesets = selectedTilesets(project, opts);
	const out = new Map<number, Texture>();
	let loaded = 0;
	for (let index = 0; index < tilesets.length; index++) {
		abortIfNeeded(opts.signal);
		const tileset = tilesets[index]!;
		const context = contextFor(project, tileset, index, tilesets.length, opts);
		try {
			const texture = opts.getCached(context);
			if (!texture) throw new Error(`texture is not cached: ${context.url}`);
			out.set(tileset.uid, texture);
			loaded++;
			opts.onProgress?.({ loaded, total: tilesets.length, status: 'cached', tileset, url: context.url });
		} catch (error) {
			const fallback = typeof opts.onError === 'function' ? opts.onError(error, context) : undefined;
			let status: LoadProgressStatus = 'skipped';
			if (fallback) {
				out.set(tileset.uid, fallback);
				loaded++;
				status = 'fallback';
			} else if (opts.onError !== 'skip') {
				throw error;
			}
			opts.onProgress?.({ loaded, total: tilesets.length, status, tileset, url: context.url, error });
		}
	}
	return out;
}

/** Async/sync mixed loader with bounded concurrency, progress, fallback and cancellation. */
export async function loadTilesetTextures(
	project: SvLevelProject,
	basePathOrOptions: string | TilesetLoadingOptions = '',
	legacyOptions: Omit<TilesetLoadingOptions, 'basePath'> = {}
): Promise<Map<number, Texture>> {
	const opts: TilesetLoadingOptions =
		typeof basePathOrOptions === 'string'
			? { ...legacyOptions, basePath: basePathOrOptions, strategy: legacyOptions.strategy ?? 'all' }
			: basePathOrOptions;
	const tilesets = selectedTilesets(project, opts);
	const out = new Map<number, Texture>();
	const load = opts.load ?? ((context: TilesetLoadContext) => Assets.load<Texture>(context.url));
	const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 4));
	let cursor = 0;
	let loaded = 0;

	const worker = async () => {
		while (true) {
			const index = cursor++;
			if (index >= tilesets.length) return;
			abortIfNeeded(opts.signal);
			const tileset = tilesets[index]!;
			const context = contextFor(project, tileset, index, tilesets.length, opts);
			let texture: Texture | undefined;
			try {
				texture = opts.getCached?.(context);
				if (texture) {
					out.set(tileset.uid, texture);
					loaded++;
					opts.onProgress?.({ loaded, total: tilesets.length, status: 'cached', tileset, url: context.url });
					continue;
				}
				opts.onProgress?.({ loaded, total: tilesets.length, status: 'loading', tileset, url: context.url });
				texture = await load(context);
				abortIfNeeded(opts.signal);
				out.set(tileset.uid, texture);
				loaded++;
				opts.onProgress?.({ loaded, total: tilesets.length, status: 'loaded', tileset, url: context.url });
			} catch (error) {
				abortIfNeeded(opts.signal);
				if (typeof opts.onError === 'function') texture = await opts.onError(error, context);
				else if (opts.onError !== 'skip') {
					opts.onProgress?.({ loaded, total: tilesets.length, status: 'failed', tileset, url: context.url, error });
					throw error;
				}
				if (texture) {
					out.set(tileset.uid, texture);
					loaded++;
				}
				opts.onProgress?.({
					loaded,
					total: tilesets.length,
					status: texture ? 'fallback' : 'skipped',
					tileset,
					url: context.url,
					error
				});
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, tilesets.length) }, worker));
	return out;
}

function destroyContainer(container: Container): void {
	const releaseMeshes = (parent: Container) => {
		for (const child of parent.children) {
			if (child instanceof Mesh) {
				child.geometry.destroy();
				child.shader?.destroy();
			} else if (child instanceof Container) releaseMeshes(child);
		}
	};
	releaseMeshes(container);
	container.destroy({ children: true });
}

/** Build from already-available textures without scheduling asset work. */
export function createLevelRuntimeSync(
	project: SvLevelProject,
	levelId: number | string,
	opts: SyncLevelRuntimeOptions
): LevelRuntime {
	const level = findLevel(project, levelId);
	if (!level) throw new Error(`no such level: ${levelId}`);
	const ppu = opts.pixelsPerUnit ?? project.defaultGridSize;
	if (!Number.isFinite(ppu) || ppu <= 0) throw new Error('pixelsPerUnit must be positive');
	const container = buildTileLayers(project, level, opts.textures);
	let body: RigidBody | undefined;
	let attached = false;
	let destroyed = false;
	const entityDisposers: Array<() => void> = [];

	try {
		const bg = level.bgColor ?? project.defaultLevelBgColor;
		if (bg) container.addChildAt(new Graphics().rect(0, 0, level.pxWid, level.pxHei).fill(bg), 0);
		container.position.set(level.worldX, level.worldY);
		body = createLevelBody(opts.world, level, ppu);
		const mask = tileMaskFromTextures(project, opts.textures);
		const colliders = createTileColliders(opts.world, body, project, level, ppu, mask);
		const navGrid = opts.navGrid ? buildNavGrid(project, level, mask) : undefined;
		const entities: PlacedEntity[] = [];
		for (const layer of level.layers) {
			if (layer.type !== 'Entities' || !layer.visible) continue;
			for (const inst of layer.entities) {
				const def = getEntityTypeDef(project, inst.type);
				const [ox, oy] = def?.pivot ?? [0, 0];
				const px: [number, number] = [
					level.worldX + layer.pxOffsetX + inst.px[0] + inst.width * ox,
					level.worldY + layer.pxOffsetY + inst.px[1] + inst.height * oy
				];
				const entity: PlacedEntity = {
					instance: inst,
					def,
					px,
					world: [px[0] / ppu, px[1] / ppu],
					fields: { ...defaultEntityFields(project, inst.type), ...inst.fields }
				};
				entities.push(entity);
				const dispose = opts.onEntity?.(entity);
				if (dispose) entityDisposers.push(dispose);
			}
		}
		if (opts.stage) {
			opts.stage.addChild(container);
			attached = true;
		}

		const destroy = () => {
			if (destroyed) return;
			destroyed = true;
			for (let i = entityDisposers.length - 1; i >= 0; i--) {
				try { entityDisposers[i]!(); } catch { /* continue cleanup */ }
			}
			if (attached) container.removeFromParent();
			destroyContainer(container);
			opts.world.removeRigidBody(body!);
		};
		return {
			level, container, body, colliders, navGrid, entities, pixelsPerUnit: ppu,
			stats: { textures: opts.textures.size, colliders: colliders.length, entities: entities.length },
			destroy
		};
	} catch (error) {
		for (let i = entityDisposers.length - 1; i >= 0; i--) {
			try { entityDisposers[i]!(); } catch { /* continue rollback */ }
		}
		if (attached) container.removeFromParent();
		destroyContainer(container);
		if (body) opts.world.removeRigidBody(body);
		throw error;
	}
}

/** Lazy async convenience wrapper. Use `createLevelRuntimeSync` for preloaded/cache-only hosts. */
export async function createLevelRuntime(
	project: SvLevelProject,
	levelId: number | string,
	opts: LevelRuntimeOptions
): Promise<LevelRuntime> {
	const level = findLevel(project, levelId);
	if (!level) throw new Error(`no such level: ${levelId}`);
	const loading: TilesetLoadingOptions = {
		strategy: 'referenced',
		level,
		basePath: opts.loading?.basePath ?? opts.basePath ?? '',
		...(opts.loading?.basePathKind ?? opts.basePathKind
			? { basePathKind: (opts.loading?.basePathKind ?? opts.basePathKind)! }
			: {}),
		...opts.loading
	};
	const textures = new Map(opts.textures ?? []);
	const selected = loading.strategy === 'all' ? project.tilesets : referencedTilesets(project, level);
	const needed = selected.filter((tileset) => !textures.has(tileset.uid));
	if (needed.length) {
		const loaded = await loadTilesetTextures({ ...project, tilesets: needed }, { ...loading, strategy: 'all' });
		for (const [uid, texture] of loaded) textures.set(uid, texture);
	}
	abortIfNeeded(loading.signal);
	return createLevelRuntimeSync(project, levelId, { ...opts, textures });
}
