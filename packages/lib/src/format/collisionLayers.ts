/**
 * Collision layers -> Rapier interaction groups. A layer's membership bit is its index in the
 * project's `collisionLayers` (max 16 — Rapier's mask is 16 bits). i and j collide iff either
 * lists the other, so the matrix is symmetric no matter how it was authored.
 */

import type { SvCollisionLayer } from './types';

/** The universal layer: seeded first (bit 0), collides with everything, cannot be deleted. */
export const DEFAULT_LAYER_ID = 'DEFAULT';

/** Rapier's membership/filter mask is 16 bits, so a project can have at most 16 layers. */
export const MAX_COLLISION_LAYERS = 16;

/** Layers the editor must never delete — `DEFAULT` is the unknown-id fallback. */
export const PROTECTED_LAYER_IDS: ReadonlySet<string> = new Set([DEFAULT_LAYER_ID]);

/** Swatch for the seeded default layer; also the editor's fallback colour. */
export const DEFAULT_LAYER_COLOR = '#868686';

const DEFAULTS: readonly SvCollisionLayer[] = [
	{ id: DEFAULT_LAYER_ID, name: 'Default', color: DEFAULT_LAYER_COLOR, collidesWith: [DEFAULT_LAYER_ID] }
];

/** Mutable deep copy of the seeded defaults, safe to hand to editor/runtime state. */
export function cloneDefaultLayers(): SvCollisionLayer[] {
	return DEFAULTS.map((l) => (l.collidesWith ? { ...l, collidesWith: [...l.collidesWith] } : { ...l }));
}

/** Layer ids a layer collides with: the authored row, else DEFAULT + itself. */
export function collisionTargetsFor(
	layer: SvCollisionLayer,
	allIds: readonly string[]
): Set<string> {
	if (layer.collidesWith) return new Set(layer.collidesWith.filter((id) => allIds.includes(id)));
	if (layer.id === DEFAULT_LAYER_ID) return new Set(allIds);
	return new Set([DEFAULT_LAYER_ID, layer.id].filter((id) => allIds.includes(id)));
}

const bitmask = (groups: number[]): number => groups.reduce((acc, g) => acc | (1 << g), 0);

/**
 * Rapier's packed (memberships << 16) | filters. Omit `filters` for "collide with all".
 * `>>> 0` because bit 15 would otherwise shift into JS's sign bit and hand Rapier a negative u32.
 */
export const interactionGroups = (memberships: number[], filters?: number[]): number =>
	((bitmask(memberships) << 16) >>> 0) + (filters ? bitmask(filters) : 0xffff);

export interface CollisionGroupTable {
	/** Layer id -> packed interaction groups. */
	byId: ReadonlyMap<string, number>;
	/** Used for missing / unknown ids. */
	fallback: number;
}

/** Resolve a project's authored layers into Rapier masks. Empty/missing -> seeded defaults. */
export function buildCollisionGroups(
	layers: readonly SvCollisionLayer[] | undefined
): CollisionGroupTable {
	const list = (layers?.length ? layers : cloneDefaultLayers()).slice(0, MAX_COLLISION_LAYERS);
	const ids = list.map((l) => l.id);
	const targets = new Map(list.map((l) => [l.id, collisionTargetsFor(l, ids)]));
	const byId = new Map(
		list.map((l, i) => {
			const filters: number[] = [];
			for (let j = 0; j < list.length; j++) {
				const other = list[j]!.id;
				if (targets.get(l.id)?.has(other) || targets.get(other)?.has(l.id)) filters.push(j);
			}
			return [l.id, interactionGroups([i], filters)] as const;
		})
	);
	const all = Array.from({ length: MAX_COLLISION_LAYERS }, (_, i) => i);
	return { byId, fallback: byId.get(DEFAULT_LAYER_ID) ?? interactionGroups(all, all) };
}

export const groupsForLayer = (table: CollisionGroupTable, id: string | null | undefined): number =>
	id == null ? table.fallback : (table.byId.get(id) ?? table.fallback);
