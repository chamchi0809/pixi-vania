import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { levelEditor } from './plugin.ts';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixi-vania-vite-'));
const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'pixi-vania-outside-'));
await fs.mkdir(path.join(root, 'public/assets'), { recursive: true });
await fs.symlink(outside, path.join(root, 'public/link'));

const server = await createServer({
	root,
	configFile: false,
	logLevel: 'silent',
	plugins: [levelEditor({ maxBodyBytes: 256 })],
	server: { host: '127.0.0.1', port: 0 }
});

try {
	await server.listen();
	const address = server.httpServer!.address();
	assert.ok(address && typeof address === 'object');
	const origin = `http://127.0.0.1:${address.port}`;
	const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
		fetch(`${origin}/__svlevel/${route}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body: JSON.stringify(body)
		});

	const listed = await fetch(`${origin}/__svlevel/projects`);
	assert.equal(listed.status, 200);
	assert.match(listed.headers.get('content-type') ?? '', /^application\/json/);

	assert.equal((await post('save', { path: '/link/escape.svlevel.json', data: {} })).status, 403);
	assert.equal((await post('save', { path: '/../escape.svlevel.json', data: {} })).status, 403);
	assert.equal((await post('save', { path: '/ok.svlevel.json', data: {} }, { Origin: 'https://evil.test' })).status, 403);

	const first = await post('save', { path: '/ok.svlevel.json', data: { format: 'svlevel' } });
	assert.equal(first.status, 200);
	const { revision } = await first.json() as { revision: string };
	assert.match(revision, /^[0-9a-f]{8}$/);
	assert.equal((await post('save', { path: '/ok.svlevel.json', data: { changed: true } })).status, 409);
	assert.equal((await post('save', { path: '/ok.svlevel.json', revision, data: { changed: true } })).status, 200);
	assert.equal(await fs.readFile(path.join(root, 'public/ok.svlevel.json.bak'), 'utf8').then((text) => text.includes('svlevel')), true);

	assert.equal((await post('upload', { path: '/assets/code.svg', base64: 'data:image/svg+xml;base64,PHN2Zz4=' })).status, 415);
	assert.equal((await post('save', { path: '/large.svlevel.json', data: 'x'.repeat(512) })).status, 413);
	console.log('vite storage boundary: OK');
} finally {
	await server.close();
	await fs.rm(root, { recursive: true, force: true });
	await fs.rm(outside, { recursive: true, force: true });
}
