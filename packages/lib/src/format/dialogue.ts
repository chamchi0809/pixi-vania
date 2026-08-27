/**
 * In-game dialogue model. A Dialogue entity stores its whole script as a JSON string in its
 * `Script` field (so `.svlevel` needs no new field type); these helpers parse/serialise it.
 */

export type DialogueSpeaker =
	/** No character — shown at the Dialogue entity's own position. */
	| 'none'
	/** Spoken by the player — shown as a speech bubble tracking the player. */
	| 'player'
	/** A named character. No NPC system yet, so it renders at the entity position with the name. */
	| 'character';

export interface DialogueLine {
	speaker: DialogueSpeaker;
	/** Display name for `speaker: 'character'`; ignored otherwise. */
	character?: string;
	text: string;
}

/** Tolerant parse of a stored `Script` field into lines (bad/legacy data -> empty). */
export const parseScript = (raw: unknown): DialogueLine[] => {
	if (typeof raw !== 'string' || !raw.trim()) return [];
	try {
		const v = JSON.parse(raw);
		if (!Array.isArray(v)) return [];
		return v
			.filter((l): l is Record<string, unknown> => !!l && typeof l.text === 'string')
			.map((l): DialogueLine => {
				const speaker: DialogueSpeaker =
					l.speaker === 'player' || l.speaker === 'character' ? l.speaker : 'none';
				const text = l.text as string;
				return typeof l.character === 'string'
					? { speaker, character: l.character, text }
					: { speaker, text };
			});
	} catch {
		return [];
	}
};

export const serializeScript = (lines: DialogueLine[]): string => JSON.stringify(lines);
