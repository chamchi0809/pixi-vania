<script lang="ts">
	/**
	 * Assign enum tags to tileset tiles, driving the runtime's collider/behaviour selection
	 * (e.g. tiles tagged `RECT` become solid). Click or drag tiles to toggle the active value.
	 */
	import { editor } from '../../state/editorStore.svelte';
	import { ensureImage, getImage, tilesetImageUrl } from '../../render/images';
	import { getEnum, type SvTileset } from '../../../format/types';
	import Dialog from './Dialog.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const project = $derived(editor.project);
	const projectDir = $derived(
		editor.projectPath.slice(0, editor.projectPath.lastIndexOf('/')) || ''
	);

	let selectedTilesetUid = $state<number>(
		editor.activeTileset?.uid ?? editor.project?.tilesets[0]?.uid ?? -1
	);
	const tileset = $derived(
		project?.tilesets.find((t) => t.uid === selectedTilesetUid) ?? project?.tilesets[0]
	);
	const tagEnum = $derived(tileset ? getEnum(project!, tileset.tagsEnumId) : undefined);
	let activeValueId = $state<string>('');

	$effect(() => {
		// Keep the active value valid for the current enum.
		const ids = tagEnum?.values.map((v) => v.id) ?? [];
		if (!ids.includes(activeValueId)) activeValueId = ids[0] ?? '';
	});

	let canvasEl = $state<HTMLCanvasElement>();
	const DISPLAY_W = 460;

	const scale = $derived(
		tileset ? Math.max(0.25, Math.min(3, DISPLAY_W / Math.max(1, tileset.pxWid))) : 1
	);
	const stride = $derived(tileset ? tileset.tileGridSize + tileset.spacing : 1);

	function valueColor(id: string): string {
		return tagEnum?.values.find((v) => v.id === id)?.color ?? '#c7786f';
	}

	function tilesTaggedWith(ts: SvTileset, valueId: string): Set<number> {
		return new Set(ts.enumTags.find((t) => t.enumValueId === valueId)?.tileIds ?? []);
	}

	function setTagsEnum(enumId: string) {
		if (!tileset) return;
		editor.commit('Set tags enum', () => (tileset.tagsEnumId = enumId || null));
	}

	function draw() {
		const canvas = canvasEl;
		if (!canvas || !tileset || !project) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const dpr = window.devicePixelRatio || 1;
		const cssW = tileset.pxWid * scale;
		const cssH = tileset.pxHei * scale;
		canvas.style.width = `${cssW}px`;
		canvas.style.height = `${cssH}px`;
		canvas.width = Math.ceil(cssW * dpr);
		canvas.height = Math.ceil(cssH * dpr);

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, cssW, cssH);
		ctx.imageSmoothingEnabled = false;

		const url = tilesetImageUrl(projectDir, tileset.relPath);
		const img = getImage(url) ?? ensureImage(url, () => editor.touch());
		if (img) ctx.drawImage(img, 0, 0, cssW, cssH);
		else {
			ctx.fillStyle = '#000';
			ctx.fillRect(0, 0, cssW, cssH);
		}

		const grid = tileset.tileGridSize * scale;

		// Other values: thin colored corner marks.
		for (const tag of tileset.enumTags) {
			if (tag.enumValueId === activeValueId) continue;
			ctx.fillStyle = valueColor(tag.enumValueId);
			for (const id of tag.tileIds) {
				const col = id % tileset.cWid;
				const row = Math.floor(id / tileset.cWid);
				const x = (tileset.padding + col * stride) * scale;
				const y = (tileset.padding + row * stride) * scale;
				ctx.globalAlpha = 0.9;
				ctx.fillRect(x, y, Math.max(3, grid * 0.22), Math.max(3, grid * 0.22));
			}
		}
		ctx.globalAlpha = 1;

		// Active value: filled overlay + outline.
		if (activeValueId) {
			const tagged = tilesTaggedWith(tileset, activeValueId);
			const c = valueColor(activeValueId);
			for (const id of tagged) {
				const col = id % tileset.cWid;
				const row = Math.floor(id / tileset.cWid);
				const x = (tileset.padding + col * stride) * scale;
				const y = (tileset.padding + row * stride) * scale;
				ctx.fillStyle = c;
				ctx.globalAlpha = 0.4;
				ctx.fillRect(x, y, grid, grid);
				ctx.globalAlpha = 1;
				ctx.strokeStyle = c;
				ctx.lineWidth = 2;
				ctx.strokeRect(x + 1, y + 1, grid - 2, grid - 2);
			}
		}

		// Grid lines.
		ctx.globalAlpha = 0.18;
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let c = 0; c <= tileset.cWid; c++) {
			const x = (tileset.padding + c * stride) * scale + 0.5;
			ctx.moveTo(x, 0);
			ctx.lineTo(x, cssH);
		}
		for (let r = 0; r <= tileset.cHei; r++) {
			const y = (tileset.padding + r * stride) * scale + 0.5;
			ctx.moveTo(0, y);
			ctx.lineTo(cssW, y);
		}
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	$effect(() => {
		// Redraw on any relevant change.
		void [
			editor.revision,
			selectedTilesetUid,
			activeValueId,
			tileset?.enumTags.length,
			tagEnum?.uid
		];
		draw();
	});

	let painting = $state(false);
	let paintMode: 'add' | 'remove' = 'add';
	let touched = new Set<number>();

	function tileIdFromEvent(e: PointerEvent): number | null {
		if (!tileset || !canvasEl) return null;
		const rect = canvasEl.getBoundingClientRect();
		const px = (e.clientX - rect.left) / scale - tileset.padding;
		const py = (e.clientY - rect.top) / scale - tileset.padding;
		const col = Math.floor(px / stride);
		const row = Math.floor(py / stride);
		if (col < 0 || row < 0 || col >= tileset.cWid || row >= tileset.cHei) return null;
		// Ignore clicks that land in the inter-tile spacing gap (only when spacing > 0).
		if (px - col * stride >= tileset.tileGridSize || py - row * stride >= tileset.tileGridSize)
			return null;
		return row * tileset.cWid + col;
	}

	function applyTile(id: number) {
		if (!tileset || !activeValueId || touched.has(id)) return;
		touched.add(id);
		let tag = tileset.enumTags.find((t) => t.enumValueId === activeValueId);
		if (!tag) {
			tag = { enumValueId: activeValueId, tileIds: [] };
			tileset.enumTags.push(tag);
		}
		const has = tag.tileIds.includes(id);
		if (paintMode === 'add' && !has) tag.tileIds.push(id);
		else if (paintMode === 'remove' && has) tag.tileIds = tag.tileIds.filter((x) => x !== id);
		if (tag.tileIds.length === 0) {
			tileset.enumTags = tileset.enumTags.filter((t) => t.enumValueId !== activeValueId);
		}
		editor.touch();
	}

	function onpointerdown(e: PointerEvent) {
		if (!tileset || !activeValueId) return;
		const id = tileIdFromEvent(e);
		if (id == null) return;
		canvasEl?.setPointerCapture(e.pointerId);
		painting = true;
		touched = new Set();
		paintMode = tilesTaggedWith(tileset, activeValueId).has(id) ? 'remove' : 'add';
		editor.beginStroke(paintMode === 'add' ? 'Tag tiles' : 'Untag tiles');
		applyTile(id);
	}

	function onpointermove(e: PointerEvent) {
		if (!painting) return;
		const id = tileIdFromEvent(e);
		if (id != null) applyTile(id);
	}

	function onpointerup() {
		if (!painting) return;
		painting = false;
		editor.endStroke();
	}
</script>

<Dialog title="Tileset tags" {onclose} width={620}>
	{#if !project || project.tilesets.length === 0}
		<p class="dim">No tilesets in this project. Import one first.</p>
	{:else if tileset}
		<div class="controls">
			<label class="field">
				<span class="lbl">Tileset</span>
				<select class="text" bind:value={selectedTilesetUid}>
					{#each project.tilesets as ts (ts.uid)}
						<option value={ts.uid}>{ts.identifier}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span class="lbl">Tags enum</span>
				<select
					class="text"
					value={tileset.tagsEnumId ?? ''}
					onchange={(e) => setTagsEnum(e.currentTarget.value)}
				>
					<option value="">(none)</option>
					{#each project.enums as en (en.uid)}
						<option value={en.identifier}>{en.identifier}</option>
					{/each}
				</select>
			</label>
		</div>

		{#if tagEnum}
			<div class="values">
				{#each tagEnum.values as v (v.id)}
					<button
						class="chip"
						class:active={activeValueId === v.id}
						onclick={() => (activeValueId = v.id)}
					>
						<span class="sw" style="background:{v.color ?? '#888'}"></span>
						{v.id}
						<span class="ct">{tilesTaggedWith(tileset, v.id).size}</span>
					</button>
				{/each}
			</div>

			<div class="canvas-wrap">
				<canvas
					bind:this={canvasEl}
					{onpointerdown}
					{onpointermove}
					{onpointerup}
					onpointercancel={onpointerup}
				></canvas>
			</div>
			<p class="hint">Click or drag tiles to toggle the <b>{activeValueId}</b> tag.</p>
		{:else}
			<p class="dim">Pick a tags enum to start tagging tiles.</p>
		{/if}
	{/if}

	{#snippet footer()}
		<button class="btn" onclick={onclose}>Done</button>
	{/snippet}
</Dialog>

<style>
	.controls {
		display: flex;
		gap: 16px;
		margin-bottom: 10px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.lbl {
		color: var(--muted);
		font-size: 11px;
	}
	.text {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 4px 6px;
		font: inherit;
	}
	.values {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		margin-bottom: 10px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 14px;
		padding: 3px 9px;
		cursor: pointer;
		font: inherit;
	}
	.chip.active {
		border-color: var(--accent);
		background: var(--accent-dim);
	}
	.sw {
		width: 11px;
		height: 11px;
		border-radius: 3px;
		display: inline-block;
	}
	.ct {
		color: var(--muted);
		font-size: 10px;
	}
	.canvas-wrap {
		overflow: auto;
		max-height: 52vh;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 8px;
	}
	canvas {
		display: block;
		cursor: crosshair;
		touch-action: none;
	}
	.hint {
		color: var(--muted);
		margin: 8px 0 0;
	}
	.dim {
		color: var(--muted);
	}
	.btn {
		background: var(--panel);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 5px;
		padding: 6px 12px;
		cursor: pointer;
		font: inherit;
	}
	.btn:hover {
		background: var(--accent-dim);
	}
</style>
