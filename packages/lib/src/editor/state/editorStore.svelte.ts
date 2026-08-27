/**
 * The editor's single reactive store (Svelte 5 runes): open document, editing UI state, undo/redo.
 * History is snapshot-based — each edit/stroke snapshots the whole document before mutating, so
 * undo/redo just swap copies (documents are tiny, simpler than command diffs).
 */

import {
	getLayerDef as findLayerDef,
	getTileset,
	type FlipBits,
	type SvAutoRule,
	type SvAutoRulePreset,
	type SvLayerDef,
	type SvLayerInstance,
	type SvLayerType,
	type SvLevel,
	type SvLevelProject,
	type SvLocalization,
	type SvTileset
} from '../../format/types';
import { collectLocalizableStrings, emptyLocalization } from '../../format/localization';
import {
	allocUid,
	makeAutoRuleGroup,
	makeGroupFromPreset,
	makeLayerDef,
	makeLayerInstance,
	makeLevel,
	reconcileLevelLayers,
	resizeLayerInstance,
	resizeLayerInstanceShifted,
	sanitizeGroupName,
	uniqueGroupName
} from './factory';
import {
	recomputeAllAutoTiles,
	recomputeAllAutoTilesAllLevels,
	recomputeAutoTiles,
	renameGroupReferences
} from './ops';
import { listProjects, loadProject, saveProject } from './io';

export type EditorTool =
	| 'select'
	| 'brush'
	| 'rect'
	| 'fill'
	| 'eraser'
	| 'picker'
	| 'entity'
	| 'pan';

/** One checkpoint in the undo timeline, surfaced to the History panel. */
export interface HistoryEntry {
	/** Stable id (for keyed `{#each}`); not the timeline index. */
	id: number;
	/** Human label describing the action that produced this state. */
	label: string;
}

export interface Camera {
	/** Level-px coordinate shown at the viewport center. */
	x: number;
	y: number;
	/** CSS px per level px. */
	zoom: number;
}

/** A rectangular tile-brush selected from the tileset palette (row-major; -1 = empty). */
export interface TileBrush {
	ids: number[];
	w: number;
	h: number;
}

const HISTORY_LIMIT = 200;
/** Overridden by `mountEditor({ projectPath })`; empty means "start from a blank project". */
const DEFAULT_PROJECT_PATH = '';

class EditorStore {
	project = $state<SvLevelProject | null>(null);
	projectPath = $state<string>(DEFAULT_PROJECT_PATH);
	availableProjects = $state<string[]>([]);

	/** Bumped on every content change; the canvas redraws when it changes. */
	revision = $state(0);
	dirty = $state(false);
	status = $state<string>('');
	loading = $state(false);

	tool = $state<EditorTool>('brush');
	currentLevelUid = $state<number>(-1);
	activeLayerUid = $state<number>(-1);

	selectedId = $state<string>('');
	brush = $state<TileBrush>({ ids: [], w: 0, h: 0 });
	brushFlip = $state<FlipBits>(0);
	/** When on, the brush stamps one random tile from the selection per cell (forced 1x1). */
	brushRandomMode = $state(false);
	selectedEntityType = $state<string | null>(null);
	selectedEntityIids = $state<string[]>([]);

	camera = $state<Camera>({ x: 0, y: 0, zoom: 2 });
	showGrid = $state(true);
	dimInactiveLayers = $state(true);

	/** Snapshots, one per checkpoint. `states[i]` mirrors `historyEntries[i]`. Non-reactive. */
	private states: SvLevelProject[] = [];
	/** Reactive labels, parallel to `states` (entry 0 is the load point). */
	historyEntries = $state<HistoryEntry[]>([]);
	/** Index of the live document within the timeline. */
	historyIndex = $state(0);
	private strokeActive = false;
	private strokeLabel = '';
	private nextHistoryId = 0;

	get canUndo(): boolean {
		return this.historyIndex > 0;
	}
	get canRedo(): boolean {
		return this.historyIndex < this.historyEntries.length - 1;
	}

	get currentLevel(): SvLevel | undefined {
		return this.project?.levels.find((l) => l.uid === this.currentLevelUid);
	}

	get activeLayerDef(): SvLayerDef | undefined {
		if (!this.project) return undefined;
		return findLayerDef(this.project, this.activeLayerUid);
	}

	get activeLayerInstance(): SvLayerInstance | undefined {
		return this.currentLevel?.layers.find((li) => li.layerDefUid === this.activeLayerUid);
	}

	get activeTileset(): SvTileset | undefined {
		if (!this.project) return undefined;
		return getTileset(this.project, this.activeLayerDef?.tilesetDefUid);
	}

	async refreshProjectList(): Promise<void> {
		try {
			this.availableProjects = await listProjects();
		} catch (e) {
			this.status = `Could not list projects: ${(e as Error).message}`;
		}
	}

	async load(path = this.projectPath): Promise<void> {
		this.loading = true;
		this.status = `Loading ${path}…`;
		try {
			this.open(await loadProject(path), path);
			this.status = `Loaded ${path}`;
		} catch (e) {
			this.status = `Load failed: ${(e as Error).message}`;
		} finally {
			this.loading = false;
		}
	}

	/** Adopt an in-memory project (also the tail of `load`). Resets history and selection. */
	open(project: SvLevelProject, path = this.projectPath): void {
		project.autoRuleGroups ??= [];
		project.autoRulePresets ??= [];
		project.entities ??= [];
		this.project = project;
		this.projectPath = path;
		this.resetHistory('Open project');
		this.dirty = false;
		this.currentLevelUid = project.levels[0]?.uid ?? -1;
		this.activeLayerUid = this.defaultActiveLayer();
		this.initBrush();
		this.selectedEntityIids = [];
		this.revision++;
	}

	/** The live document, detached from `$state` — safe to hand to the runtime or to serialise. */
	snapshotProject(): SvLevelProject | null {
		return this.project ? this.snapshot() : null;
	}

	/** Download the project as a `.svlevel.json` file. Works with any backend. */
	exportFile(): void {
		const project = this.snapshotProject();
		if (!project) return;
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(project, null, '\t')], { type: 'application/json' })
		);
		const a = document.createElement('a');
		a.href = url;
		a.download = this.projectPath.split('/').pop() || 'project.svlevel.json';
		a.click();
		URL.revokeObjectURL(url);
		this.status = `Exported ${a.download}`;
	}

	/** Open a `.svlevel.json` picked from the user's disk. */
	async importFile(file: File): Promise<void> {
		try {
			const data = JSON.parse(await file.text()) as SvLevelProject;
			if (data.format !== 'svlevel') throw new Error('not a .svlevel file');
			this.open(data, `/${file.name}`);
			this.dirty = true;
			this.status = `Imported ${file.name}`;
		} catch (e) {
			this.status = `Import failed: ${(e as Error).message}`;
		}
	}

	async save(): Promise<void> {
		if (!this.project) return;
		this.status = 'Saving…';
		try {
			await saveProject(this.projectPath, $state.snapshot(this.project) as SvLevelProject);
			this.dirty = false;
			this.status = `Saved ${this.projectPath}`;
		} catch (e) {
			this.status = `Save failed: ${(e as Error).message}`;
		}
	}

	private defaultActiveLayer(): number {
		const layers = this.project?.layers ?? [];
		const paintable = layers.find((l) => l.type === 'IdGrid' || l.type === 'Tiles');
		return (paintable ?? layers[0])?.uid ?? -1;
	}

	private initBrush(): void {
		const def = this.activeLayerDef;
		if (def?.type === 'IdGrid') {
			this.selectedId = this.project?.autoRuleGroups?.[0]?.name ?? '';
		}
		this.brush = { ids: [], w: 0, h: 0 };
		this.brushFlip = 0;
	}

	private snapshot(): SvLevelProject {
		return $state.snapshot(this.project!) as SvLevelProject;
	}

	/** Reset the timeline to a single checkpoint for the freshly-loaded document. */
	private resetHistory(label: string): void {
		this.states = this.project ? [this.snapshot()] : [];
		this.nextHistoryId = 0;
		this.historyEntries = this.project ? [{ id: this.nextHistoryId++, label }] : [];
		this.historyIndex = 0;
		this.strokeActive = false;
	}

	/** Append a post-mutation checkpoint, dropping any redo branch and capping length. */
	private pushHistory(label: string): void {
		if (!this.project) return;
		// Discard the redo branch, then append the new state.
		this.states.length = this.historyIndex + 1;
		this.states.push(this.snapshot());
		this.historyEntries = [
			...this.historyEntries.slice(0, this.historyIndex + 1),
			{ id: this.nextHistoryId++, label }
		];
		// Cap memory: drop the oldest checkpoint(s).
		while (this.states.length > HISTORY_LIMIT) {
			this.states.shift();
			this.historyEntries = this.historyEntries.slice(1);
		}
		this.historyIndex = this.states.length - 1;
	}

	/** Mark content changed + request a redraw. */
	touch(): void {
		this.dirty = true;
		this.revision++;
	}

	/** Run a discrete, undoable mutation, recording it under `label`. */
	commit(label: string, fn: () => void): void {
		if (!this.project) return;
		fn();
		this.pushHistory(label);
		this.touch();
	}

	/** Begin a paint stroke (one checkpoint at `endStroke`, even across many pointer moves). */
	beginStroke(label: string): void {
		if (this.strokeActive) return;
		this.strokeActive = true;
		this.strokeLabel = label;
	}

	endStroke(): void {
		if (!this.strokeActive) return;
		this.strokeActive = false;
		this.pushHistory(this.strokeLabel);
		this.touch();
	}

	private restore(index: number): void {
		this.historyIndex = index;
		// Clone so future edits never mutate the stored snapshot.
		this.project = structuredClone(this.states[index]) ?? null;
		this.afterHistorySwap();
	}

	undo(): void {
		if (this.canUndo) this.restore(this.historyIndex - 1);
	}

	redo(): void {
		if (this.canRedo) this.restore(this.historyIndex + 1);
	}

	/** Jump straight to any checkpoint in the timeline (History panel). */
	jumpTo(index: number): void {
		if (index < 0 || index >= this.states.length || index === this.historyIndex) return;
		this.restore(index);
	}

	private afterHistorySwap(): void {
		this.clampSelections();
		this.dirty = true;
		this.revision++;
	}

	private clampSelections(): void {
		const p = this.project;
		if (!p) return;
		if (!p.levels.some((l) => l.uid === this.currentLevelUid)) {
			this.currentLevelUid = p.levels[0]?.uid ?? -1;
		}
		if (!p.layers.some((l) => l.uid === this.activeLayerUid)) {
			this.activeLayerUid = this.defaultActiveLayer();
		}
		const level = this.currentLevel;
		const ids = new Set<string>();
		if (level) for (const li of level.layers) for (const e of li.entities) ids.add(e.iid);
		this.selectedEntityIids = this.selectedEntityIids.filter((iid) => ids.has(iid));
	}

	setTool(t: EditorTool): void {
		this.tool = t;
	}

	setActiveLayer(uid: number): void {
		this.activeLayerUid = uid;
		this.initBrush();
		this.selectedEntityIids = [];
	}

	setCurrentLevel(uid: number): void {
		if (uid === this.currentLevelUid) return;
		this.currentLevelUid = uid;
		this.selectedEntityIids = [];
		this.revision++;
	}

	selectEntities(iids: string[]): void {
		this.selectedEntityIids = iids;
	}

	clearSelection(): void {
		this.selectedEntityIids = [];
	}

	addLevel(): void {
		const p = this.project;
		if (!p) return;
		this.commit('Add level', () => {
			// Place the new level to the right of the rightmost existing one.
			let x = 0;
			for (const l of p.levels) x = Math.max(x, l.worldX + l.pxWid);
			const n = p.levels.length;
			const level = makeLevel(p, {
				identifier: `Level_${n}`,
				pxWid: 16 * 16,
				pxHei: 16 * 9,
				worldX: x + 32,
				worldY: 0
			});
			recomputeAllAutoTiles(p, level);
			p.levels.push(level);
			this.currentLevelUid = level.uid;
		});
	}

	addAdjacentLevel(uid: number, dir: 'left' | 'right' | 'top' | 'bottom'): void {
		const p = this.project;
		const src = p?.levels.find((l) => l.uid === uid);
		if (!p || !src) return;
		this.commit('Add adjacent level', () => {
			let worldX = src.worldX;
			let worldY = src.worldY;
			if (dir === 'left') worldX = src.worldX - src.pxWid;
			else if (dir === 'right') worldX = src.worldX + src.pxWid;
			else if (dir === 'top') worldY = src.worldY - src.pxHei;
			else worldY = src.worldY + src.pxHei;
			const level = makeLevel(p, {
				identifier: `Level_${p.levels.length}`,
				pxWid: src.pxWid,
				pxHei: src.pxHei,
				worldX,
				worldY
			});
			recomputeAllAutoTiles(p, level);
			p.levels.push(level);
			this.currentLevelUid = level.uid;
		});
	}

	deleteLevel(uid: number): void {
		const p = this.project;
		if (!p || p.levels.length <= 1) return;
		this.commit('Delete level', () => {
			p.levels = p.levels.filter((l) => l.uid !== uid);
			if (this.currentLevelUid === uid) this.currentLevelUid = p.levels[0]?.uid ?? -1;
		});
	}

	resizeCurrentLevel(pxWid: number, pxHei: number): void {
		const p = this.project;
		const level = this.currentLevel;
		if (!p || !level) return;
		this.commit('Resize level', () => {
			level.pxWid = Math.max(level.layers[0]?.gridSize ?? 16, Math.round(pxWid));
			level.pxHei = Math.max(level.layers[0]?.gridSize ?? 16, Math.round(pxHei));
			for (const li of level.layers) resizeLayerInstance(li, level.pxWid, level.pxHei);
			recomputeAllAutoTiles(p, level);
		});
	}

	/**
	 * Resize the current level by dragging one edge. `deltaCells` is signed grid cells the edge moved.
	 * Left/top edges move the origin and shift content so it stays put; right/bottom grow the far side.
	 */
	resizeLevelEdge(
		edge: 'left' | 'right' | 'top' | 'bottom',
		deltaCells: number,
		gridSize: number
	): void {
		const p = this.project;
		const level = this.currentLevel;
		if (!p || !level || deltaCells === 0) return;
		const dPx = deltaCells * gridSize;
		this.commit('Resize level', () => {
			let shiftX = 0;
			let shiftY = 0;
			if (edge === 'right') {
				level.pxWid = Math.max(gridSize, level.pxWid + dPx);
			} else if (edge === 'bottom') {
				level.pxHei = Math.max(gridSize, level.pxHei + dPx);
			} else if (edge === 'left') {
				const newWid = Math.max(gridSize, level.pxWid + dPx);
				shiftX = newWid - level.pxWid; // content moves with the origin
				level.worldX -= shiftX;
				level.pxWid = newWid;
			} else {
				const newHei = Math.max(gridSize, level.pxHei + dPx);
				shiftY = newHei - level.pxHei;
				level.worldY -= shiftY;
				level.pxHei = newHei;
			}
			for (const li of level.layers)
				resizeLayerInstanceShifted(li, level.pxWid, level.pxHei, shiftX, shiftY);
			recomputeAllAutoTiles(p, level);
		});
	}

	addLayerDef(type: SvLayerType): void {
		const p = this.project;
		if (!p) return;
		this.commit(`Add ${type} layer`, () => {
			let name: string = type;
			let n = 1;
			while (p.layers.some((l) => l.identifier === name)) name = `${type}_${n++}`;
			const def = makeLayerDef(p, type, name);
			p.layers.unshift(def); // front-most
			for (const level of p.levels) {
				level.layers.unshift(makeLayerInstance(def, level.pxWid, level.pxHei));
			}
			this.activeLayerUid = def.uid;
		});
	}

	deleteLayerDef(uid: number): void {
		const p = this.project;
		if (!p || p.layers.length <= 1) return;
		this.commit('Delete layer', () => {
			p.layers = p.layers.filter((l) => l.uid !== uid);
			for (const level of p.levels)
				level.layers = level.layers.filter((li) => li.layerDefUid !== uid);
			if (this.activeLayerUid === uid) this.activeLayerUid = this.defaultActiveLayer();
		});
	}

	/** Move a layer def up (toward front, dir=-1) or down (toward back, dir=+1). */
	moveLayerDef(uid: number, dir: -1 | 1): void {
		const p = this.project;
		if (!p) return;
		const i = p.layers.findIndex((l) => l.uid === uid);
		const j = i + dir;
		if (i < 0 || j < 0 || j >= p.layers.length) return;
		this.commit('Reorder layer', () => {
			const swap = <T>(arr: T[]) => {
				const t = arr[i]!;
				arr[i] = arr[j]!;
				arr[j] = t;
			};
			swap(p.layers);
			for (const level of p.levels) reconcileLevelLayers(p, level);
		});
	}

	toggleLayerVisible(layerDefUid: number): void {
		const level = this.currentLevel;
		if (!level) return;
		const li = level.layers.find((l) => l.layerDefUid === layerDefUid);
		if (!li) return;
		// Visibility is a view toggle; still record it for undo for predictability.
		this.commit(li.visible ? 'Hide layer' : 'Show layer', () => {
			li.visible = !li.visible;
		});
	}

	/** Add a global brush group (unique name as id + tileset). Selects it for painting. */
	addRuleGroup(): void {
		const p = this.project;
		if (!p) return;
		this.editGroups('Add rule group', () => {
			const g = makeAutoRuleGroup(p);
			p.autoRuleGroups.push(g);
			this.selectedId = g.name;
		});
	}

	/** Rename a group (its unique id), cascading the new id through every grid cell + rule pattern. */
	renameRuleGroup(uid: number, name: string): void {
		const p = this.project;
		const g = p?.autoRuleGroups.find((gg) => gg.uid === uid);
		if (!p || !g) return;
		const next = uniqueGroupName(p.autoRuleGroups, sanitizeGroupName(name), uid);
		if (next === g.name) return;
		this.editGroups('Rename rule group', () => {
			const old = g.name;
			renameGroupReferences(p, old, next);
			g.name = next;
			if (this.selectedId === old) this.selectedId = next;
		});
	}

	deleteRuleGroup(uid: number): void {
		const p = this.project;
		if (!p) return;
		this.editGroups('Delete rule group', () => {
			p.autoRuleGroups = p.autoRuleGroups.filter((g) => g.uid !== uid);
		});
	}

	/** Saved group layouts reusable as templates. */
	get rulePresets(): SvAutoRulePreset[] {
		return this.project?.autoRulePresets ?? [];
	}

	/** Snapshot a group's rule layout as a named preset (replaces a same-name one). No re-bake. */
	saveRulePreset(groupUid: number, name: string): void {
		const p = this.project;
		const g = p?.autoRuleGroups.find((gg) => gg.uid === groupUid);
		if (!p || !g) return;
		const preset: SvAutoRulePreset = {
			name: name.trim() || g.name,
			tilesetDefUid: g.tilesetDefUid ?? null,
			rules: $state.snapshot(g.rules) as SvAutoRule[]
		};
		this.commit('Save rule preset', () => {
			if (!p.autoRulePresets) p.autoRulePresets = [];
			const i = p.autoRulePresets.findIndex((pr) => pr.name === preset.name);
			if (i >= 0) p.autoRulePresets[i] = preset;
			else p.autoRulePresets.push(preset);
		});
	}

	/** Create a new group from a preset layout (caller may override tileset/per-rule tiles). Selects it. */
	createGroupFromPreset(preset: SvAutoRulePreset, selfValue: string = preset.name): void {
		const p = this.project;
		if (!p) return;
		this.editGroups('Add group from preset', () => {
			const g = makeGroupFromPreset(p, preset, selfValue);
			p.autoRuleGroups.push(g);
			this.selectedId = g.name;
		});
	}

	deleteRulePreset(index: number): void {
		const p = this.project;
		if (!p?.autoRulePresets) return;
		this.commit('Delete rule preset', () => p.autoRulePresets!.splice(index, 1));
	}

	deleteSelectedEntities(): void {
		const level = this.currentLevel;
		if (!level || this.selectedEntityIids.length === 0) return;
		const ids = new Set(this.selectedEntityIids);
		this.commit(ids.size > 1 ? 'Delete entities' : 'Delete entity', () => {
			for (const li of level.layers) {
				if (li.type !== 'Entities') continue;
				li.entities = li.entities.filter((e) => !ids.has(e.iid));
			}
		});
		this.selectedEntityIids = [];
	}

	/** Recompute the auto-tiles for one auto-layer def in the current level (after a rule edit). */
	recomputeLayer(layerDefUid: number): void {
		const p = this.project;
		const level = this.currentLevel;
		if (!p || !level) return;
		const li = level.layers.find((l) => l.layerDefUid === layerDefUid);
		if (li) recomputeAutoTiles(p, level, li);
		this.touch();
	}

	/** Recompute every auto-layer in every level (after a global group/rule/tileset edit). */
	recomputeAll(): void {
		if (this.project) recomputeAllAutoTilesAllLevels(this.project);
	}

	/** Recompute one layer def's auto-tiles across every level (after a rule/tileset edit). */
	recomputeLayerAllLevels(layerDefUid: number): void {
		const p = this.project;
		if (!p) return;
		for (const level of p.levels) {
			const li = level.layers.find((l) => l.layerDefUid === layerDefUid);
			if (li) recomputeAutoTiles(p, level, li);
		}
	}

	/** Undoable edit to an auto-layer's rules: runs `fn`, then refreshes its auto-tiles in every level. */
	editRules(layerDefUid: number, label: string, fn: () => void): void {
		if (!this.project) return;
		this.commit(label, () => {
			fn();
			this.recomputeLayerAllLevels(layerDefUid);
		});
	}

	/** Undoable edit to the GLOBAL rule groups: runs `fn`, then recomputes every auto-layer everywhere. */
	editGroups(label: string, fn: () => void): void {
		const p = this.project;
		if (!p) return;
		this.commit(label, () => {
			fn();
			recomputeAllAutoTilesAllLevels(p);
		});
	}

	/** Run an undoable edit against the project's localization table, creating it if absent. */
	editLocalization(label: string, fn: (loc: SvLocalization) => void): void {
		const p = this.project;
		if (!p) return;
		this.commit(label, () => {
			if (!p.localization) p.localization = emptyLocalization();
			fn(p.localization);
		});
	}

	/**
	 * Add a table row for every in-use Sign/Dialogue source string not already present.
	 * Returns rows added (0 = nothing new, no history entry recorded).
	 */
	scanLocalization(): number {
		const p = this.project;
		if (!p) return 0;
		const existing = new Set(p.localization?.entries.map((e) => e.key) ?? []);
		const missing = collectLocalizableStrings(p).filter((s) => !existing.has(s));
		if (missing.length === 0) return 0;
		this.editLocalization('Scan localizable text', (loc) => {
			for (const key of missing) loc.entries.push({ key, values: {} });
		});
		return missing.length;
	}
}

export const editor = new EditorStore();
