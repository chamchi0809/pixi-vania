/**
 * Dev-server middleware that lets the editor write to disk. Without it the editor is read-only
 * and falls back to Import/Export. Routes (see `devServerStore` in `editor/state/io`):
 *
 *   GET  /__svlevel/projects        -> { projects: string[] }   (public paths to *.svlevel.json)
 *   GET  /__svlevel/assets          -> { assets: AssetInfo[] }  (images under the static dir)
 *   POST /__svlevel/save            -> body { path, data }      writes pretty JSON
 *   POST /__svlevel/upload          -> body { path, base64 }    writes a binary asset
 *
 * All paths are sandboxed to the served static directory; traversal is rejected.
 */
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as url from 'node:url';

export interface LevelEditorOptions {
	/** Static dir served at `/`, relative to project root. Default: `public`. */
	staticDir?: string;
	/** API mount prefix. Default: `/__svlevel`. */
	base?: string;
	/** Image extensions surfaced by the asset listing. */
	imageExtensions?: string[];
}

interface AssetInfo {
	/** Public URL path, e.g. `/assets/levels/tileset.png`. */
	path: string;
	name: string;
	size: number;
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];

export function levelEditor(options: LevelEditorOptions = {}): Plugin {
	const staticDirRel = options.staticDir ?? 'public';
	const base = (options.base ?? '/__svlevel').replace(/\/$/, '');
	const imageExts = options.imageExtensions ?? IMAGE_EXTS;

	let staticRoot = '';

	/** Resolve a public path (`/assets/...`) to an absolute fs path, sandboxed to staticRoot. */
	const resolveSafe = (publicPath: string): string | null => {
		const clean = publicPath.replace(/^\/+/, '');
		const abs = path.resolve(staticRoot, clean);
		const rel = path.relative(staticRoot, abs);
		if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
		return abs;
	};

	const readBody = (req: import('http').IncomingMessage): Promise<string> =>
		new Promise((resolve, reject) => {
			let body = '';
			req.on('data', (c) => {
				body += c;
				if (body.length > 64 * 1024 * 1024) reject(new Error('payload too large'));
			});
			req.on('end', () => resolve(body));
			req.on('error', reject);
		});

	const json = (res: import('http').ServerResponse, status: number, data: unknown) => {
		res.statusCode = status;
		res.setHeader('Content-Type', 'application/json');
		res.end(JSON.stringify(data));
	};

	async function walkImages(dir: string): Promise<AssetInfo[]> {
		const out: AssetInfo[] = [];
		const walk = async (abs: string) => {
			let entries: import('node:fs').Dirent[];
			try {
				entries = await fs.readdir(abs, { withFileTypes: true });
			} catch {
				return;
			}
			for (const e of entries) {
				const full = path.join(abs, e.name);
				if (e.isDirectory()) {
					await walk(full);
				} else if (imageExts.includes(path.extname(e.name).toLowerCase())) {
					const stat = await fs.stat(full);
					const rel = path.relative(staticRoot, full).split(path.sep).join('/');
					out.push({ path: '/' + rel, name: e.name, size: stat.size });
				}
			}
		};
		await walk(dir);
		return out.sort((a, b) => a.path.localeCompare(b.path));
	}

	async function walkProjects(dir: string): Promise<string[]> {
		const out: string[] = [];
		const walk = async (abs: string) => {
			let entries: import('node:fs').Dirent[];
			try {
				entries = await fs.readdir(abs, { withFileTypes: true });
			} catch {
				return;
			}
			for (const e of entries) {
				const full = path.join(abs, e.name);
				if (e.isDirectory()) await walk(full);
				else if (e.name.endsWith('.svlevel.json')) {
					const rel = path.relative(staticRoot, full).split(path.sep).join('/');
					out.push('/' + rel);
				}
			}
		};
		await walk(dir);
		return out.sort();
	}

	const attach = (server: ViteDevServer | PreviewServer) => {
		staticRoot = path.resolve(server.config.root, staticDirRel);

		server.middlewares.use(async (req, res, next) => {
			if (!req.url || !req.url.startsWith(base + '/')) return next();
			const parsed = url.parse(req.url, true);
			const route = (parsed.pathname ?? '').slice(base.length);

			try {
				if (req.method === 'GET' && route === '/assets') {
					return json(res, 200, { assets: await walkImages(staticRoot) });
				}
				if (req.method === 'GET' && route === '/projects') {
					return json(res, 200, { projects: await walkProjects(staticRoot) });
				}
				if (req.method === 'POST' && route === '/save') {
					const { path: p, data } = JSON.parse(await readBody(req));
					if (typeof p !== 'string' || !p.endsWith('.svlevel.json')) {
						return json(res, 400, { error: 'path must be a *.svlevel.json file' });
					}
					const abs = resolveSafe(p);
					if (!abs) return json(res, 403, { error: 'path escapes static root' });
					await fs.mkdir(path.dirname(abs), { recursive: true });
					await fs.writeFile(abs, JSON.stringify(data, null, '\t') + '\n');
					server.config.logger.info(`[pixi-vania] saved ${p}`);
					return json(res, 200, { ok: true, path: p });
				}
				if (req.method === 'POST' && route === '/upload') {
					const { path: p, base64 } = JSON.parse(await readBody(req));
					if (typeof p !== 'string' || typeof base64 !== 'string') {
						return json(res, 400, { error: 'expected { path, base64 }' });
					}
					const abs = resolveSafe(p);
					if (!abs) return json(res, 403, { error: 'path escapes static root' });
					await fs.mkdir(path.dirname(abs), { recursive: true });
					await fs.writeFile(abs, Buffer.from(base64.replace(/^data:[^,]+,/, ''), 'base64'));
					return json(res, 200, { ok: true, path: p });
				}
				return json(res, 404, { error: `unknown route ${route}` });
			} catch (err) {
				return json(res, 500, { error: (err as Error).message });
			}
		});
	};

	return {
		name: 'pixi-vania',
		apply: 'serve',
		configureServer: attach,
		configurePreviewServer: attach
	};
}

export default levelEditor;
