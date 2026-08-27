<script lang="ts">
	/**
	 * Top-level editor layout: toolbar across the top, panels left/right, canvas in the
	 * middle. Loads the default project on mount and owns the global keyboard shortcuts.
	 */
	import { onMount } from 'svelte';
	import { editor } from '../state/editorStore.svelte';
	import type { SvLevelProject } from '../../format/types';
	import EditorCanvas from './canvas/EditorCanvas.svelte';
	import Toolbar from './Toolbar.svelte';
	import LayersPanel from './panels/LayersPanel.svelte';
	import LevelsPanel from './panels/LevelsPanel.svelte';
	import HistoryPanel from './panels/HistoryPanel.svelte';
	import TilesetPalette from './panels/TilesetPalette.svelte';
	import IdGridPalette from './panels/IdGridPalette.svelte';
	import EntityPalette from './panels/EntityPalette.svelte';
	import PropertiesPanel from './panels/PropertiesPanel.svelte';
	import AutoRuleEditor from './dialogs/AutoRuleEditor.svelte';
	import EnumEditor from './dialogs/EnumEditor.svelte';
	import TilesetTagEditor from './dialogs/TilesetTagEditor.svelte';
	import CollisionEditor from './dialogs/CollisionEditor.svelte';
	import TileFlipEditor from './dialogs/TileFlipEditor.svelte';
	import TilesetImport from './dialogs/TilesetImport.svelte';
	import LocalizationEditor from './dialogs/LocalizationEditor.svelte';
	import EntityDefsEditor from './dialogs/EntityDefsEditor.svelte';

	/**
	 * `onplay` gets the live document (no save round-trip) plus the level being edited, so a host
	 * can hand it straight to `createLevelRuntime`. Absent -> no Play button.
	 */
	let {
		onplay
	}: { onplay?: (project: SvLevelProject, levelUid: number) => void } = $props();

	let canvas = $state<{ frameLevel: () => void }>();
	let rootEl = $state<HTMLDivElement>();

	type DialogKind =
		| 'rules'
		| 'enums'
		| 'tags'
		| 'collision'
		| 'flip'
		| 'import'
		| 'localization'
		| 'entities';
	let dialog = $state<DialogKind | null>(null);

	const activeType = $derived(editor.activeLayerDef?.type);

	function frame() {
		canvas?.frameLevel();
	}

	function isTyping(t: EventTarget | null): boolean {
		const el = t as HTMLElement | null;
		return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
	}

	function commitFocusedEditor(e: PointerEvent) {
		const active = document.activeElement;
		const target = e.target;
		if (!(active instanceof HTMLElement) || !(target instanceof Node)) return;
		if (!rootEl?.contains(active) || active.contains(target) || !isTyping(active)) return;
		active.blur();
	}

	function onKey(e: KeyboardEvent) {
		if (dialog || isTyping(e.target)) return;
		const mod = e.metaKey || e.ctrlKey;
		if (mod && e.code === 'KeyZ') {
			e.preventDefault();
			if (e.shiftKey) editor.redo();
			else editor.undo();
			return;
		}
		if (mod && e.code === 'KeyY') {
			e.preventDefault();
			editor.redo();
			return;
		}
		if (mod && e.code === 'KeyS') {
			e.preventDefault();
			editor.save();
			return;
		}
		if (mod) return;
		if (e.code === 'F5' || (e.code === 'KeyP' && onplay)) {
			e.preventDefault();
			play();
			return;
		}
		switch (e.code) {
			case 'KeyV':
			case 'KeyS':
				editor.setTool('select');
				break;
			case 'KeyB':
				editor.setTool('brush');
				break;
			case 'KeyE':
				editor.setTool('eraser');
				break;
			case 'KeyR':
				editor.setTool('rect');
				break;
			case 'KeyG':
				editor.setTool('fill');
				break;
			case 'KeyI':
				editor.setTool('picker');
				break;
			case 'KeyA':
				editor.setTool('entity');
				break;
			case 'KeyF':
				frame();
				break;
			case 'KeyX':
				editor.brushFlip = (editor.brushFlip ^ 1) as 0 | 1 | 2 | 3;
				break;
			case 'KeyT':
				editor.brushRandomMode = !editor.brushRandomMode;
				editor.status = `Random brush: ${editor.brushRandomMode ? 'on' : 'off'}`;
				break;
			case 'Delete':
			case 'Backspace':
				editor.deleteSelectedEntities();
				break;
		}
	}

	function play() {
		const project = editor.snapshotProject();
		if (project) onplay?.(project, editor.currentLevelUid);
	}

	onMount(() => {
		editor.refreshProjectList();
		if (!editor.project && editor.projectPath) editor.load();
		const root = rootEl;
		window.addEventListener('keydown', onKey);
		root?.addEventListener('pointerdown', commitFocusedEditor, { capture: true });
		return () => {
			window.removeEventListener('keydown', onKey);
			root?.removeEventListener('pointerdown', commitFocusedEditor, { capture: true });
		};
	});
</script>

<svelte:window
	onbeforeunload={(e) => {
		if (editor.dirty) {
			e.preventDefault();
			e.returnValue = '';
		}
	}}
/>

<div bind:this={rootEl} class="editor">
	<Toolbar onframe={frame} onopendialog={(k) => (dialog = k)} onplay={onplay ? play : undefined} />

	<aside class="left">
		<LayersPanel onrules={() => (dialog = 'rules')} />
		<LevelsPanel />
		<HistoryPanel />
	</aside>

	<main class="center">
		{#if editor.project}
			<EditorCanvas bind:this={canvas} />
		{:else}
			<div class="empty">{editor.status || 'Loading…'}</div>
		{/if}
	</main>

	<aside class="right">
		{#if activeType === 'Tiles' || activeType === 'AutoLayer'}
			<TilesetPalette />
		{:else if activeType === 'IdGrid'}
			<IdGridPalette onrules={() => (dialog = 'rules')} />
		{:else if activeType === 'Entities'}
			<EntityPalette onedittypes={() => (dialog = 'entities')} />
		{/if}
		<PropertiesPanel />
	</aside>

	{#if dialog === 'rules'}
		<AutoRuleEditor onclose={() => (dialog = null)} />
	{:else if dialog === 'enums'}
		<EnumEditor onclose={() => (dialog = null)} />
	{:else if dialog === 'tags'}
		<TilesetTagEditor onclose={() => (dialog = null)} />
	{:else if dialog === 'collision'}
		<CollisionEditor onclose={() => (dialog = null)} />
	{:else if dialog === 'flip'}
		<TileFlipEditor onclose={() => (dialog = null)} />
	{:else if dialog === 'import'}
		<TilesetImport onclose={() => (dialog = null)} />
	{:else if dialog === 'localization'}
		<LocalizationEditor onclose={() => (dialog = null)} />
	{:else if dialog === 'entities'}
		<EntityDefsEditor onclose={() => (dialog = null)} />
	{/if}
</div>

<style>
	.editor {
		/* Lospec "PurpleMorning8" (#cdd4a5 #cfa98a #c7786f #9a6278 #60556e #3b405e #2e2a4f #211d38),
		   extended with two shades below #211d38 and one tint of #9a6278 — the source
		   palette bottoms out too early for UI chrome. */
		--p0: #0d0b18;
		--p1: #171426;
		--p2: #211d38;
		--p3: #2e2a4f;
		--p4: #3b405e;
		--p5: #60556e;
		--p6: #9a6278;
		--p6-lt: #af7e7f;
		--p7: #c7786f;
		--p8: #cfa98a;
		--p9: #cdd4a5;

		--bg: var(--p1);
		--panel: var(--p2);
		--panel-2: var(--p3);
		--border: var(--p4);
		--text: var(--p9);
		--muted: var(--p6-lt);
		--accent: var(--p7);
		--accent-dim: #5b3d4b;
		color-scheme: dark;
		accent-color: var(--accent);
		display: grid;
		grid-template-columns: 248px 1fr 312px;
		grid-template-rows: auto 1fr;
		height: 100%;
		width: 100%;
		overflow: hidden;
		background: var(--bg);
		color: var(--text);
		font:
			12px/1.4 ui-sans-serif,
			system-ui,
			sans-serif;
	}
	.editor :global(*) {
		box-sizing: border-box;
	}
	:global(.editor) {
		--bg: #171426;
	}
	.left,
	.right {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
		background: var(--panel);
	}
	.left {
		border-right: 1px solid var(--border);
	}
	.right {
		border-left: 1px solid var(--border);
	}
	.center {
		position: relative;
		min-width: 0;
		min-height: 0;
	}
	.empty {
		display: grid;
		place-items: center;
		height: 100%;
		color: var(--muted);
	}
	/* Tooltip bubbles are rendered into document.body (outside .editor), so they can't
	   inherit the editor's CSS vars — keep these colors literal. */
	:global(.sv-tooltip) {
		position: fixed;
		z-index: 1000;
		pointer-events: none;
		max-width: 260px;
		padding: 4px 8px;
		border-radius: 5px;
		background: #0d0b18;
		color: #cdd4a5;
		border: 1px solid #3b405e;
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
		font:
			11px/1.35 ui-sans-serif,
			system-ui,
			sans-serif;
		white-space: nowrap;
		animation: sv-tooltip-in 90ms ease-out;
	}
	@keyframes sv-tooltip-in {
		from {
			opacity: 0;
			transform: translateY(-2px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	/* ---- Form controls -------------------------------------------------
	   Native select/range/checkbox are replaced with themed ones. Base rules
	   are wrapped in :where() so they carry zero specificity and existing
	   component-local sizing rules still win. */

	/* Focus is drawn *inside* the control — an outer ring hung off an already
	   bordered field reads as tacked on. Fields recolour their own border
	   instead; borderless things get an inset outline. */
	.editor :global(button:focus-visible),
	.editor :global([tabindex]:focus-visible) {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.editor :global(input:focus-visible),
	.editor :global(textarea:focus-visible),
	.editor :global(select:focus-visible) {
		outline: none;
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
	}
	.editor :global(input[type='checkbox']:focus-visible) {
		outline: none;
		border-color: var(--accent);
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 45%, transparent);
	}
	.editor :global(input[type='range']:focus-visible) {
		outline: none;
		box-shadow: none;
	}
	.editor :global(input[type='range']:focus-visible::-webkit-slider-thumb) {
		background: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 40%, transparent);
	}

	/* select ------------------------------------------------------------ */
	.editor :global(:where(select)) {
		appearance: none;
		box-sizing: border-box;
		padding: 4px 24px 4px 8px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background-color: var(--bg);
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%23af7e7f' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 7px center;
		color: var(--text);
		font: inherit;
		cursor: pointer;
		transition:
			border-color 130ms ease,
			background-color 130ms ease;
	}
	.editor :global(:where(select):hover:not(:disabled)) {
		border-color: var(--p5);
	}
	.editor :global(:where(select):disabled) {
		opacity: 0.5;
		cursor: default;
	}

	@supports (appearance: base-select) {
		.editor :global(select) {
			appearance: base-select;
			display: inline-flex;
			align-items: center;
			gap: 6px;
			padding-right: 6px;
			background-image: none;
		}
		.editor :global(select::picker-icon) {
			color: var(--muted);
			margin-inline-start: auto;
			transition:
				rotate 170ms cubic-bezier(0.2, 0.9, 0.3, 1),
				color 130ms ease;
		}
		.editor :global(select:open::picker-icon) {
			rotate: 180deg;
			color: var(--accent);
		}
		.editor :global(select::picker(select)) {
			appearance: base-select;
			min-width: anchor-size(width);
			margin-block-start: 4px;
			padding: 4px;
			border: 1px solid var(--border);
			border-radius: 8px;
			background: var(--panel-2);
			box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
			opacity: 0;
			translate: 0 -6px;
			transition:
				opacity 140ms ease,
				translate 140ms cubic-bezier(0.2, 0.9, 0.3, 1),
				overlay 140ms allow-discrete,
				display 140ms allow-discrete;
		}
		.editor :global(select:open::picker(select)) {
			opacity: 1;
			translate: 0 0;
		}
		@starting-style {
			.editor :global(select:open::picker(select)) {
				opacity: 0;
				translate: 0 -6px;
			}
		}
		.editor :global(select option) {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 5px 8px;
			border-radius: 5px;
			background: transparent;
			color: var(--text);
			cursor: pointer;
			transition:
				background-color 110ms ease,
				color 110ms ease;
		}
		.editor :global(select option:hover),
		.editor :global(select option:focus) {
			background: var(--p4);
		}
		.editor :global(select option:checked) {
			color: var(--accent);
		}
		.editor :global(select option::checkmark) {
			order: 1;
			margin-inline-start: auto;
			color: var(--accent);
		}
	}

	/* range -------------------------------------------------------------- */
	.editor :global(:where(input[type='range'])) {
		appearance: none;
		width: 100%;
		height: 16px;
		background: transparent;
		cursor: pointer;
		--range-p: 0%;
		--range-track: var(--p4);
		--range-fill: var(--accent);
	}
	.editor :global(input[type='range']:disabled) {
		opacity: 0.45;
		cursor: default;
	}
	.editor :global(input[type='range']::-webkit-slider-runnable-track) {
		height: 4px;
		border-radius: 999px;
		background:
			linear-gradient(var(--range-fill), var(--range-fill)) 0 / var(--range-p) 100% no-repeat,
			var(--range-track);
	}
	.editor :global(input[type='range']::-webkit-slider-thumb) {
		appearance: none;
		width: 12px;
		height: 12px;
		margin-top: -4px;
		border-radius: 50%;
		background: var(--text);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.5);
		transition:
			background-color 130ms ease,
			scale 130ms cubic-bezier(0.2, 0.9, 0.3, 1);
	}
	.editor :global(input[type='range']:hover:not(:disabled)::-webkit-slider-thumb) {
		background: var(--accent);
		scale: 1.18;
	}
	.editor :global(input[type='range']:active:not(:disabled)::-webkit-slider-thumb) {
		scale: 0.94;
	}
	.editor :global(input[type='range']::-moz-range-track) {
		height: 4px;
		border-radius: 999px;
		background: var(--range-track);
	}
	.editor :global(input[type='range']::-moz-range-progress) {
		height: 4px;
		border-radius: 999px;
		background: var(--range-fill);
	}
	.editor :global(input[type='range']::-moz-range-thumb) {
		width: 12px;
		height: 12px;
		border: none;
		border-radius: 50%;
		background: var(--text);
	}

	/* checkbox ----------------------------------------------------------- */
	.editor :global(:where(input[type='checkbox'])) {
		appearance: none;
		display: inline-grid;
		place-content: center;
		flex: none;
		width: 15px;
		height: 15px;
		margin: 0;
		border: 1px solid var(--p5);
		border-radius: 4px;
		background: var(--bg);
		cursor: pointer;
		transition:
			background-color 130ms ease,
			border-color 130ms ease;
	}
	.editor :global(input[type='checkbox']::before) {
		content: '';
		width: 9px;
		height: 9px;
		background: var(--p0);
		clip-path: polygon(14% 44%, 0 65%, 42% 100%, 100% 20%, 82% 6%, 38% 68%);
		scale: 0;
		transition: scale 150ms cubic-bezier(0.2, 0.9, 0.4, 1.4);
	}
	.editor :global(input[type='checkbox']:hover:not(:checked):not(:disabled)) {
		border-color: var(--accent);
	}
	.editor :global(input[type='checkbox']:checked) {
		background: var(--accent);
		border-color: var(--accent);
	}
	.editor :global(input[type='checkbox']:checked::before) {
		scale: 1;
	}
	.editor :global(input[type='checkbox']:disabled) {
		opacity: 0.45;
		cursor: default;
	}

	/* text fields --------------------------------------------------------- */
	.editor :global(:where(input, textarea, select)) {
		transition:
			border-color 130ms ease,
			background-color 130ms ease,
			box-shadow 130ms ease;
	}

	@media (prefers-reduced-motion: reduce) {
		.editor :global(*),
		.editor :global(*::before),
		.editor :global(*::after) {
			transition-duration: 1ms !important;
			animation-duration: 1ms !important;
		}
	}
</style>
