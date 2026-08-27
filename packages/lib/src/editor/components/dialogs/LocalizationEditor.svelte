<script lang="ts">
	/**
	 * Localization table editor — maps each localized entity-field string (the source text IS the key)
	 * to per-locale translations. "Scan project" pulls in-use strings in; `localize` resolves against
	 * these rows. Edits go through `editor.editLocalization` (one undo step each).
	 */
	import { editor } from '../../state/editorStore.svelte';
	import { collectLocalizableStrings } from '../../../format/localization';
	import { tooltip } from '../common/tooltip';
	import IconTrash from '@tabler/icons-svelte/icons/trash';
	import IconRefresh from '@tabler/icons-svelte/icons/refresh';
	import IconX from '@tabler/icons-svelte/icons/x';
	import Dialog from './Dialog.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const project = $derived(editor.project);
	const entries = $derived(project?.localization?.entries ?? []);
	// Translation columns are authored per project; the base locale IS the source string.
	const columns = $derived(project?.localization?.locales ?? []);
	const baseLabel = 'Source';

	function addLocale() {
		const code = prompt('Locale code (e.g. ko, ja, fr)')?.trim();
		if (!code) return;
		editor.editLocalization('Add locale', (loc) => {
			loc.locales ??= [];
			if (!loc.locales.includes(code)) loc.locales.push(code);
		});
	}

	function removeLocale(code: string) {
		if (!confirm(`Remove the "${code}" column and its translations?`)) return;
		editor.editLocalization('Remove locale', (loc) => {
			loc.locales = (loc.locales ?? []).filter((l) => l !== code);
			for (const e of loc.entries) delete e.values[code];
		});
	}
	// Source strings the project's Sign/Dialogue entities currently use — flags orphaned rows.
	const inUse = $derived(new Set(project ? collectLocalizableStrings(project) : []));

	let scanInfo = $state('');

	function scan() {
		const n = editor.scanLocalization();
		scanInfo = n > 0 ? `Added ${n} new ${n === 1 ? 'string' : 'strings'}.` : 'No new strings found.';
	}

	function addRow() {
		editor.editLocalization('Add localization row', (loc) =>
			loc.entries.push({ key: '', values: {} })
		);
	}

	function deleteRow(idx: number) {
		editor.editLocalization('Delete localization row', (loc) => loc.entries.splice(idx, 1));
	}

	function setKey(idx: number, value: string) {
		editor.editLocalization('Edit source string', (loc) => {
			const e = loc.entries[idx];
			if (e) e.key = value;
		});
	}

	function setValue(idx: number, locale: string, value: string) {
		editor.editLocalization('Edit translation', (loc) => {
			const e = loc.entries[idx];
			if (!e) return;
			if (value) e.values[locale] = value;
			else delete e.values[locale];
		});
	}
</script>

<Dialog title="Localization" {onclose} width={780}>
	<div class="loc">
		<div class="bar">
			<button class="add" onclick={scan}><IconRefresh size={13} /> Scan project</button>
			<button class="add" onclick={addRow}>+ Row</button>
			<button class="add" onclick={addLocale}>+ Locale</button>
			{#if scanInfo}<span class="info">{scanInfo}</span>{/if}
			<span class="spacer"></span>
			<span class="count">{entries.length} {entries.length === 1 ? 'string' : 'strings'}</span>
		</div>

		<div class="grid" style:--cols={columns.length}>
			<div class="head">Source · {baseLabel}</div>
			{#each columns as c (c)}
				<div class="head">
					{c}
					<button class="dropcol" use:tooltip={'Remove this locale'} onclick={() => removeLocale(c)}>
						<IconX size={11} />
					</button>
				</div>
			{/each}
			<div class="head"></div>

			{#if entries.length === 0}
				<p class="empty">
					No strings yet. Click <strong>Scan project</strong> to pull in every entity field marked
					<em>i18n</em> in the Entities dialog, or add a row manually.
				</p>
			{/if}

			{#each entries as entry, i (i)}
				<div class="cell src" class:unused={!!entry.key && !inUse.has(entry.key)}>
					<textarea
						rows="2"
						value={entry.key}
						placeholder="source text"
						onchange={(ev) => setKey(i, ev.currentTarget.value)}
					></textarea>
					{#if entry.key && !inUse.has(entry.key)}
						<span class="badge" use:tooltip={'No placed entity uses this string'}>unused</span>
					{/if}
				</div>
				{#each columns as c (c)}
					<textarea
						class="cell"
						rows="2"
						value={entry.values[c] ?? ''}
						placeholder="—"
						onchange={(ev) => setValue(i, c, ev.currentTarget.value)}
					></textarea>
				{/each}
				<button class="x" use:tooltip={'Delete row'} onclick={() => deleteRow(i)}>
					<IconTrash size={14} />
				</button>
			{/each}
		</div>
	</div>
</Dialog>

<style>
	.dropcol {
		background: none;
		border: none;
		color: var(--muted);
		cursor: pointer;
		padding: 0 2px;
		vertical-align: middle;
	}
	.dropcol:hover {
		color: #ff8787;
	}
	.loc {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-height: 320px;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.spacer {
		flex: 1;
	}
	.info {
		color: var(--muted);
		font-size: 11px;
	}
	.count {
		color: var(--muted);
		font-size: 11px;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr repeat(var(--cols), 1fr) 28px;
		gap: 5px;
		align-items: start;
	}
	.head {
		font-weight: 700;
		color: var(--muted);
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 0.06em;
		padding: 2px 2px 4px;
		position: sticky;
		top: 0;
	}
	.empty {
		grid-column: 1 / -1;
		color: var(--muted);
		margin: 8px 0;
	}
	textarea {
		width: 100%;
		resize: vertical;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 4px 6px;
		font: inherit;
		line-height: 1.35;
	}
	textarea:focus {
		outline: none;
		border-color: var(--accent);
	}
	.cell.src {
		position: relative;
		display: flex;
	}
	.cell.src textarea {
		color: var(--muted);
	}
	.cell.src.unused textarea {
		border-color: #6a5320;
	}
	.badge {
		position: absolute;
		top: 3px;
		right: 5px;
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #e9c46a;
		background: #2a2410;
		border: 1px solid #6a5320;
		border-radius: 3px;
		padding: 0 4px;
		pointer-events: none;
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
		margin-top: 3px;
	}
	.x:hover {
		background: #5a2530;
		color: #ffd7dd;
	}
	.add {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: var(--accent-dim);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 4px;
		padding: 4px 9px;
		cursor: pointer;
		font: inherit;
	}
	.add:hover {
		background: var(--accent);
		color: #0d0b18;
	}
</style>
