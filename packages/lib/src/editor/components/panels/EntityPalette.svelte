<script lang="ts">
	import { editor } from '../../state/editorStore.svelte';
	import type { SvEntityTypeDef } from '../../../format/types';
	import Panel from './Panel.svelte';
	import IconSettings from '@tabler/icons-svelte/icons/settings';
	import { tooltip } from '../common/tooltip';

	let { onedittypes }: { onedittypes: () => void } = $props();

	const groups = $derived.by(() => {
		const out: Record<string, SvEntityTypeDef[]> = {};
		for (const t of editor.project?.entities ?? []) (out[t.category ?? 'Other'] ??= []).push(t);
		return out;
	});

	function choose(id: string) {
		editor.selectedEntityType = id;
		editor.setTool('entity');
	}
</script>

<Panel title="Entities">
	{#each Object.entries(groups) as [category, types] (category)}
		<h4>{category}</h4>
		<ul class="ents">
			{#each types as t (t.id)}
				<li class:active={editor.selectedEntityType === t.id}>
					<button onclick={() => choose(t.id)} title={t.doc}>
						<span class="dot" style="background:{t.color}"></span>
						<span class="name">{t.name}</span>
						{#if t.fields.length}
							<span class="fields">{t.fields.length} field{t.fields.length > 1 ? 's' : ''}</span>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/each}
	{#if !Object.keys(groups).length}
		<p class="hint">No entity types yet — define them in the Entities dialog.</p>
	{/if}
	<button class="edit" use:tooltip={'Edit entity types'} onclick={onedittypes}>
		<IconSettings size={13} /> Edit types…
	</button>
	<p class="hint">Click a type, then click in the level to place. Use Select (V) to move.</p>
</Panel>

<style>
	.edit {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-top: 8px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 5px;
		color: var(--text);
		padding: 5px 9px;
		cursor: pointer;
		font: inherit;
	}
	.edit:hover {
		background: var(--accent-dim);
	}
	h4 {
		margin: 6px 2px 3px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	.ents {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	li button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 7px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 5px;
		color: var(--text);
		cursor: pointer;
		padding: 6px 8px;
		text-align: left;
	}
	li button:hover {
		background: var(--accent-dim);
	}
	li.active button {
		outline: 1px solid var(--accent);
		border-color: var(--accent);
	}
	.dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex: none;
	}
	.name {
		flex: 1;
	}
	.fields {
		color: var(--muted);
		font-size: 10px;
	}
	.hint {
		color: var(--muted);
		font-size: 10px;
		margin: 8px 2px 0;
	}
</style>
