/**
 * Snap every pixel of a sprite to its nearest colour in a target palette. Pure RGB math (testable in
 * node); the canvas decode/encode helper lives at the bottom and is the only DOM-touching part.
 */

export interface RGB {
	r: number;
	g: number;
	b: number;
}

/** `#rgb`/`#rrggbb` -> RGB (0-255). Throws on garbage so a bad palette entry fails loudly. */
export function parseHex(hex: string): RGB {
	let h = hex.trim().replace(/^#/, '');
	if (h.length === 3) h = h.replace(/./g, (c) => c + c);
	if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`bad hex: ${hex}`);
	const n = parseInt(h, 16);
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Extract every hex colour from free text (comma/space/newline separated), normalised to `#rrggbb`. */
export function parseHexList(text: string): string[] {
	const out: string[] = [];
	for (const m of text.matchAll(/#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g)) {
		try {
			out.push(toHex(parseHex(m[0])));
		} catch {
			// skip garbage tokens
		}
	}
	return out;
}

/** Nearest palette colour by squared RGB distance. */
export function nearestColor(px: RGB, palette: readonly RGB[]): RGB {
	let best = palette[0];
	let bestD = Infinity;
	for (const c of palette) {
		const dr = px.r - c.r;
		const dg = px.g - c.g;
		const db = px.b - c.b;
		const d = dr * dr + dg * dg + db * db;
		if (d < bestD) {
			bestD = d;
			best = c;
		}
	}
	return best!;
}

/**
 * Rewrite RGBA bytes in place: each pixel's colour snaps to the nearest palette entry; alpha is kept
 * (fully-transparent pixels are skipped so they don't leak a colour into premultiply). Returns `data`.
 */
export function remapPixels(data: Uint8ClampedArray, palette: readonly RGB[]): Uint8ClampedArray {
	if (!palette.length) return data;
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] === 0) continue;
		const c = nearestColor({ r: data[i]!, g: data[i + 1]!, b: data[i + 2]! }, palette);
		data[i] = c.r;
		data[i + 1] = c.g;
		data[i + 2] = c.b;
	}
	return data;
}

/** `#rrggbb` for an RGB triple. */
export function toHex({ r, g, b }: RGB): string {
	return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/**
 * Pull distinct opaque colours out of a palette sprite, most-frequent first, capped at `maxColors`.
 * Exact-match counting (palette sprites are flat swatches), so no clustering needed.
 */
export function extractPaletteColors(data: Uint8ClampedArray, maxColors = 32): string[] {
	const counts = new Map<number, number>();
	for (let i = 0; i < data.length; i += 4) {
		if (data[i + 3] === 0) continue;
		const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
		counts.set(key, (counts.get(key) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, maxColors)
		.map(([key]) => toHex({ r: (key >> 16) & 255, g: (key >> 8) & 255, b: key & 255 }));
}

/** Browser-only: decode an image and pull its distinct colours as a hex palette. */
export async function extractPaletteFromImage(src: string, maxColors = 32): Promise<string[]> {
	const { id } = await imageData(src);
	return extractPaletteColors(id.data, maxColors);
}

/** Browser-only: decode a data/URL image, snap to palette, re-encode as a PNG data URL. */
export async function remapImageToPalette(src: string, hexPalette: string[]): Promise<string> {
	const palette = hexPalette.map(parseHex);
	const { id, ctx, canvas } = await imageData(src);
	remapPixels(id.data, palette);
	ctx.putImageData(id, 0, 0);
	return canvas.toDataURL('image/png');
}

/** Browser-only: decode an image URL onto a canvas and read back its pixels. */
async function imageData(
	src: string
): Promise<{ id: ImageData; ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement }> {
	const img = await new Promise<HTMLImageElement>((resolve, reject) => {
		const el = new Image();
		el.crossOrigin = 'anonymous';
		el.onload = () => resolve(el);
		el.onerror = () => reject(new Error('failed to decode image'));
		el.src = src;
	});
	const canvas = document.createElement('canvas');
	canvas.width = img.naturalWidth;
	canvas.height = img.naturalHeight;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('no 2d context');
	ctx.imageSmoothingEnabled = false;
	ctx.drawImage(img, 0, 0);
	return { id: ctx.getImageData(0, 0, canvas.width, canvas.height), ctx, canvas };
}
