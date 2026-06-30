# Release Notes

## Version 26.6.19 workflow-media-alpha-operations

26.6.19는 2026-06-19 KST에 승인된 다음 추천안 묶음 작업 노트입니다. 현재 package 기준은 `26.6.3`으로 유지하며, 이 문서는 모듈 워크플로 운영 UX, 미디어 라이브러리 검수 워크스페이스, 제한 알파 데모와 MCP 운영 안정화를 하나의 로컬 검토 단위로 묶습니다.

---

### 모듈 워크플로 운영 UX

반복 실행자가 저장된 그래프를 고르고, 복제하고, 다시 실행하고, 오류를 회복하는 흐름을 한 화면 흐름으로 정리합니다.

- 저장된 workflow 검색, 복제, 재사용, run input 확인 경로 보강
- 실패, 차단, 건너뛰기, 조건 분기 결과를 rerun 결정에 연결
- 실행 상세에서 final result, intermediate artifact, warning context를 비교 가능한 형태로 유지
- 서버 재시작, protected service `3999`, live demo 반영은 이 작업 노트 밖 승인 경계로 분리

---

### 미디어 라이브러리 검수 워크스페이스

검색, 그룹, 유사도, tag 품질, recycle/recover, batch review를 한 검수 흐름으로 묶습니다.

- 검색 결과와 그룹, 유사도, tag 품질, rating, review status를 같이 보는 검수 경로 정리
- batch action은 reversible review, tag/rating/group 보정 중심으로 제한
- recycle/recover는 destructive deletion과 분리하고, 삭제/보존 정책은 별도 승인 항목으로 유지
- 검수 결과가 생성 이력과 workflow 결과 비교로 돌아갈 수 있게 연결 기준을 둠

---

### 제한 알파 데모와 MCP 운영 안정화

외부 노출 전, 로컬에서 권한, MCP client 계약, 실패 복구, 운영 체크를 검토 가능한 상태로 묶습니다.

- alpha handoff는 push, deploy, restart 실행이 아니라 승인 전 검토 패킷으로 유지
- MCP 도구는 dry-run evidence, approval boundary, client contract를 먼저 확인
- 실패 복구는 rollback 기준, service target, smoke plan, stop condition을 분리해 기록
- auth/security policy, public API expansion, credential/external billing/cloud side effect는 별도 승인 없이는 변경하지 않음

---

### 로컬 확인

운영 메모와 검증 기준은 [`docs/systems/26.6.19-workflow-media-alpha-operations.md`](../systems/26.6.19-workflow-media-alpha-operations.md)에 정리했습니다.

기준 명령:

```bash
npm run docs:build
git diff --check
```

코드 변경이 포함되는 후속 commit-unit에서는 아래 확인을 추가합니다.

```bash
npm run verify:release-readiness
python -m graphify update .
```

---

### 비목표와 승인 경계

이번 묶음은 다음 로드맵을 로컬 검토 가능한 단위로 정렬하는 데 한정합니다.

- package/app version bump 없음
- push, deploy, live demo update, server restart 없음
- protected service `3999` 조작 없음
- DB schema, retention policy, destructive cleanup 없음
- auth/security policy change, public API expansion 없음
- external credential, billing, cloud sync 작업 없음

