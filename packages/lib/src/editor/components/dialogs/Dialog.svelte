<script lang="ts">
	import type { Snippet } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { tooltip } from '../common/tooltip';
	import IconX from '@tabler/icons-svelte/icons/x';

	let {
		title,
		onclose,
		children,
		footer,
		width = 640
	}: {
		title: string;
		onclose: () => void;
		children: Snippet;
		footer?: Snippet;
		width?: number;
	} = $props();

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	// Svelte transitions are JS-driven, so the CSS reduced-motion override can't reach them.
	const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;
</script>

<svelte:window {onkeydown} />

<div
	class="overlay"
	role="presentation"
	transition:fade={{ duration: ms, easing: cubicOut }}
	onpointerdown={(e) => {
		if (e.target === e.currentTarget) onclose();
	}}
>
	<div
		class="dialog"
		style="width:{width}px"
		role="dialog"
		aria-modal="true"
		aria-label={title}
		transition:scale={{ duration: ms, start: 0.96, opacity: 0, easing: cubicOut }}
	>
		<header>
			<span class="title">{title}</span>
			<button class="x" use:tooltip={'Close (Esc)'} onclick={onclose}>
				<IconX size={16} />
			</button>
		</header>
		<div class="body">
			{@render children()}
		</div>
		{#if footer}
			<footer>{@render footer()}</footer>
		{/if}
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		z-index: 100;
	}
	.dialog {
		max-width: 92vw;
		max-height: 88vh;
		display: flex;
		flex-direction: column;
		background: var(--panel, #211d38);
		color: var(--text, #cdd4a5);
		border: 1px solid var(--border, #3b405e);
		border-radius: 8px;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
		font:
			12px/1.4 ui-sans-serif,
			system-ui,
			sans-serif;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background: var(--panel-2, #2e2a4f);
		border-bottom: 1px solid var(--border, #3b405e);
		border-radius: 8px 8px 0 0;
	}
	.title {
		font-weight: 700;
		letter-spacing: 0.03em;
	}
	.x {
		background: none;
		border: none;
		color: var(--muted, #af7e7f);
		cursor: pointer;
		display: grid;
		place-items: center;
		padding: 0;
	}
	.x:hover {
		color: var(--text, #fff);
	}
	.body {
		overflow: auto;
		padding: 12px;
		min-height: 0;
	}
	footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 10px 12px;
		border-top: 1px solid var(--border, #3b405e);
	}
</style>
