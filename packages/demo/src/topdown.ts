/**
 * Top-down mode: no gravity, 8-way movement, a ball body, camera following the player. It plays its
 * own project (`topview.svlevel.json`) — rooms whose walls read as walls from above, unlike the
 * platformer's floors and ledges.
 */
import type { GameMode } from './game';

/** Ball radius in physics units (1 unit == 1 tile). */
const R = 0.32;

export const topdown: GameMode = {
	id: 'topdown',
	label: 'Top-down',
	projectFile: 'topview.svlevel.json',
	hint: '←/→/↑/↓ or WASD move · Esc back to editor',
	preset: { speed: 5, jump: 0, gravity: 0, camera: 'follow', zoom: 3 },
	radius: R,
	halfHeight: 0,
	// Nothing falls in a top-down world; movement is velocity the input sets outright.
	gravity: () => 0,

	sprite(ppu, pixi) {
		const c = new pixi.Container();
		c.addChild(new pixi.Graphics().circle(0, 0, R * ppu).fill('#63c74d'));
		// The nub is the only thing that can show a facing on a circle.
		c.addChild(new pixi.Graphics().rect(0, -1.5, R * ppu, 3).fill('#1a1a22'));
		return c;
	},

	control({ body, ax, ay, sprite, tuning }) {
		// Normalise so diagonals aren't ~40% faster than a straight line.
		const len = Math.hypot(ax, ay) || 1;
		body.setLinvel({ x: (ax / len) * tuning.speed, y: (ay / len) * tuning.speed }, true);
		if (ax || ay) sprite.rotation = Math.atan2(ay, ax);
	}
};
