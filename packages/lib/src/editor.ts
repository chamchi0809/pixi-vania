/** The level editor UI. Bundles its own Svelte runtime and styles — no Svelte setup required. */

export { mountEditor, type EditorHandle, type EditorOptions } from './editor/mount';
export {
	devServerStore,
	staticStore,
	setProjectStore,
	projectStore,
	type ProjectStore,
	type AssetInfo
} from './editor/state/io';
export { emptyProject } from './editor/state/factory';
