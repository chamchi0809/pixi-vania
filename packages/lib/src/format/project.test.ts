import assert from 'node:assert';
import type { SvLevelProject } from './types.ts';
import { assertProject, parseProject, validateProject } from './project.ts';

const project: SvLevelProject = {
	format: 'svlevel',
	version: 1,
	iid: 'test-project',
	nextUid: 1,
	defaultGridSize: 16,
	bgColor: '#000000',
	defaultLevelBgColor: '#000000',
	world: { layout: 'Free', gridWidth: 16, gridHeight: 16 },
	tilesets: [],
	enums: [],
	entities: [],
	layers: [],
	autoRuleGroups: [],
	levelFields: [],
	levels: []
};
assert.equal(parseProject(project).ok, true);
assert.notEqual(assertProject(project), project, 'parser returns a detached document');

const malformed = parseProject({ format: 'svlevel' });
assert.equal(malformed.ok, false);
assert.ok(malformed.diagnostics.some((diagnostic) => diagnostic.path === '$.levels'));

const old = structuredClone(project);
old.version = 0;
const migrated = parseProject(old);
assert.equal(migrated.ok, true);
assert.equal(migrated.migrated, true);
assert.equal(migrated.project?.version, 1);

const brokenRef = structuredClone(project);
brokenRef.layers.push({
	uid: 1,
	identifier: 'Ground',
	type: 'Tiles',
	gridSize: 16,
	opacity: 1,
	pxOffsetX: 0,
	pxOffsetY: 0,
	tilesetDefUid: 999
});
assert.ok(validateProject(brokenRef).some((diagnostic) => diagnostic.path.endsWith('tilesetDefUid')));

const playerStarts = structuredClone(project);
playerStarts.entities = [{
	id: 'PlayerStart',
	name: 'Player start',
	width: 16,
	height: 16,
	color: '#ffffff',
	renderMode: 'cross',
	pivot: [0, 0],
	fields: []
}];
playerStarts.layers.push({
	uid: 1,
	identifier: 'Entities',
	type: 'Entities',
	gridSize: 16,
	opacity: 1,
	pxOffsetX: 0,
	pxOffsetY: 0
});
const entityLayer = (iid: string) => ({
	layerDefUid: 1,
	identifier: 'Entities',
	type: 'Entities' as const,
	gridSize: 16,
	cWid: 2,
	cHei: 2,
	visible: true,
	opacity: 1,
	pxOffsetX: 0,
	pxOffsetY: 0,
	idGrid: [],
	gridTiles: [],
	autoTiles: [],
	entities: [{ iid, type: 'PlayerStart', px: [0, 0] as [number, number], width: 16, height: 16, fields: {} }]
});
playerStarts.levels = [1, 2].map((uid) => ({
	uid,
	iid: `level-${uid}`,
	identifier: `Level${uid}`,
	worldX: (uid - 1) * 32,
	worldY: 0,
	pxWid: 32,
	pxHei: 32,
	fields: {},
	layers: [entityLayer(`start-${uid}`)]
}));
assert.equal(parseProject(playerStarts).ok, true, 'one visible start per level is valid');
playerStarts.levels[0]!.layers[0]!.entities.push({
	iid: 'start-duplicate',
	type: 'PlayerStart',
	px: [16, 0],
	width: 16,
	height: 16,
	fields: {}
});
assert.ok(
	validateProject(playerStarts).some((diagnostic) => diagnostic.path === '$.levels[0].layers' && diagnostic.message.includes('multiple visible PlayerStart')),
	'multiple visible starts in the same level are rejected'
);
console.log('project validation: OK');
