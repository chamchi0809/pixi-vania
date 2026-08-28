<script lang="ts">
	/**
	 * A single typed value editor driven by an `SvFieldType` (entity + level fields).
	 * Emits via `onchange`; the caller wraps it in an undoable commit, never mutates state here.
	 */
	import { editor } from '../../state/editorStore.svelte';
	import { getEnum, type SvFieldType, type SvFieldValue } from '../../../format/types';
	import NumberInput from '../common/NumberInput.svelte';
	import ColorInput from '../common/ColorInput.svelte';

	let {
		type,
		value,
		enumId,
		options,
		min,
		max,
		label = 'Field color',
		onchange
	}: {
		type: SvFieldType;
		value: SvFieldValue;
		enumId?: string | null;
		/** Fixed string choices — when set, the field renders as a dropdown regardless of `type`. */
		options?: string[];
		min?: number | null;
		max?: number | null;
		label?: string;
		onchange: (v: SvFieldValue) => void;
	} = $props();

	const enumValues = $derived(
		type === 'Enum' && editor.project ? (getEnum(editor.project, enumId)?.values ?? []) : []
	);

	const num = (v: unknown, fallback = 0): number => {
		const n = typeof v === 'number' ? v : parseFloat(String(v));
		return Number.isFinite(n) ? n : fallback;
	};

	const point = $derived(
		Array.isArray(value) ? (value as number[]) : [num((value as any)?.x), num((value as any)?.y)]
	);
</script>

{#if options && options.length}
	<select
		class="text"
		value={(value as string) ?? ''}
		onchange={(e) => onchange(e.currentTarget.value)}
	>
		{#each options as opt (opt)}
			<option value={opt}>{opt}</option>
		{/each}
	</select>
{:else if type === 'Bool'}
	<input type="checkbox" checked={!!value} onchange={(e) => onchange(e.currentTarget.checked)} />
{:else if type === 'Int' || type === 'Float'}
	<NumberInput
		int={type === 'Int'}
		value={num(value)}
		min={min ?? null}
		max={max ?? null}
		onchange={(n) => onchange(n)}
	/>
{:else if type === 'Color'}
	<ColorInput
		value={typeof value === 'string' && value ? value : '#ffffff'}
		{label}
		onchange={(c) => onchange(c)}
	/>
{:else if type === 'MultiLines'}
	<textarea
		class="text"
		rows="3"
		value={(value as string) ?? ''}
		onchange={(e) => onchange(e.currentTarget.value)}
	></textarea>
{:else if type === 'Enum'}
	<select
		class="text"
		value={(value as string) ?? ''}
		onchange={(e) => onchange(e.currentTarget.value || null)}
	>
		<option value="">—</option>
		{#each enumValues as ev (ev.id)}
			<option value={ev.id}>{ev.id}</option>
		{/each}
	</select>
{:else if type === 'Point'}
	<span class="point">
		<NumberInput int value={point[0]} onchange={(n) => onchange([n, point[1]])} />
		<NumberInput int value={point[1]} onchange={(n) => onchange([point[0], n])} />
	</span>
{:else}
	<input
		class="text"
		type="text"
		value={(value as string) ?? ''}
		onchange={(e) => onchange(e.currentTarget.value)}
	/>
{/if}

<style>
	.text {
		width: 100%;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 3px 5px;
		font: inherit;
	}
	.point {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
	}
	input[type='checkbox'] {
		width: 16px;
		height: 16px;
	}
</style>
