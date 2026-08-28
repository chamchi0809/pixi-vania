<script lang="ts">
	/**
	 * A tileset canvas that highlights `selected` tile ids. Read-only when `onchange` is omitted
	 * (preview); otherwise click/drag toggles tiles. Mirrors AutoRuleEditor's own tile canvas.
	 */
	import { ensureImage, getImage, tilesetImageUrl } from '../../render/images';
	import { editor } from '../../state/editorStore.svelte';
	import type { SvTileset } from '../../../format/types';

	let {
		tileset,
		projectDir,
		selected,
		onchange,
		maxWidth = 260
	}: {
		tileset: SvTileset | undefined;
		projectDir: string;
		selected: number[];
		onchange?: (ids: number[]) => void;
		maxWidth?: number;
	} = $props();

	let canvas = $state<HTMLCanvasElement>();
	const scale = $derived(
		tileset ? Math.max(0.25, Math.min(3, maxWidth / Math.max(1, tileset.pxWid))) : 1
	);
	const stride = $derived(tileset ? tileset.tileGridSize + tileset.spacing : 1);

	function draw() {
		const c = canvas;
		if (!c || !tileset) return;
		const ctx = c.getContext('2d');
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		const w = tileset.pxWid * scale;
		const h = tileset.pxHei * scale;
		c.style.width = `${w}px`;
		c.style.height = `${h}px`;
		c.width = Math.ceil(w * dpr);
		c.height = Math.ceil(h * dpr);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		ctx.imageSmoothingEnabled = false;

		const url = tilesetImageUrl(projectDir, tileset.relPath);
		const img = getImage(url) ?? ensureImage(url, () => editor.redraw());
		if (img) ctx.drawImage(img, 0, 0, w, h);

		const grid = tileset.tileGridSize * scale;
		for (const id of new Set(selected)) {
			const col = id % tileset.cWid;
			const row = Math.floor(id / tileset.cWid);
			const x = (tileset.padding + col * stride) * scale;
			const y = (tileset.padding + row * stride) * scale;
			ctx.fillStyle = '#c7786f';
			ctx.globalAlpha = 0.35;
			ctx.fillRect(x, y, grid, grid);
			ctx.globalAlpha = 1;
			ctx.strokeStyle = '#c7786f';
			ctx.lineWidth = 2;
			ctx.strokeRect(x + 1, y + 1, grid - 2, grid - 2);
		}

		ctx.globalAlpha = 0.16;
		ctx.strokeStyle = '#fff';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let cc = 0; cc <= tileset.cWid; cc++) {
			const x = (tileset.padding + cc * stride) * scale + 0.5;
			ctx.moveTo(x, 0);
			ctx.lineTo(x, h);
		}
		for (let rr = 0; rr <= tileset.cHei; rr++) {
			const y = (tileset.padding + rr * stride) * scale + 0.5;
			ctx.moveTo(0, y);
			ctx.lineTo(w, y);
		}
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	$effect(() => {
		void [editor.revision, tileset?.uid, selected.length, scale];
		draw();
	});

	let painting = false;
	let paintAdd = true;
	let touched = new Set<number>();

	function idFromEvent(e: PointerEvent): number | null {
		if (!tileset || !canvas) return null;
		const rect = canvas.getBoundingClientRect();
		const px = (e.clientX - rect.left) / scale - tileset.padding;
		const py = (e.clientY - rect.top) / scale - tileset.padding;
		const col = Math.floor(px / stride);
		const row = Math.floor(py / stride);
		if (col < 0 || row < 0 || col >= tileset.cWid || row >= tileset.cHei) return null;
		if (px - col * stride >= tileset.tileGridSize || py - row * stride >= tileset.tileGridSize)
			return null;
		return row * tileset.cWid + col;
	}

	function apply(id: number) {
		if (!onchange || touched.has(id)) return;
		touched.add(id);
		const has = selected.includes(id);
		if (paintAdd && !has) onchange([...selected, id]);
		else if (!paintAdd && has) onchange(selected.filter((x) => x !== id));
	}

	function down(e: PointerEvent) {
		if (!onchange) return;
		const id = idFromEvent(e);
		if (id == null) return;
		canvas?.setPointerCapture(e.pointerId);
		painting = true;
		touched = new Set();
		paintAdd = !selected.includes(id);
		apply(id);
	}
	function move(e: PointerEvent) {
		if (!painting) return;
		const id = idFromEvent(e);
		if (id != null) apply(id);
	}
	function up() {
		painting = false;
	}
</script>

{#if tileset}
	<div class="wrap">
		<canvas
			bind:this={canvas}
			class:editable={!!onchange}
			onpointerdown={down}
			onpointermove={move}
			onpointerup={up}
			onpointercancel={up}
		></canvas>
	</div>
{:else}
	<p class="dim">No tileset.</p>
{/if}

<style>
	.wrap {
		overflow: auto;
		max-height: 260px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 6px;
	}
	canvas {
		display: block;
		image-rendering: pixelated;
	}
	canvas.editable {
		cursor: crosshair;
		touch-action: none;
	}
	.dim {
		color: var(--muted);
	}
</style>
