/**
 * Where the editor reads and writes projects. The default backend talks to the dev-server
 * middleware the library's vite plugin mounts (`pixi-vania/vite`); swap it via `setProjectStore`
 * for anything else (File System Access, a real API, in-memory tests).
 */

import { SVLEVEL_FORMAT, type SvLevelProject } from '../../format/types';

export interface AssetInfo {
	path: string;
	name: string;
	size: number;
}

export interface ProjectStore {
	/** Public paths of every project the backend can see. */
	list(): Promise<string[]>;
	load(path: string): Promise<SvLevelProject>;
	save(path: string, data: SvLevelProject): Promise<void>;
	/** Image assets available for tileset import; omit when the backend has no asset directory. */
	listAssets?(): Promise<AssetInfo[]>;
	/** Write a binary asset (base64 or data URL) next to the project. */
	uploadAsset?(path: string, base64: string): Promise<void>;
}

const assertProject = (data: unknown, path: string): SvLevelProject => {
	const p = data as SvLevelProject;
	if (!p || p.format !== SVLEVEL_FORMAT) throw new Error(`not a .svlevel file: ${path}`);
	return p;
};

const json = async (res: Response, what: string): Promise<unknown> => {
	if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text().catch(() => '')}`);
	return res.json();
};

/** Backend for the library's vite plugin: static files in, saves through `/__svlevel`. */
export function devServerStore(api = '/__svlevel'): ProjectStore {
	const post = (route: string, body: unknown) =>
		fetch(`${api}/${route}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
	return {
		async list() {
			return (await json(await fetch(`${api}/projects`), 'listProjects') as { projects: string[] })
				.projects;
		},
		async load(path) {
			const res = await fetch(path, { cache: 'no-store' });
			return assertProject(await json(res, 'loadProject'), path);
		},
		async save(path, data) {
			await json(await post('save', { path, data }), 'saveProject');
		},
		async listAssets() {
			return (await json(await fetch(`${api}/assets`), 'listAssets') as { assets: AssetInfo[] })
				.assets;
		},
		async uploadAsset(path, base64) {
			await json(await post('upload', { path, base64 }), 'uploadAsset');
		}
	};
}

/**
 * Read-only backend over plain `fetch`. Saving throws, so the editor falls back to
 * "Export" (download) — the right default for a statically-hosted editor.
 */
export function staticStore(projects: string[] = []): ProjectStore {
	return {
		list: async () => projects,
		async load(path) {
			const res = await fetch(path, { cache: 'no-store' });
			return assertProject(await json(res, 'loadProject'), path);
		},
		async save() {
			throw new Error('read-only backend — use Export to download the project');
		}
	};
}

let active: ProjectStore = devServerStore();

export const setProjectStore = (store: ProjectStore): void => void (active = store);
export const projectStore = (): ProjectStore => active;

export const listProjects = (): Promise<string[]> => active.list();
export const loadProject = (path: string): Promise<SvLevelProject> => active.load(path);
export const saveProject = (path: string, data: SvLevelProject): Promise<void> =>
	active.save(path, data);
export const listAssets = (): Promise<AssetInfo[]> => active.listAssets?.() ?? Promise.resolve([]);
export const uploadAsset = (path: string, base64: string): Promise<void> => {
	if (!active.uploadAsset) throw new Error('this backend cannot upload assets');
	return active.uploadAsset(path, base64);
};
