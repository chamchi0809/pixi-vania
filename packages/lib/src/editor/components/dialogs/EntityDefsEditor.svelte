<script lang="ts">
	/**
	 * Entity type editor. Types live on the project (`project.entities`), so a `.svlevel` file
	 * carries its own palette: id, footprint, gizmo look, and the fields shown in Properties.
	 */
	import { editor } from '../../state/editorStore.svelte';
	import { makeEntityType } from '../../../format/entities';
	import type {
		EntityRenderMode,
		SvEntityFieldDef,
		SvEntityInstance,
		SvEntityTypeDef,
		SvFieldType
	} from '../../../format/types';
	import Dialog from './Dialog.svelte';
	import NumberInput from '../common/NumberInput.svelte';
	import { tooltip } from '../common/tooltip';
	import IconPlus from '@tabler/icons-svelte/icons/plus';
	import IconTrash from '@tabler/icons-svelte/icons/trash';
	import ColorInput from '../common/ColorInput.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const RENDER_MODES: EntityRenderMode[] = ['rect', 'ellipse', 'cross', 'tile'];
	const FIELD_TYPES: SvFieldType[] = [
		'Int',
		'Float',
		'String',
		'MultiLines',
		'Bool',
		'Color',
		'Point',
		'Enum',
		'FilePath',
		'Dialogue'
	];
	/** Field types whose value can feed the localization table. */
	const LOCALIZABLE = new Set<SvFieldType>(['String', 'MultiLines', 'Dialogue']);

	const project = $derived(editor.project);
	const types = $derived(project?.entities ?? []);
	let selectedId = $state<string>('');
	const selected = $derived(types.find((t) => t.id === selectedId) ?? types[0]);

	function edit(label: string, fn: (types: SvEntityTypeDef[]) => void) {
		if (!project) return;
		editor.commit(label, () => {
			project.entities ??= [];
			fn(project.entities);
		});
	}

	function uniqueId(base: string): string {
		let id = base;
		let n = 2;
		while (types.some((t) => t.id === id)) id = `${base}${n++}`;
		return id;
	}

	function addType() {
		const id = uniqueId('Entity');
		edit('Add entity type', (list) => list.push(makeEntityType(id)));
		selectedId = id;
	}

	function removeType(id: string) {
		const used = countUses(id);
		if (used && !confirm(`${used} placed instance(s) use "${id}". Delete the type anyway?`)) return;
		edit('Delete entity type', (list) => {
			const i = list.findIndex((t) => t.id === id);
			if (i >= 0) list.splice(i, 1);
			for (const level of project!.levels) for (const layer of level.layers) {
				if (layer.type === 'Entities') layer.entities = layer.entities.filter((entity) => entity.type !== id);
			}
		});
	}

	/** Placed instances of a type across the whole project — a delete/rename warning. */
	function countUses(id: string): number {
		let n = 0;
		for (const level of project?.levels ?? [])
			for (const li of level.layers)
				if (li.type === 'Entities') n += li.entities.filter((e) => e.type === id).length;
		return n;
	}

	/** Renaming a type re-points every placed instance, so the level doesn't lose them. */
	function renameType(def: SvEntityTypeDef, raw: string) {
		const next = raw.trim();
		if (!next || next === def.id || types.some((t) => t.id === next)) return;
		const prev = def.id;
		edit('Rename entity type', () => {
			def.id = next;
			for (const level of project!.levels)
				for (const li of level.layers)
					if (li.type === 'Entities')
						for (const e of li.entities) if (e.type === prev) e.type = next;
		});
		if (editor.selectedEntityType === prev) editor.selectedEntityType = next;
		selectedId = next;
	}

	function addField(def: SvEntityTypeDef) {
		let id = 'Field';
		let n = 2;
		while (def.fields.some((f) => f.id === id)) id = `Field${n++}`;
		edit('Add entity field', () => {
			def.fields.push({ id, type: 'String', default: '' });
			visitInstances(def.id, (entity) => (entity.fields[id] = ''));
		});
	}

	function visitInstances(typeId: string, fn: (entity: SvEntityInstance) => void) {
		for (const level of project?.levels ?? []) for (const layer of level.layers) {
			if (layer.type === 'Entities') for (const entity of layer.entities) if (entity.type === typeId) fn(entity);
		}
	}

	function renameField(def: SvEntityTypeDef, field: SvEntityFieldDef, raw: string) {
		const next = raw.trim();
		if (!next || next === field.id || def.fields.some((candidate) => candidate !== field && candidate.id === next)) return;
		const previous = field.id;
		edit('Rename field', () => {
			field.id = next;
			visitInstances(def.id, (entity) => {
				if (Object.hasOwn(entity.fields, previous)) entity.fields[next] = entity.fields[previous];
				delete entity.fields[previous];
			});
		});
	}

	function deleteField(def: SvEntityTypeDef, field: SvEntityFieldDef) {
		edit('Delete field', () => {
			def.fields = def.fields.filter((candidate) => candidate !== field);
			visitInstances(def.id, (entity) => delete entity.fields[field.id]);
		});
	}

	/** Field default has to follow its type, or Properties renders garbage. */
	function setFieldType(def: SvEntityTypeDef, field: SvEntityFieldDef, type: SvFieldType) {
		if (field.type === type) return;
		edit('Set field type', () => {
			field.type = type;
			field.default = defaultFor(type);
			visitInstances(def.id, (entity) => {
				entity.fields[field.id] = convertValue(entity.fields[field.id], type, field.default);
			});
			if (!LOCALIZABLE.has(type)) delete field.localized;
			if (type !== 'Enum') delete field.enumId;
		});
	}

	function setFieldEnum(def: SvEntityTypeDef, field: SvEntityFieldDef, enumId: string) {
		const selectedEnum = project?.enums.find((item) => item.identifier === enumId);
		const fallback = selectedEnum?.values[0]?.id ?? '';
		edit('Set enum', () => {
			if (enumId) field.enumId = enumId;
			else delete field.enumId;
			if (!selectedEnum?.values.some((value) => value.id === field.default)) field.default = fallback;
			visitInstances(def.id, (entity) => {
				if (!selectedEnum?.values.some((value) => value.id === entity.fields[field.id])) entity.fields[field.id] = fallback;
			});
		});
	}

	function convertValue(value: unknown, type: SvFieldType, fallback: unknown): unknown {
		if (type === 'Int') return Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : fallback;
		if (type === 'Float') return Number.isFinite(Number(value)) ? Number(value) : fallback;
		if (type === 'Bool') return typeof value === 'string' ? value === 'true' : Boolean(value);
		if (type === 'Point') return value && typeof value === 'object' ? value : null;
		if (type === 'Dialogue') return typeof value === 'string' && value.startsWith('[') ? value : '[]';
		return value == null ? fallback : String(value);
	}

	function defaultFor(type: SvFieldType): unknown {
		if (type === 'Int' || type === 'Float') return 0;
		if (type === 'Bool') return false;
		if (type === 'Color') return '#ffffff';
		if (type === 'Point') return null;
		if (type === 'Dialogue') return '[]';
		return '';
	}
</script>

<Dialog title="Entity types" {onclose} width={860}>
	<div class="wrap">
		<ul class="list">
			{#each types as t (t.id)}
				<li>
					<button class:active={selected?.id === t.id} onclick={() => (selectedId = t.id)}>
						<span class="dot" style="background:{t.color}"></span>
						<span class="name">{t.name}</span>
					</button>
					<button class="icon" use:tooltip={'Delete type'} onclick={() => removeType(t.id)}>
						<IconTrash size={13} />
					</button>
				</li>
			{/each}
			<li>
				<button class="add" onclick={addType}><IconPlus size={13} /> Add type</button>
			</li>
		</ul>

		{#if selected}
			{@const def = selected}
			<div class="detail">
				<div class="row">
					<label>
						id
						<input
							value={def.id}
							onchange={(e) => renameType(def, e.currentTarget.value)}
							use:tooltip={'Referenced by placed instances and by the runtime spawner'}
						/>
					</label>
					<label>
						name
						<input
							value={def.name}
							onchange={(e) => edit('Rename', () => (def.name = e.currentTarget.value))}
						/>
					</label>
					<label>
						category
						<input
							value={def.category ?? ''}
							onchange={(e) =>
								edit('Set category', () => (def.category = e.currentTarget.value || undefined))}
						/>
					</label>
				</div>

				<div class="row">
					<label>
						width
						<NumberInput
							value={def.width}
							int
							min={1}
							onchange={(v) => edit('Set width', () => (def.width = v))}
						/>
					</label>
					<label>
						height
						<NumberInput
							value={def.height}
							int
							min={1}
							onchange={(v) => edit('Set height', () => (def.height = v))}
						/>
					</label>
					<label>
						color
						<ColorInput
							value={def.color}
							label="Entity colour"
							onchange={(c) => edit('Set color', () => (def.color = c))}
						/>
					</label>
					<label>
						gizmo
						<select
							value={def.renderMode}
							onchange={(e) =>
								edit('Set gizmo', () => (def.renderMode = e.currentTarget.value as EntityRenderMode))}
						>
							{#each RENDER_MODES as m (m)}<option value={m}>{m}</option>{/each}
						</select>
					</label>
				</div>

				<div class="row checks">
					<label class="check">
						<input
							type="checkbox"
							checked={!!def.resizableX}
							onchange={(e) =>
								edit('Set resizable', () => (def.resizableX = e.currentTarget.checked || undefined))}
						/> resizable X
					</label>
					<label class="check">
						<input
							type="checkbox"
							checked={!!def.resizableY}
							onchange={(e) =>
								edit('Set resizable', () => (def.resizableY = e.currentTarget.checked || undefined))}
						/> resizable Y
					</label>
					<label class="grow">
						doc
						<input
							value={def.doc ?? ''}
							onchange={(e) => edit('Set doc', () => (def.doc = e.currentTarget.value || undefined))}
						/>
					</label>
				</div>

				<h4>Fields</h4>
				<table>
					<thead>
						<tr><th>id</th><th>type</th><th>default</th><th>enum</th><th>i18n</th><th></th></tr>
					</thead>
					<tbody>
						{#each def.fields as f, i (i)}
							<tr>
								<td>
									<input
										value={f.id}
										onchange={(e) => renameField(def, f, e.currentTarget.value)}
									/>
								</td>
								<td>
									<select
										value={f.type}
										onchange={(e) => setFieldType(def, f, e.currentTarget.value as SvFieldType)}
									>
										{#each FIELD_TYPES as t (t)}<option value={t}>{t}</option>{/each}
									</select>
								</td>
								<td>
									{#if f.type === 'Bool'}
										<input
											type="checkbox"
											checked={!!f.default}
											onchange={(e) =>
												edit('Set default', () => (f.default = e.currentTarget.checked))}
										/>
									{:else if f.type === 'Int' || f.type === 'Float'}
										<NumberInput
											value={Number(f.default) || 0}
											int={f.type === 'Int'}
											onchange={(v) => edit('Set default', () => (f.default = v))}
										/>
									{:else if f.type === 'Color'}
										<ColorInput
											value={String(f.default ?? '#ffffff')}
											label="Default colour"
											onchange={(c) => edit('Set default', () => (f.default = c))}
										/>
									{:else}
										<input
											value={String(f.default ?? '')}
											onchange={(e) => edit('Set default', () => (f.default = e.currentTarget.value))}
										/>
									{/if}
								</td>
								<td>
									{#if f.type === 'Enum'}
										<select
											value={f.enumId ?? ''}
												onchange={(e) => setFieldEnum(def, f, e.currentTarget.value)}
										>
											<option value="">—</option>
											{#each project?.enums ?? [] as en (en.uid)}
												<option value={en.identifier}>{en.identifier}</option>
											{/each}
										</select>
									{:else}
										<span class="dash">—</span>
									{/if}
								</td>
								<td>
									{#if LOCALIZABLE.has(f.type)}
										<input
											type="checkbox"
											checked={!!f.localized}
											use:tooltip={'Collect this text into the localization table'}
											onchange={(e) =>
												edit('Set localized', () => (f.localized = e.currentTarget.checked || undefined))}
										/>
									{:else}
										<span class="dash">—</span>
									{/if}
								</td>
								<td>
									<button
										class="icon"
										use:tooltip={'Delete field'}
										onclick={() => deleteField(def, f)}
									>
										<IconTrash size={13} />
									</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<button class="add" onclick={() => addField(def)}><IconPlus size={13} /> Add field</button>
			</div>
		{:else}
			<div class="detail empty">No entity types yet.</div>
		{/if}
	</div>
</Dialog>

<style>
	.wrap {
		display: grid;
		grid-template-columns: 190px 1fr;
		gap: 12px;
		min-height: 360px;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-right: 1px solid var(--border);
		padding-right: 10px;
		overflow: auto;
	}
	.list li {
		display: flex;
		gap: 3px;
	}
	.list li > button:first-child {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 7px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 5px;
		color: var(--text);
		padding: 5px 7px;
		cursor: pointer;
		text-align: left;
	}
	.list li > button.active {
		border-color: var(--accent);
		color: var(--accent);
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 2px;
		flex: none;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.detail {
		min-width: 0;
		overflow: auto;
	}
	.detail.empty {
		display: grid;
		place-items: center;
		color: var(--muted);
	}
	.row {
		display: flex;
		gap: 8px;
		margin-bottom: 8px;
		flex-wrap: wrap;
	}
	.row label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 10px;
		color: var(--muted);
	}
	.row label.grow {
		flex: 1;
		min-width: 140px;
	}
	.check {
		flex-direction: row !important;
		align-items: center;
		gap: 5px !important;
		align-self: end;
		padding-bottom: 4px;
	}
	h4 {
		margin: 14px 0 6px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--muted);
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th {
		text-align: left;
		font-size: 10px;
		color: var(--muted);
		font-weight: 500;
		padding-bottom: 3px;
	}
	td {
		padding: 2px 4px 2px 0;
	}
	.dash {
		color: var(--muted);
	}
	input,
	select {
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 4px 6px;
		font: inherit;
		width: 100%;
		min-width: 0;
	}
	input[type='checkbox'] {
		width: auto;
	}
	.icon {
		background: none;
		border: none;
		color: var(--muted);
		cursor: pointer;
		padding: 4px;
	}
	.icon:hover {
		color: #ff8787;
	}
	.add {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-top: 6px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 5px;
		color: var(--text);
		padding: 5px 9px;
		cursor: pointer;
		font: inherit;
	}
	.add:hover {
		background: var(--accent-dim);
	}
</style>
