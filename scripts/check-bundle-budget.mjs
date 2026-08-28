import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = new URL('../packages/demo/dist/', import.meta.url);
const html = await fs.readFile(new URL('index.html', dist), 'utf8');
const initialFiles = [
	...html.matchAll(/<script[^>]+src="\.\/([^"]+\.js)"/g),
	...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\.\/([^"]+\.js)"/g)
].map((match) => match[1]);

let initialGzip = 0;
for (const file of new Set(initialFiles)) initialGzip += gzipSync(await fs.readFile(new URL(file, dist))).byteLength;
const assetDir = new URL('assets/', dist);
const chunks = (await fs.readdir(assetDir)).filter((file) => file.endsWith('.js'));
const sizes = await Promise.all(chunks.map(async (file) => ({
	file,
	gzip: gzipSync(await fs.readFile(new URL(file, assetDir))).byteLength
})));
const largest = sizes.reduce((current, candidate) => current.gzip > candidate.gzip ? current : candidate);

const KiB = 1024;
if (initialGzip > 80 * KiB) throw new Error(`initial JS budget exceeded: ${(initialGzip / KiB).toFixed(1)} KiB > 80 KiB`);
if (largest.gzip > 800 * KiB) throw new Error(`lazy chunk budget exceeded: ${largest.file} ${(largest.gzip / KiB).toFixed(1)} KiB > 800 KiB`);
const editor = sizes.find((item) => item.file.startsWith('editor-'));
if (editor && editor.gzip > 130 * KiB) throw new Error(`editor chunk budget exceeded: ${(editor.gzip / KiB).toFixed(1)} KiB > 130 KiB`);

console.log(`bundle budget: initial ${(initialGzip / KiB).toFixed(1)} KiB gzip; largest lazy ${path.basename(largest.file)} ${(largest.gzip / KiB).toFixed(1)} KiB gzip`);
