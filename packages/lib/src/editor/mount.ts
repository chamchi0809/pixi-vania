/**
 * The editor's public entry point. Svelte is an implementation detail — hosts mount it into any
 * element and talk to it through the returned handle.
 */

import { mount, unmount } from 'svelte';
import EditorShell from './components/EditorShell.svelte';
import { editor } from './state/editorStore.svelte';
import { setProjectStore, type ProjectStore } from './state/io';
import { emptyProject } from './state/factory';
import type { SvLevelProject } from '../format/types';

export interface EditorOptions {
	/** Where projects load/save from. Default: the dev-server middleware of `pixi-vania/vite`. */
	store?: ProjectStore;
	/** Project to load on mount. Omit (and omit `project`) to start from a blank project. */
	projectPath?: string;
	/** Start from this in-memory document instead of loading one. */
	project?: SvLevelProject;
	/** Shows the Play button; gets the live document, so no save round-trip is needed. */
	onPlay?: (project: SvLevelProject, levelUid: number) => void;
}

export interface EditorHandle {
	/** Detached copy of the live document, safe to hand to `createLevelRuntime`. */
	getProject(): SvLevelProject | null;
	open(project: SvLevelProject, path?: string): void;
	load(path?: string): Promise<void>;
	save(): Promise<void>;
	destroy(): void;
}

/**
 * ponytail: the editor store is a module singleton, so one editor per page. Two at once would
 * need the store passed through context instead.
 */
export function mountEditor(target: HTMLElement, opts: EditorOptions = {}): EditorHandle {
	if (opts.store) setProjectStore(opts.store);
	if (opts.project) editor.open(opts.project, opts.projectPath ?? '');
	else if (opts.projectPath) editor.projectPath = opts.projectPath;
	else if (!editor.project) editor.open(emptyProject());

	const app = mount(EditorShell, {
		target,
		props: opts.onPlay ? { onplay: opts.onPlay } : {}
	});

	return {
		getProject: () => editor.snapshotProject(),
		open: (project, path) => editor.open(project, path),
		load: (path) => editor.load(path),
		save: () => editor.save(),
		destroy: () => void unmount(app)
	};
}
