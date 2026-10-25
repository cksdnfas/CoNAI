# 플러그인 제작 가이드

확인: 2026-10-16, 현재 작업 트리 기준.

CoNAI의 화면·내부 자료·AI·백그라운드 작업을 연결하는 플러그인을 만드는 개발자와 AI를 위한 안내입니다. 이 문서는 Git으로 공유하며, 개인 플러그인 제작 중 추가한 **메인 앱의 공용 연결**도 여기에서 관리합니다. 현재 작업 트리의 연결이 과거 배포 버전에도 있다고 가정하지 말고 설치할 호스트의 구현을 확인하세요.

| 문서 | 역할 |
| --- | --- |
| [AI 개발 가이드](../../AI_Guidelines.md) | 개발 정책과 필수 기준 |
| 이 문서 | 제작 순서, 연결 선택, 공용 확장 기록 |
| [플러그인 SDK 계약](../../plugins/README.md) | 메서드·입출력·제한·실행 경계의 상세 명세 |
| [개발 구조](../../DEVELOPMENT.md#선택-설치-확장) | 메인 코드 탐색 지도 |
| [선택 설치 확장](./PLUGINS.md) | 사용자의 설치·실행·설정 방법 |

## 1. 소스 위치와 구현 범위

| 대상 | 위치와 원칙 |
| --- | --- |
| 공개 플러그인·개발 예제 | `plugins/<id>/`. Git에 포함합니다. |
| 개인 플러그인 | `local-plugins/<id>/`. Git과 기본 Docker 빌드에서 제외합니다. |
| 개인 전용 렌더러·테스트·문서 | `local-plugins/` 아래에 별도로 보관합니다. 공개 코드·테스트가 이 파일을 요구하면 안 됩니다. |
| 공용 SDK·호스트 연결 | `plugins/sdk/`, `shared/`, `backend/`, `frontend/`의 기존 플러그인 경로를 확장합니다. Git에 포함하고 이 문서에 기록합니다. |

플러그인의 화면, 템플릿, 제작 규칙, 외부 엔진별 처리는 패키지에 둡니다. 메인 앱은 다른 플러그인도 재사용할 파일·미디어·AI·작업 연결과 기존 도메인 검증을 담당합니다. 필요하지 않은 범용 계층을 미리 만들지 않습니다.

기존 SDK와 네이티브 도구/API로 요청을 완성할 수 있는지 먼저 확인합니다. 연결이 없으면 필요한 공용 경로를 최소한으로 확장합니다. 플러그인 화면을 메인 React 번들에 직접 삽입하거나 플러그인별 별도 저장·LLM 실행 엔진을 만드는 방식은 피합니다.

## 2. 패키지 만들기

관리자는 앱의 **설정 → 플러그인 관리 → 새 플러그인**에서 SDK가 포함된 제작 초안을 만들거나, 설치된 플러그인의 **소스 수정**에서 패키지를 복사할 수 있습니다. 소스 저장·자산 업로드 후 **검증 및 설치 검토**로 정확한 리비전의 변경 파일을 확인하고 적용합니다. 초안과 설치된 패키지 모두 **ZIP 내보내기**를 지원하며 전용 데이터·계정별 설정은 제외합니다. 앱 안의 제작은 아래 로컬 빌드와 같은 manifest·설치 검증기를 사용하며 외부 패키지 관리자나 셸을 실행하지 않습니다.

채팅은 관리자 1:1 대화의 `configure` 범위에서 `list_plugin_drafts` → `create_plugin_draft` → `read_plugin_draft` / `edit_plugin_draft` → `prepare_plugin_install`을 사용합니다. 생성과 변경에는 안정된 `requestId`, 변경과 검토에는 현재 `revision`을 전달합니다. 초안 저장은 실행 코드 적용이 아니며, 설치 준비 결과는 `needs_human_review`와 관리 화면 링크입니다. 실제 설치·활성화를 완료했다고 보고하면 안 됩니다. 새 기능의 페이지 작업과 SDK 핸들러를 함께 작성하고, 이 가이드는 `get_app_guide(topic: "PLUGIN_DEVELOPMENT")`로 필요한 절만 읽습니다.

작업과 가까운 실행 예제부터 읽으세요.

| 예제 | 참고할 기능 |
| --- | --- |
| [text-editor](../../plugins/text-editor/plugin.json) | 파일 읽기, 초안, 페이지 어시스턴트, 저장 검토 |
| [app-workbench](../../plugins/app-workbench/README.md) | 기존 앱 도구, 프로젝트 연결, 화면 없는 서버 작업 |
| [chat-instructions](../../plugins/chat-instructions/server.mjs) | Node 서버 모듈, 전용 DB, 훅, MCP 도구 등록 |
| [generation-helper](../../plugins/generation-helper/plugin.json) | 기존 화면의 레이아웃 블록·생성 버튼과 큐 이벤트 |

패키지 루트에는 `plugin.json`, 진입 HTML, 외부 JS/CSS 파일을 둡니다. 서버 처리가 필요하면 manifest에 `"server": { "entry": "server.mjs" }`를 선언하고 `activate(conai)`를 내보냅니다. 페이지 스크립트는 `connectPlugin(handlers)`로 연결하고 공용 `conai-plugin.css`와 `--conai-*` 테마 변수를 사용합니다. 한국어 UI 문구는 반말로 작성합니다.

Manifest의 `id`와 페이지 ID는 안정적으로 유지하고, 업데이트할 때 `version`을 올립니다. 페이지 작업은 `<pluginId>.<action>` ID, 설명, 입력 스키마, `effect: 'draft'`, `tier: 'view' | 'draft'`를 등록합니다. `pages[].actions`의 스키마는 **CoNAI 페이지 스키마**입니다. 정수는 `{ "type": "number", "integer": true }`로 표현합니다. 서버의 `conai.tools.register`가 받는 JSON Schema와 혼동하지 마세요. 실제 검증기는 [chatPageAction.ts](../../shared/src/utils/chatPageAction.ts)에 있습니다.

저장소 루트에서 패키지를 만듭니다.

```sh
# 공개 예제
node scripts/build-plugin.mjs text-editor
# 개인 플러그인: local-plugins/my-plugin/
node scripts/build-plugin.mjs --local my-plugin
```

출력은 각각 `build-output/plugins/`, `build-output/local-plugins/`입니다. 빌드 스크립트가 SDK JS/CSS를 함께 넣습니다. 현재 스크립트는 패키지 폴더에서 Markdown만 제외하므로 `node_modules`, 테스트, 실행 바이너리, Docker 빌드 문맥은 ZIP 대상 폴더 밖에 두세요. ZIP은 압축 8MiB·해제 16MiB·개별 파일 4MiB·256개 항목 제한이 있으며 패키지 관리자 설치 훅은 실행하지 않습니다. 상세 허용 형식은 [Package contract](../../plugins/README.md#package-contract)를 따릅니다.

관리자가 **설정 → 플러그인**에서 ZIP을 설치·활성화한 뒤 상단 메뉴의 **플러그인**에서 실행합니다. 기존 ID에 업로드하면 업데이트되며 데이터가 유지됩니다. 제거는 전용 데이터도 삭제하므로 업데이트 전에 제거하지 않습니다. 메인 연결도 바꿨다면 호스트 빌드·재시작과 플러그인 ZIP 업데이트를 함께 안내하세요.

공개 Git 저장소로 배포하면 관리자가 **Git에서 설치**로 설치하고 **업데이트 확인**으로 새 커밋을 검토해 반영할 수 있습니다([사용 흐름](./PLUGINS.md#git-저장소에서-설치업데이트)). 저장소에는 `plugin.json`이 있는 플러그인 폴더를 둡니다. 저장소 루트도, `plugins/<id>/` 같은 하위 폴더도 되며 관리자가 설치할 때 그 경로를 입력합니다. 호스트는 로컬 빌드 스크립트와 같은 규칙으로 패키지를 만듭니다. 폴더 아래 파일만 넣고 점으로 시작하는 파일·폴더, Markdown, 패키지 허용 형식이 아닌 파일은 제외하며(검토 화면에 표시) 호스트의 SDK `conai-plugin.js`/`conai-plugin.css`를 넣습니다. 저장소의 SDK 사본은 무시하므로 커밋하지 않아도 됩니다. 링크(symlink)와 경로 탈출은 거절합니다. 빌드 단계를 실행하지 않으므로 번들된 실행 파일을 커밋하고, 업데이트마다 `version`을 올립니다. 태그로 배포하면 관리자가 특정 태그를 고정해 설치할 수 있습니다.

### 화면 스타일과 공용 UI

플러그인 화면은 앱 페이지 툴바 아래, 앱 본문 여백 안쪽에 본문 너비로 놓인 iframe입니다. 공용 `conai-plugin.css`는 테마 변수와 기본 요소뿐 아니라 메인 앱 공용 컴포넌트와 같은 모양의 클래스를 제공합니다. 화면마다 레이아웃·여백·위젯을 새로 만들면 글자가 배경 가장자리에 붙고 플러그인마다 모양이 달라지므로 아래 순서를 지킵니다.

- **링크 순서**: `<link rel="stylesheet" href="conai-plugin.css">`를 먼저, 플러그인 `style.css`를 그다음에 둡니다. 빌드 스크립트가 넣는 SDK 사본을 수정하지 않습니다. 설치된 플러그인은 다시 빌드해 올릴 때까지 패키지에 들어 있던 사본을 계속 사용합니다.
- **SDK 클래스 먼저**: 탭·세그먼트·필터 칩·검색창·아이콘 버튼·목록 행·미디어 카드·키-값 목록·빈 상태·서랍·대화상자는 SDK 클래스를 사용합니다. 플러그인 CSS에는 배치(그리드·너비·순서·반응형 이동)와 그 플러그인에만 있는 요소(플레이어, 타임라인 등)만 씁니다. 클래스 목록은 [SDK CSS class reference](../../plugins/README.md#sdk-css-class-reference)에 있습니다.
- **토큰**: 색은 `--conai-*` 테마 변수, 간격과 크기는 `--conai-edge`(프레임 가장자리의 포커스 링 공간), `--conai-gutter`(본문 창과 열 구분선 사이, 32px·1200px 미만 24px), `--conai-sidebar-width`(232px), `--conai-sidebar-pad-x`·`--conai-sidebar-pad-top`, `--conai-toolbar-height`(56px), `--conai-control-height`·`--conai-field-height`·`--conai-row-height`, `--conai-text-inset`(배경이 생기는 요소의 최소 글자 여백)을 사용합니다. 너비가 다른 열은 `--conai-sidebar-width`만 바꿉니다.
- **여백 불변 조건**: hover·active·선택·채움·표면처럼 배경이 생길 수 있는 요소는 그 배경이 닿는 모든 쪽에 글자 여백을 둡니다. 평면 미디어 카드(`.conai-media-card`)는 어떤 상태에서도 배경을 갖지 않습니다. 선택은 미디어의 링으로 표시하고 캡션은 미디어 가장자리에 맞춰 일정한 간격 아래에 둡니다. 배경이 필요한 카드는 `.boxed`를 씁니다. 상태 클래스(`.active` 등)는 해당 컴포넌트 클래스 안에서만 모양이 생기며 SDK에는 임의의 `button.active` 모양이 없습니다.
- **두 번째 여백 금지**: 호스트가 이미 본문 여백을 둡니다. `body { padding: 16px }` 같은 임의의 루트 여백을 더하지 말고 문서형 화면은 `.conai-page`(작은 내장 패널은 `.conai-page.compact`), 전체 높이 도구는 `.conai-app`을 루트에 둡니다. 본문 창은 열 구분선과 만나는 쪽에만 `--conai-gutter`를 받습니다.
- **컴포넌트 여백을 다시 정하지 않음**: SDK 컴포넌트의 padding·높이·배경을 덮어쓰지 않습니다. 크기와 위치는 배치 규칙으로 정하고, 맞는 컴포넌트가 없으면 같은 불변 조건을 지키는 플러그인 전용 클래스를 만듭니다. 여러 플러그인에 필요한 모양이면 SDK에 추가하고 SDK 계약 문서를 함께 갱신합니다.

| 메인 앱 컴포넌트 | SDK 클래스 |
| --- | --- |
| `PageToolbar` | `.conai-header`(제목 `.conai-title`, 오른쪽 정렬 `.conai-spacer`) |
| `PageWithSidebar` | `.conai-app` > `.conai-split` > `.conai-sidebar`(오른쪽 열은 `.end`) + `.conai-pane` |
| `SidebarNav` / `SidebarItem` | `.conai-nav` > `.conai-nav-item`(현재 행 `.active` 또는 `aria-current`) |
| `RowGroup` 제목 / overline 라벨 | `.conai-group-head` / `.conai-overline` |
| `TextTabs` | `.conai-tabs` |
| `SegmentedControl` | `.conai-segmented` |
| `ToggleChip` | `.conai-chips` > `.conai-chip` |
| `SearchField` | `label.conai-search` > `input[type=search]` |
| `IconButton`(ghost / overlay) | `.conai-icon-button`(`.sm`, `.overlay`) |
| `Badge variant="overlay"` | `.conai-overlay-badge`(`.tl` `.tr` `.bl` `.br`, `.xs`), 사진 위 이름은 `.conai-overlay-caption` |
| 미디어 타일 / `Panel` 상호작용 카드 | `.conai-media-card` > `.conai-media` + `.conai-media-body`, 표면 카드는 `.boxed` |
| `ListRow` / `ResourceRow` | `.conai-list` > `.conai-list-row`(`.conai-row-main` > `.conai-row-title` + `.conai-row-meta`) |
| `EmptyState` | `.conai-empty` |
| `BottomDrawerSheet` / 떠 있는 서랍 | `.conai-drawer` + `.conai-backdrop` |
| `Modal` | `dialog` 기본 스타일 |

새 플러그인 화면을 마치기 전에 확인합니다.

1. 루트가 `.conai-page` 또는 `.conai-app`이고 임의의 루트 padding이 없다.
2. 앱에 있는 위젯을 직접 만들지 않고 SDK 클래스를 썼다.
3. hover·선택·채움 상태에서 글자가 배경 가장자리에 붙지 않는다. 사진 위 배지·캡션도 같다.
4. 평면 카드가 선택·hover 상태에서 배경을 갖지 않는다.
5. 데스크톱(1200px 이상)과 좁은 화면(900px 미만)에서, 열이 있는 화면은 중간 너비(900–1199px)에서도 열고 서랍·대화상자까지 확인했다.

## 3. 필요한 연결 선택하기

브라우저의 `api`와 서버 모듈의 `conai`는 서로 다른 실행 문맥입니다.

| 필요 | 우선 사용할 연결 |
| --- | --- |
| 현재 화면을 AI가 조회·선택·편집 | manifest의 페이지 작업 + `connectPlugin(handlers)` + `api.publish` |
| 기존 앱 도구 실행 | 브라우저 `api.app.tools/call/run`, 서버 `conai.tools.list/call` |
| 기존 HTTP 기능·업로드·스트리밍 | 브라우저 `api.app.fetch`, 다운로드는 `api.app.download` |
| 파일·연결 프로젝트 편집 | `files.*`, `workspace.*`, 기존 파일/프로젝트 도구와 리비전 검사 |
| 작은 설정·변경 이벤트·이동 | `api.storage`, `api.events`, `api.navigation` |
| 모델의 단일 답변 | `api.llm` 또는 `conai.llm`의 기본 `text` 모드 |
| 대화방 없이 프로필의 판단 모델·프리셋 사용 | `llm.decide`(직접 질문), `llm.judgeTurn`(프리셋의 before/after 항목) |
| AI가 도구를 골라 실제 작업 | 같은 LLM API의 `mode: 'profile'` |
| 플러그인 고유 서버 기능을 AI/MCP에 노출 | `conai.tools.register`; 등록 이름은 `p_<pluginId>_<name>` 형식이며 pluginId의 `-`를 `_`로 변환 |
| 오래 걸리는 처리 | `conai.onJob` + `conai.jobs.start/get/cancel` |
| 처리에 내부 원본 사용·결과 등록 | 서버 `conai.media.resolve/save`; 화면 재생은 `api.media.open`, `files.media`, `workspace.media` |
| 페이지가 만든 HTML을 렌더 없이 바로 재생 | `api.preview.open/update`; 소재 참조와 패키지 파일을 경로에 연결해 화면 안 iframe으로 표시 |

`serverActions`는 manifest에서 기존 앱 도구에 입력을 연결하는 계약입니다. `conai.tools.register`는 실행 중인 서버 모듈의 함수를 도구로 등록합니다. 등록 시점과 입력 계약이 다르므로 서로 대체 가능한 선언으로 가정하지 마세요.

화면은 `sandbox="allow-scripts"`인 격리 iframe입니다. 직접 인증 API 요청, 외부 CDN, 내부 iframe(`api.preview` 문서 제외), 브라우저 worker, localStorage/IndexedDB를 사용할 수 있다고 가정하면 안 됩니다. 의존성은 로컬 정적 자산으로 번들하고, 네이티브 호출은 호스트 브리지를 사용합니다. 상세 경계는 [Browser boundary](../../plugins/README.md#browser-boundary)를 참고하세요.

## 4. AI가 실제 기능을 사용할 수 있게 만들기

화면의 **조회 → 대상 선택 → 입력/편집 → 실행 → 결과 확인**을 같은 도메인 처리에 연결합니다. 페이지 제목이나 이동 링크만 제공한 상태를 AI 지원 완료로 기록하지 않습니다.

- 화면 상태에는 안정된 대상 ID, 현재 리비전, `dirty`, 필요한 발췌·작업 ID만 제공합니다. 원문 전체·바이너리·비밀값·인증 URL을 반복 전송하지 않습니다.
- 조회는 `view`, 초안 변경은 `draft`로 선언합니다. 플러그인이 `direct`를 선언할 수는 없습니다. 저장·실행은 기존 호스트/API 경로를 사용하고 페이지 어시스턴트가 요청한 변경과 명시적 `propose*` 검토를 유지합니다.
- UI와 도구가 같은 함수·검증을 호출하게 합니다. 서버 도구에는 실제 입력 검증과 기능 권한 확인이 필요합니다. `scope` 선언만으로 인자·소유권 검증이 끝나지 않습니다.
- 화면 없이 실행할 기능은 서버 도구와 상태 조회를 제공합니다. 브라우저 작업에는 현재 페이지 연결이 필요하다는 점을 명시합니다.
- `mode: 'profile'`은 기존 채팅 엔진·도구 카탈로그·프로필 권한·검토를 사용합니다. 별도 에이전트 루프를 만들지 말고 `profileRun`의 실제 도구 결과와 작업 상태로 성공을 판단합니다.
- 대화방 없는 판단은 `api.llm`/`conai.llm`의 `decide({profileId,state,questions,timeoutMs?})` 또는 `judgeTurn({profileId,stage,user,conversation,actions?,timeoutMs?})`를 직접 기다립니다. `model:'judge'`의 자유문 답변과 달리 네이티브 TypeSafe/LLM 판단 엔진·프로필 모델 우선순위와 프리셋 항목을 재사용합니다. `decide`는 프리셋 없이도 가능하며, 판단 모델이 없으면 `판단 모델이 없어`로 시작하는 409입니다. `judgeTurn`은 프리셋이나 모델이 없으면 모델 호출 없는 빈 결과이고, 도구 패턴·지시문·후속 여부만 반환하며 실제 행동·후속 예약은 하지 않습니다. 부분 실패는 안전한 `error`와 가능한 답변을 반환합니다.
- 새 판단 연결은 호스트 기능 `llm.decide`와 갱신한 SDK가 필요합니다. 상태 JSON 최대 16 KiB, 질문 1–8개, 대화 1–40개, 행동 이름 최대 40개이며 상세 엄격 입력·출력은 [SDK 판단 계약](../../plugins/README.md#stateless-profile-judging)을 따릅니다. 기존 채팅/계정/활성 프로필 권한을 검사하고 플러그인당 판단 두 메서드 합계 최대 4개(초과 429), 기본 60초·최대 120초 제한입니다. 변경·비활성화·권한 회수 시 요청을 중단하며 런타임 작업·멱등 ID·자동 재시도는 없습니다. 재시도는 모델 비용을 다시 발생시킬 수 있습니다. 추가 승인·저장 리비전은 없으며, 페이지 요청 취소를 판단 작업 취소로 간주하지 말고 입력 `timeoutMs`를 지정합니다.
- `llm.profiles()`의 `judge`는 프리셋 ID·이름, 모델 사용 가능 여부, 후속/필드/방 설정을 제한된 길이로 제공합니다(빈 방 지시문은 네이티브 기본값). `statusBlocks`는 활성 블록의 키·이름·필드 제약만 제공하고 템플릿/CSS/블록 지시문은 숨깁니다. `structuredOutput` 텍스트 답변은 JSON과 충돌하는 표시 블록 안내만 빼고 캐릭터·로어·번역은 유지합니다. 일반 채팅 동작은 바꾸지 않습니다.
- 엄격한 자료 조사는 `research: {slotId, activityId, allowedPostIds, purpose?}`를 추가합니다. API·Claude Code·Codex·Pi의 기존 제한된 실행 경로를 사용하며 엔진을 대체하지 않습니다. 조사 횟수도 아래의 전역 도구 한도를 따릅니다. 예전 `maxModelCalls`·`maxTurns`·`maxToolCalls`는 받기만 하고 무시합니다. 슬롯·활동·요청마다 새 문맥에서 공개된 지정 게시글 검색/본문 읽기만 제공합니다. 이전 대화·로어·연결 파일·의미 기억·판단/번역·훅은 가져오지 않습니다. 원문 읽기만 `profileRun.research.evidence`로 반환하며 모델의 자기보고는 근거가 아닙니다. 상세 입력/출력·한도는 [SDK 조사 계약](../../plugins/README.md#isolated-read-only-post-research)을 따릅니다.
- 공유된 발췌의 요약은 `mode:'profile', research:{…,purpose:'summary'}`를 사용합니다. 모든 엔진에서 도구가 없고 API 1회/Claude·Pi 1턴으로 제한합니다. API는 매 요청 직전 자료를 확인하고 마지막 호출은 텍스트 전용입니다. 네이티브는 시작·도구 호출·결과 반환과 실행 중 1초마다 자료를 확인하지만 내부 제공자 요청 직전의 원자적 검사는 보장할 수 없습니다. Claude 턴 소진은 부분 결과일 수 있고 Codex는 내부 호출/턴/출력 토큰 상한을 제공하지 않습니다. 원본 변경은 금지하지만 기존 감사 영수증은 남습니다.
- 상태 화면의 과거 인용/결과는 반환 전에 `conai.tools.call('posts_search',{post_ids:ids,status:'published',limit:50})`로 현재 자료 접근을 재검사합니다. ID 1–100, 페이지 최대 50이며 검색 결과의 `revision`/`content_version`/`content_hash`로 변경 여부를 확인합니다. 숨김/삭제/권한 거부는 인용·파생 결과를 숨기고, 검사 실패를 오래된 캐시로 대체하지 않습니다. 연구 도구에서는 ID 목록이 호스트 범위와 교집합으로 제한됩니다. 기존 SQL·권한 경로와 배치 조회를 사용하며 별도 LLM API/SDK 버전은 추가하지 않습니다. 최신 호스트가 필요합니다.
- `maxTokens`를 생략하면 `profile`·`text` 모두 프로필의 최대 출력 토큰을 사용합니다(`text`의 `model:'judge'`는 판단 모델 행의 값). 명시적 한도는 정수 1–4096이며 프로필 상한을 낮추기만 합니다. 이전 요청의 한도는 다음 요청으로 이어지지 않습니다. 이 수정은 호스트 업데이트가 필요하고 SDK 변경은 없으며 이전 호스트는 생략 시 512로 제한합니다. `timeoutMs`도 생략하면 `profile` 실행은 플러그인 시간 제한 없이 프로필의 엔진·연결 제한 안에서 완료되거나 `llm.cancel`로 취소될 때까지 실행합니다(`text`·조사는 기존 120초 기본값). 한 번의 `api.llm.wait`는 최대 10분이므로 긴 실행은 다시 기다립니다. 계정·승인·취소·재시도 경계는 바뀌지 않습니다.
- 도구·임베딩·외부 렌더러가 없는 경우 필요한 설정과 다음 행동을 알립니다. 실제 설치되지 않은 기능을 기본 제공으로 설명하지 않습니다.

### AI 실행 한도와 문맥은 호스트 설정을 먼저 따른다

플러그인의 AI 호출은 앱 전역 설정과 프로필 설정을 기본으로 사용합니다. 플러그인이 자체 예산·문맥 규칙을 만들면 엔진마다 다르게 동작하고 사용자가 설정을 여러 곳에서 맞춰야 하므로 만들지 않습니다.

| 항목 | 기준 | 플러그인이 할 일 |
| --- | --- | --- |
| 도구 사용 횟수 | 전역 **도구 호출 반복 한도**(설정 › 채팅 › 자원 › 도구 사용, 기본 50·1–200). 한 답변의 모델↔도구 왕복 수이며 API·pi·Claude Code, `profile` 실행·조사, 웹 검색, pi codemode 스크립트 호출 수가 모두 따릅니다. 닿으면 도구를 거두고 지금까지 한 일로 답합니다. Codex는 자체 반복을 사용합니다. | 호출·턴·도구 예산을 계산하거나 보내지 않습니다. 한도에 닿은 결과를 자동 재시도로 늘리지 않습니다. |
| 출력 길이 | 프로필의 최대 출력 토큰 | `maxTokens`는 짧은 답이 목적일 때만 보내 낮춥니다. |
| 대화 문맥 | 프로필의 컨텍스트 턴/토큰, 요약, 로어, 연결 파일, 번역, 도구 결과 길이. `profile` 실행은 플러그인 전용 자동화 방에서 이 설정으로 문맥을 관리합니다. | 전체 대화·화면 스냅샷을 `history`로 매번 다시 보내지 않습니다. `history`에는 프로필이 모르는 추가 참고만 짧게 넣습니다. 여러 턴 작업은 `text` 모드에 문맥을 쌓지 말고 `profile` 실행을 사용합니다. |
| 시간 제한 | `profile` 실행은 엔진·연결 제한, `text`·조사는 기본 120초 | 정말 필요한 경우에만 `timeoutMs`를 보냅니다. |

플러그인 설정 화면에 같은 의미의 한도·토큰·문맥 턴 입력을 따로 두지 않습니다. 동작을 바꿀 필요가 있으면 사용할 프로필을 고르게 하고, 프로필 편집기나 전역 설정으로 안내합니다. 엄격한 격리가 필요한 조사(`research`)만 이전 대화·로어·기억을 가져오지 않는 예외입니다.

설치·활성화한 플러그인은 앱 기능입니다. `capabilities`·`appTools`는 별도 권한 부여 목록이 아니며, 서버 모듈이 없어도 기존 권한으로 앱 API와 LLM을 사용할 수 있습니다. 개인 채팅·세션·작업의 계정 경계와 인스턴스 공용 파일함의 정책은 [보안과 권한](./SECURITY_AND_PERMISSIONS.md)을 따릅니다.

## 5. 내부 이미지·영상·오디오 사용하기

검색과 원본 해석, 화면 미리보기를 구분합니다.

1. 기존 `search_images`로 프롬프트·그룹·`media_type`을 지정해 필요한 범위만 검색합니다. 태그는 `search_images_by_tags`, 장면 설명은 임베딩이 준비된 경우 `search_images_by_meaning`을 사용합니다. 파일함은 `search_files`, 오디오는 기존 오디오 조회 도구를 사용합니다.
2. 검색된 실제 ID로 후보를 확인합니다. 필요하면 `get_image_metadata`, `view_images`, `view_media_frames`를 사용하며 프로필·모델·도구 지원 범위를 확인합니다. 검색 결과의 짧은 설명만으로 시각 내용을 확인했다고 보고하지 않습니다.
3. 프로젝트에는 `{source:'library', compositeHash}`, `{source:'files', fileId}`, `{source:'audio', candidateId}` 같은 안정된 참조를 저장합니다. 만료되는 재생 URL과 원본 절대 경로를 영구 참조로 사용하지 않습니다.
4. 신뢰된 서버 모듈은 `conai.media.resolve(reference)`로 현재 권한에 맞는 원본과 `fingerprint`를 얻습니다. 반환된 경로는 서버 내부에만 두고 원본 복사·사용 전후 및 결과 등록 전에 변경 여부를 검사합니다. 이 함수 자체가 원본 복사나 원본 버전 고정을 수행하지는 않습니다.
5. 처리 결과는 플러그인 데이터 폴더에 만든 뒤 `conai.media.save({path, groupPath?})`로 기존 라이브러리에 등록합니다. 원본을 보존하고 결과와 사용한 원본 참조·리비전을 연결합니다.

서버의 `conai.media`와 브라우저의 `api.media.open`을 혼동하지 마세요. `resolve`는 현재 계정의 해당 소재 조회 권한을 검사하며, `save`는 `images.view`, `images.upload`, `images.edit`를 요구합니다. `save`의 `path`는 해당 패키지 데이터 폴더 내부 상대 경로이고 링크·경로 탈출·크기 제한 검사를 거칩니다. 세부 형식과 한도는 [Server processing jobs and internal media](../../plugins/README.md#server-processing-jobs-and-internal-media)에 있습니다.

## 6. 긴 작업과 외부 실행 환경

`conai.onJob(async (data, { signal, jobId, account, report }) => result)`에 처리를 등록하고 `conai.jobs.start({requestId, data})`로 시작합니다. 즉시 반환된 ID로 `get/cancel`을 사용하고 `report({percent, phase?, message?})`로 진행률을 전달합니다. 현재 `conai.jobs`는 `generation.execute` 권한이 필요합니다.

동일 입력을 복구 조회할 때 같은 요청 ID를 유지하고, 의도적인 새 실행에만 새 ID를 사용합니다. 실패·취소·만료를 자동 재실행으로 바꾸지 않습니다. 저장 충돌은 최신 리비전을 다시 읽어 해결하고, 응답을 기다리는 요청 취소와 이미 접수된 영구 작업 취소를 구분합니다. 취소는 이미 완료한 저장·외부 비용을 되돌리지 않습니다.

Node 서버 모듈은 파일·네트워크·프로세스 접근이 가능한 신뢰된 앱 코드이며 보안 샌드박스가 아닙니다. 모델이 만든 코드나 외부 프로젝트를 실행하는 렌더러는 별도 격리 환경에 필요한 자료만 전달합니다. 설치 파일·대용량 의존성을 ZIP에 억지로 넣지 말고 별도 런타임 설치 방법, 지원 OS, 호스트/Docker 간 경로 매핑, 준비 상태 확인을 패키지 문서에 적습니다. 자식 프로세스에도 동시 실행·메모리·시간 상한과 중단·임시 파일 정리를 구현합니다.

### Docker로 격리 실행하기

렌더러 같은 격리 환경은 Docker 컨테이너로 실행할 수 있습니다. CoNAI 본체는 Docker를 쓰지 않으므로 이 연결은 플러그인이 직접 만듭니다.

- **연결 경로**: docker CLI에 의존하지 말고 Docker Engine API를 소켓으로 호출합니다. Linux와 컨테이너 안은 `/var/run/docker.sock`, Windows는 `\\.\pipe\docker_engine`(Docker Desktop은 `\\.\pipe\dockerDesktopLinuxEngine`도 가능)를 쓰고 `DOCKER_HOST`의 `unix://`·`npipe://`를 우선합니다. 컨테이너 안의 CoNAI 이미지에는 docker CLI가 없습니다.
- **CoNAI가 컨테이너 안일 때**: 배포 설정에서 `/var/run/docker.sock:/var/run/docker.sock`을 연결해야 합니다(Coolify는 Persistent Storage에 호스트 경로로 추가). 이 소켓은 **서버 모듈이 있는 모든 활성 플러그인과 앱 본체가 함께 쓰는 호스트 Docker 관리자 권한**입니다. 플러그인별로 나눌 수 없습니다. 플러그인 README에 이 요구와 위험을 적고, 소켓이 없으면 "연결 안 됨" 상태와 필요한 설정을 화면에 보여 줍니다(`/.dockerenv`로 컨테이너 실행을 구분).
- **경로 매핑**: Docker 데몬은 마운트 원본을 호스트 기준으로 해석합니다. 컨테이너 안에서는 자기 컨테이너(`GET /containers/<hostname>/json`)의 `Mounts`에서 데이터 폴더를 담은 마운트를 찾아, named volume이면 `VolumeOptions.Subpath`(Engine API 1.45 이상), 바인드면 그 `Source` 아래 경로로 바꿔 전달합니다. 컨테이너 밖에서는 로컬 경로를 그대로 바인드합니다.
- **파일 권한**: 컨테이너 안의 CoNAI는 root로 실행되어 데이터 폴더가 root 소유로 만들어집니다. 비root로 도는 작업 컨테이너가 써야 하는 출력 폴더는 쓰기 권한을 열어 줍니다.
- **실행 경계**: 이미지·명령·마운트는 플러그인 코드에 고정하고 모델·프로젝트·페이지 입력에서 받지 않습니다. 작업 컨테이너에는 그 작업의 입력 복사본과 빈 출력 폴더만 연결하고 `NetworkMode: none`, 읽기 전용 루트, `CapDrop: ALL`, `no-new-privileges`, 메모리·CPU·PID·시간 상한을 둡니다. 끝나거나 취소되면 컨테이너와 작업 폴더를 지웁니다.
- **이미지 설치**: 이미지를 빌드하거나 받는 동작은 호스트를 바꾸므로 관리자 계정만 시작·취소할 수 있게 하고(`configure` 범위 도구 + 계정 확인), 진행 단계와 실패 이유를 화면에 보여 줍니다. 빌드 파일을 바꾸면 이미지 태그도 바꿉니다.

## 7. 메인 공용 연결을 확장할 때의 기록 규칙

**플러그인 작업 때문에 메인 코드를 확장하거나 기존 공용 계약을 바꾸면, 같은 작업에서 이 문서의 공용 연결 목록과 해당 설명을 반드시 갱신합니다.** 개인 플러그인이 계기여도 공용 변경 기록은 Git 문서에 남깁니다. 개인 패키지의 README나 최종 작업 보고만으로 대체하지 않습니다.

대상은 신규 HTTP 라우트뿐 아니라 SDK 메서드, MessageChannel 브리지, 공유 타입·검증, MCP 도구, 서버 서비스, 저장·미디어 접근, 작업 실행·취소·종료 경로를 포함합니다. 구현 없이 문서만 바꿔 권한·승인 정책을 확장하지 않습니다.

공용 연결을 추가·수정할 때 다음 내용을 해당 항목에 반영합니다. 별도의 작업별 보고서를 늘리지 말고 기존 설명을 최신 상태로 고칩니다.

| 기록할 내용 | 포함할 정보 |
| --- | --- |
| 필요와 책임 | 기존 연결로 부족했던 점, 메인이 담당하는 공용 기능과 패키지에 남는 기능 |
| 호출 계약 | 브라우저/서버 메서드 또는 도구 이름, 핵심 입력·결과, SDK 상세 항목 링크 |
| 구현 위치 | 변경한 공유 타입·브리지·라우트·서비스·호출부 링크 |
| 실행 경계 | 계정·기능 권한, 승인, 경로, 리비전, 중복 방지, 실패·취소·재시작 의미 |
| 호환성과 배포 | 호스트/SDK 업데이트 필요 여부, 지원 확인 방법, 이전 버전에서의 동작과 미지원 범위 |
| 검증 | 관련 기존 테스트 또는 중요한 영구 회귀 테스트, 실제 확인한 경로와 미검증 범위 |

세부 API는 [SDK 계약](../../plugins/README.md), 코드 탐색 지점은 [DEVELOPMENT.md](../../DEVELOPMENT.md), 사용자가 겪는 변경은 [PLUGINS.md](./PLUGINS.md)도 함께 갱신합니다. 비밀값·개인 파일 경로·개인 플러그인 소스는 공용 기록에 넣지 않습니다.

### 현재 공용 연결 목록

기존 플러그인 호환을 위해 `/api/prompt-groups/:id/prompts`는 100을 넘는 양의 정수 `limit`을 거부하지 않고 100으로 제한합니다. 응답의 `pagination.limit`과 페이지 오프셋에는 실제 적용한 크기를 사용하며, 알 수 없는 `type`은 이전처럼 긍정 프롬프트 테이블을 조회합니다.

프롬프트 그룹 조회는 기존 네이티브 HTTP 브리지를 통해 `/api/prompt-groups/summaries`의 집계 요약과 `/:id/prompts`의 제한된 페이지(최대 100개)를 사용합니다. UI·MCP 모두 `backend/src/services/promptGroupService.ts`를 공유하며, 라우트는 `backend/src/routes/promptGroups.ts`에 있습니다. 정확한 개수는 기본 포함하고 `include_total=false`로 생략할 수 있습니다. 기존 `/grouped-prompts`는 플러그인 호환을 위해 한 릴리스만 레거시로 유지합니다. 기존 `prompts.view` 권한·취소/재시도 경계는 그대로이고 조회에 승인/리비전은 필요하지 않습니다. 새 호스트가 필요하지만 SDK 버전은 바뀌지 않습니다. 상세 계약은 [SDK 계약](../../plugins/README.md)을 참고하세요. MCP 연결 회귀는 `backend/test/chat-tool-catalog.test.ts`, 인덱스 마이그레이션은 `backend/test/migration-baseline.test.ts`로 확인합니다.

현재 목록은 기능별 계약의 색인입니다. 새로운 연결은 행을 추가하고, 기존 연결을 바꿨다면 해당 행과 설명을 수정합니다. 일회성 작업 이력이나 출시 완료 목록으로 사용하지 않습니다.

읽기 전용 조사는 새로운 호스트가 필요하며 SDK 호출 형식은 동일합니다. 이전 호스트가 `research`를 거부하면 제한 필드를 지우고 재시도하지 않습니다. 기존 계정·프로필·게시판 권한, 작업 ID·멱등/입력 충돌·취소/시간 제한·작업 만료를 유지합니다. 자동화 방은 기존 채팅에서 삭제할 수 있습니다. 결과 조회에도 현재 `posts.view`가 필요하고, 저장된 증거는 당시 버전의 읽기 기록이지 현재 원문의 유효성 보장이 아닙니다. `model_limit`/`turn_limit`는 부분 결과이며 검증 완료가 아닙니다. 댓글 원문·첨부 자료·외부 웹·변경/자동 게시와 통화 금액 상한은 지원하지 않습니다. 게시/초안 저장은 조사 밖에서 기존 명시적 검토/저장 경로를 사용합니다. 공개 호스트 테스트는 모의 모델로 범위·실제 증거·격리·호출 예산·권한 회수·취소를 검증하며 개인 플러그인 소스를 요구하지 않습니다.

| 공용 연결과 책임 | 호출 계약 | 메인 구현·검증 |
| --- | --- | --- |
| 대화방 없는 프로필 판단·제한된 설정 조회 | 플러그인 상태에서도 각 프로필의 판단 설정을 따르도록 `llm.decide`/`llm.judgeTurn` 추가. 직접 질문은 프리셋 불필요, 턴 판단은 before 행동 패턴 필터·after 후속 여부와 기존 판단 로그(threadId null) 사용. `profiles`에 `judge`·`statusBlocks` 추가. 기존 채팅 권한·활성 프로필 검사, 합계 동시 4개·시간 제한·변경/비활성화 중단, 자동 재시도/행동 실행 없음. 새 호스트·SDK 및 `llm.decide` 기능 필요 | [브리지](../../backend/src/services/plugins/pluginLlm.ts), [페이지 SDK 중계](../../frontend/src/features/plugins/plugin-page.tsx), [판단 재사용](../../backend/src/services/plugins/pluginJudge.ts), [공유 타입](../../shared/src/types/plugin.ts), [SDK 계약](../../plugins/README.md#stateless-profile-judging), [권한·모델 우선순위·필터·실패/취소 회귀](../../backend/test/plugin-server.test.ts). 기존 `chat-judge`·`workflow-llm-nodes` 회귀와 백엔드 타입 검사도 사용 |
| 페이지 메뉴 아이콘 | 플러그인 페이지가 모두 같은 퍼즐 아이콘이라 상단 메뉴에서 구분되지 않아 추가. manifest `pages[].icon`에 호스트 아이콘 이름 하나(`PLUGIN_PAGE_ICONS`)를 적으면 상단 메뉴·설정의 상단 메뉴 편집·이용 가능 페이지·`/extensions` 도구 목록이 그 아이콘을 쓰고, 없으면 퍼즐 아이콘. 패키지 이미지는 받지 않으며 목록은 추가만 함. 권한·승인 변화 없음. SDK 동일, 호스트 업데이트 필요(이전 호스트는 이 필드가 있는 manifest를 거부) | [공유 타입·아이콘 목록](../../shared/src/types/plugin.ts), [manifest 검증](../../backend/src/services/plugins/pluginRegistry.ts), [아이콘 매핑](../../frontend/src/features/plugins/plugin-page-icon.ts), [검증 회귀](../../backend/test/plugins.test.ts) |
| 조사 자료의 현재 접근·버전 배치 조회 | 기존 `posts_search({post_ids,status:'published',limit,offset})`: ID 1–100, 페이지 최대 50. 현재 공개된 결과만 `revision`·`content_version`·`content_hash`와 반환. 연구 범위는 교집합, 오류/누락 시 플러그인 캐시 인용·파생 결과 비공개 처리. SDK 동일, 호스트 업데이트 필요 | [게시글 도구](../../backend/src/mcp/tools/postTools.ts), [게시글 SQL / publishedSources](../../backend/src/services/posts/postStore.ts), [실제 권한·버전 회귀](../../backend/test/mcp-posts-files-tools.test.ts) |
| 범위가 제한된 읽기 전용 프로필 조사 | `llm.start({mode:'profile', research:{slotId,activityId,allowedPostIds,purpose?}})`. API·Claude·Codex·Pi 지원. 횟수는 전역 도구 호출 반복 한도 N을 따름: API 요청 N+1, Claude/Pi 턴 N+1, 도구 호출 개수 상한 없음(`maxToolCalls: null`). 플러그인마다 한도를 조정하던 문제 때문에 바꿨고, 예전 `maxModelCalls`·`maxTurns`·`maxToolCalls`는 정수면 받되 무시. 게시글 ID 1–100. 시간 제한 최대 600초. 출력은 프로필 상한(`maxTokens`는 낮추기만). 요약은 도구 없음·1회. 실제 증거·호출/턴 수·종료 이유(`completed`/`model_limit`/`turn_limit`)와 `limits` 반환; 네이티브 모델 호출 수와 Codex 턴 수는 `null`이며 0으로 합산하지 않음. SDK 동일, 호스트 업데이트 필요 | [공유 타입](../../shared/src/types/plugin.ts), [전역 한도](../../backend/src/services/codex-chat/chatSettings.ts), [호스트 실행](../../backend/src/services/plugins/pluginProfileRun.ts), [제한 상태](../../backend/src/services/codex-chat/chatResearch.ts), [기존 LLM 실행기](../../backend/src/services/codex-chat/llmChatService.ts), [Codex 실행·격리](../../backend/src/services/codex-chat/codexChatService.ts), [MCP 권한](../../backend/src/mcp/toolAccess.ts), [게시글 도구](../../backend/src/mcp/tools/postTools.ts), [공통·네이티브 회귀](../../backend/test/plugin-server.test.ts), [실제 Pi 런타임 회귀](../../backend/test/chat-pi-sessions.test.ts) | [공유 타입](../../shared/src/types/plugin.ts), [호스트 실행](../../backend/src/services/plugins/pluginProfileRun.ts), [제한 상태](../../backend/src/services/codex-chat/chatResearch.ts), [기존 LLM 실행기](../../backend/src/services/codex-chat/llmChatService.ts), [Codex 실행·격리](../../backend/src/services/codex-chat/codexChatService.ts), [MCP 권한](../../backend/src/mcp/toolAccess.ts), [게시글 도구](../../backend/src/mcp/tools/postTools.ts), [공통·네이티브 회귀](../../backend/test/plugin-server.test.ts), [실제 Pi 런타임 회귀](../../backend/test/chat-pi-sessions.test.ts) |
| 앱 내부 제작·관리·배포 | 관리자 초안 파일 CRUD·업로드, 리비전/패키지 해시 검토·적용·ZIP 내보내기. `plugin_author.*` 페이지 작업과 관리자 채팅 제작 도구가 같은 서비스 사용 | [제작 서비스](../../backend/src/services/plugins/pluginAuthoring.ts), [HTTP](../../backend/src/routes/plugin-authoring.routes.ts), [MCP](../../backend/src/mcp/tools/pluginAuthoringTools.ts), [편집기](../../frontend/src/features/plugins/plugin-authoring.tsx), [제작 회귀](../../backend/test/plugin-authoring.test.ts) |
| Git 저장소 설치·업데이트 | ZIP 업로드만으로는 공개 저장소 배포·업데이트 확인이 불편해 추가. 관리자 HTTP `POST /api/plugins/sources/review`(`PluginSourceInput` → `PluginSourceReview`, 설치 없음), `POST /sources/install`(`{reviewId,digest}` → `PluginInstallResult`, 201/200), `POST /sources/check`(`{pluginId?}` → `PluginSourceCheck[]`, 커밋만 확인), `DELETE /:pluginId/source`(연결만 해제). 관리자 응답에만 `InstalledPlugin.source`. MCP `check_plugin_updates`(관리자 1:1 `configure`, 확인만, `needs_human_review`/`up_to_date`). 플러그인 관리 페이지 작업은 초안 목록 등록(`resourceId: 'plugin-authoring'`, 한 페이지에 활성 등록 하나)에 합쳐 `plugin_source.check`(조회), `plugin_source.review`(`{pluginId}` 또는 스킴 없는 `{repository:'github.com/owner/repo', provider?, ref?, folder?}`, 설치 없음. MCP 인수 검사가 `path` 키를 거부하므로 `folder`), 검토가 열린 동안만 `plugin_source.install`(검토 카드)을 제공. 페이지 데이터는 URL을 담지 않는 공용 규칙에 따라 연결 저장소도 `repository`(스킴 제외)로 보냄. GitHub·GitLab·Gitea/Forgejo HTTPS API로 해석한 커밋의 압축 파일만 받음(git 실행 파일·토큰 없음, 공개 주소 전용·리디렉션 재검사·32MiB). 검토는 메모리 10분·최대 8개, 적용은 검토 digest·설치 digest·활성 상태를 다시 검사하고 이미 적용된 재시도는 연결만 보장. ZIP·편집기 설치는 연결을 유지하고 `modified`로 표시, 제거하면 연결 삭제. 비공개·사설망 호스트, SSH, LFS, 자동 업데이트·주기 확인 미지원. 호스트 업데이트 필요, SDK·manifest 변경 없음. 상세: [Git repository installs](../../plugins/README.md#git-repository-installs) | [공유 타입](../../shared/src/types/plugin.ts), [Git 서비스](../../backend/src/services/plugins/pluginSources.ts), [라우트](../../backend/src/routes/plugins.routes.ts), [설치기·제거·연결 표](../../backend/src/services/plugins/pluginRegistry.ts), [패키징·변경 비교 재사용](../../backend/src/services/plugins/pluginAuthoring.ts), [MCP](../../backend/src/mcp/tools/pluginAuthoringTools.ts), [관리 화면·페이지 작업](../../frontend/src/features/plugins/plugin-management.tsx), [Git 설치 창](../../frontend/src/features/plugins/plugin-source-install.tsx), [작업 ID·등급](../../shared/src/utils/chatPageAction.ts), [회귀: 가짜 호스트로 폴더 패키징·SDK·제외 목록·경로/링크 거절, 검토 바이트 적용·digest 409·재시도, ZIP 설치 후 연결 유지, 제거, 확인 결과/오류 저장](../../backend/test/plugin-sources.test.ts). 실제 호스트 API 호출은 자동 테스트하지 않음 |
| 격리 화면·페이지 어시스턴트 | `connectPlugin`, `api.publish`, manifest 페이지 작업. 화면 리비전·검토 경계를 호스트에서 관리 | [공유 타입](../../shared/src/types/plugin.ts), [페이지 호스트](../../frontend/src/features/plugins/plugin-page.tsx), [서버 호스트](../../backend/src/services/plugins/pluginHost.ts), [경계 테스트](../../backend/test/plugins.test.ts) |
| 기존 앱 도구·HTTP·스트림 | `api.app.*`, `conai.tools.*`, `serverActions`. 기존 도메인 서비스와 계정 권한을 재사용 | [HTTP 경로 정책](../../shared/src/utils/pluginNativeApi.ts), [네이티브 연결](../../frontend/src/features/plugins/plugin-native-api.ts), [앱 도구 브리지](../../backend/src/services/plugins/pluginAppBridge.ts), [앱 작업](../../backend/src/services/plugins/pluginAppActions.ts), [SDK 테스트](../../frontend/test/plugin-sdk.test.ts) |
| 음향 디렉터리의 bounded 조회·기존 플러그인 호환 | 기존 `api.app.fetch`로 프로젝트·프로젝트별/전체 효과음 목록 조회. `limit`/`cursor`/`offset` 중 하나를 주면 `{items, limit, offset, has_more, next_cursor}`(기본/최대 200), 모두 생략하면 기존 전체 배열. SDK 상세: [Audio directory pagination](../../plugins/README.md#audio-directory-pagination) | [HTTP 분기](../../backend/src/routes/audio.routes.ts), [공용 음향 서비스](../../backend/src/services/audio/audioService.ts), [프론트의 명시적 paging](../../frontend/src/lib/api-audio.ts), [200개 초과 배열·커서·오프셋·권한 회귀](../../backend/test/audio-store.test.ts) |
| 연결 프로젝트·저장 | `workspace.*`. 실제 공용 프로젝트의 리비전·쓰기 잠금·검토를 재사용 | [프로젝트 연결](../../backend/src/services/plugins/pluginWorkspace.ts), [WorkspaceService](../../backend/src/services/workspaceService.ts), [경계 테스트](../../backend/test/plugins.test.ts) |
| AI 프로필 실행 | `api.llm` / `conai.llm`, `text`와 `profile`. 생략한 출력 한도는 text 512 / profile 네이티브 예산, 생략한 시간 제한은 text·조사 120초 / profile 없음, 명시적 한도는 기존 검증·프로필 상한 유지. 기존 모델 실행·사용량·도구·대화 경계를 재사용. 호스트 업데이트 필요, SDK 동일 | [공유 입력](../../shared/src/types/plugin.ts), [LLM 연결](../../backend/src/services/plugins/pluginLlm.ts), [프로필 실행](../../backend/src/services/plugins/pluginProfileRun.ts), [서버 테스트: 예산·명시 한도·검증·취소·권한](../../backend/test/plugin-server.test.ts) |
| 서버의 긴 처리 작업 | `conai.onJob`, `conai.jobs.start/get/cancel`. 별도 큐 없이 `plugin-task` 런타임 작업 사용 | [작업 서비스](../../backend/src/services/plugins/pluginTasks.ts), [서버 실행·종료](../../backend/src/services/plugins/pluginServerRuntime.ts), [작업 타입](../../shared/src/types/runtimeJob.ts), [서버 테스트](../../backend/test/plugin-server.test.ts) |
| 내부 원본 처리·결과 등록 | `conai.media.resolve/save`. 프로젝트의 원본 해석과 네이티브 미디어 등록을 재사용. 화면에는 `api.media.open` 등으로 재생 링크만 전달 | [서버 미디어 연결](../../backend/src/services/plugins/pluginServerMedia.ts), [공유 원본 해석](../../backend/src/services/plugins/pluginWorkspace.ts), [화면 결과 미디어](../../backend/src/services/plugins/pluginArtifactMedia.ts), [서버 테스트](../../backend/test/plugin-server.test.ts) |
| 화면 안 실시간 HTML 미리보기 | `api.preview.open({html, files})` → `{url, expiresAt}`, `api.preview.update(url, …)`는 같은 주소의 내용 교체. 렌더러 없이 편집 결과를 바로 재생하기 위한 연결. 문서는 `sandbox allow-scripts`·인라인 스크립트 허용·자기 경로만 읽기(앱 API·외부 URL 불가). 소재는 요청마다 현재 계정 권한과 원본 fingerprint를 다시 검사하고, 창이 닫히면 함께 만료(마지막 사용 후 10분). 256KB HTML·파일 64개·창당 최신 4개. 호스트 업데이트 필요: `api.supports('preview')`로 확인하고 없으면 기존 동작 유지 | [미리보기 서비스](../../backend/src/services/plugins/pluginPreview.ts), [전달 경로·CSP](../../backend/src/routes/plugin-assets.routes.ts), [발급 라우트](../../backend/src/routes/plugins.routes.ts), [페이지 호스트](../../frontend/src/features/plugins/plugin-page.tsx), [SDK](../../plugins/sdk/conai-plugin.js), [경계 테스트](../../backend/test/plugins.test.ts) |
| 설정·변경 이벤트·이동 | `api.storage/events/navigation`. 설정 CAS, 기존 SSE와 호스트 이동 경로 사용 | [설정 저장](../../backend/src/services/plugins/pluginStorage.ts), [SDK](../../plugins/sdk/conai-plugin.js), [페이지 호스트](../../frontend/src/features/plugins/plugin-page.tsx), [SDK 테스트](../../frontend/test/plugin-sdk.test.ts) |

긴 처리와 내부 미디어 연결은 영상 렌더링처럼 브라우저 요청 하나로 끝내기 어려운 기능을 위해 추가한 공용 경로입니다. 엔진 선택·명령 인자·제작 화면은 플러그인이 담당하고, 메인은 요청 계정과 작업 상태·중복 실행·원본 접근·라이브러리 등록을 담당합니다. 이를 사용하는 패키지는 해당 메서드를 포함한 호스트가 필요하며 `apiVersion: 1`만으로 지원 여부를 판단하지 않습니다. 브라우저 기능은 `api.host.features`/`api.supports`를 확인하고, 서버 전용 연결은 메서드 존재와 실행 준비 상태를 확인해 업데이트 필요를 안내합니다.

현재 공용 회귀 테스트는 계정 경계, 동일 작업 재요청, 실행 겹침, 취소, 파일 원본 접근과 권한 회수, 결과 경로 탈출 거부를 포함합니다. 외부 렌더러의 실제 출력과 개별 패키지의 UI·모델 호출은 패키지별로 별도 검증합니다. 공개 테스트의 통과만으로 개인 플러그인의 전체 실행을 검증했다고 보고하지 않습니다.

음향 디렉터리의 페이지 조회는 대량 목록을 제한하면서 이미 공개된 HTTP 배열 계약을 유지하기 위한 공용 확장입니다. `/api/audio/projects`, `/api/audio/projects/:projectId/groups`, `/api/audio/groups`가 같은 서비스·`audio.view` 권한을 사용합니다. 조회라서 승인·편집 리비전·중복 쓰기·변경 이벤트의 의미는 추가하지 않습니다. `cursor`는 오프셋 문자열이고 `offset`보다 우선하며, 검색·필터·정렬은 유지합니다. 순회 중 목록이 바뀌면 첫 페이지부터 다시 읽습니다. 전체 배열 경로는 이전 플러그인 호환용으로만 남으며 무제한 응답이므로 새 구현은 반드시 `limit`을 명시합니다. 새 SDK는 필요 없지만 페이지 계약을 구현한 호스트 업데이트는 필요합니다. 구버전 호스트는 쿼리를 무시하고 배열을 반환할 수 있어 `apiVersion: 1`이나 `app.fetch` 지원만으로 페이지 지원을 판단하지 않습니다. MCP 목록은 항상 페이지 형식이며, 실제 플러그인 UI와 구버전 호스트 실행은 별도 검증 대상입니다.

## 8. 검증과 전달

변경 범위에 해당하는 기존 검사만 실행합니다.

| 변경 | 확인 방법 |
| --- | --- |
| 패키지·권한·저장·서버 연결 | `npx tsx --test backend/test/plugins.test.ts backend/test/plugin-server.test.ts` |
| 브라우저 SDK 프로토콜 | frontend 디렉터리에서 `npx tsx --test test/plugin-sdk.test.ts` |
| 공유 타입·호스트 코드 | `npm run build:shared`, 영향받은 backend/frontend 타입 검사·린트·빌드 |
| 문서 | 링크와 실제 계약 대조, `npm run docs:build` |
| 개인 엔진·미디어 출력 | 개인 패키지의 중요한 회귀 검사와 실제 실행. 공개 테스트는 개인 파일에 의존하지 않음 |

실제 흐름에서 소재 조회·선택, 저장 충돌, 작업 ID와 완료 결과, 취소·원본 변경을 확인합니다. 필요한 외부 비용은 사용자가 허용한 범위에서만 사용합니다. 낮은 가치의 일회성 테스트·하네스를 만들지 않습니다.

전달할 때는 ZIP, 필요한 호스트·런타임 업데이트, 설치·활성화 방법, AI에 허용해야 할 도구, 검증 결과와 남은 제약을 짧게 안내합니다. 메인 공용 연결도 바꿨다면 이 문서에서 갱신한 항목을 함께 알려주세요.
