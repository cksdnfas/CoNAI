# CoNAI Design Preset — The Silent Curator

작성일: 2026-03-21 · 구현 규칙 갱신: 2026-09-28 (shared follow-up)
기준 레퍼런스: 사용자 제공 홈페이지 시안 + Design System Strategy `The Silent Curator`

## Creative North Star

CoNAI의 프론트엔드는 **시끄러운 대시보드**가 아니라,
AI 결과물을 조용히 전면에 세우는 **하이엔드 다크 갤러리**처럼 보여야 한다.

핵심 문장:
> A premium dark editorial gallery for AI artwork where the interface recedes and the content takes the spotlight.

---

## Fixed Palette

기본값이다. 설정 > 외관(appearance system)이 런타임에 같은 토큰 이름으로 덮어쓰므로 코드에서는 hex 대신 토큰만 쓴다.

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

### Light ramp
Light은 plinth가 페이지보다 **어두워지는** 방향이다 (recessed = 흰색 tray). 단계는 CIE L* 기준 약 3.5씩:
- background `#F5F2F1` (L* 95.7) · surface-lowest `#FFFFFF` (100)
- surface-low `#EFE7E4` (92.2) · surface-container `#EBE1DD` (90.2)
- surface-high `#E2D5D0` (86.2) · surface-highest `#DAC9C3` (82.2)

Midnight / Paper light 프리셋도 같은 L* 단계를 따른다. custom 팔레트에서 low를 비워 두면 배경보다 최소 3.5 L* 어둡게 자동 보정된다.

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

## Implementation (D1, as built)

The rules below are what `src/components/ui` actually does. Use those components; do not re-create their look with
ad-hoc classes. Lint guards (`eslint.config.js`, `[ds/*]`) warn on raw `<button>`, raw checkboxes, hand-rolled
`fixed inset-0` overlays, hex colours, `text-[Npx]` and `bg-black/N` scrims. The live reference is `/#/dev/ui`
(dev builds only). The guards cover `src/features/**` and `src/components/{common,layout,media}/**`.

### D1: tone, not lines
- Sections, cards, panels, modals and drawers separate by **surface tone and spacing**. No border, no header `border-b`.
- Outlines are allowed only for **inputs** (`border-outline-input`), **tables** and **focus rings**.
  The rare divider that spacing cannot replace uses `<Separator />` (`bg-outline-subtle`).
- Do not use `border-border/NN`. Tokens: `--outline-input` (= `--border`, 15–22% outline-variant, set by the
  appearance system) and `--outline-subtle` (55% of that).

### Component → tone
| Component | Tone | Notes |
|---|---|---|
| Page | `background` | appearance system sets it at runtime |
| `Section` (all variants) | `surface-low` | nested in a raised surface → `surface-lowest`; variants only change header type |
| `Card` | `surface-container` | nested → `surface-lowest`; ambient `theme-card-shadow` |
| `Panel` | `tone` prop: `lowest` / `low` (default) / `container` / `high` | explicit; pick one step away from the parent |
| `Inset`, `StatTile`, `EmptyState` | `surface-low` | inside a raised surface → `surface-lowest` |
| `Alert` | `surface-high/70`; destructive = `destructive-soft` | |
| `ErrorState` | `destructive-soft` | |
| `Modal` | `background` over `backdrop`, `shadow-elevation-3` | header/footer separated by spacing only |
| `ConfirmDialog` | `surface-container` | |
| `BottomDrawerSheet` | floating glass (`theme-floating-panel`) | `controller` variant = `background/96`; notice = `surface-lowest/70` |
| Popover / DropdownMenu | `surface-high`, `shadow-elevation-2` | |
| Input / Select / Textarea | `surface-lowest` tray + `outline-input` border | focus: tone shift to `surface-low`, `border-primary/55`, `ring-primary/15` |

Automatic nesting uses `data-surface` on the container: `raised` (Section, Card, Panel low/container, drawer),
`high` (Panel high, Popover), `recessed` (Panel lowest). The nested tones live in the `ui-tone-*` classes in
`index.css` (components layer), so a `bg-*` className on a component still overrides them.

Rich clickable cards (preview art + copy, list cards, media tiles) are `<Panel asChild interactive><button …/></Panel>`:
Panel supplies tone, hover and focus ring; the lint rule allows a `<button>` that is the direct child of `Panel asChild`.

### Button variants
| Variant | Use | Look |
|---|---|---|
| `default` | the one primary CTA of a view | solid primary + secondary top highlight (gradient stand-in that survives `bg-*` overrides), `primary-foreground` text |
| `secondary` | every other action (was `outline`) | `surface-high` fill, no border; `surface-highest` on a `high` parent |
| `subtle` | dense toolbars, sidebars, low-emphasis actions | `foreground/5` wash, muted text; works on any tone |
| `ghost` | icon toolbars, inline actions | transparent until hover |
| `nav` | sidebar / list navigation rows | full width, left aligned; current row via `data-active="true"` or `aria-current` → `primary/12` tint |
| `destructive` | delete / irreversible | `destructive-soft` pair |
| `link` | inline text links | `secondary` text, underline on hover |
| `shell` | icon keys in the floating app header (search, queue, account) | translucent glass key (`.theme-shell-icon-button`); open / `aria-expanded` / pressed → primary tint |
| `overlay` | controls sitting on photos (viewer toolbar, media tiles) | `backdrop/50` scrim + blur, white foreground; readable on any image in both themes |

`outline` no longer exists. Icon-only buttons use `IconButton` (label = aria-label + tooltip).
Toggle icon buttons pass `active` (`aria-pressed` + `data-pressed`): primary/12 tint on ghost/subtle/secondary, solid
primary on `overlay`, primary tint on `shell`.
Do not restyle buttons with `bg-*`, `border`, `rounded-*` or `shadow-*` overrides; pick a variant.

### Badge / Chip / ToggleChip
| Component | Use | Look |
|---|---|---|
| `Badge` | short status / kind labels | `text-2xs` semibold, `tracking-overline`, uppercase (Latin); variants `default secondary outline ghost link` + status `success warning info destructive` (soft token fills) |
| `Chip` | user content: tags, terms, tokens | keeps text case; `tone` `default muted primary success warning info destructive`, `size` `sm md` |
| `ToggleChip` | multi-select filters / category toggles | `aria-pressed`; muted wash → primary/12 tint when pressed |

`Alert` has the same status set: `default destructive warning success info`.

### Labels
Overline-style labels (Field label, StatTile label, Badge, Section `drawer` heading, anchored-popup label, PageHeader
eyebrow, ExplorerSidebar title) are `text-2xs` + `tracking-overline`. `--overline-tracking` is 0.16em for Latin and
0.02em under `html:lang(ko)`, so never hard-code `tracking-[0.1Xem]` or `text-[11px]` on a label. The PageHeader eyebrow
is a muted overline (no accent colour, no rule line).

### Navigation rows
Current row = `primary/12` tint + `foreground` text + primary icon (Button `nav`, `HierarchyNav`,
`getNavigationItemClassName`). Hover = `surface-high`. Only the top app nav uses primary text for the active item.

### Other tokens
- Text: `Text` variants `overline / label / body / muted / caption / title`, `Heading level`; type scale
  `text-2xs … text-5xl` (scaled by `--theme-text-scale`). Body text is `foreground`, metadata `muted-foreground`.
- Status colours: `destructive / success / warning / info`, each with `-foreground`, `-soft`, `-soft-foreground`.
- Elevation: `shadow-elevation-1` (raised controls), `-2` (menus, popovers), `-3` (modals).
- Stacking: `z-raised / sticky / header / drawer / popover / popover-nested / modal / floating / toast` (see `index.css`).
  `popover-nested` (150) is for a popup opened from inside a popover; go `calc(var(--z-index-popover-nested)+10)` for one more level.
- Density: `--theme-panel-padding-x/y`, `--theme-field-gap`, `--theme-control-height` (Panel `padding`/`stack` use them).
- Radius: `rounded-sm` default; `rounded-md` for floating menus.
- Chips (`Badge` / `Chip`): small metadata pieces, not pill-round.
- Top navigation: floating glass (`theme-shell-header`, translucent + blur); active state is the only orange.

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
