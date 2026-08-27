<script lang="ts">
	import { editor } from '../../state/editorStore.svelte';
	import type { SvLayerType } from '../../../format/types';
	import Panel from './Panel.svelte';
	import { tooltip } from '../common/tooltip';
	import IconPlus from '@tabler/icons-svelte/icons/plus';
	import IconX from '@tabler/icons-svelte/icons/x';
	import IconEye from '@tabler/icons-svelte/icons/eye';
	import IconEyeOff from '@tabler/icons-svelte/icons/eye-off';
	import IconChevronUp from '@tabler/icons-svelte/icons/chevron-up';
	import IconChevronDown from '@tabler/icons-svelte/icons/chevron-down';
	import IconSettings from '@tabler/icons-svelte/icons/settings';

	let { onrules }: { onrules: () => void } = $props();

	let addType = $state<SvLayerType>('IdGrid');

	const TYPE_META: Record<SvLayerType, { c: string; t: string }> = {
		IdGrid: { c: '#ff9a3c', t: 'G' },
		Tiles: { c: '#4dabf7', t: 'T' },
		AutoLayer: { c: '#da77f2', t: 'A' },
		Entities: { c: '#69db7c', t: 'E' }
	};

	const layers = $derived(editor.project?.layers ?? []);

	function visible(uid: number): boolean {
		return editor.currentLevel?.layers.find((l) => l.layerDefUid === uid)?.visible ?? true;
	}
</script>

<Panel title="Layers">
	{#snippet actions()}
		<select class="mini" bind:value={addType} title="Layer type">
			<option value="IdGrid">IdGrid</option>
			<option value="Tiles">Tiles</option>
			<option value="AutoLayer">AutoLayer</option>
			<option value="Entities">Entities</option>
		</select>
		<button class="icon-btn" use:tooltip={'Add layer'} onclick={() => editor.addLayerDef(addType)}>
			<IconPlus size={13} />
		</button>
	{/snippet}

	<ul class="layers">
		{#each layers as layer (layer.uid)}
			{@const meta = TYPE_META[layer.type]}
			<li class:active={editor.activeLayerUid === layer.uid}>
				<button
					class="eye"
					class:off={!visible(layer.uid)}
					use:tooltip={visible(layer.uid) ? 'Hide layer' : 'Show layer'}
					onclick={(e) => {
						e.stopPropagation();
						editor.toggleLayerVisible(layer.uid);
					}}
				>
					{#if visible(layer.uid)}<IconEye size={14} />{:else}<IconEyeOff size={14} />{/if}
				</button>
				<button class="row" onclick={() => editor.setActiveLayer(layer.uid)}>
					<span class="badge" style="background:{meta.c}">{meta.t}</span>
					<span class="name">{layer.identifier}</span>
				</button>
				<div class="ops">
					{#if layer.type === 'IdGrid' || layer.type === 'AutoLayer'}
						<button
							class="icon-btn"
							use:tooltip={'Edit auto-layer rules'}
							onclick={() => {
								editor.setActiveLayer(layer.uid);
								onrules();
							}}
						>
							<IconSettings size={12} />
						</button>
					{/if}
					<button class="icon-btn" use:tooltip={'Move up'} onclick={() => editor.moveLayerDef(layer.uid, -1)}>
						<IconChevronUp size={12} />
					</button>
					<button class="icon-btn" use:tooltip={'Move down'} onclick={() => editor.moveLayerDef(layer.uid, 1)}>
						<IconChevronDown size={12} />
					</button>
					<button class="icon-btn danger" use:tooltip={'Delete layer'} onclick={() => editor.deleteLayerDef(layer.uid)}>
						<IconX size={12} />
					</button>
				</div>
			</li>
		{/each}
	</ul>
</Panel>

<style>
	.layers {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: 5px;
		padding: 1px 2px;
	}
	li.active {
		background: var(--accent-dim);
		outline: 1px solid var(--accent);
	}
	.row {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		color: var(--text);
		cursor: pointer;
		text-align: left;
		padding: 4px 2px;
		min-width: 0;
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badge {
		width: 16px;
		height: 16px;
		border-radius: 3px;
		display: grid;
		place-items: center;
		font-size: 10px;
		font-weight: 700;
		color: #0d0b18;
		flex: none;
	}
	.eye {
		background: none;
		border: none;
		color: var(--muted);
		cursor: pointer;
		width: 18px;
		height: 18px;
		display: grid;
		place-items: center;
		padding: 0;
	}
	.eye.off {
		color: #555;
	}
	.ops {
		display: flex;
		gap: 1px;
		opacity: 0;
	}
	li:hover .ops {
		opacity: 1;
	}
	.icon-btn {
		background: var(--panel);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 4px;
		cursor: pointer;
		width: 18px;
		height: 18px;
		font-size: 9px;
		display: grid;
		place-items: center;
		padding: 0;
	}
	.icon-btn:hover {
		background: var(--accent-dim);
	}
	.icon-btn.danger:hover {
		background: #5a2530;
	}
	.mini {
		background: var(--panel);
		border: 1px solid var(--border);
		color: var(--text);
		border-radius: 4px;
		font-size: 10px;
		padding: 1px 2px;
	}
</style>
