# CoNAI Frontend Reset Baseline

이 폴더는 2026-03-21 기준으로 **기존 프론트엔드 구현을 봉인한 뒤, 새 프론트엔드를 0부터 다시 만들기 위한 최소 골격**으로 재구성되었다.

## 현재 상태
- 기존 기능 구현: 제거됨
- 목적: 새 프론트 재구축용 빈 기반 확보
- 유지한 것:
  - Vite + React + TypeScript 빌드 체인
  - Tailwind CSS 4 기반 스타일 엔트리
  - shadcn/ui 기반 컴포넌트 체계
  - React Compiler(자동 메모이제이션) 활성화
  - 백엔드 프록시 설정 (`/api`, `/uploads`, `/temp` -> `:1666`)

## 고정 기준
- 프론트 dev 포트: `1677`
- Primary: `#F95E14`
- Secondary: `#FFB59A`
- Style reference: `The Silent Curator — a premium dark editorial gallery where the interface recedes and the artwork takes the spotlight.`

## 디자인 기준 문서
- `RESET_BASELINE.md`
- `DESIGN_PRESET.md`
- `APP_ARCHITECTURE.md`

## 기술 스택
- React 19
- Vite 8
- TypeScript 5
- Tailwind CSS 4
- shadcn CLI v4 / shadcn/ui 컴포넌트 흐름
- React Compiler (`babel-plugin-react-compiler` + Vite 8 plugin-react 경로)

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
1. 디자인 프리셋 기반 컴포넌트 통일
2. 홈/상세/업로드 3개 화면의 톤 일치 검증
3. 업로드/인증/설정 순으로 MVP 복구
4. 그룹/설정 고도화/생성/워크플로우는 후순위 분리 구현
