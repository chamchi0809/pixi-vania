import assert from 'node:assert';
import { resolveAssetUrl } from './assetUrl.ts';

assert.equal(resolveAssetUrl('/assets/levels', 'tiles.png'), 'http://localhost/assets/levels/tiles.png');
assert.equal(resolveAssetUrl('/assets/levels/', 'tiles.png'), 'http://localhost/assets/levels/tiles.png');
assert.equal(
	resolveAssetUrl('https://example.test/assets/levels/demo.svlevel.json', '../tiles.png', 'project-file'),
	'https://example.test/assets/tiles.png'
);
console.log('runtime asset URLs: OK');
