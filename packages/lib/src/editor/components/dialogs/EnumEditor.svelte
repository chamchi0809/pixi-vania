<script lang="ts">
	/**
	 * Project enum editor — create/rename/delete enums and their values.
	 * Enums drive tileset tags (collider selection) and entity/level Enum fields.
	 * Every edit is a single undo step via `editor.commit`.
	 */
	import { editor } from '../../state/editorStore.svelte';
	import { makeEnum } from '../../state/factory';
	import { tooltip } from '../common/tooltip';
	import IconTrash from '@tabler/icons-svelte/icons/trash';
	import Dialog from './Dialog.svelte';
	import ColorInput from '../common/ColorInput.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const project = $derived(editor.project);
	let selectedUid = $state<number>(-1);

	const enums = $derived(project?.enums ?? []);
	const selected = $derived(enums.find((e) => e.uid === selectedUid) ?? enums[0]);

	function commit(label: string, fn: () => void) {
		editor.commit(label, fn);
	}

	function uniqueEnumId(base: string): string {
		if (!project) return base;
		let name = base;
		let n = 1;
		while (project.enums.some((e) => e.identifier === name)) name = `${base}_${n++}`;
		return name;
	}

	function addEnum() {
		if (!project) return;
		const e = makeEnum(project, uniqueEnumId('Enum'));
		commit('Add enum', () => project.enums.push(e));
		selectedUid = e.uid;
	}

	function deleteEnum(uid: number) {
		if (!project) return;
		commit('Delete enum', () => (project.enums = project.enums.filter((e) => e.uid !== uid)));
		if (selectedUid === uid) selectedUid = project.enums[0]?.uid ?? -1;
	}

	function renameEnum(id: string) {
		if (!selected || !project) return;
		const trimmed = id.trim();
		const oldId = selected.identifier;
		if (!trimmed || trimmed === oldId) return;
		// Keep identifiers unique, then cascade the rename to every string reference so
		// tileset tags and Enum fields don't silently orphan.
		const newId = uniqueEnumId(trimmed);
		commit('Rename enum', () => {
			selected.identifier = newId;
			for (const ts of project.tilesets) {
				if (ts.tagsEnumId === oldId) ts.tagsEnumId = newId;
			}
			for (const f of project.levelFields) {
				if (f.enumId === oldId) f.enumId = newId;
			}
		});
	}

	function uniqueValueId(base: string): string {
		if (!selected) return base;
		let name = base || 'Value';
		let n = 1;
		while (selected.values.some((v) => v.id === name)) name = `${base || 'Value'}_${n++}`;
		return name;
	}

	function addValue() {
		if (!selected) return;
		const id = uniqueValueId('VALUE');
		commit('Add enum value', () => selected.values.push({ id, color: '#cccccc', tile: null }));
	}

	function deleteValue(idx: number) {
		if (!selected) return;
		commit('Delete enum value', () => selected.values.splice(idx, 1));
	}

	function renameValue(idx: number, raw: string) {
		if (!selected || !project) return;
		const v = selected.values[idx];
		if (!v) return;
		const oldId = v.id;
		const trimmed = raw.trim();
		if (!trimmed || trimmed === oldId) return;
		// Keep value ids unique within the enum, then cascade to tileset tags that
		// reference this enum so already-tagged tiles aren't orphaned.
		const newId = selected.values.some((vv, j) => j !== idx && vv.id === trimmed)
			? uniqueValueId(trimmed)
			: trimmed;
		commit('Rename enum value', () => {
			v.id = newId;
			for (const ts of project.tilesets) {
				if (ts.tagsEnumId !== selected.identifier) continue;
				for (const tag of ts.enumTags) {
					if (tag.enumValueId === oldId) tag.enumValueId = newId;
				}
			}
		});
	}
</script>

<Dialog title="Enums" {onclose} width={680}>
	<div class="cols">
		<div class="list">
			<div class="list-head">
				<span>Enums</span>
				<button class="add" onclick={addEnum}>+ Enum</button>
			</div>
			{#if enums.length === 0}
				<p class="dim">No enums yet.</p>
			{/if}
			{#each enums as e (e.uid)}
				<div class="enum-row" class:active={selected?.uid === e.uid}>
					<button class="pick" onclick={() => (selectedUid = e.uid)}>
						<span class="nm">{e.identifier}</span>
						<span class="ct">{e.values.length}</span>
					</button>
					<button class="x" use:tooltip={'Delete enum'} onclick={() => deleteEnum(e.uid)}>
						<IconTrash size={14} />
					</button>
				</div>
			{/each}
		</div>

		<div class="detail">
			{#if selected}
				<div class="field">
					<span class="lbl">Identifier</span>
					<input
						class="text"
						value={selected.identifier}
						onchange={(ev) => renameEnum(ev.currentTarget.value)}
					/>
				</div>

				<div class="values-head">
					<span>Values</span>
					<button class="add" onclick={addValue}>+ Value</button>
				</div>
				{#if selected.values.length === 0}
					<p class="dim">No values yet.</p>
				{/if}
				{#each selected.values as v, i (i)}
					<div class="val-row">
						<span class="cw">
							<ColorInput
								value={v.color ?? '#cccccc'}
								label="Value colour"
								onchange={(c) => commit('Set value color', () => (v.color = c))}
							/>
						</span>
						<input
							class="text"
							value={v.id}
							onchange={(ev) => renameValue(i, ev.currentTarget.value)}
						/>
						<button class="x" use:tooltip={'Delete value'} onclick={() => deleteValue(i)}>
							<IconTrash size={14} />
						</button>
					</div>
				{/each}
			{:else}
				<p class="dim">Select or add an enum.</p>
			{/if}
		</div>
	</div>
</Dialog>

<style>
	.cols {
		display: grid;
		grid-template-columns: 220px 1fr;
		gap: 14px;
		min-height: 320px;
	}
	.list,
	.detail {
		min-width: 0;
	}
	.list-head,
	.values-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 6px;
		font-weight: 700;
		color: var(--muted);
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 0.06em;
	}
	.values-head {
		margin-top: 14px;
	}
	.enum-row,
	.val-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 4px;
	}
	.pick {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: var(--panel-2);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 5px;
		padding: 5px 8px;
		cursor: pointer;
		min-width: 0;
	}
	.enum-row.active .pick {
		border-color: var(--accent);
		background: var(--accent-dim);
	}
	.nm {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ct {
		color: var(--muted);
		font-size: 10px;
	}
	.field {
		display: grid;
		grid-template-columns: 80px 1fr;
		align-items: center;
		gap: 6px;
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
		padding: 4px 6px;
		font: inherit;
	}
	.cw {
		flex: none;
		--sw-w: 28px;
	}
	.add {
		background: var(--accent-dim);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 4px;
		padding: 3px 8px;
		cursor: pointer;
		font: inherit;
	}
	.add:hover {
		background: var(--accent);
		color: #0d0b18;
	}
	.x {
		background: none;
		border: 1px solid transparent;
		color: var(--muted);
		cursor: pointer;
		border-radius: 4px;
		width: 24px;
		height: 24px;
		flex: none;
		display: grid;
		place-items: center;
		padding: 0;
	}
	.x:hover {
		background: #5a2530;
		color: #ffd7dd;
	}
	.dim {
		color: var(--muted);
	}
</style>
