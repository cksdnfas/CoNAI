# CoNAI Frontend App Architecture (Phase 1)

작성일: 2026-03-21

## 목적
새 프론트엔드를 한 번에 전부 되살리지 않고, **앱 구조를 먼저 고정한 뒤 MVP를 순차 복구**하기 위한 기준 문서다.

## 고정 원칙
- 프론트 dev 포트: `1677`
- 백엔드 프록시: `/api`, `/uploads`, `/temp` -> `http://localhost:1666`
- UI 기본 경로: shadcn/ui 스타일 컴포넌트
- React Compiler 활성화 유지
- 색상 토큰은 `primary #2563EB`, `secondary #14B8A6`만 핵심 accent로 사용

## Phase 1 라우트 맵

### Public
- `/login`
  - 목적: 인증 진입점 자리 확보
  - 상태: 플레이스홀더 페이지

### App Shell 내부
- `/`
  - 목적: 홈 / 이미지 피드 MVP
  - 상태: 실제 API 연동
- `/images/:compositeHash`
  - 목적: 이미지 상세 MVP
  - 상태: 실제 API 연동
- `/upload`
  - 목적: 업로드 화면 자리 확보
  - 상태: 플레이스홀더 페이지
- `/settings`
  - 목적: 설정 화면 자리 확보
  - 상태: 플레이스홀더 페이지

### Fallback
- `*`
  - 목적: 404 처리

## 이번 단계에서 구현하는 것
1. QueryClient + RouterProvider 복구
2. App Shell 구현
3. Home MVP 구현
4. Image Detail MVP 구현
5. Upload / Settings / Login 플레이스홀더 제공

## 이번 단계에서 의도적으로 안 하는 것
- 이미지 그룹
- 생성(NAI)
- 워크플로우 / ComfyUI
- 고급 검색
- 인증 로직 완전 복구
- 다국어/i18n 복구

## 홈 MVP 범위
- `/api/images?page=1&limit=12` 호출
- 로딩 / 에러 / 빈 상태 처리
- 이미지 카드 그리드
- 카드 클릭 시 상세 이동
- 최소 메타정보 표시

## 상세 MVP 범위
- `/api/images/:compositeHash` 호출
- 대표 이미지 표시
- 파일/해시/크기/모델명 등 핵심 메타 표시
- 원본 열기

## 다음 단계 우선순위
1. Upload MVP 실제 연결
2. Settings 기본 탭 구조 복구
3. Auth 상태 복구
4. Home 검색/필터/페이지네이션 강화
5. Image Groups 복구
6. Generation / Workflow 복구
