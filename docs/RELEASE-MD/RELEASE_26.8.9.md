# Release Notes

## Version 26.8.9 (2026-08-09)

v26.8.9는 GitHub `main`의 26.8.6 릴리즈 커밋 이후 진행된 44개 non-merge 커밋을 묶은 안정 릴리즈입니다. MiniMax H3 Director 전용 제작 흐름을 추가하고, ComfyUI 실시간 진행률과 큐 접근 정책을 확장했으며, 미디어 프리뷰 성능과 런타임 구조를 정리했습니다.

---

### MiniMax H3 Director와 ComfyUI 입력

- DaSiWa MiniMax H3 Director 노드를 CoNAI 생성 화면과 ComfyUI API 준비 단계에 통합
- I2V, FL2V, FL2VA, REF2V, REF2VA 모드의 미디어 타임라인과 전용 프롬프트 빌더 지원
- 최신 Director 입력 규격, subject definition, 기존 프롬프트 변환과 서버 전달 계약 정렬
- 미디어 카드 정렬·교체·초기화, 이미지/비디오/오디오 프리뷰와 원본 화면 비율 표시
- 같은 ComfyUI 노드에서 가져온 marked field를 한 그룹으로 묶어 입력 맥락 개선
- 워크플로우 숫자 필드를 단계형 입력으로 교체하고 Min / Max 범위를 UI와 서버 실행 경계에서 함께 강제
- 비어 있는 드롭다운 placeholder를 실행 선택지에서 제거하고 편집기 제어 응답성 보강

---

### 실시간 진행률과 큐 정책

- ComfyUI WebSocket 진행 이벤트를 작업·노드 단위 상태로 변환해 대기열과 생성 이력에 실시간 표시
- 후처리 완료 및 일반 상태 변경도 SSE로 전달해 결과 준비 상태를 즉시 갱신
- 로그인한 모든 사용자가 권한 범위 안에서 활성 큐와 실시간 진행률을 확인하도록 접근 정책 정렬
- 공개 워크플로우에 역할·사용자별 활성 큐 상한을 추가해 큐 독점 방지
- 작업 이벤트를 구독자 전체에 무차별 전파하지 않고 사용자 범위로 제한
- 고빈도 노드 실행 프레임과 프론트엔드 캐시 패치를 묶어서 렌더링·네트워크 비용 절감

---

### 미디어와 업로드 경험

- 업로드 전에 선택 이미지·비디오를 썸네일로 식별할 수 있는 미디어 선택 프리뷰 추가
- 갤러리 비디오는 포스터를 먼저 표시하고 viewport 진입 시에만 실제 미디어를 로드
- 이미지 상세 보기의 확대·이동·스와이프 제스처와 툴바 책임을 분리해 조작 안정성 개선
- 등급 안전 설정을 캐시하고 미디어 조회 결과·오버레이 참조를 안정화해 반복 계산 감소
- 인증된 소유자가 범위가 지정된 생성 히스토리 미디어를 정상 조회하도록 권한 경계 수정

---

### 런타임, watcher, 성능

- 서버 listen을 watcher 초기화에서 분리해 대형 폴더가 있어도 시작 완료가 지연되지 않도록 개선
- UI 기본값 때문에 chokidar polling이 강제되던 설정을 마이그레이션으로 초기화
- ComfyUI WebSocket 메시지를 사전 필터링하고 실패 재연결에 backoff 적용
- 큐 헤더와 런타임 이벤트 소비자의 고빈도 재렌더링을 줄이고 진행률 flush를 배치 처리
- Node 24 기반 Docker build/runtime으로 SQLite 네이티브 모듈 실행 환경 정렬
- watcher 수명주기와 비디오 poster backfill 실패 경로에 회귀 검증 추가

---

### 구조 정리와 유지보수

- 설정 라우트와 프론트엔드 API를 도메인별 모듈로 분리하고 공용 wire contract를 shared 패키지로 이동
- 생성 히스토리의 조회 repository와 명령 service를 분리해 읽기·쓰기 경계 명확화
- 백그라운드 미디어 처리 파이프라인을 이미지·비디오·후처리 단계별 서비스로 분할
- 워크플로우 authoring, 이미지 상세, 모듈 그래프 노드 카드의 대형 프론트엔드 모듈 분리
- 앱 미들웨어, 세션 초기화, 정상 종료 수명주기를 startup 모듈로 분리
- 사용되지 않는 레거시 모델·서비스·타입 경로와 완료된 내부 계획 문서 제거
- 계약 검증 helper와 번들 예산 검사를 정리해 저장소 검증 신뢰도 보강

---

### 포함된 커밋 범위

- 기준 릴리즈 커밋: `2329930a` (`26.8.6`, 당시 GitHub `main`)
- 마지막 기능 커밋: `910a03d6`
- 커밋 범위: `2329930a..910a03d6`
- non-merge commits: **44**
- 대표 커밋:
  - `e48ad8cc` feat(comfy): integrate MiniMax H3 Director
  - `e816232c` feat(comfy): group workflow fields by source node
  - `b02dd9cc` feat(comfy): stream realtime generation progress
  - `14e45e16` perf(images): stream gallery videos poster-first and viewport-gated
  - `00b13a34` feat(comfy): support updated MiniMax H3 Director
  - `d15a2c50` feat(queue): open queue view and live progress to all signed-in users
  - `bf5c4bc1` feat(queue): per-role per-member active queue limits for public workflows
  - `69c19495` refactor(settings): centralize wire contracts and domain APIs
  - `98931048` refactor(startup): isolate middleware and shutdown lifecycle
  - `910a03d6` feat(comfy): show MiniMax Director media aspect ratios

---

### 버전

- 릴리즈 표기: **26.8.9**
- npm package 버전: **26.8.9**
- root / frontend / backend / shared package 및 lockfile 버전 정렬
- 앱 설정 화면과 브랜드 툴팁은 frontend package 버전으로 `v26.8.9` 표시

### 검증

- MiniMax H3 Director 백엔드·프론트엔드 계약 검증
- 릴리즈 readiness 검증
- 전체 build와 문서 build
- 변경 diff whitespace 검사
- package 및 lockfile 버전 정렬 확인
