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
import type { Application } from 'pixi.js';
import type { SvLevelProject } from 'pixi-vania';
import type { EditorHandle } from 'pixi-vania/editor';
import type { GameMode, Mode, Session } from './game';
import { MODES, MODE_LIST } from './modes';
import { createPanel, tuning, type PanelHandle } from './panel';

/** Level projects live next to each other; in PROD they're fetched relative to the page. */
const projectUrl = (file: string): string =>
	import.meta.env.PROD
		? new URL(`assets/levels/${file}`, document.baseURI).href
		: `/assets/levels/${file}`;

const playEl = document.querySelector<HTMLDivElement>('#play')!;
const hintEl = document.querySelector<HTMLDivElement>('#hint')!;
const editorEl = document.querySelector<HTMLDivElement>('#editor')!;
const { mountEditor, staticStore } = await import('pixi-vania/editor');

let app: Application | null = null;
let appPromise: Promise<Application> | null = null;
let session: Session | null = null;
/** Where Play is right now, so a restart or a mode switch resumes in place. */
let at: { project: SvLevelProject; levelUid: number } | null = null;
/** Bumped per launch; a session that finishes loading after a newer one started is dropped. */
let launch = 0;
let launchController: AbortController | null = null;
let gamePromise: Promise<typeof import('./game')> | null = null;
let rapierPromise: Promise<void> | null = null;

function loadGame(): Promise<typeof import('./game')> {
	gamePromise ??= import('./game');
	return gamePromise;
}

function initRapier(): Promise<void> {
	rapierPromise ??= import('@dimforge/rapier2d-compat').then(({ default: rapier }) => rapier.init());
	return rapierPromise;
}

async function pixiApp(): Promise<Application> {
	if (app) return app;
	if (!appPromise) appPromise = (async () => {
		const { Application } = await import('pixi.js');
		const next = new Application();
		// Prefer WebGPU now that the tile shader supports it; Pixi falls back to WebGL automatically.
		await next.init({ preference: 'webgpu', background: '#12121a', resizeTo: window, antialias: false });
		playEl.prepend(next.canvas);
		app = next;
		return next;
	})().catch((error) => {
		appPromise = null;
		throw error;
	});
	return appPromise;
}

const mode = (): GameMode => MODES[tuning.mode];

async function play(project: SvLevelProject, levelUid: number): Promise<void> {
	const mine = ++launch;
	const m = mode();
	launchController?.abort();
	launchController = new AbortController();
	const signal = launchController.signal;
	stopSession();
	let pixi: Application;
	let startSession: typeof import('./game').startSession;
	try {
		const [, nextPixi, game] = await Promise.all([initRapier(), pixiApp(), loadGame()]);
		pixi = nextPixi;
		startSession = game.startSession;
	} catch (error) {
		if (mine === launch) console.error('game initialization failed', error);
		return;
	}
	if (mine !== launch || signal.aborted) return;
	at = { project, levelUid };
	hintEl.textContent = m.hint;
	playEl.classList.add('on');
	editorEl.inert = true;
	editorEl.setAttribute('aria-hidden', 'true');
	panel.setPlaying(true);

	let started: Session;
	try {
		started = await startSession({
			pixi,
			mode: m,
			project,
			levelUid,
			basePath: projectUrl(m.projectFile),
			tuning,
			signal,
			onLoadProgress: ({ loaded, total, status, tileset }) => {
				if (mine === launch) hintEl.textContent = `Loading ${loaded}/${total}: ${tileset.identifier} (${status})`;
			},
			onLevel: (uid) => at && (at.levelUid = uid)
		});
	} catch (error) {
		if (mine === launch && !signal.aborted) {
			console.error('session start failed', error);
			exit();
		}
		return;
	}
	// Esc or another launch got in while the first level was loading.
	if (mine !== launch) return started.stop();
	session = started;
	hintEl.textContent = m.hint;
}

function stopSession(): void {
	session?.stop();
	session = null;
}

function exit(): void {
	launch++;
	launchController?.abort();
	launchController = null;
	stopSession();
	playEl.classList.remove('on');
	editorEl.inert = false;
	editorEl.removeAttribute('aria-hidden');
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
async function switchMode(id: Mode): Promise<boolean> {
	const m = MODES[id];
	const wasPlaying = !!session;
	const loaded = await editor.load(projectUrl(m.projectFile));
	if (!loaded) return false;
	hintEl.textContent = m.hint;
	if (wasPlaying) exit();
	if (!wasPlaying) return true;
	const project = editor.getProject();
	if (!project) return false;
	const uid = startLevel(project);
	if (uid !== undefined) void play(project, uid);
	return true;
}

function startLevel(project: SvLevelProject): number | undefined {
	const withStart = project.levels.find((level) =>
		level.layers.some((layer) => layer.type === 'Entities' && layer.visible && layer.entities.some((entity) => entity.type === 'PlayerStart'))
	);
	return (withStart ?? project.levels[0])?.uid;
}

addEventListener('keydown', (e) => {
	if (e.code === 'Escape' && session) exit();
});

/** Mounted before the editor: the panel sits over the editor UI and is usable without playing. */
const panel: PanelHandle = createPanel(document.querySelector<HTMLDivElement>('#panel')!, {
	onMode: switchMode,
	onRestart: restart,
	onExit: exit
});

const editor: EditorHandle = mountEditor(editorEl, {
	...(import.meta.env.PROD
		? { store: staticStore(MODE_LIST.map((m) => projectUrl(m.projectFile))) }
		: {}),
	projectPath: projectUrl(mode().projectFile),
	onPlay: (project, levelUid) => void play(project, levelUid)
});

hintEl.textContent = mode().hint;
