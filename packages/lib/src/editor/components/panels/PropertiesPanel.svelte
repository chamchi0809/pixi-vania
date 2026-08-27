<script lang="ts">
	/**
	 * Context-sensitive inspector: current level, active layer, selected entity + its fields.
	 * Every edit goes through `editor.commit` so it is a single undo step.
	 */
	import { editor } from '../../state/editorStore.svelte';
	import { findEntity, recomputeAutoTiles } from '../../state/ops';
	import { getEntityType } from '../../../format/entities';
	import type { SvFieldValue } from '../../../format/types';
	import Panel from './Panel.svelte';
	import FieldInput from './FieldInput.svelte';
	import DialogueEditor from './DialogueEditor.svelte';
	import NumberInput from '../common/NumberInput.svelte';
	import ColorInput from '../common/ColorInput.svelte';
	import { rangeFill } from '../common/rangeFill';

	const level = $derived(editor.currentLevel);
	const def = $derived(editor.activeLayerDef);
	const inst = $derived(editor.activeLayerInstance);
	const project = $derived(editor.project);

	const selection = $derived.by(() => {
		if (!level || editor.selectedEntityIids.length !== 1) return null;
		return findEntity(level, editor.selectedEntityIids[0]);
	});
	const selEntityDef = $derived(selection ? getEntityType(project, selection.entity.type) : undefined);

	const idGridLayers = $derived(project?.layers.filter((l) => l.type === 'IdGrid') ?? []);

	function set(label: string, fn: () => void) {
		editor.commit(label, fn);
	}

	/** Apply a tileset / rule-source change and refresh affected auto-tiles across levels. */
	function setLayerTileset(uid: number | null) {
		if (!def || !project) return;
		set('Set layer tileset', () => {
			def.tilesetDefUid = uid;
			for (const lv of project.levels) {
				const li = lv.layers.find((l) => l.layerDefUid === def.uid);
				if (li) {
					li.tilesetDefUid = uid;
					recomputeAutoTiles(project, lv, li);
				}
			}
		});
	}

	function setAutoSource(uid: number | null) {
		if (!def || !project) return;
		set('Set auto-layer source', () => {
			def.autoSourceLayerDefUid = uid;
			for (const lv of project.levels) {
				const li = lv.layers.find((l) => l.layerDefUid === def.uid);
				if (li) recomputeAutoTiles(project, lv, li);
			}
		});
	}

	function renameLayer(name: string) {
		if (!def || !project) return;
		set('Rename layer', () => {
			def.identifier = name;
			for (const lv of project.levels) {
				const li = lv.layers.find((l) => l.layerDefUid === def.uid);
				if (li) li.identifier = name;
			}
		});
	}
</script>

{#if level}
	<Panel title="Level">
		<div class="grid">
			<span class="lbl">Name</span>
			<input
				class="text"
				value={level.identifier}
				onchange={(e) => set('Rename level', () => (level.identifier = e.currentTarget.value))}
			/>
			<span class="lbl">Width</span>
			<NumberInput
				int
				value={level.pxWid}
				min={level.layers[0]?.gridSize ?? 16}
				step={level.layers[0]?.gridSize ?? 16}
				onchange={(v) => editor.resizeCurrentLevel(v, level.pxHei)}
			/>
			<span class="lbl">Height</span>
			<NumberInput
				int
				value={level.pxHei}
				min={level.layers[0]?.gridSize ?? 16}
				step={level.layers[0]?.gridSize ?? 16}
				onchange={(v) => editor.resizeCurrentLevel(level.pxWid, v)}
			/>
			<span class="lbl">World X</span>
			<NumberInput
				int
				value={level.worldX}
				onchange={(v) => set('Move level', () => (level.worldX = v))}
			/>
			<span class="lbl">World Y</span>
			<NumberInput
				int
				value={level.worldY}
				onchange={(v) => set('Move level', () => (level.worldY = v))}
			/>
			<span class="lbl">BG</span>
			<ColorInput
				value={level.bgColor ?? project?.defaultLevelBgColor ?? '#222222'}
				label="Level background"
				onchange={(c) => set('Set level color', () => (level.bgColor = c))}
			/>
		</div>
	</Panel>
{/if}

{#if def && inst}
	<Panel title="Layer">
		<div class="grid">
			<span class="lbl">Name</span>
			<input
				class="text"
				value={def.identifier}
				onchange={(e) => renameLayer(e.currentTarget.value)}
			/>
			<span class="lbl">Type</span>
			<span class="ro">{def.type}</span>
			<span class="lbl">Grid</span>
			<span class="ro">{def.gridSize}px</span>
			<span class="lbl">Opacity</span>
			<input
				type="range"
				min="0"
				max="1"
				step="0.05"
				value={inst.opacity}
				use:rangeFill={inst.opacity}
				oninput={(e) => (inst.opacity = +e.currentTarget.value)}
				onchange={(e) => set('Set layer opacity', () => (inst.opacity = +e.currentTarget.value))}
			/>
			{#if def.type === 'Tiles'}
				<span class="lbl">Tileset</span>
				<select
					class="text"
					value={def.tilesetDefUid ?? ''}
					onchange={(e) => setLayerTileset(e.currentTarget.value ? +e.currentTarget.value : null)}
				>
					<option value="">(none)</option>
					{#each project?.tilesets ?? [] as ts (ts.uid)}
						<option value={ts.uid}>{ts.identifier}</option>
					{/each}
				</select>
			{/if}
			{#if def.type === 'AutoLayer'}
				<span class="lbl">Source</span>
				<select
					class="text"
					value={def.autoSourceLayerDefUid ?? ''}
					onchange={(e) => setAutoSource(e.currentTarget.value ? +e.currentTarget.value : null)}
				>
					<option value="">(none)</option>
					{#each idGridLayers as l (l.uid)}
						<option value={l.uid}>{l.identifier}</option>
					{/each}
				</select>
			{/if}
		</div>
	</Panel>
{/if}

{#if selection && selEntityDef}
	{@const e = selection.entity}
	<Panel title={selEntityDef.name} grow>
		{#snippet actions()}
			<button class="del" onclick={() => editor.deleteSelectedEntities()}>Delete</button>
		{/snippet}
		<div class="grid">
			<span class="lbl">X</span>
			<NumberInput
				int
				value={e.px[0]}
				onchange={(v) => set('Move entity', () => (e.px = [v, e.px[1]]))}
			/>
			<span class="lbl">Y</span>
			<NumberInput
				int
				value={e.px[1]}
				onchange={(v) => set('Move entity', () => (e.px = [e.px[0], v]))}
			/>
			{#if selEntityDef.resizableX}
				<span class="lbl">W</span>
				<NumberInput
					int
					value={e.width}
					min={1}
					onchange={(v) => set('Resize entity', () => (e.width = v))}
				/>
			{/if}
			{#if selEntityDef.resizableY}
				<span class="lbl">H</span>
				<NumberInput
					int
					value={e.height}
					min={1}
					onchange={(v) => set('Resize entity', () => (e.height = v))}
				/>
			{/if}
		</div>

		{#if selEntityDef.fields.length}
			<h4>Fields</h4>
			<div class="grid">
				{#each selEntityDef.fields as f (f.id)}
					{#if f.type !== 'Dialogue'}
						<span class="lbl" title={f.doc}>{f.id}</span>
						<FieldInput
							type={f.type}
							enumId={f.enumId}
							options={f.options}
							min={f.min}
							max={f.max}
							value={e.fields[f.id]}
							onchange={(v: SvFieldValue) => set('Edit field', () => (e.fields[f.id] = v))}
						/>
					{/if}
				{/each}
			</div>
			{#each selEntityDef.fields.filter((f) => f.type === 'Dialogue') as f (f.id)}
				<h4>{f.id}</h4>
				<DialogueEditor entity={e} field={f.id} />
			{/each}
		{/if}
	</Panel>
{:else if editor.selectedEntityIids.length > 1}
	<Panel title="Selection">
		<p class="dim">{editor.selectedEntityIids.length} entities selected</p>
		<button class="del" onclick={() => editor.deleteSelectedEntities()}>Delete selected</button>
	</Panel>
{/if}

<style>
	.grid {
		display: grid;
		grid-template-columns: 56px 1fr;
		gap: 5px 7px;
		align-items: center;
	}
	.lbl {
		color: var(--muted);
		font-size: 11px;
	}
	.text {
		width: 100%;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 3px 5px;
		font: inherit;
	}
	.ro {
		color: var(--text);
	}
	input[type='range'] {
		width: 100%;
	}
	h4 {
		margin: 10px 2px 4px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.dim {
		color: var(--muted);
	}
	.del {
		background: #5a2530;
		border: 1px solid #7a3340;
		color: #ffd7dd;
		border-radius: 4px;
		padding: 4px 8px;
		cursor: pointer;
		font: inherit;
	}
	.del:hover {
		background: #6e2d3a;
	}
</style>
