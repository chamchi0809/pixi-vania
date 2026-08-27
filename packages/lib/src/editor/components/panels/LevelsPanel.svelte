<script lang="ts">
	import { editor } from '../../state/editorStore.svelte';
	import Panel from './Panel.svelte';
	import { tooltip } from '../common/tooltip';
	import IconPlus from '@tabler/icons-svelte/icons/plus';
	import IconX from '@tabler/icons-svelte/icons/x';

	const levels = $derived(editor.project?.levels ?? []);
</script>

<Panel title="Levels" grow>
	{#snippet actions()}
		<button class="icon-btn" use:tooltip={'Add level'} onclick={() => editor.addLevel()}>
			<IconPlus size={13} />
		</button>
	{/snippet}

	<ul class="levels">
		{#each levels as level (level.uid)}
			<li class:active={editor.currentLevelUid === level.uid}>
				<button class="row" onclick={() => editor.setCurrentLevel(level.uid)}>
					<span class="name">{level.identifier}</span>
					<span class="dim">{level.pxWid}×{level.pxHei}</span>
				</button>
				<button
					class="icon-btn danger"
					use:tooltip={'Delete level'}
					disabled={levels.length <= 1}
					onclick={() => editor.deleteLevel(level.uid)}
				>
					<IconX size={13} />
				</button>
			</li>
		{/each}
	</ul>
</Panel>

<style>
	.levels {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: 5px;
	}
	li.active {
		background: var(--accent-dim);
		outline: 1px solid var(--accent);
	}
	.row {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		background: none;
		border: none;
		color: var(--text);
		cursor: pointer;
		text-align: left;
		padding: 5px 6px;
		min-width: 0;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dim {
		color: var(--muted);
		font-size: 10px;
		flex: none;
	}
	.icon-btn {
		background: var(--panel);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 4px;
		cursor: pointer;
		width: 18px;
		height: 18px;
		font-size: 9px;
		display: grid;
		place-items: center;
		opacity: 1;
		padding: 0;
	}
	li:hover .icon-btn {
		opacity: 1;
	}
	.icon-btn:disabled {
		opacity: 0 !important;
	}
	.icon-btn.danger:hover {
		background: #5a2530;
	}
</style>
