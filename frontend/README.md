# CoNAI Frontend Reset Baseline

이 폴더는 2026-03-21 기준으로 **기존 프론트엔드 구현을 봉인한 뒤, 새 프론트엔드를 0부터 다시 만들기 위한 최소 골격**으로 재구성되었다.

## 현재 상태
- 기존 기능 구현: 제거됨
- 목적: 새 프론트 재구축용 빈 기반 확보
- 유지한 것:
  - Vite + React + TypeScript 빌드 체인
  - Tailwind CSS 4 기반 스타일 엔트리
  - shadcn/ui 스타일 컴포넌트 시작점
  - 백엔드 프록시 설정 (`/api`, `/uploads`, `/temp` -> `:1666`)

## 디자인 베이스라인
- Primary: `#2563EB`
- Secondary: `#14B8A6`
- Style reference: `Clean, modern operator dashboard with crisp typography, disciplined spacing, and restrained accent usage.`

상세 규칙은 `RESET_BASELINE.md` 참고.

## 실행
```bash
cd frontend
npm run dev
```

또는 프로젝트 루트에서:
```bash
npm run dev:frontend
```

## 다음 권장 작업
1. 정보구조(IA) 확정
2. 라우트 맵 정의
3. 공통 앱 셸 설계
4. 인증/홈/상세/업로드 순으로 MVP 재구축
5. 그룹/설정/생성/워크플로우는 후순위 분리 구현
