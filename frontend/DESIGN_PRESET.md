# CoNAI Design Preset — The Silent Curator

작성일: 2026-03-21 · 문서 정리: 2026-10-13 (Flat 기준)
기준 레퍼런스: 사용자 제공 홈페이지 시안 + Design System Strategy `The Silent Curator`

프론트 디자인의 단일 기준 문서다. 과거 RESET_BASELINE의 중복 색상·레이아웃 지침은 이 문서로 통합했다.
개발 방향은 [AI_Guidelines.md](../AI_Guidelines.md)를 따른다. 미디어·지식·채팅·설정에 같은 공용 UI를 사용하며,
대량 데이터의 탐색·입력 속도와 가독성을 장식보다 우선한다. 기능의 어시스턴트 연결은 [DEVELOPMENT.md](../DEVELOPMENT.md)를 참고한다.

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

### 4. Spacing and working density
- 여백은 정보 구분과 조작에 필요한 만큼 사용한다. 과도한 여백으로 탐색·편집을 느리게 하지 않는다.
- 미디어 피드, 지식 목록, 채팅, 설정은 같은 토큰을 쓰되 작업에 맞는 밀도를 선택한다.
- 가상 목록·키보드 입력·모바일 조작을 우선하고 불필요한 애니메이션과 무거운 장식을 줄인다.

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

`@shadcn/lint` (same `npm run lint`) checks every `src/**/*.{ts,tsx}` file at `error`:
- `no-restyle` (`allow: ['layout']`): callers place and size a `components/ui` component (margin, width, flex, position,
  text alignment); the component owns its spacing, typography, colour, shape and effects through variant / size props.
  If no variant fits, add one to the component, never a className override at the call site.
- `no-arbitrary-values`: layout sizes may use `calc()` / viewport values; spacing (margins too), type, radius and colour
  stay on the scale (`p-3.25`, not `p-[13px]`).
- `no-raw-colors` and `no-unknown-classes`: theme tokens only, and every class must generate CSS. Intentional library /
  CSS hook classes (`nodrag`, `chat-markdown`, …) are allow-listed in `eslint.config.js`.
- `require-static-classes`: class strings must stay readable to the linter.
- `no-inline-styles` is off: editors, canvases and virtual lists compute geometry inline. Use tokens and shared
  components for presentation.

`components/ui/**` is exempt from restyle, arbitrary-value and static-class checks. There is no bulk-suppression
baseline: every finding fails `npm run lint`. A genuine exception is an inline
`eslint-disable-next-line shadcn/<rule> -- <reason>` on that line; never `--suppress-all`.

### Lint migration map (Phase A → feature migration)

The migration started from 1,438 restyle, 266 arbitrary-value and 97 static-class findings across `src`; all are
now fixed or carry a justified inline disable.
These are **class findings**, not distinct elements. The largest restyled components were Button (493), IconButton
(91), Badge (82), Text (77), Inset (60), ModalBody (52), Panel (47), ModalFooter / Chip (44 each), Input (43),
Textarea (36), Select (33) and Skeleton (32). Repeated classes mostly duplicate defaults: `font-semibold`,
`gap-2`, `px-*`, `rounded-sm`, `text-xs`, and surface/selection overrides. Remove redundant overrides first.
Do not turn every observed combination into a new variant. Keep existing API defaults and use these replacements:

| Component / observed pattern | Replacement / decision |
|---|---|
| Button `h-7 px-2 text-xs`, `h-7 gap-1.5` | `size="compact"` (28px, 8px horizontal padding, 12px text). Keep only caller width/placement. |
| Button `h-6 px-2 text-xs` / `h-8 px-3` / `h-9 px-4 py-2` | Existing `size="xs"` / `"sm"` / default. Remove redundant gap/radius/type classes; do not globally shrink `sm` text. |
| Button `h-auto min-h-6 py-1 whitespace-normal break-words font-normal` on a tag action | `size="content"` with `variant="subtle"`; wraps, unlike toolbar buttons. Static content uses Chip. |
| Button tray selection `bg-background text-foreground shadow-key` | SegmentedControl; its internal `variant="segment"` derives selection from `aria-pressed` / `aria-selected`. No colour classes at the caller. |
| Button / IconButton `text-destructive hover:text-destructive` | Existing `variant="destructive-ghost"`; destructive fill → `variant="destructive"`. Muted ghost overrides are redundant. |
| IconButton `text-primary bg-primary/15`, other selected washes | `active={selected}` on ghost/subtle/secondary; overlay controls use `variant="overlay"`. `active` is a toggle, not a generic success indicator. |
| IconButton `rounded-full`, Button `rounded-*`, font/gap tweaks | Normalize to existing square/soft-square sizes. Avatar controls use AvatarButton. Do not make a circle variant for incidental drift. |
| Button breadcrumb `font-semibold` on current location | Ghost + `aria-current="location"`; normal `size="sm"` padding. |
| Button rich multiline clickable card / row, `p-0`, `rounded-none` | MediaCard / ListRow `asChild interactive`, not a stripped Button. Preserve the media background/padded-caption invariant below. |
| Badge `normal-case tracking-normal` | `casing="sentence"` when the value is a user name, not a status label. |
| Badge `px-1.5`, `px-1 py-0`, overlay scrim/white/border combo | Existing `size="sm"` / `"xs"` and `variant="overlay"`. Drop duplicate uppercase/font/border classes. Status colours → existing status variants. |
| Chip `font-mono tabular-nums` | `mono`; use existing tone and sm/md size. Remove weight/gap drift. Removable chips use `onRemove`, never a hand-placed X. |
| Text overline `font-semibold`; title `font-semibold` | Remove: already provided. `text-xs` metadata → `variant="caption"`. |
| Text `text-destructive`, `text-warning`, `text-current` etc. | `tone="destructive"` / `"warning"` / `"inherit"`; also default, muted, primary, secondary, success, info. `mono` for code/numeric copy. |
| Text / Heading becoming a badge or pill (`bg-* rounded-full px-2`) | Badge / Chip instead. Inline icon+text layout goes in a parent flex row, not an extra Text gap. |
| Heading `text-xl` with h1 semantics | `level={2} as="h1"`; levels choose appearance, `as` chooses document semantics. Tiny overlines use Text, not Heading. |
| Input / Select `h-7 px-2 text-xs` | `controlSize="compact"` (native `size` remains the HTML attribute). `font-mono` → `mono`. Do not shrink all settings fields. |
| Textarea `font-mono text-xs` | `mono textSize="xs"`; default remains sm. Code display without editing → CodeBlock. |
| Input / Textarea / NumberStepperInput `border-destructive` | `aria-invalid={invalid}` (existing error treatment). NumberStepperInput forwards input variant props, including `mono` / `controlSize`, to its input. |
| Input `pl-9 pr-9` search adornments | SearchField / ToolbarSearchField. The internal Input uses `adornments="search"`. |
| Input / Textarea `ASSIST_FILLED_CLASS` | `assisted={filled(fieldId)}` preserves the chat-filled outline without a dynamic imported class. |
| Textarea imported `GROW_TEXTAREA` | `autoGrow` (content sizing, min-h-16, max-h-96). Keep `rows` as fallback. |
| SettingRow `controlClassName={SETTINGS_CONTROL_CLASS}` / `SETTINGS_WIDE_CONTROL_CLASS` | `controlWidth="standard"` / `"wide"` (full width on phones, sm:w-60 / sm:w-96). Remove the obsolete import after migrating all usages. |
| SettingRow `gap-* py-*`, ToggleRow `py-2 font-medium` | Keep standard row density. Put multiple controls in a child flex wrapper; rows remain direct siblings without space-y. |
| ModalBody `space-y-4` / `space-y-3` / `space-y-5` | Remove / `spacing="sm"` / `spacing="lg"`. `spacing="none"` for a caller-owned grid or split pane; put its gaps on the inner layout. Normalize 1/2 to sm unless the content is really a list of rows (none). |
| ModalFooter `border-t border-line pt-3` | `separated`; remove caller gap overrides. Use EditorFooter where its action slots already fit. |
| Panel `rounded-none`, custom px/py; Inset `px-3 py-2` | Panel's existing `radius` / `padding` / `stack`; Inset `padding="sm"` (default md = px-4 py-3). Normalize p-3/py-2.5 compact notes to sm rather than adding a step. |
| Panel drop border / active tint | `treatment="drop" data-drag-active={active}`; keep padded content. Shared media inputs use MediaFileDropSurface. |
| Panel floating `p-1 shadow-elevation-2` | `treatment="floating" padding="toolbar"`; positioning and arrangement remain caller-owned. Nonfloating panels must not acquire elevation. |
| PopoverContent `p-0` / `p-2` / `p-3` / `p-4` | `padding="none"` / `"sm"` / `"md"` / `"lg"` (default). Normalize p-1/1.5 to sm for menus, or use ActionMenu / DropdownMenu. |
| AnchoredPopup `p-0` | Remove (already unpadded). Put content padding in its existing body composition; do not rebuild its surface. |
| AnchoredPopup `z-floating` (opened from inside a Modal) | `layer="floating"`; default `popover`. |
| Button styled as a Select (`theme-input-surface border … justify-between`) opening a picker / tree | `variant="field" size="field"`; caller keeps width only. |
| Button `bg-background/55 rounded-none` click-away area under a dropped-down panel | `variant="scrim"`; caller sets its size (`h-auto flex-1`). |
| ResourceRow `opacity-*` (hidden / dragged) and drop-over `bg-primary/8` | `dimmed` and `dropTarget`. |
| Disabled `ListRow interactive` `disabled:opacity-*` | Remove: an interactive row dims and drops its wash when disabled. A row with nothing to do is a plain (non-interactive) row, not a disabled button. |
| Ghost Button inside a chip with `text-current` (operator key) | `ChipAction`; it keeps the chip's tone. |
| Category colours on a pressable chip (`bg-info-soft …`, active ring) | `ToggleChip tone="info" \| "warning" \| "success" \| "primary"`; pressed adds an inset ring. |
| A dense block of on/off chips where primary would flood the screen (pinned-page chips) | `ToggleChip tone="neutral"`: outlined when off, neutral fill when pressed. |
| Per-item colour on the selected SegmentedControl key | Item `activeStyle` (data-driven colour, inline). |
| Overlay Badge `font-semibold uppercase` (status / tier label on a thumbnail) | `casing="upper"`; a user-defined tier colour stays inline. |
| Textarea `text-muted-foreground` (de-emphasised editable text) | `muted`. |
| IconButton `size-11 sm:size-9` (touch-sized key in a bottom-docked bar) | `size="icon-touch"`. |
| ToggleRow `min-h-11 py-2 sm:min-h-9` (switch row lined up with the inputs of a form grid) | `size="field"` (exactly the field height); label weight goes on the label span. |
| Chip `font-semibold` (state label) | Bold the content (`<span className="font-semibold">`); the chip keeps its own weight. |
| `transition-[width]` / `transition-[left,top,…]` on wallpaper art | `transition` plus inline `transitionProperty`; never widen to `transition-all`. |
| A border in the chat profile's narration colour | `border-narration-edge` (theme colour, resolves the element's `--chat-rp-narration`). |
| TabsList / TabsTrigger presentation overrides | Features use TextTabs / FieldTabs / SegmentedControl. Common compositions use UI `variant="text"` / `"field"` (`bare` for field-only choices); Tabs `flush` removes the root gap. |
| Skeleton `rounded-sm` | `radius="sm"`; default md, avatar placeholder `radius="full"`. Remove fill overrides. |
| ListRow / SidebarItem font, gap, border, selected background tweaks | Use size/interactive/selected or active/depth props. Rows own their hairline and padding. No restyled rounded cards in a row list. |
| EmptyState px-0/py-3/py-4, LoadingState type tweaks | Existing `size="compact"` and defaults; normalize local spacing. Parent owns placement, not the component's padding. |
| StatTile body/value type overrides, background fill | Keep the shared overline label/title value scale; `tone="fill"` only for a real filled tile. For inline setting statistics use SettingsStatLine, not a mini card. |
| Alert status colour/type overrides | Existing status variant, ordinary shared typography. Complex content layout belongs inside AlertDescription; never shrink the whole alert with text-xs. |
| CodeBlock text colour overrides | Keep its default text; use size/fill/wrap/maxHeight. Status belongs in surrounding Alert or a separate Text. |
| DropdownMenuItem destructive text | Existing `variant="destructive"`. Radio-item font previews use a styled child span rather than changing the menu item's typography. |
| Field / FieldGroup gap tweaks, Section body space-y, RowGroup space-y | Remove duplicate defaults. For special content, use an inner layout; never put space between hairline row siblings. |
| DataTd status text / tabular numerals | Put status Text/Badge inside the cell; use numeric/meta/flush props. DataTh should keep its overline default. |

**Narrow contracts (all with actionable lint messages):**
- Text, Heading, Badge and Chip allow content wrapping/truncation (`truncate`, `line-clamp-*`, `whitespace-*`,
  `break-*`) and tabular numerals. Content length is caller-owned; colour, weight and scale are not.
- Button/IconButton and form controls allow wrapping/truncation, tabular numerals and the exact editor interaction
  hooks `nodrag`, `nopan`, `nowheel`, `nokey`. Hooks change event routing, not appearance. They do not allow `font-*`,
  fills, radii or padding. Contracts are last-match-wins, not additive.
- Panel, Inset, PopoverContent, AnchoredPopup, TabsContent and Alert title/description allow only scale `gap-*` /
  `space-x-*` / `space-y-*` beyond layout. These containers host caller-owned child arrangements; surface and
  padding stay in props. Use Panel `stack` for the standard density gap, and never add gaps between row siblings.
- RowGroup allows `text-resource-*` and `text-warning` for its documented `headingClassName` semantic kind colour.
  This is not a general typography/colour exception. Keep other colour values in component props.

**Static classes:** the baseline is mostly imported constants, not interpolation (69 SettingRow control widths,
19 Textarea and 2 Input findings in settings). Use the props above rather than copying presentation constants.
For genuine conditional layout use `cn('min-w-0', wide ? 'w-96' : 'w-60')`, or a same-file lookup containing full
class strings / `cva`. Never construct `` `text-${size}` `` or `` `bg-${tone}` ``. Prefer variant props when the
lookup chooses appearance. The linter has bounded variable resolution; if a computed lookup remains unreadable,
use an explicit conditional at the JSX site, not a rule disable or an opaque helper. Do not register arbitrary
class-producing functions as merge functions to hide them.

**Arbitrary values:** there is no feature-wide exception (wallpaper and chat held most of them). Distinguish the editor chrome from the artwork: chrome uses this UI kit; runtime scene coordinates,
user-authored font metrics, timeline/canvas geometry and crop transforms belong in computed inline styles (already
allowed), preserving their exact values. Do not round artwork `em` metrics to a UI spacing scale. Static UI values
use the Tailwind scale: `ring-[3px]` → `ring-3`, `pl-[1.625rem]` → `pl-6.5`, `border-[1.5px]` → `border-1.5`,
`leading-[18px]` → `leading-4.5`, `line-clamp-[12]` → `line-clamp-12`; fixed radii normalize to sm/md.
Chat prose uses existing markdown styles; code blocks use CodeBlock. Opacity/transform/filter/shadow lists
normalize to `transition`, colour lists to `transition-colors`; a width, position or stroke list keeps its narrow
property list as an inline `transitionProperty` beside `transition` (never widen to `transition-all`, and never add
animation to a large list). Prefer `motion-reduce:transition-none` where motion
is needed. Use `shadow-nav-active` for the existing 2px navigation inset and `shadow-toolbar-edge` for the sticky
toolbar hairline. Token gradients use `bg-linear-* from-* via-* to-*`; checkerboards reuse `bg-checker`.
Margin, padding, type, colour, radius and effect exceptions must not be smuggled through inline styles.

**Case-by-case, not mechanical:** wallpaper artwork vs editor chrome; image crop/selection handles and inspector
gradients; rich Button-to-MediaCard/ListRow conversions; semantic warning/success indicators vs toggle state;
resource-row inactive opacity; Tip numeric content; progress custom tones; and chat prose scale/line-height.
HierarchyNav drag-target feedback goes through `getItemDataAttributes` (`'data-drop-target': 'true'`), which
SidebarItem and Button nav style.

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
- One column spec and one gutter, from tokens in `index.css` (never re-type the classes):
  | Token | Value | Use |
  |---|---|---|
  | `--sidebar-column-width` | 232px | sidebar column width (`PageWithSidebar sidebarWidth` overrides it per page) |
  | `--sidebar-column-padding-x` / `-top` / `-bottom` | 0.625rem / 0.875rem / 0.5rem | column inner padding; SidebarFooter's left inset |
  | `--content-gutter` | 2rem | content side gutter beside a column |
  | `--content-gutter-narrow` | `--theme-shell-inline-padding` | content side gutter where no column can sit beside it (narrow screens; a collapsed desktop column keeps `--content-gutter`) |
  | `--page-gutter` | set per content column | what toolbars and bodies read (`px-(--page-gutter)`); `pageGutterStyle(besideColumn)` sets it |
  | `--shell-content-height` | 100dvh − header − `--shell-bottom-inset` | full-height pages and sticky columns |
  | `--shell-bottom-inset` | phone bottom tabs + home indicator (below md), else 0 | the room `AppBottomNav` takes at the bottom of the viewport |
  | `--shell-float-bottom` | max(`--shell-bottom-inset`, safe area) | the edge a floating bar rests on |
- Anything anchored to the bottom of the viewport keeps `--shell-bottom-inset` free: fixed bars and drawers
  `bottom-(--shell-bottom-inset)`, a floating bar or the save bar `bottom-[calc(var(--shell-float-bottom)+…)]`, a sticky
  bar in the document scroll `bottom-(--shell-bottom-inset)`. Don't add `env(safe-area-inset-bottom)` beside them; a
  layer above the tabs (dialogs, sheets, the phone's chat panel, full-screen viewers) covers them instead.
- `SidebarColumn` (`components/common/sidebar-layout`, `label?`, `footer?`, `className` positioning, `bodyClassName`
  layout): the column itself — token width and padding, right hairline, own scroll. PageWithSidebar, TwoPane and the
  chat page render it.
- `.page-bleed`: a page root with a column cancels the shell's side and bottom padding (column runs edge to edge and
  full height); its content column puts `pb-(--theme-shell-main-padding-bottom)` back. PageWithSidebar and `/chat`.
- `PageWithSidebar` (`components/common/page-with-sidebar`): render it as the page root.
  `storageKey`, `sidebar`, `sidebarLabel`, `sidebarFooter?`, `sidebarWidth?` (default token), `toolbar?`, `defaultCollapsed?`.
  Desktop (`useDesktopPageLayout`, 1280px default): sticky column under the header, own scroll, right hairline,
  collapse toggle in its footer, state persisted per key. Narrow: no column; the toolbar button opens a
  `BottomDrawerSheet`. No floating frame, no pin.
- `/chat` keeps its own full-height layout (list screen on phones, column from 768px) but uses SidebarColumn,
  `.page-bleed` and the gutter: header row, transcript and composer sit on `--page-gutter`.
- `TwoPane` / `TwoPaneToolbar` (`components/common/sidebar-layout`): the in-panel split (pickers inside a Modal,
  catalog mocks). `sidebar?`, `sidebarLabel?`, `sidebarFooter?`, `bleed` (default true: cancels the Modal body padding,
  hairline above and below; `false` inside a framed block). Column from 640px; the content pane carries `--page-gutter`
  — put its controls in `TwoPaneToolbar` and give the body `px-(--page-gutter)`. Without `sidebar` it is a single pane
  with the same edges (posts audio tab). Used by the post attach tabs and `MediaLibraryBrowser`.
- `SidebarNav` / `SidebarGroupLabel` (`actions?`) / `SidebarItem` (`icon`, `label`, `count?`, `trailing?`, `active`,
  `depth?`, `asChild?`) / `SidebarFooter` (`components/ui/sidebar`). Current row = `bg-fill` + 2px primary bar.
  In the mobile drawer an item click closes the drawer.
- `PageToolbar` (`components/common/page-toolbar`): one 56px row, no surface. `title?` · `start?` (segmented…) ·
  `children` (flexible middle, e.g. search) · `actions?` (ghost IconButtons, at most one primary Button that names its
  action). Adds the sidebar toggle itself inside PageWithSidebar.
- Page first row: every page opens with its PageToolbar, and its left end says where you are. `title` is the page's
  menu name (`t('pageAccessCatalog.<page>')`) followed by the count; views of the whole page are a SegmentedControl in
  `start` after the title (prompts, wildcards, sprite); a sidebar page names the open item after the title as a muted
  path with the current step in the foreground (audio: project / folder / effect); folder pages lead with a breadcrumb
  whose first step is the page (files, groups, posts, character library). Tabs over a list inside the page sit in a
  TextTabs row right under the toolbar (posts, chat resources). The generation page and, for administrators, 캐릭터
  lead with their view switch instead, since it names the page. A page root takes the full content width (no
  `mx-auto max-w-*`); a form inside may narrow itself.
- Empty states: a page, list, menu or picker with nothing in it shows `EmptyState`, never a hand-written muted line.
  The title says what is missing (아직 효과음이 없어) and the action is one Button that does it; no description line
  (see Helper text). `default` for a page or its main pane; `compact` in sidebars, lists inside editors, menus and
  pickers. A no-results state keeps the search icon and has no action.
- Header → content gap: the shell's main starts right under the app header (no extra top padding). The page's first
  row is its PageToolbar (or a 56px row like a tab strip), and that row's height is the gap. Don't add `pt-*` / `-mt-*`
  at a page root, and don't subtract a top gap in `calc(100dvh - header …)` heights.
- `ExplorerSidebar` was removed (no callers left); pages with a sidebar use PageWithSidebar.

### Rows
- `SettingRow` (`label`, `description?`, `htmlFor?`, `align?` center|start, `stacked?`, `controlClassName?`, children =
  control): label left, control right, 52px min, hairline below, control wraps under the label on phones.
- `ListRow` (`leading?`, `trailing?`, `selected?`, `interactive?`, `size?` sm|md|lg, `asChild?`): hairline row; with
  `asChild` a `<button>` / `<a>` / `<li>` child becomes the row (lint allows `<ListRow asChild><button/></ListRow>`).
- `ResourceRow` (`leading?`, `name`, `extra?`, `meta?`, `trailing?`, `onOpen?`, `openLabel?`): one named thing in a list
  (preset, profile, lorebook…). Name + extras over one muted meta line; `onOpen` makes the whole row clickable and shows
  the pencil on hover (always on touch). Clicks in `trailing` do not open the row. Colour the leading icon with
  `text-resource-*` (tool / generation / block / lorebook) and wrap a state that needs attention in `ResourceRowStatus`.
  Settings lists whose rows open an editor (folders, LLM models/connections/presets, accounts, permission groups) use
  it instead of a column table; flag only what is off or failing (inactive, watcher error, not used), never the normal
  state. Keep a table (`DataTable`) only where values are compared down columns (usage, stats, file lists).
- `RowGroup` (`heading?`, `count?`, `headingClassName?`, `actions?`, `bodyClassName?`): group label over rows. The label
  is a muted overline over a hairline (`border-foreground/15`), one rank below the rows' names, so a long page reads by
  group; `count` adds the item count, `headingClassName` gives the label a kind colour that the rows' icons share.
  `Section variant="settings"` has the same heading.
- Rows must be direct siblings: never put `space-y-*` / `gap-*` between them.

### Form pieces (inside editors / panels)
- `Field` (`label`, `info?`) is a `<label>` around one control; `FieldGroup` (same props, `components/ui/field`) is the
  same overline label over content that holds several controls or buttons (`role="group"` + `aria-labelledby`).
  `FramedField` (`components/common/field-tabs`) = FieldGroup + the field frame.
- `SliderRow` (`components/ui/slider-row`): label · slider · value on one line. `readout?` (shown text, default the
  value), `editable` + `unit` (typed value), `mixed`, `onCommit` (drag end), `ariaLabel?`, `labelClassName` (label
  column width, default `w-18`), `layout="inline"` for toolbars (fixed-width slider). Never hand-build the grid.
- `SwitchLine` (`components/ui/switch-line`): label + Switch with no hairline (`extra?` before the switch, `muted`,
  `placement="start"` = switch then label for a wrapping line of flags). Hairline settings row = `SettingsSwitchRow`.
- `DisclosureButton` (`components/ui/disclosure-button`, `open`, `align?` center|start): the `nav` header with a chevron
  that folds a section open in place ("고급", workflow fields); the label is its children. Hairline list row that folds
  = `CollapsibleRow`.

### Shared blocks
- Floating surface (`components/ui/floating-surface`): `floatingSurfaceClassName` (surface-high, elevation-2, md radius)
  is the look of every hand-positioned menu, suggestion list, hover card and floating toolbar; Popover / DropdownMenu /
  ActionMenu build on it (`floatingMenuClassName`, `floatingMenuItemClassName`, `floatingMotionClassName`). Never
  re-type `bg-surface-high shadow-elevation-2`.
- `CodeBlock` (`components/ui/code-block`, `size` xs|2xs, `maxHeight` none|xs|sm|md|lg|screen, `fill`, `wrap`): mono
  `<pre>` for JSON / raw responses / logs / error details; field fill, scrolls inside itself. `fill={false}` when it
  already sits in a modal or framed group.
- `DataTable` / `DataTh` (`numeric`) / `DataTr` (`interactive`, `selected`) / `DataTd` (`numeric`, `meta`, `flush`) /
  `DataCheckTh` / `DataCheckTd` (`components/ui/data-table`): the one column table (overline header, hairline rows,
  `scroll-x`, `minWidthClassName?`). Markdown renderers use `proseTableClassNames` for their cells.
- `ScheduleRow` (`components/common/schedule-row`, `leading`, `status` active|stopped|idle, `statusLabel`, `name`,
  `cadence`, `details?`, `stats?`, `nextRunAt?`, `actions?`, `notice?` + `noticeTone`, `compact?`): one workflow autorun
  / chat routine in a list (status dot, cadence, next run on the end, stop reason under the text).

### Dialogs (`Modal`, `ConfirmDialog`, `EditorFooter`)
Dialogs are for short jobs: a question, a name, a choice, a small form. An editor with more than two sections is a page.
- `size` is required and has four steps: `sm` 26rem (a question and two buttons; `ConfirmDialog` uses this look),
  `md` 36rem (one to six fields), `lg` 56rem (choosing from a list or tree, one-column editors), `xl` 72rem (a work
  surface: viewer, media library, split editors). There is no free width.
- Header: `title` says what the dialog does, `description` only carries the data it acts on (a count, a path, a name) or
  a consequence the user must know (what is deleted or kept), `status` holds a state chip (linked, synced). No switches, menus or buttons in the header; they go in
  the body or the footer.
- Footer (`EditorFooter`): Delete in words on the left (asks first), the editor's other actions, then on the right the
  unsaved status (`Ctrl S`), Cancel and the primary action as a verb (저장 · 만들기 · 불러오기). An icon-only primary
  action fails lint (`[ds/icon-primary]`) in a `ModalFooter` / `EditorFooter` and on pages alike; icons alone stay for
  small repeated tools (export, duplicate), and the chat composer's send arrow is the one exception.
- Height: `auto` by default. `medium` / `tall` only when the body changes while open (pickers, managers, tabs or a
  section list), so the frame does not jump.

### Editor pages (`EditorPage`, `FloatingSaveBar`)
A large editor (chat profile, appearance setting, lorebook) is a page with its own address, not a dialog.
- `EditorPage` (`components/common/editor-page`): the path back (`crumbs`), the title with `status` chips and `actions`
  (one `⋯` menu), an optional `nav` (`EditorSectionNav`: each section's icon and name, with a mark where input is
  needed; a drawer on a phone) and the `saveBar`. Ctrl/⌘ S (`usePageSaveShortcut`) commits the focused field, then
  calls `onSave`; not while a dialog is open over the page, nor from the chat dock. `SettingsSaveBar` uses the same
  shortcut while a section is unsaved.
- `FloatingSaveBar` (`components/ui/floating-save-bar`): shown only while something is unsaved or saving — what is
  unsaved on the left, 되돌리기 and 저장 in words on the right. `SettingsSaveBar` is the settings page's use of it.
- Leaving with unsaved changes asks first (`useEditorPageGuard` with the page's own address check; the editor's own
  move after a save or delete goes through `allowNavigation`, so a new item moving to its id does not ask). The page
  keeps the assistant field and action IDs of the dialog it replaced.
- A section folds its rarely changed fields into `SettingsAdvanced` in place; there is no page-wide advanced switch.

### Component → look
| Component | Default | Escape hatch |
|---|---|---|
| Page | `background`, no glow | appearance system sets it at runtime |
| `Section` (all variants) | flat: heading row + body, no padding / surface | `tone="raised"` = old plinth |
| `Card` | flat | `tone="raised"` = tonal card + ambient shadow |
| `Panel` | `tone` `low` (a real box) | `tone="none"` (no surface, hover wash when `interactive`; keep its padding) |
| `MediaCard` | `flat`: no background in any state | `variant="boxed"` = surface + padded caption |
| `Inset` | `surface-low` subtle block | only box in its area; prefer rows / text |
| `StatTile` | flat overline label + value | `tone="fill"` |
| `EmptyState` | no box | |
| `Alert` / `ErrorState` | status soft fills | |
| `Modal` | `surface-low` card (`rounded-xl`, hairline edge) over `backdrop`, `shadow-elevation-3`; quiet ghost ✕ | phones: `sm`/`md` bottom sheet, `lg`/`xl` full screen |
| `BottomDrawerSheet` | floating glass, neutral hairline edge | |
| Popover / DropdownMenu | `surface-high`, `shadow-elevation-2` | |
| Input / Select / Textarea / ToggleRow | `bg-field`, transparent border | focus: `border-primary/55` + ring |
| `SegmentedControl` / `TabsList` | `bg-fill` tray, selected = `bg-background` key + `shadow-key`, foreground text | |

### Media card and the background invariant
- **Anything that can show a background (hover / active / selected) pads its text; a flat card never gets a
  background.** An unpadded container must not receive `hover:bg-*`, `data-[selected]` tints or an interactive Panel.
  ListRow pads itself when `interactive` or when `selected` is passed (even `false`).
- `MediaCard` (`components/common/media-card`) is the one clickable media card: a real `<button>` (or `<a>` with
  `href`). Slots `media`, `mediaClassName` (frame size: aspect or fixed size), `overlay` (badges over the media,
  position them yourself), `leading`, `title`, `meta`; `selected`; `className` is grid layout only.
  - `variant="flat"` (default): media on the page tone, caption flush with the media edge, `pt-2` gap. Never a
    background: hover dims the media, selection is a primary ring on the media, focus a ring on the media. `inline`
    puts the media beside the caption (compact strip chips).
  - `variant="boxed"`: surface card (interactive Panel `low`: hover lift, focus ring, selected tint), caption in one
    padded body (`--theme-panel-padding-x/y`).
- Do not hand-build cards with `<Panel asChild interactive padding="none">`; clickable rows are
  `<ListRow asChild interactive><button …/></ListRow>`.

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
| `ToggleChip` | multi-select filters / category toggles; the chat composer's tools (the label says the state: 페이지 연결 켜짐, 플래그 2) | `aria-pressed`; muted wash → primary/12 tint when pressed. Without `pressed` it is a plain worded key (a menu or popup trigger) in the same row |
| `Chip onRemove` | removable tag / keyword / applied filter | `onRemove`, `removeLabel?` (default 빼기), `removeDisabled?`; trailing ghost X key sized to the chip (sm 16px, md 20px). Never hand-place an IconButton X inside a Chip |
| `Badge variant="overlay"` | counts / kind tags on a photo or thumbnail (`+3`, `1/4`, 영상, GIF) | `bg-backdrop` scrim + blur, white, own case, medium weight; `size` `default` (24px) `sm` (20px) `xs` (16px). Never re-create with `bg-backdrop … text-white text-2xs` |
| `CountBadge` (`ui/count-badge`) | unread / pending counter or attention dot on a key, inline unread pill | `count?` (none = 8px dot), `max?` (`99+`), `label?` (role img), `tone` `primary destructive`, `size` `xs` 14 / `sm` 16 / `md` 18px, `corner` `top-right bottom-right` (absolute on a `relative` parent), `ring` |
| `AvatarButton` (`ui/avatar-button`) | a round avatar that is itself the control | raw round button, focus ring only; avatar as children, action as `aria-label` |

`Alert` has the same status set: `default destructive warning success info`.

### Tabs / search / horizontal scroll
- Tabs: `TextTabs` (`components/common/text-tabs`) is the one underlined tab strip (`items` with `count?`, `actions?`,
  `hairline?`, `TabsContent` children); `FieldTabs` for tabs inside a field frame; `SegmentedControl` for tray toggles.
  Features never compose `TabsList` / `TabsTrigger` themselves (`[ds/tabs]`).
- Search: `SearchField` / `ToolbarSearchField` (`components/common/search-field`); never place a Search icon over an
  `Input` by hand (`[ds/search]`).
- Horizontal scroll: the `scroll-x` class (overflow-x auto, overflow-y hidden), plus `theme-nav-scroll` to hide the bar.
  A bare `overflow-x-auto` also makes overflow-y auto, so a 1px underline or focus ring below the row grows a stray
  vertical scrollbar (`[ds/scroll-x]`).
- When a piece repeats in two places and no shared component fits, add one to `components/common` (or a feature-local
  shared file) instead of copying the class string.

### Helper text
No explanatory line under a title, a section, a group, a setting, a menu item or an empty state: the label is the
explanation, and a label that needs a sentence gets a better label. Write visible text only when the user cannot act
correctly without it: an irreversible, cost or security consequence (what is deleted, what stays, Anlas use, a key shown
once), an error or a blocked or filtered state and its reason, a validation that stops saving, progress and counts, a
conditional warning about the input itself, or a setup step in another app. Background for one control goes in its ⓘ
(`Field` info, `SettingRow` / `Section` `description`), never in a visible paragraph. Settings registry descriptions
feed search and the assistant; never render them as a visible line.

### Labels
Overline-style labels (use `<Text variant="overline">` or the structural component; hand-rolled `tracking-overline`
is `[ds/overline]`) (Field label, StatTile label, Badge, RowGroup heading, Section `drawer` / `settings` heading,
anchored-popup label) are `text-2xs` + `tracking-overline`. `--overline-tracking` is 0.16em for Latin and
0.02em under `html:lang(ko)`, so never hard-code `tracking-[0.1Xem]` or `text-[11px]` on a label. Overlines are muted
(no accent colour, no rule line); the RowGroup heading is the one overline with a rule under it.

### Navigation rows
Current row = `bg-fill` + 2px primary bar on the left + `foreground` text (SidebarItem, Button `nav`, `HierarchyNav`).
Hover = `bg-fill`. Only the top app nav uses primary text for the active item.

### Icons: one meaning each
| Icon (lucide) | Means | Never |
|---|---|---|
| gear `Settings` | app settings (account menu, the Settings page) | a page's or a tool's own options |
| sliders `SlidersHorizontal` | this page's or tool's settings (the header's "갤러리 설정", in-page options) | app settings |
| wand `Wand` | image or media generation (생성, 만들기, empty slots, the generation page) | AI text |
| ✦ `Sparkles` | AI writes or suggests text (AI 초안, reply suggestions, keyword fill, merge drafts) | generation runs |

The wand and ✦ never stand alone on a primary action: pair them with the verb ("생성", "만들기", "AI 초안"). Wildcards
use `Shuffle`; the page of every page (`/access`, 전체) uses `LayoutGrid`. Page icons come from
`features/auth/page-access-catalog.tsx`.

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
  From md it holds the pinned pages (icon + name from xl; narrower only the current page keeps its name) and the
  grouped menus 라이브러리 · 만들기 · 확장 (`AppNavGroupMenu`: name + one line per page, the group key tinted while its
  page is open). Phones get `AppBottomNav` instead: the first four pinned pages and 전체 (`/access`), same glass with
  the hairline on top (`.app-bottom-nav`). The right side keeps search, queue, chat and the account menu, which holds
  설정 (gear) and 내 설정.

---

## Homepage Direction

홈페이지는 “운영 대시보드”보다 “큐레이티드 피드”에 가까워야 한다.

### Must keep
- 공용 앱 내비게이션
- 검색·필터와 콘텐츠에 빠르게 접근하는 구조
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
- 작업에 맞는 여백과 정보 밀도를 선택한다
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
