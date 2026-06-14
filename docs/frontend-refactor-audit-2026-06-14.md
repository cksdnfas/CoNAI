# 프론트엔드 리팩토링 조사

## 기준

- 조사일: 2026-06-14
- 기준 커밋: `ee39670b`
- 조사 방식: Graphify 현재 코드 그래프 갱신 후, 파일 크기, export 수, 연결 집중도, import cycle, 책임 범위를 함께 확인
- Graphify 결과: `10505 nodes / 29057 edges / 366 communities`

이 문서는 바로 수정 지시가 아니라, 다음 리팩토링 대상을 고르기 위한 점검 기록이다.

## 결론

프론트엔드는 `module-graph`와 `image-generation`에 책임이 가장 많이 몰려 있다. 특히 `module-graph-shared.tsx`는 공통 타입, 표시 로직, 포트 처리, 실행 상태, 아티팩트 처리, payload 변환까지 한 파일에 들어 있어 우선 정리 대상이다.

우선순위는 다음 순서가 좋다.

1. `module-graph-shared.tsx` 책임 분리와 import cycle 제거
2. `module-graph-node-card-layouts.tsx` 노드 레이아웃별 분리
3. `image-generation-shared.tsx` draft, storage, history, NAI/Comfy helper 분리
4. `api-module-graph.ts` 타입과 API client 분리
5. 큰 UI 패널 파일을 기능 단위로 나누기

## 최우선 후보

### `frontend/src/features/module-graph/module-graph-shared.tsx`

- 크기: 1212 lines
- export: 56
- Graphify degree: 480
- 역할:
  - Module Graph 타입
  - node/edge id 생성
  - clipboard serialize/parse
  - port handle 처리
  - module label/color 처리
  - workflow 실행 상태 표시
  - artifact preview 처리
  - graph payload/snapshot 변환
  - auto layout 처리

문제는 "shared"라는 이름 아래 거의 모든 공통 로직이 들어간 점이다. 작은 변경도 Module Graph 전체에 영향을 줄 가능성이 커졌다.

권장 분리:

- `module-graph-types.ts`
- `module-graph-ids.ts`
- `module-graph-clipboard.ts`
- `module-graph-ports.ts`
- `module-graph-labels.ts`
- `module-graph-artifacts.ts`
- `module-graph-payload.ts`
- `module-graph-layout.ts`

주의할 점:

- 현재 import cycle이 있다.
- cycle: `module-graph-shared -> module-graph-workflow-inputs -> module-graph-validation -> module-graph-shared`
- 먼저 타입과 순수 helper를 떼어낸 뒤 cycle을 끊는 편이 안전하다.

### `frontend/src/features/module-graph/components/module-graph-node-card-layouts.tsx`

- 크기: 1320 lines
- 함수 마커: 105
- 역할:
  - port cell
  - input/output port layout
  - inline workflow input editor
  - API request node layout
  - random text choice layout
  - text merge layout
  - text transform layout
  - if branch layout
  - artifact output layout

한 파일이 여러 노드 타입의 UI를 모두 책임진다. 각 노드 타입 변경이 같은 파일에 계속 쌓이는 구조라 충돌과 회귀 위험이 높다.

권장 분리:

- `node-card/port-cells.tsx`
- `node-card/inline-workflow-input-editor.tsx`
- `node-card/api-request-layout.tsx`
- `node-card/random-text-choice-layout.tsx`
- `node-card/text-merge-layout.tsx`
- `node-card/text-transform-layout.tsx`
- `node-card/if-branch-layout.tsx`
- `node-card/artifact-output-layout.tsx`

### `frontend/src/features/image-generation/image-generation-shared.tsx`

- 크기: 934 lines
- export: 67
- Graphify degree: 452
- 역할:
  - NAI form draft 타입과 기본값
  - NAI character/vibe/reference helpers
  - localStorage persistence
  - Comfy workflow draft 처리
  - selected image draft 처리
  - workflow prompt segment 처리
  - generation history status/recovery 처리
  - 공통 form helper

생성 화면의 여러 흐름이 한 파일에 묶여 있다. 특히 NAI, Comfy, history recovery, storage가 같은 파일에 있는 점이 부담이다.

권장 분리:

- `image-generation-drafts.ts`
- `nai-form-draft.ts`
- `comfy-workflow-draft.ts`
- `selected-image-draft.ts`
- `generation-history-status.ts`
- `generation-form-utils.ts`

### `frontend/src/lib/api-module-graph.ts`

- 크기: 810 lines
- export: 72
- Graphify degree: 423
- 역할:
  - Module Graph API 타입
  - workflow CRUD
  - folder CRUD
  - execution API
  - schedule API
  - artifact API
  - browse content API

타입과 API 호출이 모두 한 파일이다. Module Graph 기능이 커질수록 충돌이 계속 늘어날 수 있다.

권장 분리:

- `api-module-graph-types.ts`
- `api-module-definitions.ts`
- `api-graph-workflows.ts`
- `api-graph-executions.ts`
- `api-graph-schedules.ts`
- `api-graph-artifacts.ts`

## 다음 후보

### `frontend/src/features/image-generation/components/generation-history-panel.tsx`

- 크기: 824 lines
- 역할: history list, filter, status, recovery action, item rendering
- 권장: list container, filter bar, item card, recovery controls 분리

### `frontend/src/features/image-generation/components/wildcard-inline-picker-field.tsx`

- 크기: 903 lines
- 역할: wildcard picker, inline search, selection, preview
- 권장: search state, result list, selected item display, keyboard handling 분리

### `frontend/src/features/images/components/detail/image-detail-media.tsx`

- 크기: 821 lines
- 역할: media render, video/image handling, detail interaction
- 권장: image renderer, video renderer, toolbar/interaction helper 분리

### `frontend/src/features/module-graph/components/graph-execution-panel.tsx`

- 크기: 759 lines
- 역할: execution trigger, status, logs, artifact/result display
- 권장: execution controls, status list, log panel, artifact panel 분리

## 기능 단위 규모

Graphify와 LOC 기준으로 가장 큰 프론트 기능 영역은 다음과 같다.

- `frontend/src/features/image-generation`: 약 20492 lines, 77 files
- `frontend/src/features/module-graph`: 약 18669 lines, 58 files
- `frontend/src/features/settings`: 약 10215 lines, 57 files
- `frontend/src/features/wallpaper`: 약 8694 lines, 28 files
- `frontend/src/features/images`: 약 8442 lines, 49 files

`image-generation`과 `module-graph`는 둘 다 큰데, 현재 리팩토링 효과는 `module-graph`가 더 크다. 이유는 큰 파일뿐 아니라 import cycle까지 있기 때문이다.

## 낮은 우선순위

다음 파일들은 크지만 당장 리팩토링 우선순위는 낮다.

- `frontend/src/i18n/resources/image-generation.ts`
- `frontend/src/i18n/resources/module-graph.ts`
- `frontend/src/i18n/resources/settings.ts`

이 파일들은 번역 리소스 성격이 강하다. 편집 피로도가 커지면 namespace split을 검토하면 되지만, 책임 과다 코드와 같은 위험도는 아니다.

또한 `cn()`, `Button()`, `Badge()`, `Input()`은 Graphify에서 연결이 많게 나오지만 공통 primitive라 자연스러운 결과다. 크다는 이유만으로 분리할 대상은 아니다.

## 권장 진행 순서

1. `module-graph-shared.tsx`에서 타입과 순수 helper를 먼저 분리한다.
2. `module-graph-workflow-inputs`, `module-graph-validation`과의 cycle을 끊는다.
3. `module-graph-node-card-layouts.tsx`를 노드 타입별 레이아웃 파일로 나눈다.
4. `api-module-graph.ts`를 타입과 API 영역별로 나눈다.
5. 이후 `image-generation-shared.tsx`와 history panel을 정리한다.

각 단계는 작은 커밋으로 나누는 것이 좋다. Module Graph는 연결면이 넓어서 한 번에 대형 이동을 하면 회귀 추적이 어려워진다.
