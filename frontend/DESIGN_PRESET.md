# CoNAI Design Preset — The Silent Curator

작성일: 2026-03-21
기준 레퍼런스: 사용자 제공 홈페이지 시안 + Design System Strategy `The Silent Curator`

## Creative North Star

CoNAI의 프론트엔드는 **시끄러운 대시보드**가 아니라,
AI 결과물을 조용히 전면에 세우는 **하이엔드 다크 갤러리**처럼 보여야 한다.

핵심 문장:
> A premium dark editorial gallery for AI artwork where the interface recedes and the content takes the spotlight.

---

## Fixed Palette

- primary: `#F95E14`
- secondary: `#FFB59A`
- neutrals: charcoal / warm-gray 계열만 사용

### Surface Tokens
- background / surface: `#131313`
- surface-lowest: `#0E0E0E`
- surface-low: `#1C1B1B`
- surface-container: `#201F1F`
- surface-high: `#2A2A2A`
- surface-highest: `#353534`
- surface-bright: `#393939`
- foreground: `#E5E2E1`
- muted-foreground: `#E3BFB2`
- outline-variant: `#5A4138`

---

## Core Aesthetic Rules

### 1. No-Line Rule
- 1px 실선 border로 섹션을 나누지 않는다.
- 구분은 **배경 톤 차이**, **레이어**, **여백**으로 만든다.
- 접근성 때문에 선이 꼭 필요할 때만 `outline-variant` 15% opacity를 사용한다.

### 2. Atmospheric Layering
- 카드는 선이 아니라 **톤 차이**로 떠 있어야 한다.
- recessed 영역은 `surface-lowest`
- 기본 카드/플린스는 `surface-low` 또는 `surface-container`
- hover/active는 `surface-high` 또는 `surface-bright`

### 3. Orange Discipline
- primary orange는 CTA와 active state에만 쓴다.
- 화면의 5% 이상이 주황으로 느껴지지 않게 유지한다.
- decorative orange 사용 금지.

### 4. Editorial Spacing
- 공간이 충분해 보이면, 한 번 더 벌린다.
- 이 시스템은 촘촘한 업무용 툴이 아니라 **숨 쉬는 갤러리형 작업 UI**를 지향한다.

---

## Typography

- Primary font: `Manrope`
- tone: precise, quiet, editorial

### Hierarchy
- Display / Hero: 강한 weight + 약간의 negative tracking
- Headline: 명확하고 짧게
- Body: pure white 금지, `foreground` 사용
- Labels / metadata: `muted-foreground` 사용

---

## Shape / Radius / Depth

- radius default: 작게 유지 (`rounded-sm` ~ `rounded-lg` 범위)
- 기본 감성은 sharp + subtle roundness
- 전통적인 drop shadow 대신 soft ambient shadow 사용
- hover 시 scale보다 **조용한 lift**가 우선

---

## Component Rules

### Button
- Primary:
  - gradient fill (`secondary -> primary`)
  - dark text
  - strongest emphasis
- Secondary:
  - ghost border 느낌
  - 배경 최소화
- Tertiary:
  - text only / underline on hover

### Card
- border 중심 금지
- `surface-low` / `surface-container` 기반
- 카드가 아니라 “전시 받침대(plinth)”처럼 느껴져야 한다

### Inputs
- recessed tray 느낌
- `surface-lowest` 사용
- 포커스는 두꺼운 border 대신 tone shift + subtle accent

### Chips
- 작은 메타데이터 조각처럼 보이게
- `surface-highest` 배경 + muted text
- 너무 pill스럽게 둥글지 않게

### Navigation
- floating glass bar 느낌
- background 70% opacity + blur
- active는 주황 포인트로만 처리

---

## Homepage Direction

홈페이지는 “운영 대시보드”보다 “큐레이티드 피드”에 가까워야 한다.

### Must keep
- 상단 floating nav
- 강한 hero headline
- 필터 칩 / 정렬 / 검색의 조용한 존재감
- 피드 자체가 주인공

### Feed rules
- masonry or gallery-like rhythm 우선
- 카드보다는 이미지가 먼저 보여야 함
- hover overlay는 허용하되 과하지 않게
- 액션은 좋아요/열기/다운로드 수준의 최소 표시

---

## Do / Don't

### Do
- 레이어 차이로 깊이 만든다
- negative space를 아끼지 않는다
- active / CTA만 강하게 강조한다
- UI보다 이미지가 먼저 보이게 한다

### Don’t
- 밝은 SaaS형 대시보드 톤으로 가지 않는다
- 섹션마다 border 박스 쳐두지 않는다
- orange를 장식처럼 남발하지 않는다
- 모든 화면을 동일 밀도의 폼 UI처럼 만들지 않는다

---

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
"The Silent Curator — a premium dark gallery where the interface recedes and the artwork takes the spotlight."

Constraints:
- shadcn-compatible component structure
- no heavy divider lines
- use tonal layering instead of borders
- primary orange only for CTA and active states
- quiet editorial spacing and typography
- image-first composition
```
