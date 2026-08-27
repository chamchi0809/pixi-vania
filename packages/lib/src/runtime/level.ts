/**
 * Loads one `.svlevel` level into a pixi `Container` + Rapier colliders. Rendering and physics
 * share one coordinate space: level pixels for pixi, `pixels / pixelsPerUnit` for Rapier, both
 * Y-DOWN with the level's world offset applied (so gravity's Y is positive).
 */

import { Assets, Container, Graphics, Mesh, Texture } from 'pixi.js';
import type { RigidBody, World } from '@dimforge/rapier2d-compat';
import {
	getEntityTypeDef,
	type SvEntityInstance,
	type SvEntityTypeDef,
	type SvFieldValue,
	type SvLevel,
	type SvLevelProject
} from '../format/types';
import { defaultEntityFields } from '../format/entities';
import { createLevelBody, createTileColliders, type TileCollider } from './collision';
import { buildNavGrid, type NavGrid } from './grid';
import { tileMaskFromTextures } from './mask';
import { buildTileLayers } from './tiles';

/** A placed entity handed to `onEntity`; the library never spawns anything itself. */
export interface PlacedEntity {
	instance: SvEntityInstance;
	def: SvEntityTypeDef | undefined;
	/** Pivot point in level pixels (Y-down), level world offset included. */
	px: [number, number];
	/** The same point in physics units. */
	world: [number, number];
	/** Instance fields over the type's defaults — a field added after placement still reads. */
	fields: Record<string, SvFieldValue>;
}

export interface LevelRuntimeOptions {
	world: World;
	/** Parent for the level container. Omit to keep it detached. */
	stage?: Container;
	/** Pixels per physics unit. Default: `project.defaultGridSize` (1 tile == 1 unit). */
	pixelsPerUnit?: number;
	/** Base URL that tileset `relPath`s resolve against — usually the project file's directory. */
	basePath?: string;
	/** Build the walkability grid (off by default; it scans every tile). */
	navGrid?: boolean;
	onEntity?: (entity: PlacedEntity) => void;
}

export interface LevelRuntime {
	level: SvLevel;
	container: Container;
	body: RigidBody;
	/** One entry per merged tile-collider rect, with its authored config and enum tags. */
	colliders: TileCollider[];
	navGrid: NavGrid | undefined;
	entities: PlacedEntity[];
	pixelsPerUnit: number;
	/** Removes the container and every collider/body this level created. */
	destroy(): void;
}

const resolve = (basePath: string, relPath: string): string =>
	basePath ? new URL(relPath, new URL(basePath, location.href)).href : relPath;

/** Loads every tileset image the project references, keyed by tileset uid. */
export async function loadTilesetTextures(
	project: SvLevelProject,
	basePath = ''
): Promise<Map<number, Texture>> {
	const entries = await Promise.all(
		project.tilesets.map(async (t) => [t.uid, await Assets.load<Texture>(resolve(basePath, t.relPath))] as const)
	);
	return new Map(entries);
}

const findLevel = (project: SvLevelProject, id: number | string): SvLevel | undefined =>
	typeof id === 'number'
		? project.levels.find((l) => l.uid === id)
		: project.levels.find((l) => l.identifier === id);

export async function createLevelRuntime(
	project: SvLevelProject,
	levelId: number | string,
	opts: LevelRuntimeOptions
): Promise<LevelRuntime> {
	const level = findLevel(project, levelId);
	if (!level) throw new Error(`no such level: ${levelId}`);

	const ppu = opts.pixelsPerUnit ?? project.defaultGridSize;
	const textures = await loadTilesetTextures(project, opts.basePath ?? '');

	const container = buildTileLayers(project, level, textures);
	const bg = level.bgColor ?? project.defaultLevelBgColor;
	if (bg) {
		container.addChildAt(new Graphics().rect(0, 0, level.pxWid, level.pxHei).fill(bg), 0);
	}
	container.position.set(level.worldX, level.worldY);
	opts.stage?.addChild(container);

	const body = createLevelBody(opts.world, level, ppu);
	const mask = tileMaskFromTextures(project, textures);
	const colliders = createTileColliders(opts.world, body, project, level, ppu, mask);

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
			opts.onEntity?.(entity);
		}
	}

	return {
		level,
		container,
		body,
		colliders,
		navGrid: opts.navGrid ? buildNavGrid(project, level, mask) : undefined,
		entities,
		pixelsPerUnit: ppu,
		destroy() {
			// pixi's Mesh.destroy() only drops the references -- free the per-level geometry and
			// uniform buffers by hand so load/unload cycles don't leak them. The shader's gl program
			// is cached by source across levels, so it must NOT be destroyed with it.
			for (const group of container.children) {
				for (const child of group.children) {
					if (child instanceof Mesh) {
						child.geometry.destroy();
						child.shader?.destroy();
					}
				}
			}
			container.destroy({ children: true });
			// Removing the body frees its colliders too.
			opts.world.removeRigidBody(body);
		}
	};
}
