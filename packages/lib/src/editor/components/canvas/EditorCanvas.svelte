<script lang="ts">
	/**
	 * The 2D editing viewport. Renders the whole world to a `<canvas>`; clicking any level makes it
	 * current for that edit. Coords: screen px -> world px -> level-local px -> cell. Canvas is
	 * Y-DOWN (LDtk-style), the same orientation the runtime uses, so nothing here mirrors the level.
	 */
	import { onMount, untrack } from 'svelte';
	import { editor } from '../../state/editorStore.svelte';
	import { ensureImage, tilesetImageUrl } from '../../render/images';
	import {
		getLayerDef,
		getTileset,
		type SvEntityInstance,
		type SvLayerInstance,
		type SvLevel,
		type SvTile,
		type SvTileset
	} from '../../../format/types';
	import { getEntityType } from '../../../format/entities';
	import {
		cellIdx,
		eraseGridTile,
		findTileIndex,
		floodFillIdGrid,
		getIdGridCell,
		inBounds,
		recomputeAutoTilesAffectedBy,
		setGridTile,
		setIdGridCell
	} from '../../state/ops';
	import { makeEntity } from '../../state/factory';
	import { showTip, type Tip } from '../common/tooltip';

	let containerEl: HTMLDivElement;
	let canvasEl: HTMLCanvasElement;
	let ctx: CanvasRenderingContext2D | null = null;
	let cssW = $state(1);
	let cssH = $state(1);
	let dpr = 1;

	let hover = $state<{ cx: number; cy: number } | null>(null);
	let panning = false;
	let panStart = { x: 0, y: 0, camX: 0, camY: 0 };
	let painting = false;
	let lastCell: { cx: number; cy: number } | null = null;
	let spaceDown = false;
	let rectDrag = $state<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
	let movingEntities = false;
	let moveStartWorld = { x: 0, y: 0 };
	let moveOrigins = new Map<string, [number, number]>();
	let eraseButton = false;

	// Move knob: drag a whole level (its tiles/entities ride along, being level-relative).
	let movingLevel = $state(false);
	let levelMoveStroke = false;
	let levelMove = { uid: -1, worldX: 0, worldY: 0 };

	type ResizeEdge = 'left' | 'right' | 'top' | 'bottom';
	type AddEdge = 'add-left' | 'add-right' | 'add-top' | 'add-bottom';
	// 'move' relocates; 'add-*' spawns a neighbour; the rest resize an edge.
	type HandleId = ResizeEdge | 'move' | AddEdge;
	type LevelHandleHit = { level: SvLevel; edge: HandleId; x: number; y: number };
	let resizing = $state<{
		edge: ResizeEdge;
		levelUid: number;
		gs: number;
		startWorld: { x: number; y: number };
		origin: { worldX: number; worldY: number; pxWid: number; pxHei: number };
		deltaCells: number;
	} | null>(null);
	let hoverHandle = $state<LevelHandleHit | null>(null);
	const HANDLE_SIZE = 12; // screen px
	const HANDLE_GAP = 8; // screen px the handle sits beyond the level edge

	const projectDir = $derived(
		editor.projectPath.slice(0, editor.projectPath.lastIndexOf('/')) + '/'
	);

	const screenToWorld = (sx: number, sy: number): [number, number] => {
		const { x, y, zoom } = editor.camera;
		return [(sx - cssW / 2) / zoom + x, (sy - cssH / 2) / zoom + y];
	};

	const worldToLocal = (level: SvLevel, wx: number, wy: number): [number, number] => [
		wx - level.worldX,
		wy - level.worldY
	];

	const worldToScreen = (wx: number, wy: number): [number, number] => {
		const { x, y, zoom } = editor.camera;
		return [(wx - x) * zoom + cssW / 2, (wy - y) * zoom + cssH / 2];
	};

	/** A level's handles in screen (CSS) px: each edge resizer plus a move knob beside it. */
	function levelHandles(level: SvLevel): Array<{ edge: HandleId; x: number; y: number }> {
		const [lx, ty] = worldToScreen(level.worldX, level.worldY);
		const [rx, by] = worldToScreen(level.worldX + level.pxWid, level.worldY + level.pxHei);
		const midX = (lx + rx) / 2;
		const midY = (ty + by) / 2;
		const step = HANDLE_SIZE + 6; // move knob sits just alongside its resizer
		return [
			{ edge: 'left', x: lx - HANDLE_GAP, y: midY },
			{ edge: 'right', x: rx + HANDLE_GAP, y: midY },
			{ edge: 'top', x: midX, y: ty - HANDLE_GAP },
			{ edge: 'bottom', x: midX, y: by + HANDLE_GAP },
			{ edge: 'move', x: lx - HANDLE_GAP, y: midY - step },
			{ edge: 'move', x: rx + HANDLE_GAP, y: midY - step },
			{ edge: 'move', x: midX + step, y: ty - HANDLE_GAP },
			{ edge: 'move', x: midX + step, y: by + HANDLE_GAP },
			{ edge: 'add-left', x: lx - HANDLE_GAP, y: midY + step },
			{ edge: 'add-right', x: rx + HANDLE_GAP, y: midY + step },
			{ edge: 'add-top', x: midX - step, y: ty - HANDLE_GAP },
			{ edge: 'add-bottom', x: midX - step, y: by + HANDLE_GAP }
		];
	}

	function containsLevel(level: SvLevel, wx: number, wy: number): boolean {
		return (
			wx >= level.worldX &&
			wx < level.worldX + level.pxWid &&
			wy >= level.worldY &&
			wy < level.worldY + level.pxHei
		);
	}

	function levelAtWorld(wx: number, wy: number): SvLevel | null {
		const project = editor.project;
		if (!project) return null;

		const current = editor.currentLevel;
		if (current && containsLevel(current, wx, wy)) return current;

		for (let i = project.levels.length - 1; i >= 0; i--) {
			const level = project.levels[i];
			if (level.uid !== current?.uid && containsLevel(level, wx, wy)) return level;
		}
		return null;
	}

	function edgeAtLevel(
		level: SvLevel,
		sx: number,
		sy: number
	): { edge: HandleId; x: number; y: number } | null {
		const hitRadius = HANDLE_SIZE / 2 + 4;
		for (const handle of levelHandles(level)) {
			if (Math.abs(sx - handle.x) <= hitRadius && Math.abs(sy - handle.y) <= hitRadius) {
				return handle;
			}
		}
		return null;
	}

	let handleTip: Tip | null = null;
	$effect(() => {
		const hit = !resizing && !movingLevel ? hoverHandle : null;
		if (!hit) {
			handleTip?.hide();
			handleTip = null;
			return;
		}
		const rect = canvasEl.getBoundingClientRect();
		const box = new DOMRect(
			rect.left + hit.x - HANDLE_SIZE / 2,
			rect.top + hit.y - HANDLE_SIZE / 2,
			HANDLE_SIZE,
			HANDLE_SIZE
		);
		const text = HANDLE_TIPS[hit.edge];
		if (handleTip) handleTip.update(text, box);
		else handleTip = showTip(text, box);
	});

	const HANDLE_TIPS: Record<HandleId, string> = {
		move: 'Drag to move level',
		left: 'Drag to resize left edge',
		right: 'Drag to resize right edge',
		top: 'Drag to resize top edge',
		bottom: 'Drag to resize bottom edge',
		'add-left': 'Add level to the left',
		'add-right': 'Add level to the right',
		'add-top': 'Add level above',
		'add-bottom': 'Add level below'
	};

	/** Which level edge handle (if any) the given screen point hits. */
	function handleAt(sx: number, sy: number): LevelHandleHit | null {
		const project = editor.project;
		if (!project) return null;

		const current = editor.currentLevel;
		if (current) {
			const hit = edgeAtLevel(current, sx, sy);
			if (hit) return { level: current, ...hit };
		}

		for (let i = project.levels.length - 1; i >= 0; i--) {
			const level = project.levels[i];
			if (level.uid === current?.uid) continue;
			const hit = edgeAtLevel(level, sx, sy);
			if (hit) return { level, ...hit };
		}
		return null;
	}

	function edgeCursor(edge: HandleId): string {
		if (edge === 'move') return 'grab';
		if (edge.startsWith('add')) return 'pointer';
		return edge === 'left' || edge === 'right' ? 'ew-resize' : 'ns-resize';
	}

	const cursorStyle = $derived.by(() => {
		if (movingLevel) return 'grabbing';
		if (resizing) return edgeCursor(resizing.edge);
		if (hoverHandle) return edgeCursor(hoverHandle.edge);
		return 'crosshair';
	});

	function frameLevel(): void {
		const level = editor.currentLevel;
		if (!level) return;
		const zoom = Math.min(cssW / level.pxWid, cssH / level.pxHei) * 0.85 || 2;
		editor.camera = {
			x: level.worldX + level.pxWid / 2,
			y: level.worldY + level.pxHei / 2,
			zoom: Math.max(0.1, Math.min(64, zoom))
		};
	}

	let rafPending = false;
	function scheduleDraw(): void {
		if (rafPending) return;
		rafPending = true;
		requestAnimationFrame(() => {
			rafPending = false;
			draw();
		});
	}

	function tilesetForLayer(li: SvLayerInstance) {
		return getTileset(editor.project!, li.tilesetDefUid);
	}

	function drawTile(
		ts: SvTileset,
		gs: number,
		t: SvTile,
		originX: number,
		originY: number,
		alpha = 1
	) {
		if (!ctx || !ts) return;
		const url = tilesetImageUrl(projectDir, ts.relPath);
		const img = ensureImage(url, scheduleDraw);
		if (!img) return;
		const dx = originX + t.px[0];
		const dy = originY + t.px[1];
		const fx = (t.f & 1) === 1;
		const fy = (t.f & 2) === 2;
		ctx.save();
		ctx.globalAlpha *= (t.a ?? 1) * alpha;
		ctx.translate(dx + gs / 2, dy + gs / 2);
		ctx.scale(fx ? -1 : 1, fy ? -1 : 1);
		ctx.drawImage(img, t.src[0], t.src[1], ts.tileGridSize, ts.tileGridSize, -gs / 2, -gs / 2, gs, gs);
		ctx.restore();
	}

	/** Draw every auto-tile batch with its own per-group tileset. */
	function drawAutoTiles(li: SvLayerInstance, originX: number, originY: number, alpha = 1) {
		for (const batch of li.autoTiles) {
			const ts = getTileset(editor.project!, batch.tilesetDefUid);
			if (!ts) continue;
			for (const t of batch.tiles) drawTile(ts, li.gridSize, t, originX, originY, alpha);
		}
	}

	function drawIdGrid(li: SvLayerInstance, originX: number, originY: number, alpha: number) {
		if (!ctx) return;
		const colorByName = new Map(
			(editor.project?.autoRuleGroups ?? []).map((g) => [g.name, g.color])
		);
		const gs = li.gridSize;
		ctx.save();
		ctx.globalAlpha *= alpha;
		for (let cy = 0; cy < li.cHei; cy++) {
			for (let cx = 0; cx < li.cWid; cx++) {
				const v = li.idGrid[cy * li.cWid + cx];
				if (!v) continue;
				ctx.fillStyle = colorByName.get(v) ?? '#ffffff';
				ctx.fillRect(originX + cx * gs, originY + cy * gs, gs, gs);
			}
		}
		ctx.restore();
	}

	function fieldNumber(fields: Record<string, unknown>, id: string, fallback: number): number {
		const value = fields[id];
		return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
	}

	function movementRangeEnd(e: SvEntityInstance, gridSize: number): [number, number] | null {
		if (e.type === 'MovingPlatform') {
			const distance = Math.max(0, fieldNumber(e.fields, 'Distance', 4)) * gridSize;
			if (distance === 0) return null;
			const sign = e.fields.Reverse ? -1 : 1;
			if (e.fields.Vertical) return [e.px[0], e.px[1] - sign * distance];
			return [e.px[0] + sign * distance, e.px[1]];
		}

		if (e.type === 'Stomper') {
			const riseHeight = Math.max(0, fieldNumber(e.fields, 'RiseHeight', 4)) * gridSize;
			if (riseHeight === 0) return null;
			return [e.px[0], e.px[1] - riseHeight];
		}

		return null;
	}

	function drawMovementRange(
		e: SvEntityInstance,
		originX: number,
		originY: number,
		color: string,
		z: number,
		gridSize: number
	): void {
		if (!ctx) return;
		const end = movementRangeEnd(e, gridSize);
		if (!end) return;

		const [endLocalX, endLocalY] = end;
		const startX = originX + e.px[0];
		const startY = originY + e.px[1];
		const endX = originX + endLocalX;
		const endY = originY + endLocalY;
		const minX = Math.min(startX, endX);
		const minY = Math.min(startY, endY);
		const maxX = Math.max(startX, endX) + e.width;
		const maxY = Math.max(startY, endY) + e.height;
		const rangeWidth = maxX - minX;
		const rangeHeight = maxY - minY;
		const startCx = startX + e.width / 2;
		const startCy = startY + e.height / 2;
		const endCx = endX + e.width / 2;
		const endCy = endY + e.height / 2;

		ctx.save();
		ctx.fillStyle = color;
		ctx.strokeStyle = color;
		ctx.globalAlpha = 0.08;
		ctx.fillRect(minX, minY, rangeWidth, rangeHeight);
		ctx.globalAlpha = 0.75;
		ctx.lineWidth = Math.max(1 / z, 1.25 / z);
		ctx.setLineDash([4 / z, 3 / z]);
		ctx.strokeRect(minX, minY, rangeWidth, rangeHeight);
		ctx.beginPath();
		ctx.moveTo(startCx, startCy);
		ctx.lineTo(endCx, endCy);
		ctx.stroke();
		ctx.setLineDash([]);
		ctx.globalAlpha = 0.45;
		ctx.strokeRect(endX, endY, e.width, e.height);
		ctx.restore();
	}

	function drawEntities(li: SvLayerInstance, originX: number, originY: number, interactive: boolean) {
		if (!ctx) return;
		const selected = new Set(editor.selectedEntityIids);
		const z = editor.camera.zoom;
		for (const e of li.entities) {
			const def = getEntityType(editor.project, e.type);
			const color = def?.color ?? '#ffffff';
			const x = originX + e.px[0];
			const y = originY + e.px[1];
			ctx.save();
			drawMovementRange(e, originX, originY, color, z, li.gridSize);
			ctx.fillStyle = color;
			ctx.strokeStyle = color;
			ctx.globalAlpha = 0.22;
			ctx.fillRect(x, y, e.width, e.height);
			ctx.globalAlpha = 1;
			ctx.lineWidth = 1 / z;
			ctx.strokeRect(x + 0.5 / z, y + 0.5 / z, e.width - 1 / z, e.height - 1 / z);

			const cx = x + e.width / 2;
			const cy = y + e.height / 2;
			const r = Math.min(e.width, e.height) * 0.3;
			ctx.lineWidth = Math.max(1 / z, 1.5 / z);
			ctx.beginPath();
			switch (def?.renderMode) {
				case 'ellipse':
					ctx.ellipse(cx, cy, e.width * 0.35, e.height * 0.35, 0, 0, Math.PI * 2);
					ctx.stroke();
					break;
				case 'cross':
					ctx.moveTo(cx - r, cy);
					ctx.lineTo(cx + r, cy);
					ctx.moveTo(cx, cy - r);
					ctx.lineTo(cx, cy + r);
					ctx.stroke();
					break;
				default:
					break;
			}

			if (interactive && selected.has(e.iid)) {
				ctx.setLineDash([3 / z, 2 / z]);
				ctx.strokeStyle = '#ffffff';
				ctx.lineWidth = 1.5 / z;
				ctx.strokeRect(x, y, e.width, e.height);
				ctx.setLineDash([]);
			}

			// Label (only when zoomed in enough to be legible).
			if (interactive && z >= 1.5 && def) {
				ctx.globalAlpha = 0.9;
				ctx.font = `${7 / z}px ui-monospace, monospace`;
				ctx.textBaseline = 'top';
				ctx.fillStyle = '#000';
				ctx.fillRect(x, y - 9 / z, ctx.measureText(def.name).width / z + 4 / z, 8 / z);
				ctx.fillStyle = color;
				ctx.fillText(def.name, x + 2 / z, y - 8.5 / z);
			}
			ctx.restore();
		}
	}

	function drawLayer(level: SvLevel, li: SvLayerInstance, isCurrent: boolean) {
		if (!ctx || !li.visible) return;
		const def = getLayerDef(editor.project!, li.layerDefUid);
		if (!def) return;
		const ox = level.worldX + li.pxOffsetX;
		const oy = level.worldY + li.pxOffsetY;
		const isActive = isCurrent && li.layerDefUid === editor.activeLayerUid;
		const dim = isCurrent && editor.dimInactiveLayers && !isActive ? 0.55 : 1;
		const layerAlpha = li.opacity * dim;

		ctx.save();
		ctx.globalAlpha = layerAlpha;
		switch (li.type) {
			case 'IdGrid': {
				// Show rule output if present; overlay id colours when this is the active layer
				// (or when there are no rule tiles to look at).
				drawAutoTiles(li, ox, oy);
				const empty = li.autoTiles.length === 0;
				if (isActive || empty) drawIdGrid(li, ox, oy, empty ? 1 : 0.5);
				break;
			}
			case 'AutoLayer':
				drawAutoTiles(li, ox, oy);
				break;
			case 'Tiles': {
				const ts = tilesetForLayer(li);
				if (ts) for (const t of li.gridTiles) drawTile(ts, li.gridSize, t, ox, oy);
				break;
			}
			case 'Entities':
				drawEntities(li, ox, oy, isCurrent);
				break;
		}
		ctx.restore();
	}

	function drawGrid(level: SvLevel) {
		if (!ctx) return;
		const def = editor.activeLayerDef;
		const gs = def?.gridSize ?? editor.project!.defaultGridSize;
		if (editor.camera.zoom * gs < 4) return;
		const ox = level.worldX;
		const oy = level.worldY;
		ctx.save();
		ctx.strokeStyle = 'rgba(255,255,255,0.08)';
		ctx.lineWidth = 1 / editor.camera.zoom;
		ctx.beginPath();
		for (let x = 0; x <= level.pxWid; x += gs) {
			ctx.moveTo(ox + x, oy);
			ctx.lineTo(ox + x, oy + level.pxHei);
		}
		for (let y = 0; y <= level.pxHei; y += gs) {
			ctx.moveTo(ox, oy + y);
			ctx.lineTo(ox + level.pxWid, oy + y);
		}
		ctx.stroke();
		ctx.restore();
	}

	function drawBrushPreview(level: SvLevel) {
		if (!ctx || !hover) return;
		const def = editor.activeLayerDef;
		const li = editor.activeLayerInstance;
		if (!def || !li) return;
		const gs = li.gridSize;
		const ox = level.worldX + li.pxOffsetX;
		const oy = level.worldY + li.pxOffsetY;
		ctx.save();
		ctx.globalAlpha = 0.6;
		if (editor.tool === 'entity' && editor.selectedEntityType) {
			const ed = getEntityType(editor.project, editor.selectedEntityType);
			if (ed) {
				ctx.strokeStyle = ed.color;
				ctx.lineWidth = 1.5 / editor.camera.zoom;
				ctx.strokeRect(ox + hover.cx * gs, oy + hover.cy * gs, ed.width, ed.height);
			}
		} else if (def.type === 'IdGrid') {
			const col =
				editor.project?.autoRuleGroups?.find((g) => g.name === editor.selectedId)?.color ?? '#fff';
			ctx.fillStyle = col;
			ctx.fillRect(ox + hover.cx * gs, oy + hover.cy * gs, gs, gs);
		} else if (def.type === 'Tiles' && editor.brush.w > 0) {
			const ts = tilesetForLayer(li);
			const bw = editor.brushRandomMode ? 1 : editor.brush.w;
			const bh = editor.brushRandomMode ? 1 : editor.brush.h;
			for (let dy = 0; dy < bh; dy++) {
				for (let dx = 0; dx < bw; dx++) {
					const id = editor.brushRandomMode
						? (editor.brush.ids.find((x) => x >= 0) ?? -1)
						: editor.brush.ids[dy * editor.brush.w + dx];
					if (id < 0 || !ts) continue;
					const t: SvTile = {
						px: [(hover.cx + dx) * gs, (hover.cy + dy) * gs],
						src: [
							ts.padding + (id % ts.cWid) * (ts.tileGridSize + ts.spacing),
							ts.padding + Math.floor(id / ts.cWid) * (ts.tileGridSize + ts.spacing)
						],
						t: id,
						f: editor.brushFlip,
						a: 1
					};
					drawTile(ts, gs, t, ox, oy, 0.8);
				}
			}
		}
		// Hover cell outline.
		ctx.globalAlpha = 1;
		ctx.strokeStyle = 'rgba(255,255,255,0.8)';
		ctx.lineWidth = 1 / editor.camera.zoom;
		ctx.strokeRect(ox + hover.cx * gs, oy + hover.cy * gs, gs, gs);
		ctx.restore();
	}

	function drawRectPreview(level: SvLevel) {
		if (!ctx || !rectDrag) return;
		const li = editor.activeLayerInstance;
		if (!li) return;
		const gs = li.gridSize;
		const ox = level.worldX + li.pxOffsetX;
		const oy = level.worldY + li.pxOffsetY;
		const x0 = Math.min(rectDrag.x0, rectDrag.x1);
		const y0 = Math.min(rectDrag.y0, rectDrag.y1);
		const x1 = Math.max(rectDrag.x0, rectDrag.x1);
		const y1 = Math.max(rectDrag.y0, rectDrag.y1);
		ctx.save();
		ctx.fillStyle = 'rgba(120,180,255,0.25)';
		ctx.strokeStyle = 'rgba(120,180,255,0.9)';
		ctx.lineWidth = 1 / editor.camera.zoom;
		ctx.fillRect(ox + x0 * gs, oy + y0 * gs, (x1 - x0 + 1) * gs, (y1 - y0 + 1) * gs);
		ctx.strokeRect(ox + x0 * gs, oy + y0 * gs, (x1 - x0 + 1) * gs, (y1 - y0 + 1) * gs);
		ctx.restore();
	}

	/** Dashed outline of the level's new bounds while an edge is being dragged (world space). */
	function drawResizePreview(): void {
		if (!ctx || !resizing) return;
		const o = resizing.origin;
		const dPx = resizing.deltaCells * resizing.gs;
		let x = o.worldX;
		let y = o.worldY;
		let w = o.pxWid;
		let h = o.pxHei;
		if (resizing.edge === 'right') {
			w = Math.max(resizing.gs, o.pxWid + dPx);
		} else if (resizing.edge === 'bottom') {
			h = Math.max(resizing.gs, o.pxHei + dPx);
		} else if (resizing.edge === 'left') {
			w = Math.max(resizing.gs, o.pxWid + dPx);
			x = o.worldX - (w - o.pxWid);
		} else {
			h = Math.max(resizing.gs, o.pxHei + dPx);
			y = o.worldY - (h - o.pxHei);
		}
		const z = editor.camera.zoom;
		ctx.save();
		ctx.fillStyle = 'rgba(122,162,255,0.10)';
		ctx.fillRect(x, y, w, h);
		ctx.strokeStyle = '#c7786f';
		ctx.lineWidth = 1.5 / z;
		ctx.setLineDash([4 / z, 3 / z]);
		ctx.strokeRect(x, y, w, h);
		ctx.restore();
	}

	/** A four-way arrow inside the move knob (screen space, CSS px). */
	function drawMoveGlyph(cx: number, cy: number, active: boolean): void {
		if (!ctx) return;
		const a = 4.5;
		const h = 1.8;
		ctx.save();
		ctx.strokeStyle = active ? '#0d0b18' : '#cdd4a5';
		ctx.lineWidth = 1;
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(cx - a, cy);
		ctx.lineTo(cx + a, cy);
		ctx.moveTo(cx, cy - a);
		ctx.lineTo(cx, cy + a);
		ctx.moveTo(cx - a + h, cy - h);
		ctx.lineTo(cx - a, cy);
		ctx.lineTo(cx - a + h, cy + h);
		ctx.moveTo(cx + a - h, cy - h);
		ctx.lineTo(cx + a, cy);
		ctx.lineTo(cx + a - h, cy + h);
		ctx.moveTo(cx - h, cy - a + h);
		ctx.lineTo(cx, cy - a);
		ctx.lineTo(cx + h, cy - a + h);
		ctx.moveTo(cx - h, cy + a - h);
		ctx.lineTo(cx, cy + a);
		ctx.lineTo(cx + h, cy + a - h);
		ctx.stroke();
		ctx.restore();
	}

	/** A plus inside the add-neighbour knob (screen space, CSS px). */
	function drawPlusGlyph(cx: number, cy: number, active: boolean): void {
		if (!ctx) return;
		const a = 4;
		ctx.save();
		ctx.strokeStyle = active ? '#0d0b18' : '#9be8b0';
		ctx.lineWidth = 1.5;
		ctx.lineCap = 'round';
		ctx.beginPath();
		ctx.moveTo(cx - a, cy);
		ctx.lineTo(cx + a, cy);
		ctx.moveTo(cx, cy - a);
		ctx.lineTo(cx, cy + a);
		ctx.stroke();
		ctx.restore();
	}

	/** The handles themselves, drawn in screen space so they stay a constant size. */
	function drawHandles(level: SvLevel, isCurrent: boolean): void {
		if (!ctx) return;
		ctx.save();
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.globalAlpha = isCurrent ? 1 : 0.55;
		for (const handle of levelHandles(level)) {
			const isMove = handle.edge === 'move';
			const isAdd = handle.edge.startsWith('add');
			const active =
				(resizing?.levelUid === level.uid && resizing.edge === handle.edge) ||
				(hoverHandle?.level.uid === level.uid && hoverHandle.edge === handle.edge) ||
				(isMove && movingLevel && levelMove.uid === level.uid);
			ctx.beginPath();
			ctx.rect(handle.x - HANDLE_SIZE / 2, handle.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
			ctx.fillStyle = active ? '#c7786f' : isAdd ? '#1f3b2a' : isMove ? '#2a3358' : '#211d38';
			ctx.strokeStyle = isCurrent || active ? '#c7786f' : 'rgba(255,255,255,0.35)';
			ctx.lineWidth = 1.5;
			ctx.fill();
			ctx.stroke();
			if (isMove) drawMoveGlyph(handle.x, handle.y, active);
			else if (isAdd) drawPlusGlyph(handle.x, handle.y, active);
		}
		ctx.restore();
	}

	function draw(): void {
		if (!ctx || !editor.project) return;
		const project = editor.project;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.clearRect(0, 0, cssW, cssH);
		ctx.fillStyle = project.bgColor ?? '#171426';
		ctx.fillRect(0, 0, cssW, cssH);

		const { x, y, zoom } = editor.camera;
		ctx.translate(cssW / 2, cssH / 2);
		ctx.scale(zoom, zoom);
		ctx.translate(-x, -y);

		const current = editor.currentLevel;
		// Draw non-current levels first (dimmed), then the current one on top.
		for (const level of project.levels) {
			if (level.uid === current?.uid) continue;
			drawLevelChrome(level, false);
			ctx.save();
			ctx.globalAlpha = 0.35;
			for (let i = level.layers.length - 1; i >= 0; i--) drawLayer(level, level.layers[i], false);
			ctx.restore();
			drawHandles(level, false);
		}
		if (current) {
			drawLevelChrome(current, true);
			for (let i = current.layers.length - 1; i >= 0; i--) drawLayer(current, current.layers[i], true);
			if (editor.showGrid) drawGrid(current);
			drawRectPreview(current);
			if (!panning && !movingEntities && !resizing && !movingLevel) drawBrushPreview(current);
			if (resizing) drawResizePreview();
			drawHandles(current, true);
		}
	}

	function drawLevelChrome(level: SvLevel, isCurrent: boolean) {
		if (!ctx) return;
		ctx.save();
		ctx.fillStyle = level.bgColor ?? editor.project!.defaultLevelBgColor ?? '#222';
		ctx.fillRect(level.worldX, level.worldY, level.pxWid, level.pxHei);
		ctx.lineWidth = (isCurrent ? 2 : 1) / editor.camera.zoom;
		ctx.strokeStyle = isCurrent ? '#c7786f' : 'rgba(255,255,255,0.25)';
		ctx.strokeRect(level.worldX, level.worldY, level.pxWid, level.pxHei);
		ctx.restore();
	}

	/** Apply the active paint tool to a single cell during a stroke. */
	function paintCell(cx: number, cy: number): void {
		const project = editor.project;
		const level = editor.currentLevel;
		const li = editor.activeLayerInstance;
		const def = editor.activeLayerDef;
		if (!project || !level || !li || !def || !inBounds(li, cx, cy)) return;

		const erasing = eraseButton || editor.tool === 'eraser';
		if (def.type === 'IdGrid') {
			setIdGridCell(li, cx, cy, erasing ? '' : editor.selectedId);
			recomputeAutoTilesAffectedBy(project, level, li.layerDefUid);
		} else if (def.type === 'Tiles') {
			const ts = tilesetForLayer(li);
			if (erasing) {
				eraseGridTile(li, cx, cy);
			} else if (ts && editor.brushRandomMode) {
				const pool = editor.brush.ids.filter((id) => id >= 0);
				if (pool.length) setGridTile(li, ts, cx, cy, pool[(Math.random() * pool.length) | 0], editor.brushFlip);
			} else if (ts && editor.brush.w > 0) {
				for (let dy = 0; dy < editor.brush.h; dy++) {
					for (let dx = 0; dx < editor.brush.w; dx++) {
						const id = editor.brush.ids[dy * editor.brush.w + dx];
						if (id >= 0) setGridTile(li, ts, cx + dx, cy + dy, id, editor.brushFlip);
					}
				}
			}
		}
	}

	/** Interpolate cells between two points so fast drags don't skip cells. */
	function paintLine(a: { cx: number; cy: number }, b: { cx: number; cy: number }): void {
		let { cx: x0, cy: y0 } = a;
		const { cx: x1, cy: y1 } = b;
		const dx = Math.abs(x1 - x0);
		const dy = Math.abs(y1 - y0);
		const sx = x0 < x1 ? 1 : -1;
		const sy = y0 < y1 ? 1 : -1;
		let err = dx - dy;
		for (;;) {
			paintCell(x0, y0);
			if (x0 === x1 && y0 === y1) break;
			const e2 = 2 * err;
			if (e2 > -dy) {
				err -= dy;
				x0 += sx;
			}
			if (e2 < dx) {
				err += dx;
				y0 += sy;
			}
		}
	}

	function doFloodFill(cx: number, cy: number): void {
		const project = editor.project!;
		const level = editor.currentLevel!;
		const li = editor.activeLayerInstance;
		const def = editor.activeLayerDef;
		if (!li || !def) return;
		const erasing = eraseButton || editor.tool === 'eraser';
		if (def.type === 'IdGrid') {
			editor.commit('Bucket fill', () => {
				floodFillIdGrid(li, cx, cy, erasing ? '' : editor.selectedId);
				recomputeAutoTilesAffectedBy(project, level, li.layerDefUid);
			});
		} else if (def.type === 'Tiles') {
			const ts = tilesetForLayer(li);
			const fillId = editor.brush.w > 0 ? editor.brush.ids[0] : -1;
			if (!ts) return;
			editor.commit('Bucket fill', () => {
				const targetIdx = findTileIndex(li, cx * li.gridSize, cy * li.gridSize);
				const targetId = targetIdx >= 0 ? li.gridTiles[targetIdx].t : -1;
				if (targetId === fillId) return;
				const seen = new Set<number>();
				const stack: Array<[number, number]> = [[cx, cy]];
				while (stack.length) {
					const [px, py] = stack.pop()!;
					if (!inBounds(li, px, py)) continue;
					const key = cellIdx(li, px, py);
					if (seen.has(key)) continue;
					seen.add(key);
					const idx = findTileIndex(li, px * li.gridSize, py * li.gridSize);
					const id = idx >= 0 ? li.gridTiles[idx].t : -1;
					if (id !== targetId) continue;
					if (fillId >= 0) setGridTile(li, ts, px, py, fillId, editor.brushFlip);
					else eraseGridTile(li, px, py);
					stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
				}
			});
		}
	}

	function commitRect(): void {
		if (!rectDrag) return;
		const project = editor.project!;
		const level = editor.currentLevel!;
		const li = editor.activeLayerInstance;
		const def = editor.activeLayerDef;
		const r = rectDrag;
		rectDrag = null;
		if (!li || !def) return;
		const x0 = Math.min(r.x0, r.x1);
		const y0 = Math.min(r.y0, r.y1);
		const x1 = Math.max(r.x0, r.x1);
		const y1 = Math.max(r.y0, r.y1);
		const erasing = eraseButton || editor.tool === 'eraser';
		editor.commit('Rectangle', () => {
			for (let cy = y0; cy <= y1; cy++) {
				for (let cx = x0; cx <= x1; cx++) {
					if (def.type === 'IdGrid') {
						setIdGridCell(li, cx, cy, erasing ? '' : editor.selectedId);
					} else if (def.type === 'Tiles') {
						const ts = tilesetForLayer(li);
						const id = editor.brush.w > 0 ? editor.brush.ids[0] : -1;
						if (erasing || id < 0) eraseGridTile(li, cx, cy);
						else if (ts) setGridTile(li, ts, cx, cy, id, editor.brushFlip);
					}
				}
			}
			if (def.type === 'IdGrid') recomputeAutoTilesAffectedBy(project, level, li.layerDefUid);
		});
	}

	function placeEntity(localX: number, localY: number): void {
		const level = editor.currentLevel;
		if (!level || !editor.selectedEntityType) return;
		// Prefer the active layer if it's an Entities layer, else the front-most one.
		let target =
			editor.activeLayerInstance?.type === 'Entities'
				? editor.activeLayerInstance
				: level.layers.find((l) => l.type === 'Entities');
		if (!target) {
			editor.status = 'No Entities layer to place into';
			return;
		}
		const project = editor.project!;
		if (!getEntityType(project, editor.selectedEntityType)) {
			editor.status = `Unknown entity type ${editor.selectedEntityType}`;
			return;
		}
		const gs = target.gridSize;
		// Snap top-left to the grid.
		const px: [number, number] = [Math.floor(localX / gs) * gs, Math.floor(localY / gs) * gs];
		editor.commit('Place entity', () => {
			const ent = makeEntity(project, editor.selectedEntityType!, px);
			ent.px = [
				Math.max(-target!.pxOffsetX, Math.min(ent.px[0], level.pxWid - target!.pxOffsetX - ent.width)),
				Math.max(-target!.pxOffsetY, Math.min(ent.px[1], level.pxHei - target!.pxOffsetY - ent.height))
			];
			target!.entities.push(ent);
			editor.selectedEntityIids = [ent.iid];
		});
	}

	function activeCellFromEvent(e: PointerEvent): { cx: number; cy: number; lx: number; ly: number } | null {
		const level = editor.currentLevel;
		const li = editor.activeLayerInstance;
		if (!level || !li) return null;
		const rect = canvasEl.getBoundingClientRect();
		const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
		const [lx, ly] = worldToLocal(level, wx - li.pxOffsetX, wy - li.pxOffsetY);
		return { cx: Math.floor(lx / li.gridSize), cy: Math.floor(ly / li.gridSize), lx, ly };
	}

	function onPointerDown(e: PointerEvent) {
		if (!editor.project) return;
		canvasEl.setPointerCapture(e.pointerId);
		const usePan = spaceDown || e.button === 1 || editor.tool === 'pan';
		if (usePan) {
			panning = true;
			panStart = { x: e.clientX, y: e.clientY, camX: editor.camera.x, camY: editor.camera.y };
			return;
		}

		const rect = canvasEl.getBoundingClientRect();
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;

		// Level edge-resize handles take priority over painting (left button only).
		if (e.button === 0) {
			const handle = handleAt(sx, sy);
			if (handle) {
				const { level, edge } = handle;
				if (level.uid !== editor.currentLevelUid) editor.setCurrentLevel(level.uid);
				const [wx, wy] = screenToWorld(sx, sy);
				if (edge === 'add-left' || edge === 'add-right' || edge === 'add-top' || edge === 'add-bottom') {
					editor.addAdjacentLevel(level.uid, edge.slice(4) as ResizeEdge);
					return;
				}
				if (edge === 'move') {
					movingLevel = true;
					levelMoveStroke = false;
					moveStartWorld = { x: wx, y: wy };
					levelMove = { uid: level.uid, worldX: level.worldX, worldY: level.worldY };
					return;
				}
				resizing = {
					edge,
					levelUid: level.uid,
					gs: editor.activeLayerDef?.gridSize ?? editor.project.defaultGridSize,
					startWorld: { x: wx, y: wy },
					origin: {
						worldX: level.worldX,
						worldY: level.worldY,
						pxWid: level.pxWid,
						pxHei: level.pxHei
					},
					deltaCells: 0
				};
				return;
			}
		}

		const [wx, wy] = screenToWorld(sx, sy);
		const level = levelAtWorld(wx, wy);
		if (level && level.uid !== editor.currentLevelUid) editor.setCurrentLevel(level.uid);

		eraseButton = e.button === 2;

		const hit = activeCellFromEvent(e);
		if (!hit) return;
		const { cx, cy, lx, ly } = hit;

		if (editor.tool === 'select') {
			handleSelectDown(e, lx, ly);
			return;
		}
		if (editor.tool === 'entity' && !eraseButton) {
			placeEntity(lx, ly);
			return;
		}
		if (editor.tool === 'picker') {
			pick(cx, cy);
			return;
		}
		if (editor.tool === 'fill') {
			doFloodFill(cx, cy);
			return;
		}
		if (editor.tool === 'rect' || (editor.tool === 'brush' && e.shiftKey)) {
			rectDrag = { x0: cx, y0: cy, x1: cx, y1: cy };
			return;
		}
		// brush / eraser
		editor.beginStroke(eraseButton || editor.tool === 'eraser' ? 'Erase' : 'Paint');
		painting = true;
		lastCell = { cx, cy };
		paintCell(cx, cy);
		editor.touch();
	}

	function onPointerMove(e: PointerEvent) {
		if (!editor.project) return;
		if (panning) {
			editor.camera = {
				...editor.camera,
				x: panStart.camX - (e.clientX - panStart.x) / editor.camera.zoom,
				y: panStart.camY - (e.clientY - panStart.y) / editor.camera.zoom
			};
			return;
		}

		if (resizing) {
			const rect = canvasEl.getBoundingClientRect();
			const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
			const horizontal = resizing.edge === 'left' || resizing.edge === 'right';
			const dWorld = horizontal ? wx - resizing.startWorld.x : wy - resizing.startWorld.y;
			// Dragging the left/top edge outward is a negative world delta, but still an expansion.
			const expandPx = resizing.edge === 'left' || resizing.edge === 'top' ? -dWorld : dWorld;
			const baseSize = horizontal ? resizing.origin.pxWid : resizing.origin.pxHei;
			const minDelta = -(Math.floor(baseSize / resizing.gs) - 1); // keep at least one cell
			const deltaCells = Math.max(minDelta, Math.round(expandPx / resizing.gs));
			resizing = { ...resizing, deltaCells };
			scheduleDraw();
			return;
		}

		if (movingLevel) {
			const level = editor.project.levels.find((l) => l.uid === levelMove.uid);
			if (!level) return;
			// Snap the drag delta to whole grid cells so the level stays grid-aligned.
			const gs = editor.activeLayerDef?.gridSize ?? editor.project.defaultGridSize;
			const dx = Math.round((lastWorld.x - moveStartWorld.x) / gs) * gs;
			const dy = Math.round((lastWorld.y - moveStartWorld.y) / gs) * gs;
			if (dx !== 0 || dy !== 0 || levelMoveStroke) {
				if (!levelMoveStroke) {
					editor.beginStroke('Move level');
					levelMoveStroke = true;
				}
				level.worldX = levelMove.worldX + dx;
				level.worldY = levelMove.worldY + dy;
				editor.touch();
			}
			return;
		}

		const rect = canvasEl.getBoundingClientRect();
		const canHoverHandles = !painting && !movingEntities && !rectDrag;
		hoverHandle = canHoverHandles ? handleAt(e.clientX - rect.left, e.clientY - rect.top) : null;

		const hit = activeCellFromEvent(e);
		if (!hit) return;
		hover = { cx: hit.cx, cy: hit.cy };

		if (movingEntities) {
			dragEntities(hit.lx, hit.ly);
			return;
		}
		if (rectDrag) {
			rectDrag = { ...rectDrag, x1: hit.cx, y1: hit.cy };
			scheduleDraw();
			return;
		}
		if (painting && lastCell) {
			paintLine(lastCell, { cx: hit.cx, cy: hit.cy });
			lastCell = { cx: hit.cx, cy: hit.cy };
			editor.touch();
			return;
		}
		scheduleDraw();
	}

	function onPointerUp(e: PointerEvent) {
		if (resizing) {
			const r = resizing;
			resizing = null;
			if (r.deltaCells !== 0) editor.resizeLevelEdge(r.edge, r.deltaCells, r.gs);
			return;
		}
		if (panning) {
			panning = false;
			return;
		}
		if (movingLevel) {
			movingLevel = false;
			if (levelMoveStroke) {
				levelMoveStroke = false;
				editor.endStroke();
			}
			return;
		}
		if (movingEntities) {
			movingEntities = false;
			editor.endStroke();
			return;
		}
		if (rectDrag) {
			commitRect();
			return;
		}
		if (painting) {
			painting = false;
			lastCell = null;
			editor.endStroke();
		}
		eraseButton = false;
	}

	function cancelPointer() {
		panning = false;
		resizing = null;
		movingLevel = false;
		levelMoveStroke = false;
		movingEntities = false;
		rectDrag = null;
		painting = false;
		lastCell = null;
		eraseButton = false;
		editor.cancelStroke();
		scheduleDraw();
	}

	function onPointerLeave() {
		hover = null;
		hoverHandle = null;
		scheduleDraw();
	}

	function pick(cx: number, cy: number) {
		const li = editor.activeLayerInstance;
		const def = editor.activeLayerDef;
		if (!li || !def || !inBounds(li, cx, cy)) return;
		if (def.type === 'IdGrid') {
			const v = getIdGridCell(li, cx, cy);
			if (v) editor.selectedId = v;
		} else if (def.type === 'Tiles') {
			const idx = findTileIndex(li, cx * li.gridSize, cy * li.gridSize);
			if (idx >= 0) editor.brush = { ids: [li.gridTiles[idx].t], w: 1, h: 1 };
		}
	}

	function handleSelectDown(e: PointerEvent, lx: number, ly: number) {
		const level = editor.currentLevel;
		if (!level) return;
		// Search entity layers front->back for a hit at world-local (lx,ly is active-layer-local;
		// recompute against each entity layer's own offset using the raw world point instead).
		const rect = canvasEl.getBoundingClientRect();
		const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
		const llx = wx - level.worldX;
		const lly = wy - level.worldY;
		let hitIid: string | null = null;
		for (const li of level.layers) {
			if (li.type !== 'Entities' || !li.visible) continue;
			for (let i = li.entities.length - 1; i >= 0; i--) {
				const en = li.entities[i];
				if (
					llx >= en.px[0] + li.pxOffsetX &&
					llx < en.px[0] + li.pxOffsetX + en.width &&
					lly >= en.px[1] + li.pxOffsetY &&
					lly < en.px[1] + li.pxOffsetY + en.height
				) {
					hitIid = en.iid;
					break;
				}
			}
			if (hitIid) break;
		}
		void lx;
		void ly;

		if (!hitIid) {
			if (!e.shiftKey) editor.selectedEntityIids = [];
			scheduleDraw();
			return;
		}
		if (e.shiftKey) {
			editor.selectedEntityIids = editor.selectedEntityIids.includes(hitIid)
				? editor.selectedEntityIids.filter((i) => i !== hitIid)
				: [...editor.selectedEntityIids, hitIid];
		} else if (!editor.selectedEntityIids.includes(hitIid)) {
			editor.selectedEntityIids = [hitIid];
		}
		// Begin move drag.
		movingEntities = true;
		moveStartWorld = { x: wx, y: wy };
		moveOrigins.clear();
		for (const li of level.layers) {
			if (li.type !== 'Entities') continue;
			for (const en of li.entities) {
				if (editor.selectedEntityIids.includes(en.iid)) moveOrigins.set(en.iid, [...en.px]);
			}
		}
		editor.beginStroke('Move entities');
		scheduleDraw();
	}

	function dragEntities(_lx: number, _ly: number) {
		const level = editor.currentLevel;
		if (!level) return;
		// Use the raw world delta so the drag is layer-offset agnostic.
		const rect = canvasEl.getBoundingClientRect();
		void _lx;
		void _ly;
		const gs = editor.activeLayerInstance?.gridSize ?? editor.project!.defaultGridSize;
		for (const li of level.layers) {
			if (li.type !== 'Entities') continue;
			for (const en of li.entities) {
				const origin = moveOrigins.get(en.iid);
				if (!origin) continue;
				const dx = hoverWorldDelta().x;
				const dy = hoverWorldDelta().y;
				en.px = [
					Math.max(-li.pxOffsetX, Math.min(Math.round((origin[0] + dx) / gs) * gs, level.pxWid - li.pxOffsetX - en.width)),
					Math.max(-li.pxOffsetY, Math.min(Math.round((origin[1] + dy) / gs) * gs, level.pxHei - li.pxOffsetY - en.height))
				];
			}
		}
		void rect;
		editor.touch();
	}

	let lastWorld = { x: 0, y: 0 };
	function hoverWorldDelta() {
		return { x: lastWorld.x - moveStartWorld.x, y: lastWorld.y - moveStartWorld.y };
	}

	function onPointerMoveTrackWorld(e: PointerEvent) {
		const rect = canvasEl.getBoundingClientRect();
		const [wx, wy] = screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
		lastWorld = { x: wx, y: wy };
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const rect = canvasEl.getBoundingClientRect();
		const sx = e.clientX - rect.left;
		const sy = e.clientY - rect.top;

		// Ctrl/Cmd + wheel zooms; the browser also synthesises ctrlKey for trackpad
		// pinch gestures, so pinch-to-zoom lands here too. A plain scroll or two-finger
		// trackpad swipe pans instead.
		if (e.ctrlKey || e.metaKey) {
			const [wx, wy] = screenToWorld(sx, sy);
			const factor = Math.exp(-e.deltaY * 0.0015);
			const zoom = Math.max(0.1, Math.min(64, editor.camera.zoom * factor));
			// Keep the world point under the cursor fixed.
			editor.camera = {
				zoom,
				x: wx - (sx - cssW / 2) / zoom,
				y: wy - (sy - cssH / 2) / zoom
			};
			return;
		}

		// Pan: convert the scroll delta from screen px to world px.
		const { x, y, zoom } = editor.camera;
		editor.camera = {
			zoom,
			x: x + e.deltaX / zoom,
			y: y + e.deltaY / zoom
		};
	}

	function onKeyDown(e: KeyboardEvent) {
		if (e.code === 'Space') spaceDown = true;
	}
	function onKeyUp(e: KeyboardEvent) {
		if (e.code === 'Space') spaceDown = false;
	}

	function onCanvasKeyDown(e: KeyboardEvent) {
		const step = (editor.activeLayerInstance?.gridSize ?? editor.project?.defaultGridSize ?? 16) * (e.shiftKey ? 4 : 1);
		if (e.key === 'ArrowLeft') editor.camera = { ...editor.camera, x: editor.camera.x - step };
		else if (e.key === 'ArrowRight') editor.camera = { ...editor.camera, x: editor.camera.x + step };
		else if (e.key === 'ArrowUp') editor.camera = { ...editor.camera, y: editor.camera.y - step };
		else if (e.key === 'ArrowDown') editor.camera = { ...editor.camera, y: editor.camera.y + step };
		else return;
		e.preventDefault();
	}

	onMount(() => {
		ctx = canvasEl.getContext('2d');
		dpr = window.devicePixelRatio || 1;

		let resizeFrame = 0;
		let nextSize: DOMRectReadOnly | undefined;
		const ro = new ResizeObserver((entries) => {
			nextSize = entries[0]?.contentRect;
			if (resizeFrame) return;
			resizeFrame = requestAnimationFrame(() => {
				resizeFrame = 0;
				if (!nextSize) return;
				cssW = Math.max(1, nextSize.width);
				cssH = Math.max(1, nextSize.height);
				dpr = window.devicePixelRatio || 1;
				canvasEl.width = Math.round(cssW * dpr);
				canvasEl.height = Math.round(cssH * dpr);
				scheduleDraw();
			});
		});
		ro.observe(containerEl);

		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		window.addEventListener('blur', cancelPointer);

		// Frame the level once it (and the canvas size) are ready.
		let framed = false;
		const tryFrame = () => {
			if (!framed && editor.currentLevel && cssW > 1) {
				framed = true;
				frameLevel();
			}
		};
		const id = setInterval(tryFrame, 80);
		setTimeout(() => clearInterval(id), 2000);

		return () => {
			ro.disconnect();
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
			window.removeEventListener('blur', cancelPointer);
			if (resizeFrame) cancelAnimationFrame(resizeFrame);
			clearInterval(id);
		};
	});

	// Redraw whenever content / view / selection changes.
	$effect(() => {
		// Touch reactive deps so the effect re-runs on change.
		void editor.revision;
		void editor.camera.x;
		void editor.camera.y;
		void editor.camera.zoom;
		void editor.currentLevelUid;
		void editor.activeLayerUid;
		void editor.showGrid;
		void editor.dimInactiveLayers;
		void editor.selectedEntityIids.length;
		void hover;
		void rectDrag;
		void resizing;
		void movingLevel;
		void hoverHandle;
		void cssW;
		void cssH;
		untrack(() => scheduleDraw());
	});

	export { frameLevel };
</script>

<div
	class="viewport"
	bind:this={containerEl}
	role="application"
	aria-label="Level editing canvas"
>
		<canvas
			bind:this={canvasEl}
			tabindex="0"
			aria-label="Level canvas. Use arrow keys to pan; use toolbar controls to select editing tools."
		style="width:{cssW}px;height:{cssH}px;cursor:{cursorStyle}"
		onpointerdown={onPointerDown}
		onpointermove={(e) => {
			onPointerMoveTrackWorld(e);
			onPointerMove(e);
		}}
			onpointerup={onPointerUp}
			onpointercancel={cancelPointer}
			onlostpointercapture={cancelPointer}
			onpointerleave={onPointerLeave}
			onkeydown={onCanvasKeyDown}
		onwheel={onWheel}
		oncontextmenu={(e) => e.preventDefault()}
	></canvas>
</div>

<style>
	.viewport {
		position: relative;
		width: 100%;
		height: 100%;
		overflow: hidden;
		background: #0d0b18;
	}
	canvas {
		display: block;
		touch-action: none;
		image-rendering: pixelated;
		cursor: crosshair;
	}
</style>
