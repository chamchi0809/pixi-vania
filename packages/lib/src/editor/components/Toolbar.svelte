<script lang="ts">
	import { editor, type EditorTool } from '../state/editorStore.svelte';
	import { tooltip } from './common/tooltip';
	import type { Icon } from '@tabler/icons-svelte';
	import IconPointer from '@tabler/icons-svelte/icons/pointer';
	import IconBrush from '@tabler/icons-svelte/icons/brush';
	import IconSquare from '@tabler/icons-svelte/icons/square';
	import IconBucketDroplet from '@tabler/icons-svelte/icons/bucket-droplet';
	import IconEraser from '@tabler/icons-svelte/icons/eraser';
	import IconColorPicker from '@tabler/icons-svelte/icons/color-picker';
	import IconClick from '@tabler/icons-svelte/icons/click';
	import IconHandStop from '@tabler/icons-svelte/icons/hand-stop';
	import IconArrowBackUp from '@tabler/icons-svelte/icons/arrow-back-up';
	import IconArrowForwardUp from '@tabler/icons-svelte/icons/arrow-forward-up';
	import IconFocusCentered from '@tabler/icons-svelte/icons/focus-centered';
	import IconGridDots from '@tabler/icons-svelte/icons/grid-dots';
	import IconStack2 from '@tabler/icons-svelte/icons/stack-2';
	import IconFlipHorizontal from '@tabler/icons-svelte/icons/flip-horizontal';
	import IconFlipVertical from '@tabler/icons-svelte/icons/flip-vertical';
	import IconDice3 from '@tabler/icons-svelte/icons/dice-3';
	import IconDeviceFloppy from '@tabler/icons-svelte/icons/device-floppy';
	import IconPlayerPlay from '@tabler/icons-svelte/icons/player-play';
	import IconDownload from '@tabler/icons-svelte/icons/download';
	import IconUpload from '@tabler/icons-svelte/icons/upload';

	let {
		onframe,
		onopendialog,
		onplay
	}: {
		onframe: () => void;
		onopendialog: (
			k:
				| 'rules'
				| 'enums'
				| 'tags'
				| 'collision'
				| 'flip'
				| 'import'
				| 'localization'
				| 'entities'
				| 'levelFields'
		) => void;
		/** Absent when the host wired no play handler. */
		onplay?: () => void;
	} = $props();

	let fileEl: HTMLInputElement;

	function pickFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (file) void editor.importFile(file);
		(e.currentTarget as HTMLInputElement).value = '';
	}

	const tools: { id: EditorTool; icon: Icon; label: string; key: string }[] = [
		{ id: 'select', icon: IconPointer, label: 'Select / move', key: 'V' },
		{ id: 'brush', icon: IconBrush, label: 'Brush', key: 'B' },
		{ id: 'rect', icon: IconSquare, label: 'Rectangle', key: 'R' },
		{ id: 'fill', icon: IconBucketDroplet, label: 'Bucket fill', key: 'G' },
		{ id: 'eraser', icon: IconEraser, label: 'Eraser', key: 'E' },
		{ id: 'picker', icon: IconColorPicker, label: 'Pick', key: 'I' },
		{ id: 'entity', icon: IconClick, label: 'Place entity', key: 'A' },
		{ id: 'pan', icon: IconHandStop, label: 'Pan (or hold Space)', key: '' }
	];

	const zoomPct = $derived(Math.round(editor.camera.zoom * 100));
	const saveLabel = $derived.by(() => {
		if (!editor.projectPath.endsWith('.svlevel.json')) return 'Save As';
		return editor.dirty ? 'Save' : 'Saved';
	});

	function toolLabel(tool: (typeof tools)[number]): string {
		return tool.key ? `${tool.label} (${tool.key})` : tool.label;
	}
</script>

<header class="toolbar">
	<div class="brand">pixi-vania</div>

	<div class="group tools">
		{#each tools as t (t.id)}
			{@const Icon = t.icon}
			<button
				class="tool"
				aria-label={toolLabel(t)}
				class:active={editor.tool === t.id}
				use:tooltip={toolLabel(t)}
				onclick={() => editor.setTool(t.id)}
			>
				<Icon size={16} />
			</button>
		{/each}
	</div>

	<div class="group">
		<button class="btn" aria-label="Undo" disabled={!editor.canUndo} use:tooltip={'Undo (Ctrl/Cmd+Z)'} onclick={() => editor.undo()}>
			<IconArrowBackUp size={16} />
		</button>
		<button class="btn" aria-label="Redo" disabled={!editor.canRedo} use:tooltip={'Redo (Ctrl/Cmd+Shift+Z)'} onclick={() => editor.redo()}>
			<IconArrowForwardUp size={16} />
		</button>
	</div>

	<div class="group">
		<button class="btn" aria-label="Frame level" use:tooltip={'Frame level (F)'} onclick={onframe}>
			<IconFocusCentered size={16} />
		</button>
		<button class="btn" aria-label="Toggle grid" class:active={editor.showGrid} use:tooltip={'Toggle grid'} onclick={() => (editor.showGrid = !editor.showGrid)}>
			<IconGridDots size={16} />
		</button>
		<button class="btn" aria-label="Dim inactive layers" class:active={editor.dimInactiveLayers} use:tooltip={'Dim inactive layers'} onclick={() => (editor.dimInactiveLayers = !editor.dimInactiveLayers)}>
			<IconStack2 size={16} />
		</button>
	</div>

	{#if editor.activeLayerDef?.type === 'Tiles'}
		<div class="group flips">
			<button class="btn" aria-label="Flip brush horizontally" class:active={(editor.brushFlip & 1) === 1} use:tooltip={'Flip brush X (X)'} onclick={() => (editor.brushFlip = (editor.brushFlip ^ 1) as 0 | 1 | 2 | 3)}>
				<IconFlipHorizontal size={16} />
			</button>
			<button class="btn" aria-label="Flip brush vertically" class:active={(editor.brushFlip & 2) === 2} use:tooltip={'Flip brush Y'} onclick={() => (editor.brushFlip = (editor.brushFlip ^ 2) as 0 | 1 | 2 | 3)}>
				<IconFlipVertical size={16} />
			</button>
			<button class="btn" aria-label="Toggle random brush" class:active={editor.brushRandomMode} use:tooltip={'Random brush — stamp one random tile from the selection (T)'} onclick={() => (editor.brushRandomMode = !editor.brushRandomMode)}>
				<IconDice3 size={16} />
			</button>
		</div>
	{/if}

	<div class="group project">
		<button class="btn wide" use:tooltip={'Edit auto-layer rules'} onclick={() => onopendialog('rules')}>Rules</button>
		<button class="btn wide" use:tooltip={'Edit enums'} onclick={() => onopendialog('enums')}>Enums</button>
		<button class="btn wide" use:tooltip={'Tag tileset tiles'} onclick={() => onopendialog('tags')}>Tags</button>
		<button class="btn wide" use:tooltip={'Edit per-tile colliders'} onclick={() => onopendialog('collision')}>Collision</button>
		<button class="btn wide" use:tooltip={'Per-tile random flip'} onclick={() => onopendialog('flip')}>Flip</button>
		<button class="btn wide" use:tooltip={'Edit localization table'} onclick={() => onopendialog('localization')}>Locale</button>
		<button class="btn wide" use:tooltip={'Edit entity types'} onclick={() => onopendialog('entities')}>Entities</button>
		<button class="btn wide" use:tooltip={'Edit level field definitions'} onclick={() => onopendialog('levelFields')}>Level fields</button>
		<button class="btn wide" use:tooltip={'Import a tileset image'} onclick={() => onopendialog('import')}>+Tileset</button>
	</div>

	<div class="group project-files">
		<button class="btn wide" onclick={() => editor.newProject()}>New</button>
		<select
			aria-label="Open project"
			value=""
			onchange={(event) => {
				const path = event.currentTarget.value;
				if (path) void editor.load(path);
				event.currentTarget.value = '';
			}}
		>
			<option value="">Open…</option>
			{#each editor.availableProjects as path (path)}<option value={path}>{path}</option>{/each}
		</select>
		<input
			class="path"
			aria-label="Save As project path"
			value={editor.projectPath}
			placeholder="/assets/levels/name.svlevel.json"
			onchange={(event) => (editor.projectPath = event.currentTarget.value.trim())}
		/>
	</div>

	<div class="group">
		<button class="btn" aria-label="Import project" use:tooltip={'Import a .svlevel.json'} onclick={() => fileEl.click()}>
			<IconUpload size={16} />
		</button>
		<button class="btn" aria-label="Export project" use:tooltip={'Export (download) the project'} onclick={() => editor.exportFile()}>
			<IconDownload size={16} />
		</button>
		<input bind:this={fileEl} type="file" accept=".json,application/json" hidden onchange={pickFile} />
	</div>

	<div class="spacer"></div>

	<div class="group zoom">{zoomPct}%</div>

	<div class="group status" class:err={editor.status.toLowerCase().includes('fail')}>
		{editor.status}
	</div>

	{#if onplay}
		<button class="play" aria-label="Play current level" onclick={onplay} use:tooltip={'Play the current level (P)'}>
			<IconPlayerPlay size={14} /> Play
		</button>
	{/if}

	<button class="save" aria-label="Save project" class:dirty={editor.dirty} onclick={() => editor.save()} use:tooltip={'Save (Ctrl/Cmd+S)'}>
		<IconDeviceFloppy size={14} />
		{saveLabel}
	</button>
</header>

<style>
	.toolbar {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 10px;
		background: var(--panel-2);
		border-bottom: 1px solid var(--border);
		user-select: none;
		overflow-x: auto;
		overflow-y: hidden;
	}
	.brand {
		font-weight: 700;
		letter-spacing: 0.04em;
		color: var(--accent);
		padding-right: 6px;
	}
	.group {
		display: flex;
		align-items: center;
		gap: 3px;
	}
	.tools {
		gap: 2px;
	}
	.tool,
	.btn {
		width: 28px;
		height: 28px;
		display: grid;
		place-items: center;
		background: var(--panel);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 5px;
		cursor: pointer;
		font-size: 14px;
		padding: 0;
	}
	.tool:hover,
	.btn:hover {
		background: var(--accent-dim);
	}
	.tool.active,
	.btn.active {
		background: var(--accent);
		color: #0d0b18;
		border-color: var(--accent);
	}
	.btn:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.btn.wide {
		width: auto;
		padding: 0 9px;
		font-size: 11px;
		font-weight: 600;
	}
	.project-files select { max-width: 110px; }
	.path {
		width: 190px;
		height: 28px;
		padding: 0 7px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--panel);
		color: var(--text);
		font: inherit;
	}
	.spacer {
		flex: 1;
	}
	.zoom {
		color: var(--muted);
		min-width: 42px;
		justify-content: flex-end;
	}
	.status {
		color: var(--muted);
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.status.err {
		color: #ff7676;
	}
	.play {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: #2f9e44;
		border: 1px solid #2f9e44;
		color: #0d0b18;
		border-radius: 5px;
		padding: 6px 12px;
		cursor: pointer;
		font-weight: 600;
	}
	.play:hover {
		background: #40c057;
		border-color: #40c057;
	}
	.save {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: var(--accent-dim);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 5px;
		padding: 6px 12px;
		cursor: pointer;
		font-weight: 600;
	}
	.save.dirty {
		background: var(--accent);
		color: #0d0b18;
		border-color: var(--accent);
	}
</style>
