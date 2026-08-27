import assert from 'node:assert';
import { tilesetImageUrl } from './images.ts';

const originalLocation = globalThis.location;
Object.defineProperty(globalThis, 'location', {
	configurable: true,
	value: { href: 'https://chamchi0809.github.io/pixi-vania/' }
});

try {
	assert.equal(
		tilesetImageUrl(
			'https://chamchi0809.github.io/pixi-vania/assets/levels/',
			'../tileset.png'
		),
		'https://chamchi0809.github.io/pixi-vania/assets/tileset.png'
	);
	assert.equal(
		tilesetImageUrl('/pixi-vania/assets/levels', '../Dungeon Tile Set.png'),
		'https://chamchi0809.github.io/pixi-vania/assets/Dungeon%20Tile%20Set.png'
	);
} finally {
	Object.defineProperty(globalThis, 'location', { configurable: true, value: originalLocation });
}

console.log('tileset image URLs: OK');
