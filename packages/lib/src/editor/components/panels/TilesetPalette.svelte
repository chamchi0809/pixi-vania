<script lang="ts">
	/**
	 * Tileset tile-picker. Draws the active layer's tileset to a canvas and lets the user
	 * rubber-band a rectangle of tiles into the editor's tile brush.
	 */
	import { onMount } from 'svelte';
	import { editor } from '../../state/editorStore.svelte';
	import { ensureImage, invalidateImage, tilesetImageUrl } from '../../render/images';
	import { recomputeAllAutoTilesAllLevels } from '../../state/ops';
	import { tileIdToSrc, type SvTileset } from '../../../format/types';
	import Panel from './Panel.svelte';

	let wrap: HTMLDivElement;
	let canvasEl = $state<HTMLCanvasElement>();
	let ctx: CanvasRenderingContext2D | null = null;
	let scale = $state(2);
	let wrapW = $state(280);
	let replacementUid = $state<number | null>(null);
	let replacing = $state(false);

	let sel = $state<{ c0: number; r0: number; c1: number; r1: number } | null>(null);
	let dragging = false;

	const projectDir = $derived(
		editor.projectPath.slice(0, editor.projectPath.lastIndexOf('/')) + '/'
	);
	const tileset = $derived(editor.activeTileset);
	const stride = $derived(tileset ? tileset.tileGridSize + tileset.spacing : 16);
	const alternatives = $derived(editor.project?.tilesets.filter((item) => item.uid !== tileset?.uid) ?? []);
	const usageCount = $derived.by(() => {
		if (!tileset || !editor.project) return 0;
		const project = editor.project;
		let count = project.layers.filter((layer) => layer.tilesetDefUid === tileset.uid).length;
		count += project.autoRuleGroups.filter((group) => group.tilesetDefUid === tileset.uid).length;
		count += (project.autoRulePresets ?? []).filter((preset) => preset.tilesetDefUid === tileset.uid).length;
		for (const item of project.enums) count += item.values.filter((value) => value.tile?.tilesetUid === tileset.uid).length;
		return count;
	});

	function renameTileset(tileset: SvTileset, raw: string) {
		const next = raw.trim();
		const project = editor.project;
		if (!project || !next || next === tileset.identifier || project.tilesets.some((item) => item !== tileset && item.identifier === next)) return;
		editor.commit('Rename tileset', () => (tileset.identifier = next));
	}

	const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`could not load ${src}`));
		image.src = src;
	});

	async function replaceImage(tileset: SvTileset) {
		const raw = prompt('New image path (relative to the project file):', tileset.relPath)?.trim();
		if (!raw || raw === tileset.relPath || replacing) return;
		replacing = true;
		const oldUrl = tilesetImageUrl(projectDir, tileset.relPath);
		const nextUrl = tilesetImageUrl(projectDir, raw);
		try {
			const image = await loadImage(nextUrl);
			const project = editor.project;
			if (!project || !project.tilesets.some((item) => item.uid === tileset.uid)) return;
			editor.commit('Replace tileset image', () => {
				tileset.relPath = raw;
				tileset.pxWid = image.naturalWidth;
				tileset.pxHei = image.naturalHeight;
				tileset.cWid = Math.max(0, Math.floor((tileset.pxWid - tileset.padding * 2 + tileset.spacing) / (tileset.tileGridSize + tileset.spacing)));
				tileset.cHei = Math.max(0, Math.floor((tileset.pxHei - tileset.padding * 2 + tileset.spacing) / (tileset.tileGridSize + tileset.spacing)));
				const max = tileset.cWid * tileset.cHei;
				tileset.enumTags = tileset.enumTags.map((tag) => ({ ...tag, tileIds: tag.tileIds.filter((id) => id < max) })).filter((tag) => tag.tileIds.length);
				tileset.customData = tileset.customData.filter((item) => item.tileId < max);
				tileset.tileColliders = tileset.tileColliders?.filter((item) => item.tileId < max);
				tileset.tileFlips = tileset.tileFlips?.filter((item) => item.tileId < max);
				tileset.tileWarps = tileset.tileWarps?.filter((item) => item.tileId < max);
				for (const group of project.autoRuleGroups) if (group.tilesetDefUid === tileset.uid)
					for (const rule of group.rules) rule.tileIds = rule.tileIds.filter((id) => id < max);
				for (const level of project.levels) for (const layer of level.layers) if (layer.tilesetDefUid === tileset.uid)
					layer.gridTiles = layer.gridTiles.filter((tile) => tile.t < max).map((tile) => ({ ...tile, src: tileIdToSrc(tileset, tile.t) }));
				recomputeAllAutoTilesAllLevels(project);
			});
			invalidateImage(oldUrl);
			invalidateImage(nextUrl);
			editor.redraw();
		} catch (error) {
			editor.status = `Image replacement failed: ${(error as Error).message}`;
		} finally {
			replacing = false;
		}
	}

	function deleteTileset(tileset: SvTileset) {
		const project = editor.project;
		if (!project) return;
		const replacement = project.tilesets.find((item) => item.uid === replacementUid);
		const replacementAction = replacement ? `moved to "${replacement.identifier}"` : 'cleared';
		if (!confirm(`Delete "${tileset.identifier}"? ${usageCount} definition reference(s) will be ${replacementAction}.`)) return;
		const oldUrl = tilesetImageUrl(projectDir, tileset.relPath);
		editor.commit('Delete tileset', () => {
			const nextUid = replacement?.uid ?? null;
			const max = replacement ? replacement.cWid * replacement.cHei : 0;
			const affectedLayers = new Set(project.layers.filter((layer) => layer.tilesetDefUid === tileset.uid).map((layer) => layer.uid));
			for (const layer of project.layers) if (layer.tilesetDefUid === tileset.uid) layer.tilesetDefUid = nextUid;
			for (const level of project.levels) for (const layer of level.layers) {
				if (layer.tilesetDefUid === tileset.uid) layer.tilesetDefUid = nextUid;
				if (!affectedLayers.has(layer.layerDefUid)) continue;
				if (replacement) {
					layer.gridTiles = layer.gridTiles
						.filter((tile) => tile.t < max)
						.map((tile) => ({ ...tile, src: tileIdToSrc(replacement, tile.t) }));
				} else {
					layer.gridTiles = [];
				}
			}
			for (const group of project.autoRuleGroups) if (group.tilesetDefUid === tileset.uid) {
				group.tilesetDefUid = nextUid;
				if (replacement) for (const rule of group.rules) rule.tileIds = rule.tileIds.filter((id) => id < max);
			}
			for (const preset of project.autoRulePresets ?? []) if (preset.tilesetDefUid === tileset.uid) preset.tilesetDefUid = nextUid;
			for (const item of project.enums) for (const value of item.values) {
				if (value.tile?.tilesetUid !== tileset.uid) continue;
				value.tile = replacement ? { ...value.tile, tilesetUid: replacement.uid } : null;
			}
			project.tilesets = project.tilesets.filter((item) => item.uid !== tileset.uid);
			recomputeAllAutoTilesAllLevels(project);
		});
		invalidateImage(oldUrl);
		replacementUid = null;
		editor.redraw();
	}

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
		let frame = 0;
		const ro = new ResizeObserver((es) => {
			const width = es[0].contentRect.width;
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				wrapW = width;
				fit();
			});
		});
		ro.observe(wrap);
		return () => {
			cancelAnimationFrame(frame);
			ro.disconnect();
		};
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
	{#if tileset}
		<div class="manage">
			<input aria-label="Tileset name" value={tileset.identifier} onchange={(event) => renameTileset(tileset, event.currentTarget.value)} />
			<button disabled={replacing} onclick={() => void replaceImage(tileset)}>{replacing ? 'Loading…' : 'Replace image'}</button>
			<select aria-label="Replacement tileset" value={replacementUid ?? ''} onchange={(event) => (replacementUid = event.currentTarget.value ? +event.currentTarget.value : null)}>
				<option value="">Delete references</option>
				{#each alternatives as item (item.uid)}<option value={item.uid}>Replace with {item.identifier}</option>{/each}
			</select>
			<button class="delete" onclick={() => deleteTileset(tileset)}>Delete ({usageCount} refs)</button>
		</div>
	{/if}
	<div class="wrap" bind:this={wrap}>
		{#if tileset}
			<canvas
				bind:this={canvasEl}
				onpointerdown={onDown}
				onpointermove={onMove}
				onpointerup={onUp}
				onpointercancel={onUp}
				onlostpointercapture={onUp}
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
	.manage { display: grid; grid-template-columns: 1fr auto; gap: 4px; margin-bottom: 7px; }
	.manage input, .manage select, .manage button {
		min-width: 0; padding: 4px 6px; color: var(--text); background: var(--bg);
		border: 1px solid var(--border); border-radius: 4px; font: inherit;
	}
	.manage button { cursor: pointer; }
	.manage button:disabled { opacity: 0.5; cursor: default; }
	.manage .delete:hover { color: #ff8787; }
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
