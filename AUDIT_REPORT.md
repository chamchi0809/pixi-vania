# pixi-vania 전수 감사 보고서

감사일: 2026-08-28  
대상: 라이브러리 포맷·런타임·Vite 플러그인, Svelte 편집기, 데모 게임, 테스트·빌드·배포 설정, 문서와 에셋, 로컬 및 공개 데모

## 요약

총 2,792줄의 코어 TypeScript 25개와 편집기 진입점/소스 40개(10,615줄), 테스트 7개, 설정·워크플로·매니페스트 16개, 문서·라이선스 5개, 에셋 29개를 인벤토리화해 네 차례 검토했다. 정적 감사 27건, 편집기·도구 감사 27건, 브라우저 감사 10건의 원시 발견 64건을 교차 검증하고 중복을 합쳐 아래 56건으로 정리했다.

| 종류 | 건수 |
| --- | ---: |
| 확정 버그 | 34 |
| 조건부 위험 | 13 |
| 기능 제안 | 9 |
| **합계** | **56** |

| 심각도 | 건수 | 의미 |
| --- | ---: | --- |
| P1 | 12 | 주요 사용 경로, 데이터 보존, 배포 계약 또는 개발 서버 신뢰 경계를 깨뜨림 |
| P2 | 32 | 의미 있는 정확성·호환성·사용성·성능 문제 |
| P3 | 12 | 낮은 확률의 위험, 작은 결함 또는 후순위 기능 |

가장 먼저 처리할 묶음은 (1) 저장·가져오기·모드 전환의 데이터 손실, (2) 165Hz에서 실제 확인된 주사율 의존 물리, (3) 비동기 레벨/Play 전환 경쟁조건, (4) enum/entity 스키마 변경의 데이터 마이그레이션 누락, (5) optional Rapier를 사실상 필수로 만드는 패키지 진입점, (6) Vite 쓰기 API의 신뢰 경계다.

## 버그 및 위험

### AUDIT-1 P1 BUG 물리 진행 속도가 모니터 주사율에 종속된다

Evidence: `packages/demo/src/game.ts:314-329`는 Pixi ticker마다 고정 1/60초인 `world.step()`을 한 번 호출하면서 `deltaMS`를 사용하지 않는다. managed Chrome에서 로컬과 공개 데모의 rAF 평균 간격이 각각 6.06ms와 6.04ms, 약 165Hz로 측정됐다.

Impact: 60Hz보다 높은 화면에서 이동·중력·충돌 시뮬레이션이 실제 시간보다 빠르게 진행되고 기기마다 게임 감각과 결과가 달라진다.

Recommendation: accumulator 기반 60Hz fixed-step과 최대 catch-up 횟수를 두고 렌더 보간을 분리한 뒤 60/120/165Hz 가상 시간 회귀 테스트를 추가한다.

### AUDIT-2 P1 BUG 레벨 전환 중 종료 또는 로드 실패가 해제된 월드를 사용하거나 세션을 영구 정지시킨다

Evidence: `packages/demo/src/game.ts:225-245`는 기존 레벨을 파괴한 뒤 비동기 새 레벨 로드를 기다린다. 그 사이 `stop()`은 `:354-360`에서 camera와 Rapier world를 해제하지만 pending 작업은 성공 시점 전까지 dead 상태를 확인하지 않고, reject 시 `swapping` 복구와 rejection 처리도 없다.

Impact: 빠른 종료·재시작이나 에셋 실패 시 use-after-free 성격의 오류, unhandled rejection, 입력 불능 세션이 생길 수 있다.

Recommendation: 전환별 generation token/AbortController를 사용하고, 성공한 새 레벨을 준비한 뒤 원자적으로 교체하며 `try/finally`에서 swapping과 부분 리소스를 정리한다.

### AUDIT-3 P1 BUG 빠른 Play·모드·프로젝트 전환이 서로 다른 초기화 결과를 섞는다

Evidence: `packages/demo/src/main.ts:35-70`은 Pixi app을 `await init()` 전에 저장하고 session은 전체 시작이 끝난 뒤에만 기록한다. `editorStore.svelte.ts:151-161`의 load는 latest-wins 토큰이 없고 오류를 삼키므로 늦게 끝난 이전 요청이나 이전 프로젝트가 새 mode/basePath와 결합할 수 있다.

Impact: 사용자가 연타하거나 네트워크가 느릴 때 미초기화 앱 사용, 잘못된 프로젝트 실행, 중복 세션 또는 UI와 게임 상태 불일치가 발생한다.

Recommendation: app 초기화 Promise와 pending session을 단일 상태 머신으로 관리하고, 모든 load/start에 세대 번호와 취소·오류 전파를 적용한다.

### AUDIT-4 P1 RISK Vite 쓰기 API의 경로·요청 신뢰 경계가 계약보다 약하다

Evidence: `packages/lib/src/vite/plugin.ts:42-49,117-155`는 lexical 경계만 검사해 static root 내부 symlink/junction의 실제 외부 경로를 막지 못한다. Origin/CSRF/Content-Type 검증이 없고 upload 확장자·덮어쓰기 제한도 없으며 동일 쓰기 API가 preview 서버에도 붙는다.

Impact: 공격자가 개발/preview 서버에 도달할 수 있는 조건에서 의도하지 않은 파일 작성·덮어쓰기 또는 sandbox 탈출 가능성이 생긴다.

Recommendation: `realpath` 기준 allowlist, same-origin/token 검사, 허용 MIME·확장자·대상 디렉터리, create-only 기본값을 적용하고 preview 쓰기는 명시적 opt-in으로 바꾼다.

### AUDIT-5 P2 BUG 레벨 런타임 생성과 destroy가 예외·중복 호출에 안전하지 않다

Evidence: `packages/lib/src/runtime/level.ts:91-122`는 컨테이너를 stage에 붙인 뒤 collider와 사용자 `onEntity`를 생성하지만 중간 예외를 정리하는 `try/catch`가 없다. 반환되는 `destroy()`(`:133-148`)도 idempotence guard가 없다.

Impact: 에셋·entity callback 오류 시 stage node, body, collider가 남고 두 번 정리하면 해제된 핸들을 다시 만질 수 있다.

Recommendation: 생성 자원을 역순 disposable stack에 등록하고 실패 시 롤백하며 destroy를 한 번만 실행되는 idempotent 함수로 만든다.

### AUDIT-6 P2 BUG `breakOnMatch`의 실제 범위가 문서와 다르다

Evidence: `packages/lib/src/format/types.ts:149-151`은 현재 group의 후속 rule만 중단한다고 설명하지만 `autoRules.ts:185-202,249`의 stopped 배열은 모든 group에 공유된다. 두 group 실행 프로브도 첫 group만 출력했고 기존 테스트는 이 전역 동작을 기대한다.

Impact: 문서를 믿은 프로젝트는 뒤 group의 타일이 사라지고, 구현을 바꾸면 현재 테스트·사용자 데이터와 호환성 문제가 생긴다.

Recommendation: 의도한 계약을 결정한 뒤 group-local로 수정하거나 문서·필드명을 전역 의미로 바꾸고 두 동작의 회귀 테스트와 migration note를 제공한다.

### AUDIT-7 P2 BUG rect 충돌체가 타일의 픽셀 오프셋을 격자로 반올림한다

Evidence: `packages/lib/src/runtime/grid.ts:164-178`은 `tile.px / gridSize`를 `Math.round`한 셀로 바꿔 위치를 재구성한다. grid 16, px x=7 프로브에서 렌더 위치 7과 달리 충돌 rect x=0이 나왔다.

Impact: authored offset이나 auto-rule offset이 있는 타일은 보이는 지형과 실제 충돌 위치가 어긋난다.

Recommendation: 원본 픽셀 좌표를 collider 위치에 사용하고 병합은 정렬·태그·충돌 형상이 같은 경우에만 수행한다.

### AUDIT-8 P2 BUG pixel 충돌 마스크가 타일 flip을 반영하지 않는다

Evidence: `runtime/tiles.ts:120-138`은 authored/random flip을 렌더링하지만 `runtime/grid.ts:108-159`의 mask cache key와 변환에는 flip이 없다. 왼쪽 1px 마스크는 X-flip 뒤에도 collider x=0으로 남았다.

Impact: 뒤집힌 경사·벽의 시각 형상과 물리 형상이 반대가 되어 끼임이나 허공 충돌이 발생한다.

Recommendation: 최종 flip 상태를 배치 결과에 확정해 전달하고 mask 좌표를 동일하게 변환하며 cache key에 flip을 포함한다.

### AUDIT-9 P2 BUG 쉼표 결합 태그 키가 서로 다른 metadata를 같은 충돌체로 합친다

Evidence: `packages/lib/src/runtime/grid.ts:59-61`은 tag 배열을 comma-join한다. `['a,b']`와 `['a','b']` 프로브가 같은 키가 되어 두 타일을 하나로 병합하고 뒤 metadata를 잃었다.

Impact: 허용된 enum 문자열에 쉼표가 있을 때 충돌 이벤트의 태그 의미가 조용히 바뀐다.

Recommendation: 길이-prefix 직렬화나 안정적인 JSON tuple을 사용하고 tag 배열 정규화·충돌 회귀 테스트를 추가한다.

### AUDIT-10 P2 BUG 플랫폼 ground ray가 sensor collider도 바닥으로 판정한다

Evidence: `packages/demo/src/game.ts:216-221`의 `world.castRay`는 `EXCLUDE_SENSORS`를 주지 않는다. Rapier 프로브에서 아래 sensor가 기본 ray에는 맞고 해당 flag를 주면 제외됐다.

Impact: 트리거·물·문 같은 sensor 위에서 공중 점프가 허용되거나 grounded 상태가 오판될 수 있다.

Recommendation: sensor 제외 filter를 적용하고 플레이어 자신의 collider와 통과 플랫폼 정책도 명시적으로 필터링한다.

### AUDIT-11 P2 BUG 키 상태와 단축키가 blur·visibility·폼 포커스를 올바르게 처리하지 않는다

Evidence: `packages/demo/src/game.ts:74-87`은 전역 keydown/up만 관리해 blur/visibility에서 pressed set을 비우지 않는다. `EditorShell.svelte:55-70`은 SELECT를 typing target에서 제외하고 기본 동작도 막지 않아 선택 UI에서 B/E/R 등의 도구 단축키가 함께 발동한다.

Impact: Alt-Tab 뒤 캐릭터가 계속 움직이거나 입력 컨트롤을 조작하다 편집 도구가 바뀔 수 있다.

Recommendation: blur, pagehide, visibilitychange에서 상태를 초기화하고 editable/form target을 공통 판정하며 게임 키에만 조건부 `preventDefault`를 적용한다.

### AUDIT-12 P2 BUG 숨겨진 PlayerStart가 시작 레벨을 고르지만 실제 spawn에는 쓰이지 않는다

Evidence: `packages/demo/src/game.ts:135-140`의 start level 탐색은 layer visibility를 무시하지만 `runtime/level.ts:104-106`은 숨은 entity layer를 생성하지 않는다. 숨은 start가 level 1, 보이는 start가 level 2인 프로브는 level 1을 골랐다.

Impact: 플레이어가 fallback 위치에 나타나거나 의도와 다른 레벨에서 시작한다.

Recommendation: 시작점 탐색과 runtime entity 필터에 동일한 visibility 규칙을 사용하고 중복·누락 start를 validation error로 노출한다.

### AUDIT-13 P2 BUG localization이 빈 번역과 새 field의 기본값을 누락한다

Evidence: `packages/lib/src/format/localization.ts:45`는 `values[locale] || key`라 빈 문자열을 번역 누락으로 취급한다. `:22-31`은 instance 값만 수집해 배치 뒤 추가된 localized field의 default를 보지 않는다.

Impact: 의도적으로 비운 번역이 원문으로 돌아오고, 기본값에만 있는 번역 문자열은 추출 대상에서 빠진다.

Recommendation: nullish fallback을 쓰고 entity definition default와 instance override를 runtime과 같은 규칙으로 합친 뒤 추출한다.

### AUDIT-14 P2 BUG 64MiB 요청 제한이 초과 뒤에도 스트림과 메모리 누적을 멈추지 않는다

Evidence: `packages/lib/src/vite/plugin.ts:51-60`은 제한 초과 시 Promise만 reject하고 data listener 제거, pause/destroy, Content-Length 선검사를 하지 않는다. 길이도 byte가 아닌 JS code unit으로 센다.

Impact: 큰 요청이 거절돼도 최대 body 전체가 메모리에 쌓여 개발 서버가 멈추거나 메모리 압박을 받을 수 있다.

Recommendation: byte 단위 streaming parser와 Content-Length 검사를 사용하고 초과 즉시 listener를 해제하고 request를 종료한다.

### AUDIT-15 P2 RISK 저장이 비원자적이고 동시 편집 충돌을 감지하지 않는다

Evidence: `packages/lib/src/vite/plugin.ts:129-139`은 기존 프로젝트 파일에 직접 `fs.writeFile`하며 temp+rename, backup, ETag 또는 revision 비교가 없다.

Impact: 쓰기 중 프로세스·디스크 실패는 파일을 손상시킬 수 있고 두 탭의 저장은 마지막 작성자가 앞선 변경을 조용히 덮는다.

Recommendation: 같은 디렉터리 임시 파일에 flush 후 atomic rename하고, 읽기 revision/ETag 기반 optimistic locking과 복구 backup을 제공한다.

### AUDIT-16 P2 BUG 쓰지 않는 tileset 하나의 로드 실패도 현재 레벨 전체를 막는다

Evidence: `packages/lib/src/runtime/level.ts:64-72,88-90`은 매 레벨마다 `project.tilesets` 전부를 `Promise.all(Assets.load)`한다. 실제 소비는 현재 visible tile batch에 한정된다.

Impact: 다른 레벨에서만 쓰는 누락 asset 때문에 현재 레벨도 열리지 않고 시작·전환 비용이 불필요하게 커진다.

Recommendation: 현재 레벨의 실제 참조 집합만 추출해 lazy load하고 선택적 asset 실패는 진단 가능한 placeholder 정책으로 격리한다.

### AUDIT-17 P2 BUG `basePath` directory 해석이 trailing slash 유무에 따라 달라진다

Evidence: `packages/lib/src/runtime/level.ts:41-42,61-62`는 basePath를 그대로 URL base로 쓴다. `/assets/levels`에 대한 `tiles.png`는 `/assets/tiles.png`, `/assets/levels/`에서는 `/assets/levels/tiles.png`가 됐다.

Impact: 문서상 같은 디렉터리 입력이 slash 하나 때문에 다른 asset을 요청해 배포 환경에서만 실패할 수 있다.

Recommendation: API 입구에서 directory URL을 정규화하고 file URL을 허용하려면 별도 옵션으로 계약을 분리한다.

### AUDIT-18 P2 RISK 포맷의 version·형상·참조 무결성을 검증하거나 마이그레이션하지 않는다

Evidence: `format/types.ts`에는 version 상수가 있지만 공개 parser/validator가 없고 `editor/state/io.ts:27-30`과 import는 `format === 'svlevel'`만 검사한다. 필수 배열, UID 유일성, bounds, 참조, chance와 pattern 길이를 소비 코드가 신뢰한다.

Impact: 손상·구버전·미래버전 파일이 부분 적용 후 멀리 떨어진 UI/runtime 지점에서 예외나 조용한 데이터 왜곡을 만든다.

Recommendation: 경계에서 schema validation, referential validation, version별 migration을 수행하고 모든 오류에 JSON path와 복구 가능 여부를 붙인다.

### AUDIT-19 P2 RISK pixel mask와 atlas 처리의 collider·readback 비용이 맵 크기에 급증한다

Evidence: `runtime/grid.ts:105-127`은 pixel tile 내부 rect마다 collider를 만들고 이웃 tile과 합치지 않는다. checkerboard 16×16은 타일당 약 128 rect가 가능하며 `runtime/mask.ts:33-58` cache는 레벨 생성마다 새로 생긴다.

Impact: 복잡한 alpha mask나 큰 맵에서 레벨 전환 시간, Rapier collider 수, canvas readback 비용이 폭증할 수 있다.

Recommendation: mask 결과를 프로젝트/asset 단위로 캐시하고 rect 병합·complexity cap·사전 bake 옵션과 성능 카운터를 추가한다.

### AUDIT-20 P3 BUG chance 0 auto-rule이 특정 seed와 cell에서 발동한다

Evidence: `packages/lib/src/format/autoRules.ts:218-219`는 `rand > chance`일 때만 거부해 rand가 정확히 0이면 chance 0을 통과시킨다. uid 0, cell (0,0), seed 0 프로브에서 타일 1개가 생성됐다.

Impact: 비활성화 의미로 0을 쓴 rule이 드물게 나타나 재현하기 어려운 맵 오류를 만든다.

Recommendation: `chance <= 0`을 즉시 거부하고 확률 경계를 0, 1, 범위 밖 값까지 명시적으로 테스트한다.

### AUDIT-21 P3 RISK mutable tileset tag cache가 편집 뒤 오래된 값을 반환할 수 있다

Evidence: `packages/lib/src/runtime/grid.ts:45-56`은 tileset 객체를 키로 한 WeakMap 결과를 영구 재사용하지만 공개 타입/API는 객체 변경을 막지 않는다.

Impact: 같은 객체의 enumTags를 수정해 runtime을 다시 만들면 시각 데이터와 collider tag가 달라질 수 있다.

Recommendation: 입력을 immutable snapshot으로 만들거나 revision을 cache key에 포함하고 명시적 invalidation API를 제공한다.

### AUDIT-22 P3 RISK Vite `base` 정규화 실패가 API를 전부 가로채거나 비활성화한다

Evidence: `packages/lib/src/vite/plugin.ts:35-38`은 trailing slash 하나만 제거한다. `base:'/'`는 빈 문자열이 되어 모든 요청을 대상으로 하고 leading slash 없는 `base:'api'`는 일반 `/api/...`와 맞지 않는다.

Impact: 설정값 하나로 정적 파일 요청이 middleware에 끌려가거나 save/upload가 전혀 동작하지 않을 수 있다.

Recommendation: URL pathname 규칙으로 leading/trailing slash를 정규화하고 root/custom base routing 테스트를 추가한다.

### AUDIT-23 P3 RISK 데모가 쓰지 않는 nav grid와 debug draw 비용을 기본으로 지불한다

Evidence: `packages/demo/src/game.ts:173-179`은 항상 navGrid를 만들지만 로그 외 사용이 없고 panel 기본 debug는 true다. 매 tick `world.debugRender()` 결과 전체를 다시 그린다.

Impact: 큰 레벨에서 초기화 시간·메모리·프레임 비용이 실제 사용자 데모 성능을 왜곡한다.

Recommendation: 둘 다 opt-in 개발 플래그로 바꾸고 기본 배포에서는 끄며 FPS와 collider 수를 panel에 표시한다.

### AUDIT-24 P1 BUG optional Rapier peer가 root import에서 사실상 필수다

Evidence: `packages/lib/package.json`은 Rapier를 optional peer로 선언하지만 `packages/lib/src/index.ts:9-11`이 Rapier 의존 모듈을 정적 재수출한다. 실제 `pnpm build` 산출물 `packages/lib/dist/index.js` 첫 import도 `@dimforge/rapier2d-compat`를 eager import한다.

Impact: 포맷·localization만 쓰려는 깨끗한 소비자도 optional dependency가 없으면 root import 단계에서 실패해 패키지 계약을 위반한다.

Recommendation: `./format`, `./runtime`, `./editor` conditional exports를 분리하고 root는 Rapier 없는 API만 내보내거나 peer를 필수로 선언한다. clean consumer 설치 테스트를 추가한다.

### AUDIT-25 P1 BUG 저장 도중 한 후속 편집이 완료 콜백에 의해 깨끗한 상태로 덮인다

Evidence: `editorStore.svelte.ts:205-214`는 현재 snapshot을 await로 저장한 뒤 revision 비교 없이 `dirty=false`로 만든다. 대기 중 `touch()`가 새 revision을 만들어도 늦은 응답이 상태를 덮고, 중첩 저장의 완료 순서도 통제하지 않는다.

Impact: UI가 저장되지 않은 변경을 Saved로 표시해 창 닫기 보호가 사라지고 데이터 손실로 이어진다.

Recommendation: 저장 시작 revision/snapshot을 기록해 현재 revision과 같을 때만 clean 처리하고 저장 큐 또는 latest-wins 직렬화를 적용한다.

### AUDIT-26 P1 BUG editor destroy 후 재마운트가 이전 문서를 새 경로에 저장할 수 있다

Evidence: `editor/mount.ts:34-53`의 store는 모듈 singleton이고 destroy는 Svelte app만 unmount한다. 재마운트 때 projectPath만 바뀌지만 `EditorShell.svelte:138-141`은 기존 project가 있어 새 파일을 load하지 않는다.

Impact: SPA route 전환이나 테스트 재마운트 뒤 화면은 이전 프로젝트인데 Save 대상은 새 경로가 되어 다른 파일을 덮을 수 있다.

Recommendation: mount마다 독립 store/context를 만들고 destroy에서 listener·cache·project 상태를 폐기하며 lifecycle 통합 테스트를 추가한다.

### AUDIT-27 P1 BUG enum 이름·값 변경이 모든 참조를 마이그레이션하지 않는다

Evidence: `EnumEditor.svelte:47-105`의 enum ID rename은 entity field definition을 누락하고 value rename은 tileset tag만 갱신한다. level/entity default와 instance 값은 그대로이며 문서는 references 보존을 약속한다.

Impact: 편집 직후 필드가 빈 값처럼 보이거나 런타임 데이터와 UI가 서로 다른 enum ID/value를 사용한다.

Recommendation: 프로젝트 전체 reference index로 rename transaction을 수행하고 충돌 검증, preview, undo, round-trip 테스트를 제공한다.

### AUDIT-28 P1 BUG entity field 스키마 변경이 배치 인스턴스 값을 마이그레이션하지 않는다

Evidence: `EntityDefsEditor.svelte:245-322`는 field ID·type·definition만 바꾸거나 삭제하며 각 entity instance의 `Record<fieldId,value>`를 갱신하지 않는다. 빈 ID와 중복 ID 검사도 없다.

Impact: field rename/delete/type 변경 뒤 기존 레벨의 값이 고아가 되거나 새 필드가 기본값으로 보이며 사용자 데이터가 조용히 사라진다.

Recommendation: schema mutation을 검증된 migration command로 만들고 모든 instance/default를 원자 변경하며 손실 변환에는 확인과 backup을 요구한다.

### AUDIT-29 P2 BUG 빈 프로젝트의 기본 Save 경로가 유효하지 않고 선택 UI도 없다

Evidence: `mount.ts:39-41`은 옵션 없이 path 없는 emptyProject를 열고 store path 기본값은 빈 문자열이다. Save는 이를 그대로 보내 Vite의 `.svlevel.json` 검사에 거절되며 availableProjects는 로드되지만 UI에서 쓰지 않는다.

Impact: 문서화된 기본 mount 경로에서 사용자가 처음 만든 프로젝트를 저장할 수 없다.

Recommendation: 첫 저장은 Save As를 강제하고 새 프로젝트·최근 프로젝트·availableProjects 선택 화면과 유효 경로 검증을 제공한다.

### AUDIT-30 P2 BUG entity를 현재 level 밖에 배치하거나 resize 뒤 외부에 남길 수 있다

Evidence: `EditorCanvas.svelte:837-939`은 좌표/footprint bounds 확인 없이 current level에 entity를 push하고 `factory.ts:106-143`의 resize는 tile만 자르고 entity는 필터·클램프하지 않는다.

Impact: 화면에서 찾기 어려운 고아 entity가 저장되고 runtime 좌표·level 경계 가정이 깨진다.

Recommendation: 배치·이동 시 footprint bounds를 강제하고 resize 때 이동/삭제/취소 선택과 out-of-bounds 진단을 제공한다.

### AUDIT-31 P2 BUG layer·rule group 삭제가 의존 참조와 cached auto tile을 고아로 남긴다

Evidence: `editorStore.svelte.ts:477-548`의 삭제는 정의와 일부 instance만 제거한다. AutoLayer source, autoTiles, IdGrid cell, 다른 rule pattern의 group-name 참조는 즉시 migration/recompute되지 않는다.

Impact: 삭제 뒤 보이지 않는 오래된 타일이 남거나 rule이 다른 의미로 평가되고 저장 파일에 깨진 참조가 누적된다.

Recommendation: 삭제 전에 dependency graph를 보여주고 cascade/replace/cancel을 선택하게 하며 단일 undo transaction으로 재계산한다.

### AUDIT-32 P2 BUG 내용 변경이 아닌 이미지 로드·no-op·저장점 undo도 dirty/history를 오염시킨다

Evidence: 여러 이미지 대화상자는 `ensureImage(..., () => editor.touch())`로 열기만 해도 dirty가 된다. `editorStore.svelte.ts:269-316`은 실제 변경 여부나 저장 snapshot 복귀와 관계없이 checkpoint와 dirty를 만들며 브라우저에서도 history index 0으로 undo한 뒤 Save 표시가 남았다.

Impact: 불필요한 저장 경고와 history 항목이 쌓이고 실제 미저장 상태를 신뢰하기 어렵다.

Recommendation: content hash 또는 saved revision을 기준으로 dirty를 계산하고 resource cache 갱신은 document revision에서 분리하며 no-op command를 버린다.

### AUDIT-33 P2 BUG tileset의 tags enum을 바꾸면 이전 태그가 숨은 채 런타임에 남는다

Evidence: `TilesetTagEditor.svelte:49-52`는 tagsEnumId만 바꾸고 enumTags를 remap/clear하지 않는다. runtime `grid.ts:45-56`은 enum ID를 보지 않고 남은 모든 tag 값을 collider metadata로 노출한다.

Impact: 편집기에서 보이지 않는 과거 태그가 충돌 이벤트와 게임 로직을 계속 작동시킨다.

Recommendation: enum 교체 시 공통 값 remap, 나머지 제거 확인, 취소를 제공하고 validator가 enum에 없는 tag를 오류로 잡게 한다.

### AUDIT-34 P2 BUG palette remap 비동기 경쟁이 원본 또는 이전 이미지를 가져올 수 있다

Evidence: `TilesetImport.svelte:60-165`는 remap pending 상태나 요청 generation을 저장하지 않는다. 완료 전 Add가 활성화되고 빠른 source 재선택의 늦은 결과도 현재 선택을 덮을 수 있다.

Impact: 사용자가 preview와 다른 원본/이전 파일을 프로젝트에 넣고 큰 이미지는 main-thread ImageData 순회로 UI를 오래 멈출 수 있다.

Recommendation: 각 요청에 generation을 부여하고 pending 동안 Add를 막으며 Web Worker/OffscreenCanvas, 크기 제한, 취소와 진행률을 추가한다.

### AUDIT-35 P2 RISK pointer 중단이 canvas stroke 상태를 고착시킬 수 있다

Evidence: `EditorCanvas.svelte:1285-1297`은 pointerup/leave만 연결하고 pointercancel, lostpointercapture, window blur를 처리하지 않는다. 종료 함수에만 painting/move/resize 상태 해제가 모여 있다.

Impact: OS gesture, 창 전환, capture 상실 시 이후 pointer move가 계속 그리거나 하나의 거대한 undo stroke로 합쳐질 수 있다.

Recommendation: pointer capture를 명시적으로 사용하고 모든 취소·blur 경로가 동일한 finalize/cancel 함수로 수렴하게 한다.

### AUDIT-36 P2 RISK 자동 품질 게이트가 Svelte UI와 핵심 lifecycle을 거의 검사하지 않는다

Evidence: `pnpm check`의 6개 self-check는 pure helper 중심이고 demo check는 문자 그대로 `no checks`다. svelte-check, store/factory/Vite/lifecycle E2E, lint/format/coverage가 없으며 Pages workflow도 build만 실행한다.

Impact: 이번 감사에서 나온 저장·마이그레이션·전환·접근성 결함 대부분이 CI에서 재발해도 탐지되지 않는다.

Recommendation: `svelte-check`와 unit/integration/Playwright suite를 추가하고 typecheck, check, build, pack smoke, accessibility smoke를 PR·Pages 필수 gate로 둔다.

### AUDIT-37 P3 BUG 한 번 실패한 이미지 URL을 같은 세션에서 영구히 재시도하지 않는다

Evidence: `editor/render/images.ts:6-44`는 실패 URL을 module-level Set에 넣고 이후 즉시 undefined를 반환하며 invalidate/retry API가 없다.

Impact: 일시적 네트워크 오류나 사용자가 파일을 고친 뒤에도 새로고침 전까지 이미지가 복구되지 않는다.

Recommendation: 지수 backoff와 수동 retry/invalidate를 제공하고 성공·실패 cache에 수명과 project revision을 둔다.

### AUDIT-38 P2 BUG 고정 3열 레이아웃이 작은 화면에서 핵심 기능을 화면 밖으로 밀어낸다

Evidence: managed Chrome에서 1024px viewport의 scrollWidth가 1247px이고 Play/Save가 밖에 있었다. 768px에서는 center가 208px, 390px에서는 0px였고 16개 control이 접근 불가했다. `EditorShell.svelte:235`는 `248px 1fr 312px` 고정 열이다.

Impact: 노트북 분할 화면, 임베드, 모바일 폭에서 Rules·Play·Save와 편집 canvas를 정상 사용할 수 없다.

Recommendation: container query 기반 2열/1열 전환, 접이식 side panel, toolbar wrap/overflow 메뉴와 최소 canvas 폭을 구현한다.

### AUDIT-39 P2 BUG 데모 Tweakpane가 modal 위에서 내용을 가리고 클릭을 가로챈다

Evidence: 로컬과 공개 데모의 Rules dialog 위로 Tweakpane가 겹쳤고 `elementFromPoint(900,100)`은 dialog가 아닌 panel을 반환했다. editor의 fixed stacking context와 외부 panel의 관계 때문에 modal z-index 100만으로 해결되지 않는다.

Impact: modal의 일부 control을 보거나 클릭할 수 없고 modal이라는 상호작용 계약이 깨진다.

Recommendation: editor와 panel을 공통 overlay 계층 아래 배치하거나 modal open 동안 panel을 inert/숨김 처리하고 stacking E2E를 추가한다.

### AUDIT-40 P2 BUG modal·Play·아이콘·canvas의 키보드/접근성 계약이 불완전하다

Evidence: Rules를 열어도 focus는 BODY에 남고 Tab은 배경 toolbar로 이동했으며 닫을 때 trigger로 복원되지 않았다. visible interactive 75개 중 47개에 접근 가능한 이름이 없었고 canvas는 focus 불가다. Color field는 선언되지 않은 DOM global `name`을 aria-label로 전달한다.

Impact: 키보드와 화면 읽기 사용자에게 modal 경계, 도구 의미, canvas 편집 경로가 제공되지 않으며 Play 중에도 배경 UI가 탐색된다.

Recommendation: focus trap/initial/restore와 inert를 공통 Dialog에 구현하고 모든 아이콘·필드에 이름을 부여하며 canvas용 키보드 대체 조작과 자동 axe 검사를 추가한다.

### AUDIT-41 P3 RISK Rapier 호환 범위와 초기화 호출이 검증된 버전을 벗어난다

Evidence: peer 범위가 pre-1.0 패키지에 상한 없는 `>=0.14`지만 lockfile 검증 버전은 0.19.3이고 감사 당시 0.20.0은 미검증이다. 최초 Play에서 로컬·공개 모두 deprecated initialization parameters 경고가 한 번 발생했다.

Impact: 미래 minor release에서 API/동작 변경이 소비자 설치를 깨뜨릴 수 있고 현재 호출은 향후 제거 대상일 가능성이 있다.

Recommendation: 검증된 호환 범위로 제한하고 버전 matrix CI를 두며 최신 object-form 초기화 API로 변경한다.

### AUDIT-42 P3 RISK demo 이미지의 출처와 별도 라이선스가 기록돼 있지 않다

Evidence: demo tileset PNG 4개와 docs screenshot 23개가 있지만 README/docs/LICENSE에서 원저작자, 자체 제작 여부, asset별 라이선스를 찾지 못했다. npm tarball에는 없지만 GitHub Pages에는 배포된다.

Impact: 침해를 단정할 수는 없으나 재배포·상업 사용 시 권리 확인 비용과 법적 불확실성이 남는다.

Recommendation: `ASSETS.md`에 각 파일의 출처, 저작자, 라이선스, 수정 여부를 기록하고 CI에서 새 binary asset의 provenance 항목을 요구한다.

### AUDIT-43 P3 BUG entity label 배경 폭을 의도한 font를 설정하기 전에 측정한다

Evidence: `EditorCanvas.svelte:414-422`는 `ctx.measureText(def.name)`로 배경 폭을 계산한 다음 줄에서야 7px monospace font를 설정한다.

Impact: 이전 canvas font 상태에 따라 label 배경이 글자를 자르거나 과도하게 넓어지는 작은 시각 결함이 생긴다.

Recommendation: font와 textBaseline을 먼저 설정한 뒤 측정하고 긴 이름·고배율 snapshot 테스트를 추가한다.

### AUDIT-44 P1 BUG 형식 문자열만 맞는 잘못된 import가 현재 문서를 먼저 교체한 뒤 편집기를 깨뜨린다

Evidence: managed Chrome에서 `{"format":"svlevel"}` 파일을 import하자 `Toolbar.svelte`에서 `levels.find` 관련 TypeError가 발생하고 UI가 stale 상태가 됐다. `editorStore.svelte.ts:164-201`은 format만 검사하고 `this.project = project`를 필수 구조 접근보다 먼저 실행한다.

Impact: 현재 미저장 프로젝트가 손상된 입력으로 교체되고 편집 UI가 crash해 데이터 손실로 이어진다.

Recommendation: 별도 객체에서 완전 validation/migration과 초기 view 계산을 끝낸 뒤 한 transaction으로 commit하고 실패 시 기존 project/history/selection을 그대로 보존한다.

### AUDIT-45 P1 BUG 저장하지 않은 편집 내용이 demo mode 전환에서 확인 없이 소실된다

Evidence: 브라우저에서 paint 후 Save 표시와 history가 생긴 상태로 Platformer에서 Top-down으로 바꾸자 확인 없이 다른 프로젝트가 로드되고 Saved/history 0으로 돌아갔다. `packages/demo/src/main.ts:94-103`은 dirty 확인 없이 `editor.load()`를 호출한다.

Impact: mode selector를 잘못 건드리는 것만으로 사용자가 저장하지 않은 작업을 잃는다.

Recommendation: 모든 project 교체 경로에 공통 unsaved-changes guard를 적용하고 Save/Discard/Cancel을 제공하며 beforeunload와 같은 dirty source를 사용한다.

### AUDIT-46 P3 RISK canvas 편집 중 ResizeObserver 오류가 한 차례 관측됐다

Evidence: Top-down paint 후 undo 세션에서 `ResizeObserver loop completed with undelivered notifications.` window error가 1회 기록됐다. 빠른 restart 15회와 새 로컬·공개 초기 로드에서는 재현되지 않았다.

Impact: 현재는 일회성 위험이지만 반복되면 resize 갱신 누락이나 테스트 잡음을 만들 수 있다.

Recommendation: ResizeObserver callback의 동기 layout mutation을 추적하고 rAF로 배치한 뒤 오류 카운터를 둔다. 안정적으로 재현되기 전에는 P3 관찰 항목으로 유지한다.

### AUDIT-47 P2 RISK 빌드는 성공하지만 번들 크기와 실험적 도구 조합 경고가 크다

Evidence: `pnpm build`는 성공했지만 demo main chunk가 2,374.79kB(raw)/825.24kB(gzip)로 Vite 500kB 경고를 냈다. Vite 8에 대한 Svelte plugin의 beta/experimental 지원 경고와 extension 없는 `./vite/plugin`의 native config loader 미래 경고도 발생했다.

Impact: 초기 로드·캐시 비용이 크고 도구 업데이트 때 build가 갑자기 깨질 가능성이 있다.

Recommendation: editor/game/Rapier를 dynamic import로 분리하고 bundle budget을 CI에 두며 Vite/Svelte plugin 호환 버전을 맞추고 config import에 명시적 확장자를 사용한다.

## 기능 제안

### FEATURE-1 P1 FEATURE 안전한 프로젝트 진단·마이그레이션·복구 센터

Evidence: AUDIT-18과 AUDIT-44처럼 형식 문자열 외 검증이 없고 잘못된 import가 현재 문서를 교체한 뒤 crash했다.

Impact: validator만 추가하는 것보다 열기 전 진단, 버전별 migration preview, 자동 backup과 복구 UI를 묶으면 데이터 손실 경로를 크게 줄일 수 있다.

Recommendation: `parseProject()`가 typed diagnostics와 migrated copy를 반환하게 하고 Import/Open 화면에서 오류 위치, 자동 수정, read-only 열기, backup 복원을 제공한다.

### FEATURE-2 P2 FEATURE Save As·최근 프로젝트·autosave·충돌 해결 워크플로

Evidence: 빈 프로젝트는 기본 Save가 실패하고 availableProjects 데이터는 UI에서 사용되지 않으며 동시 저장 충돌도 탐지하지 않는다.

Impact: 파일 기반 편집기의 핵심 프로젝트 관리 경험과 장애 복구가 현재 API 사용자에게 떠넘겨져 있다.

Recommendation: New/Open/Recent/Save As, 주기적 local recovery snapshot, 서버 revision 비교, 충돌 diff/복제 저장을 하나의 project picker로 제공한다.

### FEATURE-3 P2 FEATURE WebGPU tile shader 경로

Evidence: `packages/lib/src/runtime/tiles.ts:17-94,161-172`는 GLSL `gl` shader만 제공하고 데모는 이 때문에 Pixi를 WebGL로 강제한다.

Impact: WebGPU renderer 선택과 향후 Pixi 기본 경로의 성능·호환성 이점을 사용할 수 없다.

Recommendation: WGSL 리소스를 같은 tile semantics로 구현하고 renderer별 golden image 테스트와 자동 fallback을 추가한다.

### FEATURE-4 P3 FEATURE 실제 auto-rule Stamp 모드 또는 명시적 제거

Evidence: `format/types.ts:161-169`은 `tileMode:'Stamp'`와 pivot을 보존하지만 `autoRules.ts:231-247`은 항상 단일 tile만 만든다.

Impact: 포맷에 노출된 기능을 사용자가 기대해도 결과가 일반 모드와 같아 혼란스럽다.

Recommendation: multi-cell stamp asset·pivot·회전/flip semantics와 editor preview를 구현하거나 다음 format version에서 필드를 제거한다.

### FEATURE-5 P3 FEATURE level field 정의와 값 편집 UI

Evidence: 포맷은 project `levelFields`와 각 level `fields`를 지원하지만 Properties panel은 name, size, world, background만 제공한다.

Impact: 런타임이 지원하는 레벨별 난이도·음악·환경 metadata를 GUI 사용자만 만들거나 수정할 수 없다.

Recommendation: entity field editor와 같은 typed control, enum reference, default/override 표시, localization 지원을 level properties에 추가한다.

### FEATURE-6 P2 FEATURE 참조 인식 tileset 수명주기 관리

Evidence: 현재 편집기에서 tileset mutation은 add뿐이며 rename, image replace, delete와 사용처 조회가 없다.

Impact: 프로젝트가 커질수록 사용하지 않는 asset을 정리하거나 교체하기 어렵고 AUDIT-16의 eager load 비용도 커진다.

Recommendation: usage graph, rename/replace, delete preview, reference remap, orphan cleanup과 atlas dimension 검증을 제공한다.

### FEATURE-7 P3 FEATURE 배포 패키지 문서·메타데이터·에셋 명세 보강

Evidence: `npm pack --dry-run`의 60개 항목에 README가 없고 lib package에 repository/homepage/bugs가 없다. demo asset provenance도 별도 문서가 없다.

Impact: npm 소비자가 설치 후 사용법·지원 경로·호환성·라이선스를 찾기 어렵다.

Recommendation: package 전용 README, exports 예제, compatibility matrix, repository/homepage/bugs, `ASSETS.md`를 tarball과 사이트에 포함한다.

### FEATURE-8 P2 FEATURE lifecycle·저장·Vite·브라우저 회귀 테스트 체계

Evidence: 현재 check는 pure helper 6종에 집중되고 demo는 자동 테스트가 없으며 저장 레이스, import crash, 모드 전환, responsive/accessibility가 모두 수동 감사에서 발견됐다.

Impact: 핵심 결함을 고친 뒤에도 릴리스마다 같은 유형이 재발할 가능성이 높다.

Recommendation: fake-time runtime tests, temp-root Vite security tests, store migration tests, Playwright local/live smoke와 axe, 390/768/1024 visual snapshots를 계층별로 추가한다.

### FEATURE-9 P2 FEATURE lazy loading·code splitting·성능 예산과 진단 패널

Evidence: build main chunk는 gzip 825.24kB이고 모든 tileset eager load, pixel collider 폭증, 기본 debug/nav 비용, main-thread palette remap 경로가 확인됐다.

Impact: 프로젝트 규모가 커질 때 초기 로드와 편집 반응성이 언제 임계점을 넘는지 사용자가 알기 어렵다.

Recommendation: editor/Play/Rapier/level asset을 지연 로드하고 Worker를 활용하며 bundle, load time, collider count, frame time 예산을 CI와 panel에 노출한다.

## 검증

- `pnpm check`: 성공. 라이브러리 self-check 6종 통과; demo는 자체 검사 없음.
- `pnpm typecheck`: 성공.
- `pnpm build`: 성공. 모든 선언된 JS 및 `.d.ts` entrypoint 생성 확인; AUDIT-47의 경고는 남음.
- `pnpm audit --prod`: 2026-08-28 기준 알려진 production 취약점 없음.
- `npm pack --dry-run --json --ignore-scripts`: 60 entries, tarball 435,746B, unpacked 1,771,154B; README 누락 확인.
- 로컬 `http://localhost:8383`와 공개 `https://chamchi0809.github.io/pixi-vania/`를 managed headless Chrome으로 검사했다. 초기 로드, 대화상자 8종, paint/entity/history/import/export, 두 게임 mode, 이동·점프·restart·Esc, 빠른 restart 15회, 1024/768/390 viewport, focus/accessibility tree, console/network를 포함했다.
- 로컬·공개 데모 모두 HTTP 200이며 기본 경로의 failed resource는 0이었다. 빠른 restart 15회에서 canvas/listener 증가, unhandled rejection, crash는 관측되지 않았고 listener count는 298로 동일했다.
- malformed import, chance 0, rect offset, pixel flip, tag merge, sensor ray, hidden PlayerStart, localization, optional Rapier eager import는 별도 재현 또는 산출물 검사를 수행했다.

### 원시 발견 정합성 매핑

모든 원시 ID는 아래 최종 항목으로 수용·병합했다. 제외한 발견은 없으며, 중복은 동일 원인이나 동일 사용자 영향일 때만 합쳤다.

- Core: CORE-1→AUDIT-1; CORE-2→AUDIT-2; CORE-3→AUDIT-3; CORE-4→AUDIT-4; CORE-5→AUDIT-5; CORE-6→AUDIT-6; CORE-7→AUDIT-7; CORE-8→AUDIT-8; CORE-9→AUDIT-9; CORE-10→AUDIT-10; CORE-11→AUDIT-11; CORE-12→AUDIT-12; CORE-13→AUDIT-13; CORE-14→AUDIT-14; CORE-15→AUDIT-15; CORE-16→AUDIT-16; CORE-17→AUDIT-17; CORE-18→AUDIT-18/FEATURE-1; CORE-19→AUDIT-19/FEATURE-9; CORE-20→FEATURE-3; CORE-21→AUDIT-20; CORE-22→AUDIT-21; CORE-23→AUDIT-22; CORE-24→AUDIT-23/FEATURE-9; CORE-25→FEATURE-4; CORE-26→AUDIT-36/FEATURE-8; CORE-27→AUDIT-24/AUDIT-41.
- Editor/tooling: EDITOR-1→AUDIT-25; EDITOR-2→AUDIT-26; EDITOR-3→AUDIT-27; EDITOR-4→AUDIT-28; EDITOR-5→AUDIT-29/FEATURE-2; EDITOR-6→AUDIT-30; EDITOR-7→AUDIT-31; EDITOR-8→AUDIT-32; EDITOR-9→AUDIT-33; EDITOR-10→AUDIT-34; EDITOR-11→AUDIT-35; EDITOR-12→AUDIT-18/FEATURE-1; EDITOR-13→AUDIT-36/FEATURE-8; EDITOR-14→AUDIT-4; EDITOR-15→AUDIT-3; EDITOR-16→AUDIT-32; EDITOR-17→AUDIT-37; EDITOR-18→AUDIT-11/AUDIT-40; EDITOR-19→AUDIT-40; EDITOR-20→AUDIT-38; EDITOR-21→FEATURE-5; EDITOR-22→FEATURE-6; EDITOR-23→FEATURE-7; EDITOR-24→AUDIT-24/AUDIT-41; EDITOR-25→AUDIT-42/FEATURE-7; EDITOR-26→AUDIT-43; EDITOR-27→AUDIT-14/AUDIT-19/AUDIT-34/FEATURE-9.
- Browser/runtime: RUNTIME-1→AUDIT-44/FEATURE-1; RUNTIME-2→AUDIT-45; RUNTIME-3→AUDIT-1; RUNTIME-4→AUDIT-38; RUNTIME-5→AUDIT-39; RUNTIME-6→AUDIT-40; RUNTIME-7→AUDIT-40; RUNTIME-8→AUDIT-32; RUNTIME-9→AUDIT-41; RUNTIME-10→AUDIT-46.

## 한계

- 데이터 손실을 피하기 위해 실제 Save/upload, 파일 덮어쓰기, destructive delete는 브라우저에서 실행하지 않았다. 해당 경로는 소스와 비파괴 프로브로 감사했다.
- 장시간 플레이, 모든 레벨 경계·entity 조합, 실제 터치 하드웨어, 실제 화면 읽기 프로그램의 음성 출력은 검사하지 않았다.
- AUDIT-46은 단 한 번만 관측돼 확정 버그가 아니라 위험으로 유지했다. Vite 보안 항목은 서버가 공격자 요청에 노출되는 조건을 전제로 한다.
- dependency audit은 감사일의 lockfile과 registry 상태 기준이다. `pnpm outdated`에 표시된 업데이트 존재 자체는 버그로 세지 않았다.
- 감사 목적으로 애플리케이션 소스·설정·의존성·에셋은 수정하지 않았다. 최종 보고서와 추적용 `.unlazy/` ignore 항목만 추가했다.
