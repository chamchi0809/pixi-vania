import assert from 'node:assert';
import type { SvLevelProject } from '../../format/types.ts';
import { downloadProject } from './download.ts';

const originalDocument = globalThis.document;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

let clicked = false;
let downloadedBlob: Blob | undefined;
let revokedUrl = '';
const anchor = {
	href: '',
	download: '',
	click: () => void (clicked = true)
} as HTMLAnchorElement;

Object.defineProperty(globalThis, 'document', {
	configurable: true,
	value: { createElement: () => anchor } as unknown as Document
});
URL.createObjectURL = (blob) => {
	downloadedBlob = blob as Blob;
	return 'blob:project';
};
URL.revokeObjectURL = (url) => void (revokedUrl = url);

try {
	const project = { format: 'svlevel' } as SvLevelProject;
	const fileName = downloadProject(
		'https://example.com/pixi-vania/assets/levels/demo.svlevel.json?cache=1',
		project
	);

	assert.equal(fileName, 'demo.svlevel.json');
	assert.equal(anchor.download, fileName);
	assert.equal(anchor.href, 'blob:project');
	assert.ok(clicked);
	assert.equal(revokedUrl, 'blob:project');
	assert.equal(await downloadedBlob?.text(), JSON.stringify(project, null, '\t'));
} finally {
	Object.defineProperty(globalThis, 'document', { configurable: true, value: originalDocument });
	URL.createObjectURL = originalCreateObjectURL;
	URL.revokeObjectURL = originalRevokeObjectURL;
}

console.log('project download: OK');
