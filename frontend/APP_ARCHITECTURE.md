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
| `/characters` (`?folder=`, `?q=`, `?page=`, `?setting=`, `?new=`) | `features/characters` (character library) | `page.characters.view` |
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
- `src/components/common/` — shared composites built from `ui` (segmented controls, page-with-sidebar / sidebar
  column / two-pane layout, media card, page toolbar, selection bar, tag/prompt result blocks). May know app concepts, not a single feature.
- `src/components/layout/`, `src/components/media/` — app shell and shared media helpers.
- `src/features/<name>/` — pages, feature components and hooks. Features do import each other today (mostly
  `images`, `search`, `groups`, `auth`); when something is reused widely, move it down to `components/common` or `lib`.
- `src/lib/` — API clients (`api-*.ts`), query client, appearance/theme system, formatting utilities.
- `src/types/` — frontend-only view types.

## Character library

`features/characters/character-library-page.tsx` owns the folder tree, paged name search and editor URL state.
`lib/api-character-library.ts` uses `/api/character-library`; shared contracts live in
`shared/src/types/characterLibrary.ts`. Access is `characters.view`/`characters.edit`, header key `characters`;
image fields additionally require `images.view`, candidate generation administrator access plus edit permission.

- `use-character-setting-editor.ts` preserves drafts and checks revisions; on a stale revision it merges non-overlapping
  changes and retries once, otherwise asks the user to resolve the conflict.
- `components/character-setting-appearance.tsx` reuses settings' `character-appearance-editor.tsx` and
  `use-character-setting-runs.ts` for setting-owned asset batches and expression groups.
- Settings' `chat-profile-character-link.tsx` and `use-profile-character-link.ts` distinguish no link, synced look and
  detached copy. A synced profile edits the setting first, then saves the profile; unresolved conflicts stop that save.
  Background and its generation remain profile-owned.
  Detached/unlinked drafts show the source expression group read-only until saving copies it; missing/inaccessible
  groups show a note. `ensureProfile` persists pending link changes before dependent stores/profile-owned generation.
  Proposal cards refuse synced look-only changes and confirm saving only the remaining fields in mixed proposals.
- Generation's `character-setting-load-button.tsx` copies tags and optional reference into NAI/Codex/ComfyUI forms;
  later library changes do not update those forms. NAI reference placement is independent of character prompt rows.
- `module-graph-character-setting-input.tsx` selects `character_setting_id` on a node card/inspector, mutually exclusive
  with `profile_id`. Workflow run inputs still use a numeric field rather than this picker.
- `use-character-library-chat-page.ts` registers `character.*`; the profile adapter exposes `profile.draft` with
  `characterLink` and reviewed `profile.character_save`. Generation adapters expose `character_setting.insert` through
  `use-chat-character-setting-insertion.ts`. Shared action permissions and path checks remain authoritative.
  The profile adapter refuses switching settings over a dirty synced draft, requires `characters.edit` for synced
  appearance edits, exposes up to 50 `syncedProfiles` names and separates background from setting-owned `profile.assets`.
- Runtime topic `characters`, event `characters.changed`, refreshes affected library/profile queries through
  `features/runtime-events/use-runtime-event-query-bridge.ts`.

See the [user guide](../docs/GUIDE/CHARACTER_LIBRARY.md) and [backend/code map](../DEVELOPMENT.md#캐릭터-라이브러리와-외형-재사용).

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
- Chat thread queries/selection live in `features/codex-chat/use-chat-thread-data.ts`; transcript windowing, streaming
  follow and focus restoration live in `use-chat-transcript-window.ts`. Both chat layouts share them.
- Posts share `use-post-comments.ts` between the page assistant and rendered threads. Root/reply cursors load bounded
  server pages; focused comments and quote context do not require downloading the entire discussion.
- Preserve the shared virtualized list in `features/images/components/image-list/` (Virtuoso + ViSelect), stable media
  identity, bounded loading and video preview lifecycle. Do not build a separate engine per page.
- Container masonry pagination checks both the request state and viewport distance after each page; filtered-out pages must not permanently lock loading at the same visible item count.
- Library selection uses `components/media/media-library-browser.tsx`: the group tree, server prompt/tag search,
  media/tool filters, sorting and virtualized list share the post attachment layout. `media-library-picker.tsx` adds
  the modal and reference selection for chat, settings, wallpaper and sprites. Posts embed the browser with mixed
  attachment ordering and group insertion; generation inputs embed it in their System tab and retain their existing
  import/conversion flow. Pass media kind, selection limit and initial group as options; do not fork the browser.
  Page assistants keep using each feature's existing hash-based draft/action contracts and domain APIs.
- Keep expensive work out of input/scroll/render paths. Reuse the query cache and runtime event bridge; invalidate
  affected data instead of refetching every list. Keep page snapshots and tool responses bounded.
- React Compiler is configured in `vite.config.ts`. Preserve the default compiler path; use the existing compiler-off
  build only to investigate a demonstrated compatibility issue, not as the default optimization strategy.

## Checks

Optional extensions live in `features/plugins/`: `/settings?section=plugins` embeds package management; `/extensions` is the standalone launcher and operation view and `/ext/:pluginId/:pageId`
hosts an opaque `sandbox="allow-scripts"` iframe. Use the private MessageChannel SDK, never inject plugin code
into the app bundle. Installed plugins use native account permissions; opening a page does not require file access.
Direct app calls execute normally, while assistant changes and explicit save proposals keep host review cards.
File selection is bounded opening context. `useUnsavedSettingsGuard(..., true)` also guards query changes that replace
the selected files. Keep the parent's `frame-src 'self'` policy and the dedicated asset proxy in Vite.
See [plugin contracts](../plugins/README.md).

Unsaved-change guards register through `useUnsavedSettingsGuard` (`features/settings/use-unsaved-settings-guard.ts`).
Its provider in the app shell owns the app's only `useBlocker`, because React Router consults just the last registered
blocker; never call `useBlocker` elsewhere. Pass `true` to also guard query changes, or a stable
`(current, next) => boolean` for a narrower scope (the workflows tab).

`npm run typecheck`, `npx eslint .`, `npm run build` (run in `frontend/`).
