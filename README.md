<div align="center">

# CoNAI

**ComfyUI · NovelAI · Stable Diffusion 결과물을 한곳에서 찾고, 정리하고, 다시 생성하는 로컬 AI 미디어 작업대**

[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-2ea44f?style=for-the-badge)](https://cksdnfas.github.io/CoNAI/)
[![Release](https://img.shields.io/badge/release-26.05.23-4f46e5?style=for-the-badge)](docs/RELEASE-MD/RELEASE_26.05.23.md)
[![Node](https://img.shields.io/badge/node-%3E%3D18-339933?style=for-the-badge)](package.json)
[![Docs Deploy](https://img.shields.io/github/actions/workflow/status/cksdnfas/CoNAI/docs-pages.yml?branch=main&label=pages&style=for-the-badge)](https://github.com/cksdnfas/CoNAI/actions/workflows/docs-pages.yml)

[📘 GitHub Pages 문서](https://cksdnfas.github.io/CoNAI/) · [🚀 처음 시작하기](https://cksdnfas.github.io/CoNAI/GUIDE/START_HERE.html) · [🧩 MCP 가이드](https://cksdnfas.github.io/CoNAI/GUIDE/MCP_GUIDE.html) · [📝 릴리즈 노트](docs/RELEASE-MD/RELEASE_26.05.23.md)

</div>

---

## 뭐 하는 앱인가

CoNAI는 생성형 이미지/비디오 작업을 위한 로컬 관리 앱입니다. 생성 결과를 등록하고, 메타데이터를 읽고, 프롬프트와 태그로 찾고, 그룹으로 정리하고, 다시 ComfyUI/NovelAI/Codex 생성 흐름으로 연결합니다.

핵심 목표는 하나입니다.

> **생성 결과를 잃어버리지 않고, 빠르게 비교하고, 바로 다음 생성으로 이어가기.**

---

## 최신 릴리즈: 26.05.23

- 대규모 hot path 정리: 이미지 리스트/모달, 모듈 그래프, 큐/ComfyUI, 검색 경로의 반복 lookup과 idle polling 감소
- 프롬프트 태그 필터: 이미지 상세/업로드/자동 테스트 화면에서 태그를 즉시 검색 필터로 적용
- ComfyUI 편의: helper node/model 썸네일 preview, Power LoRA row 삭제, tree option search, preview cache startup cleanup

자세한 내용은 [`docs/RELEASE-MD/RELEASE_26.05.23.md`](docs/RELEASE-MD/RELEASE_26.05.23.md)에서 확인합니다.

---

## 빠른 링크

| 항목 | 링크 |
| --- | --- |
| 사용자 문서 | https://cksdnfas.github.io/CoNAI/ |
| 가이드 목록 | https://cksdnfas.github.io/CoNAI/GUIDE/ |
| 설치와 실행 | https://cksdnfas.github.io/CoNAI/GUIDE/INSTALLATION.html |
| 이미지 생성 개요 | https://cksdnfas.github.io/CoNAI/GUIDE/GENERATION_OVERVIEW.html |
| 워크플로우 편집 | https://cksdnfas.github.io/CoNAI/GUIDE/WORKFLOW_EDITOR.html |
| MCP 가이드 | https://cksdnfas.github.io/CoNAI/GUIDE/MCP_GUIDE.html |
| 최신 릴리즈 | [`docs/RELEASE-MD/RELEASE_26.05.23.md`](docs/RELEASE-MD/RELEASE_26.05.23.md) |

---

## 주요 기능

### 미디어 라이브러리

- ComfyUI, NovelAI, Stable Diffusion 메타데이터 추출
- 이미지, GIF, 비디오 프리뷰와 상세 뷰어
- 평점, 태그, 그룹, 업로드 결과, 생성 이력 관리
- 유사 이미지/중복 검사와 상세 비교 흐름

### 검색과 정리

- 프롬프트, 모델, 태그, 해상도, 날짜, 그룹 기반 검색
- 프롬프트 목록, 프롬프트 그룹, wildcard 탐색
- 감시 폴더와 백업 소스 기반 파일 등록
- 휴지통/삭제 보호, trusted mode, 권한 기반 운영

### 생성과 워크플로우

- ComfyUI / NovelAI 생성 요청과 생성 큐 관리
- Codex 이미지 생성 흐름
- 모듈 그래프 기반 워크플로우 편집·실행
- 실행 이력, 최종 결과, 중간 artifact explorer
- 예약 실행, 재시도, 취소, ETA/상태 추적

### 외부 연동

- MCP `POST /mcp` 엔드포인트 제공
- Claude Code, Hermes Agent 등 MCP 클라이언트 연동
- 프롬프트 검색, 이미지 조회, 생성 이력, NAI/ComfyUI 생성 도구 제공

---

## 기술 스택

| 영역 | 스택 |
| --- | --- |
| Frontend | React 19, TypeScript, Vite, React Query, Tailwind/Radix 계열 UI |
| Backend | Node.js, TypeScript, Express, better-sqlite3, sharp, ffmpeg |
| Shared | 공통 타입, 상수, 유틸 패키지 |
| Docs | VitePress + GitHub Pages |
| Integration | MCP SDK, ComfyUI API, NovelAI, 로컬 파일 시스템 |

---

## 설치와 실행

### 요구사항

- Node.js `>= 18` 권장: Node.js 22 LTS
- npm
- Windows 환경 권장

### 설치

```bash
npm install
npm run install:all
```

### 개발 서버

```bash
npm run dev
```

기본 주소:

- Backend: `http://localhost:1666`
- Frontend: `http://localhost:1677`
- MCP: `http://localhost:1666/mcp`

### 프로덕션 빌드/실행

```bash
npm run build
npm run start
```

---

## 자주 쓰는 스크립트

```bash
npm run dev                         # shared/backend/frontend 동시 개발 실행
npm run build                       # 전체 빌드
npm run docs:build                  # VitePress 문서 빌드
npm run docs:dev                    # 문서 개발 서버
npm run build:portable              # 포터블 패키지 빌드
npm run build:docker                # 도커 패키지 빌드
npm run build:all                   # 통합 + 번들 + 포터블 + 도커 빌드
npm run verify:image-similarity-contracts
npm run verify:graph-workflow-route-contracts
npm run verify:wildcard-guest-access-contracts
npm run db:reset                    # DB 초기화 후 마이그레이션
```

---

## 환경 변수와 런타임 경로

루트의 [`.env.example`](.env.example)을 기준으로 `.env`를 구성합니다.

주요 항목:

- `PORT` 기본 `1666`
- `LOCALE` 기본 `en`
- `BIND_ADDRESS` 기본 `0.0.0.0`
- `FRONTEND_URL`
- `RUNTIME_BASE_PATH` 기본 `./user`
- `RUNTIME_UPLOADS_DIR`, `RUNTIME_DATABASE_DIR`, `RUNTIME_LOGS_DIR`, `RUNTIME_MODELS_DIR`, `RUNTIME_TEMP_DIR`

기본 런타임 데이터는 `user/` 아래에 모읍니다. 기존 루트의 `uploads/`, `database/`, `logs/`, `temp/`, `RecycleBin/`, `models/` 데이터는 `user/`로 이동해 사용합니다.

---

## 프로젝트 구조

```text
CoNAI/
├─ backend/        # API 서버, DB, MCP, 생성/검색/파일 처리
├─ frontend/       # React UI
├─ shared/         # 공통 타입/상수/유틸
├─ docs/           # VitePress 사용자 문서와 릴리즈 노트
├─ scripts/        # 빌드/배포/검증 스크립트
├─ user/           # 런타임 데이터 루트(git 제외)
└─ build-output/   # 빌드 산출물(git 제외)
```

---

## 문서

- **GitHub Pages**: https://cksdnfas.github.io/CoNAI/
- **가이드 홈**: [`docs/GUIDE/`](docs/GUIDE)
- **릴리즈 노트**: [`docs/RELEASE-MD/`](docs/RELEASE-MD)
- **MCP 가이드**: [`docs/GUIDE/MCP_GUIDE.md`](docs/GUIDE/MCP_GUIDE.md)
- **워크플로우 편집**: [`docs/GUIDE/WORKFLOW_EDITOR.md`](docs/GUIDE/WORKFLOW_EDITOR.md)

문서 배포는 `.github/workflows/docs-pages.yml`에서 처리합니다. `main`에 docs 변경이 push되면 GitHub Pages로 배포됩니다.
