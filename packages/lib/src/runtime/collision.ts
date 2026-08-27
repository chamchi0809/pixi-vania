/**
 * Tile colliders for Rapier. Physics units are level pixels / `pixelsPerUnit`, Y-DOWN — the same
 * axes pixi draws in, so nothing is flipped between the two (use a POSITIVE gravity Y).
 */

import {
	ColliderDesc,
	RigidBodyDesc,
	type Collider,
	type RigidBody,
	type World
} from '@dimforge/rapier2d-compat';
import { buildCollisionGroups, groupsForLayer } from '../format/collisionLayers';
import type { SvLevel, SvLevelProject } from '../format/types';
import { tileColliderRects, type CellRect, type TileMask } from './grid';

/** A created collider plus the authored rect it came from — `rect.tags` carries the tileset tags. */
export interface TileCollider {
	collider: Collider;
	rect: CellRect;
}

/**
 * Create the level's static tile colliders on `body`. Positions are `(level px + level world
 * offset) / pixelsPerUnit`, Y-down. `mask` (see `runtime/mask`) enables `pixel`-shaped tiles;
 * without it they fall back to a full-cell rect.
 */
export function createTileColliders(
	world: World,
	body: RigidBody,
	project: SvLevelProject,
	level: SvLevel,
	pixelsPerUnit: number,
	mask?: TileMask
): TileCollider[] {
	const groups = buildCollisionGroups(project.collisionLayers);
	return tileColliderRects(project, level, mask).map((r) => {
		const desc = ColliderDesc.cuboid(r.w / 2 / pixelsPerUnit, r.h / 2 / pixelsPerUnit)
			.setTranslation((r.x + r.w / 2) / pixelsPerUnit, (r.y + r.h / 2) / pixelsPerUnit)
			.setSensor(r.config.sensor)
			.setCollisionGroups(groupsForLayer(groups, r.config.group));
		return { collider: world.createCollider(desc, body), rect: r };
	});
}

/** Static body holding a level's tile colliders, placed at the level's world origin. */
export function createLevelBody(
	world: World,
	level: SvLevel,
	pixelsPerUnit: number
): RigidBody {
	return world.createRigidBody(
		RigidBodyDesc.fixed().setTranslation(level.worldX / pixelsPerUnit, level.worldY / pixelsPerUnit)
	);
}

