# CoNAI

CoNAI는 ComfyUI / NovelAI / Stable Diffusion 생성 이미지와 비디오를 로컬에서 관리하는 AI 미디어 매니저입니다. 메타데이터 추출, 프롬프트 검색, 생성 이력, 워크플로우 실행, 유사 이미지 분석, MCP 연동을 한 프로젝트 안에서 다룹니다.

> 현재 기준 버전: **26.5.17**
> 최신 릴리즈 노트: [`docs/RELEASE-MD/RELEASE_26.5.17.md`](docs/RELEASE-MD/RELEASE_26.5.17.md)

---

## 1) 프로젝트 개요

- **프로젝트명**: CoNAI
- **구성**: Monorepo (`frontend` / `backend` / `shared`)
- **런타임**: Node.js `>= 18` (권장: Node.js 22 LTS)
- **기본 백엔드 포트**: `1666`
- **프론트 개발 서버 포트**: `1677`
- **기본 런타임 데이터 루트**: `user/`

핵심 목표는 단순합니다. 생성 결과를 빠르게 찾고, 비교하고, 다시 생성 흐름으로 되돌리는 로컬 작업대입니다.

---

## 2) 주요 기능

### 이미지 / 미디어 라이브러리

- ComfyUI, NovelAI, Stable Diffusion 메타데이터 파싱
- 이미지, GIF, 비디오 프리뷰와 상세 뷰어
- 평점, 태그, 그룹, 생성 이력, 업로드 결과 관리
- 대량 다운로드, 숨김 결과 표시, 휴지통/삭제 보호 흐름

### 검색 / 정리

- 프롬프트, 모델, 태그, 해상도, 날짜 기반 복합 검색
- 그룹 이미지, 홈 피드, 생성 히스토리, 프롬프트 목록의 진행률/페이지 상태 표시
- LIKE 검색, 검색 옵션 제안, 필터 미리보기, 경로 트리 선택 보강
- Danbooru 프롬프트 브라우저, 태그 링크, 프롬프트 그룹 표시 옵션

### 생성 / 워크플로우

- ComfyUI / NovelAI 생성 흐름 관리
- 모듈 그래프 기반 워크플로우 편집과 실행
- 생성 큐, 예약 실행, ETA, 실패/취소 상태 관리
- Codex 생성, 고정 생성 모듈, workflow artifact explorer, 실행 썸네일
- Modal ComfyUI 같은 원격 타깃의 불필요한 상태 probe 회피

### 프롬프트 / 와일드카드

- 프롬프트 preset과 inline autocomplete
- 와일드카드 JSON import/export
- 와일드카드 체인 파싱, 검색 선택 유지, caret 기준 popup 배치
- 일반 wildcard transform node 지원

### 이미지 품질 / 유사도

- 유사 이미지, 프롬프트 유사도, 중복 검사
- 유사/중복 검사의 수동/자동 실행 정책
- 상세 이미지 이동 시 불필요한 관련 쿼리와 중복 계산 감소
- pixel preview 토글, intensity 설정, edge-preserving zoom, image-q 기반 preview 처리

### 외부 연동 / 운영

- MCP `/mcp` 엔드포인트 제공
- 인증/권한 기반 삭제 보호와 trusted mode 흐름
- watched folder, backup source, recycle bin, runtime path 설정
- 한국어 기본 UI와 영어 fallback 리소스

---

## 3) 기술 스택

- **Frontend**: React 19, TypeScript, Vite, React Query, Tailwind/Radix 계열 UI
- **Backend**: Node.js, TypeScript, Express, better-sqlite3, sharp, ffmpeg
- **Shared**: 공통 타입/상수/유틸 패키지
- **Docs**: VitePress
- **Integration**: MCP SDK, ComfyUI/NovelAI 연동, 로컬 파일 시스템 기반 런타임 데이터

---

## 4) 설치와 실행

### 사전 요구사항

- Node.js `>= 18`
- npm
- Windows 환경 권장 (프로젝트 런처 `.bat` 포함)

### 설치

```bash
npm install
npm run install:all
```

### 개발 서버 실행

```bash
npm run dev
```

- Backend: `http://localhost:1666`
- Frontend: `http://localhost:1677` 또는 `FRONTEND_URL` 설정값

### 프로덕션 빌드

```bash
npm run build
```

### 프로덕션 실행

```bash
npm run start
```

---

## 5) 자주 쓰는 스크립트

```bash
npm run dev                         # shared/backend/frontend 동시 개발 실행
npm run build                       # 전체 빌드
npm run docs:build                  # VitePress 문서 빌드
npm run build:portable              # 포터블 패키지 빌드
npm run build:docker                # 도커 패키지 빌드
npm run build:all                   # 통합 + 번들 + 포터블 + 도커 빌드
npm run verify:image-similarity-contracts
npm run verify:graph-workflow-route-contracts
npm run verify:wildcard-guest-access-contracts
npm run db:reset                    # DB 초기화 후 마이그레이션
```

---

## 6) 환경 변수 / 런타임 경로

루트의 [`.env.example`](.env.example)을 기준으로 `.env`를 구성합니다.

주요 항목:

- `PORT` (기본: `1666`)
- `LOCALE` (기본: `en`)
- `BIND_ADDRESS` (기본: `0.0.0.0`)
- `FRONTEND_URL`
- `RUNTIME_BASE_PATH` (기본: `./user`)
- `RUNTIME_UPLOADS_DIR`, `RUNTIME_DATABASE_DIR`, `RUNTIME_LOGS_DIR`, `RUNTIME_MODELS_DIR`, `RUNTIME_TEMP_DIR`

기본 데이터는 `user/` 아래에 모읍니다. 기존 루트의 `uploads/`, `database/`, `logs/`, `temp/`, `RecycleBin/`, `models/` 데이터는 `user/`로 이동해 사용하세요. 충돌 원본은 `user/_migration_backup/<timestamp>/`로 백업 이동됩니다.

---

## 7) 프로젝트 구조

```text
CoNAI/
├─ backend/        # API 서버, DB, MCP, 생성/검색/파일 처리
├─ frontend/       # React UI
├─ shared/         # 공통 타입/상수/유틸
├─ docs/           # 사용자 문서와 릴리즈 노트
├─ scripts/        # 빌드/배포/검증 스크립트
├─ user/           # 런타임 데이터 루트
└─ build-output/   # 빌드 산출물
```

---

## 8) 문서 링크

- 릴리즈 노트: [`docs/RELEASE-MD/`](docs/RELEASE-MD)
- 최신 릴리즈: [`26.5.17`](docs/RELEASE-MD/RELEASE_26.5.17.md)
- MCP 가이드: [`docs/GUIDE/MCP_GUIDE.md`](docs/GUIDE/MCP_GUIDE.md)
- Comfy workflow artifact explorer: [`docs/comfy-workflow-artifact-explorer.md`](docs/comfy-workflow-artifact-explorer.md)

`docs/Work_Plan/`은 내부 작업 계획 폴더라 사용자용 링크 범위에서는 제외합니다.
