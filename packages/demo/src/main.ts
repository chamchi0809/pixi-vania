/**
 * Editor + Play in one page. Play hands the *live* editor document straight to
 * `createLevelRuntime` — no save round-trip — and Esc tears the level back down.
 *
 * Levels are placed side by side in one world (`worldX`/`worldY`), so walking off an edge that a
 * neighbouring level shares swaps the level in place; the player body survives the swap. Edges with
 * no neighbour act as walls.
 */
import RAPIER from '@dimforge/rapier2d-compat';
import { Application, Container, Graphics } from 'pixi.js';
import {
	createLevelRuntime,
	type LevelRuntime,
	type SvLevel,
	type SvLevelProject
} from 'pixi-vania';
import { mountEditor } from 'pixi-vania/editor';

const GRAVITY = 18;
const JUMP = 15;
const PROJECT = '/assets/levels/demo.svlevel.json';
const playEl = document.querySelector<HTMLDivElement>('#play')!;

const keys = new Set<string>();
// `code`, not `key`: physical keys so a Hangul/AZERTY layout still jumps on Z.
addEventListener('keydown', (e) => keys.add(e.code));
addEventListener('keyup', (e) => keys.delete(e.code));

let app: Application | null = null;
let session: { stop: () => void } | null = null;

async function pixiApp(): Promise<Application> {
	if (app) return app;
	app = new Application();
	// ponytail: the tile shader is GLSL-only, so no WebGPU. Add a WGSL twin to lift that.
	await app.init({ preference: 'webgl', background: '#12121a', resizeTo: window, antialias: false });
	playEl.prepend(app.canvas);
	return app;
}

type Dir = 'left' | 'right' | 'up' | 'down';
interface Bounds {
	minX: number;
	maxX: number;
	minY: number;
	maxY: number;
}

/** Level rectangle in physics units (Y-down, world offset included). */
const boundsOf = (l: SvLevel, ppu: number): Bounds => ({
	minX: l.worldX / ppu,
	maxX: (l.worldX + l.pxWid) / ppu,
	minY: l.worldY / ppu,
	maxY: (l.worldY + l.pxHei) / ppu
});

/** Tolerance for treating two levels as sharing an edge (units). */
const EDGE_EPS = 0.5;
/** How far inside the new level the player lands — must clear the capsule's half-height. */
const ENTRY_INSET = 0.8;
/** Keep the entry point this far from the new level's perpendicular walls. */
const ENTRY_MARGIN = 0.6;

/** A level sharing `cur`'s `dir` edge that also spans the crossing point. */
function neighbour(
	project: SvLevelProject,
	cur: SvLevel,
	dir: Dir,
	x: number,
	y: number,
	ppu: number
): SvLevel | undefined {
	const c = boundsOf(cur, ppu);
	return project.levels.find((l) => {
		if (l.uid === cur.uid) return false;
		const b = boundsOf(l, ppu);
		const spansY = y > b.minY && y < b.maxY;
		const spansX = x > b.minX && x < b.maxX;
		if (dir === 'right') return Math.abs(b.minX - c.maxX) <= EDGE_EPS && spansY;
		if (dir === 'left') return Math.abs(b.maxX - c.minX) <= EDGE_EPS && spansY;
		if (dir === 'down') return Math.abs(b.minY - c.maxY) <= EDGE_EPS && spansX;
		return Math.abs(b.maxY - c.minY) <= EDGE_EPS && spansX;
	});
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

async function play(project: SvLevelProject, levelUid: number): Promise<void> {
	await RAPIER.init();
	const pixi = await pixiApp();
	stop();

	// Y-down world (see the runtime's docs), so gravity's Y is POSITIVE.
	// g/jump are tuned as a pair: apex = JUMP^2 / 2g ~ 6.25 units, airtime = 2*JUMP/g ~ 1.7s.
	const world = new RAPIER.World({ x: 0, y: GRAVITY });
	const camera = new Container();
	// Two layers so a swapped-in level container can't be stacked over the player.
	const levelLayer = camera.addChild(new Container());
	const fxLayer = camera.addChild(new Container());
	pixi.stage.addChild(camera);

	const load = (uid: number): Promise<LevelRuntime> =>
		createLevelRuntime(project, uid, {
			world,
			stage: levelLayer,
			basePath: PROJECT,
			navGrid: true
		});

	let level = await load(levelUid);
	const px = level.pixelsPerUnit;

	const start = level.entities.find((e) => e.instance.type === 'PlayerStart');
	const body = world.createRigidBody(
		RAPIER.RigidBodyDesc.dynamic()
			.setTranslation(start?.world[0] ?? 2, start?.world[1] ?? 2)
			.lockRotations()
	);
	// Graphics mirrors the collider exactly: a capsule of radius R and half-height HH.
	const R = 0.25;
	const HH = 0.25;
	// Min rule, not the default average: friction 0 on our side alone still leaves
	// half the tile's friction, which is what makes the capsule cling to walls.
	const collider = world.createCollider(
		RAPIER.ColliderDesc.capsule(HH, R)
			.setFriction(0)
			.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
		body
	);

	const player = fxLayer.addChild(
		new Graphics()
			.roundRect(-R * px, -(HH + R) * px, R * 2 * px, (HH + R) * 2 * px, R * px)
			.fill('#63c74d')
	);
	const debug = fxLayer.addChild(new Graphics());

	// Ray straight down from the capsule centre; |vy| ~ 0 is also true at the apex.
	const ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 0, y: 1 });
	const grounded = () => {
		ray.origin = body.translation();
		return !!world.castRay(ray, HH + R + 0.06, true, undefined, undefined, collider, body);
	};

	/** Swap to `next`, teleporting the player just inside the shared edge. Velocity carries over. */
	let swapping = false;
	let dead = false;
	async function enter(next: SvLevel, dir: Dir): Promise<void> {
		swapping = true;
		const p = body.translation();
		const b = boundsOf(next, px);
		const x = dir === 'right' ? b.minX + ENTRY_INSET : dir === 'left' ? b.maxX - ENTRY_INSET : p.x;
		const y = dir === 'down' ? b.minY + ENTRY_INSET : dir === 'up' ? b.maxY - ENTRY_INSET : p.y;
		body.setTranslation(
			{
				x: clamp(x, b.minX + ENTRY_MARGIN, b.maxX - ENTRY_MARGIN),
				y: clamp(y, b.minY + ENTRY_MARGIN, b.maxY - ENTRY_MARGIN)
			},
			true
		);
		level.destroy();
		const loaded = await load(next.uid);
		// Esc during the load already tore the session down — drop what we just built.
		if (dead) return loaded.destroy();
		level = loaded;
		swapping = false;
		console.log(`entered ${next.identifier} (${dir})`);
	}

	/** Cross into the neighbouring level at the edge the player reached, else clamp them inside. */
	function boundary(): void {
		const b = boundsOf(level.level, px);
		const p = body.translation();
		// Trigger on the capsule's leading edge, not its centre, so the player never has to step off
		// the floor into empty space first — and so the clamp below can't out-race the crossing.
		const past: Record<Dir, boolean> = {
			right: p.x + R > b.maxX,
			left: p.x - R < b.minX,
			down: p.y + HH + R > b.maxY,
			up: p.y - HH - R < b.minY
		};
		for (const dir of ['right', 'left', 'down', 'up'] as Dir[]) {
			if (!past[dir]) continue;
			const next = neighbour(project, level.level, dir, p.x, p.y, px);
			if (next) {
				void enter(next, dir);
				return;
			}
		}

		// Whatever is left has no room to cross into — those edges act as walls.
		const v = body.linvel();
		let x = p.x;
		let y = p.y;
		if (past.right) x = b.maxX - R;
		else if (past.left) x = b.minX + R;
		if (past.down) y = b.maxY - HH - R;
		else if (past.up) y = b.minY + HH + R;
		if (x !== p.x || y !== p.y) {
			body.setTranslation({ x, y }, true);
			body.setLinvel({ x: x !== p.x ? 0 : v.x, y: y !== p.y ? 0 : v.y }, true);
		}
	}

	let jumpHeld = false;
	const tick = () => {
		if (swapping) return;
		const v = body.linvel();
		const dir = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
		// Edge-triggered: holding Z must not re-fire every frame.
		const jump = keys.has('KeyZ');
		const pressed = jump && !jumpHeld;
		jumpHeld = jump;
		body.setLinvel({ x: dir * 6, y: pressed && grounded() ? -JUMP : v.y }, true);
		world.step();
		boundary();

		const p = body.translation();
		player.position.set(p.x * px, p.y * px);

		const { vertices } = world.debugRender();
		debug.clear();
		for (let i = 0; i < vertices.length; i += 4) {
			debug
				.moveTo(vertices[i]! * px, vertices[i + 1]! * px)
				.lineTo(vertices[i + 2]! * px, vertices[i + 3]! * px);
		}
		debug.stroke({ width: 1, color: 0xff4d6d, alpha: 0.4 });

		// Fit the *current* level to the screen; its world offset shifts the camera, not the level.
		const l = level.level;
		const zoom = Math.min(pixi.screen.width / l.pxWid, pixi.screen.height / l.pxHei);
		camera.scale.set(zoom);
		camera.position.set(
			(pixi.screen.width - l.pxWid * zoom) / 2 - l.worldX * zoom,
			(pixi.screen.height - l.pxHei * zoom) / 2 - l.worldY * zoom
		);
	};

	pixi.ticker.add(tick);
	session = {
		stop() {
			dead = true;
			pixi.ticker.remove(tick);
			// Mid-swap the old level is already gone and the new one isn't ours yet.
			if (!swapping) level.destroy();
			camera.destroy({ children: true });
			world.free();
		}
	};
	playEl.classList.add('on');
	console.log(`nav grid: ${level.navGrid?.walkable.reduce((a, b) => a + b, 0)} walkable cells`);
}

function stop(): void {
	session?.stop();
	session = null;
	playEl.classList.remove('on');
}

addEventListener('keydown', (e) => {
	if (e.code === 'Escape' && session) stop();
});

mountEditor(document.querySelector<HTMLDivElement>('#editor')!, {
	projectPath: PROJECT,
	onPlay: (project, levelUid) => void play(project, levelUid)
});
