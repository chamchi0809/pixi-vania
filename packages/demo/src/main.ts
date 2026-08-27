/**
 * Entry point: editor + Play in one page. Play hands the *live* editor document straight to
 * `createLevelRuntime` — no save round-trip — and Esc tears the level back down.
 *
 * Two game shapes ship side by side, switchable from the Tweakpane panel. Each owns a `.svlevel`
 * project, so picking a mode also loads its levels into the editor:
 *   `./platformer` — demo.svlevel.json
 *   `./topdown`    — topview.svlevel.json
 * The session itself (`./game`) is mode-agnostic.
 */
import RAPIER from '@dimforge/rapier2d-compat';
import { Application } from 'pixi.js';
import type { SvLevelProject } from 'pixi-vania';
import { mountEditor, staticStore, type EditorHandle } from 'pixi-vania/editor';
import { startLevelUid, startSession, type GameMode, type Mode, type Session } from './game';
import { MODES, MODE_LIST } from './modes';
import { createPanel, tuning, type PanelHandle } from './panel';

/** Level projects live next to each other; in PROD they're fetched relative to the page. */
const projectUrl = (file: string): string =>
	import.meta.env.PROD
		? new URL(`assets/levels/${file}`, document.baseURI).href
		: `/assets/levels/${file}`;

const playEl = document.querySelector<HTMLDivElement>('#play')!;
const hintEl = document.querySelector<HTMLDivElement>('#hint')!;

let app: Application | null = null;
let session: Session | null = null;
/** Where Play is right now, so a restart or a mode switch resumes in place. */
let at: { project: SvLevelProject; levelUid: number } | null = null;
/** Bumped per launch; a session that finishes loading after a newer one started is dropped. */
let launch = 0;

async function pixiApp(): Promise<Application> {
	if (app) return app;
	app = new Application();
	// ponytail: the tile shader is GLSL-only, so no WebGPU. Add a WGSL twin to lift that.
	await app.init({ preference: 'webgl', background: '#12121a', resizeTo: window, antialias: false });
	playEl.prepend(app.canvas);
	return app;
}

const mode = (): GameMode => MODES[tuning.mode];

async function play(project: SvLevelProject, levelUid: number): Promise<void> {
	const mine = ++launch;
	await RAPIER.init();
	const pixi = await pixiApp();
	if (mine !== launch) return;
	stop();

	const m = mode();
	at = { project, levelUid };
	hintEl.textContent = m.hint;
	playEl.classList.add('on');
	panel.setPlaying(true);

	const started = await startSession({
		pixi,
		mode: m,
		project,
		levelUid,
		basePath: projectUrl(m.projectFile),
		tuning,
		onLevel: (uid) => at && (at.levelUid = uid)
	});
	// Esc or another launch got in while the first level was loading.
	if (mine !== launch) return started.stop();
	session = started;
}

function stop(): void {
	session?.stop();
	session = null;
}

function exit(): void {
	launch++;
	stop();
	playEl.classList.remove('on');
	panel.setPlaying(false);
}

/** Restart button: rebuild the running session on the level the player is standing in. */
function restart(): void {
	if (at && session) void play(at.project, at.levelUid);
}

/**
 * Mode switch: load that mode's project into the editor, and if Play is up, drop the player into the
 * new project's start level — level uids don't carry across projects.
 */
async function switchMode(id: Mode): Promise<void> {
	const m = MODES[id];
	hintEl.textContent = m.hint;
	const wasPlaying = !!session;
	if (wasPlaying) exit();
	await editor.load(projectUrl(m.projectFile));
	if (!wasPlaying) return;
	const project = editor.getProject();
	if (!project) return;
	const uid = startLevelUid(project);
	if (uid !== undefined) void play(project, uid);
}

addEventListener('keydown', (e) => {
	if (e.code === 'Escape' && session) exit();
});

/** Mounted before the editor: the panel sits over the editor UI and is usable without playing. */
const panel: PanelHandle = createPanel(document.querySelector<HTMLDivElement>('#panel')!, {
	onMode: (id) => void switchMode(id),
	onRestart: restart,
	onExit: exit
});

const editor: EditorHandle = mountEditor(document.querySelector<HTMLDivElement>('#editor')!, {
	...(import.meta.env.PROD
		? { store: staticStore(MODE_LIST.map((m) => projectUrl(m.projectFile))) }
		: {}),
	projectPath: projectUrl(mode().projectFile),
	onPlay: (project, levelUid) => void play(project, levelUid)
});

hintEl.textContent = mode().hint;
