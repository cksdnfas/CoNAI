# Release Notes

## Version 26.7.1 (2026-07-01 준비)

v26.7.1은 `26.6.3` 이후 누적된 알파 작업을 메인 릴리즈로 묶은 버전입니다. 핵심은 워크플로우 그래프 운영 확장, 생성 이력 재실행/복구, 로컬 릴리즈 readiness 콘솔, 미디어 검수와 evidence export, MCP opt-in 운영 경계, 그리고 대규모 프론트엔드/백엔드 모듈 분리입니다.

---

### 워크플로우 그래프 / 실행 운영

- 그래프 워크플로우 import/export 경로 추가
- typed random value routing, branch output state, node readiness 표시 보강
- 실행 readiness, run comparison, recovery retry, recovery handoff evidence 확장
- workflow queue recovery preflight cockpit과 runtime decision cue 추가
- 모듈 그래프 실행 패널, 노드 카드 layout, port cell, artifact helper를 분리해 유지보수 표면 축소

---

### 생성 이력 / 이미지 생성 흐름

- 생성 이력 bulk rerun, 선택 이력 rerun, history media metadata 표시 추가
- generation brief workspace와 local snapshot/import/restore/diff preview 흐름 추가
- NAI 생성 출력이 workflow generation queue로 연결되도록 보강
- history image badge overlay 제거와 retry boundary 분리
- 생성 큐 lane 격리, ETA/UI 상태, queue wakeup/routing 계약 보강

---

### 릴리즈 readiness / 운영 evidence

- Settings release readiness tab과 approval-gated operation checklist 추가
- readiness history, trend evidence, alert review, runbook export, local evidence bundle 보강
- media runtime release risk dashboard, caveat triage, cleanup approval packet 추가
- demo host readiness handoff와 release handoff decision cockpit 정리
- push, deploy, restart, protected service 같은 외부 작업은 evidence와 approval gate로 분리

---

### MCP / 알파 데모 / 배포 경계

- MCP HTTP endpoint를 opt-in으로 제한
- MCP dry-run evidence export와 operation contract 추가
- public demo permission, anonymous image demo access, wildcard guest access 계약 보강
- Coolify Dockerfile, healthcheck client, Docker worker runtime 조정
- system API node에서 public upload reference, encoded upload path, multipart image array 전송 보강

---

### 백엔드 구조 정리

- ComfyUI runtime status, parallel generation, file workflow, queue output helper 분리
- complex filter evaluator/query builder/validator 분리
- Danbooru browser taxonomy, prompt group syntax, DB resolver 분리
- prompt group Danbooru query/helper 분리
- module definition schema/upsert/label helper 분리
- generation history route handler, image editor handler, settings LLM preset payload helper 분리

---

### 프론트엔드 구조 정리

- image generation drafts/history status/history panel helper 분리
- module graph artifact/type/API helper와 workflow input sync 경로 정리
- settings tab 저장/검토 UI와 release readiness 패널 확장
- image list/detail, search suggestion, generation queue header widget 계약 보강
- production build script를 명시해 build 환경을 안정화

---

### 포함된 주요 커밋 범위

이 문서는 Git 태그 `26.6.3` 이후 `155311bc`까지의 변경을 바탕으로 정리했습니다.

- 커밋 범위: `26.6.3..155311bc`
- 기능/운영 커밋 수: **153** non-merge commits
- 변경 규모: **243 files changed, 17,200 insertions(+), 8,279 deletions(-)**
- 대표 커밋:
  - `4828e723` fix(llm): repair invalid JSON escapes
  - `68fc1aba` feat(workflow): add typed random value routing
  - `74120faf` feat(workflows): import and export graph workflows
  - `f2034de8` feat(nai): queue workflow generation outputs
  - `ae8ca63b` feat(image-generation): add history bulk rerun
  - `0e9363e9` feat(settings): polish release risk dashboard review
  - `766ee790` feat(settings): add release operation checklist
  - `7556dde5` fix(mcp): require opt-in for http endpoint
  - `b70f0a49` chore(deploy): add Coolify Dockerfile
  - `ac864f73` feat(system-api): send multipart image arrays
  - `80c43c8d` fix(system-api): decode public upload references
  - `155311bc` merge: bring alphatest into main for 26.7.1

---

### 검증

릴리즈 문서 작성 시 기준 검증:

- `npm run verify:system-api-node-contracts`
- `npm run verify:release-readiness`
- `git diff --check`
- `python -m graphify update .`
- `package.json`, `frontend/package.json`, `backend/package.json`, `shared/package.json` 버전 **26.7.1** 정렬
- root/frontend/backend `package-lock.json`의 workspace/package 버전 정렬

릴리즈 직전 추가 권장 검증:

- GitHub Actions와 Pages 배포 결과 확인
- 릴리즈 태그 생성 후 GitHub release 페이지 확인

---

### 버전

- 릴리즈 표기: **26.7.1**
- 앱/package 버전: **26.7.1**
- frontend / backend / shared 패키지 버전도 동일하게 **26.7.1**로 정렬
- 본 릴리즈 노트 기준 이전 태그: **26.6.3**
