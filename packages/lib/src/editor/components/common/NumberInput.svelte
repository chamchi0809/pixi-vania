<script lang="ts">
	/**
	 * Editor number field via `i-input-svelte` (drag-to-scrub, inline math like `3*8`, keyboard step).
	 * Emits the committed value via `onchange` on blur/enter/scrub (DOM `onchange` semantics).
	 */
	import { IInput } from 'i-input-svelte';

	let {
		value,
		onchange,
		int = false,
		min = null,
		max = null,
		step,
		disabled = false,
		class: className = ''
	}: {
		value: number;
		onchange: (value: number) => void;
		/** Integer field: round on commit, scrub/step by 1, show no decimals. */
		int?: boolean;
		min?: number | null;
		max?: number | null;
		step?: number;
		disabled?: boolean;
		class?: string;
	} = $props();
</script>

<IInput
	{value}
	onChange={onchange}
	{disabled}
	precision={int ? 0 : 3}
	step={step ?? (int ? 1 : 0.1)}
	hardMin={min ?? undefined}
	hardMax={max ?? undefined}
	class={`num-input ${className}`}
	styles={{
		root: 'width:100%; background:var(--bg); border:1px solid var(--border); border-radius:4px; color:var(--text); padding:3px 5px; font:inherit; cursor:ew-resize; min-width:0;',
		input: 'color:var(--text); font:inherit; background:transparent;',
		display: 'color:var(--text); font:inherit;',
		rootInvalid: 'border-color:#ff7676;'
	}}
/>
