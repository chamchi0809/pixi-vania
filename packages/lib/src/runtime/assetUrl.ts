export type BasePathKind = 'directory' | 'project-file';

const fallbackBaseUrl = (): string =>
	typeof document !== 'undefined' ? document.baseURI : 'http://localhost/';

/** Resolve a tileset path against either an asset directory or the project file itself. */
export function resolveAssetUrl(
	basePath: string,
	relPath: string,
	kind: BasePathKind = 'directory'
): string {
	if (!basePath) return relPath;
	const base = new URL(basePath, fallbackBaseUrl());
	if (kind === 'project-file') return new URL(relPath, base).href;
	if (!base.pathname.endsWith('/')) base.pathname += '/';
	return new URL(relPath, base).href;
}
