<script lang="ts">
	/**
	 * Per-tile random flip/warp editor with two independent brushes: Flip paints X/Y mirror
	 * probabilities (`tileFlips`), Warp paints pixel-warp overrides in texels (`tileWarps`; unpainted
	 * tiles warp at TILE_WARP_DEFAULT, 0 = off). Baked into the tile mesh's `flip` attribute.
	 */
	import { SvelteSet } from 'svelte/reactivity';
	import { TILE_WARP_DEFAULT } from '../../../format/types';
	import { editor } from '../../state/editorStore.svelte';
	import { ensureImage, getImage, tilesetImageUrl } from '../../render/images';
	import Dialog from './Dialog.svelte';
	import { tooltip } from '../common/tooltip';
	import IconEraser from '@tabler/icons-svelte/icons/eraser';
	import { rangeFill } from '../common/rangeFill';

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

	let mode = $state<'flip' | 'warp'>('flip');
	let erase = $state(false);
	let chanceX = $state(50);
	let chanceY = $state(0);
	let warp = $state(0);

	const FILL = '#4dd2ff';
	const WARP_FILL = '#ffb86b';
	const flipCount = $derived(tileset?.tileFlips?.length ?? 0);
	const warpCount = $derived(tileset?.tileWarps?.length ?? 0);

	function setSeed(v: number) {
		if (!tileset) return;
		editor.commit('Set flip seed', () => (tileset.flipSeed = Number.isFinite(v) ? v : 0));
	}

	let canvasEl = $state<HTMLCanvasElement>();
	const DISPLAY_W = 460;
	const scale = $derived(
		tileset ? Math.max(0.25, Math.min(3, DISPLAY_W / Math.max(1, tileset.pxWid))) : 1
	);
	const stride = $derived(tileset ? tileset.tileGridSize + tileset.spacing : 1);

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

		const gridCss = tileset.tileGridSize * scale;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = `${Math.max(7, Math.min(11, gridCss * 0.24))}px system-ui, sans-serif`;

		const flipBy = new Map((tileset.tileFlips ?? []).map((f) => [f.tileId, f]));
		const warpBy = new Map((tileset.tileWarps ?? []).map((w) => [w.tileId, w.warp]));
		for (const tileId of new Set([...flipBy.keys(), ...warpBy.keys()])) {
			const col = tileId % tileset.cWid;
			const row = Math.floor(tileId / tileset.cWid);
			const x = (tileset.padding + col * stride) * scale;
			const y = (tileset.padding + row * stride) * scale;
			const f = flipBy.get(tileId);
			const w = warpBy.get(tileId);

			if (f) {
				ctx.fillStyle = FILL;
				ctx.globalAlpha = 0.15 + 0.35 * Math.max(f.chanceX, f.chanceY);
				ctx.fillRect(x, y, gridCss, gridCss);
				ctx.globalAlpha = 1;
				ctx.strokeStyle = FILL;
				ctx.lineWidth = 2;
				ctx.strokeRect(x + 1, y + 1, gridCss - 2, gridCss - 2);
			}
			if (w !== undefined) {
				if (!f) {
					ctx.fillStyle = WARP_FILL;
					ctx.globalAlpha = 0.2;
					ctx.fillRect(x, y, gridCss, gridCss);
					ctx.globalAlpha = 1;
				}
				ctx.strokeStyle = WARP_FILL;
				ctx.lineWidth = 2;
				ctx.strokeRect(x + 4, y + 4, gridCss - 8, gridCss - 8);
			}

			const parts: string[] = [];
			if (f && f.chanceX > 0) parts.push(`↔${Math.round(f.chanceX * 100)}`);
			if (f && f.chanceY > 0) parts.push(`↕${Math.round(f.chanceY * 100)}`);
			if (w !== undefined) parts.push(`≈${w}`);
			if (gridCss >= 20 && parts.length) {
				const label = parts.join(' ');
				ctx.fillStyle = '#0d0b18';
				ctx.fillText(label, x + gridCss / 2 + 0.5, y + gridCss / 2 + 0.5);
				ctx.fillStyle = '#cdd4a5';
				ctx.fillText(label, x + gridCss / 2, y + gridCss / 2);
			}
		}

		ctx.globalAlpha = 0.18;
		ctx.strokeStyle = '#ffffff';
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let c = 0; c <= tileset.cWid; c++) {
			const gx = (tileset.padding + c * stride) * scale + 0.5;
			ctx.moveTo(gx, 0);
			ctx.lineTo(gx, cssH);
		}
		for (let r = 0; r <= tileset.cHei; r++) {
			const gy = (tileset.padding + r * stride) * scale + 0.5;
			ctx.moveTo(0, gy);
			ctx.lineTo(cssW, gy);
		}
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	$effect(() => {
		void [
			editor.revision,
			selectedTilesetUid,
			mode,
			erase,
			chanceX,
			chanceY,
			warp,
			tileset?.tileFlips?.length,
			tileset?.tileWarps?.length
		];
		draw();
	});

	let painting = $state(false);
	let touched = new SvelteSet<number>();

	function tileIdFromEvent(e: PointerEvent): number | null {
		if (!tileset || !canvasEl) return null;
		const rect = canvasEl.getBoundingClientRect();
		const px = (e.clientX - rect.left) / scale - tileset.padding;
		const py = (e.clientY - rect.top) / scale - tileset.padding;
		const col = Math.floor(px / stride);
		const row = Math.floor(py / stride);
		if (col < 0 || row < 0 || col >= tileset.cWid || row >= tileset.cHei) return null;
		if (px - col * stride >= tileset.tileGridSize || py - row * stride >= tileset.tileGridSize)
			return null;
		return row * tileset.cWid + col;
	}

	function applyTile(id: number) {
		if (!tileset || touched.has(id)) return;
		touched.add(id);
		if (mode === 'flip') {
			const cx = chanceX / 100;
			const cy = chanceY / 100;
			if (erase || (cx === 0 && cy === 0)) {
				if (tileset.tileFlips?.some((f) => f.tileId === id)) {
					tileset.tileFlips = tileset.tileFlips.filter((f) => f.tileId !== id);
				}
			} else {
				const list = (tileset.tileFlips ??= []);
				const existing = list.find((f) => f.tileId === id);
				if (existing) {
					existing.chanceX = cx;
					existing.chanceY = cy;
				} else list.push({ tileId: id, chanceX: cx, chanceY: cy });
			}
		} else {
			// Painting the default value is the same as erasing: the override becomes meaningless.
			if (erase || warp === TILE_WARP_DEFAULT) {
				if (tileset.tileWarps?.some((w) => w.tileId === id)) {
					tileset.tileWarps = tileset.tileWarps.filter((w) => w.tileId !== id);
				}
			} else {
				const list = (tileset.tileWarps ??= []);
				const existing = list.find((w) => w.tileId === id);
				if (existing) existing.warp = warp;
				else list.push({ tileId: id, warp });
			}
		}
		editor.touch();
	}

	function onpointerdown(e: PointerEvent) {
		if (!tileset) return;
		const id = tileIdFromEvent(e);
		if (id == null) return;
		canvasEl?.setPointerCapture(e.pointerId);
		painting = true;
		touched = new SvelteSet();
		editor.beginStroke(`${erase ? 'Clear' : 'Set'} tile ${mode}`);
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

<Dialog title="Tile random flip & warp" {onclose} width={620}>
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
				<span class="lbl">Seed</span>
				<input
					class="text seed"
					type="number"
					value={tileset.flipSeed ?? 0}
					use:tooltip={'Fixed hash seed — same seed reproduces the same flip pattern'}
					onchange={(e) => setSeed(e.currentTarget.valueAsNumber)}
				/>
			</label>

			<div class="field">
				<span class="lbl">Brush</span>
				<div class="seg">
					<button class="toggle" class:on={mode === 'flip'} onclick={() => (mode = 'flip')}>
						Flip
					</button>
					<button
						class="toggle warp"
						class:on={mode === 'warp'}
						use:tooltip={`Per-tile pixel-warp override; unpainted tiles warp at ${TILE_WARP_DEFAULT}px`}
						onclick={() => (mode = 'warp')}
					>
						Warp
					</button>
				</div>
			</div>

			{#if mode === 'flip'}
				<label class="field slider" class:disabled={erase}>
					<span class="lbl">Flip X ↔ {chanceX}%</span>
					<input
						type="range"
						min="0"
						max="100"
						bind:value={chanceX}
						use:rangeFill={chanceX}
						disabled={erase}
					/>
				</label>

				<label class="field slider" class:disabled={erase}>
					<span class="lbl">Flip Y ↕ {chanceY}%</span>
					<input
						type="range"
						min="0"
						max="100"
						bind:value={chanceY}
						use:rangeFill={chanceY}
						disabled={erase}
					/>
				</label>
			{:else}
				<label class="field slider" class:disabled={erase}>
					<span class="lbl">Warp ≈ {warp}px {warp === 0 ? '(off)' : ''}</span>
					<input
						type="range"
						min="0"
						max="4"
						step="0.5"
						bind:value={warp}
						use:rangeFill={warp}
						disabled={erase}
						use:tooltip={`Pixel-shove amplitude in texels. Painting ${TILE_WARP_DEFAULT} (the default) clears the override; 0 disables warping.`}
					/>
				</label>
			{/if}

			<div class="field">
				<span class="lbl">&nbsp;</span>
				<button
					class="toggle"
					class:on={erase}
					use:tooltip={`Remove ${mode} config from a tile`}
					onclick={() => (erase = !erase)}
				>
					<IconEraser size={14} />
					{erase ? 'Erasing' : 'Erase'}
				</button>
			</div>
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
		<p class="hint">
			Click or drag tiles to paint — <b>{flipCount}</b> flip / <b>{warpCount}</b> warp tagged.
			Unpainted tiles warp at {TILE_WARP_DEFAULT}px (as before); a warp override of 0 turns it off.
			Tiles baked into the level mesh — save to see it in game.
		</p>
	{/if}

	{#snippet footer()}
		<button class="btn" onclick={onclose}>Done</button>
	{/snippet}
</Dialog>

<style>
	.controls {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: flex-end;
		margin-bottom: 10px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.field.disabled {
		opacity: 0.5;
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
	.seed {
		width: 90px;
	}
	.slider input {
		width: 130px;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 6px;
		padding: 5px 10px;
		cursor: pointer;
		font: inherit;
	}
	.toggle.on {
		border-color: var(--accent);
		background: var(--accent-dim);
		color: var(--accent);
	}
	.toggle.warp.on {
		border-color: #ffb86b;
		background: rgba(255, 184, 107, 0.15);
		color: #ffb86b;
	}
	.seg {
		display: flex;
		gap: 4px;
	}
	.canvas-wrap {
		overflow: auto;
		max-height: 56vh;
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
