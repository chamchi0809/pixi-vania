/**
 * Tweakpane overlay, up in both the editor and Play. Owns `tuning`, which the game loop reads every
 * frame — so speed/gravity/camera edits land live, and edits made in the editor apply on the next
 * Play. Picking a mode is the one change that can't be live: it swaps the project *and* the collider
 * shape, so `onMode` reloads the editor and rebuilds any running session.
 */
import { Pane } from 'tweakpane';
import type { Mode, Tuning } from './game';
import { MODES, MODE_LIST } from './modes';

export const tuning: Tuning = { mode: 'platformer', debug: false, ...MODES.platformer.preset };

export interface PanelHooks {
	onMode: (mode: Mode) => boolean | Promise<boolean>;
	onRestart: () => void;
	onExit: () => void;
}

export interface PanelHandle {
	/** Show or hide the rows that only mean something with a session running. */
	setPlaying: (on: boolean) => void;
}

export function createPanel(container: HTMLElement, hooks: PanelHooks): PanelHandle {
	const pane = new Pane({ container, title: 'pixi-vania demo' });

	const mode = pane.addBinding(tuning, 'mode', {
		options: Object.fromEntries(MODE_LIST.map((m) => [m.label, m.id])) as Record<string, Mode>
	});

	const move = pane.addFolder({ title: 'movement' });
	move.addBinding(tuning, 'speed', { min: 1, max: 14, step: 0.5 });
	const jump = move.addBinding(tuning, 'jump', { min: 5, max: 26, step: 0.5 });
	const gravity = move.addBinding(tuning, 'gravity', { min: 1, max: 60, step: 1 });

	const cam = pane.addFolder({ title: 'camera' });
	const framing = cam.addBinding(tuning, 'camera', {
		label: 'framing',
		options: { 'fit level': 'fit', 'follow player': 'follow' }
	});
	const zoom = cam.addBinding(tuning, 'zoom', { min: 1, max: 8, step: 0.25 });

	pane.addBinding(tuning, 'debug', { label: 'colliders' });
	const restart = pane.addButton({ title: 'restart level' });
	const exit = pane.addButton({ title: 'back to editor (Esc)' });
	restart.on('click', () => hooks.onRestart());
	exit.on('click', () => hooks.onExit());

	/** Hide the rows the current mode/framing doesn't use, and pull preset values into the UI. */
	function sync(): void {
		// A mode with no jump has no gravity to tune either — nothing falls.
		const falls = MODES[tuning.mode].preset.gravity > 0;
		jump.hidden = !falls;
		gravity.hidden = !falls;
		zoom.hidden = tuning.camera !== 'follow';
		pane.refresh();
	}

	let acceptedMode = tuning.mode;
	let modeGeneration = 0;
	mode.on('change', async (ev) => {
		const generation = ++modeGeneration;
		const accepted = await hooks.onMode(ev.value);
		if (generation !== modeGeneration) return;
		if (!accepted) tuning.mode = acceptedMode;
		else {
			acceptedMode = ev.value;
			Object.assign(tuning, MODES[ev.value].preset);
		}
		sync();
	});
	framing.on('change', sync);
	sync();

	const handle: PanelHandle = {
		setPlaying(on) {
			restart.hidden = !on;
			exit.hidden = !on;
		}
	};
	handle.setPlaying(false);
	return handle;
}
