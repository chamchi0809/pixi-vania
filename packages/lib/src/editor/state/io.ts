/**
 * Where the editor reads and writes projects. The default backend talks to the dev-server
 * middleware the library's vite plugin mounts (`pixi-vania/vite`); swap it via `setProjectStore`
 * for anything else (File System Access, a real API, in-memory tests).
 */

import type { SvLevelProject } from '../../format/types';
import { assertProject } from '../../format/project';
import { downloadProject } from './download';

export interface AssetInfo {
	path: string;
	name: string;
	size: number;
}

export interface ProjectStore {
	/** Public paths of every project the backend can see. */
	list(): Promise<string[]>;
	load(path: string): Promise<SvLevelProject>;
	save(path: string, data: SvLevelProject): Promise<void | ProjectSaveResult>;
	/** Image assets available for tileset import; omit when the backend has no asset directory. */
	listAssets?(): Promise<AssetInfo[]>;
	/** Write a binary asset (base64 or data URL) next to the project. */
	uploadAsset?(path: string, base64: string): Promise<void>;
}

export interface ProjectSaveResult {
	revision?: string;
}

const contentRevision = (text: string): string => {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
};

const json = async (res: Response, what: string): Promise<unknown> => {
	if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text().catch(() => '')}`);
	return res.json();
};

/** Backend for the library's vite plugin: static files in, saves through `/__svlevel`. */
export function devServerStore(api = '/__svlevel'): ProjectStore {
	const revisions = new Map<string, string>();
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
				if (!res.ok) throw new Error(`loadProject failed: ${res.status} ${await res.text().catch(() => '')}`);
				const text = await res.text();
				revisions.set(path, contentRevision(text));
				return assertProject(JSON.parse(text), path);
			},
			async save(path, data) {
				const result = await json(
					await post('save', { path, data, revision: revisions.get(path) }),
					'saveProject'
				) as ProjectSaveResult;
				if (result.revision) revisions.set(path, result.revision);
				return result;
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
 * Static backend over plain `fetch`. Saving downloads the current project as JSON,
 * which keeps the normal Save button useful on hosts without a writable backend.
 */
export function staticStore(projects: string[] = []): ProjectStore {
	return {
		list: async () => projects,
		async load(path) {
			const res = await fetch(path, { cache: 'no-store' });
				return assertProject(await json(res, 'loadProject'), path);
		},
		async save(path, data) {
			downloadProject(path, data);
		}
	};
}

let active: ProjectStore = devServerStore();

export const setProjectStore = (store: ProjectStore): void => void (active = store);
export const projectStore = (): ProjectStore => active;

export const listProjects = (): Promise<string[]> => active.list();
export const loadProject = (path: string): Promise<SvLevelProject> => active.load(path);
export const saveProject = (path: string, data: SvLevelProject): Promise<void | ProjectSaveResult> =>
	active.save(path, data);
export const listAssets = (): Promise<AssetInfo[]> => active.listAssets?.() ?? Promise.resolve([]);
export const uploadAsset = (path: string, base64: string): Promise<void> => {
	if (!active.uploadAsset) throw new Error('this backend cannot upload assets');
	return active.uploadAsset(path, base64);
};
