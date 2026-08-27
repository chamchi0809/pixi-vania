<script lang="ts">
	/**
	 * Per-line dialogue editor for one `Dialogue`-typed entity field (speaker + text per line).
	 * Edits serialise back into that field as JSON via `editor.commit` (one undo step each).
	 * Lines are structured plain text, not inline rich formatting.
	 */
	import { editor } from '../../state/editorStore.svelte';
	import {
		parseScript,
		serializeScript,
		type DialogueLine,
		type DialogueSpeaker
	} from '../../../format/dialogue';
	import type { SvEntityInstance } from '../../../format/types';

	let { entity, field }: { entity: SvEntityInstance; field: string } = $props();

	const lines = $derived(parseScript(entity.fields[field]));

	const SPEAKERS: { value: DialogueSpeaker; label: string }[] = [
		{ value: 'none', label: 'No speaker (at the entity)' },
		{ value: 'player', label: 'Player' },
		{ value: 'character', label: 'Named character' }
	];

	function commit(label: string, next: DialogueLine[]) {
		editor.commit(label, () => (entity.fields[field] = serializeScript(next)));
	}
	function patch(i: number, p: Partial<DialogueLine>) {
		commit(
			'Edit dialogue line',
			lines.map((l, k) => (k === i ? { ...l, ...p } : l))
		);
	}
	function add() {
		commit('Add dialogue line', [...lines, { speaker: 'none', text: '' }]);
	}
	function remove(i: number) {
		commit(
			'Delete dialogue line',
			lines.filter((_, k) => k !== i)
		);
	}
	function move(i: number, dir: -1 | 1) {
		const j = i + dir;
		if (j < 0 || j >= lines.length) return;
		const next = lines.slice();
		[next[i], next[j]] = [next[j], next[i]];
		commit('Reorder dialogue', next);
	}
</script>

<div class="dlg">
	{#each lines as line, i (i)}
		<div class="line">
			<div class="row">
				<span class="idx">{i + 1}</span>
				<select
					class="text spk"
					value={line.speaker}
					onchange={(e) => patch(i, { speaker: e.currentTarget.value as DialogueSpeaker })}
				>
					{#each SPEAKERS as s (s.value)}
						<option value={s.value}>{s.label}</option>
					{/each}
				</select>
				<button class="mini" title="Move up" disabled={i === 0} onclick={() => move(i, -1)}>↑</button>
				<button
					class="mini"
					title="Move down"
					disabled={i === lines.length - 1}
					onclick={() => move(i, 1)}>↓</button
				>
				<button class="mini del" title="Delete" onclick={() => remove(i)}>✕</button>
			</div>
			{#if line.speaker === 'character'}
				<input
					class="text"
					placeholder="Speaker name"
					value={line.character ?? ''}
					onchange={(e) => patch(i, { character: e.currentTarget.value })}
				/>
			{/if}
			<textarea
				class="text"
				rows="2"
				placeholder="Enter dialogue text"
				value={line.text}
				onchange={(e) => patch(i, { text: e.currentTarget.value })}
			></textarea>
		</div>
	{/each}

	{#if !lines.length}
		<p class="empty">No lines yet. Add one below.</p>
	{/if}

	<button class="add" onclick={add}>+ Add line</button>
</div>

<style>
	.dlg {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.line {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 6px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--bg);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.idx {
		color: var(--muted);
		font-size: 11px;
		width: 14px;
		text-align: center;
	}
	.spk {
		flex: 1;
	}
	.text {
		width: 100%;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 3px 5px;
		font: inherit;
		box-sizing: border-box;
	}
	textarea.text {
		resize: vertical;
	}
	.mini {
		background: var(--bg);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 4px;
		width: 22px;
		height: 22px;
		cursor: pointer;
		font: inherit;
		line-height: 1;
	}
	.mini:hover:not(:disabled) {
		background: var(--border);
	}
	.mini:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.mini.del {
		color: #ffb3bd;
		border-color: #7a3340;
	}
	.empty {
		color: var(--muted);
		font-size: 11px;
		margin: 0;
	}
	.add {
		background: var(--bg);
		border: 1px dashed var(--border);
		color: var(--text);
		border-radius: 5px;
		padding: 5px;
		cursor: pointer;
		font: inherit;
	}
	.add:hover {
		background: var(--border);
	}
</style>
