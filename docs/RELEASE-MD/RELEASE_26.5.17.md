# Release Notes

## Version 26.5.17 (2026-05-17)

v26.5.17은 `26.4.27` 이후 누적된 212개 커밋을 압축한 알파 릴리즈입니다. 핵심은 워크플로우 그래프 실행 안정화, 이미지/미디어 상세 경험 개선, 프롬프트·와일드카드·Danbooru 도구 확장, 한국어 기본 UI, 그리고 대규모 리팩터링/계약 검증 보강입니다.

---

### 워크플로우 그래프 / 생성 큐

그래프 실행과 생성 큐가 더 큰 작업량을 버틸 수 있도록 실행 압력과 상태 polling을 줄였습니다.

- 그래프 예약 큐 scaling, Comfy handoff, branch cleanup, queue wait/ETA 흐름 개선
- worker busy 상태에서는 불필요한 Comfy status polling을 건너뛰도록 조정
- workflow artifact explorer, public artifact explorer, 실행 썸네일, final artifact thumbnail 지원
- graph debug artifact를 설정으로 gate 처리하고, debug toggle을 노출
- workflow runner/current/saved graph summary와 output progress range 표시 추가
- 고정 생성 모듈과 일반 wildcard transform node 추가
- Modal ComfyUI 타깃에서 자동 probe를 피하도록 target UI와 backend 흐름 정리

---

### 이미지 / 미디어 상세 경험

이미지 상세 뷰어, 비디오/모션 미디어, pixel preview, 다운로드/탐색 흐름을 한 덩어리로 다듬었습니다.

- 이미지 상세 secondary query 지연과 motion media의 관련 이미지 쿼리 skip
- 이미지 이동/다운로드 최적화, 비디오 갤러리 로딩 압력 감소
- GIF 포함 pixel preview 토글, intensity popup, edge-preserving zoom, image-q 기반 preview 처리
- pixel preview 처리 offload로 UI thread 부담 감소
- tall image, floating surface, 이미지 필터 preview dimension 문제 수정
- 그룹 이미지/홈/생성 히스토리/프롬프트/Danbooru feed 진행률 표시 추가
- 업로드 결과 상세 링크, 숨김 결과 count, 실패 결과 row cap 추가

---

### 유사 이미지 / 중복 검사

유사도 검사는 수동/자동 정책을 명확히 하고, 실제 hot path 비용을 줄이는 쪽으로 정리했습니다.

- 유사/중복 검사 실행 정책을 `manual` / `always`로 설정 가능
- 기본 설정은 무거운 검사를 보수적으로 수동 실행하도록 유지
- 상세 이미지 전환 시 이전 유사도 요청 취소와 안정화 지연 추가
- 후보 스캔은 필요한 최소 컬럼만 읽고, 상위 결과만 hydrate하도록 최적화
- prompt similarity의 저장된 fingerprint/준비 필드를 활용해 반복 JSON parsing 제거
- pHash Hamming distance 계산을 더 가벼운 방식으로 개선
- backend/frontend image similarity 계약 검증 추가

---

### 프롬프트 / 와일드카드 / Danbooru

프롬프트 탐색과 와일드카드 편집 흐름이 실사용 중심으로 확장됐습니다.

- Danbooru prompt browser 통합과 grouping UX 정리
- 프롬프트 grouping 표시 옵션, preset, inline autocomplete 추가
- autocomplete pager를 popup frame으로 이동하고 caret 기준 wildcard popup 배치
- prompt tag를 Danbooru로 연결
- wildcard JSON import/export, chain parsing hardening, 검색 선택 유지 개선
- wildcard editor/inline picker copy 현지화와 tab auto-select 처리

---

### UI / 설정 / i18n

한국어 기본 UI를 중심으로 설정 화면과 잔여 문구를 정리했습니다.

- frontend i18n 기본 언어를 한국어로 정렬하고 ko/en 리소스 정리
- 보안, LLM connection, 미디어 저장, 외형, 폴더, 평점/메타데이터, 자동 설정 UI 문구 현지화
- API fallback error와 helper fallback 잔여 문구 정리
- settings list progress range, path dropdown tree picker, mobile dropdown/overlay 동작 개선
- CoNAI 실행 런처 이름을 runtime mode 기준으로 정리

---

### 안정성 / 보안 / 데이터 처리

권한, 경로, route validation, 파일 처리의 방어선을 보강했습니다.

- admin rate limit bypass 수정과 trusted mode auth check 간소화
- recycle bin transient lock 재시도, watched folder watcher toggle 보강
- backup source path normalization, file verification, Civitai, image file/editor route 계약 강화
- LIKE 검색 literal, search option suggestion, graph workflow folder query parsing hardening
- upload processing path dedupe, metadata persistence/rewrite helper 공유
- group image route pagination과 backend image processing responsiveness 개선

---

### 리팩터링 / 검증 인프라

중복된 route/helper/UI 로직을 많이 쪼개고, 주요 영역에 계약 검증 스크립트를 추가했습니다.

- frontend API barrel coupling 제거와 shared API response parsing 정리
- requester route/account helper, queue status set, schedule enqueue parsing, cleanup detail helper 공유
- graph input parsing, module definition upsert, node card/inspector/helper 분리
- builtin system module, graph Comfy artifact, graph artifact runtime, video optimization 검증 추가
- queue routing/wakeup/ETA, wildcard guest access, auth DB bootstrap, Codex generation 검증 추가
- image editor/file route, backup source, group image, recycle bin deletion 계약 검증 추가

---

### 포함된 주요 커밋 범위

이 문서는 Git 태그 `26.4.27` 이후 `alphatest` 현재 상태까지의 변경을 바탕으로 정리했습니다.

- 커밋 범위: `26.4.27..HEAD`
- 커밋 수: **212**
- 변경 규모: **606 files changed, 74,462 insertions(+), 16,744 deletions(-)**
- 대표 커밋:
  - `d8b53244` Add general wildcard transform node
  - `574d5163` Reduce workflow queue polling load
  - `3b1f4976` Optimize graph reservation queue scaling
  - `ca47caea` Add Comfy workflow artifact explorer
  - `03116278` Add Korean-default frontend i18n support
  - `b5c50754` Integrate Danbooru prompt browser and cleanup workflows
  - `877966a0` Add prompt presets and inline autocomplete
  - `e22fe789` Offload pixel preview processing
  - `b91be601` Add configurable image similarity checks
  - `5d3f1f4c` Optimize image similarity hot paths

---

### 검증

릴리즈 문서 작성 시 기준 검증:

- `package.json`, `frontend/package.json`, `backend/package.json`, `shared/package.json` 버전 **26.5.17** 정렬
- root/frontend/backend `package-lock.json`의 workspace/package 버전 정렬
- `git diff --check`
- `npm run docs:build`

기능 릴리즈 전 추가 권장 검증:

- `npm run build`
- `npm run verify:image-similarity-contracts`
- `npm run verify:graph-workflow-route-contracts`
- `npm run verify:wildcard-guest-access-contracts`

---

### 버전

- 앱 버전: **26.5.17**
- frontend / backend / shared 패키지 버전도 동일하게 **26.5.17**로 정렬
- 본 릴리즈 노트 기준 이전 태그: **26.4.27**
