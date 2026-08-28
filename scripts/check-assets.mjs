import { promises as fs } from 'node:fs';
import path from 'node:path';

const roots = ['packages/demo/public', 'docs'];
const extensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const inventory = await fs.readFile(new URL('../ASSETS.md', import.meta.url), 'utf8');
const files = [];

async function walk(directory) {
	let entries;
	try {
		entries = await fs.readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error.code === 'ENOENT') return;
		throw error;
	}
	for (const entry of entries) {
		const full = path.join(directory, entry.name);
		if (entry.isDirectory()) await walk(full);
		else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(full.split(path.sep).join('/'));
	}
}

for (const root of roots) await walk(root);
const missing = files.filter((file) => {
	if (inventory.includes(`\`${file}\``)) return false;
	const wildcard = `${path.posix.dirname(file)}/*${path.posix.extname(file).toLowerCase()}`;
	return !inventory.includes(`\`${wildcard}\``);
});

if (missing.length) {
	throw new Error(`binary assets missing from ASSETS.md:\n${missing.join('\n')}`);
}
console.log(`asset provenance: ${files.length} files covered`);
