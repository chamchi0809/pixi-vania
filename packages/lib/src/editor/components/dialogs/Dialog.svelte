<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
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
	let dialogEl = $state<HTMLDivElement>();
	const titleId = `sv-dialog-${nextDialogId()}`;

	const focusable = () =>
		[...(dialogEl?.querySelectorAll<HTMLElement>(
			'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
		) ?? [])].filter((element) => !element.hidden && element.getClientRects().length > 0);

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			onclose();
		} else if (e.key === 'Tab') {
			const items = focusable();
			if (!items.length) return e.preventDefault();
			const first = items[0]!;
			const last = items.at(-1)!;
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		}
	}

	// Svelte transitions are JS-driven, so the CSS reduced-motion override can't reach them.
	const ms = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 160;

	onMount(() => {
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const closestEditor = dialogEl?.closest('.editor');
		const editorRoot = closestEditor instanceof HTMLElement ? closestEditor : null;
		const overlay = dialogEl?.parentElement;
		const inerted: HTMLElement[] = [];
		for (const child of editorRoot?.children ?? []) {
			if (child !== overlay && child instanceof HTMLElement && !child.inert) {
				child.inert = true;
				inerted.push(child);
			}
		}
		// Also exclude host UI outside the editor mount (for example the demo's Tweakpane overlay)
		// from pointer and keyboard navigation while this modal is open.
		let bodyBranch: HTMLElement | null = editorRoot;
		while (bodyBranch?.parentElement && bodyBranch.parentElement !== document.body)
			bodyBranch = bodyBranch.parentElement;
		for (const child of document.body.children) {
			if (child !== bodyBranch && child instanceof HTMLElement && !child.inert) {
				child.inert = true;
				inerted.push(child);
			}
		}
		queueMicrotask(() => (focusable()[0] ?? dialogEl)?.focus());
		return () => {
			for (const child of inerted) child.inert = false;
			queueMicrotask(() => previous?.isConnected && previous.focus());
		};
	});
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
		bind:this={dialogEl}
		class="dialog"
		style="width:{width}px"
		role="dialog"
		aria-modal="true"
		aria-labelledby={titleId}
		tabindex="-1"
		transition:scale={{ duration: ms, start: 0.96, opacity: 0, easing: cubicOut }}
	>
		<header>
			<span class="title" id={titleId}>{title}</span>
			<button class="x" aria-label="Close {title}" use:tooltip={'Close (Esc)'} onclick={onclose}>
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
		z-index: 10000;
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

<script lang="ts" module>
	let dialogSequence = 0;
	function nextDialogId() {
		return ++dialogSequence;
	}
</script>
