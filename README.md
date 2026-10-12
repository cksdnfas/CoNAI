<div align="center">

# CoNAI

**이미지·영상·생성물을 관리하고, 지식을 축적하며, AI 어시스턴트로 작업을 이어가는 개인화 앱**

[![Docs](https://img.shields.io/badge/docs-GitHub%20Pages-2ea44f?style=for-the-badge)](https://cksdnfas.github.io/CoNAI/)
[![Release](https://img.shields.io/badge/release-26.10.10-4f46e5?style=for-the-badge)](docs/RELEASE-MD/RELEASE_26.10.10.md)
[![Node](https://img.shields.io/badge/node-%3E%3D22.13.0-339933?style=for-the-badge)](package.json)
[![Docs Deploy](https://img.shields.io/github/actions/workflow/status/cksdnfas/CoNAI/docs-pages.yml?branch=main&label=pages&style=for-the-badge)](https://github.com/cksdnfas/CoNAI/actions/workflows/docs-pages.yml)

[📘 GitHub Pages 문서](https://cksdnfas.github.io/CoNAI/) · [🚀 처음 시작하기](https://cksdnfas.github.io/CoNAI/GUIDE/START_HERE.html) · [🧩 MCP 가이드](https://cksdnfas.github.io/CoNAI/GUIDE/MCP_GUIDE.html) · [📝 26.10.10 릴리즈 노트](docs/RELEASE-MD/RELEASE_26.10.10.md)

</div>

---

## 뭐 하는 앱인가

CoNAI는 이미지·영상·생성물 관리를 기반으로 지식을 축적하고 작업을 자동화하는 앱입니다. 공개 배포하며, 혼자 또는 소수의 사용자가 자기 환경에 맞춰 사용하는 것을 중심으로 설계합니다.

미디어 등록·검색·분류·생성 기반 위에 채팅, 페이지 어시스턴트, 파일과 게시글/지식, 작업 자동화를 연결하고 있습니다. 앞으로의 개발은 웹 전체 기능의 어시스턴트 연결, MCP 도구 개선, 대량 콘텐츠의 성능과 사용감, 유지보수에 집중합니다. 모든 기능의 AI 연결이 완료된 상태는 아니며 실제 지원 범위는 각 사용자 가이드에서 확인합니다.

개발을 시작할 때는 [AI 개발 가이드](AI_Guidelines.md)와 [개발 구조·코드 연결 지점](DEVELOPMENT.md)을 먼저 읽습니다.

---

## 26.10.10 릴리즈

- 채팅: 어느 페이지에서든 여는 채팅 패널, Codex·Claude Code·API LLM 엔진, 캐릭터 프로필·그룹 방·로어북, 대화 중 이미지 생성과 페이지 입력 보조
- 오디오: 프로젝트·그룹별 효과음 생성, 듣고 채택·편집, 음량 정규화 내보내기
- 비디오: 영상에서 스프라이트 시트 추출·일괄 처리, 채팅 모델의 영상 프레임 보기
- LLM 연결: 서버 ▸ 모델 구조, 생성 옵션은 프로필로 이동, 역할별 모델, CLI 관리와 사용량 대시보드
- 그 밖에: 게시판, 파일 보관함, 워크플로우 노드 편집기 개편, 18개 기능 키 권한 체계

자세한 내용은 [`docs/RELEASE-MD/RELEASE_26.10.10.md`](docs/RELEASE-MD/RELEASE_26.10.10.md)에서 확인합니다.

---

## 빠른 링크

| 항목 | 링크 |
| --- | --- |
| 사용자 문서 | https://cksdnfas.github.io/CoNAI/ |
| 가이드 목록 | https://cksdnfas.github.io/CoNAI/GUIDE/ |
| 설치와 실행 | https://cksdnfas.github.io/CoNAI/GUIDE/INSTALLATION.html |
| Docker로 실행 | https://cksdnfas.github.io/CoNAI/GUIDE/DOCKER.html |
| 이미지 생성 개요 | https://cksdnfas.github.io/CoNAI/GUIDE/GENERATION_OVERVIEW.html |
| 워크플로우 편집 | https://cksdnfas.github.io/CoNAI/GUIDE/WORKFLOW_EDITOR.html |
| MCP 가이드 | https://cksdnfas.github.io/CoNAI/GUIDE/MCP_GUIDE.html |
| 최신 안정 릴리즈 | [GitHub Release 26.10.10](https://github.com/cksdnfas/CoNAI/releases/tag/26.10.10) |
| 26.10.10 릴리즈 노트 | [`docs/RELEASE-MD/RELEASE_26.10.10.md`](docs/RELEASE-MD/RELEASE_26.10.10.md) |
| 전체 릴리즈 노트 | [`docs/RELEASE-MD/`](docs/RELEASE-MD) |

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

- 설정 → 계정 및 시스템에서 API 키 인증 MCP `POST /mcp` 활성화
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

- Node.js `>= 22.13.0` (`package.json`의 engines 기준)
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
- MCP: 설정에서 활성화 후 `http://localhost:1666/mcp`

### 프로덕션 빌드/실행

```bash
npm run build
npm run start
```

### Docker로 실행

Node.js 설치 없이 컨테이너 하나로 실행합니다. 기본 이미지는 **CPU 전용**입니다.

```bash
docker compose up -d --build        # http://localhost:1666
```

NVIDIA GPU는 별도 빌드로 선택합니다. CUDA 빌드는 `compose.gpu.yaml`의 `TORCH_BACKEND` 인자를 사용하며 환경 변수 `CONAI_TORCH_BACKEND`로 선택합니다. GPU·드라이버별 선택은 [Docker 가이드](docs/GUIDE/DOCKER.md)를 참고합니다.

```bash
docker compose -f compose.yaml -f compose.gpu.yaml up -d --build
```

| 확인할 것 | 내용 |
| --- | --- |
| 데이터 | `conai-data` 볼륨 → `/app/data/user` |
| 첫 관리자 | 컨테이너 안에서 `POST http://127.0.0.1:1666/api/auth/setup`으로 생성 |
| 감시 폴더 | 호스트 폴더를 볼륨으로 마운트하고 컨테이너 경로로 등록 |
| 프록시 없이 공개 | `TRUST_PROXY=false` 설정 |
| GPU 확인 | `docker compose exec conai /opt/conai-ai/bin/python -c "import torch; print(torch.cuda.is_available())"` |

GPU 확인, Coolify 배포 설정, 환경 변수는 [Docker로 실행 가이드](https://cksdnfas.github.io/CoNAI/GUIDE/DOCKER.html)에 정리돼 있습니다.

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

- **개발 기준**: [AI_Guidelines.md](AI_Guidelines.md)
- **개발 구조와 AI 연결**: [DEVELOPMENT.md](DEVELOPMENT.md)
- **GitHub Pages**: https://cksdnfas.github.io/CoNAI/
- **가이드 홈**: [`docs/GUIDE/`](docs/GUIDE)
- **릴리즈 노트**: [`docs/RELEASE-MD/`](docs/RELEASE-MD)
- **Docker 가이드**: [`docs/GUIDE/DOCKER.md`](docs/GUIDE/DOCKER.md)
- **MCP 가이드**: [`docs/GUIDE/MCP_GUIDE.md`](docs/GUIDE/MCP_GUIDE.md)
- **워크플로우 편집**: [`docs/GUIDE/WORKFLOW_EDITOR.md`](docs/GUIDE/WORKFLOW_EDITOR.md)

문서 배포는 `.github/workflows/docs-pages.yml`에서 처리합니다. `main`에 docs 변경이 push되면 GitHub Pages로 배포됩니다.
