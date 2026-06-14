# 백엔드 리팩토링 조사

## 기준

- 조사일: 2026-06-14
- 기준 커밋: `ee39670b`
- 조사 방식: Graphify 현재 코드 그래프 갱신 후, 파일 크기, 연결 집중도, import cycle, 서비스 책임 범위를 함께 확인
- Graphify 결과: `10505 nodes / 29057 edges / 366 communities`

이 문서는 바로 수정 지시가 아니라, 다음 리팩토링 대상을 고르기 위한 점검 기록이다.

## 결론

백엔드는 서비스 파일 일부가 너무 많은 일을 한다. 특히 Danbooru/Prompt Group/ComfyUI/Module Definition 쪽은 query, 변환, validation, route 또는 orchestration이 한 파일에 묶여 있다.

우선순위는 다음 순서가 좋다.

1. `fileWatcherService`와 `folderScan` 사이 import cycle 정리
2. `danbooruBrowserService.ts` 기능별 분리
3. `promptGroupService.ts` grouping/query 책임 분리
4. `comfyuiService.ts` client, runtime, output collector, parallel generation 분리
5. `routes/moduleDefinitions.ts`를 thin route로 줄이기

## 구조 위험

### `fileWatcherService`와 `folderScan` cycle

Graphify가 다음 cycle을 잡았다.

```text
backend/src/services/fileWatcherService.ts
-> backend/src/services/folderScanService.ts
-> backend/src/services/folderScan/index.ts
-> backend/src/services/fileWatcherService.ts
```

이 cycle은 실제 유지보수 위험이 크다. watcher와 scanner가 서로를 직접 참조하면 초기화 순서, 테스트 격리, 기능 분리가 모두 어려워진다.

진행 상태:

- 2026-06-14 1차 정리 완료.
- `folderScan`이 `FileWatcherService` 전체를 import하지 않도록 워처 런타임 상태를 `fileWatcher/watcherRuntimeStatus.ts`로 분리했다.
- 실제 active source에서 `folderScanService.ts` 호환 래퍼는 `fileWatcherService.ts` 한 곳에서만 사용 중이었고, 직접 `folderScan` facade를 import하도록 바꾼 뒤 래퍼 파일은 삭제했다.
- `autoScanScheduler.ts`와 `folderScan` 주변의 미사용 import, 빠른 등록 단계의 미사용 `sharp.metadata()` 호출도 같이 정리했다.
- 확인: `npm run build:backend`, `npm run verify:watched-folder-route-contracts`.
- Graphify 갱신 결과: `fileWatcherService -> folderScan -> fileWatcherService` 3-file cycle은 사라졌고, 총 `10501 nodes / 29072 edges / 351 communities`가 되었다.

권장 방향:

- `folderScanService.ts` re-export 경로를 줄인다. 2026-06-14 완료.
- watcher가 scanner 구현체를 직접 import하지 않게 한다.
- 공통 타입은 `folderScan/types.ts` 또는 별도 boundary 파일로 이동한다.
- watcher lifecycle helper와 scan orchestration 책임을 분리한다.

이 작업은 크기보다 구조 안정성 때문에 백엔드 1순위로 본다.

## 최우선 후보

### `backend/src/services/danbooruBrowserService.ts`

- 크기: 1179 lines
- 함수/클래스 마커: 63
- Graphify degree: 322
- 역할:
  - Danbooru DB 후보 탐색
  - taxonomy tree 구성
  - tag/artist/copyright/character 조회
  - related tag 처리
  - character image cache
  - prompt group lookup
  - URL builder와 display helper
  - pagination/list payload 처리

한 서비스가 데이터 접근, 변환, 캐시, 이미지 파일 탐색, prompt group 보조 기능까지 처리한다.

권장 분리:

- `danbooruDatabaseResolver.ts`
- `danbooruTaxonomyRepository.ts`
- `danbooruTagRepository.ts`
- `danbooruRelatedTags.ts`
- `danbooruCharacterImages.ts`
- `danbooruPromptGroupLookup.ts`
- `danbooruBrowserPayloads.ts`

진행 상태:

- 2026-06-14 2차 정리 일부 완료.
- Danbooru DB 탐색/우선순위 선택 로직을 `backend/src/services/danbooruBrowser/dbResolver.ts`로 분리했다.
- character image directory/cache/file lookup 로직을 `backend/src/services/danbooruBrowser/characterImages.ts`로 분리했다.
- `PromptGroupService`는 browser service 전체가 아니라 DB resolver만 직접 import하도록 바꿨다.
- 기존 검증 스크립트의 내부 문자열 검사 의존을 제거하고, 실제 character image fixture와 파일 경로 방어 동작을 검증하도록 바꿨다.
- 확인: `npm run build:backend`, `npm run verify:danbooru-browser-locale-contracts`.

우선 query/repository 계층을 먼저 분리하고, UI payload shaping은 마지막에 분리하는 편이 안전하다.

### `backend/src/services/promptGroupService.ts`

- 크기: 1133 lines
- 함수/클래스 마커: 25
- Graphify degree: 289
- 역할:
  - prompt collection type 처리
  - Danbooru grouping option normalize
  - taxonomy ancestry 수집
  - SQL expression 생성
  - group title/name 생성
  - grouping preview/result 구성

Prompt Group 자체 책임과 Danbooru taxonomy grouping 책임이 섞여 있다.

권장 분리:

- `promptGroupRepository.ts`
- `danbooruGroupingPlanner.ts`
- `danbooruGroupingSql.ts`
- `danbooruGroupNaming.ts`
- `promptGroupPreviewService.ts`

진행 상태:

- 2026-06-14 3차 정리 일부 완료.
- `previewDanbooruGrouping`과 `applyDanbooruGrouping`은 `promptCollection` route와 locale contract 검증에서 실제 사용 중이라 유지했다.
- `isDanbooruManagedGroupId`는 `promptCollectionMutationService`의 보호 로직에서 실제 사용 중이라 공개 wrapper로 유지했다.
- Danbooru grouping option/type/tree/title/summary helper를 `backend/src/services/promptGroups/danbooruGroupingHelpers.ts`로 분리했다.
- Danbooru managed root group 조회, managed group id 수집, assignment filter를 `backend/src/services/promptGroups/danbooruManagedGroups.ts`로 분리했다.
- 확인: `npm run build:backend`, `npm run verify:danbooru-browser-locale-contracts`.
- 2026-06-14 4차 정리 일부 완료.
- Danbooru grouping DB attach, taxonomy row 조회, prompt match SQL, preview count query를 `backend/src/services/promptGroups/danbooruGroupingQueries.ts`로 분리했다.
- `promptGroupService.ts`는 grouping query를 직접 조립하지 않고 preview/apply orchestration만 유지하도록 줄였다.
- 확인: `npm run build:backend`, `npm run verify:danbooru-browser-locale-contracts`, `npm run verify:danbooru-prompt-group-contracts`.

### `backend/src/services/comfyuiService.ts`

- 크기: 1056 lines
- 역할:
  - ComfyUI queue normalize
  - prompt id 수집
  - axios error 처리
  - generation request
  - cancel
  - output 수집
  - runtime status probe
  - parallel generation service

외부 서비스 client, 실행 orchestration, runtime status, output collector가 한 파일에 들어 있다.

권장 분리:

- `comfyuiClient.ts`
- `comfyuiQueue.ts`
- `comfyuiOutputCollector.ts`
- `comfyuiRuntimeStatus.ts`
- `parallelGenerationService.ts`

외부 API 호출 wrapper부터 분리하면 테스트와 실패 처리 정리가 쉬워진다.

진행 상태:

- 2026-06-14 1차 정리 일부 완료.
- ComfyUI queue 응답 정규화와 prompt id 추출을 `backend/src/services/comfyui/queueState.ts`로 분리했다.
- history output 분류, final output 선택, Modal base64 output temp 파일 저장을 `backend/src/services/comfyui/outputCollector.ts`로 분리했다.
- axios error message formatter를 `backend/src/services/comfyui/errors.ts`로 분리해 client/runtime/cancel 경로에서 공유한다.
- 확인: `npm run build:backend`, `npm run verify:graph-artifact-runtime`, `npm run verify:comfy-server-default-contracts`, `npm run verify:graph-final-result-promotion-contracts`.
- 2026-06-15 2차 정리 일부 완료.
- ComfyUI output download와 input image upload를 `backend/src/services/comfyui/fileTransfer.ts`로 분리했다.
- workflow JSON prompt 치환과 path assignment를 `backend/src/services/comfyui/workflowSubstitution.ts`로 분리했다.
- `comfyuiService.ts`의 공개 method는 유지하고 내부 구현만 helper에 위임했다.
- 2026-06-15 3차 정리 일부 완료.
- runtime status payload builder와 unprobed Modal status builder를 `backend/src/services/comfyui/runtimeStatus.ts`로 분리했다.
- `getRuntimeStatus`는 queue/probe orchestration만 유지하고 status object 조립은 helper에 위임했다.
- 2026-06-15 4차 정리 일부 완료.
- multi-server generation/submit/connection test orchestration을 `backend/src/services/comfyui/parallelGenerationService.ts`로 분리했다.
- `mcp/tools/generationTools.ts`와 `routes/comfyuiServers.ts`는 병렬 생성 서비스를 새 모듈에서 직접 import한다.
- 2026-06-15 5차 정리 일부 완료.
- multi-server runtime status probing을 `backend/src/services/comfyui/runtimeStatusService.ts`로 분리했다.
- `routes/comfyuiServers.ts`와 `generationQueueService.ts`는 runtime status 수집 서비스를 새 모듈에서 직접 import한다.

### `backend/src/routes/moduleDefinitions.ts`

- 크기: 925 lines
- 함수 마커: 64
- 역할:
  - route 등록
  - label localization
  - module name override
  - dropdown option hydration
  - Comfy field type inference
  - UI schema 생성
  - target module validation
  - module definition persistence
  - NAI/Comfy marked fields 변환

route 파일이 route 이상의 일을 하고 있다. API 진입점이 schema builder와 persistence logic까지 직접 담당한다.

권장 분리:

- `moduleDefinitionLabelService.ts`
- `moduleDefinitionDropdownService.ts`
- `moduleDefinitionSchemaBuilder.ts`
- `moduleDefinitionTargetResolver.ts`
- `moduleDefinitionPersistenceService.ts`
- route 파일은 request parsing과 response만 담당

진행 상태:

- 2026-06-15 1차 정리 일부 완료.
- module label/name localization table과 helper를 `backend/src/services/moduleDefinitions/labels.ts`로 분리했다.
- route 파일은 localized label/name helper를 import해서 사용한다.
- 2026-06-15 2차 정리 일부 완료.
- target module id parsing/validation과 module definition upsert persistence를 `backend/src/services/moduleDefinitions/upsert.ts`로 분리했다.
- route 파일은 response shaping만 유지하고 target 검증과 create/update 실행은 helper에 위임한다.

## 다음 후보

### `backend/src/services/generationQueueService.ts`

- 크기: 884 lines
- 역할: queue transition, dispatch, throttling, terminal waiter
- 권장: transition policy, dispatcher, throttle state, waiter 분리

### `backend/src/services/backgroundProcessorService.ts`

- 크기: 896 lines
- 역할: file processing, metadata summary, hash link, failure marking, file type 판단, concurrency 처리
- 권장: media registration, metadata backfill, failure handling, processing orchestration 분리

### `backend/src/services/complexFilterService.ts`

- 크기: 980 lines
- 역할: 복합 필터 파싱과 SQL/query 조립
- 권장: parser, AST/condition builder, SQL builder 분리

### `backend/src/routes/generation-history.routes.ts`

- 크기: 774 lines
- 역할: generation history query, mutation, filtering, response shaping
- 권장: route와 service/query helper 분리

### `backend/src/routes/settings.ts`

- 크기: 748 lines
- 역할: 설정 API route, validation, storage 연결
- 권장: settings route를 domain별 route 또는 service로 분리

## 서비스 영역 규모

Graphify와 LOC 기준으로 큰 백엔드 서비스 영역은 다음과 같다.

- `backend/src/services/graph-workflow-executor`: 약 6328 lines, 24 files
- `backend/src/services/metadata`: 약 3415 lines, 17 files
- `backend/src/services/autoCollection`: 약 1137 lines, 8 files
- `backend/src/services/folderScan`: 약 926 lines, 8 files
- `backend/src/services/generation-queue`: 약 682 lines, 3 files

`graph-workflow-executor`는 크지만 이미 여러 파일로 나뉘어 있어 단일 god file 문제는 상대적으로 덜하다. 반면 `danbooruBrowserService.ts`, `promptGroupService.ts`, `comfyuiService.ts`는 파일 하나에 책임이 몰려 있어 먼저 보는 것이 좋다.

## 낮은 우선순위

### `backend/src/database/userSettingsBuiltinModuleDefinitionData.ts`

- 크기: 2316 lines
- 성격: module definition 내장 데이터

크기는 가장 크지만 코드 책임 과다라기보다 데이터 덩어리다. 편집성이 문제라면 데이터 파일 split을 검토할 수 있지만, 우선 리팩토링 대상은 아니다.

### `backend/src/database/userSettingsSchema.ts`

- 크기: 818 lines
- 성격: schema/data definition 중심

로직보다 정의가 큰 파일이다. schema domain별 분리는 가능하지만, 서비스 책임 과다 파일보다 우선순위는 낮다.

### `backend/src/utils/logger.ts`

- Graphify degree가 높게 나오지만 공통 logger라 자연스러운 결과다.
- 연결 수가 많다는 이유만으로 분리 대상은 아니다.

## 권장 진행 순서

1. `fileWatcherService`와 `folderScan` cycle을 먼저 끊는다.
2. `danbooruBrowserService.ts`에서 DB 조회와 taxonomy helper를 분리한다.
3. `promptGroupService.ts`에서 Danbooru grouping planner/query builder를 분리한다.
4. `comfyuiService.ts`에서 외부 API client와 output collector를 분리한다.
5. `routes/moduleDefinitions.ts`를 thin route로 만들고 schema builder/persistence를 서비스로 이동한다.

각 단계는 기능 변경 없이 이동과 boundary 정리 위주로 진행하는 것이 좋다. 이 작업들은 사용자 기능을 바꾸기보다, 다음 기능 추가와 테스트 작성을 쉽게 만드는 목적이다.
