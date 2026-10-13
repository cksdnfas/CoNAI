import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
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
