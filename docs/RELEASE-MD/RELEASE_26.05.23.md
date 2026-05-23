# Release Notes

## Version 26.05.23 (2026-05-23)

v26.05.23은 `26.5.17` 이후 누적된 106개 커밋을 정리한 알파 릴리즈입니다. 핵심은 대규모 프론트엔드 hot path 최적화, 검색/프롬프트 태그 필터 흐름 개선, ComfyUI 모델/노드 썸네일 경험 보강, 생성 큐/예약 UI polling 정리, 그리고 검증 스크립트 확장입니다.

---

### 성능 / 렌더링 안정화

이미지 피드, 모달, 모듈 그래프, ComfyUI 패널, 검색 경로에서 반복 lookup과 불필요한 polling을 줄였습니다.

- 이미지 리스트, 이미지 모달, 관련 갤러리, similarity overlay의 반복 배열 탐색을 Map/Set 기반 lookup으로 정리
- 모듈 그래프 canvas, 실행 패널, saved graph, output grid, artifact preview의 검색/선택/상태 계산 경로 cache
- 프롬프트, wildcard, wallpaper, NAI reusable asset, 그룹 hierarchy, settings folder detail 등 UI hot path 안정화
- 홈 검색 drawer chunk와 이미지 모달 neighbor preview를 미리 데워 체감 지연 완화
- idle 상태의 data rematch polling, 숨겨진 filtered queue polling, 빈 suggestion LIKE filter 등 불필요한 쿼리 제거

---

### 검색 / 프롬프트 태그

프롬프트 태그를 바로 검색 필터로 연결하는 흐름을 추가하고, 검색 상태 동기화 비용을 줄였습니다.

- 프롬프트 태그 액션 메뉴에 검색 필터 추가 동작과 ko/en 문구 추가
- 이미지 상세, 업로드, 자동 테스트 화면의 prompt/auto tag를 즉시 검색 필터로 적용
- 이미지 상세 모달에서 검색 필터 적용 전 모달을 닫아 전환 충돌 방지
- home search context callback과 chip append 중복 제거 안정화
- rating 검색에서 unbounded max score를 생략해 불필요한 조건 방지
- prompt tag link/action, home search drawer 계약 검증 보강

---

### ComfyUI / 워크플로우 편의

ComfyUI 모델 선택과 workflow authoring의 탐색성을 높이고, preview cache와 auto-collect 경로를 정리했습니다.

- helper node thumbnails와 model hover preview 지원
- 모델 preview cache를 startup 시 정리하는 흐름 추가
- Power LoRA row 삭제와 tree option search 추가
- Comfy dropdown auto-collect path와 routing target lookup cache
- Comfy workflow marked field, authoring path, generation panel lookup 최적화
- representative API auto-collect 흐름 복구

---

### 생성 큐 / 예약 / 라우팅

큐 화면과 dispatcher hot path를 가볍게 만들고, 수동 refresh 범위를 현재 UI 상태에 맞게 좁혔습니다.

- generation queue background page contention 감소
- ComfyUI routing tag normalization, dispatcher compatibility cache, generation routing lookup cache
- ETA eligible server lookup과 hot path를 줄이고 dispatch 후보를 server 단위로 bucket 처리
- header widget refresh가 현재 탭과 filtered query 활성 상태에 맞는 query만 refetch하도록 정리
- workflow reservation selection, queue status summary, generation history status count 계산 비용 축소

---

### 이미지 / 미디어 UX

이미지 상세와 batch 작업에서 실제 사용 중 거슬리던 전환/다운로드/레이아웃 문제를 다듬었습니다.

- 이미지 모달 모바일 레이아웃과 contained fit 시작 상태 안정화
- 모달 form 내부 arrow key 동작 보존
- batch download archive 파일명 유지
- image attachment picker와 modal source item lookup 최적화
- media postprocess visibility gate 강화

---

### 설정 / 썸네일 / 검증 인프라

설정 화면과 검증 alias를 보강해 유지보수 루프를 짧게 만들었습니다.

- thumbnail controls 추가와 thumbnail settings contract 검증 추가
- workspace verification alias 노출/보호
- orphaned verification scripts와 comfy workflow entry verifier alias 노출
- local Hermes artifact ignore 규칙 추가
- 사용자 가이드와 프로젝트 README polish

---

### 포함된 주요 커밋 범위

이 문서는 Git 태그 `26.5.17` 이후 `1a608b9d`까지의 변경을 바탕으로 정리했습니다.

- 커밋 범위: `26.5.17..1a608b9d`
- 커밋 수: **106**
- 변경 규모: **244 files changed, 13,630 insertions(+), 2,640 deletions(-)**
- 대표 커밋:
  - `c12255ac` perf: reduce background queue page contention
  - `61278135` perf(search): warm home search drawer chunk
  - `6182ce92` feat(settings): add thumbnail controls
  - `828502df` feat(comfy): add tree option search
  - `f7a1aafd` fix(queue): normalize ComfyUI routing tags
  - `c10de407` perf(search): skip unused complex stats recounts
  - `b9fd897a` perf(image-modal): warm neighbor previews
  - `976be240` perf(queue): bucket dispatch candidates by server
  - `4ef10463` feat(search): add prompt tag filter menu
  - `0fc94302` feat(comfyui): add helper node thumbnails
  - `822baae5` fix(comfyui): enable model hover previews
  - `33fbf175` fix(comfy): clear preview cache on startup
  - `1a608b9d` fix(ui): apply prompt tag filters immediately

---

### 검증

릴리즈 문서 작성 시 기준 검증:

- `npm run verify:prompt-tag-links`
- `npm run verify:home-search-drawer-contracts`
- `npm run verify:generation-queue-ui-contracts`
- `npm run build:frontend`
- `package.json`, `frontend/package.json`, `backend/package.json`, `shared/package.json` 버전 **26.5.23** 정렬
- root/frontend/backend `package-lock.json`의 workspace/package 버전 정렬

기능 릴리즈 전 추가 권장 검증:

- `npm run build`
- `npm run docs:build`
- `npm run verify:image-similarity-contracts`
- `npm run verify:graph-workflow-route-contracts`
- `npm run verify:wildcard-guest-access-contracts`

---

### 버전

- 릴리즈 표기: **26.05.23**
- 앱/package 버전: **26.5.23**
- frontend / backend / shared 패키지 버전도 동일하게 **26.5.23**로 정렬
- 본 릴리즈 노트 기준 이전 태그: **26.5.17**
