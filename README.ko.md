# pixi-vania

[English](README.md) | [한국어](README.ko.md) | [라이브 데모](https://chamchi0809.github.io/pixi-vania/)

![pixi-vania editor](docs/img/editor-full.png)

**(개발 중)** PixiJS용 LDtk 스타일 레벨 에디터와 런타임입니다.

- 앱 안의 원하는 위치에 에디터 마운트
- Vite 플러그인을 통해 JSON 프로젝트를 디스크에 저장
- 오토 타일링, 무작위 X/Y 반전, 픽셀 지터
- 무한 캔버스에서 여러 레벨을 동시에 확인하고 편집
- 엔티티로 레벨에 커스텀 데이터 추가
- 타일별 충돌 형태와 태그 편집
- Rapier 연동
- 대화 에디터와 현지화 테이블

```sh
npm i pixi-vania pixi.js @dimforge/rapier2d-compat
```

렌더링만 필요하다면 Rapier는 설치하지 않아도 됩니다.

## 빠른 시작

에디터는 어느 `<div>`에나 마운트할 수 있습니다. Svelte 런타임과 스타일은 패키지에 포함되어 있습니다.

```ts
import { mountEditor } from 'pixi-vania/editor';

const editor = mountEditor(document.querySelector('#editor')!, {
	projectPath: '/assets/levels/demo.svlevel.json',
	onPlay: (project, levelUid) => startGame(project, levelUid)
});
```

`onPlay`를 전달하면 Play 버튼이 나타납니다. 저장 과정 없이 현재 메모리의 프로젝트를 게임으로 바로 넘겨줍니다. UI 사용법은 [에디터 가이드](docs/editor.md)를 참고하세요.

`vite dev`에서 파일을 저장하려면 Vite 플러그인을 추가합니다. 플러그인이 없어도 브라우저에서 프로젝트를 가져오거나 내보낼 수 있습니다.

```ts
// vite.config.ts
import levelEditor from 'pixi-vania/vite';

export default { plugins: [levelEditor({ staticDir: 'public' })] };
```

`createLevelRuntime`으로 레벨을 불러옵니다.

```ts
import RAPIER from '@dimforge/rapier2d-compat';
import { createLevelRuntime } from 'pixi-vania';

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: 40 });

const level = await createLevelRuntime(project, levelUid, {
	world,
	stage: app.stage,
	basePath: '/assets/levels/demo.svlevel.json',
	navGrid: true
});
```

타일 메시, 정적 콜라이더, 엔티티 목록이 생성됩니다. 실제 엔티티 생성은 게임에서 처리합니다.

```ts
for (const entity of level.entities) {
	if (entity.instance.type === 'PlayerStart') {
		body.setTranslation({ x: entity.world[0], y: entity.world[1] }, true);
	}
}

level.destroy();
```

Pixi와 Rapier는 같은 Y-down 좌표계를 사용합니다. 렌더링 단위는 픽셀이고, 물리 단위는 `pixels / pixelsPerUnit`입니다. `pixelsPerUnit`의 기본값은 `project.defaultGridSize`이므로 타일 하나가 물리 단위 하나에 해당합니다.

## 런타임 참고 사항

### 충돌 레이어

충돌 레이어는 Rapier의 16비트 interaction group에 매핑되므로 최대 16개까지 만들 수 있습니다. `DEFAULT`는 0번 비트를 사용하며 모든 레이어와 충돌합니다. 알 수 없는 id에도 `DEFAULT`가 적용됩니다.

```ts
import { buildCollisionGroups, groupsForLayer } from 'pixi-vania';

const table = buildCollisionGroups(project.collisionLayers);
collider.setCollisionGroups(groupsForLayer(table, 'Enemy'));
```

### 타일 콜라이더와 태그

`level.colliders`의 각 항목에는 Rapier 콜라이더와 원본 사각형 정보가 들어 있습니다. 설정이 같은 인접 박스 콜라이더는 하나로 합쳐집니다. 픽셀 형태의 콜라이더는 원본 타일 영역을 벗어나지 않습니다.

```ts
for (const { collider, rect } of level.colliders) {
	if (rect.tags.includes('Ice')) collider.setFriction(0);
}
```

### 내비게이션 그리드

선택 기능인 내비게이션 그리드는 현재 칸과 그 위가 비어 있고 아래 칸이 막혀 있을 때 해당 칸을 이동 가능으로 표시합니다. 연결 요소를 미리 계산하므로 두 지점 사이의 도달 가능 여부를 빠르게 확인할 수 있습니다.

```ts
const nav = level.navGrid!;
const from = nav.cellAt(px, py);
const to = nav.cellAt(tx, ty);
if (nav.connected(from, to)) walkTo(tx, ty);
```

### 엔티티 필드

`entity.fields`에는 인스턴스 값과 엔티티 타입의 기본값이 함께 적용됩니다. 인스턴스를 배치한 뒤 타입에 필드를 추가해도 기본값을 읽을 수 있습니다.

현지화 필드는 원문을 키로 사용합니다. 번역이 없으면 원문으로 대체됩니다.

```ts
import { localize } from 'pixi-vania';

label.text = localize(project.localization, entity.fields.Name as string, 'ko');
```

대화 스크립트는 `Dialogue` 필드에 JSON으로 저장됩니다.

```ts
import { parseScript } from 'pixi-vania';

for (const line of parseScript(entity.fields.Script)) {
	say(line.speaker, line.text);
}
```

### 저장소

기본 `devServerStore()`는 Vite 플러그인을 사용합니다. `staticStore(paths)`는 `fetch`로 불러오고 저장할 때 JSON을 다운로드합니다. 커스텀 저장소를 사용하려면 `list`, `load`, `save`와 선택적인 에셋 메서드를 포함하는 `ProjectStore`를 구현하세요.

```ts
mountEditor(el, { store: staticStore(['/assets/levels/demo.svlevel.json']) });
```

## API 레퍼런스

### `pixi-vania`

```ts
createLevelRuntime(project, levelId, options): Promise<LevelRuntime>

LevelRuntime {
	level
	container
	body
	colliders
	navGrid
	entities
	pixelsPerUnit
	destroy()
}

loadTilesetTextures(project, basePath?)
buildTileLayers(project, level, textures)
tileMaskFromTextures(project, textures)
createLevelBody(world, level, pixelsPerUnit)
createTileColliders(world, body, project, level, pixelsPerUnit, mask?)
tileColliderRects(project, level, mask?)
buildNavGrid(project, level, mask?)
tileBatches(project, layer)
tileTagIndex(tileset)
buildCollisionGroups(layers)
groupsForLayer(table, id)
interactionGroups(membership, filter?)
collisionTargetsFor(layers, id)
cloneDefaultLayers()
computeAutoTiles(options)
getEntityType(project, id)
getEntityTypeDef(project, id)
defaultEntityFields(project, id)
localize(localization, key, locale)
collectLocalizableStrings(project)
emptyLocalization()
parseScript(raw)
serializeScript(lines)
```

### `pixi-vania/editor`

```ts
mountEditor(target, options): EditorHandle

EditorHandle {
	getProject()
	open(project, path?)
	load(path?)
	save()
	destroy()
}

devServerStore(api?)
staticStore(paths?)
setProjectStore(store)
projectStore()
emptyProject()
```

에디터 스토어는 모듈 싱글턴이므로 한 페이지에 에디터 하나만 마운트할 수 있습니다.

### `pixi-vania/vite`

```ts
levelEditor({
	staticDir?: string,       // 기본값: 'public'
	base?: string,            // 기본값: '/__svlevel'
	imageExtensions?: string[]
}): Plugin
```

플러그인은 `base` 경로 아래에 프로젝트 목록, 에셋 목록, 저장, 업로드 API를 제공합니다. 모든 경로는 `staticDir` 내부로 제한됩니다.

## 개발

현재 타일 셰이더는 WebGL이 필요합니다. Pixi를 초기화할 때 `preference: 'webgl'`을 지정하세요.

```sh
pnpm i
pnpm dev # http://localhost:8383
```

`packages/lib`에는 라이브러리가, `packages/demo`에는 개발용 데모가 있습니다.

MIT
