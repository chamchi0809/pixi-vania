/**
 * Self-check for palette remapping. Run: `node --experimental-strip-types src/lib/editor/render/paletteRemap.test.ts`
 */
import assert from 'node:assert';
import {
	extractPaletteColors,
	nearestColor,
	parseHex,
	parseHexList,
	remapPixels,
	toHex
} from './paletteRemap.ts';

assert.deepEqual(parseHex('#fff'), { r: 255, g: 255, b: 255 });
assert.deepEqual(parseHex('4a4a4a'), { r: 74, g: 74, b: 74 });
assert.throws(() => parseHex('#xyz'));

const palette = [parseHex('#000000'), parseHex('#ffffff'), parseHex('#4a4a4a')];
assert.deepEqual(nearestColor({ r: 10, g: 10, b: 10 }, palette), { r: 0, g: 0, b: 0 });
assert.deepEqual(nearestColor({ r: 240, g: 240, b: 240 }, palette), { r: 255, g: 255, b: 255 });
assert.deepEqual(nearestColor({ r: 80, g: 70, b: 75 }, palette), { r: 74, g: 74, b: 74 });

// Transparent pixels keep their (garbage) colour but stay untouched; opaque ones snap.
const px = new Uint8ClampedArray([200, 10, 10, 0, 10, 240, 10, 255]);
remapPixels(px, [parseHex('#ff0000'), parseHex('#00ff00')]);
assert.deepEqual([...px.slice(0, 4)], [200, 10, 10, 0]);
assert.deepEqual([...px.slice(4)], [0, 255, 0, 255]);

assert.equal(toHex({ r: 74, g: 74, b: 74 }), '#4a4a4a');

// Distinct opaque colours, most-frequent first; transparent pixels ignored.
const swatches = new Uint8ClampedArray([
	255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 9, 9, 9, 0
]);
assert.deepEqual(extractPaletteColors(swatches), ['#ff0000', '#0000ff']);

assert.deepEqual(parseHexList('#4a4a4a, f1f3f5\n#000 oops'), ['#4a4a4a', '#f1f3f5', '#000000']);

console.log('ok');
