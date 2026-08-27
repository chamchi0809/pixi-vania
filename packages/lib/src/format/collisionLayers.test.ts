/** Self-check for collision-layer -> Rapier mask packing. Run via `check.ts`. */
import assert from 'node:assert';
import { buildCollisionGroups, groupsForLayer, interactionGroups } from './collisionLayers.ts';
import type { SvCollisionLayer } from './types.ts';

const memberships = (g: number) => (g >>> 16) & 0xffff;
const filters = (g: number) => g & 0xffff;
/** Rapier's rule: a and b interact iff each one's membership is in the other's filter. */
const interact = (a: number, b: number) =>
	(memberships(a) & filters(b)) !== 0 && (memberships(b) & filters(a)) !== 0;

{
	// Bit 15 must stay a positive u32 — `<<` alone would sign-flip it.
	const g = interactionGroups([15], [15]);
	assert.ok(g > 0 && g <= 0xffffffff);
	assert.equal(memberships(g), 0x8000);
}

{
	// No authored layers -> the seeded DEFAULT, which collides with itself and is the fallback.
	const table = buildCollisionGroups(undefined);
	const def = groupsForLayer(table, 'DEFAULT');
	assert.ok(interact(def, def));
	assert.equal(groupsForLayer(table, 'nope'), def);
	assert.equal(groupsForLayer(table, null), def);
}

{
	// Authored one-sided: BLACK lists WHITE but not the reverse -> they still collide (symmetric).
	const layers: SvCollisionLayer[] = [
		{ id: 'DEFAULT', name: 'D', color: '#868686', collidesWith: ['DEFAULT', 'WHITE', 'BLACK'] },
		{ id: 'WHITE', name: 'W', color: '#fff', collidesWith: ['DEFAULT', 'WHITE'] },
		{ id: 'BLACK', name: 'B', color: '#000', collidesWith: ['DEFAULT', 'WHITE'] }
	];
	const table = buildCollisionGroups(layers);
	const [d, w, b] = ['DEFAULT', 'WHITE', 'BLACK'].map((id) => groupsForLayer(table, id));
	assert.ok(interact(w!, b!), 'one-sided authoring must still collide');
	assert.ok(interact(d!, w!) && interact(d!, b!));
	assert.ok(!interact(b!, b!), 'BLACK never lists itself, so it passes through itself');
}

console.log('collisionLayers: OK');
