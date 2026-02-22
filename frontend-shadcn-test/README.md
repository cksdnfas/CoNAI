# frontend-shadcn-test

ComfyUI Image Manager용 **분리형 shadcn/ui 테스트 프론트엔드**입니다.

## 목적
- 기존 `frontend`(MUI 기반)와 완전히 분리된 테스트 프론트엔드 제공
- 기존 `backend`(`:1666`)에 연결하여 UI/연동 검증
- 경로/포트/스크립트 충돌 방지

## 핵심 분리 정책
- 기존 프론트: `frontend` (dev port `5555`)
- 테스트 프론트: `frontend-shadcn-test` (dev port `5666`, `strictPort=true`)
- 백엔드: `backend` (port `1666`)

## 실행
```bash
# 1) 백엔드 실행 (프로젝트 루트)
npm run dev:backend

# 2) 테스트 프론트 실행 (프로젝트 루트)
npm run dev:frontend:shadcn
```

또는:
```bash
cd frontend-shadcn-test
npm install
npm run dev
```

## API 연결 방식
- Vite dev origin: `http://localhost:5666`
- Vite proxy
  - `/api` -> `http://localhost:1666`
  - `/uploads` -> `http://localhost:1666`
  - `/temp` -> `http://localhost:1666`
- 선택 옵션: `VITE_BACKEND_URL` 지정 시 axios baseURL override 가능

## 현재 마이그레이션 상태
- `frontend-shadcn-test`는 기능 동등성 유지를 위해 legacy 페이지를 부분 재사용하는 **Parity Hybrid** 모드입니다.
- 현재 `frontend/src` 직접 참조는 **0개 파일, 0개 import**로 정리했습니다.
- 대신 parity 안정성을 위해 `frontend-shadcn-test/src/legacy`에 legacy 소스를 내부 편입해 참조로 전환했습니다.
- shadcn으로 전환 완료된 상위 화면:
  - 인증(`/login`) 및 보호 라우트
  - 상단 앱 셸(네비게이션/로그아웃/테마 토글)
  - Image Groups 상위 페이지(탭/플로팅 생성 버튼/피드백 알림 컨테이너)
  - Upload 상위 페이지
  - Image Detail 상위 페이지(다운로드/해시복사/메타데이터 컨테이너)
- `src`는 `src/legacy`를 직접 참조하며, 중간 entrypoint 레이어 없이 페이지/컴포넌트를 바로 연결합니다.

## 안정화(하이브리드 하드닝)
- Vite `resolve.dedupe` 적용: `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`
- Vite `server.fs.allow` 적용: `../shared/src` 외부 소스 허용
- Vite `base: './'` 적용: 기존 포터블/상대 경로 배포 방식과 정렬
- legacy `frontend/src/index.css` 전역 import 제거: Tailwind/shadcn 스타일 충돌 리스크 축소
- legacy 컴포넌트 의존 패키지들을 `frontend-shadcn-test/package.json`에 명시
- `AuthContext`/`ThemeContext`/`authApi`를 `frontend-shadcn-test/src` 내부 구현으로 이동
- 공통 타입/유틸 일부(`types/image`, `utils/backend`, `services/image-api`, `services/settings-api`)를 분리 프론트 내부로 이동
- 그룹 API/훅 일부(`services/group-api`, `hooks/use-groups`, `hooks/use-image-list-settings`)를 분리 프론트 내부로 이동
- Image Groups UI 일부(`group-breadcrumb`, `group-card`, `image-view-card`, `auto-folder-*`)를 분리 프론트 내부 구현으로 이동
- Home 이미지 로딩/검색 훅(`hooks/use-infinite-images`, `hooks/use-paginated-images`, `hooks/use-search`)을 분리 프론트 내부 구현으로 이동
- Settings는 `src/features/settings/settings-page.tsx` 실구현으로 전환했고 세부 패널을 `src/legacy`에서 직접 연결합니다.
- Image Generation은 로컬 탭 셸(`features/image-generation/image-generation-page.tsx`)을 유지하고 탭을 `src/legacy/pages/ImageGeneration/*`로 직접 연결합니다.
- i18n 부트스트랩을 분리 프론트 내부(`src/i18n`)로 이동하고 parity app에서 로컬 i18n을 사용
- Group Create/Edit modal을 분리 프론트 내부(`group-create-edit-modal`, `basic-info-tab`, `auto-collect-tab`, `simple-search-tab`, `search-auto-complete`)로 이동
- Group Image modal을 분리 프론트 내부(`group-image-grid-modal`, `group-assign-modal`, `lora-dataset-dialog`) 구현으로 이동
- Home/Settings/ImageList용 `features/legacy-pages.tsx` 브리지를 제거
- Workflow 라우트(`new/edit/generate`)는 `features/workflows/*`에서 직접 컨테이너 구현/연결로 유지
- Upload 관련 로직(`upload-api`, `UploadZone`, `PromptPreview`, `metadata-reader`, `stealth-png-extractor`)을 분리 프론트 내부로 이동
- Image Detail의 `PromptDisplay` 스택(`prompt-display`, `auto-tag-display`, `prompt-card`, `prompt-grouping`)을 분리 프론트 내부로 이동

## 화면 구성
- 현재는 **기능 동등성 우선(Parity Hybrid)** 단계입니다.
- shadcn 기반 상단 셸/로그인/보호 라우트를 사용하고, 핵심 기능 페이지는 기존 `frontend` 페이지를 연결해 기능을 유지합니다.

### Parity Hybrid 라우트
- `/` : Home (기존 HomePage 연결)
- `/image-groups` : shadcn 상위 페이지 + 기존 그룹 기능 컴포넌트 연결
- `/upload` : shadcn 상위 페이지 + 분리 프론트 내부 업로드/프롬프트 컴포넌트 연결
- `/settings` : 설정
- `/image/:compositeHash` : shadcn 상위 페이지 + 기존 프롬프트/태깅 컴포넌트 연결
- `/image-generation` : shadcn 탭 컨테이너 + 기존 생성 탭 컴포넌트 연결
- `/image-generation/new` : 워크플로우 신규
- `/image-generation/:id/edit` : 워크플로우 수정
- `/image-generation/:id/generate` : 워크플로우 실행

### 인증
- `/login` : shadcn 기반 로그인 화면
- 인증 상태/세션은 기존 백엔드 auth API와 동일하게 사용

## 다음 마이그레이션 슬라이스
- 1순위: 라우트/탭 실구현을 `src/features`로 순차 이관하고 `src/legacy` 직접 의존을 줄이기
- 분해 순서:
  - Image Generation 탭(`nai/comfyui/wildcards`)을 `src/features/image-generation` 실구현으로 이관
  - Workflow 페이지(`new/edit/generate`)를 `src/features/workflows` 실구현으로 이관
  - Workflow/Group modal의 `src/legacy/components` 의존을 로컬 컴포넌트로 대체
- 목표: `src/legacy` 의존 **0개**
