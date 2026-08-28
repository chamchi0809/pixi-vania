/** Hardened dev-server storage API for the editor. */
import type { Plugin, PreviewServer, ViteDevServer } from 'vite';
import { constants, promises as fs } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as path from 'node:path';

export interface LevelEditorOptions {
	staticDir?: string;
	base?: string;
	imageExtensions?: string[];
	/** Preview is read-only unless explicitly enabled. */
	previewWrites?: boolean;
	/** Optional shared secret required as `X-Svlevel-Token` on writes. */
	writeToken?: string;
	/** Public directory prefixes allowed for uploads. Default: [`/assets/`]. */
	uploadDirectories?: string[];
	/** Uploads do not overwrite an existing file by default. */
	allowUploadOverwrite?: boolean;
	/** Existing project saves require the revision returned by the prior load. Default: true. */
	requireRevision?: boolean;
	/** Keep the previous valid project as `<file>.bak` before replacement. Default: true. */
	backupOnSave?: boolean;
	maxBodyBytes?: number;
}

interface AssetInfo {
	path: string;
	name: string;
	size: number;
}

const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const MIME_BY_EXT: Record<string, string[]> = {
	'.png': ['image/png'],
	'.jpg': ['image/jpeg'],
	'.jpeg': ['image/jpeg'],
	'.gif': ['image/gif'],
	'.webp': ['image/webp'],
	'.bmp': ['image/bmp']
};

const normaliseBase = (value: string): string => {
	const clean = value.trim().replace(/^\/+|\/+$/g, '');
	if (!clean) throw new Error('levelEditor base must contain at least one path segment');
	return `/${clean}`;
};

/** Same small hash is used by the browser store for optimistic save locking. */
export function contentRevision(text: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

function statusForError(error: unknown): number {
	const explicit = (error as Error & { status?: number }).status;
	if (explicit !== undefined) return explicit;
	return error instanceof SyntaxError ? 400 : 500;
}

export function levelEditor(options: LevelEditorOptions = {}): Plugin {
	const staticDirRel = options.staticDir ?? 'public';
	const base = normaliseBase(options.base ?? '/__svlevel');
	const imageExts = new Set((options.imageExtensions ?? IMAGE_EXTS).map((ext) => ext.toLowerCase()));
	const uploadRoots = (options.uploadDirectories ?? ['/assets/']).map((value) => {
		const clean = '/' + value.replace(/^\/+|\/+$/g, '');
		return clean === '/' ? clean : clean + '/';
	});
	const maxBodyBytes = options.maxBodyBytes ?? 64 * 1024 * 1024;
	const requireRevision = options.requireRevision ?? true;
	const backupOnSave = options.backupOnSave ?? true;
	let staticRoot = '';
	let staticRealRoot = '';

	const inside = (root: string, target: string): boolean => {
		const rel = path.relative(root, target);
		return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
	};

	/** Lexical + realpath containment. New files are checked against their nearest existing parent. */
	const resolveSafe = async (publicPath: string): Promise<string | null> => {
		if (!publicPath || publicPath.includes('\0')) return null;
		const abs = path.resolve(staticRoot, publicPath.replace(/^\/+/, ''));
		if (!inside(staticRoot, abs)) return null;
		let existing = abs;
		while (true) {
			try {
				const real = await fs.realpath(existing);
				if (!inside(staticRealRoot, real)) return null;
				break;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
				const parent = path.dirname(existing);
				if (parent === existing || !inside(staticRoot, parent)) return null;
				existing = parent;
			}
		}
		try {
			const realTarget = await fs.realpath(abs);
			if (!inside(staticRealRoot, realTarget)) return null;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null;
		}
		return abs;
	};

	const readBody = (req: IncomingMessage): Promise<string> =>
		new Promise((resolve, reject) => {
			const declared = Number(req.headers['content-length']);
			if (Number.isFinite(declared) && declared > maxBodyBytes) {
				req.pause();
				reject(Object.assign(new Error('payload too large'), { status: 413 }));
				return;
			}
			const chunks: Buffer[] = [];
			let bytes = 0;
			let settled = false;
			const cleanup = () => {
				req.off('data', onData);
				req.off('end', onEnd);
				req.off('error', onError);
			};
			const fail = (error: Error) => {
				if (settled) return;
				settled = true;
				cleanup();
				req.pause();
				reject(error);
			};
			const onData = (chunk: Buffer | string) => {
				const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
				bytes += buffer.byteLength;
				if (bytes > maxBodyBytes) return fail(Object.assign(new Error('payload too large'), { status: 413 }));
				chunks.push(buffer);
			};
			const onEnd = () => {
				if (settled) return;
				settled = true;
				cleanup();
				resolve(Buffer.concat(chunks).toString('utf8'));
			};
			const onError = (error: Error) => fail(error);
			req.on('data', onData);
			req.on('end', onEnd);
			req.on('error', onError);
		});

	const json = (res: ServerResponse, status: number, data: unknown) => {
		res.statusCode = status;
		res.setHeader('Content-Type', 'application/json; charset=utf-8');
		res.setHeader('Cache-Control', 'no-store');
		res.end(JSON.stringify(data));
	};

	const sameOrigin = (req: IncomingMessage): boolean => {
		if (req.headers['sec-fetch-site'] === 'cross-site') return false;
		if (!req.headers.origin) return true;
		try {
			return new URL(req.headers.origin).host === req.headers.host;
		} catch {
			return false;
		}
	};

	const writeAllowed = (req: IncomingMessage, canWrite: boolean): string | null => {
		if (!canWrite) return 'writes are disabled on preview';
		if (!sameOrigin(req)) return 'cross-origin writes are forbidden';
		if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json'))
			return 'Content-Type must be application/json';
		if (options.writeToken && req.headers['x-svlevel-token'] !== options.writeToken)
			return 'invalid write token';
		return null;
	};

	async function walkFiles<T>(
		dir: string,
		accept: (entry: import('node:fs').Dirent, full: string) => Promise<T | undefined>
	): Promise<T[]> {
		const out: T[] = [];
		const walk = async (abs: string) => {
			let entries: import('node:fs').Dirent[];
			try { entries = await fs.readdir(abs, { withFileTypes: true }); } catch { return; }
			for (const entry of entries) {
				const full = path.join(abs, entry.name);
				// Never follow symlinked directories or files while exposing the sandbox inventory.
				if (entry.isSymbolicLink()) continue;
				if (entry.isDirectory()) await walk(full);
				else {
					const value = await accept(entry, full);
					if (value !== undefined) out.push(value);
				}
			}
		};
		await walk(dir);
		return out;
	}

	const walkImages = () => walkFiles(staticRoot, async (entry, full) => {
		if (!imageExts.has(path.extname(entry.name).toLowerCase())) return;
		const stat = await fs.stat(full);
		const rel = path.relative(staticRoot, full).split(path.sep).join('/');
		return { path: '/' + rel, name: entry.name, size: stat.size } satisfies AssetInfo;
	}).then((items) => items.sort((a, b) => a.path.localeCompare(b.path)));

	const walkProjects = () => walkFiles(staticRoot, async (entry, full) => {
		if (!entry.name.endsWith('.svlevel.json')) return;
		return '/' + path.relative(staticRoot, full).split(path.sep).join('/');
	}).then((items) => items.sort());

	const atomicWrite = async (target: string, data: string | Buffer, backup: boolean) => {
		await fs.mkdir(path.dirname(target), { recursive: true });
		const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
		const file = await fs.open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		try {
			await file.writeFile(data);
			await file.sync();
		} finally {
			await file.close();
		}
		try {
			if (backup) await fs.copyFile(target, target + '.bak');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				await fs.unlink(tmp).catch(() => {});
				throw error;
			}
		}
		try { await fs.rename(tmp, target); } catch (error) {
			await fs.unlink(tmp).catch(() => {});
			throw error;
		}
	};

	const attach = async (server: ViteDevServer | PreviewServer, canWrite: boolean) => {
		staticRoot = path.resolve(server.config.root, staticDirRel);
		await fs.mkdir(staticRoot, { recursive: true });
		staticRealRoot = await fs.realpath(staticRoot);

		server.middlewares.use(async (req, res, next) => {
			if (!req.url) return next();
			let pathname: string;
			try { pathname = new URL(req.url, 'http://local').pathname; } catch { return next(); }
			const route = pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : '';
			const known = ['/assets', '/projects', '/save', '/upload'];
			if (!known.includes(route)) return next();

			try {
				if (req.method === 'GET' && route === '/assets') return json(res, 200, { assets: await walkImages() });
				if (req.method === 'GET' && route === '/projects') return json(res, 200, { projects: await walkProjects() });
				if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' });
				const denied = writeAllowed(req, canWrite);
				if (denied) return json(res, 403, { error: denied });
				const payload = JSON.parse(await readBody(req)) as Record<string, unknown>;

				if (route === '/save') {
					const p = payload.path;
					if (typeof p !== 'string' || !p.endsWith('.svlevel.json')) return json(res, 400, { error: 'path must be a *.svlevel.json file' });
					const abs = await resolveSafe(p);
					if (!abs) return json(res, 403, { error: 'path escapes static root' });
					let current: string | undefined;
					try { current = await fs.readFile(abs, 'utf8'); } catch (error) {
						if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
					}
					if (current !== undefined && requireRevision) {
						const actual = contentRevision(current);
						if (payload.revision !== actual) return json(res, 409, { error: 'project changed on disk', revision: actual });
					}
					const text = JSON.stringify(payload.data, null, '\t') + '\n';
					await atomicWrite(abs, text, backupOnSave && current !== undefined);
					const revision = contentRevision(text);
					server.config.logger.info(`[pixi-vania] saved ${p}`);
					return json(res, 200, { ok: true, path: p, revision });
				}

				const p = payload.path;
				const base64 = payload.base64;
				if (typeof p !== 'string' || typeof base64 !== 'string') return json(res, 400, { error: 'expected { path, base64 }' });
				const publicPath = '/' + p.replace(/^\/+/, '');
				if (!uploadRoots.some((root) => root === '/' || publicPath.startsWith(root))) return json(res, 403, { error: 'upload path is outside allowed directories' });
				const ext = path.extname(publicPath).toLowerCase();
				if (!imageExts.has(ext)) return json(res, 415, { error: 'file extension is not allowed' });
				const match = /^data:([^;,]+);base64,([a-zA-Z0-9+/=\s]+)$/.exec(base64);
				if (!match || !(MIME_BY_EXT[ext] ?? []).includes(match[1]!.toLowerCase())) return json(res, 415, { error: 'MIME type does not match file extension' });
				const abs = await resolveSafe(publicPath);
				if (!abs) return json(res, 403, { error: 'path escapes static root' });
				if (!options.allowUploadOverwrite) {
					try { await fs.access(abs); return json(res, 409, { error: 'asset already exists' }); }
					catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
				}
				await atomicWrite(abs, Buffer.from(match[2]!, 'base64'), false);
				return json(res, 201, { ok: true, path: publicPath });
			} catch (error) {
				return json(res, statusForError(error), { error: (error as Error).message });
			}
		});
	};

	return {
		name: 'pixi-vania',
		apply: 'serve',
		configureServer: async (server) => attach(server, true),
		configurePreviewServer: async (server) => attach(server, options.previewWrites === true)
	};
}

export default levelEditor;
