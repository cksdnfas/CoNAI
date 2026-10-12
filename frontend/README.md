# CoNAI Frontend

React·TypeScript 기반의 CoNAI 웹 앱이다. 미디어·생성·파일·게시글/지식·채팅·설정 화면과 앱 전역 채팅 패널을 제공한다. 개발 방향은 채팅 어시스턴트의 화면 기능 연결과 대량 콘텐츠의 성능·사용감 개선이다.

## 수정 전에

1. [프로젝트 개발 가이드](../AI_Guidelines.md)
2. [프론트 구조](APP_ARCHITECTURE.md)
3. UI 변경 시 [디자인 기준](DESIGN_PRESET.md)
4. AI 연결 변경 시 [공유 계약과 서버 연결 지점](../DEVELOPMENT.md)

## 실행과 검증

루트에서 `npm run dev`로 shared/backend/frontend를 함께 실행한다. 프론트만 실행하려면 `npm run dev:frontend`를 사용한다. 기본 dev 포트는 `1677`이며 프록시 대상과 포트 설정은 `vite.config.ts`를 확인한다.

이 폴더에서 `npm run typecheck`, `npm run lint`, `npm run build`를 사용할 수 있다. 변경 범위에 필요한 검사만 선택한다.

스택은 React, Vite, Tailwind CSS, TanStack Query, React Router와 공용 UI 컴포넌트다. 정확한 버전은 `package.json`과 루트 lockfile을 따른다. React Compiler 설정은 `vite.config.ts`에서 관리한다.
