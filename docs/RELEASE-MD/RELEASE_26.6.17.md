# Release Notes

## Version 26.6.17 feature-refactor-followup

26.6.17은 2026-06-17 KST에 승인된 feature/refactor follow-up 작업 노트입니다. 현재 package 기준은 `26.6.3`으로 유지하며, 이 문서는 생성 이력 재실행과 미디어 확인 흐름을 다음 로컬 검토 단위로 묶습니다.

---

### 생성 이력 재실행

실패하거나 취소된 생성 이력을 사용자가 다시 큐에 올리는 흐름을 정리했습니다.

- 실패/취소 이력의 bulk rerun 진입점 추가
- 선택한 생성 이력만 다시 실행하는 selection bar 동작 추가
- retry 가능한 queue job id만 추려서 재실행하는 helper 경계 정렬
- queue retry API 호출은 `generation-history-retry-actions.ts`로 분리

---

### 미디어 확인 정보

생성 이력 결과 카드에서 검토에 필요한 기본 정보를 더 빨리 볼 수 있게 했습니다.

- 결과 이미지의 해상도, 파일 형식, 모델 정보를 compact badge로 표시
- 기존 safety/cancellation overlay와 함께 보이도록 구성
- metadata 표시만 추가하고 파일 처리, cleanup, deletion 동작은 추가하지 않음

---

### 로컬 확인

운영 메모와 검증 기준은 [`docs/systems/26.6.17-generation-history-followup-readiness.md`](../systems/26.6.17-generation-history-followup-readiness.md)에 정리했습니다.

기준 명령:

```bash
npm run verify:generation-history-feed-progress-ui-contracts
npm run verify:generation-queue-ui-contracts
npm run verify:release-readiness
python -m graphify update .
git diff --check
```

---

### 비목표와 승인 경계

이번 follow-up은 로컬 UI/경계 정리와 검증에 한정합니다.

- package/app version bump 없음
- push, deploy, live demo update, server restart 없음
- protected service `3999` 조작 없음
- DB schema, retention policy, destructive cleanup 없음
- auth/security policy change, public API expansion 없음

