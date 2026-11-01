import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { plugin as shadcn } from '@shadcn/lint'
import { defineConfig, globalIgnores } from 'eslint/config'

const NATIVE_DIALOGS = [
  ['confirm', 'Native confirm() blocks the UI and ignores theming. Use useConfirm() / ConfirmDialog from components/ui/confirm-dialog.'],
  ['prompt', 'Native prompt() blocks the UI and ignores theming. Use a Modal (components/ui/modal) with an Input.'],
  ['alert', 'Native alert() blocks the UI and ignores theming. Use the snackbar (components/ui/snackbar) or a Modal.'],
]

/** className strings inside JSX `className={...}` (plain literals, cn()/clsx() args, template chunks). */
const classNameString = (pattern, message) => [
  { selector: `JSXAttribute[name.name='className'] Literal[value=${pattern}]`, message },
  { selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=${pattern}]`, message },
]

const DESIGN_SYSTEM_GUARDS = [
  {
    selector: "JSXOpeningElement[name.name='input'] > JSXAttribute[name.name='type'][value.value='checkbox']",
    message: '[ds/checkbox] Raw <input type="checkbox">: use Checkbox or Switch from components/ui.',
  },
  {
    // A <button> that is the direct child of <Panel asChild …> or <ListRow asChild …> is allowed: they supply hover
    // and focus (`interactive`) for rich clickable cards / rows that Button's single-line sizing does not fit.
    selector:
      "JSXElement:not(JSXElement[openingElement.name.name=/^(Panel|ListRow)$/]:has(JSXOpeningElement[name.name=/^(Panel|ListRow)$/] > JSXAttribute[name.name='asChild']) > JSXElement) > JSXOpeningElement[name.name='button']",
    message: '[ds/button] Raw <button>: use Button or IconButton from components/ui (rich clickable cards / rows: <Panel asChild interactive><button/></Panel>, <ListRow asChild interactive><button/></ListRow>).',
  },
  ...classNameString('/fixed inset-0/', '[ds/overlay] Hand-rolled "fixed inset-0" overlay: use Modal or Popover from components/ui.'),
  ...classNameString(
    '/(^|\\s)overflow-x-(auto|scroll)(\\s|$)/',
    '[ds/scroll-x] Bare overflow-x-auto also turns overflow-y to auto, so a 1px underline or focus ring grows a stray vertical scrollbar: use the scroll-x class (add theme-nav-scroll to hide the bar).',
  ),
  ...classNameString(
    '/tracking-overline/',
    '[ds/overline] Hand-rolled overline label: use <Text variant="overline">, Field, RowGroup or Section (settings / drawer) from components/ui.',
  ),
  {
    selector: "JSXOpeningElement[name.name='Search'] > JSXAttribute[name.name='className'] Literal[value=/absolute/]",
    message: '[ds/search] Search icon placed over an Input by hand: use SearchField / ToolbarSearchField from components/common/search-field.',
  },
]

// Primitives that only components/common may compose; features use the shared composition.
const FEATURE_GUARDS = [
  {
    selector: "JSXOpeningElement[name.name=/^Tabs(List|Trigger)$/]",
    message: '[ds/tabs] Hand-rolled tab strip: use TextTabs (in-place underlined tabs), FieldTabs (tabs inside a field frame) or SegmentedControl. TextTabs takes TabsContent children.',
  },
]

// Token guards also apply inside components/ui, where the primitives themselves legitimately render <button> and overlays.
const TOKEN_GUARDS = [
  ...classNameString('/#[0-9a-fA-F]{3,8}/', '[ds/hex-colour] Hex colour in className: use theme tokens (bg-primary, text-muted-foreground, status colours…).'),
  ...classNameString('/text-\\[\\d+(\\.\\d+)?px\\]/', '[ds/text-px] Arbitrary text-[Npx] size: use the type scale (text-2xs, text-xs, text-sm…).'),
  ...classNameString('/bg-black\\x2f/', '[ds/backdrop] bg-black/N scrim: use the bg-backdrop token (or Modal, which already applies it).'),
]

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { shadcn },
    // Theme discovery uses components.json → tailwind.css (src/index.css).
    settings: { shadcn: { ui: '@/components/ui', note: 'See frontend/DESIGN_PRESET.md for the design-system contract.' } },
    rules: {
      'shadcn/no-unknown-classes': ['error', { allow: [
        // Interaction markers consumed by React Flow / keyboard and drag handlers.
        'nodrag', 'nopan', 'nowheel', 'nokey', 'comfy-authoring-drag-handle', 'module-graph-drag-handle',
        // CSS / DOM hooks; post-rich-editor and video-player styles are feature-local imports.
        'chat-markdown', 'post-media', 'post-rich-editor', 'wp-hit',
        'conai-video-player', 'conai-video-player__mount',
        // Plain selector in index.css, not a Tailwind color token.
        'bg-checker',
      ] }],
      'shadcn/no-raw-colors': ['error', { allow: ['bg-checker'] }],
      'shadcn/no-restyle': ['error', {
        allow: ['layout'],
        contracts: [
          {
            pattern: '^(Text|Heading|Badge|Chip)$',
            allow: ['layout', 'truncate', 'line-clamp-*', 'whitespace-*', 'break-*', 'tabular-nums'],
            message: 'Callers own content wrapping/truncation, not appearance. Use {{component}} variant, tone or size props; see the migration map in frontend/DESIGN_PRESET.md.',
          },
          {
            pattern: '^(Panel|Inset|PopoverContent|AnchoredPopup|TabsContent|AlertDescription|AlertTitle)$',
            allow: ['layout', 'gap-*', 'space-x-*', 'space-y-*'],
            message: 'The caller arranges children with scale gaps; {{component}} owns its surface and padding. Use padding/treatment props or an inner content layout, not appearance overrides.',
          },
          {
            pattern: '^RowGroup$',
            allow: ['layout', 'text-resource-*', 'text-warning'],
            message: 'RowGroup headingClassName may identify a resource kind or warning. Keep heading typography and row spacing in RowGroup; rows must remain direct siblings.',
          },
          {
            pattern: '^(Button|IconButton|Input|Textarea|Select|Switch|NumberStepperInput)$',
            // Exact marker class names (the plugin notes that on each run; that is the intent).
            allow: ['layout', 'truncate', 'line-clamp-*', 'whitespace-*', 'break-*', 'tabular-nums', 'nodrag', 'nopan', 'nowheel', 'nokey'],
            message: 'Interaction markers are permitted for graph/editor controls; presentation belongs to {{component}} variant/size/mono props. Use aria-invalid for invalid fields.',
          },
        ],
        message: {
          spacing: 'Use {{component}} size props ({{sizes|see component source}}), not spacing overrides. See frontend/DESIGN_PRESET.md.',
          default: 'Use {{component}} variant props ({{variants|see component source}}), not appearance overrides. See frontend/DESIGN_PRESET.md.',
        },
      }],
      // Layout sizes may need calc() / viewport values; spacing (margins included), type, radius and colour stay on the scale.
      'shadcn/no-arbitrary-values': ['error', {
        allow: ['layout'],
        deny: ['m-*', 'mx-*', 'my-*', 'mt-*', 'mr-*', 'mb-*', 'ml-*', 'ms-*', 'me-*'],
      }],
      'shadcn/require-static-classes': 'error',
      // Editors, canvas previews and virtualized views legitimately compute style objects and geometry.
      // A global ban cannot distinguish those from presentation without broad, misleading exceptions.
      'shadcn/no-inline-styles': 'off',
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'shadcn/no-restyle': 'off',
      'shadcn/no-arbitrary-values': 'off',
      'shadcn/require-static-classes': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2024,
      globals: globals.browser,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  // Native dialogs are fully migrated; keep them out for good.
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error', ...NATIVE_DIALOGS.map(([name, message]) => ({ name, message }))],
      'no-restricted-properties': [
        'error',
        ...['window', 'globalThis', 'self'].flatMap((object) =>
          NATIVE_DIALOGS.map(([property, message]) => ({ object, property, message })),
        ),
      ],
    },
  },
  // Design-system guards: hand-rolled UI that has a shared replacement. The burn-down reached zero, so these are errors.
  {
    files: [
      'src/features/**/*.{ts,tsx}',
      'src/components/common/**/*.{ts,tsx}',
      'src/components/layout/**/*.{ts,tsx}',
      'src/components/media/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': ['error', ...DESIGN_SYSTEM_GUARDS, ...TOKEN_GUARDS],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/components/layout/**/*.{ts,tsx}', 'src/components/media/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...DESIGN_SYSTEM_GUARDS, ...TOKEN_GUARDS, ...FEATURE_GUARDS],
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': ['error', ...TOKEN_GUARDS],
    },
  },
])
