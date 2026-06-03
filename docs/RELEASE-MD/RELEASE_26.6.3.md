# Release Notes

## Version 26.6.3 (2026-06-03 준비)

v26.6.3은 `26.5.23` 이후 누적된 147개 커밋을 정리한 알파 릴리즈 준비 문서입니다. 핵심은 API/worker 런타임 분리, SQLite WAL과 startup migration 안정화, 자동 그룹 재매칭 비용 절감, auto tag 역색인 기반 검색과 통계 캐싱, 단건 자동 그룹 할당 복구, 모듈 그래프 final result 보존, 프롬프트/워크플로우 편의 기능 확장, 그리고 런타임/UI hot path 정리입니다.

---

### 런타임 / API 응답성

API 요청과 오래 걸리는 백그라운드 작업이 서로 막지 않도록 런타임 역할과 startup 경로를 정리했습니다.

- API/worker 역할 분리와 split runtime launcher 추가
- queue helper와 graph retention cleanup 모듈 분리
- queue/retention hot path 상한 설정과 home image feed 응답 속도 개선
- startup migration 직렬화, 최신 DB의 migration lock skip, stale runtime 정리 경로 보강
- backend stop 명령을 프로젝트 root scope로 제한해 외부 프로세스 오작동 방지
- split runtime supervisor 보강으로 API/worker 재시작과 중복 런타임 정리 경로 안정화
- API/smoke runtime에서는 custom node filesystem sync를 건너뛰고 worker/manual 경로로 넘겨 startup I/O 감소
- 오래된 queue payload와 invalid media hash retry 경로 정리

---

### SQLite / WAL 안정화

런타임 중 DB WAL이 커지거나 hot path에서 불필요한 write가 쌓이는 경로를 줄였습니다.

- runtime WAL buildup 방지와 대형 image WAL truncate 흐름 추가
- group rematch WAL churn 감소
- legacy service runner cleanup 보호
- background queue/postprocess lock retry와 metadata task coalescing 보강
- 최근 backend contract gate와 WAL/migration 검증 alias 확장

---

### 자동 그룹 / auto tag 최적화

자동 그룹은 전량 재매칭을 수동/특수 보정용으로 두고, 평상시에는 새 미디어 1건이 자기 조건에 맞는 그룹으로 붙도록 정리했습니다.

- group rematch job을 API thread 밖에서 실행
- delete-all/insert-all 방식 제거, 변경분만 delete/insert하는 diff 방식 적용
- rematch hash staging을 SQL 내부 temp table로 stream 처리
- rematch SQL staging transaction lock 보강
- `media_auto_tag_index` 역색인 추가로 JSON full-scan 기반 `auto_tags` 검색 제거
- auto-tag stats 30초 캐시와 stats용 부분 인덱스로 cold/warm 통계 조회 비용 감소
- 단순 auto-tag search가 역색인을 먼저 사용하고, 동일 조건 total count를 짧게 캐싱
- auto-tag index key 압축, duplicate group scan guard, random media offset scan 회피
- `auto_tags` 저장 직후 `runAutoCollectionForNewImage(compositeHash)` 실행
- 테스트 환경 검증 기준 5개 auto group rematch가 약 64초 수준에서 약 1.55초 수준으로 감소

---

### 모듈 그래프 / final result 보존

워크플로우 실행 결과가 preview-only, artifact-only, final result promotion 실패 상태에서도 더 정확히 보존되고 보이도록 정리했습니다.

- final result overlay context, source node/port 표시, workflow artifact/result counts 추가
- final result promotion 실패를 격리하고 warning source를 명확히 표시
- final result hash, dimensions, display name, metadata alias, source metadata 보존
- canonical media ref 기반 graph artifact 저장
- compact execution IO 테이블과 node IO 모델 추가
- transient artifact/log retention 정리와 final visual result promotion 보강

---

### 시스템 API / 워크플로우 노드

모듈 그래프에서 이미지/API/랜덤 텍스트를 다루는 노드와 실행 경로를 보강했습니다.

- API request, encoding, random text, bypass node 추가
- system API image reference를 file upload/public reference/encoded value 경로별로 안정화
- Comfy/Nai/custom JS/system executor의 result/artifact 처리 정리
- volatile random node rerun, dynamic input port 정렬, workflow public dropdown/model preview 보존
- key-value list input과 node card layout 확장

---

### 프롬프트 / Danbooru / Wildcard

프롬프트 작성과 태그 그룹 문법, inline autocomplete 흐름을 보강했습니다.

- Danbooru group syntax 추가
- Danbooru DB가 없을 때 프롬프트 경로가 깨지지 않도록 처리
- literal tag parentheses 보존
- prompt inline syntax settings, token scanner, autocomplete, wildcard inline picker 확장
- prompt preset inline picker와 editable group snapshot cache 정리
- prompt similarity candidate 범위를 줄이고 inactive field를 건너뛰어 후보 계산 비용 감소
- wildcard inline picker를 data hook, suggestion hook, popup content로 분리하고 focus/open 시점 lazy load 유지

---

### 이미지 / 생성 이력 / 업로드

생성 결과와 이력, 미디어 readiness 상태를 더 일관되게 보이도록 조정했습니다.

- image modal action visibility와 sequence normalization 개선
- locked-file delete revival 방지와 recycle bin 생성 보장
- generated media handoff 중복 방지, metadata extraction defer
- generation history statistics, workflow history stats, artifact history totals 정렬
- history failed cleanup gate, stale fast polling 중단, pending media preview gate 보강
- upload result link와 selected file size total 재사용
- image detail media control UI를 별도 컴포넌트로 분리하고 pan-drag 상태 갱신을 animation frame으로 묶음
- generation queue header polling은 hidden tab에서 중단하고 idle 상태에서는 더 느리게 polling

---

### UI / 유지보수 hot path 정리

큰 단일 파일과 반복 polling/lookup을 줄여 릴리즈 이후 변경 비용과 화면 runtime waste를 낮췄습니다.

- wallpaper motion widget의 per-widget 90ms interval을 공유 active-widget ticker로 통합
- module graph editor interaction에서 반복 `nodes.find(...)` 대신 memoized `nodeById` 조회 사용
- MCP generation tool 등록부를 NovelAI flow와 Comfy output save/postprocess service로 분리
- built-in system module seed 정의를 데이터 테이블과 단일 upsert loop로 분리
- 각 분리 지점에 contract 검증을 추가해 파일이 다시 비대해지는 회귀를 차단

---

### 포함된 주요 커밋 범위

이 문서는 Git 태그 `26.5.23` 이후 `ad6431a9`까지의 변경을 바탕으로 정리했습니다.

- 커밋 범위: `26.5.23..ad6431a9`
- 커밋 수: **147**
- 변경 규모: **267 files changed, 18,353 insertions(+), 4,353 deletions(-)**
- 대표 커밋:
  - `ad6431a9` refactor: reduce runtime and UI hot paths
  - `0d2ca16a` perf: cache auto-tag search totals
  - `f3d84834` perf: use auto-tag index for tag search
  - `3731b6a6` perf: index auto-tag stats queries
  - `6b5aa6de` perf: cache auto-tag stats
  - `ee5ab1cc` perf: index prompt similarity candidates
  - `c89b4e02` perf: avoid random media offset scans
  - `c27fef8e` fix(runtime): supervise split runtime
  - `ee0c6cb6` feat: split api and worker runtime roles
  - `8913087f` perf: bound queue and retention hot paths
  - `be742ef3` fix: serialize startup migrations
  - `142b2b00` fix: prevent runtime WAL buildup
  - `31269111` fix: run group rematch jobs off api thread
  - `86025795` perf: reduce group rematch write churn
  - `9cf7ca84` perf: stream group rematch hashes in SQL
  - `29859fdf` perf: index auto tag rematch filters
  - `9a1c4166` fix: assign auto groups after auto-tagging
  - `97008985` fix(graph): use canonical media refs
  - `504aa00b` feat(graph): compact execution io
  - `c65d3768` fix(graph): canonicalize promoted results
  - `fda5867f` feat(prompts): add Danbooru group syntax
  - `7063f824` feat(module-graph): add node bypass mode
  - `838bb347` feat(module-graph): add random text node
  - `92c2f784` feat(module-graph): add API request and encoding nodes

---

### 검증

릴리즈 문서 작성 시 기준 검증:

- `npm run build:backend`
- `npm run docs:build`
- `npm run verify:workspace-script-aliases`
- `npm run verify:single-image-auto-collect-contracts`
- `npm run verify:auto-tag-index-contracts`
- `npm run verify:group-rematch-job-contracts`
- `npm run verify:sqlite-wal-maintenance-contracts`
- `npm run verify:auto-tag-stats-cache-contracts`
- `npm run verify:search-option-suggestion-contracts`
- `npm run verify:prompt-inline-syntax-contracts`
- `npm run verify:image-detail-filter-preview-contracts`
- `npm run verify:generation-queue-ui-contracts`
- `npm run verify:wallpaper-layout-contracts`
- `npm run verify:module-graph-bypass-contracts`
- `npm run verify:mcp-generation-tools-contracts`
- `npm run verify:builtin-system-modules`
- `python -m graphify update .`
- `package.json`, `frontend/package.json`, `backend/package.json`, `shared/package.json` 버전 **26.6.3** 정렬
- root/frontend/backend `package-lock.json`의 workspace/package 버전 정렬

기능 릴리즈 전 추가 권장 검증:

- `npm run build`
- `npm run build:frontend`
- `npm run verify:graph-canonical-media-contracts`
- `npm run verify:graph-execution-compact-io-contracts`
- `npm run verify:result-retention-contracts`

---

### 버전

- 릴리즈 표기: **26.6.3**
- 앱/package 버전: **26.6.3**
- frontend / backend / shared 패키지 버전도 동일하게 **26.6.3**로 정렬
- 본 릴리즈 노트 기준 이전 태그: **26.5.23**
