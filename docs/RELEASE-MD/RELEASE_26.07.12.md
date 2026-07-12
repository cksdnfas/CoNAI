# Release Notes

## Version 26.07.12 (2026-07-12)

v26.07.12는 `26.7.1` 이후의 54개 커밋을 묶은 안정 릴리즈입니다. 그룹 탐색과 이미지 생성 작업 흐름을 간결하게 만들고, Lively Wallpaper 연동 경험을 확장했으며, 이미지·DB hot path와 내부 모듈 경계를 정리했습니다.

---

### 그룹 탐색과 이미지 관리

- 하위 그룹의 이미지를 상위 탐색 화면에서 함께 볼 수 있도록 중첩 폴더 조회 보강
- 데스크톱 사이드바와 모바일 폴더 서랍을 포함한 그룹 이동 흐름 정리
- 이미지 도구 모음과 그룹 작업 메뉴를 통합해 선택·이동·관리 동작 단순화
- 대규모 그룹 다운로드 시 불필요한 파일 스캔을 지연해 응답성 개선
- descendant image, toolbar, count map 관련 검증 계약 추가

---

### Wallpaper / Lively

- Lively Wallpaper용 시작 안내와 런타임 진입 흐름 추가
- 배경화면 템플릿과 시계 위젯 추가
- floating collage 배치 계산과 표시 로직 분리
- 편집기 미리보기, preset 관리, runtime hash routing 안정화
- 위젯 inspector와 이미지 편집 필드를 정리해 설정 작업 단순화

---

### 이미지 생성과 워크플로우

- ComfyUI·NAI 생성 화면의 주요 작업과 컨트롤 배치 단순화
- wildcard 감지 칩과 팝업 위치 계산을 독립 모듈로 분리
- 워크플로우 예약 UI와 입력 ID 처리 경계 정리
- 이미지 생성 draft import와 이미지 상세 media frame 분리
- 공통 JSON/API 응답 처리와 blob 다운로드 경로 재사용

---

### 설정, 번역, UI 품질

- 설정 탭 정보 구조를 재편하고 일반 설정 섹션을 분리
- 프론트엔드 번역 누락 보완
- React hook 및 frontend lint 오류 정리
- route lazy loading과 production bundle budget 검증 보강

---

### 성능과 데이터 계층

- 이미지 검색·그룹 조회 hot path 최적화
- 파일 watcher의 반복 DB 쓰기와 write amplification 감소
- 중복 인덱스를 정리하는 DB migration 추가
- watched folder scan, SQLite WAL, auto-tag index, 그룹 descendant 조회 검증 보강

---

### 내부 구조와 안정성

- 생성 큐의 throttle, terminal waiter, transition, cancellation 책임 분리
- graph workflow input·validation·node option·default port row 모듈 분리
- folder, prompt, search, custom node, backup, wallpaper API reader 통합
- 검증된 dead export 제거와 route handler 경계 정리

---

### 포함된 커밋 범위

- 기준 태그: `26.7.1`
- 마지막 기능 커밋: `8461ac9b`
- 커밋 범위: `26.7.1..8461ac9b`
- non-merge commits: **54**
- 대표 커밋:
  - `d96c99f9` feat(groups): clarify folder navigation
  - `aa80bc65` feat(groups): add mobile folder drawer
  - `8c76a578` feat(groups): show nested folder images
  - `0a770879` perf(db): reduce watcher write amplification
  - `4beac88f` feat(generation): streamline creation workspace
  - `2f619d6c` feat(wallpaper): add Lively starter experience
  - `0d45d87a` fix(wallpaper): repair preview and renew UI
  - `8461ac9b` fix(wallpaper): stabilize collage presentation

---

### 버전

- 릴리즈 표기와 Git 태그: **26.07.12**
- npm package 버전: **26.7.12**
- root / frontend / backend / shared package 버전 정렬

### 검증

- 전체 build와 문서 build
- 릴리즈 readiness 검증
- 변경 diff whitespace 검사
- package 및 lockfile 버전 정렬 확인
