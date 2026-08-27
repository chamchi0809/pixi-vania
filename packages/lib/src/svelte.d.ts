/**
 * ponytail: `.svelte` files are shimmed instead of run through svelte2tsx -- nothing the package
 * exports leaks a component type, so `tsc` only needs the imports to resolve.
 */
declare module '*.svelte' {
	const component: import('svelte').Component<Record<string, unknown>>;
	export default component;
}
