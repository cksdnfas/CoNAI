# Release Notes

## Version 26.8.6 (2026-08-06)

v26.8.6은 GitHub `main`의 26.07.12 릴리즈 커밋 이후 진행된 37개 non-merge 커밋을 묶은 안정 릴리즈입니다. 생성·워크플로우 실행을 취소 가능하고 추적 가능한 구조로 바꾸고, 실시간 상태 동기화와 대규모 라이브러리 성능을 강화했으며, 미디어 접근·보존·권한 경계를 안정화했습니다.

---

### 실행, 대기열, 실시간 상태

- 생성 대기열 취소 프로토콜을 재설계해 요청·실행기·상위 ComfyUI 작업의 상태 전이를 일관되게 처리
- 중단된 작업과 제출 실패를 복구하는 orphan reconciliation 및 실패 분류 경계 보강
- 그래프 워크플로우 실행에 협력 취소와 노드 스케줄러를 적용해 장시간 LLM·ComfyUI 작업도 안전하게 중단
- 큐, 생성 히스토리, 워크플로우 예약 상태를 SSE로 전달하고 연결 장애 시 기존 조회 방식으로 복구
- 폴더 스캔, 그룹 재매칭, 썸네일 작업을 책임 추적형 런타임 작업으로 통합하고 진행률 UI 제공

---

### 성능과 데이터 계층

- 이미지 피드 페이지네이션과 검색 쿼리 계획을 정리해 대규모 라이브러리 탐색 비용 절감
- 프롬프트 검색에 FTS5 인덱스를 도입하고 변경되지 않은 스캔 행의 불필요한 재기록 방지
- auto-tag 대기 조회를 부분 인덱스로 전환하고 SQLite planner 통계 의존 제거
- 큐 입력의 base64 데이터를 콘텐츠 주소 방식으로 분리하고 수명주기 조회에서 대형 payload hydration 제거
- 큐·히스토리 polling 비용을 연결된 클라이언트 수와 무관하게 일정하게 유지
- 그래프 문서 전체 대신 요약 정보를 반환하고 그래프 조회 캐시와 LLM 호출 상한 적용
- 파일 스캔, watcher, 백업 소스, 유사도 검사와 이미지 처리 hot path의 반복 I/O 감소

---

### 히스토리와 미디어 안정성

- 생성 히스토리의 등급 안전 표시를 설정에서 제어할 수 있도록 확장
- 미디어 접근 권한, 보존 한도, 상세 보기와 다운로드 경로를 일관되게 정리
- 공개 워크플로우 히스토리의 계정 범위와 anonymous 접근 계약 정렬
- 비디오 미디어의 scope가 목록·상세·모달 전환 중 유지되도록 경로 안정화
- 이미지 처리 후 파일 핸들을 명시적으로 해제해 Windows 환경의 파일 잠금 문제 완화
- 전역 오버레이와 생성 히스토리에서 필요한 번역 카탈로그를 지연 로드 경계에 맞게 보강

---

### 보안, 인증, 입력 검증

- 업로드 API의 인증·권한 경계를 강화하고 요청 유형별 본문 제한 계약 보강
- 워크플로우 숫자 입력의 최소·최대 범위를 서버 실행 경계에서도 강제
- 인증 접근 결과 캐시를 재사용하되 세션 본문에는 캐시 stamp를 저장하지 않도록 정리
- 게스트 회원가입 기본값을 활성화해 로그인 화면의 가입 흐름 복구

---

### 런타임과 품질

- 기본 실행을 통합 API/worker 모드로 유지하고 분리 실행은 명시적 opt-in으로 제한
- 시작 시 workspace 의존성을 동기화해 빌드 산출물과 런타임 패키지 불일치 방지
- `better-sqlite3`를 13.0.2로 갱신하고 새 성능 스키마를 초기 migration에도 반영
- 프론트엔드 typecheck 스크립트가 실제 소스 전체를 검사하도록 수정
- 검증 스크립트의 CRLF checkout 호환성과 저장소 계약 검사를 보강

---

### 문서 정리

- 완료되었거나 더 이상 운영 기준으로 사용하지 않는 구현 계획·TODO 문서 22개 삭제
- 시스템 문서 색인과 후속 참조에서 삭제된 계획 문서 링크 제거
- 사용자 가이드, 시스템 운영 문서, 감사 기록, 기존 릴리즈 노트는 유지

---

### 포함된 커밋 범위

- 기준 릴리즈 커밋: `6229f975` (`26.07.12`, 당시 GitHub `main`)
- 마지막 기능 커밋: `5d52ea02`
- 커밋 범위: `6229f975..5d52ea02`
- non-merge commits: **37**
- 대표 커밋:
  - `1bccf422` feat(queue): redesign generation cancellation protocol
  - `394c14d2` feat(workflow): make graph execution cooperatively cancellable
  - `24e89aea` feat(events): push queue and history state over SSE
  - `ebc883da` feat(jobs): add accountable runtime job runner
  - `7d7dd223` perf(search): index prompts with FTS5 and stop rewriting unchanged scan rows
  - `f470f7cf` perf(queue): store base64 queue inputs by content instead of inline
  - `3e51486d` fix(upload): enforce upload authorization boundaries
  - `5d52ea02` feat(auth): enable guest signup by default

---

### 버전

- 릴리즈 표기: **26.8.6**
- npm package 버전: **26.8.6**
- root / frontend / backend / shared package 및 lockfile 버전 정렬

### 검증

- 릴리즈 readiness 검증
- 전체 build와 문서 build
- 변경 diff whitespace 검사
- package 및 lockfile 버전 정렬 확인
