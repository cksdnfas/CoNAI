# Release Notes

## Version 26.6.8 workflow-media-operations

26.6.8은 2026-06-08 KST에 승인된 워크플로우·미디어 운영 로드맵 문서입니다. 목표는 반복 생성 작업을 더 쉽게 운영하는 것입니다. 저장된 워크플로우를 고르고 재사용하고, 실패한 실행을 회복하고, 결과를 비교하고, 생성 미디어를 검토·분류·보호·정리하는 흐름을 한 작업선으로 묶습니다.

---

### 워크플로우와 설정 운영

저장된 워크플로우와 ComfyUI 서버, 설정 저장 방식을 운영자가 예측할 수 있게 정리했습니다.

- 저장된 Comfy workflow 검색, 선택, 복제, 재사용 경로 보강
- ComfyUI 등록 서버 enabled/disabled 전환과 disabled 서버의 active routing 제외
- settings page의 즉시 저장 동작을 명시적 Save 기반 흐름으로 정렬
- workflow input, routing, executable state에 대한 실행 전 안내 보강

---

### 실행 회복과 결과 비교

실패, 취소, 완료된 run을 다시 확인하고 안전하게 반복할 수 있게 정리했습니다.

- queue/history record에서 실패·취소·완료 상태와 다음 행동 표시
- backend contract가 허용하는 범위에서 retry/rerun affordance 노출
- run input, artifact, final result, warning context를 비교 가능한 형태로 표시
- deploy, restart, protected port `3999` 범위는 건드리지 않음

---

### 미디어 리뷰와 안전한 정리

검색, 그룹, 유사도, 태그 품질, 평점, batch review를 한 검토 흐름으로 묶었습니다.

- 검색·그룹·유사도·태그·평점 신호를 함께 보는 review workspace
- grouping, tags, ratings, review status를 위한 non-destructive batch action
- recycle/recover와 destructive deletion을 분리하는 guardrail
- cleanup은 reversible review 중심으로 제한하고 destructive cleanup은 별도 승인 필요

---

### 릴리즈 문서와 비목표

이번 문서는 날짜 기반 `YY.M.D` 버전 정책을 따릅니다. 현재 package 기준은 여전히 `26.6.3`이며, `26.6.8`은 승인된 다음 작업 로드맵의 검토 표기입니다.

- old `26.7.0 readiness` 표기는 사용하지 않음
- limited alpha demo, MCP operations stabilization, external exposure 작업 제외
- push, deploy, live demo update, server restart 제외
- auth/security redesign, public API expansion, DB schema/data retention/destructive cleanup 제외

---

### 릴리즈 준비 체크리스트

로컬 확인 절차와 승인 경계는 [`docs/systems/26.6.8-workflow-media-operations.md`](../systems/26.6.8-workflow-media-operations.md)에 따로 정리했습니다.

릴리즈 준비 워크스페이스는 다음 핸드오프 근거를 로컬에서 캡처할 수 있게 정리합니다. 이 항목들은 검토 상태이며 push, deploy, restart, smoke를 실행하지 않습니다.

- 로컬 커밋 스냅샷과 원격 대비 커밋 범위
- alpha branch push 승인 메모
- demo host pull/update 핸드오프 메모
- 로컬 검증 결과와 live target smoke 계획 분리
- restart 전에 확인할 롤백 기준과 protected port `3999` 회피 기준

로컬 준비 확인 alias:

```bash
npm run verify:release-readiness
```

이 alias는 다음 항목을 순서대로 실행합니다.

- `npm run verify:workspace-script-aliases`
- `npm run docs:build`
- `npm run build`

이번 준비 문서 작성 기준으로 별도 확인해야 하는 canonical check:

- `python -m graphify update .`

---

### 승인 경계

이 준비 패키지는 문서, script alias, local verification 정리까지만 포함합니다. 다음 작업은 별도 승인이 필요합니다.

- push, deploy, live demo update, server restart
- protected service `3999` 조작
- auth model redesign, security policy change, public API expansion
- DB schema/data retention/destructive cleanup
- package version bump, git tag, public release announcement

Runbook guardrails는 이 승인 경계를 화면에서 다시 보여주며, demo host 작업은 preparation only, rollback 기준은 restart 전 필수 확인으로 남깁니다.

---

### 버전

- 로드맵 표기: **26.6.8 workflow-media-operations**
- 현재 앱/package 기준: **26.6.3**
- 작업 범위: workflow/media operations local review
- 기준 이전 문서: [26.6.3](./RELEASE_26.6.3.md)
