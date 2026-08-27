<script lang="ts">
	import IconColorPicker from '@tabler/icons-svelte/icons/color-picker';
	import { rangeFill } from './rangeFill';

	let {
		value = $bindable('#ffffff'),
		onchange,
		label = 'Color',
		disabled = false
	}: {
		value?: string;
		onchange?: (hex: string) => void;
		label?: string;
		disabled?: boolean;
	} = $props();

	const uid = `sv-color-${nextId()}`;
	let svEl = $state<HTMLDivElement>();
	let open = $state(false);
	// Draft while the popover is open; committed on close so a drag is one undo step.
	let draft = $state<string | null>(null);
	let hexText = $state('');

	const shown = $derived(draft ?? norm(value));
	const hsv = $derived(hexToHsv(shown));

	function apply(h: number, s: number, v: number) {
		draft = hsvToHex(h, s, v);
		hexText = draft;
	}

	function commit() {
		if (draft && draft !== norm(value)) {
			const next = draft;
			value = next;
			onchange?.(next);
		}
		draft = null;
	}

	function ontoggle(e: ToggleEvent) {
		open = e.newState === 'open';
		if (open) {
			hexText = shown;
			queueMicrotask(() => svEl?.focus());
		} else {
			commit();
		}
	}

	function svFromPointer(e: PointerEvent) {
		const r = svEl!.getBoundingClientRect();
		const s = clamp((e.clientX - r.left) / r.width, 0, 1);
		const v = 1 - clamp((e.clientY - r.top) / r.height, 0, 1);
		apply(hsv.h, s, v);
	}

	function onSvPointerDown(e: PointerEvent) {
		svEl!.setPointerCapture(e.pointerId);
		svFromPointer(e);
	}

	function onSvKeyDown(e: KeyboardEvent) {
		const step = e.shiftKey ? 0.1 : 0.02;
		const { h, s, v } = hsv;
		if (e.key === 'ArrowLeft') apply(h, clamp(s - step, 0, 1), v);
		else if (e.key === 'ArrowRight') apply(h, clamp(s + step, 0, 1), v);
		else if (e.key === 'ArrowDown') apply(h, s, clamp(v - step, 0, 1));
		else if (e.key === 'ArrowUp') apply(h, s, clamp(v + step, 0, 1));
		else return;
		e.preventDefault();
	}

	function commitHex() {
		const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(hexText.trim());
		if (m) {
			const c = hexToHsv(norm(m[1]));
			apply(c.h, c.s, c.v);
		} else hexText = shown;
	}

	async function pick() {
		// ponytail: Chromium-only; the button is hidden elsewhere.
		const dropper = new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper();
		try {
			const { sRGBHex } = await dropper.open();
			const c = hexToHsv(norm(sRGBHex));
			apply(c.h, c.s, c.v);
		} catch {
			/* cancelled */
		}
	}

	const hasDropper = typeof window !== 'undefined' && 'EyeDropper' in window;
</script>

<button
	type="button"
	class="swatch"
	{disabled}
	popovertarget={uid}
	aria-label="{label}: {shown}"
	style="--sw:{shown}; anchor-name:--{uid}"
>
	<span class="chip"></span>
</button>

<div
	id={uid}
	popover
	class="pop"
	role="dialog"
	aria-label="{label} picker"
	style="position-anchor:--{uid}"
	{ontoggle}
>
	<div
		bind:this={svEl}
		class="sv"
		role="slider"
		tabindex="0"
		aria-label="Saturation and brightness"
		aria-valuemin="0"
		aria-valuemax="100"
		aria-valuenow={Math.round(hsv.s * 100)}
		aria-valuetext="Saturation {Math.round(hsv.s * 100)}%, brightness {Math.round(hsv.v * 100)}%"
		style="--hue:{hsv.h}"
		onpointerdown={onSvPointerDown}
		onpointermove={(e) => e.buttons === 1 && svEl?.hasPointerCapture(e.pointerId) && svFromPointer(e)}
		onkeydown={onSvKeyDown}
	>
		<span class="sv-thumb" style="left:{hsv.s * 100}%; top:{(1 - hsv.v) * 100}%; --sw:{shown}"></span>
	</div>

	<input
		class="hue"
		type="range"
		min="0"
		max="360"
		step="1"
		aria-label="Hue"
		value={hsv.h}
		use:rangeFill={hsv.h}
		oninput={(e) => apply(+e.currentTarget.value, hsv.s, hsv.v)}
	/>

	<div class="foot">
		<span class="preview" style="--sw:{shown}"></span>
		<input
			class="hex"
			aria-label="Hex value"
			spellcheck="false"
			bind:value={hexText}
			onchange={commitHex}
			onkeydown={(e) => e.key === 'Enter' && commitHex()}
		/>
		{#if hasDropper}
			<button type="button" class="drop" onclick={pick} aria-label="Pick colour from screen">
				<IconColorPicker size={14} />
			</button>
		{/if}
	</div>
</div>

<script lang="ts" module>
	let seq = 0;
	function nextId() {
		return ++seq;
	}

	const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

	function norm(hex: string) {
		let h = (hex || '').trim().replace(/^#/, '');
		if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
		return /^[0-9a-f]{6}$/i.test(h) ? `#${h.toLowerCase()}` : '#ffffff';
	}

	function hexToHsv(hex: string) {
		const n = parseInt(norm(hex).slice(1), 16);
		const r = (n >> 16) / 255,
			g = ((n >> 8) & 255) / 255,
			b = (n & 255) / 255;
		const max = Math.max(r, g, b),
			min = Math.min(r, g, b),
			d = max - min;
		let h = 0;
		if (d) {
			if (max === r) h = ((g - b) / d) % 6;
			else if (max === g) h = (b - r) / d + 2;
			else h = (r - g) / d + 4;
			h = (h * 60 + 360) % 360;
		}
		return { h, s: max ? d / max : 0, v: max };
	}

	function hsvToHex(h: number, s: number, v: number) {
		const f = (n: number) => {
			const k = (n + h / 60) % 6;
			const c = v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
			return Math.round(c * 255)
				.toString(16)
				.padStart(2, '0');
		};
		return `#${f(5)}${f(3)}${f(1)}`;
	}
</script>

<style>
	.swatch {
		display: block;
		width: var(--sw-w, 100%);
		height: var(--sw-h, 24px);
		padding: 2px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--bg);
		cursor: pointer;
		transition:
			border-color 130ms ease,
			box-shadow 130ms ease;
	}
	.swatch:hover:not(:disabled) {
		border-color: var(--p5);
	}
	.swatch:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.chip {
		display: block;
		height: 100%;
		border-radius: 3px;
		background: var(--sw);
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.35);
		transition: background 130ms ease;
	}

	.pop {
		position: absolute;
		position-area: block-end span-all;
		justify-self: anchor-center;
		position-try-fallbacks: flip-block;
		margin: 6px 0;
		padding: 8px;
		width: 196px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--panel-2);
		color: var(--text);
		box-shadow: 0 12px 32px rgb(0 0 0 / 0.5);
		opacity: 0;
		translate: 0 -6px;
		scale: 0.98;
		transition:
			opacity 140ms ease,
			translate 140ms cubic-bezier(0.2, 0.9, 0.3, 1),
			scale 140ms cubic-bezier(0.2, 0.9, 0.3, 1),
			overlay 140ms allow-discrete,
			display 140ms allow-discrete;
	}
	.pop:popover-open {
		opacity: 1;
		translate: 0 0;
		scale: 1;
	}
	@starting-style {
		.pop:popover-open {
			opacity: 0;
			translate: 0 -6px;
			scale: 0.98;
		}
	}

	.sv {
		position: relative;
		height: 116px;
		border-radius: 5px;
		cursor: crosshair;
		touch-action: none;
		background:
			linear-gradient(to top, #000, transparent),
			linear-gradient(to right, #fff, hsl(var(--hue) 100% 50%));
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.35);
	}
	.sv-thumb {
		position: absolute;
		width: 12px;
		height: 12px;
		margin: -6px 0 0 -6px;
		border-radius: 50%;
		background: var(--sw);
		border: 2px solid #fff;
		box-shadow: 0 0 0 1px rgb(0 0 0 / 0.5);
		pointer-events: none;
		transition: background 90ms linear;
	}
	.hue {
		width: 100%;
		margin: 10px 0 8px;
		--range-track: linear-gradient(
			to right,
			#f00,
			#ff0 17%,
			#0f0 33%,
			#0ff 50%,
			#00f 67%,
			#f0f 83%,
			#f00
		);
		--range-fill: transparent;
	}

	.foot {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.preview {
		width: 22px;
		height: 22px;
		flex: none;
		border-radius: 4px;
		background: var(--sw);
		box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.35);
		transition: background 130ms ease;
	}
	.hex {
		flex: 1;
		min-width: 0;
		padding: 4px 6px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg);
		color: var(--text);
		font: 11px/1.2 ui-monospace, monospace;
		text-transform: lowercase;
	}
	.drop {
		display: grid;
		place-items: center;
		flex: none;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--panel);
		color: var(--muted);
		cursor: pointer;
		transition:
			color 130ms ease,
			border-color 130ms ease;
	}
	.drop:hover {
		color: var(--accent);
		border-color: var(--p5);
	}
</style>
