# CoNAI Frontend Reset Baseline

## Fixed Palette
- primary: `#F95E14`
- secondary: `#FFB59A`
- neutrals: charcoal / warm-gray scale only

## Style Reference (English)
"The Silent Curator — a premium dark editorial gallery where the interface recedes and the artwork takes the spotlight."

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
- Primary: CTA, active states, decisive emphasis only
- Secondary: gradient support, warm highlights, restrained accent support
- Neutral: layered dark surfaces, body text, spacing rhythm, gallery framing

## Hard Rules
- 추가 accent color 임의 도입 금지
- 섹션 구분용 1px 실선 border 남발 금지
- 기능 구현 전에 토큰/레이아웃 규칙 먼저 고정
- 페이지마다 다른 색/간격 체계 사용 금지
- 컴포넌트 재사용을 기본 원칙으로 유지
- shadcn 밖의 임의 UI 패턴을 먼저 만들지 말 것
- orange는 CTA/active 외 장식용으로 남용하지 말 것

## Preset Summary
- Mood: premium dark editorial gallery
- Typography: Manrope
- Surface rule: no-line + tonal layering
- Interaction: quiet hover, restrained glow, image-first composition

## Prompt Template
```text
Build a premium dark editorial gallery UI for an AI artwork workflow.
Use exact color tokens:
- primary: #F95E14
- secondary: #FFB59A
- background: #131313
- surface-lowest: #0E0E0E
- surface-low: #1C1B1B
- surface-container: #201F1F
- surface-high: #2A2A2A
- surface-highest: #353534
- foreground: #E5E2E1
- muted-foreground: #E3BFB2

Style reference:
"The Silent Curator — a premium dark editorial gallery where the interface recedes and the artwork takes the spotlight."

Constraints:
- shadcn/ui-compatible component structure
- no heavy divider lines
- use tonal layering instead of borders
- primary orange only for CTA and active states
- quiet editorial spacing and typography
- image-first composition
```
