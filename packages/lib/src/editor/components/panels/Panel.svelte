<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		actions,
		children,
		grow = false
	}: {
		title: string;
		actions?: Snippet;
		children: Snippet;
		grow?: boolean;
	} = $props();
</script>

<section class="panel" class:grow>
	<header>
		<span class="title">{title}</span>
		{#if actions}
			<div class="actions">{@render actions()}</div>
		{/if}
	</header>
	<div class="body">
		{@render children()}
	</div>
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border-bottom: 1px solid var(--border);
	}
	.panel.grow {
		flex: 1;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		padding: 5px 8px;
		background: var(--panel-2);
		border-bottom: 1px solid var(--border);
	}
	.title {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--muted);
	}
	.actions {
		display: flex;
		gap: 3px;
	}
	.body {
		overflow: auto;
		min-height: 0;
		padding: 6px;
	}
	.panel.grow .body {
		flex: 1;
	}
</style>
