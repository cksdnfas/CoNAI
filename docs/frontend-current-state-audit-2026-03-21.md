# CoNAI 프론트엔드 현재 상태 감사 문서

작성일: 2026-03-21
대상 경로: `D:/Share/0_DEV/Management/Deploy/CoNAI/frontend`
목적: 현행 프론트엔드 영역을 완전 재구축하기 전에, 현재 구조/기능/기술스택/리스크를 기록하고 안전하게 봉인·초기화할 기준을 남긴다.

## 1) 한눈에 보는 결론

현재 프론트엔드는 **단순 뷰어 수준이 아니라, 인증/갤러리/그룹/업로드/이미지 상세/생성/워크플로우/설정**까지 포함한 꽤 큰 SPA다.

핵심 특징:
- React 19 + Vite 8 + TypeScript 5 + Tailwind CSS 4 기반
- `HashRouter` 기반 단일 앱
- 백엔드(`:1666`)와 강결합된 API 프론트
- 이미지 관리와 생성 워크플로우가 한 앱 안에 공존
- 일부 코드는 shadcn/ui 스타일 체계로 정리되어 있지만, 기능적으로는 과거 마이그레이션 흔적(bridge 계층, README 불일치)이 남아 있음

즉, 이번 작업은 **'예쁜 리팩토링'이 아니라 사실상 프론트 제품을 재시작하는 수준**으로 보는 게 맞다.

---

## 2) 실제 기술 스택

### 런타임 / 빌드
- React `19.2.4`
- React DOM `19.2.4`
- TypeScript `~5.9.3`
- Vite `^8.0.0`
- `@vitejs/plugin-react`
- Tailwind CSS `^4.2.0`
- `@tailwindcss/vite`

### 라우팅 / 상태 / 데이터
- `react-router-dom` `^7.13.0`
- `@tanstack/react-query` `^5.90.21`
- Context 기반 인증/테마 상태 (`src/contexts`)
- 로컬 훅 다수 (`src/hooks`, `src/features/**/hooks`)

### UI / 디자인 시스템
- shadcn 스타일 컴포넌트 구조 (`src/components/ui`)
- `radix-ui`
- `lucide-react`
- `class-variance-authority`
- `clsx`
- `tailwind-merge`
- `tw-animate-css`
- `notistack`

### 도메인별 주요 라이브러리
- 워크플로우 시각화: `reactflow`, `dagre`
- 캔버스/노드 뷰: `konva`, `react-konva`
- 드래그/정렬: `@dnd-kit/*`
- 업로드: `react-dropzone`
- 마크다운 렌더링: `react-markdown`, `remark-gfm`, `rehype-raw`, `rehype-sanitize`
- 국제화: `i18next`, `react-i18next`, `i18next-browser-languagedetector`
- HTTP: `axios`
- 압축/메타데이터: `pako`, `exifr`

---

## 3) 실제 앱 엔트리와 실행 구조

### 엔트리
- `frontend/src/main.tsx`
- `frontend/src/App.tsx`
- 실제 앱 루트: `frontend/src/app/parity-app.tsx`

### 앱 공통 래퍼
- `QueryClientProvider`
- `ThemeProvider`
- `SnackbarProvider`
- `HashRouter`
- `AuthProvider`

### 공통 셸
- `frontend/src/components/layout/app-shell.tsx`
- 상단 네비게이션 + 로그아웃 + 다크모드 토글 + 백엔드 헬스 링크

### 라우팅 방식
현행 앱은 `HashRouter` 기준으로 다음 라우트를 가진다.

#### 공개 라우트
- `/login`

#### 보호 라우트
- `/`
- `/home` → `/` 리다이렉트
- `/image-groups`
- `/upload`
- `/settings`
- `/image/:compositeHash`
- `/image-generation`
- `/image-generation/new`
- `/image-generation/:id/edit`
- `/image-generation/:id/generate`

---

## 4) 영역별 기능 조사

### A. 인증 (`features/auth`)
주요 파일:
- `login-page.tsx`
- `protected-route.tsx`

기능:
- 로그인 폼
- 인증 여부에 따른 보호 라우팅
- 계정 복구 안내 다이얼로그
- 백엔드 auth DB 경로 조회

의존 API:
- `services/auth-api.ts`

---

### B. 홈 / 이미지 갤러리 (`features/home`, `features/images`)
주요 파일:
- `features/home/home-page.tsx`
- `features/images/components/image-list.tsx`

기능:
- 홈 이미지 목록 조회
- 무한 스크롤 / 페이지네이션 전환
- 검색 모드
- 레이아웃 모드(grid/masonry) 전환
- 선택 기반 벌크 액션
- 새로고침

연관 훅:
- `use-infinite-images`
- `use-paginated-images`
- `use-search`
- `use-image-list-settings`

의존 API:
- `services/image-api.ts`
- 일부 설정 API 연동

---

### C. 이미지 그룹 관리 (`features/image-groups`)
파일 수: 27

핵심 기능:
- 커스텀 그룹 탐색
- 오토 폴더 그룹 탐색
- breadcrumb 기반 계층 이동
- 그룹 생성/수정/삭제
- 그룹 이미지 모달/패널
- 그룹에 이미지 추가/제거
- LoRA dataset 관련 다이얼로그

주요 UI 요소:
- `group-card`
- `group-create-edit-modal`
- `group-image-grid-modal`
- `group-explorer-layout`
- `auto-folder-*`

의존 API:
- `services/group-api.ts`
- `services/auto-folder-groups-api.ts`
- `services/folder-api.ts`

---

### D. 업로드 (`features/upload`)
주요 파일:
- `upload-page.tsx`
- `components/upload-zone.tsx`
- `components/prompt-preview.tsx`

기능:
- 파일 드롭/선택 업로드
- 업로드 후 이미지 쿼리 invalidation
- 프롬프트 및 메타데이터 미리보기

의존 API:
- `services/upload-api.ts`
- 메타데이터 유틸

---

### E. 이미지 상세 (`features/image-detail`)
주요 파일:
- `image-detail-page.tsx`
- `components/prompt-display/*`

기능:
- 이미지/비디오 미리보기
- 다운로드
- 해시 복사
- 파일 정보/AI 메타데이터 표시
- 그룹 소속 표시
- 프롬프트/네거티브 프롬프트 표시
- 자동 태깅 결과 반영
- 전체 메타데이터 raw JSON 표시
- NAI 캐릭터 프롬프트 구조 일부 해석

의존 API:
- `services/image-api.ts`
- `services/settings-api.ts`

---

### F. 이미지 생성 (`features/image-generation`)
파일 수: 29

상위 탭:
- NAI
- ComfyUI
- Wildcards

#### F-1. NAI
주요 구성:
- `nai/components/*`
- `nai/hooks/*`
- `bridges/use-nai-generation.ts`
- `nai-api.ts`

기능:
- NAI 로그인/생성 흐름
- 기본 설정 / 샘플링 / 출력 설정
- 캐릭터 프롬프트
- 입력 이미지
- 그룹 선택
- ANLAS 표시

#### F-2. ComfyUI
주요 파일:
- `tabs/comfyui-tab.tsx`
- 워크플로우 기능과 강연결

기능:
- ComfyUI 워크플로우 실행 진입점
- 서버/히스토리/반복 실행 UI와 결합

#### F-3. Wildcards
주요 구성:
- `wildcards/components/*`
- `wildcard-api.ts`

기능:
- 와일드카드 트리/상세/삭제 확인

비고:
- `bridges/` 디렉터리 존재는 과거 전환/호환 계층 흔적을 의미함.

---

### G. 워크플로우 (`features/workflows`)
파일 수: 37

기능 범위:
- 워크플로우 생성/수정
- JSON 업로드/편집
- 그래프 뷰/JSON 뷰
- marked fields 관리
- 서버 선택/상태 표시
- 반복 실행
- 그룹 지정
- 생성 이력 표시

주요 페이지:
- `workflow-form-page.tsx`
- `workflow-generate-page.tsx`

주요 컴포넌트:
- `enhanced-workflow-graph-viewer`
- `workflow-json-viewer`
- `generation-history-list`
- `server-status-list`
- `repeat-controls`
- `marked-fields/*`

의존 API:
- `services/workflow-api.ts`
- `services/comfyui-server-api.ts`
- `services/generation-history-api.ts`
- `services/background-queue-api.ts`

이 영역은 사실상 별도 제품 수준의 복잡도를 가진다.

---

### H. 설정 (`features/settings`)
파일 수: 20

탭:
- General
- Folders
- Tagger
- Prompts
- Rating
- Similarity
- Account
- Civitai

현황:
- 일부는 로컬 컴포넌트화되어 있음
- 일부는 `bridges/` 계층을 통해 연결됨

주요 로컬 패널:
- `general-settings-panel`
- `tagger-settings-panel`

bridge 잔존 영역:
- rating / similarity / folders / auth / external api / civitai / prompt explorer

의존 API:
- `services/settings-api.ts`

---

### I. 국제화 (`src/i18n`)
지원 로케일:
- `en`
- `ja`
- `ko`
- `zh-CN`
- `zh-TW`

네임스페이스 예시:
- `auth`
- `common`
- `imageDetail`
- `imageGeneration`
- `imageGroups`
- `settings`
- `upload`
- `wildcards`
- `workflows`

즉, 현재 앱은 이미 다국어 구조까지 갖춘 상태다.

---

## 5) 서비스(API) 레이어 조사

`frontend/src/services`

확인된 서비스:
- `auth-api.ts`
- `auto-folder-groups-api.ts`
- `background-queue-api.ts`
- `comfyui-server-api.ts`
- `custom-dropdown-list-api.ts`
- `file-verification-api.ts`
- `folder-api.ts`
- `generation-history-api.ts`
- `group-api.ts`
- `image-api.ts`
- `image-editor-api.ts`
- `nai-api.ts`
- `prompt-api.ts`
- `settings-api.ts`
- `tagger-batch-api.ts`
- `upload-api.ts`
- `wildcard-api.ts`
- `workflow-api.ts`

의미:
- 현 프론트는 단순 정적 UI가 아니라 **백엔드 업무 기능과 1:1로 연결된 운영 도구형 프론트**다.

---

## 6) 현재 구조상 특이사항 / 리스크

### 6-1. README와 실제 구조 불일치
`frontend/README.md`에는 다음 진술이 남아 있다.
- Parity Hybrid
- `src/legacy` 직접 참조
- dev port `5666`

하지만 실제 조사 결과:
- `frontend/src/legacy` 폴더는 없음
- 실제 `vite.config.ts` 기본 포트는 `1677`
- bridge/legacy 마이그레이션 문구는 일부 구버전 설명으로 보임

즉, **문서가 최신 실제 상태를 완전히 반영하지 않는다.**

### 6-2. bridge 흔적 존재
현재도 다음과 같은 흔적이 있음:
- `features/image-generation/bridges/*`
- `features/settings/bridges/*`

이는 완전한 일체형 재설계 전, 중간 호환 계층이 남아 있다는 뜻이다.

### 6-3. 프론트 범위가 너무 큼
한 앱 안에 다음이 같이 들어 있음:
- 갤러리
- 그룹 관리
- 업로드
- 이미지 상세
- NAI 생성
- ComfyUI 워크플로우
- 와일드카드
- 설정
- 인증

새 프론트를 0부터 다시 만들려면, 이 범위를 먼저 제품 단위로 잘라서 우선순위를 잡아야 한다.

---

## 7) 현재 프론트 재구축 시 추천 분리 단위

### 1차 MVP로 분리 추천
1. 인증
2. 앱 셸
3. 홈/이미지 리스트
4. 이미지 상세
5. 업로드

### 2차
6. 이미지 그룹
7. 설정

### 3차
8. 이미지 생성(NAI)
9. Wildcards
10. 워크플로우/ComfyUI

이유:
- 워크플로우/생성 계열이 복잡도 최고
- 리스트/상세/업로드 먼저 복원하면 사용자 가치가 즉시 살아남

---

## 8) 완전 초기화 시 보존 대상 / 폐기 대상 기준

### 보존 권장
- 현행 전체 `frontend/` 소스 봉인본
- 현재 git 스냅샷 커밋
- 본 감사 문서
- 현행 라우트/기능 목록
- API 서비스 파일 목록

### 폐기/초기화 가능
- 현행 `frontend/src` 구현 전체
- 임시 로그 파일
  - `.tmp-dev.log`
  - `lint.log`
  - `lint2.log`
  - `lint3.log`
- 빌드 산출물 `frontend/dist`
- 재설치 가능한 의존성 캐시 `frontend/node_modules`

### 유지 권장(초기 골격에 맞춰 재사용 가능)
- `vite.config.ts`의 백엔드 프록시 설정 아이디어
- workspace 구조(`frontend`, `backend`, `shared`)
- 필요 시 `HashRouter` 채택 여부

---

## 9) 실제 재시작 준비 상태 판단

현 프론트는 단순히 정리할 문제가 아니라, 다음 중 하나를 선택해야 하는 상태다.

### 선택지 A. 기존 기술스택 유지 + UI/구조만 완전 재설계
- React/Vite/TS/Tailwind 유지
- 도메인별 기능만 순차 재구축
- 백엔드 API 계약은 최대한 유지

### 선택지 B. 프론트 제품 자체를 새 아키텍처로 재정의
- 라우트/정보구조/상태모델부터 다시 설계
- 필요 시 BFF 또는 프런트 도메인 분리

이번 요청 기준으로는 **A 방식으로 빈 골격을 준비하고, 구현은 0부터 다시 시작하는 것이 가장 현실적**이다.

---

## 10) 이번 정리 작업에서 권장되는 실제 액션

1. 현재 상태 스냅샷 커밋
2. 현행 `frontend/`를 별도 폴더에 압축 봉인
3. 현행 프론트 소스/로그/산출물 제거
4. 동일 경로에 새 `frontend/` 최소 골격 재생성
5. 루트 워크스페이스/백엔드 연동은 유지
6. 새 프론트 시작점용 README와 구조 가이드 작성

---

## 11) 요약

현재 CoNAI 프론트엔드는 다음과 같다.
- 대형 단일 React 앱
- 이미지 관리 + 생성 워크플로우 도구
- 다국어/인증/설정/업로드/생성/그룹까지 포함
- 일부 마이그레이션 흔적과 문서 불일치 존재

따라서 이번 리셋은 정리 수준이 아니라,
**'현행 제품을 안전하게 봉인한 뒤, 같은 프로젝트 안에 새 프론트 골격을 다시 세우는 작업'**으로 진행하는 것이 맞다.
