/** Validation and migration boundary for untrusted `.svlevel` JSON. */
import {
	SVLEVEL_FORMAT,
	SVLEVEL_VERSION,
	type SvLevelProject
} from './types.ts';

export interface ProjectDiagnostic {
	severity: 'error' | 'warning';
	/** JSONPath-like location. */
	path: string;
	message: string;
	recoverable: boolean;
}

export interface ParseProjectOptions {
	/** Apply supported old-version/default migrations to a detached copy. Default: true. */
	migrate?: boolean;
	/** Permit a future version for read-only tooling. Runtime/editor callers should leave false. */
	allowFutureVersion?: boolean;
}

export interface ParseProjectResult {
	ok: boolean;
	project?: SvLevelProject;
	diagnostics: ProjectDiagnostic[];
	migrated: boolean;
}

const object = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const integer = (value: unknown): value is number => Number.isInteger(value);
const string = (value: unknown): value is string => typeof value === 'string';
const array = (value: unknown): value is unknown[] => Array.isArray(value);

function migrateProject(raw: Record<string, unknown>): { value: Record<string, unknown>; migrated: boolean } {
	const value = structuredClone(raw);
	let migrated = false;
	if (value.version === 0) {
		value.version = SVLEVEL_VERSION;
		migrated = true;
	}
	const set = (target: Record<string, unknown>, key: string, fallback: unknown) => {
		if (target[key] === undefined) {
			target[key] = fallback;
			migrated = true;
		}
	};
	set(value, 'autoRuleGroups', []);
	set(value, 'autoRulePresets', []);
	set(value, 'entities', []);
	set(value, 'enums', []);
	set(value, 'tilesets', []);
	set(value, 'levelFields', []);
	if (array(value.tilesets)) {
		for (const item of value.tilesets) if (object(item)) {
			set(item, 'enumTags', []);
			set(item, 'customData', []);
			set(item, 'tileColliders', []);
			set(item, 'tileFlips', []);
			set(item, 'tileWarps', []);
		}
	}
	if (array(value.levels)) {
		for (const level of value.levels) if (object(level) && array(level.layers)) {
			set(level, 'fields', {});
			for (const layer of level.layers) if (object(layer)) {
				set(layer, 'idGrid', []);
				set(layer, 'gridTiles', []);
				set(layer, 'autoTiles', []);
				set(layer, 'entities', []);
			}
		}
	}
	return { value, migrated };
}

export function validateProject(project: unknown): ProjectDiagnostic[] {
	const out: ProjectDiagnostic[] = [];
	const add = (
		severity: ProjectDiagnostic['severity'],
		path: string,
		message: string,
		recoverable = false
	) => out.push({ severity, path, message, recoverable });
	const requiredArray = (parent: Record<string, unknown>, key: string): unknown[] => {
		if (!array(parent[key])) {
			add('error', `$.${key}`, 'must be an array');
			return [];
		}
		return parent[key];
	};
	const unique = <T>(
		items: T[],
		value: (item: T) => unknown,
		path: (index: number) => string,
		label: string
	) => {
		const seen = new Map<unknown, number>();
		items.forEach((item, index) => {
			const key = value(item);
			if (key === undefined || key === '') return;
			const first = seen.get(key);
			if (first !== undefined) add('error', path(index), `${label} duplicates index ${first}`);
			else seen.set(key, index);
		});
	};

	if (!object(project)) return [{ severity: 'error', path: '$', message: 'must be an object', recoverable: false }];
	if (project.format !== SVLEVEL_FORMAT) add('error', '$.format', `must equal ${SVLEVEL_FORMAT}`);
	if (!integer(project.version)) add('error', '$.version', 'must be an integer');
	else if (project.version > SVLEVEL_VERSION) add('error', '$.version', `future version ${project.version} is not supported`);
	else if (project.version < SVLEVEL_VERSION) add('error', '$.version', `version ${project.version} requires migration`, true);
	if (!string(project.iid) || !project.iid) add('error', '$.iid', 'must be a non-empty string');
	if (!integer(project.nextUid) || (project.nextUid as number) < 0) add('error', '$.nextUid', 'must be a non-negative integer');
	if (!finite(project.defaultGridSize) || (project.defaultGridSize as number) <= 0) add('error', '$.defaultGridSize', 'must be positive');
	if (!string(project.bgColor)) add('error', '$.bgColor', 'must be a string');
	if (!string(project.defaultLevelBgColor)) add('error', '$.defaultLevelBgColor', 'must be a string');
	if (!object(project.world)) add('error', '$.world', 'must be an object');

	const tilesets = requiredArray(project, 'tilesets').filter(object);
	const enums = requiredArray(project, 'enums').filter(object);
	const layers = requiredArray(project, 'layers').filter(object);
	const groups = requiredArray(project, 'autoRuleGroups').filter(object);
	const levelFields = requiredArray(project, 'levelFields').filter(object);
	const levels = requiredArray(project, 'levels').filter(object);
	const entities = project.entities === undefined ? [] : array(project.entities) ? project.entities.filter(object) : [];
	if (project.entities !== undefined && !array(project.entities)) add('error', '$.entities', 'must be an array');

	unique(tilesets, (x) => x.uid, (i) => `$.tilesets[${i}].uid`, 'tileset uid');
	unique(tilesets, (x) => x.identifier, (i) => `$.tilesets[${i}].identifier`, 'tileset identifier');
	unique(enums, (x) => x.identifier, (i) => `$.enums[${i}].identifier`, 'enum identifier');
	unique(layers, (x) => x.uid, (i) => `$.layers[${i}].uid`, 'layer uid');
	unique(layers, (x) => x.identifier, (i) => `$.layers[${i}].identifier`, 'layer identifier');
	unique(groups, (x) => x.uid, (i) => `$.autoRuleGroups[${i}].uid`, 'rule group uid');
	unique(groups, (x) => x.name, (i) => `$.autoRuleGroups[${i}].name`, 'rule group name');
	unique(entities, (x) => x.id, (i) => `$.entities[${i}].id`, 'entity type id');
	unique(levels, (x) => x.uid, (i) => `$.levels[${i}].uid`, 'level uid');
	unique(levels, (x) => x.iid, (i) => `$.levels[${i}].iid`, 'level iid');
	unique(levels, (x) => x.identifier, (i) => `$.levels[${i}].identifier`, 'level identifier');

	const tilesetUids = new Set(tilesets.map((x) => x.uid));
	const enumIds = new Set(enums.map((x) => x.identifier));
	const layerUids = new Set(layers.map((x) => x.uid));
	const entityIds = new Set(entities.map((x) => x.id));
	const groupNames = new Set(groups.map((x) => x.name));

	tilesets.forEach((ts, ti) => {
		const p = `$.tilesets[${ti}]`;
		for (const key of ['uid', 'pxWid', 'pxHei', 'tileGridSize', 'cWid', 'cHei'] as const)
			if (!integer(ts[key]) || (ts[key] as number) <= 0) add('error', `${p}.${key}`, 'must be a positive integer');
		if (!string(ts.identifier) || !ts.identifier) add('error', `${p}.identifier`, 'must be non-empty');
		if (!string(ts.relPath) || !ts.relPath) add('error', `${p}.relPath`, 'must be non-empty');
		if (!array(ts.enumTags)) add('error', `${p}.enumTags`, 'must be an array');
		if (!array(ts.customData)) add('error', `${p}.customData`, 'must be an array');
		if (ts.tagsEnumId != null && !enumIds.has(ts.tagsEnumId)) add('error', `${p}.tagsEnumId`, 'references a missing enum');
		const allowed = new Set(
			enums.find((en) => en.identifier === ts.tagsEnumId)?.values &&
			array(enums.find((en) => en.identifier === ts.tagsEnumId)!.values)
				? (enums.find((en) => en.identifier === ts.tagsEnumId)!.values as unknown[]).filter(object).map((v) => v.id)
				: []
		);
		if (array(ts.enumTags)) ts.enumTags.filter(object).forEach((tag, i) => {
			if (!string(tag.enumValueId) || (ts.tagsEnumId && !allowed.has(tag.enumValueId)))
				add('error', `${p}.enumTags[${i}].enumValueId`, 'is not a value of tagsEnumId');
			if (!array(tag.tileIds) || tag.tileIds.some((id) => !integer(id) || id < 0))
				add('error', `${p}.enumTags[${i}].tileIds`, 'must contain non-negative integers');
		});
	});

	enums.forEach((en, ei) => {
		const p = `$.enums[${ei}]`;
		if (!string(en.identifier) || !en.identifier) add('error', `${p}.identifier`, 'must be non-empty');
		if (!array(en.values)) add('error', `${p}.values`, 'must be an array');
		else unique(en.values.filter(object), (v) => v.id, (i) => `${p}.values[${i}].id`, 'enum value id');
	});

	entities.forEach((def, di) => {
		const p = `$.entities[${di}]`;
		if (!string(def.id) || !def.id) add('error', `${p}.id`, 'must be non-empty');
		if (!finite(def.width) || (def.width as number) <= 0) add('error', `${p}.width`, 'must be positive');
		if (!finite(def.height) || (def.height as number) <= 0) add('error', `${p}.height`, 'must be positive');
		if (!array(def.fields)) add('error', `${p}.fields`, 'must be an array');
		else {
			const fields = def.fields.filter(object);
			unique(fields, (field) => field.id, (i) => `${p}.fields[${i}].id`, 'field id');
			fields.forEach((field, fi) => {
				if (!string(field.id) || !field.id.trim()) add('error', `${p}.fields[${fi}].id`, 'must be non-empty');
				if (field.type === 'Enum' && !enumIds.has(field.enumId)) add('error', `${p}.fields[${fi}].enumId`, 'references a missing enum');
			});
		}
	});

	layers.forEach((layer, li) => {
		const p = `$.layers[${li}]`;
		if (!integer(layer.uid)) add('error', `${p}.uid`, 'must be an integer');
		if (!['IdGrid', 'Tiles', 'AutoLayer', 'Entities'].includes(String(layer.type))) add('error', `${p}.type`, 'is invalid');
		if (!finite(layer.gridSize) || (layer.gridSize as number) <= 0) add('error', `${p}.gridSize`, 'must be positive');
		if (layer.tilesetDefUid != null && !tilesetUids.has(layer.tilesetDefUid)) add('error', `${p}.tilesetDefUid`, 'references a missing tileset');
		if (layer.autoSourceLayerDefUid != null && !layerUids.has(layer.autoSourceLayerDefUid)) add('error', `${p}.autoSourceLayerDefUid`, 'references a missing layer');
	});

	groups.forEach((group, gi) => {
		const p = `$.autoRuleGroups[${gi}]`;
		if (!string(group.name) || !group.name || group.name === '*' || group.name.startsWith('!')) add('error', `${p}.name`, 'is not a legal group id');
		if (group.tilesetDefUid != null && !tilesetUids.has(group.tilesetDefUid)) add('error', `${p}.tilesetDefUid`, 'references a missing tileset');
		if (!array(group.rules)) add('error', `${p}.rules`, 'must be an array');
		else group.rules.filter(object).forEach((rule, ri) => {
			const rp = `${p}.rules[${ri}]`;
			if (!integer(rule.uid)) add('error', `${rp}.uid`, 'must be an integer');
			if (rule.tileMode !== 'Single') add('error', `${rp}.tileMode`, 'Stamp mode is not supported; use Single');
			if (![1, 3, 5, 7].includes(rule.size as number)) add('error', `${rp}.size`, 'must be 1, 3, 5, or 7');
			if (!array(rule.pattern) || rule.pattern.length !== (rule.size as number) ** 2) add('error', `${rp}.pattern`, 'length must equal size²');
			if (!finite(rule.chance) || (rule.chance as number) < 0 || (rule.chance as number) > 1) add('error', `${rp}.chance`, 'must be in 0..1');
			if (array(rule.pattern)) rule.pattern.forEach((cell, ci) => {
				const id = typeof cell === 'string' && cell.startsWith('!') ? cell.slice(1) : cell;
				if (id !== '' && id !== '*' && !groupNames.has(id)) add('error', `${rp}.pattern[${ci}]`, 'references a missing group');
			});
		});
	});

	levelFields.forEach((field, fi) => {
		if (!string(field.identifier) || !field.identifier) add('error', `$.levelFields[${fi}].identifier`, 'must be non-empty');
		if (field.type === 'Enum' && !enumIds.has(field.enumId)) add('error', `$.levelFields[${fi}].enumId`, 'references a missing enum');
	});

	let visiblePlayerStarts = 0;
	const instanceIids: Record<string, number> = {};
	levels.forEach((level, vi) => {
		const p = `$.levels[${vi}]`;
		let levelPlayerStarts = 0;
		if (!finite(level.pxWid) || (level.pxWid as number) <= 0) add('error', `${p}.pxWid`, 'must be positive');
		if (!finite(level.pxHei) || (level.pxHei as number) <= 0) add('error', `${p}.pxHei`, 'must be positive');
		if (!object(level.fields)) add('error', `${p}.fields`, 'must be an object');
		if (!array(level.layers)) add('error', `${p}.layers`, 'must be an array');
		else level.layers.filter(object).forEach((layer, li) => {
			const lp = `${p}.layers[${li}]`;
			if (!layerUids.has(layer.layerDefUid)) add('error', `${lp}.layerDefUid`, 'references a missing layer definition');
			if (!integer(layer.cWid) || (layer.cWid as number) <= 0) add('error', `${lp}.cWid`, 'must be positive');
			if (!integer(layer.cHei) || (layer.cHei as number) <= 0) add('error', `${lp}.cHei`, 'must be positive');
			if (layer.type === 'IdGrid' && (!array(layer.idGrid) || layer.idGrid.length !== (layer.cWid as number) * (layer.cHei as number)))
				add('error', `${lp}.idGrid`, 'length must equal cWid*cHei');
			if (!array(layer.autoTiles)) add('error', `${lp}.autoTiles`, 'must be an array');
			if (!array(layer.entities)) add('error', `${lp}.entities`, 'must be an array');
			else layer.entities.filter(object).forEach((entity, ei) => {
				const ep = `${lp}.entities[${ei}]`;
				if (!string(entity.iid) || !entity.iid) add('error', `${ep}.iid`, 'must be non-empty');
				else if (instanceIids[entity.iid] !== undefined) add('error', `${ep}.iid`, `duplicates entity at level index ${instanceIids[entity.iid]}`);
				else instanceIids[entity.iid] = vi;
				if (!entityIds.has(entity.type)) add('error', `${ep}.type`, 'references a missing entity type');
				if (!array(entity.px) || entity.px.length !== 2 || entity.px.some((x) => !finite(x))) add('error', `${ep}.px`, 'must be [x,y] numbers');
				if (array(entity.px) && finite(entity.width) && finite(entity.height)) {
					if ((entity.px[0] as number) < 0 || (entity.px[1] as number) < 0 || (entity.px[0] as number) + entity.width > (level.pxWid as number) || (entity.px[1] as number) + entity.height > (level.pxHei as number))
						add('error', `${ep}.px`, 'entity footprint is outside level bounds', true);
				}
				if (layer.visible !== false && entity.type === 'PlayerStart') {
					visiblePlayerStarts++;
					levelPlayerStarts++;
				}
			});
		});
		if (levelPlayerStarts > 1)
			add('error', `${p}.layers`, 'multiple visible PlayerStart entities in one level are ambiguous', true);
	});
	if (entityIds.has('PlayerStart')) {
		if (visiblePlayerStarts === 0) add('warning', '$.levels', 'no visible PlayerStart; runtime will use its fallback spawn', true);
	}
	return out;
}

export function parseProject(input: unknown, options: ParseProjectOptions = {}): ParseProjectResult {
	if (!object(input)) return { ok: false, diagnostics: validateProject(input), migrated: false };
	const migrated = options.migrate === false ? { value: structuredClone(input), migrated: false } : migrateProject(input);
	const diagnostics = validateProject(migrated.value);
	if (options.allowFutureVersion && finite(migrated.value.version) && migrated.value.version > SVLEVEL_VERSION) {
		const i = diagnostics.findIndex((d) => d.path === '$.version' && d.message.startsWith('future version'));
		if (i >= 0) diagnostics.splice(i, 1, { severity: 'warning', path: '$.version', message: 'future version opened read-only at caller risk', recoverable: false });
	}
	const ok = !diagnostics.some((diagnostic) => diagnostic.severity === 'error');
	return {
		ok,
		...(ok ? { project: migrated.value as unknown as SvLevelProject } : {}),
		diagnostics,
		migrated: migrated.migrated
	};
}

export function assertProject(input: unknown, source = 'project'): SvLevelProject {
	const result = parseProject(input);
	if (result.project) return result.project;
	const errors = result.diagnostics
		.filter((diagnostic) => diagnostic.severity === 'error')
		.slice(0, 8)
		.map((diagnostic) => `${diagnostic.path}: ${diagnostic.message}`)
		.join('; ');
	throw new Error(`invalid ${source}: ${errors || 'unknown validation error'}`);
}
