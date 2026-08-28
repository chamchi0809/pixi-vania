import assert from 'node:assert';
import type { SvLevelProject } from './types.ts';
import { collectLocalizableStrings, localize } from './localization.ts';

const project = {
	format: 'svlevel', version: 1, iid: 'test', nextUid: 3,
	defaultGridSize: 16, bgColor: '#000', defaultLevelBgColor: '#000',
	world: { layout: 'Free', gridWidth: 16, gridHeight: 16 },
	tilesets: [], enums: [], autoRuleGroups: [], levelFields: [],
	layers: [{ uid: 1, identifier: 'Entities', type: 'Entities', gridSize: 16, opacity: 1, pxOffsetX: 0, pxOffsetY: 0 }],
	entities: [{
		id: 'Sign', name: 'Sign', width: 16, height: 16, color: '#fff',
		renderMode: 'rect', pivot: [0, 0],
		fields: [{ id: 'Text', type: 'String', default: 'Default text', localized: true }]
	}],
	levels: [{
		uid: 2, iid: 'level', identifier: 'Level', worldX: 0, worldY: 0,
		pxWid: 16, pxHei: 16, fields: {},
		layers: [{
			layerDefUid: 1, identifier: 'Entities', type: 'Entities', gridSize: 16,
			cWid: 1, cHei: 1, visible: true, opacity: 1, pxOffsetX: 0, pxOffsetY: 0,
			idGrid: [], gridTiles: [], autoTiles: [],
			entities: [{ iid: 'sign', type: 'Sign', px: [0, 0], width: 16, height: 16, fields: {} }]
		}]
	}]
} satisfies SvLevelProject;
assert.deepEqual(collectLocalizableStrings(project), ['Default text']);
assert.equal(localize({ locales: ['ko'], entries: [{ key: 'Hide', values: { ko: '' } }] }, 'Hide', 'ko'), '');
console.log('localization: OK');
