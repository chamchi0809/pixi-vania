/** Side-on mode: gravity, one edge-triggered jump, a capsule body, camera framing the whole level. */
import type { GameMode } from './game';

/** Capsule radius and half-height in physics units (1 unit == 1 tile). */
const R = 0.25;
const HH = 0.25;

export const platformer: GameMode = {
	id: 'platformer',
	label: 'Platformer',
	projectFile: 'demo.svlevel.json',
	hint: '←/→ move · Z jump · Esc back to editor',
	// g/jump are tuned as a pair: apex = jump² / 2g ~ 6.25 units, airtime = 2*jump/g ~ 1.7s.
	preset: { speed: 6, jump: 15, gravity: 18, camera: 'fit', zoom: 3 },
	radius: R,
	halfHeight: HH,
	gravity: (t) => t.gravity,

	// A capsule so the body slides over tile seams instead of catching on them.
	sprite: (ppu, pixi) =>
		new pixi.Container().addChild(
			new pixi.Graphics()
				.roundRect(-R * ppu, -(HH + R) * ppu, R * 2 * ppu, (HH + R) * 2 * ppu, R * ppu)
				.fill('#63c74d')
		),

	control({ body, grounded, ax, jumped, tuning }) {
		// Vertical velocity is the world's to own except on the take-off frame.
		const vy = body.linvel().y;
		body.setLinvel(
			{ x: ax * tuning.speed, y: jumped && grounded() ? -tuning.jump : vy },
			true
		);
	}
};
