<script lang="ts">
	import { editor } from '../../state/editorStore.svelte';
	import type { SvFieldDef, SvFieldType, SvFieldValue } from '../../../format/types';
	import Dialog from './Dialog.svelte';
	import FieldInput from '../panels/FieldInput.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const FIELD_TYPES: SvFieldType[] = [
		'Int', 'Float', 'String', 'MultiLines', 'Bool', 'Color', 'Point', 'Enum', 'FilePath'
	];
	const project = $derived(editor.project);

	const defaultFor = (type: SvFieldType): SvFieldValue => {
		if (type === 'Int' || type === 'Float') return 0;
		if (type === 'Bool') return false;
		if (type === 'Color') return '#ffffff';
		if (type === 'Point') return [0, 0];
		if (type === 'Dialogue') return '[]';
		return '';
	};

	function edit(label: string, fn: () => void) {
		editor.commit(label, fn);
	}

	function uniqueIdentifier(base = 'Field'): string {
		let id = base;
		let n = 2;
		while (project?.levelFields.some((field) => field.identifier === id)) id = `${base}${n++}`;
		return id;
	}

	function addField() {
		if (!project) return;
		const identifier = uniqueIdentifier();
		edit('Add level field', () => {
			const field: SvFieldDef = {
				uid: project.nextUid++, identifier, type: 'String', isArray: false,
				canBeNull: false, defaultValue: ''
			};
			project.levelFields.push(field);
			for (const level of project.levels) level.fields[identifier] = '';
		});
	}

	function renameField(field: SvFieldDef, raw: string) {
		if (!project) return;
		const next = raw.trim();
		if (!next || next === field.identifier || project.levelFields.some((item) => item !== field && item.identifier === next)) return;
		const previous = field.identifier;
		edit('Rename level field', () => {
			field.identifier = next;
			for (const level of project.levels) {
				if (Object.hasOwn(level.fields, previous)) level.fields[next] = level.fields[previous];
				delete level.fields[previous];
			}
		});
	}

	function removeField(field: SvFieldDef) {
		if (!project || !confirm(`Delete level field "${field.identifier}" and all of its values?`)) return;
		edit('Delete level field', () => {
			project.levelFields = project.levelFields.filter((item) => item !== field);
			for (const level of project.levels) delete level.fields[field.identifier];
		});
	}

	function convert(value: unknown, type: SvFieldType, fallback: SvFieldValue): SvFieldValue {
		if (type === 'Int') return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
		if (type === 'Float') return Number.isFinite(Number(value)) ? Number(value) : fallback;
		if (type === 'Bool') return typeof value === 'string' ? value === 'true' : Boolean(value);
		if (type === 'Point') return Array.isArray(value) && value.length === 2 ? value : fallback;
		return value == null ? fallback : String(value);
	}

	function setType(field: SvFieldDef, type: SvFieldType) {
		if (!project || type === field.type) return;
		const fallback = defaultFor(type);
		edit('Set level field type', () => {
			field.type = type;
			field.defaultValue = fallback;
			if (type !== 'Enum') delete field.enumId;
			for (const level of project.levels)
				level.fields[field.identifier] = convert(level.fields[field.identifier], type, fallback);
		});
	}

	function setEnum(field: SvFieldDef, enumId: string) {
		if (!project) return;
		const values = project.enums.find((item) => item.identifier === enumId)?.values ?? [];
		const fallback = values[0]?.id ?? null;
		edit('Set level field enum', () => {
			field.enumId = enumId || null;
			field.defaultValue = values.some((value) => value.id === field.defaultValue) ? field.defaultValue : fallback;
			for (const level of project.levels) {
				const value = level.fields[field.identifier];
				if (!values.some((item) => item.id === value)) level.fields[field.identifier] = fallback;
			}
		});
	}
</script>

<Dialog title="Level fields" {onclose} width={820}>
	<p class="hint">Definitions apply to every level. Schema changes migrate all stored values in one undo step.</p>
	<div class="fields">
		{#each project?.levelFields ?? [] as field (field.uid)}
			<div class="field">
				<label>
					<span>ID</span>
					<input value={field.identifier} onchange={(event) => renameField(field, event.currentTarget.value)} />
				</label>
				<label>
					<span>Type</span>
					<select value={field.type} onchange={(event) => setType(field, event.currentTarget.value as SvFieldType)}>
						{#each FIELD_TYPES as type (type)}<option value={type}>{type}</option>{/each}
					</select>
				</label>
				{#if field.type === 'Enum'}
					<label>
						<span>Enum</span>
						<select value={field.enumId ?? ''} onchange={(event) => setEnum(field, event.currentTarget.value)}>
							<option value="">—</option>
							{#each project?.enums ?? [] as item (item.uid)}<option value={item.identifier}>{item.identifier}</option>{/each}
						</select>
					</label>
				{/if}
				<label class="default">
					<span>Default</span>
					<FieldInput
						type={field.type}
						enumId={field.enumId}
						min={field.min}
						max={field.max}
						value={field.defaultValue}
						label={`${field.identifier} default`}
						onchange={(value) => edit('Set level field default', () => (field.defaultValue = value))}
					/>
				</label>
				<button class="delete" aria-label={`Delete ${field.identifier}`} onclick={() => removeField(field)}>Delete</button>
			</div>
		{/each}
	</div>
	<button class="add" onclick={addField}>+ Add field</button>
</Dialog>

<style>
	.hint { margin: 0 0 12px; color: var(--muted); font-size: 11px; }
	.fields { display: flex; flex-direction: column; gap: 8px; }
	.field {
		display: grid; grid-template-columns: minmax(130px, 1fr) 110px minmax(130px, 1fr) auto;
		gap: 8px; align-items: end; padding: 8px; border: 1px solid var(--border);
		border-radius: 6px; background: var(--panel-2);
	}
	label { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
	label span { color: var(--muted); font-size: 10px; }
	input, select {
		width: 100%; min-width: 0; padding: 4px 6px; color: var(--text);
		background: var(--bg); border: 1px solid var(--border); border-radius: 4px; font: inherit;
	}
	button { padding: 5px 9px; color: var(--text); background: var(--panel); border: 1px solid var(--border); border-radius: 5px; cursor: pointer; }
	button:hover { background: var(--accent-dim); }
	.delete:hover { color: #ff8787; }
	.add { margin-top: 10px; }
	@media (max-width: 700px) {
		.field { grid-template-columns: 1fr 1fr; }
		.default { grid-column: 1 / -1; }
	}
</style>
