<script lang="ts">
	/**
	 * Global auto-rule editor. Each group is a self-contained brush (unique name as its id + colour +
	 * tileset + rules); painting its id into any IdGrid layer stamps its rules. Pattern cells (strings):
	 * ''=wildcard, id=require id, '!'+id=forbid id, '*'/'!*'=any-non-empty/empty. Edits go through
	 * `editor.editGroups` (one undo step + re-bake every level).
	 */
	import { editor } from '../../state/editorStore.svelte';
	import { makeAutoRule, makeAutoRuleGroup } from '../../state/factory';
	import { ensureImage, getImage, tilesetImageUrl } from '../../render/images';
	import { ANYTHING } from '../../../format/autoRules';
	import {
		getTileset,
		type SvAutoRule,
		type SvAutoRuleGroup,
		type SvAutoRulePreset
	} from '../../../format/types';
	import Dialog from './Dialog.svelte';
	import PresetApplyDialog from './PresetApplyDialog.svelte';
	import NumberInput from '../common/NumberInput.svelte';
	import { tooltip } from '../common/tooltip';
	import IconPlus from '@tabler/icons-svelte/icons/plus';
	import IconX from '@tabler/icons-svelte/icons/x';
	import IconDeviceFloppy from '@tabler/icons-svelte/icons/device-floppy';
	import IconChevronUp from '@tabler/icons-svelte/icons/chevron-up';
	import IconChevronDown from '@tabler/icons-svelte/icons/chevron-down';
	import IconCircle from '@tabler/icons-svelte/icons/circle';
	import IconCircleFilled from '@tabler/icons-svelte/icons/circle-filled';
	import ColorInput from '../common/ColorInput.svelte';
	import { rangeFill } from '../common/rangeFill';

	let { onclose }: { onclose: () => void } = $props();

	const project = $derived(editor.project);
	const projectDir = $derived(
		editor.projectPath.slice(0, editor.projectPath.lastIndexOf('/')) || ''
	);
	const groups = $derived(project?.autoRuleGroups ?? []);
	const tilesets = $derived(project?.tilesets ?? []);
	const presets = $derived(project?.autoRulePresets ?? []);

	let selectedRuleUid = $state<number>(-1);
	let paintValue = $state<string>('');
	let presetToApply = $state<SvAutoRulePreset | null>(null);

	const selectedRule = $derived.by(() => {
		for (const g of groups) {
			const r = g.rules.find((rr) => rr.uid === selectedRuleUid);
			if (r) return r;
		}
		return undefined;
	});

	/** The group owning the selected rule; its tileset drives the tile-selection canvas. */
	const selectedGroup = $derived(
		groups.find((g) => g.rules.some((r) => r.uid === selectedRuleUid))
	);
	const tileset = $derived(getTileset(project!, selectedGroup?.tilesetDefUid));

	$effect(() => {
		const names = groups.map((g) => g.name);
		if (paintValue !== ANYTHING && !names.includes(paintValue)) paintValue = names[0] ?? '';
	});

	function edit(label: string, fn: () => void) {
		editor.editGroups(label, fn);
	}

	function valueColor(name: string): string {
		return groups.find((g) => g.name === name)?.color ?? '#c7786f';
	}

	function addGroup() {
		if (!project) return;
		const g = makeAutoRuleGroup(project, `Group ${groups.length + 1}`);
		edit('Add rule group', () => project.autoRuleGroups.unshift(g));
	}
	function deleteGroup(uid: number) {
		if (!project) return;
		edit(
			'Delete rule group',
			() => (project.autoRuleGroups = project.autoRuleGroups.filter((g) => g.uid !== uid))
		);
	}
	function renameGroup(g: SvAutoRuleGroup, name: string) {
		// Name is the group id — cascade the rename through grid cells + rule patterns, enforce unique.
		editor.renameRuleGroup(g.uid, name);
	}
	function setGroupColor(g: SvAutoRuleGroup, color: string) {
		edit('Set group color', () => (g.color = color));
	}
	function setGroupTileset(g: SvAutoRuleGroup, uid: number | null) {
		edit('Set group tileset', () => (g.tilesetDefUid = uid));
	}
	function toggleGroupActive(g: SvAutoRuleGroup) {
		edit(g.active ? 'Disable rule group' : 'Enable rule group', () => (g.active = !g.active));
	}
	function addRule(g: SvAutoRuleGroup) {
		if (!project) return;
		const r = makeAutoRule(project, 3);
		edit('Add rule', () => g.rules.unshift(r));
		selectedRuleUid = r.uid;
	}
	function deleteRule(g: SvAutoRuleGroup, uid: number) {
		edit('Delete rule', () => (g.rules = g.rules.filter((r) => r.uid !== uid)));
	}
	function toggleRuleActive(r: SvAutoRule) {
		edit(r.active ? 'Disable rule' : 'Enable rule', () => (r.active = !r.active));
	}
	function moveRule(g: SvAutoRuleGroup, idx: number, dir: -1 | 1) {
		const j = idx + dir;
		if (j < 0 || j >= g.rules.length) return;
		edit('Reorder rule', () => {
			const t = g.rules[idx];
			g.rules[idx] = g.rules[j];
			g.rules[j] = t;
		});
	}

	function cycleCell(rule: SvAutoRule, i: number, forbid: boolean) {
		const cur = rule.pattern[i];
		const req = paintValue; // require this id
		const forb = '!' + paintValue; // forbid this id
		let next: string;
		if (forbid) {
			next = cur === forb ? '' : forb;
		} else {
			if (cur === req) next = forb;
			else if (cur === forb) next = '';
			else next = req;
		}
		edit('Edit rule pattern', () => (rule.pattern[i] = next));
	}

	function setRuleSize(rule: SvAutoRule, size: number) {
		const old = rule.size;
		const oldP = rule.pattern;
		const next = new Array(size * size).fill('');
		const oc = (old - 1) / 2;
		const nc = (size - 1) / 2;
		for (let y = 0; y < old; y++) {
			for (let x = 0; x < old; x++) {
				const nx = x - oc + nc;
				const ny = y - oc + nc;
				if (nx >= 0 && ny >= 0 && nx < size && ny < size) next[ny * size + nx] = oldP[y * old + x];
			}
		}
		edit('Set rule size', () => {
			rule.size = size;
			rule.pattern = next;
		});
	}

	/** Visual description of a pattern cell value (string sentinels). */
	function cellView(v: string, center: boolean) {
		const base = center ? '#2e2a4f' : '#211d38';
		if (v === '') return { bg: base, border: '#3b405e', text: '', cross: false };
		const forbid = v[0] === '!';
		const mag = forbid ? v.slice(1) : v;
		if (mag === ANYTHING) {
			return forbid
				? { bg: base, border: '#ff6b6b', text: '∅', cross: false }
				: { bg: '#ffffff22', border: '#aaaaaa', text: '∗', cross: false };
		}
		const col = valueColor(mag);
		return forbid
			? { bg: base, border: col, text: '', cross: true }
			: { bg: col, border: col, text: '', cross: false };
	}

	let tileCanvas = $state<HTMLCanvasElement>();
	const TILE_DISPLAY_W = 300;
	const tileScale = $derived(
		tileset ? Math.max(0.25, Math.min(3, TILE_DISPLAY_W / Math.max(1, tileset.pxWid))) : 1
	);
	const tileStride = $derived(tileset ? tileset.tileGridSize + tileset.spacing : 1);

	function drawTiles() {
		const canvas = tileCanvas;
		if (!canvas || !tileset || !selectedRule) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		const cssW = tileset.pxWid * tileScale;
		const cssH = tileset.pxHei * tileScale;
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

		const grid = tileset.tileGridSize * tileScale;
		const sel = new Set(selectedRule.tileIds);
		for (const id of sel) {
			const col = id % tileset.cWid;
			const row = Math.floor(id / tileset.cWid);
			const x = (tileset.padding + col * tileStride) * tileScale;
			const y = (tileset.padding + row * tileStride) * tileScale;
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
		for (let c = 0; c <= tileset.cWid; c++) {
			const x = (tileset.padding + c * tileStride) * tileScale + 0.5;
			ctx.moveTo(x, 0);
			ctx.lineTo(x, cssH);
		}
		for (let r = 0; r <= tileset.cHei; r++) {
			const y = (tileset.padding + r * tileStride) * tileScale + 0.5;
			ctx.moveTo(0, y);
			ctx.lineTo(cssW, y);
		}
		ctx.stroke();
		ctx.globalAlpha = 1;
	}

	$effect(() => {
		void [editor.revision, selectedRuleUid, selectedRule?.tileIds.length, tileset?.uid];
		void selectedGroup?.tilesetDefUid;
		drawTiles();
	});

	let painting = $state(false);
	let paintAdd = true;
	let touched = new Set<number>();

	function tileIdFromEvent(e: PointerEvent): number | null {
		if (!tileset || !tileCanvas) return null;
		const rect = tileCanvas.getBoundingClientRect();
		const px = (e.clientX - rect.left) / tileScale - tileset.padding;
		const py = (e.clientY - rect.top) / tileScale - tileset.padding;
		const col = Math.floor(px / tileStride);
		const row = Math.floor(py / tileStride);
		if (col < 0 || row < 0 || col >= tileset.cWid || row >= tileset.cHei) return null;
		// Ignore clicks that land in the inter-tile spacing gap (only when spacing > 0).
		if (
			px - col * tileStride >= tileset.tileGridSize ||
			py - row * tileStride >= tileset.tileGridSize
		)
			return null;
		return row * tileset.cWid + col;
	}

	function applyTile(id: number) {
		const rule = selectedRule;
		if (!rule || touched.has(id)) return;
		touched.add(id);
		const has = rule.tileIds.includes(id);
		if (paintAdd && !has) rule.tileIds.push(id);
		else if (!paintAdd && has) rule.tileIds = rule.tileIds.filter((x) => x !== id);
		editor.touch();
	}

	function tilePointerDown(e: PointerEvent) {
		const rule = selectedRule;
		if (!rule) return;
		const id = tileIdFromEvent(e);
		if (id == null) return;
		tileCanvas?.setPointerCapture(e.pointerId);
		painting = true;
		touched = new Set();
		paintAdd = !rule.tileIds.includes(id);
		editor.beginStroke(paintAdd ? 'Add rule tiles' : 'Remove rule tiles');
		applyTile(id);
	}
	function tilePointerMove(e: PointerEvent) {
		if (!painting) return;
		const id = tileIdFromEvent(e);
		if (id != null) applyTile(id);
	}
	function tilePointerUp() {
		if (!painting) return;
		painting = false;
		// Re-bake after a tile-selection stroke.
		editor.recomputeAll();
		editor.endStroke();
	}
</script>

{#snippet patternPreview(rule: SvAutoRule)}
	{@const c = (rule.size - 1) / 2}
	<span class="ppat" style="grid-template-columns: repeat({rule.size}, 7px)">
		{#each rule.pattern as cell, k (k)}
			{@const isCenter = Math.floor(k / rule.size) === c && k % rule.size === c}
			{@const view = cellView(cell, isCenter)}
			<span
				class="pcell"
				class:pcenter={isCenter}
				style="background:{view.bg}; border-color:{view.border}"
			>
				{#if view.cross}<span class="pcross" style="color:{view.border}">×</span>{/if}
			</span>
		{/each}
	</span>
{/snippet}

<Dialog title="Auto-layer rules" {onclose} width={860}>
	{#if !project}
		<p class="dim">No project loaded.</p>
	{:else}
		<div class="layout">
			<!-- groups + rules -->
			<div class="tree">
				<div class="tree-head">
					<span>Rule groups</span>
					<button class="add" onclick={addGroup}>+ Group</button>
				</div>
				{#if presets.length}
					<div class="presets">
						{#each presets as pr, i (pr.name)}
							<span
								class="chip"
								use:tooltip={`New group from "${pr.name}" (${pr.rules.length} rules)`}
							>
								<button class="chip-add" onclick={() => (presetToApply = pr)}>
									<IconPlus size={10} />{pr.name}
								</button>
								<button
									class="chip-x"
									use:tooltip={'Delete preset'}
									onclick={() => editor.deleteRulePreset(i)}
								>
									<IconX size={9} />
								</button>
							</span>
						{/each}
					</div>
				{/if}
				{#if groups.length === 0}
					<p class="dim">No groups yet.</p>
				{/if}
				{#each groups as g (g.uid)}
					<div class="group">
						<div class="group-head">
							<button
								class="toggle"
								class:off={!g.active}
								use:tooltip={g.active ? 'Disable group' : 'Enable group'}
								onclick={() => toggleGroupActive(g)}
							>
								{#if g.active}<IconCircleFilled size={12} />{:else}<IconCircle size={12} />{/if}
							</button>
							<span class="gcolor" use:tooltip={`Paints id "${g.name}"`}>
								<ColorInput
									value={g.color}
									label={`Colour for id "${g.name}"`}
									onchange={(c) => setGroupColor(g, c)}
								/>
							</span>
							<input
								class="gname"
								value={g.name}
								onchange={(e) => renameGroup(g, e.currentTarget.value)}
							/>
							<button class="add sm" use:tooltip={'Add rule'} onclick={() => addRule(g)}>
								<IconPlus size={12} />
							</button>
							<button
								class="mv"
								use:tooltip={'Save layout as preset'}
								onclick={() => editor.saveRulePreset(g.uid, g.name)}
							>
								<IconDeviceFloppy size={12} />
							</button>
							<button class="x" use:tooltip={'Delete group'} onclick={() => deleteGroup(g.uid)}>
								<IconX size={12} />
							</button>
						</div>
						<select
							class="gtileset"
							value={g.tilesetDefUid ?? ''}
							onchange={(e) =>
								setGroupTileset(g, e.currentTarget.value === '' ? null : +e.currentTarget.value)}
						>
							<option value="">(no tileset)</option>
							{#each tilesets as ts (ts.uid)}
								<option value={ts.uid}>{ts.identifier}</option>
							{/each}
						</select>
						{#each g.rules as r, i (r.uid)}
							<div class="rule" class:active={selectedRuleUid === r.uid}>
								<button
									class="toggle sm"
									class:off={!r.active}
									use:tooltip={r.active ? 'Disable rule' : 'Enable rule'}
									onclick={() => toggleRuleActive(r)}
								>
									{#if r.active}<IconCircleFilled size={10} />{:else}<IconCircle size={10} />{/if}
								</button>
								<button class="rsel" onclick={() => (selectedRuleUid = r.uid)}>
									{@render patternPreview(r)}
									<span class="rmeta">
										<span class="rsize">{r.size}×{r.size}</span>
										<span class="rtiles">{r.tileIds.length}t</span>
									</span>
								</button>
								<button class="mv" use:tooltip={'Move up'} onclick={() => moveRule(g, i, -1)}>
									<IconChevronUp size={11} />
								</button>
								<button class="mv" use:tooltip={'Move down'} onclick={() => moveRule(g, i, 1)}>
									<IconChevronDown size={11} />
								</button>
								<button class="x" use:tooltip={'Delete rule'} onclick={() => deleteRule(g, r.uid)}>
									<IconX size={11} />
								</button>
							</div>
						{/each}
					</div>
				{/each}
			</div>

			<!-- selected rule -->
			<div class="editor-pane">
				{#if selectedRule}
					{@const rule = selectedRule}
					{@const center = (rule.size - 1) / 2}
					<div class="section-row">
						<div class="palette">
							<span class="lbl">Paint value</span>
							<div class="swatches">
								{#each groups as gv (gv.uid)}
									<button
										class="vswatch"
										class:active={paintValue === gv.name}
										style="background:{gv.color}"
										title={gv.name}
										aria-label={gv.name}
										onclick={() => (paintValue = gv.name)}
									></button>
								{/each}
								<button
									class="vswatch any"
									class:active={paintValue === ANYTHING}
									title="Anything (non-empty)"
									onclick={() => (paintValue = ANYTHING)}>∗</button
								>
							</div>
							<span class="hint">L-click require · R-click forbid</span>
						</div>

						<div class="size-pick">
							<span class="lbl">Size</span>
							{#each [1, 3, 5, 7] as s (s)}
								<button
									class="szbtn"
									class:active={rule.size === s}
									onclick={() => setRuleSize(rule, s)}>{s}</button
								>
							{/each}
						</div>
					</div>

					<div
						class="pattern"
						role="group"
						aria-label="rule pattern"
						style="grid-template-columns: repeat({rule.size}, 26px)"
						oncontextmenu={(e) => e.preventDefault()}
					>
						{#each rule.pattern as cell, i (i)}
							{@const isCenter = Math.floor(i / rule.size) === center && i % rule.size === center}
							{@const view = cellView(cell, isCenter)}
							<button
								class="cell"
								class:center={isCenter}
								style="background:{view.bg}; border-color:{view.border}"
								onclick={() => cycleCell(rule, i, false)}
								oncontextmenu={(e) => {
									e.preventDefault();
									cycleCell(rule, i, true);
								}}
							>
								{#if view.cross}<span class="forbid" style="color:{view.border}">⊘</span>{/if}
								{#if view.text}<span class="ctext">{view.text}</span>{/if}
							</button>
						{/each}
					</div>

					<div class="cols">
						<div class="tilecol">
							<span class="lbl">Tiles {rule.tileIds.length ? `(${rule.tileIds.length})` : ''}</span>
							{#if tileset}
								<div class="tilewrap">
									<canvas
										bind:this={tileCanvas}
										onpointerdown={tilePointerDown}
										onpointermove={tilePointerMove}
										onpointerup={tilePointerUp}
										onpointercancel={tilePointerUp}
									></canvas>
								</div>
							{:else}
								<p class="dim">No tileset assigned to this group.</p>
							{/if}
						</div>

						<div class="optcol">
							<div class="grid2">
								<span class="lbl">Chance</span>
								<div class="inline">
									<input
										type="range"
										min="0"
										max="1"
										step="0.05"
										value={rule.chance}
										use:rangeFill={rule.chance}
										oninput={(e) => {
											// Snapshot once before first mutation so undo restores the pre-drag value.
											editor.beginStroke('Set rule chance');
											rule.chance = +e.currentTarget.value;
											editor.touch();
										}}
										onchange={() => {
											editor.recomputeAll();
											editor.endStroke();
										}}
									/>
									<span class="num">{Math.round(rule.chance * 100)}%</span>
								</div>

								<span class="lbl">Break</span>
								<input
									type="checkbox"
									checked={rule.breakOnMatch}
									onchange={(e) =>
										edit('Edit rule', () => (rule.breakOnMatch = e.currentTarget.checked))}
								/>

								<span class="lbl">Flip X</span>
								<input
									type="checkbox"
									checked={rule.flipX}
									onchange={(e) => edit('Edit rule', () => (rule.flipX = e.currentTarget.checked))}
								/>
								<span class="lbl">Flip Y</span>
								<input
									type="checkbox"
									checked={rule.flipY}
									onchange={(e) => edit('Edit rule', () => (rule.flipY = e.currentTarget.checked))}
								/>

								<span class="lbl">Modulo X</span>
								<NumberInput
									int
									min={1}
									value={rule.xModulo}
									onchange={(v) => edit('Edit rule', () => (rule.xModulo = v))}
								/>
								<span class="lbl">Modulo Y</span>
								<NumberInput
									int
									min={1}
									value={rule.yModulo}
									onchange={(v) => edit('Edit rule', () => (rule.yModulo = v))}
								/>

								<span class="lbl">Checker</span>
								<select
									class="text sm"
									value={rule.checker}
									onchange={(e) =>
										edit(
											'Edit rule',
											() => (rule.checker = e.currentTarget.value as SvAutoRule['checker'])
										)}
								>
									<option value="None">None</option>
									<option value="Horizontal">Horizontal</option>
									<option value="Vertical">Vertical</option>
								</select>

								<span class="lbl">Out-of-bounds</span>
								<select
									class="text sm"
									value={rule.outOfBoundsValue ?? ''}
									onchange={(e) =>
										edit(
											'Edit rule',
											() =>
												(rule.outOfBoundsValue =
													e.currentTarget.value === '' ? null : e.currentTarget.value)
										)}
								>
									<option value="">empty</option>
									{#each groups as gv (gv.uid)}
										<option value={gv.name}>{gv.name}</option>
									{/each}
								</select>

								<span class="lbl">Perlin</span>
								<input
									type="checkbox"
									checked={rule.perlinActive}
									onchange={(e) =>
										edit('Edit rule', () => (rule.perlinActive = e.currentTarget.checked))}
								/>
							</div>

							{#if rule.perlinActive}
								<div class="grid2">
									<span class="lbl">P. scale</span>
									<NumberInput
										min={0}
										step={0.01}
										value={rule.perlinScale}
										onchange={(v) => edit('Edit rule', () => (rule.perlinScale = v))}
									/>
									<span class="lbl">P. octaves</span>
									<NumberInput
										int
										min={1}
										value={rule.perlinOctaves}
										onchange={(v) => edit('Edit rule', () => (rule.perlinOctaves = v))}
									/>
									<span class="lbl">P. seed</span>
									<NumberInput
										int
										value={rule.perlinSeed}
										onchange={(v) => edit('Edit rule', () => (rule.perlinSeed = v))}
									/>
								</div>
							{/if}
						</div>
					</div>
				{:else}
					<p class="dim">Select a rule, or add one to a group.</p>
				{/if}
			</div>
		</div>
	{/if}

	{#snippet footer()}
		<button class="btn" onclick={onclose}>Done</button>
	{/snippet}
</Dialog>

{#if presetToApply}
	<PresetApplyDialog preset={presetToApply} onclose={() => (presetToApply = null)} />
{/if}

<style>
	.layout {
		display: grid;
		grid-template-columns: 230px 1fr;
		gap: 14px;
		min-height: 420px;
	}
	.tree {
		min-width: 0;
		border-right: 1px solid var(--border);
		padding-right: 10px;
	}
	.tree-head,
	.lbl {
		color: var(--muted);
	}
	.tree-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-weight: 700;
		margin-bottom: 6px;
	}
	.group {
		margin-bottom: 8px;
	}
	.group-head {
		display: flex;
		align-items: center;
		gap: 3px;
		margin-bottom: 3px;
	}
	.gname {
		flex: 1;
		min-width: 0;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 3px 5px;
		font: inherit;
		font-weight: 600;
	}
	.gcolor {
		display: inline-grid;
		--sw-w: 24px;
		--sw-h: 22px;
	}
	.gtileset {
		width: 100%;
		margin: 0 0 4px 0;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 3px 5px;
		font: inherit;
	}
	.rule {
		display: flex;
		align-items: center;
		gap: 2px;
		margin: 2px 0 2px 14px;
		border-radius: 4px;
		padding: 1px;
	}
	.rule.active {
		background: var(--accent-dim);
		outline: 1px solid var(--accent);
	}
	.rsel {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 3px 6px;
		cursor: pointer;
		font: inherit;
	}
	.rmeta {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.rsize {
		font-weight: 600;
	}
	.rtiles {
		color: var(--muted);
		font-size: 10px;
	}
	.ppat {
		display: grid;
		gap: 1px;
		width: max-content;
		flex-shrink: 0;
	}
	.pcell {
		width: 7px;
		height: 7px;
		border: 1px solid var(--border);
		border-radius: 1px;
		display: grid;
		place-items: center;
	}
	.pcenter {
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
	}
	.pcross {
		font-size: 6px;
		line-height: 1;
		font-weight: 700;
	}
	.toggle {
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		width: 18px;
		height: 18px;
		display: grid;
		place-items: center;
		padding: 0;
	}
	.toggle.off {
		color: #555;
	}
	.toggle.sm {
		width: 16px;
		height: 16px;
	}
	.mv,
	.x {
		background: var(--panel);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 3px;
		cursor: pointer;
		width: 17px;
		height: 17px;
		display: grid;
		place-items: center;
		padding: 0;
	}
	.x:hover {
		background: #5a2530;
		color: #ffd7dd;
	}
	.add {
		background: var(--accent-dim);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 4px;
		padding: 2px 8px;
		cursor: pointer;
		font: inherit;
	}
	.add.sm {
		padding: 1px 6px;
		display: inline-grid;
		place-items: center;
	}
	.add:hover {
		background: var(--accent);
		color: #0d0b18;
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 8px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		border: 1px solid var(--border);
		border-radius: 4px;
		overflow: hidden;
	}
	.chip-add,
	.chip-x {
		background: var(--panel-2);
		border: none;
		color: var(--text);
		cursor: pointer;
		font: inherit;
		font-size: 11px;
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 2px 6px;
	}
	.chip-add:hover {
		background: var(--accent);
		color: #0d0b18;
	}
	.chip-x {
		padding: 2px 4px;
		border-left: 1px solid var(--border);
		color: var(--muted);
	}
	.chip-x:hover {
		background: #5a2530;
		color: #ffd7dd;
	}
	.editor-pane {
		min-width: 0;
	}
	.section-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 16px;
		margin-bottom: 10px;
	}
	.palette {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.swatches {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.vswatch {
		width: 22px;
		height: 22px;
		border-radius: 4px;
		border: 2px solid transparent;
		cursor: pointer;
		color: #fff;
		display: grid;
		place-items: center;
		font-size: 12px;
	}
	.vswatch.any {
		background: #333;
	}
	.vswatch.active {
		border-color: #fff;
		box-shadow: 0 0 0 1px var(--accent);
	}
	.hint {
		color: var(--muted);
		font-size: 10px;
	}
	.size-pick {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.szbtn {
		width: 24px;
		height: 24px;
		background: var(--panel-2);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 4px;
		cursor: pointer;
		font: inherit;
	}
	.szbtn.active {
		background: var(--accent);
		color: #0d0b18;
		border-color: var(--accent);
	}
	.pattern {
		display: grid;
		gap: 2px;
		margin-bottom: 14px;
		width: max-content;
	}
	.cell {
		width: 26px;
		height: 26px;
		border: 1px solid var(--border);
		border-radius: 3px;
		cursor: pointer;
		padding: 0;
		display: grid;
		place-items: center;
		position: relative;
	}
	.cell.center {
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
	}
	.forbid {
		font-size: 16px;
		font-weight: 700;
	}
	.ctext {
		font-size: 12px;
		color: #ddd;
	}
	.cols {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 18px;
		align-items: start;
	}
	.tilewrap {
		overflow: auto;
		max-height: 320px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
		padding: 6px;
		margin-top: 4px;
	}
	canvas {
		display: block;
		cursor: crosshair;
		touch-action: none;
	}
	.grid2 {
		display: grid;
		grid-template-columns: 80px 1fr;
		gap: 6px 8px;
		align-items: center;
		margin-bottom: 10px;
	}
	.inline {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.num {
		color: var(--muted);
		min-width: 36px;
	}
	.text {
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 3px 5px;
		font: inherit;
		width: 100%;
	}
	.text.sm {
		width: 90px;
	}
	input[type='range'] {
		flex: 1;
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
