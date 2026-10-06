# CoNAI Design Preset — The Silent Curator

작성일: 2026-03-21 · 구현 규칙 갱신: 2026-09-28 (Flat 재설계, V1 A: 앱 전체)
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

### 1. Flat Rule
- 페이지 배경은 **한 톤**이다. 영역을 나눌 때마다 톤을 올리지 않는다 (box-inside-box 금지).
- 섹션은 **제목 + 여백**이다. 상자(plinth)를 씌우지 않는다.
- 설정 항목과 목록은 **hairline 행**(`border-line`, 마지막 행은 선 없음)으로 나눈다.
- 사이드바와 본문은 **세로 hairline 하나**로 나눈다.
- 입력 필드는 **옅은 fill 하나**(`bg-field`), 테두리 상자 없음.

### 2. Floating Only
- 배경 + 그림자는 **떠 있는 것**에만 쓴다: 저장 바, 생성 도크, popover / menu / dialog, 떠 있는 열 조절, toast.
- 떠 있는 것의 가장자리는 중립 hairline(`--line`)이다. 주황 테두리 금지.

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

## Implementation (Flat, as built)

The rules below are what `src/components/ui` actually does. Use those components; do not re-create their look with
ad-hoc classes. Lint guards (`eslint.config.js`, `[ds/*]`) error on raw `<button>`, raw checkboxes, hand-rolled
`fixed inset-0` overlays, hex colours, `text-[Npx]` and `bg-black/N` scrims. The live reference is `/#/dev/ui`
(dev builds only, section `flat`). The guards cover `src/features/**` and `src/components/{common,layout,media}/**`.

### Flat tokens
| Token | Tailwind | Use |
|---|---|---|
| `--line` | `border-line` | hairline: rows, sidebar \| content, header bottom, floating edges (7% foreground dark, 9% light) |
| `--field` | `bg-field` | the one input fill (Input / Select / Textarea / ToggleRow); translucent, reads on any surface |
| `--fill` | `bg-fill` | hover / current-row wash, segmented and tab trays, ghost hover |
| `--elevation-key` | `shadow-key` | the raised key in a segmented tray / tab list, switch thumb |

The `surface-*` ramp and `ui-tone-*` classes still exist (Panel, Inset, popovers use them) but **nesting no longer
recesses anything**: `data-surface="raised"` has no effect on children. `data-surface="high"` still steps secondary
buttons up one tone.

### Page layout
- `PageWithSidebar` (`components/common/page-with-sidebar`): render it as the page root.
  `storageKey`, `sidebar`, `sidebarLabel`, `sidebarFooter?`, `sidebarWidth?` (232), `toolbar?`, `defaultCollapsed?`.
  Desktop (`useDesktopPageLayout`, 1280px default): sticky column under the header, own scroll, right hairline,
  collapse toggle in its footer, state persisted per key. Narrow: no column; the toolbar button opens a
  `BottomDrawerSheet`. No floating frame, no pin.
- `SidebarNav` / `SidebarGroupLabel` (`actions?`) / `SidebarItem` (`icon`, `label`, `count?`, `trailing?`, `active`,
  `depth?`, `asChild?`) / `SidebarFooter` (`components/ui/sidebar`). Current row = `bg-fill` + 2px primary bar.
  In the mobile drawer an item click closes the drawer.
- `PageToolbar` (`components/common/page-toolbar`): one 56px row, no surface. `title?` · `start?` (segmented…) ·
  `children` (flexible middle, e.g. search) · `actions?` (ghost IconButtons, at most one primary). Adds the sidebar
  toggle itself inside PageWithSidebar. `PageHeader` is deprecated.
- `ExplorerSidebar` is legacy: flat, hairline, floating / pin props are inert. Migrate callers to PageWithSidebar.

### Rows
- `SettingRow` (`label`, `description?`, `htmlFor?`, `align?` center|start, `stacked?`, `controlClassName?`, children =
  control): label left, control right, 52px min, hairline below, control wraps under the label on phones.
- `ListRow` (`leading?`, `trailing?`, `selected?`, `interactive?`, `size?` sm|md|lg, `asChild?`): hairline row; with
  `asChild` a `<button>` / `<a>` / `<li>` child becomes the row (lint allows `<ListRow asChild><button/></ListRow>`).
- `ResourceRow` (`leading?`, `name`, `extra?`, `meta?`, `trailing?`, `onOpen?`, `openLabel?`): one named thing in a list
  (preset, profile, lorebook…). Name + extras over one muted meta line; `onOpen` makes the whole row clickable and shows
  the pencil on hover (always on touch). Clicks in `trailing` do not open the row. Colour the leading icon with
  `text-resource-*` (tool / generation / block / lorebook) and wrap a state that needs attention in `ResourceRowStatus`.
- `RowGroup` (`heading?`, `count?`, `headingClassName?`, `actions?`, `bodyClassName?`): group label over rows. The label
  is a muted overline over a hairline (`border-foreground/15`), one rank below the rows' names, so a long page reads by
  group; `count` adds the item count, `headingClassName` gives the label a kind colour that the rows' icons share.
  `Section variant="settings"` has the same heading.
- Rows must be direct siblings: never put `space-y-*` / `gap-*` between them.

### Component → look
| Component | Default | Escape hatch |
|---|---|---|
| Page | `background`, no glow | appearance system sets it at runtime |
| `Section` (all variants) | flat: heading row + body, no padding / surface | `tone="raised"` = old plinth |
| `Card` | flat | `tone="raised"` = tonal card + ambient shadow |
| `Panel` | `tone` `low` (a real box) | `tone="none"` (no surface, hover wash when `interactive`) |
| `Inset` | `surface-low` subtle block | only box in its area; prefer rows / text |
| `StatTile` | flat overline label + value | `tone="fill"` |
| `EmptyState` | no box | |
| `Alert` / `ErrorState` | status soft fills | |
| `Modal` | `background` over `backdrop`, `shadow-elevation-3` | |
| `BottomDrawerSheet` | floating glass, neutral hairline edge | |
| Popover / DropdownMenu | `surface-high`, `shadow-elevation-2` | |
| Input / Select / Textarea / ToggleRow | `bg-field`, transparent border | focus: `border-primary/55` + ring |
| `SegmentedControl` / `TabsList` | `bg-fill` tray, selected = `bg-background` key + `shadow-key`, foreground text | |

Rich clickable cards (preview art + copy, media tiles) are `<Panel asChild interactive><button …/></Panel>`; clickable
rows are `<ListRow asChild interactive><button …/></ListRow>`.

### Button variants
| Variant | Use | Look |
|---|---|---|
| `default` | the one primary CTA of a view | solid primary + secondary top highlight (gradient stand-in that survives `bg-*` overrides), `primary-foreground` text |
| `secondary` | every other action (was `outline`) | `surface-high` fill, no border; `surface-highest` on a `high` parent |
| `subtle` | dense toolbars, sidebars, low-emphasis actions | `foreground/5` wash, muted text; works on any tone |
| `ghost` | icon toolbars, inline actions | transparent until hover (`bg-fill` wash) |
| `nav` | sidebar / list navigation rows | full width, left aligned; current row via `data-active="true"` or `aria-current` → `bg-fill` + 2px primary bar (same as SidebarItem) |
| `destructive` | delete / irreversible | `destructive-soft` pair |
| `link` | inline text links | `secondary` text, underline on hover |
| `shell` | icon keys in the app header (search, queue, account) | flat like ghost (`.theme-shell-icon-button`); open / `aria-expanded` / pressed → primary tint |
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
Overline-style labels (Field label, StatTile label, Badge, RowGroup heading, Section `drawer` / `settings` heading,
anchored-popup label, PageHeader eyebrow, ExplorerSidebar title) are `text-2xs` + `tracking-overline`. `--overline-tracking` is 0.16em for Latin and
0.02em under `html:lang(ko)`, so never hard-code `tracking-[0.1Xem]` or `text-[11px]` on a label. The PageHeader eyebrow
is a muted overline (no accent colour, no rule line); the RowGroup heading is the one overline with a rule under it.

### Navigation rows
Current row = `bg-fill` + 2px primary bar on the left + `foreground` text (SidebarItem, Button `nav`, `HierarchyNav`,
`getNavigationItemClassName`). Hover = `bg-fill`. Only the top app nav uses primary text for the active item.

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
- Top navigation: `theme-shell-header` (translucent + blur, `--line` bottom hairline); active state is the only orange.

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
- 여백과 hairline으로 나눈다; 면과 그림자는 떠 있는 것에만
- negative space를 아끼지 않는다
- active / CTA만 강하게 강조한다
- UI보다 이미지가 먼저 보이게 한다

### Don’t
- 밝은 SaaS형 대시보드 톤으로 가지 않는다
- 섹션마다 상자(border든 톤이든) 씌우지 않는다, 상자 안에 상자 금지
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
- one page tone; sections = heading + spacing; rows separated by a very subtle hairline
- surface + shadow only for floating elements (menus, dialogs, save bar)
- primary orange only for CTA and active states
- quiet editorial spacing and typography
- image-first composition
```
