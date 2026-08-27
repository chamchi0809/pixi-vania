<script lang="ts">
	/**
	 * Tileset tile-picker. Draws the active layer's tileset to a canvas and lets the user
	 * rubber-band a rectangle of tiles into the editor's tile brush.
	 */
	import { onMount } from 'svelte';
	import { editor } from '../../state/editorStore.svelte';
	import { ensureImage, tilesetImageUrl } from '../../render/images';
	import Panel from './Panel.svelte';

	let wrap: HTMLDivElement;
	let canvasEl = $state<HTMLCanvasElement>();
	let ctx: CanvasRenderingContext2D | null = null;
	let scale = $state(2);
	let wrapW = $state(280);

	let sel = $state<{ c0: number; r0: number; c1: number; r1: number } | null>(null);
	let dragging = false;

	const projectDir = $derived(
		editor.projectPath.slice(0, editor.projectPath.lastIndexOf('/')) + '/'
	);
	const tileset = $derived(editor.activeTileset);
	const stride = $derived(tileset ? tileset.tileGridSize + tileset.spacing : 16);

	function fit() {
		if (!tileset) return;
		scale = Math.max(0.5, Math.min(4, (wrapW - 12) / tileset.pxWid));
	}

	function colRowFromEvent(e: PointerEvent): { c: number; r: number } | null {
		if (!tileset) return null;
		const rect = canvasEl!.getBoundingClientRect();
		const px = (e.clientX - rect.left) / scale;
		const py = (e.clientY - rect.top) / scale;
		const c = Math.floor((px - tileset.padding) / stride);
		const r = Math.floor((py - tileset.padding) / stride);
		if (c < 0 || r < 0 || c >= tileset.cWid || r >= tileset.cHei) return null;
		return { c, r };
	}

	function commitBrush() {
		if (!tileset || !sel) return;
		const c0 = Math.min(sel.c0, sel.c1);
		const r0 = Math.min(sel.r0, sel.r1);
		const c1 = Math.max(sel.c0, sel.c1);
		const r1 = Math.max(sel.r0, sel.r1);
		const w = c1 - c0 + 1;
		const h = r1 - r0 + 1;
		const ids: number[] = [];
		for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) ids.push(r * tileset.cWid + c);
		editor.brush = { ids, w, h };
		if (editor.tool === 'select' || editor.tool === 'entity') editor.setTool('brush');
	}

	function onDown(e: PointerEvent) {
		const cr = colRowFromEvent(e);
		if (!cr) return;
		canvasEl!.setPointerCapture(e.pointerId);
		dragging = true;
		sel = { c0: cr.c, r0: cr.r, c1: cr.c, r1: cr.r };
	}
	function onMove(e: PointerEvent) {
		if (!dragging || !sel) return;
		const cr = colRowFromEvent(e);
		if (!cr) return;
		sel = { ...sel, c1: cr.c, r1: cr.r };
	}
	function onUp() {
		if (!dragging) return;
		dragging = false;
		commitBrush();
	}

	function draw() {
		if (!ctx || !tileset) return;
		const url = tilesetImageUrl(projectDir, tileset.relPath);
		const img = ensureImage(url, draw);
		const w = tileset.pxWid * scale;
		const h = tileset.pxHei * scale;
		canvasEl!.width = Math.round(w);
		canvasEl!.height = Math.round(h);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = '#0d0b18';
		ctx.fillRect(0, 0, w, h);
		if (img) ctx.drawImage(img, 0, 0, w, h);

		ctx.strokeStyle = 'rgba(255,255,255,0.08)';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let c = 0; c <= tileset.cWid; c++) {
			const x = (tileset.padding + c * stride) * scale + 0.5;
			ctx.moveTo(x, 0);
			ctx.lineTo(x, h);
		}
		for (let r = 0; r <= tileset.cHei; r++) {
			const y = (tileset.padding + r * stride) * scale + 0.5;
			ctx.moveTo(0, y);
			ctx.lineTo(w, y);
		}
		ctx.stroke();

		if (sel) {
			const c0 = Math.min(sel.c0, sel.c1);
			const r0 = Math.min(sel.r0, sel.r1);
			const c1 = Math.max(sel.c0, sel.c1);
			const r1 = Math.max(sel.r0, sel.r1);
			ctx.strokeStyle = '#c7786f';
			ctx.lineWidth = 2;
			ctx.strokeRect(
				(tileset.padding + c0 * stride) * scale,
				(tileset.padding + r0 * stride) * scale,
				(c1 - c0 + 1) * stride * scale,
				(r1 - r0 + 1) * stride * scale
			);
		}
	}

	onMount(() => {
		ctx = canvasEl!.getContext('2d');
		const ro = new ResizeObserver((es) => {
			wrapW = es[0].contentRect.width;
			fit();
		});
		ro.observe(wrap);
		return () => ro.disconnect();
	});

	// Reset selection when the tileset changes; redraw on any relevant change.
	let lastTs = -1;
	$effect(() => {
		if (tileset && tileset.uid !== lastTs) {
			lastTs = tileset.uid;
			sel = null;
			fit();
		}
		void scale;
		void sel;
		draw();
	});
</script>

<Panel title="Tileset">
	<div class="wrap" bind:this={wrap}>
		{#if tileset}
			<canvas
				bind:this={canvasEl}
				onpointerdown={onDown}
				onpointermove={onMove}
				onpointerup={onUp}
			></canvas>
		{:else}
			<p class="hint">This layer has no tileset assigned.</p>
		{/if}
	</div>
</Panel>

<style>
	.wrap {
		width: 100%;
		overflow: auto;
	}
	canvas {
		display: block;
		image-rendering: pixelated;
		cursor: crosshair;
		touch-action: none;
	}
	.hint {
		color: var(--muted);
		font-size: 11px;
	}
</style>
