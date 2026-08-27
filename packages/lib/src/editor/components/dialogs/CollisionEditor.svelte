<script lang="ts">
	/**
	 * Per-tile collider editor: shape (full-cell `rect` or pixel-perfect `pixel` trimesh), sensor flag,
	 * and collision layer. Runtime reads `SvTileset.tileColliders` + `SvLevelProject.collisionLayers`
	 * (editable here, incl. the collision matrix) into Rapier groups (see `format/collisionLayers`).
	 */
	import { SvelteSet } from 'svelte/reactivity';
	import { editor } from '../../state/editorStore.svelte';
	import { ensureImage, getImage, tilesetImageUrl } from '../../render/images';
	import type { SvCollisionLayer, TileColliderShape } from '../../../format/types';
	import {
		cloneDefaultLayers,
		collisionTargetsFor,
		DEFAULT_LAYER_ID,
		MAX_COLLISION_LAYERS,
		PROTECTED_LAYER_IDS,
		DEFAULT_LAYER_COLOR
	} from '../../../format/collisionLayers';
	import Dialog from './Dialog.svelte';
	import { tooltip } from '../common/tooltip';
	import IconSquare from '@tabler/icons-svelte/icons/square';
	import IconShape from '@tabler/icons-svelte/icons/shape';
	import IconEraser from '@tabler/icons-svelte/icons/eraser';
	import IconWaveSine from '@tabler/icons-svelte/icons/wave-sine';
	import IconStack2 from '@tabler/icons-svelte/icons/stack-2';
	import IconPlus from '@tabler/icons-svelte/icons/plus';
	import IconTrash from '@tabler/icons-svelte/icons/trash';
	import ColorInput from '../common/ColorInput.svelte';

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

	type Brush = TileColliderShape | 'erase';
	let brush = $state<Brush>('rect');
	let sensor = $state(false);
	let group = $state<string>(DEFAULT_LAYER_ID);

	const RECT_COLOR = '#69db7c';
	const PIXEL_COLOR = '#da77f2';
	const SENSOR_COLOR = '#4dd2ff';

	const NEW_LAYER_COLORS = [
		'#ff6b6b',
		'#4dabf7',
		'#51cf66',
		'#ffd43b',
		'#cc5de8',
		'#ff922b',
		'#20c997',
		'#f783ac'
	];

	/** Project collision layers, falling back to the seeded defaults for files that predate them. */
	const layers = $derived<SvCollisionLayer[]>(project?.collisionLayers ?? cloneDefaultLayers());
	const layerColor = $derived(new Map(layers.map((l) => [l.id, l.color])));
	const activeLayer = $derived(layers.find((l) => l.id === group));

	// `collides(a,b)` is symmetric — true if either side lists the other, mirroring the runtime.
	const layerIds = $derived(layers.map((l) => l.id));
	const targets = $derived(new Map(layers.map((l) => [l.id, collisionTargetsFor(l, layerIds)])));
	function collides(aId: string, bId: string): boolean {
		return Boolean(targets.get(aId)?.has(bId) || targets.get(bId)?.has(aId));
	}

	/** Pick a readable badge ring (dark on light layers, light on dark) from the layer color. */
	function ringFor(hex: string): string {
		const m = /^#?([0-9a-f]{6})$/i.exec(hex);
		if (!m) return '#0d0b18';
		const n = parseInt(m[1], 16);
		const r = (n >> 16) & 255;
		const g = (n >> 8) & 255;
		const b = n & 255;
		const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		return lum > 0.6 ? '#0d0b18' : '#cdd4a5';
	}

	const counts = $derived.by(() => {
		const list = tileset?.tileColliders ?? [];
		const byGroup: Record<string, number> = {};
		for (const l of layers) byGroup[l.id] = 0;
		for (const c of list) {
			const g = c.group ?? DEFAULT_LAYER_ID;
			byGroup[g] = (byGroup[g] ?? 0) + 1;
		}
		return {
			rect: list.filter((c) => c.shape === 'rect').length,
			pixel: list.filter((c) => c.shape === 'pixel').length,
			sensor: list.filter((c) => c.sensor).length,
			byGroup
		};
	});

	/** Ensure `project.collisionLayers` is a real array before mutating it. */
	function ensureLayers(): SvCollisionLayer[] {
		if (!project) return [];
		if (!project.collisionLayers || project.collisionLayers.length === 0) {
			project.collisionLayers = cloneDefaultLayers();
		}
		return project.collisionLayers;
	}

	function uniqueLayerId(base: string): string {
		const list = ensureLayers();
		let id = base;
		let n = 1;
		while (list.some((l) => l.id === id)) id = `${base}_${n++}`;
		return id;
	}

	/** Make every layer's collision matrix row explicit (resolving the legacy fallback) so toggles
	 * and deletes operate on real data instead of an implicit rule. Idempotent. */
	function materializeMatrix(list: SvCollisionLayer[]): void {
		const ids = list.map((l) => l.id);
		for (const l of list) {
			if (!l.collidesWith) l.collidesWith = [...collisionTargetsFor(l, ids)];
		}
	}

	function addLayer() {
		if (!project || layers.length >= MAX_COLLISION_LAYERS) return;
		let id = DEFAULT_LAYER_ID;
		editor.commit('Add collision layer', () => {
			const list = ensureLayers();
			materializeMatrix(list);
			id = uniqueLayerId('LAYER');
			const color = NEW_LAYER_COLORS[(list.length - 1) % NEW_LAYER_COLORS.length] ?? '#adb5bd';
			// New layers collide with DEFAULT and themselves; keep the matrix symmetric by adding the
			// new id to DEFAULT's row too.
			list.push({
				id,
				name: `Layer ${list.length + 1}`,
				color,
				collidesWith: [DEFAULT_LAYER_ID, id]
			});
			const def = list.find((l) => l.id === DEFAULT_LAYER_ID);
			if (def && def.collidesWith && !def.collidesWith.includes(id)) def.collidesWith.push(id);
		});
		group = id; // select the new layer as the active brush
	}

	/** Toggle whether two layers collide, keeping both matrix rows symmetric. */
	function toggleCollision(aId: string, bId: string) {
		if (!project) return;
		const on = collides(aId, bId);
		editor.commit(on ? 'Disable layer collision' : 'Enable layer collision', () => {
			const list = ensureLayers();
			materializeMatrix(list);
			const a = list.find((l) => l.id === aId);
			const b = list.find((l) => l.id === bId);
			if (!a?.collidesWith || !b?.collidesWith) return;
			if (on) {
				a.collidesWith = a.collidesWith.filter((x) => x !== bId);
				if (aId !== bId) b.collidesWith = b.collidesWith.filter((x) => x !== aId);
			} else {
				if (!a.collidesWith.includes(bId)) a.collidesWith.push(bId);
				if (aId !== bId && !b.collidesWith.includes(aId)) b.collidesWith.push(aId);
			}
		});
	}

	function renameLayer(id: string, name: string) {
		const next = name.trim();
		if (!project || !next) return;
		editor.commit('Rename collision layer', () => {
			const l = project.collisionLayers?.find((x) => x.id === id);
			if (l) l.name = next;
		});
	}

	function recolorLayer(id: string, color: string) {
		if (!project) return;
		editor.commit('Recolor collision layer', () => {
			const l = project.collisionLayers?.find((x) => x.id === id);
			if (l) l.color = color;
		});
	}

	function deleteLayer(id: string) {
		if (!project || PROTECTED_LAYER_IDS.has(id)) return;
		editor.commit('Delete collision layer', () => {
			project.collisionLayers = (project.collisionLayers ?? []).filter((l) => l.id !== id);
			// Drop the deleted layer from every other layer's collision-matrix row.
			for (const l of project.collisionLayers) {
				if (l.collidesWith) l.collidesWith = l.collidesWith.filter((x) => x !== id);
			}
			// Reassign any tile colliders that referenced the removed layer back to DEFAULT.
			for (const ts of project.tilesets) {
				for (const c of ts.tileColliders ?? []) {
					if (c.group === id) c.group = DEFAULT_LAYER_ID;
				}
			}
		});
		if (group === id) group = DEFAULT_LAYER_ID;
	}

	let canvasEl = $state<HTMLCanvasElement>();
	const DISPLAY_W = 460;

	const scale = $derived(
		tileset ? Math.max(0.25, Math.min(3, DISPLAY_W / Math.max(1, tileset.pxWid))) : 1
	);
	const stride = $derived(tileset ? tileset.tileGridSize + tileset.spacing : 1);

	// Opaque-pixel sampling for the pixel-shape silhouette preview.
	let maskUrl = '';
	let maskData: Uint8ClampedArray | null = null;
	let maskW = 0;

	function ensureMask(img: HTMLImageElement, url: string) {
		if (maskUrl === url && maskData) return;
		const c = document.createElement('canvas');
		c.width = img.naturalWidth;
		c.height = img.naturalHeight;
		const cx = c.getContext('2d');
		if (!cx) return;
		cx.drawImage(img, 0, 0);
		try {
			maskData = cx.getImageData(0, 0, c.width, c.height).data;
			maskW = c.width;
			maskUrl = url;
		} catch {
			maskData = null;
		}
	}

	function alphaAt(x: number, y: number): number {
		if (!maskData) return 0;
		return maskData[(y * maskW + x) * 4 + 3] ?? 0;
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
		if (img) {
			ctx.drawImage(img, 0, 0, cssW, cssH);
			ensureMask(img, url);
		} else {
			ctx.fillStyle = '#000';
			ctx.fillRect(0, 0, cssW, cssH);
		}

		const grid = tileset.tileGridSize;
		const gridCss = grid * scale;
		const px = scale; // one source pixel in css units

		for (const c of tileset.tileColliders ?? []) {
			const col = c.tileId % tileset.cWid;
			const row = Math.floor(c.tileId / tileset.cWid);
			const sx = tileset.padding + col * stride;
			const sy = tileset.padding + row * stride;
			const x = sx * scale;
			const y = sy * scale;
			const color = c.shape === 'rect' ? RECT_COLOR : PIXEL_COLOR;

			if (c.shape === 'pixel' && maskData) {
				// Tint the actual opaque pixels so the baked silhouette is visible.
				ctx.fillStyle = color;
				ctx.globalAlpha = 0.5;
				for (let yy = 0; yy < grid; yy++) {
					for (let xx = 0; xx < grid; xx++) {
						if (alphaAt(sx + xx, sy + yy) > 0) {
							ctx.fillRect(x + xx * px, y + yy * px, Math.ceil(px), Math.ceil(px));
						}
					}
				}
				ctx.globalAlpha = 1;
			} else {
				ctx.fillStyle = color;
				ctx.globalAlpha = 0.32;
				ctx.fillRect(x, y, gridCss, gridCss);
				ctx.globalAlpha = 1;
			}

			ctx.strokeStyle = color;
			ctx.lineWidth = 2;
			ctx.setLineDash([]);
			ctx.strokeRect(x + 1, y + 1, gridCss - 2, gridCss - 2);

			if (c.sensor) {
				ctx.strokeStyle = SENSOR_COLOR;
				ctx.lineWidth = 1.5;
				ctx.setLineDash([3, 2]);
				ctx.strokeRect(x + 2.5, y + 2.5, gridCss - 5, gridCss - 5);
				ctx.setLineDash([]);
			}

			// Collision-layer badge: a small swatch in the tile's top-right corner.
			const swatch = layerColor.get(c.group ?? DEFAULT_LAYER_ID) ?? DEFAULT_LAYER_COLOR;
			const badge = Math.max(5, Math.min(12, gridCss * 0.34));
			const bx = x + gridCss - badge - 1.5;
			const by = y + 1.5;
			ctx.fillStyle = swatch;
			ctx.fillRect(bx, by, badge, badge);
			ctx.strokeStyle = ringFor(swatch);
			ctx.lineWidth = 1;
			ctx.strokeRect(bx + 0.5, by + 0.5, badge - 1, badge - 1);
		}

		// Grid lines.
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
			brush,
			sensor,
			group,
			layers,
			tileset?.tileColliders?.length
		];
		draw();
	});

	let painting = $state(false);
	// Stroke-local dedup so each tile is applied at most once per drag (not read reactively).
	let touched = new SvelteSet<number>();

	function tileIdFromEvent(e: PointerEvent): number | null {
		if (!tileset || !canvasEl) return null;
		const rect = canvasEl.getBoundingClientRect();
		const px = (e.clientX - rect.left) / scale - tileset.padding;
		const py = (e.clientY - rect.top) / scale - tileset.padding;
		const col = Math.floor(px / stride);
		const row = Math.floor(py / stride);
		if (col < 0 || row < 0 || col >= tileset.cWid || row >= tileset.cHei) return null;
		// Ignore clicks landing in the inter-tile spacing gap.
		if (px - col * stride >= tileset.tileGridSize || py - row * stride >= tileset.tileGridSize)
			return null;
		return row * tileset.cWid + col;
	}

	function applyTile(id: number) {
		if (!tileset || touched.has(id)) return;
		touched.add(id);
		if (brush === 'erase') {
			if (tileset.tileColliders?.some((c) => c.tileId === id)) {
				tileset.tileColliders = tileset.tileColliders.filter((c) => c.tileId !== id);
			}
		} else {
			const list = (tileset.tileColliders ??= []);
			const existing = list.find((c) => c.tileId === id);
			if (existing) {
				existing.shape = brush;
				existing.sensor = sensor;
				existing.group = group;
			} else {
				list.push({ tileId: id, shape: brush, sensor, group });
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
		editor.beginStroke(brush === 'erase' ? 'Clear tile collider' : 'Set tile collider');
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

<Dialog title="Tile colliders" {onclose} width={620}>
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

			<div class="field">
				<span class="lbl">Brush</span>
				<div class="brushes">
					<button
						class="brush"
						class:active={brush === 'rect'}
						style="--c:{RECT_COLOR}"
						use:tooltip={'Full-cell box collider'}
						onclick={() => (brush = 'rect')}
					>
						<IconSquare size={14} /> Rect
					</button>
					<button
						class="brush"
						class:active={brush === 'pixel'}
						style="--c:{PIXEL_COLOR}"
						use:tooltip={'Pixel-perfect collider (trimesh baked at build time)'}
						onclick={() => (brush = 'pixel')}
					>
						<IconShape size={14} /> Pixel
					</button>
					<button
						class="brush"
						class:active={brush === 'erase'}
						use:tooltip={'Remove the collider from a tile'}
						onclick={() => (brush = 'erase')}
					>
						<IconEraser size={14} /> Erase
					</button>
				</div>
			</div>

			<label class="field sensor" class:disabled={brush === 'erase'}>
				<span class="lbl">Sensor</span>
				<button
					class="toggle"
					class:on={sensor}
					disabled={brush === 'erase'}
					use:tooltip={'Sensor colliders report overlaps but never push back'}
					onclick={() => (sensor = !sensor)}
				>
					<IconWaveSine size={14} />
					{sensor ? 'On' : 'Off'}
				</button>
			</label>
		</div>

		<div class="field layer" class:disabled={brush === 'erase'}>
			<span class="lbl"><IconStack2 size={11} /> Collision layer</span>
			<div class="brushes layer-chips">
				{#each layers as l (l.id)}
					<button
						class="brush"
						class:active={group === l.id}
						disabled={brush === 'erase'}
						style="--c:{l.color}"
						use:tooltip={`Paint colliders on the ${l.name} layer (id: ${l.id})`}
						onclick={() => (group = l.id)}
					>
						<i class="dot" style="background:{l.color}; border-color:{ringFor(l.color)}"></i>
						{l.name}
						<span class="chip-count">{counts.byGroup[l.id] ?? 0}</span>
					</button>
				{/each}
				<button
					class="brush add"
					disabled={layers.length >= MAX_COLLISION_LAYERS}
					use:tooltip={layers.length >= MAX_COLLISION_LAYERS
						? `Maximum of ${MAX_COLLISION_LAYERS} layers reached`
						: 'Add a new collision layer'}
					onclick={addLayer}
				>
					<IconPlus size={14} />
				</button>
			</div>
		</div>

		{#if activeLayer}
			<div class="layer-edit">
				<span class="lbl">Edit layer</span>
				<span class="color" use:tooltip={'Layer color'}>
					<ColorInput
						value={activeLayer.color}
						label="Layer colour"
						onchange={(c) => recolorLayer(activeLayer.id, c)}
					/>
				</span>
				<input
					class="text name"
					value={activeLayer.name}
					placeholder="Layer name"
					onchange={(e) => renameLayer(activeLayer.id, e.currentTarget.value)}
				/>
				<code class="layer-id" use:tooltip={'Stable layer id referenced by tile colliders'}>
					{activeLayer.id}
				</code>
				<button
					class="btn danger"
					disabled={PROTECTED_LAYER_IDS.has(activeLayer.id)}
					use:tooltip={PROTECTED_LAYER_IDS.has(activeLayer.id)
						? 'Required layer: Default is the fallback for unknown layers; White/Black are used by the player. Cannot be deleted (you can still rename or recolor it).'
						: 'Delete this layer (its tiles fall back to Default)'}
					onclick={() => deleteLayer(activeLayer.id)}
				>
					<IconTrash size={13} /> Delete
				</button>
			</div>
		{/if}

		{#if layers.length > 1}
			<div class="field matrix-field">
				<span class="lbl">Collision matrix — which layers physically collide</span>
				<table class="matrix">
					<thead>
						<tr>
							<th></th>
							{#each layers as col (col.id)}
								<th use:tooltip={col.name}>
									<i class="dot" style="background:{col.color}; border-color:{ringFor(col.color)}"
									></i>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each layers as row (row.id)}
							<tr>
								<th class="rowhead">
									<i class="dot" style="background:{row.color}; border-color:{ringFor(row.color)}"
									></i>
									<span class="rname">{row.name}</span>
								</th>
								{#each layers as col (col.id)}
									<td>
										<button
											class="cell"
											class:on={collides(row.id, col.id)}
											class:diag={row.id === col.id}
											aria-pressed={collides(row.id, col.id)}
											aria-label={`${row.name} ${collides(row.id, col.id) ? 'collides with' : 'passes through'} ${col.name}`}
											use:tooltip={`${row.name} ↔ ${col.name}: ${
												collides(row.id, col.id) ? 'collide' : 'pass through'
											}`}
											onclick={() => toggleCollision(row.id, col.id)}
										></button>
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<div class="canvas-wrap">
			<canvas
				bind:this={canvasEl}
				{onpointerdown}
				{onpointermove}
				{onpointerup}
				onpointercancel={onpointerup}
			></canvas>
		</div>

		<div class="legend">
			<span><i class="sw" style="background:{RECT_COLOR}"></i>Rect {counts.rect}</span>
			<span><i class="sw" style="background:{PIXEL_COLOR}"></i>Pixel {counts.pixel}</span>
			<span><i class="sw dash" style="border-color:{SENSOR_COLOR}"></i>Sensor {counts.sensor}</span>
			<span class="sep"></span>
			{#each layers as l (l.id)}
				<span>
					<i class="sw" style="background:{l.color}; box-shadow: inset 0 0 0 1px {ringFor(l.color)}"
					></i>{l.name}
					{counts.byGroup[l.id] ?? 0}
				</span>
			{/each}
		</div>
		<p class="hint">
			Click or drag tiles to apply the <b>{brush}</b> brush on the
			<b>{activeLayer?.name ?? group}</b> layer. The corner swatch on each tile shows its collision layer.
			Spike-tagged tiles are deadly at runtime; tag them in the tileset tag editor.
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
	.field.layer {
		margin-bottom: 8px;
	}
	.field.disabled {
		opacity: 0.5;
	}
	.lbl {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--muted);
		font-size: 11px;
	}
	.dot {
		width: 11px;
		height: 11px;
		border-radius: 3px;
		border: 1px solid;
		display: inline-block;
	}
	.text {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 4px 6px;
		font: inherit;
	}
	.brushes {
		display: flex;
		gap: 5px;
	}
	.layer-chips {
		flex-wrap: wrap;
	}
	.brush {
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
	.brush.active {
		border-color: var(--c, var(--accent));
		background: color-mix(in srgb, var(--c, var(--accent)) 22%, transparent);
	}
	.brush.add {
		padding: 5px 8px;
	}
	.brush:disabled {
		cursor: default;
	}
	.chip-count {
		color: var(--muted);
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.layer-edit {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 10px;
	}
	.layer-edit .lbl {
		flex: 0 0 auto;
	}
	.layer-edit .color {
		width: 28px;
		height: 26px;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg);
		cursor: pointer;
	}
	.layer-edit .name {
		width: 140px;
	}
	.layer-id {
		color: var(--muted);
		font-size: 11px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		padding: 2px 6px;
	}
	.matrix-field {
		margin-bottom: 10px;
	}
	.matrix {
		border-collapse: collapse;
		font-size: 11px;
	}
	.matrix th,
	.matrix td {
		padding: 2px;
		text-align: center;
	}
	.matrix .rowhead {
		text-align: right;
		padding-right: 8px;
		white-space: nowrap;
		font-weight: 400;
		color: var(--muted);
	}
	.matrix .rowhead .dot {
		margin-right: 5px;
		vertical-align: middle;
	}
	.matrix .rname {
		vertical-align: middle;
	}
	.cell {
		display: block;
		width: 20px;
		height: 20px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--bg);
		cursor: pointer;
		padding: 0;
	}
	.cell:hover {
		border-color: var(--accent);
	}
	.cell.on {
		background: var(--accent);
		border-color: var(--accent);
	}
	.cell.diag:not(.on) {
		background: var(--panel-2);
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
	.toggle:disabled {
		cursor: default;
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
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		margin-top: 8px;
		color: var(--muted);
		font-size: 11px;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.legend .sep {
		width: 1px;
		height: 14px;
		background: var(--border);
	}
	.sw {
		width: 11px;
		height: 11px;
		border-radius: 3px;
		display: inline-block;
	}
	.sw.dash {
		background: transparent;
		border: 1.5px dashed;
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
	.btn.danger {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
	}
	.btn.danger:not(:disabled):hover {
		border-color: #ff6b6b;
		background: color-mix(in srgb, #ff6b6b 18%, transparent);
		color: #ff8787;
	}
	.btn:disabled {
		cursor: default;
		opacity: 0.5;
	}
</style>
