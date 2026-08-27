<script lang="ts">
	import { editor } from '../../state/editorStore.svelte';
	import { tooltip } from '../common/tooltip';
	import IconPlus from '@tabler/icons-svelte/icons/plus';
	import IconSettings from '@tabler/icons-svelte/icons/settings';
	import Panel from './Panel.svelte';

	let { onrules }: { onrules: () => void } = $props();

	const groups = $derived(editor.project?.autoRuleGroups ?? []);

	function selectGroup(name: string) {
		editor.selectedId = name;
		if (editor.tool === 'select' || editor.tool === 'entity') editor.setTool('brush');
	}
</script>

<Panel title="Rule groups">
	{#snippet actions()}
		<button class="icon-btn" use:tooltip={'Edit rules'} onclick={onrules}>
			<IconSettings size={13} />
		</button>
		<button class="icon-btn" use:tooltip={'Add group'} onclick={() => editor.addRuleGroup()}>
			<IconPlus size={13} />
		</button>
	{/snippet}

	<ul class="values">
		{#each groups as g (g.uid)}
			<li class:active={editor.selectedId === g.name}>
				<button class="pick" onclick={() => selectGroup(g.name)} aria-label={g.name}>
					<span class="swatch" style="background:{g.color}"></span>
				</button>
				<span class="ident" class:off={!g.active}>{g.name}</span>
			</li>
		{/each}
	</ul>
	<p class="hint">Pick a group, then paint. Edit its rules &amp; tileset via the sliders icon.</p>
</Panel>

<style>
	.values {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 2px;
		border-radius: 5px;
	}
	li.active {
		background: var(--accent-dim);
		outline: 1px solid var(--accent);
	}
	.pick {
		background: none;
		border: none;
		cursor: pointer;
		padding: 0;
	}
	.swatch {
		width: 26px;
		height: 26px;
		border-radius: 4px;
		display: block;
	}
	.ident {
		flex: 1;
		min-width: 0;
		color: var(--text);
		padding: 3px 5px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ident.off {
		color: var(--muted);
		text-decoration: line-through;
	}
	.hint {
		color: var(--muted);
		font-size: 10px;
		margin: 8px 2px 0;
	}
	.icon-btn {
		background: var(--panel);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 4px;
		cursor: pointer;
		width: 18px;
		height: 18px;
		display: grid;
		place-items: center;
		padding: 0;
	}
	.icon-btn:hover {
		background: var(--accent-dim);
	}
</style>
