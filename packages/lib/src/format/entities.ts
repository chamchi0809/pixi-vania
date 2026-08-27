/**
 * Entity type definitions. These live IN the project file (`project.entities`), so a `.svlevel`
 * is self-describing: the editor's palette, gizmos and property fields all come from here.
 */

import type { SvEntityTypeDef, SvFieldValue, SvLevelProject } from './types';

export type { SvEntityTypeDef, SvEntityFieldDef, EntityRenderMode } from './types';

export const getEntityType = (
	project: SvLevelProject | null | undefined,
	id: string
): SvEntityTypeDef | undefined => project?.entities?.find((t) => t.id === id);

/** Field id -> default value for a freshly placed instance. */
export function defaultEntityFields(
	project: SvLevelProject | null | undefined,
	id: string
): Record<string, SvFieldValue> {
	const def = getEntityType(project, id);
	if (!def) return {};
	const out: Record<string, SvFieldValue> = {};
	for (const f of def.fields) out[f.id] = structuredClone(f.default);
	return out;
}

/** A blank entity type, ready for the defs editor. */
export const makeEntityType = (id: string): SvEntityTypeDef => ({
	id,
	name: id,
	width: 16,
	height: 16,
	color: '#63c74d',
	renderMode: 'rect',
	pivot: [0, 0],
	fields: []
});
