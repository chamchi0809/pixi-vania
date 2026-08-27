<script lang="ts">
	/**
	 * The undo timeline as a clickable list. Entry 0 is load; highlighted row is live;
	 * rows below are the dimmed redo branch. Clicking a row jumps to it via `editor.jumpTo`.
	 */
	import { editor } from '../../state/editorStore.svelte';
	import Panel from './Panel.svelte';
	import { tooltip } from '../common/tooltip';
	import IconArrowBackUp from '@tabler/icons-svelte/icons/arrow-back-up';
	import IconArrowForwardUp from '@tabler/icons-svelte/icons/arrow-forward-up';

	const entries = $derived(editor.historyEntries);

	let listEl = $state<HTMLOListElement>();

	// Keep the current step in view as the timeline grows / jumps around.
	$effect(() => {
		void editor.historyIndex;
		const el = listEl?.querySelector('.current');
		el?.scrollIntoView({ block: 'nearest' });
	});
</script>

<Panel title="History" grow>
	{#snippet actions()}
		<button class="icon-btn" disabled={!editor.canUndo} use:tooltip={'Undo (Ctrl/Cmd+Z)'} onclick={() => editor.undo()}>
			<IconArrowBackUp size={13} />
		</button>
		<button class="icon-btn" disabled={!editor.canRedo} use:tooltip={'Redo (Ctrl/Cmd+Shift+Z)'} onclick={() => editor.redo()}>
			<IconArrowForwardUp size={13} />
		</button>
	{/snippet}

	<ol class="hist" bind:this={listEl}>
		{#each entries as entry, i (entry.id)}
			<li>
				<button
					class="step"
					class:current={i === editor.historyIndex}
					class:future={i > editor.historyIndex}
					onclick={() => editor.jumpTo(i)}
				>
					<span class="idx">{i}</span>
					<span class="label">{entry.label}</span>
				</button>
			</li>
		{/each}
	</ol>
</Panel>

<style>
	.hist {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.step {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 7px;
		background: none;
		border: 1px solid transparent;
		color: var(--text);
		border-radius: 4px;
		padding: 3px 6px;
		cursor: pointer;
		text-align: left;
		font: inherit;
	}
	.step:hover {
		background: var(--accent-dim);
	}
	.step.current {
		background: var(--accent);
		color: #0d0b18;
		border-color: var(--accent);
	}
	.step.future {
		opacity: 0.45;
	}
	.idx {
		color: var(--muted);
		font-size: 10px;
		min-width: 16px;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.step.current .idx {
		color: #0d0b18;
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
	.icon-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}
</style>
