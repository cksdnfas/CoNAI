# CoNAI Frontend Architecture

갱신: 2026-09-28 · React 19 + Vite + Tailwind v4 + TanStack Query + React Router (hash router), React Compiler on.

## Runtime
- Dev server: port `1677` (or `FRONTEND_URL`). Vite proxies `/api`, `/uploads`, `/temp`, `/save` to the backend on `1666`.
- Shared API types come from `@conai/shared` (`../shared`).
- Entry: `main.tsx` → `App.tsx` → `AppProviders` + `RouterProvider(appRouter)`.

## Providers (`src/app/providers.tsx`, outer → inner)
`QueryClientProvider` → `RuntimeEventStreamProvider` (SSE bridge into the query cache) → `I18nProvider` →
`ThemeProvider` (applies the saved appearance settings as CSS variables) → `SnackbarProvider` → `TooltipProvider` →
`ConfirmProvider` (`useConfirm()`).

## Routes (`src/app/router.tsx`, pages lazy-loaded in `src/app/lazy-routes.tsx`)
| Path | Feature folder | Permission |
|---|---|---|
| `/login` | `features/auth` | public |
| `/` | `features/home` (image feed) | shell |
| `/access` | `features/auth` | shell |
| `/groups`, `/groups/:groupId` | `features/groups` | `page.groups.view` |
| `/prompts` | `features/prompts` | `page.prompts.view` |
| `/generation` (NAI, ComfyUI, workflows, queue) | `features/image-generation`, `features/module-graph` | `page.generation.view` |
| `/wildcards` | `features/image-generation` | `page.wildcards.view` |
| `/public/workflows/:slug` | `features/image-generation` | public workflow page |
| `/images/:compositeHash`, `/images/:compositeHash/metadata` | `features/images`, `features/metadata` | `page.image-detail.view`, `page.metadata-editor.view` |
| `/upload` | `features/upload` | `page.upload.view` |
| `/settings` | `features/settings` | `page.settings.view` |
| `/wallpaper`, `/wallpaper/runtime` | `features/wallpaper` | `page.wallpaper*.view` |
| `/graph` | redirect to `/generation?tab=workflows` | |
| `/dev/ui` | `features/dev-ui-catalog` | dev builds only |

Everything except `/login` and `/dev/ui` renders inside `ProtectedAppShell` → `components/layout/app-shell.tsx`.

## Layers
- `src/components/ui/` — design-system primitives (Button, IconButton, Panel, Section, Modal, Input, …). No feature
  knowledge, no API calls. Visual rules live here.
- `src/components/common/` — shared composites built from `ui` (segmented controls, explorer sidebar, page header,
  selection bar, tag/prompt result blocks). May know app concepts, not a single feature.
- `src/components/layout/`, `src/components/media/` — app shell and shared media helpers.
- `src/features/<name>/` — pages, feature components and hooks. Features do import each other today (mostly
  `images`, `search`, `groups`, `auth`); when something is reused widely, move it down to `components/common` or `lib`.
- `src/lib/` — API clients (`api-*.ts`), query client, appearance/theme system, formatting utilities.
- `src/types/` — frontend-only view types.

## i18n
- `useI18n().t(...)` with inline `{ ko, en }` dictionaries, or catalog keys from `src/i18n/resources/<feature>.ts`.
- Route catalogs register lazily with the page (`loadRouteModuleWithCatalog`). Default language `ko`.
- Korean UI copy uses casual 반말.

## Design system
See `DESIGN_PRESET.md` ("The Silent Curator", D1: tone instead of outlines, button variant guide, tokens) and the
live catalog at `/#/dev/ui`. Use `components/ui`; the `[ds/*]` lint guards in `eslint.config.js` flag bypasses.

## Checks
`npm run typecheck`, `npx eslint .`, `npm run build` (run in `frontend/`).
