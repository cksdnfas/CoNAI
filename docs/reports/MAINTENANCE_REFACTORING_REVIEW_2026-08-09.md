# 유지보수·리팩터링 작업 검토 보고서

- 기준 계획: `MAINTENANCE_REFACTORING_PLAN_2026-08-09.html`
- 판정 기록: `MAINTENANCE_REFACTORING_DECISIONS_2026-08-09.md`
- 검토 대상: `bf5c4bc1` 대비 작업 트리 전체 (151개 파일, +4,113 / −12,831)
- 검토일: 2026-08-09
- 방법: 4개 영역(설정 계약 / 히스토리 분리 / 미디어 파이프라인·시작종료 / 프런트 hotspot·검증 자산) 병렬 코드 검토. HEAD와 라인 단위 대조, 회귀 가드 체크리스트 대조. 검증 근거로 backend·frontend `tsc --noEmit`과 관련 verify 스크립트 실행 결과(통과)를 참조했다. 빌드·배포 테스트는 하지 않았다.

## 총평

리팩터링은 계획서에 충실하다. wire 계약·라우트 패리티·SSE 이벤트 발행·종료 순서·미들웨어 순서·제스처/페이로드 보존 등 핵심 가드는 전 영역에서 확인됐다. 다만 **커밋 전 반드시 수정할 HIGH 1건**, **의도 확인이나 결정이 필요한 MEDIUM 6건**이 있다.

## HIGH — 커밋 전 수정 필수

### H1. verify 스크립트가 잘린 읽기 기반으로 재생성되어 약 29개 단언이 소실됨

`frontend/src/scripts/verifyModuleGraphExecutionPanelContracts.ts:290`에 LLM 잘림 아티팩트가 문자 그대로 남아 있다:

```
'node card artifact outputs should use Set.has while rendering o…2053 tokens truncated… MIME aliases before extension fallback'
```

파일이 647줄(HEAD) → 570줄로 줄었고, 두 단언 메시지 사이에 있던 내용이 위 한 줄로 붕괴됐다. 소실된 검증: node-inspector Set-lookup 계약 4건, canvas node-map/추천/액션 메뉴 계약 8건, final-result metadata/MIME alias fallback 체인 약 15건, 그리고 `module-graph-canvas.tsx`·`node-inspector-panel.tsx`·`node-inspector-panel-helpers.tsx` 소스 읽기 자체(이 파일들은 리팩터링 대상도 아니었음). **대상 코드는 전부 살아 있고 검증만 사라졌으므로** 스크립트는 녹색으로 통과하면서 커버리지의 약 1/3이 조용히 사라진 상태다.

**조치:** `git show HEAD:frontend/src/scripts/verifyModuleGraphExecutionPanelContracts.ts`의 약 384–520행 구간을 복원한 뒤, 리팩터링으로 이동한 경로(registry/renderer 파일)만 다시 겨냥하도록 수정한다. 함께 소실된 NAI 드롭다운 렌더 단언(`value={naiModelValue}`)도 복원 대상이다.

## MEDIUM — 커밋 전 결정 필요

### M1. `/recent`·`/statistics` 계열 응답 스코프가 변경됨 (기능 변경이 리팩터링에 섞임)

`backend/src/routes/generation-history.routes.ts:77-111, 379-393`. HEAD에서는 `page.generation.view` 권한이면 전역 데이터를 반환했으나, 지금은 `applyHistoryAccessScope`가 적용되어 비관리자는 자기 기록만 받는다(식별 불가 세션은 빈/0 응답). 게스트 403 수정(8ba0fdbd)의 취지와는 일관되지만, "무동작변경" 원칙을 깨는 API 동작 변경이고 새 verify가 이 동작을 계약으로 굳혔다. **유지한다면 의도된 보안 강화로 결정 기록에 남기고, 아니라면 되돌린다.** 레포 내 프런트 소비처는 없음을 확인했다.

### M2. 구 `GenerationHistory.ts`가 죽은 셔임으로 잔존하며 verify가 존재를 고정함

86줄 읽기 전용 facade가 남았지만 import하는 모듈이 0개다. 계획서는 셔임을 마지막에 제거하도록 했는데, `verifyGenerationHistoryRefactoringContracts.ts:422-434`가 오히려 이 파일의 존재를 문자열로 단언한다. **파일을 삭제하고 verify를 "부재 단언"으로 전환**하는 것을 권장.

### M3. `taggerDaemon.ts:25`의 로컬 `TaggerServerStatus` 중복이 드리프트 채널로 남음

`GET /api/settings/tagger/status` 응답의 실제 생산자가 shared 계약이 아닌 이 로컬 인터페이스로 타이핑된다(`imageTaggerService.ts:9`에서 재export → `tagger-settings.routes.ts:109-116`에서 응답). 지금은 필드가 동일하나, 데몬 쪽만 바뀌면 컴파일이 통과한 채 shared·프런트가 낡는다 — 이번 통합이 막으려던 바로 그 경로. **로컬 선언을 삭제하고 shared에서 import.**

### M4. 월페이퍼 unknown 위젯 타입이 열고-저장하면 영구 삭제됨 (범위 밖 동작 변경)

`frontend/src/features/wallpaper/wallpaper-types.ts:209-227` + 에디터/런타임 페이지. 신규 wire↔view model 변환기가 8종 외의 위젯 타입을 `null`로 걸러내는데, 에디터가 이 변환을 거쳐 hydrate→save 하므로 미래 빌드가 쓴 out-of-contract 위젯이 프리셋에서 파괴적으로 제거된다. 월페이퍼는 Phase 4의 3개 hotspot에 없던 파일이다. **unknown 타입은 pass-through로 보존하거나, 드롭을 명시적 결정으로 기록.**

### M5. `frontend/package-lock.json` 전면 재동기화(8,234줄)가 리팩터링에 동봉됨

원인: HEAD lockfile이 심하게 낡아 있었고(`dnd-kit`, `i18next`, `reactflow@11` 등 package.json에 없는 항목 잔존), `"@conai/shared": "file:../shared"` 추가가 전체 재생성을 촉발. 부수적으로 in-range 버전 상승(react 19.2.0→19.2.4, react-router-dom, transitive 등)이 포함됐다. 다음 `npm ci`부터 설치 버전이 달라지므로 **별도 커밋으로 분리하고 커밋 메시지에 명시.**

### M6. `verify-bundle-budget.mjs`에 추가된 mtime 기반 stale 게이트가 오탐을 만든다

`frontend/scripts/verify-bundle-budget.mjs:8-31`. `dist/index.html`이 소스 파일보다 오래되면 실패하는데, git checkout/브랜치 전환은 소스 mtime을 갱신하므로 번들이 바이트 동일해도 재빌드 전까지 실패한다. **게이트 제거 또는 경고로 완화 권장.**

## LOW — 개선 권장 (동작 영향 없음)

**설정 계약**
- `settingsServiceStorage.ts:126-137` — `normalizeWallpaperWidget` 반환 리터럴 전체를 `as WallpaperWidgetInstance`로 광역 캐스팅(누락 필드 은폐 위험).
- `frontend/tsconfig.app.json:14` — `@conai/shared/*` 딥임포트 경로가 타입에선 통과하나 번들에선 해석 불가(현재 사용처 0, 잠재 함정). 또한 프런트가 shared의 **값**(`HEADER_NAVIGATION_ITEM_KEYS`)을 처음 import하므로 stale `shared/dist`가 새 위험이 됨 — 루트 dev/build는 안전, 단독 `cd frontend && npm run dev`는 사전 shared 빌드 필요(문서화 권장).
- `DEFAULT_ARTIST_LINK_URL_TEMPLATE`이 backend `constants/settings.ts`와 frontend `settings-defaults.ts` 2곳 수동 중복.
- `DEFAULT_HEADER_NAVIGATION_SETTINGS`(UI 기본값)가 계획서상 위치인 `settings-defaults.ts`가 아닌 `frontend/src/types/settings.ts`에 남음.
- 월페이퍼 위젯 타입 목록이 4곳(shared union, 프런트 union, 프런트 Set, 백엔드 배열)에 중복 — shared const 배열 패턴으로 수렴 권장.

**히스토리 분리**
- `historyCommandService.ts:204-229` — ready-flip 경로가 side-effect seam(`activeSideEffectDependencies.publishEvent`)을 우회해 직접 publish + 청크 크기 400 하드코딩 중복.
- `historyCommandService.ts:91-99` — publish 실패 try/catch 이중화.
- workflow list statistics 구현 2곳(`HistoryQueryRepository.getWorkflowListStatistics` vs `GenerationHistoryService` projection) — 동등하나 드리프트 소지.

**미디어 파이프라인**
- `mediaPostprocessCoordinator.ts:37-47` — auto-tag 단계가 `scheduled` 결과 객체를 반환 후 비동기로 `failed`로 변조(스냅샷 소비자에 시간 의존 값).
- `savedMediaOrchestrator.ts:119,139` — 동일 결과 객체 이중 기록.
- `ProcessingResult.duplicates/unique` 0 하드코딩 유지 — 신규 per-file `duplicate` 플래그로 집계 가능해졌는데 미활용.
- `imageMediaProcessor.ts:38-47` — `createSharedSourceImage`가 unsupported-format try 블록 안으로 이동(현재 무해하나 미래 throw 시 재시도 분류가 terminal로 변질).

**시작/종료·검증**
- 종료 시 스케줄러류를 dynamic import — 미로드 모듈을 종료 시점에 인스턴스화해 no-op stop(무해).
- `verifySqliteWalMaintenanceContracts`·`verifyWatchedFolderScanEfficiencyContracts`는 여전히 순수 문자열 검사(기존 스타일 유지, 향후 실행형 전환 후보).
- `use-module-graph-node-card-queries.ts:13-17` — `comfyWorkflowId` 옵션이 선언만 되고 미사용.

## 가드 통과 확인 (요약)

| 가드 | 결과 |
|---|---|
| 설정 wire 필드 변경 0건 (기계적 diff) / 라우트 20개 경로·메서드·마운트 순서 보존 / 중복 마운트 없음 | 통과 |
| 드리프트 판정 3건(headerNavigation 필수화, tagger `details` 죽은 선언 삭제, wallpaper 단일 소스) — 코드와 판정 기록 일치 | 통과 |
| SSE 이벤트 발행 패리티: 9개 쓰기 경로 전부 보존, 08-08 ready-flip·generic update 이벤트 유지, 프런트 15s 워치독 무변경 | 통과 |
| 게스트 미디어 소유자 스코프 가드(8ba0fdbd) 유지, blanket bypass 없음, `registerAppRoutes.ts` diff 0 | 통과 |
| 쓰기 순서(캐시 무효화 → 이벤트 → 보존) 단일 지점화, 필터 빌더 단일화(조건·바인딩 순서 동등, `findAll` ids 무시 quirk 의도적 보존) | 통과 |
| 타입 순환 제거(중립 타입 모듈), 신규 런타임 순환 없음(visibility→command는 lazy require) | 통과 |
| 미디어 public API 7종·호출처 12곳 불변, DB 상태 전이·SQL 동일, 후처리 멱등성·해시 저장 후 실행 보존 | 통과 |
| 워처 폴링 가드(마이그레이션 033 영역 무변경, usePolling 재도입 없음), listen 비블로킹, 포스터 정책 무변경 | 통과 |
| 미들웨어 등록 순서 항목 단위 동일(제거된 `loginLimiter`·`allowedOrigins`는 HEAD에서도 죽은 코드), 종료 순서 정확 일치, 시그널 핸들러 단일 등록 | 통과 |
| Hook 규칙: registry는 컴포넌트/키 매핑(hook factory 아님), 4개 query 무조건 마운트 유지, queryKey·enabled 동등 | 통과 |
| 공개 워크플로 payload 필드·순서·클램프(1..32, 0..999) HEAD와 동일, `WorkflowRoleQueueLimits` 바이트 동일 | 통과 |
| 제스처 상수·리스너 등록/해제·RAF 배칭 동일, localStorage 키·기본값 무변경, 추출은 detail 폴더 내부로 한정 | 통과 |
| verify 경로 재지정: 삭제·이동된 파일을 읽던 스크립트 전부 갱신 확인(H1 파일 1건 제외), package.json 스크립트 매핑 정합 | 통과 |

## 커밋 구성 권고

작업이 전부 하나의 작업 트리에 있어 계획서의 "독립 커밋·단독 revert" 원칙이 현재로선 충족되지 않는다. 커밋 시 최소한 다음 분리를 권장한다:

1. `frontend/package-lock.json` 재동기화 (M5) — 단독 커밋
2. Phase 1 설정 계약 (shared 재작성 + 도메인 라우트/클라이언트 분리)
3. Phase 2 히스토리 분리 (M1 결정 반영, M2 셔임 삭제 포함)
4. Phase 3 미디어 파이프라인 분리
5. Phase 4 프런트 hotspot (H1 복원, M4 결정 반영 포함)
6. Phase 5 verify helper·계약 정비 (M6 완화 포함)
7. Phase 6 시작/종료 분리
8. 문서 (audit/plan/decisions/review) — 별도 커밋; 리팩터링과 무관한 `CONAI_MEDIA_AND_AI_GENERATION_REFERENCE_2026-08-09.html`·`docs/systems/media-and-ai-generation-project-integration-guide.md`는 별도 커밋으로 분리

## 배포 후 수동 확인 (판정 기록 승계)

- 대형 배포본에서 대량 폴더 감시 + 배치 처리 시나리오 확인 (Phase 3 판정 기록의 잔여 항목)
- M1을 유지하기로 결정한 경우, 외부 소비자(API로 `/recent`·`/statistics`를 쓰는 대시보드 등)가 없는지 배포 환경에서 확인
