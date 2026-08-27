/** Pure helpers for the project's localization table (see `SvLocalization` in `./types`). */

import { parseScript } from './dialogue';
import type { SvLevelProject, SvLocalization } from './types';
import { getEntityTypeDef } from './types';

export const emptyLocalization = (): SvLocalization => ({ locales: [], entries: [] });

/**
 * Unique non-empty source strings from every entity field marked `localized`, in first-seen order.
 * `Dialogue` fields contribute one string per line. Matched exactly (no trimming) so they line up
 * with `localize`; whitespace-only values are skipped.
 */
export function collectLocalizableStrings(project: SvLevelProject): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	const add = (raw: unknown) => {
		if (typeof raw !== 'string' || !raw.trim() || seen.has(raw)) return;
		seen.add(raw);
		out.push(raw);
	};
	for (const level of project.levels) {
		for (const li of level.layers) {
			if (li.type !== 'Entities') continue;
			for (const e of li.entities) {
				const def = getEntityTypeDef(project, e.type);
				for (const f of def?.fields ?? []) {
					if (!f.localized) continue;
					if (f.type === 'Dialogue') for (const line of parseScript(e.fields[f.id])) add(line.text);
					else add(e.fields[f.id]);
				}
			}
		}
	}
	return out;
}

/** Translate a source string. Unknown key or missing locale falls back to the key itself. */
export function localize(
	loc: SvLocalization | undefined,
	key: string,
	locale: string | undefined
): string {
	if (!loc || !locale) return key;
	return loc.entries.find((e) => e.key === key)?.values[locale] || key;
}
