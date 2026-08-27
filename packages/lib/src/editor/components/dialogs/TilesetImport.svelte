<script lang="ts">
	/**
	 * Add a tileset by picking an existing static-dir image or uploading one (saved next to the
	 * `.svlevel` file). The image is decoded for its pixel size; cWid/cHei derive from grid metrics.
	 */
	import { onMount } from 'svelte';
	import { editor } from '../../state/editorStore.svelte';
	import { makeTileset } from '../../state/factory';
	import { listAssets, uploadAsset, type AssetInfo } from '../../state/io';
	import {
		extractPaletteFromImage,
		parseHexList,
		remapImageToPalette
	} from '../../render/paletteRemap';
	import Dialog from './Dialog.svelte';
	import NumberInput from '../common/NumberInput.svelte';
	import ColorInput from '../common/ColorInput.svelte';

	let { onclose }: { onclose: () => void } = $props();

	const project = $derived(editor.project);
	const projectDir = $derived(
		editor.projectPath.slice(0, editor.projectPath.lastIndexOf('/')) || ''
	);

	type Source =
		| { kind: 'asset'; asset: AssetInfo }
		| { kind: 'upload'; dataUrl: string; name: string };

	let assets = $state<AssetInfo[]>([]);
	let source = $state<Source | null>(null);
	let previewUrl = $state<string>('');
	let dims = $state<{ w: number; h: number } | null>(null);
	let identifier = $state('Tileset');
	let tileGridSize = $state(16);
	let spacing = $state(0);
	let padding = $state(0);
	let error = $state('');

	// Palette remap: snap the source image to a target palette (seeded from the project's collision
	// layer colours — the game's actual White/Gray/Black palette). Editable via the swatches below.
	let remap = $state(false);
	let palette = $state<string[]>([]);
	let remappedUrl = $state('');

	const cWid = $derived(
		dims ? Math.max(0, Math.floor((dims.w - padding * 2 + spacing) / (tileGridSize + spacing))) : 0
	);
	const cHei = $derived(
		dims ? Math.max(0, Math.floor((dims.h - padding * 2 + spacing) / (tileGridSize + spacing))) : 0
	);

	onMount(() => {
		palette = (project?.collisionLayers ?? []).map((l) => l.color);
		listAssets()
			.then((a) => (assets = a))
			.catch((e) => (error = `Could not list assets: ${e.message}`));
	});

	// Recompute the remapped preview whenever the toggle, source, or palette changes.
	$effect(() => {
		const src = previewUrl;
		const pal = palette.map((c) => c);
		if (!remap || !src || !pal.length) {
			remappedUrl = '';
			return;
		}
		let stale = false;
		remapImageToPalette(src, pal)
			.then((u) => !stale && (remappedUrl = u))
			.catch((e) => !stale && (error = (e as Error).message));
		return () => (stale = true);
	});

	/** Decode an image URL to its pixel dimensions. */
	function readDims(url: string): Promise<{ w: number; h: number }> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
			img.onerror = () => reject(new Error('failed to decode image'));
			img.src = url;
		});
	}

	async function loadPaletteImage(file: File) {
		error = '';
		try {
			const dataUrl = await new Promise<string>((resolve, reject) => {
				const r = new FileReader();
				r.onload = () => resolve(r.result as string);
				r.onerror = () => reject(new Error('failed to read file'));
				r.readAsDataURL(file);
			});
			palette = await extractPaletteFromImage(dataUrl);
			remap = true;
		} catch (e) {
			error = (e as Error).message;
		}
	}

	function baseName(p: string): string {
		const file = p.split('/').pop() ?? p;
		return file.replace(/\.[^.]+$/, '');
	}

	async function chooseAsset(path: string) {
		error = '';
		const asset = assets.find((a) => a.path === path);
		if (!asset) return;
		source = { kind: 'asset', asset };
		previewUrl = asset.path;
		identifier = baseName(asset.name);
		try {
			dims = await readDims(asset.path);
		} catch (e) {
			error = (e as Error).message;
			dims = null;
		}
	}

	async function chooseUpload(file: File) {
		error = '';
		const dataUrl = await new Promise<string>((resolve, reject) => {
			const r = new FileReader();
			r.onload = () => resolve(r.result as string);
			r.onerror = () => reject(new Error('failed to read file'));
			r.readAsDataURL(file);
		});
		source = { kind: 'upload', dataUrl, name: file.name };
		previewUrl = dataUrl;
		identifier = baseName(file.name);
		try {
			dims = await readDims(dataUrl);
		} catch (e) {
			error = (e as Error).message;
			dims = null;
		}
	}

	/** Path of an asset relative to the project file's directory. */
	function relFromProject(assetPath: string): string {
		const ds = projectDir.split('/').filter(Boolean);
		const as = assetPath.split('/').filter(Boolean);
		let i = 0;
		while (i < ds.length && i < as.length && ds[i] === as[i]) i++;
		const up = ds.slice(i).map(() => '..');
		return [...up, ...as.slice(i)].join('/');
	}

	async function confirm() {
		if (!project || !source || !dims) return;
		error = '';
		let relPath: string;
		try {
			if (remap && remappedUrl) {
				const name = `${(identifier.trim() || 'tileset').replace(/[^\w.-]/g, '_')}.palette.png`;
				await uploadAsset(`${projectDir}/${name}`, remappedUrl);
				relPath = name;
			} else if (source.kind === 'upload') {
				const uploadPath = `${projectDir}/${source.name}`;
				await uploadAsset(uploadPath, source.dataUrl);
				relPath = source.name;
			} else {
				relPath = relFromProject(source.asset.path);
			}
		} catch (e) {
			error = (e as Error).message;
			return;
		}
		const ts = makeTileset(project, {
			identifier: identifier.trim() || 'Tileset',
			relPath,
			pxWid: dims.w,
			pxHei: dims.h,
			tileGridSize,
			spacing,
			padding
		});
		editor.commit('Add tileset', () => project.tilesets.push(ts));
		onclose();
	}
</script>

<Dialog title="Import tileset" {onclose} width={620}>
	<div class="row">
		<div class="lbl">From asset</div>
		<select class="text" value="" onchange={(e) => chooseAsset(e.currentTarget.value)}>
			<option value="" disabled selected>Pick an image…</option>
			{#each assets as a (a.path)}
				<option value={a.path}>{a.path}</option>
			{/each}
		</select>
	</div>
	<div class="row">
		<div class="lbl">Or upload</div>
		<input
			type="file"
			accept="image/*"
			onchange={(e) => {
				const f = e.currentTarget.files?.[0];
				if (f) chooseUpload(f);
			}}
		/>
	</div>

	{#if previewUrl}
		<div class="preview">
			<img src={(remap && remappedUrl) || previewUrl} alt="tileset preview" />
			<div class="meta">
				{#if dims}
					<div>{dims.w}×{dims.h}px</div>
					<div class="dim">{cWid}×{cHei} tiles</div>
				{/if}
			</div>
		</div>

		<div class="row remap-head">
			<label class="chk">
				<input type="checkbox" bind:checked={remap} />
				Remap to palette
			</label>
			{#if remap}
				<div class="swatches">
					{#each palette as _c, i (i)}
						<span class="sw">
							<ColorInput bind:value={palette[i]} label="Palette colour {i + 1}" />
							<input
								class="hex"
								value={palette[i]}
								onchange={(e) => {
									const [c] = parseHexList(e.currentTarget.value);
									if (c) palette[i] = c;
									e.currentTarget.value = palette[i];
								}}
							/>
							<button
								class="x"
								title="Remove colour"
								onclick={() => (palette = palette.filter((_, j) => j !== i))}>×</button
							>
						</span>
					{/each}
					<button class="add" title="Add colour" onclick={() => (palette = [...palette, '#ffffff'])}
						>+</button
					>
					<label class="add pick" title="Extract colours from a palette image">
						🎨
						<input
							type="file"
							accept="image/*"
							onchange={(e) => {
								const f = e.currentTarget.files?.[0];
								if (f) loadPaletteImage(f);
							}}
						/>
					</label>
				</div>
			{/if}
		</div>

		<div class="grid">
			<span class="lbl">Identifier</span>
			<input class="text" bind:value={identifier} />
			<span class="lbl">Tile size</span>
			<NumberInput int min={1} value={tileGridSize} onchange={(v) => (tileGridSize = v)} />
			<span class="lbl">Spacing</span>
			<NumberInput int min={0} value={spacing} onchange={(v) => (spacing = v)} />
			<span class="lbl">Padding</span>
			<NumberInput int min={0} value={padding} onchange={(v) => (padding = v)} />
		</div>
	{/if}

	{#if error}
		<p class="err">{error}</p>
	{/if}

	{#snippet footer()}
		<button class="btn" onclick={onclose}>Cancel</button>
		<button class="btn primary" disabled={!source || !dims} onclick={confirm}>Add tileset</button>
	{/snippet}
</Dialog>

<style>
	.row {
		display: grid;
		grid-template-columns: 90px 1fr;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}
	.grid {
		display: grid;
		grid-template-columns: 90px 1fr;
		align-items: center;
		gap: 6px 8px;
		margin-top: 10px;
	}
	.lbl {
		color: var(--muted);
		font-size: 11px;
	}
	.text {
		width: 100%;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 4px 6px;
		font: inherit;
	}
	.preview {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		margin-top: 8px;
		padding: 8px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.preview img {
		max-width: 360px;
		max-height: 220px;
		image-rendering: pixelated;
		border: 1px solid var(--border);
	}
	.meta {
		font-size: 11px;
	}
	.dim {
		color: var(--muted);
	}
	.err {
		color: #ff7676;
		margin-top: 8px;
	}
	.remap-head {
		grid-template-columns: auto 1fr;
		margin-top: 10px;
	}
	.chk {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		cursor: pointer;
	}
	.swatches {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.sw {
		position: relative;
		display: inline-flex;
		align-items: center;
		gap: 3px;
	}
	.sw {
		--sw-w: 26px;
		--sw-h: 22px;
	}
	.hex {
		width: 66px;
		height: 22px;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 4px;
		color: var(--text);
		padding: 0 4px;
		font: inherit;
		font-size: 11px;
	}
	.sw .x {
		position: absolute;
		top: -6px;
		right: -6px;
		width: 14px;
		height: 14px;
		line-height: 12px;
		font-size: 11px;
		border-radius: 50%;
		border: 1px solid var(--border);
		background: var(--panel);
		color: var(--text);
		cursor: pointer;
		padding: 0;
	}
	.add {
		width: 26px;
		height: 22px;
		border: 1px dashed var(--border);
		border-radius: 4px;
		background: var(--bg);
		color: var(--muted);
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
	}
	.pick {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.pick input {
		display: none;
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
	.btn.primary {
		background: var(--accent);
		color: #0d0b18;
		border-color: var(--accent);
		font-weight: 600;
	}
	.btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
