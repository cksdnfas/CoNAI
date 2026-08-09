# 유지보수·리팩터링 실행 결정 기록

- 기준 계획: `MAINTENANCE_REFACTORING_PLAN_2026-08-09.html`
- 기준 커밋: `bf5c4bc1`
- 실행일: 2026-08-09

## Phase 1 정본 판정

- `GeneralSettings.headerNavigation`은 백엔드 기본값·로드 정규화·응답 경로에서 항상 완전한 값으로 채워지므로 필수 wire 필드로 확정한다.
- `TaggerDependencyCheckResult`는 실제 서비스와 라우트 응답이 제공하는 `available`·`message`를 정본으로 확정한다. 기존 백엔드 타입에만 있던 `details`는 실제 응답에 없던 죽은 선언으로 판정한다.
- wallpaper 저장/API 계약은 shared의 느슨한 wire 모델을 정본으로 사용한다. 위젯 종류별 상세 판별 모델과 편집 helper는 프런트 view model에 남기고 API 경계에서 명시적으로 변환한다.
- shared settings에는 wire shape와 wire key만 둔다. UI 언어 메타데이터와 서버·UI 기본값은 각 런타임 영역에 둔다.

## Phase 2 호환 판정

- 기존 `GenerationHistoryModel.findAll({ ids })`가 `ids`를 적용하지 않던 동작은 이번 무동작변경 리팩터링에서 그대로 보존한다.
- metadata/list/count/statistics 경로의 `ids` 지원은 유지하고, 향후 동작 변경이 필요하면 별도 API 변경으로 다룬다.

## Phase 3 배포 검증 판정

- 로컬 검증에서는 임시 DB·폴더의 60개 미디어 스트레스 시나리오로 배치 처리, 재예약, WAL, 부분 실패 결과를 확인한다.
- 실제 대형 배포본의 대량 폴더 감시 시나리오는 이 작업 환경에서 안전하게 실행할 수 없으므로 배포 후 수동 확인 항목으로 남긴다.

## Phase 6 선택 백로그 판정

- 백엔드 종료/미들웨어 수명주기 분리는 최근 동일 구간 변경이 집중된 hotspot이므로 이번 작업에 포함한다.
- 내장 시스템 모듈 정의 레지스트리는 2026-06-30 이후 변경이 없고 기록상 충돌 증가도 확인되지 않아, 계획서의 착수 조건인 “변경 충돌이 실제로 잦아질 때”를 충족하지 않는다. 현재 순서와 검증을 유지한 채 보류한다.

## 독립 검토 후 판정

- `/recent`·`/statistics`·워크플로 통계는 계획서에 명시된 기존 전역 응답 스코프를 복원한다. 계정 소유자 스코프는 상세·미디어 접근 경로에만 유지한다.
- 운영 소비처가 없어진 `GenerationHistoryModel` 호환 facade는 삭제하고, 검증에서 재도입 금지를 확인한다.
- tagger 상태 응답은 shared의 `TaggerServerStatus`를 생산자까지 직접 사용한다.
- 현재 프런트가 모르는 wallpaper 위젯은 편집 화면에서 숨기되 별도 pass-through 데이터로 보존하여 열기·저장 왕복에서 삭제되지 않게 한다.
- `frontend/package-lock.json` 재동기화는 `@conai/shared` 로컬 의존성 추가에 필요한 변경이므로 유지한다. 커밋을 만들 때는 설정 리팩터링과 분리된 lockfile 전용 커밋으로 둔다.
- bundle budget의 mtime 비교는 checkout 후 오탐을 만들 수 있으므로 실패 조건이 아닌 경고로 사용한다. 루트 검증 명령은 프런트 프로덕션 빌드를 먼저 수행해 실제 최신 번들을 측정한다.
- `ProcessingResult.duplicates`·`unique`는 기존 공개 반환값이 항상 0이었던 호환 동작을 유지한다. 실제 집계로 바꾸는 일은 별도 API 동작 변경으로 다룬다.
- artist 링크 기본값은 shared를 순수 wire 계약으로 유지하기 위해 백엔드·프런트 런타임에 둔다. 시작/종료 dynamic import와 기존 문자열 기반 WAL·watcher 검증의 실행형 전환은 동작 결함이 확인되지 않은 후속 정비 항목으로 남긴다.
