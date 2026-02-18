# ComfyUI Image Manager

ComfyUI / NovelAI / Stable Diffusion 생성 이미지를 통합 관리하고, 프롬프트 검색·분석·생성 이력 추적까지 지원하는 로컬 기반 이미지 매니저입니다.

> 현재 브랜치는 **v3.0.1 개발 준비 단계**로, 본 README는 이후 기능 개발을 위한 기준 문서입니다.

---

## 1) 프로젝트 개요

- **프로젝트명**: ComfyUI Image Manager
- **아키텍처**: Monorepo (frontend / backend / shared)
- **런타임**: Node.js 18+
- **기본 백엔드 포트**: `1666`
- **프론트 개발 서버 포트**: `1677`

### 핵심 가치

- AI 생성 이미지 메타데이터 자동 추출
- 대규모 이미지 탐색/검색/필터링
- 그룹 기반 정리 및 다운로드
- MCP 연동을 통한 외부 AI 클라이언트 제어

---

## 2) 주요 기능 (v3 기준)

- **이미지/프롬프트 관리**
  - ComfyUI, NovelAI, Stable Diffusion 메타데이터 파싱
  - Positive / Negative / Auto Tags 분리 표시
  - 프롬프트 검색 및 그룹화

- **고급 이미지 조회**
  - 조건 기반 검색 (프롬프트, 모델, 해상도, 날짜 등)
  - 그룹(자동/수동) 단위 관리
  - 생성 이력 조회

- **MCP 서버 내장**
  - `/mcp` 엔드포인트 제공
  - 프롬프트 검색, 이미지 검색, ComfyUI/NAI 생성 호출 가능
  - 상세 가이드: [`docs/MCP_GUIDE.md`](docs/MCP_GUIDE.md)

- **UI/UX 개선 기반**
  - 이미지 모달 구조 개선
  - 정보 복사 UX 강화
  - 다국어 리소스 확장(ko/en/ja/zh-CN/zh-TW)

---

## 3) 기술 스택

- **Frontend**: React 19, TypeScript, Vite, MUI, React Query
- **Backend**: Node.js, TypeScript, Express, better-sqlite3
- **Shared**: 공통 타입/상수/유틸 패키지
- **기타**: ffmpeg, sharp, MCP SDK

---

## 4) 개발 환경 실행

## 사전 요구사항

- Node.js `>= 18`
- npm

## 설치

```bash
npm install
npm run install:all
```

## 개발 서버 실행

```bash
npm run dev
```

- Backend: `http://localhost:1666`
- Frontend (Vite): `http://localhost:1677`

## 프로덕션 빌드

```bash
npm run build
```

## 프로덕션 실행

```bash
npm run start
```

---

## 5) 자주 쓰는 스크립트

```bash
npm run dev                # shared/backend/frontend 동시 개발 실행
npm run build              # 전체 빌드
npm run build:portable     # 포터블 패키지 빌드
npm run build:docker       # 도커 패키지 빌드
npm run build:all          # 통합 + 번들 + 포터블 + 도커 빌드
npm run db:reset           # DB 초기화 후 마이그레이션
```

---

## 6) 환경 변수

루트의 `.env.example`를 참고하여 `.env` 구성:

- `PORT` (기본: 1666)
- `LOCALE` (기본: en)
- `BIND_ADDRESS` (기본: 0.0.0.0)
- `RUNTIME_*` 경로 옵션 (uploads/database/logs/models/temp 등)

자세한 항목: [`.env.example`](.env.example)

---

## 7) 프로젝트 구조

```text
Comfyui_Image_Manager_2/
├─ backend/        # API 서버, DB, MCP, 생성/검색 로직
├─ frontend/       # React UI
├─ shared/         # 공통 타입/상수
├─ docs/           # 가이드, 계획서, 릴리즈 문서
├─ scripts/        # 빌드/배포 스크립트
├─ database/       # SQLite DB 파일
├─ uploads/        # 이미지/미디어 저장소
└─ build-output/   # 빌드 산출물
```

---

## 8) v3.0.1 개발 진행 메모

v3.0.1은 v3.0.0 기반 안정화 및 사용성 개선 버전으로 진행합니다.

권장 작업 흐름:
1. README 기준으로 기능 범위 정렬
2. 모듈별 변경(backend/frontend/shared) 단위 커밋
3. 문서(`docs/RELEASE-MD`)와 코드 변경 동기화

참고 릴리즈: [`docs/RELEASE-MD/RELEASE_3.0.0.md`](docs/RELEASE-MD/RELEASE_3.0.0.md)

---

## 9) 문서 링크

- MCP 가이드: [`docs/MCP_GUIDE.md`](docs/MCP_GUIDE.md)
- 릴리즈 노트: [`docs/RELEASE-MD/`](docs/RELEASE-MD)
- UI/기능 계획: [`docs/plan/`](docs/plan)

---

필요 시 v3.0.1 개발 목표(우선순위/마일스톤/완료 조건) 섹션을 본 문서에 이어서 추가해 관리할 수 있습니다.
