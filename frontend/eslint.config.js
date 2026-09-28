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
    // A <button> that is the direct child of <Panel asChild …> is allowed: Panel supplies tone, hover and focus
    // (`interactive`) for rich clickable cards that Button's single-line sizing does not fit.
    selector:
      "JSXElement:not(JSXElement[openingElement.name.name='Panel']:has(JSXOpeningElement[name.name='Panel'] > JSXAttribute[name.name='asChild']) > JSXElement) > JSXOpeningElement[name.name='button']",
    message: '[ds/button] Raw <button>: use Button or IconButton from components/ui (rich clickable cards: <Panel asChild interactive><button/></Panel>).',
  },
  ...classNameString('/fixed inset-0/', '[ds/overlay] Hand-rolled "fixed inset-0" overlay: use Modal or Popover from components/ui.'),
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
  // Design-system guards: warn (burn-down) on hand-rolled UI that has a shared replacement.
  {
    files: [
      'src/features/**/*.{ts,tsx}',
      'src/components/common/**/*.{ts,tsx}',
      'src/components/layout/**/*.{ts,tsx}',
      'src/components/media/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': ['warn', ...DESIGN_SYSTEM_GUARDS],
    },
  },
])
