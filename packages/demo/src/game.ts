/**
 * Everything the two game shapes share: input, the physics/pixi session, level-edge crossing, the
 * camera and the collider debug draw. A `GameMode` (see `./platformer`, `./topdown`) only supplies a
 * body size, some art and a per-frame control step — no mode knows about level swapping.
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
	type TilesetLoadProgress
} from 'pixi-vania/runtime';
import type { SvLevel, SvLevelProject } from 'pixi-vania';
import { fixedStepSchedule } from './fixedStep';

export type Mode = 'platformer' | 'topdown';
export type Framing = 'fit' | 'follow';

/** Live knobs, owned by the panel and read every frame — edits land without a restart. */
export interface Tuning {
	mode: Mode;
	/** Units per second. Horizontal in platformer, both axes in top-down. */
	speed: number;
	/** Jump take-off speed, platformer only. */
	jump: number;
	gravity: number;
	camera: Framing;
	/** Screen pixels per level pixel, `follow` framing only. */
	zoom: number;
	debug: boolean;
}

/** The values a mode resets the panel to when it's picked. */
export type ModePreset = Omit<Tuning, 'mode' | 'debug'>;

export interface ControlContext {
	body: RAPIER.RigidBody;
	/** Something solid directly below the body — the platformer's ground check. */
	grounded(): boolean;
	/** -1/0/1 from the movement keys. */
	ax: number;
	ay: number;
	/** True only on the frame a jump key went down, so holding it can't re-fire. */
	jumped: boolean;
	/** The player display object, for modes that show a facing. */
	sprite: Container;
	tuning: Readonly<Tuning>;
}

export interface GameMode {
	id: Mode;
	label: string;
	/** Project file name, resolved against the demo's levels directory. */
	projectFile: string;
	/** Controls line shown at the bottom of the play view. */
	hint: string;
	preset: ModePreset;
	/** Collider half-extents in physics units: a capsule when `halfHeight > 0`, else a ball. */
	radius: number;
	halfHeight: number;
	/** World gravity in units/s² — Y-down, so positive pulls down. */
	gravity(t: Readonly<Tuning>): number;
	/** Player art centred on the body, drawn in level pixels. Constructors are injected for lazy Pixi loading. */
	sprite(ppu: number, pixi: { Container: typeof Container; Graphics: typeof Graphics }): Container;
	/** Sets the body's velocity for this frame. */
	control(ctx: ControlContext): void;
}

type Dir = 'left' | 'right' | 'up' | 'down';

const keys = new Set<string>();
// `code`, not `key`: physical keys so a Hangul/AZERTY layout still jumps on Z.
const isEditable = (target: EventTarget | null) =>
	target instanceof HTMLElement && !!target.closest('input, textarea, select, button, [contenteditable="true"]');
const GAME_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyZ', 'Space']);
addEventListener('keydown', (e) => {
	if (isEditable(e.target)) return;
	keys.add(e.code);
	if (GAME_KEYS.has(e.code) && document.querySelector('#play.on')) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
const clearKeys = () => keys.clear();
addEventListener('blur', clearKeys);
addEventListener('pagehide', clearKeys);
document.addEventListener('visibilitychange', () => document.hidden && clearKeys());

const DIR_KEYS: Record<Dir, string[]> = {
	left: ['ArrowLeft', 'KeyA'],
	right: ['ArrowRight', 'KeyD'],
	up: ['ArrowUp', 'KeyW'],
	down: ['ArrowDown', 'KeyS']
};
const held = (d: Dir): boolean => DIR_KEYS[d].some((code) => keys.has(code));
const axis = (neg: Dir, pos: Dir): number => (held(pos) ? 1 : 0) - (held(neg) ? 1 : 0);
const JUMP_KEYS = ['KeyZ', 'Space'];

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
/** How far inside the new level the player lands — must clear the body's half-height. */
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

function entryPosition(position: { x: number; y: number }, bounds: Bounds, direction: Dir): { x: number; y: number } {
	const entry = { ...position };
	switch (direction) {
		case 'right':
			entry.x = bounds.minX + ENTRY_INSET;
			break;
		case 'left':
			entry.x = bounds.maxX - ENTRY_INSET;
			break;
		case 'down':
			entry.y = bounds.minY + ENTRY_INSET;
			break;
		case 'up':
			entry.y = bounds.maxY - ENTRY_INSET;
			break;
	}
	return entry;
}

/** The level a fresh run should start on: the first one with a `PlayerStart`, else the first one. */
export function startLevelUid(project: SvLevelProject): number | undefined {
	const withStart = project.levels.find((l) =>
		l.layers.some((y) => y.type === 'Entities' && y.visible && y.entities.some((e) => e.type === 'PlayerStart'))
	);
	return (withStart ?? project.levels[0])?.uid;
}

export interface SessionOptions {
	pixi: Application;
	mode: GameMode;
	project: SvLevelProject;
	levelUid: number;
	/** Resolves tileset `relPath`s — the project file's URL. */
	basePath: string;
	tuning: Readonly<Tuning>;
	/** Fires after a level swap so the host can resume here on a restart. */
	onLevel?: (uid: number) => void;
	signal?: AbortSignal;
	onLoadProgress?: (progress: TilesetLoadProgress) => void;
}

export interface Session {
	stop(): void;
}

/**
 * Builds a world, drops the player into `levelUid` and starts ticking. Everything it creates is
 * released by `stop()`, including a level that was still loading.
 */
export async function startSession(o: SessionOptions): Promise<Session> {
	const { pixi, mode, project, tuning } = o;
	// Y-down world (see the runtime's docs), so gravity's Y is POSITIVE.
	const world = new RAPIER.World({ x: 0, y: mode.gravity(tuning) });
	const camera = new Container();
	// Two layers so a swapped-in level container can't be stacked over the player.
	const levelLayer = camera.addChild(new Container());
	const fxLayer = camera.addChild(new Container());
	pixi.stage.addChild(camera);

	const lifetime = new AbortController();
	const abort = () => lifetime.abort(o.signal?.reason);
	if (o.signal?.aborted) abort();
	else o.signal?.addEventListener('abort', abort, { once: true });
	const load = (uid: number): Promise<LevelRuntime> =>
		createLevelRuntime(project, uid, {
			world,
			stage: levelLayer,
			basePath: o.basePath,
			basePathKind: 'project-file',
			navGrid: false,
			loading: {
				signal: lifetime.signal,
				...(o.onLoadProgress ? { onProgress: o.onLoadProgress } : {})
			}
		});

	let dead = false;
	let tornDown = false;
	/** Undo everything built so far — used by `stop()` and by the abandoned-load path. */
	const teardown = (level: LevelRuntime | null) => {
		if (tornDown) return;
		tornDown = true;
		level?.destroy();
		camera.destroy({ children: true });
		world.free();
	};

	let level: LevelRuntime;
	try {
		level = await load(o.levelUid);
	} catch (error) {
		teardown(null);
		o.signal?.removeEventListener('abort', abort);
		throw error;
	}
	if (dead) {
		teardown(level);
		return { stop() {} };
	}
	const px = level.pixelsPerUnit;

	const start = level.entities.find((e) => e.instance.type === 'PlayerStart');
	const body = world.createRigidBody(
		RAPIER.RigidBodyDesc.dynamic()
			.setTranslation(start?.world[0] ?? 2, start?.world[1] ?? 2)
			.lockRotations()
	);
	const R = mode.radius;
	const HH = mode.halfHeight;
	// Min rule, not the default average: friction 0 on our side alone still leaves
	// half the tile's friction, which is what makes the body cling to walls.
	const collider = world.createCollider(
		(HH > 0 ? RAPIER.ColliderDesc.capsule(HH, R) : RAPIER.ColliderDesc.ball(R))
			.setFriction(0)
			.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
		body
	);

	const sprite = fxLayer.addChild(mode.sprite(px, { Container, Graphics }));
	const debug = fxLayer.addChild(new Graphics());

	// Ray straight down from the body centre; |vy| ~ 0 is also true at the apex.
	const ray = new RAPIER.Ray({ x: 0, y: 0 }, { x: 0, y: 1 });
	const grounded = () => {
		ray.origin = body.translation();
		return !!world.castRay(
			ray,
			HH + R + 0.06,
			true,
			RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
			undefined,
			collider,
			body
		);
	};

	/** Swap to `next`, teleporting the player just inside the shared edge. Velocity carries over. */
	let swapping = false;
	let swapGeneration = 0;
	async function enter(next: SvLevel, dir: Dir): Promise<void> {
		const generation = ++swapGeneration;
		swapping = true;
		try {
			const loaded = await load(next.uid);
			if (dead || generation !== swapGeneration) return loaded.destroy();
			const p = body.translation();
			const b = boundsOf(next, px);
			const entry = entryPosition(p, b, dir);
			body.setTranslation({
				x: clamp(entry.x, b.minX + ENTRY_MARGIN, b.maxX - ENTRY_MARGIN),
				y: clamp(entry.y, b.minY + ENTRY_MARGIN, b.maxY - ENTRY_MARGIN)
			}, true);
			const previous = level;
			level = loaded;
			previous.destroy();
			o.onLevel?.(next.uid);
			console.log(`entered ${next.identifier} (${dir})`);
		} catch (error) {
			if (!dead && !(error instanceof DOMException && error.name === 'AbortError')) console.error('level transition failed', error);
		} finally {
			if (generation === swapGeneration) swapping = false;
		}
	}

	/** Cross into the neighbouring level at the edge the player reached, else clamp them inside. */
	function boundary(): void {
		const b = boundsOf(level.level, px);
		const p = body.translation();
		// Trigger on the body's leading edge, not its centre, so the player never has to step off
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

	/** `fit` frames the whole level; `follow` tracks the player, never showing past a level edge. */
	function updateCamera(): void {
		const l = level.level;
		if (tuning.camera === 'fit') {
			// Fit the *current* level to the screen; its world offset shifts the camera, not the level.
			const zoom = Math.min(pixi.screen.width / l.pxWid, pixi.screen.height / l.pxHei);
			camera.scale.set(zoom);
			camera.position.set(
				(pixi.screen.width - l.pxWid * zoom) / 2 - l.worldX * zoom,
				(pixi.screen.height - l.pxHei * zoom) / 2 - l.worldY * zoom
			);
			return;
		}
		const zoom = tuning.zoom;
		const p = body.translation();
		// Viewport in level pixels. An axis the level can't fill is centred instead of clamped.
		const vw = pixi.screen.width / zoom;
		const vh = pixi.screen.height / zoom;
		const cx =
			vw >= l.pxWid
				? l.worldX + l.pxWid / 2
				: clamp(p.x * px, l.worldX + vw / 2, l.worldX + l.pxWid - vw / 2);
		const cy =
			vh >= l.pxHei
				? l.worldY + l.pxHei / 2
				: clamp(p.y * px, l.worldY + vh / 2, l.worldY + l.pxHei - vh / 2);
		camera.scale.set(zoom);
		camera.position.set(pixi.screen.width / 2 - cx * zoom, pixi.screen.height / 2 - cy * zoom);
	}

	const FIXED_DT = 1 / 60;
	const MAX_CATCH_UP_STEPS = 5;
	world.timestep = FIXED_DT;
	let accumulator = 0;
	let jumpHeld = false;
	const tick = () => {
		if (swapping) return;
		const schedule = fixedStepSchedule(accumulator, pixi.ticker.deltaMS, FIXED_DT, MAX_CATCH_UP_STEPS);
		accumulator = schedule.accumulator;
		for (let step = 0; step < schedule.steps; step++) {
			world.gravity.y = mode.gravity(tuning);
			const jumping = JUMP_KEYS.some((code) => keys.has(code));
			mode.control({
				body,
				grounded,
				ax: axis('left', 'right'),
				ay: axis('up', 'down'),
				jumped: jumping && !jumpHeld,
				sprite,
				tuning
			});
			jumpHeld = jumping;
			world.step();
			boundary();
			if (swapping) break;
		}

		const p = body.translation();
		sprite.position.set(p.x * px, p.y * px);

		debug.clear();
		if (tuning.debug) {
			const { vertices } = world.debugRender();
			for (let i = 0; i < vertices.length; i += 4) {
				debug
					.moveTo(vertices[i]! * px, vertices[i + 1]! * px)
					.lineTo(vertices[i + 2]! * px, vertices[i + 3]! * px);
			}
			debug.stroke({ width: 1, color: 0xff4d6d, alpha: 0.4 });
		}

		updateCamera();
	};

	pixi.ticker.add(tick);
	console.log(`${mode.id}: ${level.level.identifier}, ${level.colliders.length} colliders`);

	return {
		stop() {
			dead = true;
			swapGeneration++;
			lifetime.abort();
			o.signal?.removeEventListener('abort', abort);
			pixi.ticker.remove(tick);
			teardown(level);
		}
	};
}
