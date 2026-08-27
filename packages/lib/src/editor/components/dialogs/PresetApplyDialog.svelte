<script lang="ts">
	/**
	 * Create a new rule group from a preset: pick the new group's tileset and, per rule, the tiles
	 * (seeded from the preset). Each rule shows the preset's original tiles as a read-only preview.
	 */
	import { untrack } from 'svelte';
	import { editor } from '../../state/editorStore.svelte';
	import { ANYTHING } from '../../../format/autoRules';
	import { getTileset, type SvAutoRule, type SvAutoRulePreset } from '../../../format/types';
	import Dialog from './Dialog.svelte';
	import RuleTilePicker from './RuleTilePicker.svelte';

	let { preset, onclose }: { preset: SvAutoRulePreset; onclose: () => void } = $props();

	const project = $derived(editor.project);
	const projectDir = $derived(
		editor.projectPath.slice(0, editor.projectPath.lastIndexOf('/')) || ''
	);
	const tilesets = $derived(project?.tilesets ?? []);
	const groups = $derived(project?.autoRuleGroups ?? []);

	function valueColor(name: string): string {
		return groups.find((g) => g.name === name)?.color ?? '#c7786f';
	}

	/** Compact pattern-cell style: filled=require, outlined+cross=forbid, dim=wildcard. */
	function patCell(v: string) {
		if (v === '') return { bg: 'transparent', border: '#3b405e', cross: false };
		const forbid = v[0] === '!';
		const mag = forbid ? v.slice(1) : v;
		const col = mag === ANYTHING ? '#aaa' : valueColor(mag);
		if (forbid) return { bg: 'transparent', border: col, cross: true };
		return { bg: mag === ANYTHING ? '#ffffff33' : col, border: col, cross: false };
	}

	// Mutable working draft, seeded once from the preset (dialog is remounted per preset).
	let name = $state(untrack(() => preset.name));
	let tilesetDefUid = $state<number | null>(untrack(() => preset.tilesetDefUid));
	let ruleTiles = $state<number[][]>(untrack(() => preset.rules.map((r) => [...r.tileIds])));
	let selectedIdx = $state(0);

	const newTileset = $derived(getTileset(project!, tilesetDefUid));
	const presetTileset = $derived(getTileset(project!, preset.tilesetDefUid));

	function create() {
		editor.createGroupFromPreset(
			{
				name: name.trim() || preset.name,
				tilesetDefUid,
				rules: preset.rules.map((r, i) => ({ ...r, tileIds: [...ruleTiles[i]] }))
			},
			preset.name
		);
		onclose();
	}
</script>

{#snippet patternPreview(rule: SvAutoRule)}
	{@const c = (rule.size - 1) / 2}
	<span class="ppat" style="grid-template-columns: repeat({rule.size}, 9px)">
		{#each rule.pattern as cell, k (k)}
			{@const isCenter = Math.floor(k / rule.size) === c && k % rule.size === c}
			{@const view = patCell(cell)}
			<span
				class="pcell"
				class:center={isCenter}
				style="background:{view.bg}; border-color:{view.border}"
			>
				{#if view.cross}<span class="pcross" style="color:{view.border}">×</span>{/if}
			</span>
		{/each}
	</span>
{/snippet}

<Dialog title="New group from preset" {onclose} width={720}>
	<div class="head">
		<label>
			<span class="lbl">Name</span>
			<input class="text" bind:value={name} />
		</label>
		<label>
			<span class="lbl">Tileset</span>
			<select
				class="text"
				value={tilesetDefUid ?? ''}
				onchange={(e) =>
					(tilesetDefUid = e.currentTarget.value === '' ? null : +e.currentTarget.value)}
			>
				<option value="">(no tileset)</option>
				{#each tilesets as ts (ts.uid)}
					<option value={ts.uid}>{ts.identifier}</option>
				{/each}
			</select>
		</label>
	</div>

	<div class="layout">
		<div class="rlist">
			{#each preset.rules as r, i (r.uid)}
				<button class="ritem" class:active={selectedIdx === i} onclick={() => (selectedIdx = i)}>
					<span class="rhead">
						<span class="rname">Rule {i + 1}</span>
						<span class="rmeta">{r.size}×{r.size} · {ruleTiles[i].length}t</span>
					</span>
					{@render patternPreview(r)}
				</button>
			{/each}
		</div>

		<div class="detail">
			{#if preset.rules[selectedIdx]}
				<div class="picker">
					<span class="lbl">Preset tiles (preview)</span>
					<RuleTilePicker
						tileset={presetTileset}
						{projectDir}
						selected={preset.rules[selectedIdx].tileIds}
					/>
				</div>
				<div class="picker">
					<span class="lbl">New tiles — click/drag to pick</span>
					<RuleTilePicker
						tileset={newTileset}
						{projectDir}
						selected={ruleTiles[selectedIdx]}
						onchange={(ids) => (ruleTiles[selectedIdx] = ids)}
					/>
				</div>
			{/if}
		</div>
	</div>

	{#snippet footer()}
		<button class="btn" onclick={onclose}>Cancel</button>
		<button class="btn primary" onclick={create}>Create group</button>
	{/snippet}
</Dialog>

<style>
	.head {
		display: flex;
		gap: 16px;
		margin-bottom: 12px;
	}
	.head label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex: 1;
	}
	.lbl {
		color: var(--muted);
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.text {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 4px 6px;
		font: inherit;
		width: 100%;
	}
	.layout {
		display: grid;
		grid-template-columns: 150px 1fr;
		gap: 14px;
		min-height: 300px;
	}
	.rlist {
		display: flex;
		flex-direction: column;
		gap: 3px;
		max-height: 360px;
		overflow: auto;
		border-right: 1px solid var(--border);
		padding-right: 8px;
	}
	.ritem {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 5px 8px;
		cursor: pointer;
		font: inherit;
		text-align: left;
	}
	.ritem.active {
		background: var(--accent-dim);
		outline: 1px solid var(--accent);
	}
	.rhead {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 6px;
		width: 100%;
	}
	.rname {
		font-weight: 600;
	}
	.rmeta {
		color: var(--muted);
		font-size: 10px;
	}
	.ppat {
		display: grid;
		gap: 1px;
		width: max-content;
	}
	.pcell {
		width: 9px;
		height: 9px;
		border: 1px solid var(--border);
		border-radius: 1px;
		display: grid;
		place-items: center;
	}
	.pcell.center {
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
	}
	.pcross {
		font-size: 8px;
		line-height: 1;
		font-weight: 700;
	}
	.detail {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
		align-items: flex-start;
	}
	.picker {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.btn {
		background: var(--panel);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 5px;
		padding: 6px 12px;
		cursor: pointer;
		font: inherit;
	}
	.btn:hover {
		background: var(--accent-dim);
	}
	.btn.primary {
		background: var(--accent);
		color: #0d0b18;
		border-color: var(--accent);
	}
</style>
