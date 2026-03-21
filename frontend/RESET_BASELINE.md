# CoNAI Frontend Reset Baseline

## Fixed Palette
- primary: `#2563EB`
- secondary: `#14B8A6`
- neutrals: white / black / gray scale only

## Style Reference (English)
"Clean, modern operator dashboard with crisp typography, disciplined spacing, reusable components, and restrained accent usage."

## Project Stack
- React 19.2.4
- Vite 8.0.1
- TypeScript 5.9.3
- Tailwind CSS 4.2.2
- shadcn CLI 4.1.0
- React Compiler 1.0.0

## Runtime / Tooling Rules
- Use shadcn/ui-style component generation as the default UI path.
- Keep React Compiler enabled unless a specific incompatibility is proven.
- Prefer compiler-friendly React patterns; avoid premature manual memoization.
- Preserve backend proxy contract on port `1666`.
- Frontend dev server port is fixed to `1677`.

## Role Rules
- Primary: CTA, active states, high-emphasis actions
- Secondary: supportive accents, informational highlights, subtle status emphasis
- Neutral: surfaces, text, borders, layout rhythm

## Hard Rules
- 추가 accent color 임의 도입 금지
- 기능 구현 전에 토큰/레이아웃 규칙 먼저 고정
- 페이지마다 다른 색/간격 체계 사용 금지
- 컴포넌트 재사용을 기본 원칙으로 유지
- shadcn 밖의 임의 UI 패턴을 먼저 만들지 말 것

## Prompt Template
```text
Build a clean and modern web UI.
Use exact color tokens:
- primary: #2563EB
- secondary: #14B8A6
- neutrals: white, black, gray scale

Style reference:
"Clean, modern operator dashboard with crisp typography, disciplined spacing, reusable components, and restrained accent usage."

Constraints:
- consistent spacing and typography hierarchy
- reusable component patterns
- clear CTA emphasis with primary color
- subtle secondary usage only
- use shadcn/ui-compatible component structure
```
