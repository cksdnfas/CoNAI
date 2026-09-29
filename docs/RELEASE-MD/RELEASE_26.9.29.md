# Release Notes

## Version 26.9.29 (2026-09-29)

v26.9.29는 26.8.9 릴리즈 커밋 이후 진행된 265개 non-merge 커밋을 묶은 안정 릴리즈입니다. 앱 전체 화면을 테두리 없는 플랫 디자인으로 다시 만들고, 갤러리·생성·설정 화면의 조작 흐름을 정리했으며, MCP 원격 사용과 MiniMax H3 Director, NovelAI v5 지원을 확장했습니다. GitHub `main`에 반영됐지만 버전으로 묶이지 않았던 8월 수정 사항도 함께 포함됩니다.

---

### 새 플랫 UI

- 카드 안에 카드를 겹치던 테두리 중심 화면을 hairline 구분선과 여백 중심의 플랫 레이아웃으로 전면 교체
- 공용 사이드바 레이아웃(`PageWithSidebar`)과 헤더 아래 고정되는 페이지 툴바를 갤러리·그룹·프롬프트·와일드카드·워크플로우·설정에 공통 적용
- 헤더 내비게이션을 아이콘 중심으로 바꾸고 넓은 화면에서는 이름과 현재 페이지를 함께 표시
- 설명 문구와 개수 배지를 덜어내고 보조 동작은 툴팁이 있는 아이콘 버튼으로 정리
- Radix 기반 모달·확인 창·체크박스·스위치·탭·메뉴·슬라이더를 도입해 `window.confirm` / `window.prompt`를 모두 앱 내 대화상자로 교체
- 빈 상태·로딩·오류 화면, 스낵바 스택, 상태 색상 토큰, 타입 스케일을 공용 컴포넌트로 통일
- 라이트 테마의 보조 텍스트 가독성과 한국어 overline 자간 개선
- NovelAI·Codex·ComfyUI는 제공자 이름 대신 로고 마크로 표시
- 한국어 UI 문구를 반말 톤으로 통일하고 남아 있던 영어·하드코딩 문구 번역

---

### 갤러리, 이미지 뷰어, 그룹

- 홈 갤러리 툴바에 전체 개수, 인라인 필터 칩, 정렬 순서 추가 및 중복 추가 로딩 방지
- 적용한 검색 조건을 URL에 유지하고, 이미지 페이지에서 돌아올 때 원래 화면으로 복귀
- 타일 체크박스, 길게 눌러 선택, Shift 범위 선택, 전체 선택과 홈·그룹 공용 선택 바 추가
- 러버밴드 선택 옆에 선택형 "눌러서 드래그" 모드 추가, 그룹으로 드래그해 넣기 지원
- 휴대폰과 넓은 화면의 열 개수 설정을 따로 저장
- 뷰어 스타일 이미지 상세 페이지와 플랫 메타데이터 열, 투명 이미지용 체커보드 배경
- 뷰어와 상세 페이지에서 이미지 한 장 바로 삭제
- 뷰어 카운터·그룹 트리·카드 개수를 실제 전체 개수와 일치하도록 수정
- 그룹 이름 중복 검사를 같은 상위 그룹 범위로 한정하고 그룹 경로(`상위/하위`)로 그룹 지정 지원
- 새 항목이 적을 때 masonry 열이 비어 새 결과가 사라지던 문제 수정

---

### 생성 화면과 큐

- 필름스트립과 작업 진행률이 있는 결과 스테이지 추가, 모바일은 편집 우선 배치
- NAI·ComfyUI·Codex가 같은 생성 액션 바와 해상도 선택기를 공유
- NAI·ComfyUI·Codex·모듈 그래프 결과를 원하는 이미지 그룹에 바로 저장
- 생성 이력에서 프롬프트 복사와 당시 설정 불러오기, 이력 행의 원본 요청 확인
- 선택한 ComfyUI 워크플로우를 URL에 유지하고, 잘못된 입력 필드는 생성 시 해당 위치에 표시
- 대기열 예상 완료 시간, 취소 확인, 예약 탭 분리
- 생성 이력 범위별 비우기와 실패 이력 정리 확인 절차 추가
- 여러 장을 한 번에 요청해도 모든 배치 결과가 지정한 그룹에 들어가도록 수정
- 초기화·라이브러리 삭제 등 되돌릴 수 없는 동작에 확인 창 추가

---

### ComfyUI, MiniMax H3 Director, NovelAI

- 최신 MiniMax H3 Director 워크플로우 규격 지원과 모듈 노드용 MiniMax 제어·동적 포트 추가
- Director 해상도 계산과 해상도 프리셋을 shared 패키지로 옮겨 생성 화면·모듈 그래프·서버가 같은 크기를 계산
- `resolution_mp` 범위와 워크플로우 작성자가 출력 크기·입력 스케일·업스케일 컨트롤을 숨길 수 있는 옵션 추가
- 워크플로우 스칼라 기본값이 실행 시 유지되도록 수정
- NovelAI v5 모델과 토큰 전용 인증, 투명 배경 옵션 추가
- Opus 무료 생성 한도를 적용하고 Anlas 한도를 화면에 표시
- ComfyUI·워크플로우 필드를 공용 `TypedFieldInput`으로 통일하고 NAI 캐릭터 프롬프트도 와일드카드 편집기 사용
- 필드 라벨 클릭이 옆의 버튼으로 잘못 전달되던 문제 수정

---

### 모듈 그래프 워크플로우

- 워크플로우 탐색기를 사이드바 레이아웃으로 옮기고 러너·인스펙터·실행·스케줄 화면을 플랫 행으로 정리
- 워크플로우 러너의 고정 실행 행과 최근 결과 요약 표시
- 실행 목록 페이지네이션과 서버 측 실행 개수 집계
- 실행 상태·로그 라벨·중지 사유를 읽기 쉬운 문구로 표시하고 엔진 이름 노출
- 캔버스 빠른 메뉴를 Popover로 교체하고 NAI 입력 행 편집 중 공백·미완성 값 유지

---

### MCP

- 설정 화면에서 MCP HTTP 원격 접속을 안전하게 켜고 키 권한을 설명
- ComfyUI 워크플로우와 모듈 그래프 워크플로우 실행 지원
- 사용자 범위로 제한된 작업·산출물 조회 도구 추가
- 자동 라우팅과 태그 기반 라우팅, 그룹 경로 입력과 이미지 그룹 도구 추가
- 대기열 제출 idempotency, 거부된 인증 호출 감사 기록 등 생성 요청 경로 보강

---

### 업로드, 다운로드, 설정

- 드롭 영역 하나와 모드 전환, 구분선 파일 큐로 업로드 화면 단순화
- 서버 처리 진행률 표시, 재시도 큐, 서버 한도에 맞춘 대용량 업로드 분할 전송
- 다운로드 시 저장 위치 선택, 비디오 원본 직접 다운로드, 화면과 무관하게 원본 파일명 유지
- 한 장 선택 시 zip 없이 바로 다운로드
- 설정을 사이드바 페이지로 재구성하고 모든 초안에 공용 고정 저장 바와 이탈 경고 적용
- 유지보수 위험 구역, 서버에 저장되는 권한 그룹 색상, 쉬운 말로 풀어 쓴 태거·감시 폴더·해시 재생성 안내
- 이미지 편집기 터치·펜 그리기와 편집 폐기 확인, 월페이퍼 편집기 실행 취소·다시 실행과 위젯 라이브러리

---

### 인증, 보안, 런타임

- 로그인 오류를 번역된 인라인 메시지로 표시하고 로그인 후 홈으로 이동
- 막힌 페이지 안내와 브라우저별 언어 선택, 게스트 가입 복구 흐름 추가
- 인증 DB 정보와 Danbooru DB 경로는 관리자에게만 표시
- 배포 호스트의 같은 출처 요청을 CORS에서 허용
- Docker 브리지 환경에서 모든 클라이언트가 같은 IP로 보이는 점을 고려해 로그인·API·업로드·게스트 가입 속도 제한 완화
- 재시작 직후 스캔 폭주로 웹이 멈추던 문제 완화: libuv 스레드 풀 확대, watcher 초기화 동시성 제한, 자동 스캔 유예·분산, glob 동시성 축소
- 백그라운드 미디어 재시도 상태 저장과 런타임 경계·복구 경로 보강
- 태거 데몬 상태를 소유 프로세스에 묶고 "모델 메모리 유지" 옵션이 실제로 자동 언로드를 건너뛰도록 수정
- 선택형 GPU Docker 런타임 추가와 Docker 이미지의 torch 설치 순서 수정

---

### 업그레이드 참고

- 시작 시 DB 마이그레이션 `034`~`036`이 자동 적용됩니다.
  - `034` 백그라운드 미디어 재시도 상태
  - `035` 생성 대기열 idempotency 키
  - `036` 그룹 이름 중복 기준을 같은 상위 그룹 범위로 변경
- Node.js **20.19 이상**이 필요합니다.
- 레거시 검증 스크립트(`verify:*`, `validate:metadata`, `i18n:check` 등)를 정리했습니다.

---

### 포함된 커밋 범위

- 기준 릴리즈 커밋: `457f287f` (`26.8.9`)
- 마지막 기능 커밋: `5a19e842`
- 커밋 범위: `457f287f..5a19e842`
- non-merge commits: **265**
- 대표 커밋:
  - `5561aaea` perf(startup): smooth post-boot I/O storm that stalled web navigation
  - `692a73e9` feat(nai): add v5 and token-only authentication
  - `450f8b5d` feat(mcp): secure HTTP access from settings
  - `619c9606` feat(comfy): support updated MiniMax H3 Director workflows
  - `3c5c46a4` feat(groups): scope group names to parent and resolve group paths
  - `d48b72b2` feat(generation): add a result stage with filmstrip and job progress
  - `d61b675a` feat(image-list): add tile checkboxes, long-press, shift ranges and select-all
  - `3f474747` feat(ui): add Radix-based checkbox, switch, tooltip, tabs, menus, slider, progress and IconButton
  - `3137741d` feat(layout): PageWithSidebar, PageToolbar and sidebar rows
  - `5a19e842` feat(ui): keep the page toolbar under the header while scrolling

---

### 버전

- 릴리즈 표기: **26.9.29**
- npm package 버전: **26.9.29**
- root / frontend / backend / shared package 및 lockfile 버전 정렬
- 앱 설정 화면과 브랜드 툴팁은 frontend package 버전으로 `v26.9.29` 표시

### 검증

- 전체 build (shared / backend / frontend)
- backend·frontend 타입 검사
- frontend lint (디자인 시스템 가드 규칙 포함)
- 문서 build
- package 및 lockfile 버전 정렬 확인
