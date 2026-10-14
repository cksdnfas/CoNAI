# CoNAI Frontend Architecture

갱신: 2026-10-13 · React + Vite + Tailwind + TanStack Query + React Router (hash router).
정책은 [AI_Guidelines.md](../AI_Guidelines.md), 서버·AI 연결은 [DEVELOPMENT.md](../DEVELOPMENT.md)를 따른다.

## Runtime
- Dev server: port `1677` (or `FRONTEND_URL`). Vite proxies `/api`, `/uploads`, `/temp`, `/save` to the backend on `1666`.
- Shared API types come from `@conai/shared` (`../shared`).
- Entry: `main.tsx` → `App.tsx` → `AppProviders` + `RouterProvider(appRouter)`.

## Providers (`src/app/providers.tsx`, outer → inner)
`QueryClientProvider` → `RuntimeEventStreamProvider` (SSE bridge into the query cache) → `I18nProvider` →
`ThemeProvider` (applies the saved appearance settings as CSS variables) → `TooltipProvider` → `SnackbarProvider` →
`ConfirmProvider` (`useConfirm()`).

The app shell also mounts `ChatPageProvider` → `CodexChatProvider`: page registration and the chat dock share the
current screen state. See `components/layout/app-shell.tsx`; these providers are not global route-independent providers.

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
| `/chat` | `features/codex-chat` | `page.chat.view` |
| `/files` | `features/files` | `page.files.view` |
| `/posts` | `features/posts` (board and knowledge) | `page.posts.view` |
| `/audio` | `features/audio` | `page.audio.view` |
| `/sprite` | `features/sprite` | `page.sprite.view` |
| `/settings` | `features/settings` | `page.settings.view` |
| `/wallpaper` | `features/wallpaper` | `page.wallpaper.view` |
| `/wallpaper/runtime` | `features/wallpaper` | separate runtime access flow; outside app shell |
| `/graph` | redirect to `/generation?tab=workflows` | |
| `/dev/ui` | `features/dev-ui-catalog` | dev builds only |

Everything except `/login`, `/dev/ui` and `/wallpaper/runtime` renders inside `ProtectedAppShell` → `components/layout/app-shell.tsx`.
The public workflow route has its own access flow; being inside the shell does not make it a private workflow.

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
See [DESIGN_PRESET.md](DESIGN_PRESET.md) ("The Silent Curator", flat page, spacing and hairline rows, button variants, tokens) and the
live catalog at `/#/dev/ui`. Use `components/ui`; the `[ds/*]` lint guards in `eslint.config.js` flag bypasses.

## Assistant integration and performance

- New page features include an assistant path: register bounded fields/data/actions with the page context and reuse
  the native state setters/API. Follow the shared action schema, permission mapping and view/draft/commit tiers.
- Server-side automation uses MCP tools over the same domain services. A navigation entry alone is not full feature support.
- Preserve the shared virtualized list in `features/images/components/image-list/` (Virtuoso + ViSelect), stable media
  identity, bounded loading and video preview lifecycle. Do not build a separate engine per page.
- Keep expensive work out of input/scroll/render paths. Reuse the query cache and runtime event bridge; invalidate
  affected data instead of refetching every list. Keep page snapshots and tool responses bounded.
- React Compiler is configured in `vite.config.ts`. Preserve the default compiler path; use the existing compiler-off
  build only to investigate a demonstrated compatibility issue, not as the default optimization strategy.

## Checks

Optional extensions live in `features/plugins/`: `/settings?section=plugins` embeds package management; `/extensions` is the standalone launcher and operation view and `/ext/:pluginId/:pageId`
hosts an opaque `sandbox="allow-scripts"` iframe. Use the private MessageChannel SDK, never inject plugin code
into the app bundle. The host registers `kind: 'extension'` with manifest actions and owns all save review cards.
File selection is explicit and bounded. `useUnsavedSettingsGuard(..., true)` also guards query changes that replace
the selected files. Keep the parent's `frame-src 'self'` policy and the dedicated asset proxy in Vite.
See [plugin contracts](../plugins/README.md).

`npm run typecheck`, `npx eslint .`, `npm run build` (run in `frontend/`).
